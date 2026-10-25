import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createWorkspaceFiles, MAX_TEXT_FILE_BYTES, parseRelativePath } = require('./workspace-files.cjs');
let tempRoot;
let projectRoot;
let outsideRoot;
let projectApi;
let workspace;
const projectId = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-workspace-'));
  projectRoot = path.join(tempRoot, 'project');
  outsideRoot = path.join(tempRoot, 'outside');
  await fs.mkdir(projectRoot);
  await fs.mkdir(outsideRoot);
  const record = { id: projectId, name: 'Fixture', root_path: projectRoot };
  projectApi = {
    getProject: async () => record,
    updateProject: async (_id, update) => Object.assign(record, update),
  };
  workspace = createWorkspaceFiles();
  await workspace.chooseDirectory(projectApi, projectId, {
    showOpenDialog: async () => ({ canceled: false, filePaths: [projectRoot] }),
  }, null);
});

afterEach(async () => { await fs.rm(tempRoot, { recursive: true, force: true }); });

describe('project-scoped workspace filesystem', () => {
  it('rejects traversal and absolute child paths', () => {
    expect(() => parseRelativePath('../outside/file')).toThrow(/invalid path segment/i);
    expect(() => parseRelativePath('/etc/passwd')).toThrow(/absolute paths/i);
    expect(() => parseRelativePath('C:\\Windows\\win.ini')).toThrow(/absolute paths/i);
  });

  it('lists immediate children in folders-first deterministic order', async () => {
    await fs.mkdir(path.join(projectRoot, 'z-folder'));
    await fs.writeFile(path.join(projectRoot, 'z-file.txt'), 'ok');
    await fs.writeFile(path.join(projectRoot, 'a-file.txt'), 'ok');
    const result = await workspace.list(projectApi, projectId, '');
    expect(result.entries.map(({ name, type }) => [name, type])).toEqual([
      ['z-folder', 'directory'], ['a-file.txt', 'file'], ['z-file.txt', 'file'],
    ]);
  });

  it('reads UTF-8 text and rejects binary or oversized files', async () => {
    await fs.writeFile(path.join(projectRoot, 'readme.txt'), 'hello BUILDX');
    expect(await workspace.readText(projectApi, projectId, 'readme.txt')).toMatchObject({
      content: 'hello BUILDX', size: 12, encoding: 'utf-8',
    });
    await fs.writeFile(path.join(projectRoot, 'binary.dat'), Buffer.from([65, 0, 66]));
    await expect(workspace.readText(projectApi, projectId, 'binary.dat')).rejects.toThrow(/binary/i);
    await fs.writeFile(path.join(projectRoot, 'large.txt'), Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 97));
    await expect(workspace.readText(projectApi, projectId, 'large.txt')).rejects.toThrow(/too large/i);
  });

  it('saves atomically and rejects an external modification without overwriting it', async () => {
    const target = path.join(projectRoot, 'edit.ts');
    await fs.writeFile(target, 'const value = 1;');
    const opened = await workspace.readText(projectApi, projectId, 'edit.ts');
    const saved = await workspace.writeText(projectApi, projectId, 'edit.ts', 'const value = 2;', opened.revision);
    expect(await fs.readFile(target, 'utf8')).toBe('const value = 2;');
    expect(saved.revision).not.toBe(opened.revision);
    await fs.writeFile(target, 'const value = 3;');
    await expect(workspace.writeText(projectApi, projectId, 'edit.ts', 'const value = 4;', saved.revision))
      .rejects.toThrow(/changed on disk/i);
    expect(await fs.readFile(target, 'utf8')).toBe('const value = 3;');
    expect((await fs.readdir(projectRoot)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('creates without overwriting, renames, moves and deletes only scoped items', async () => {
    await workspace.createFile(projectApi, projectId, 'new.txt');
    await expect(workspace.createFile(projectApi, projectId, 'new.txt')).rejects.toThrow(/already exists/i);
    await workspace.createFolder(projectApi, projectId, 'src');
    await workspace.move(projectApi, projectId, 'new.txt', 'src/renamed.txt');
    await expect(fs.stat(path.join(projectRoot, 'src/renamed.txt'))).resolves.toBeDefined();
    await workspace.remove(projectApi, projectId, 'src/renamed.txt');
    await workspace.remove(projectApi, projectId, 'src');
    await expect(fs.stat(path.join(projectRoot, 'src'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects project-root deletion and moves into a folder descendant', async () => {
    await fs.mkdir(path.join(projectRoot, 'src'));
    await fs.mkdir(path.join(projectRoot, 'src/child'));
    await expect(workspace.remove(projectApi, projectId, '')).rejects.toThrow(/root cannot be deleted/i);
    await expect(workspace.move(projectApi, projectId, 'src', 'src/child/moved'))
      .rejects.toThrow(/into itself/i);
  });

  it('blocks symlinks that escape the configured root', async () => {
    try { await fs.symlink(outsideRoot, path.join(projectRoot, 'external'), 'dir'); }
    catch (error) { if (error.code === 'EPERM') return; throw error; }
    await expect(workspace.list(projectApi, projectId, 'external')).rejects.toThrow(/symbolic links/i);
    await expect(fs.readdir(outsideRoot)).resolves.toEqual([]);
  });

  it('requires an existing configured project directory', async () => {
    projectApi.getProject = async () => ({ id: projectId, name: 'Missing', root_path: null });
    await expect(workspace.list(projectApi, projectId, '')).rejects.toThrow(/choose a project directory/i);
  });

  it('does not authorize a directory merely because it is stored in the project record', async () => {
    const freshWorkspace = createWorkspaceFiles();
    await expect(freshWorkspace.list(projectApi, projectId, '')).rejects.toThrow(/native folder picker/i);
  });

  it('invalidates authorization if the persisted project path changes', async () => {
    await fs.mkdir(path.join(tempRoot, 'replacement'));
    await projectApi.updateProject(projectId, { root_path: path.join(tempRoot, 'replacement') });
    await expect(workspace.list(projectApi, projectId, '')).rejects.toThrow(/saved project folder changed/i);
  });

  it('associates only a user-selected accessible directory and leaves cancel unchanged', async () => {
    const updateProject = async (_id, update) => ({ id: projectId, name: 'Fixture', ...update });
    const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
    await expect(workspace.chooseDirectory({ ...projectApi, updateProject }, projectId, dialog, null))
      .resolves.toEqual({ canceled: true });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectRoot] });
    await expect(workspace.chooseDirectory({ ...projectApi, updateProject }, projectId, dialog, null))
      .resolves.toMatchObject({ canceled: false, project: { root_path: await fs.realpath(projectRoot) } });
  });
});
