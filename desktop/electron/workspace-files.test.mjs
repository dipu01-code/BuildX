import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createWorkspaceFiles, MAX_TEXT_FILE_BYTES, MAX_INDEX_BYTES, parseRelativePath } = require('./workspace-files.cjs');
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

  it('discovers only safe text files and applies root/nested gitignore rules', async () => {
    await fs.mkdir(path.join(projectRoot, 'docs'));
    await fs.mkdir(path.join(projectRoot, 'src'));
    await fs.mkdir(path.join(projectRoot, 'node_modules'));
    await fs.mkdir(path.join(projectRoot, '.aws'));
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '*.log\ndocs/private-*\n!docs/private-ok.md\n');
    await fs.writeFile(path.join(projectRoot, 'src/.gitignore'), 'local.txt\n');
    await fs.writeFile(path.join(projectRoot, 'README.md'), 'Local project documentation.');
    await fs.writeFile(path.join(projectRoot, 'ignored.log'), 'do not index');
    await fs.writeFile(path.join(projectRoot, 'docs/private-no.md'), 'private');
    await fs.writeFile(path.join(projectRoot, 'docs/private-ok.md'), 'visible documentation');
    await fs.writeFile(path.join(projectRoot, 'src/local.txt'), 'ignored locally');
    await fs.writeFile(path.join(projectRoot, 'src/main.js'), 'export const safe = true;');
    await fs.writeFile(path.join(projectRoot, '.env.local'), 'API_KEY=not-for-index');
    await fs.writeFile(path.join(projectRoot, 'credentials.json'), '{"password":"not-for-index"}');
    await fs.writeFile(path.join(projectRoot, 'node_modules/dependency.js'), 'generated');
    await fs.writeFile(path.join(projectRoot, '.aws/credentials'), 'credential');
    await fs.writeFile(path.join(projectRoot, 'image.bin'), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(projectRoot, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
    try { await fs.symlink(outsideRoot, path.join(projectRoot, 'external'), 'dir'); }
    catch (error) { if (error.code !== 'EPERM') throw error; }

    const scanner = await workspace.discoverIndexableFiles(projectApi, projectId);
    const indexed = [];
    for await (const item of scanner.iterate()) if (item.type === 'file') indexed.push(item.file);
    const summary = scanner.summary();
    const paths = indexed.map((file) => file.relative_path).sort();

    expect(paths).toContain('README.md');
    expect(paths).toContain('docs/private-ok.md');
    expect(paths).toContain('src/main.js');
    expect(paths).not.toContain('ignored.log');
    expect(paths).not.toContain('docs/private-no.md');
    expect(paths).not.toContain('src/local.txt');
    expect(paths).not.toContain('.env.local');
    expect(paths).not.toContain('credentials.json');
    expect(paths).not.toContain('node_modules/dependency.js');
    expect(paths).not.toContain('.aws/credentials');
    expect(paths).not.toContain('image.bin');
    expect(paths).not.toContain('invalid.txt');
    expect(paths).not.toContain('external');
    expect(summary.skipReasons).toMatchObject({ gitignore: 3, generated_directory: 1, sensitive_directory: 1, sensitive_file: 2, binary_file: 1, invalid_text: 1 });
    expect(indexed.every((file) => /^[0-9a-f]{64}$/.test(file.content_hash))).toBe(true);
    expect(summary.errors.some((error) => error.message.includes(projectRoot))).toBe(false);
  });

  it('reuses the stable content hash and omits unchanged text from backend uploads', async () => {
    await fs.writeFile(path.join(projectRoot, 'src.js'), 'const local = true;');
    const first = await workspace.discoverIndexableFiles(projectApi, projectId);
    let original;
    for await (const item of first.iterate()) if (item.type === 'file' && item.file.relative_path === 'src.js') original = item.file;
    const second = await workspace.discoverIndexableFiles(projectApi, projectId, [original]);
    let unchanged;
    for await (const item of second.iterate()) if (item.type === 'file' && item.file.relative_path === 'src.js') unchanged = item.file;
    expect(unchanged.content_hash).toBe(original.content_hash);
    expect(unchanged.content).toBeNull();
  });

  it('enforces the per-file byte limit without reading oversized files', async () => {
    await fs.writeFile(path.join(projectRoot, 'large.txt'), Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 97));
    await fs.writeFile(path.join(projectRoot, 'included.txt'), 'included');
    const scanner = await workspace.discoverIndexableFiles(projectApi, projectId);
    const indexed = [];
    for await (const item of scanner.iterate()) if (item.type === 'file') indexed.push(item.file.relative_path);
    expect(indexed).toEqual(['included.txt']);
    expect(scanner.summary().skipReasons.file_too_large).toBe(1);
  });

  it('stops at the bounded total project size and marks the scan incomplete', async () => {
    const fileBytes = 1024 * 1024;
    for (let index = 0; index < 26; index += 1) {
      await fs.writeFile(path.join(projectRoot, `file-${String(index).padStart(2, '0')}.txt`), Buffer.alloc(fileBytes, 97));
    }
    const scanner = await workspace.discoverIndexableFiles(projectApi, projectId);
    let fileCount = 0;
    for await (const item of scanner.iterate()) if (item.type === 'file') fileCount += 1;
    expect(fileCount).toBe(25);
    expect(scanner.summary().totalBytes).toBe(MAX_INDEX_BYTES);
    expect(scanner.summary()).toMatchObject({ incomplete: true, skipReasons: { project_size_limit: 1 } });
  });

  it('reports permission failures and changing files without crashing or losing prior records', async () => {
    await fs.writeFile(path.join(projectRoot, 'blocked.txt'), 'not readable');
    await fs.writeFile(path.join(projectRoot, 'racing.txt'), 'changes while scanning');
    const fsImpl = new Proxy(fs, {
      get(target, property) {
        if (property === 'lstat') return async (filePath) => {
          if (path.basename(filePath) === 'blocked.txt') {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          return target.lstat(filePath);
        };
        if (property === 'open') return async (filePath, flags) => {
          const handle = await target.open(filePath, flags);
          if (path.basename(filePath) !== 'racing.txt') return handle;
          return {
            close: () => handle.close(),
            stat: async () => {
              const stats = await handle.stat();
              return { isFile: () => true, size: stats.size, ino: stats.ino, dev: stats.dev, mtimeMs: stats.mtimeMs + 1 };
            },
          };
        };
        return Reflect.get(target, property);
      },
    });
    const customWorkspace = createWorkspaceFiles({ fsImpl });
    await customWorkspace.chooseDirectory(projectApi, projectId, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [projectRoot] }),
    }, null);
    const scanner = await customWorkspace.discoverIndexableFiles(projectApi, projectId, [
      { relative_path: 'blocked.txt', content_hash: 'a'.repeat(64) },
      { relative_path: 'racing.txt', content_hash: 'b'.repeat(64) },
    ]);
    let events = 0;
    for await (const item of scanner.iterate()) {
      expect(['file', 'skip']).toContain(item.type);
      events += 1;
    }
    expect(events).toBeGreaterThan(0);
    expect(scanner.summary().errors.map((error) => error.path)).toContain('blocked.txt');
    expect(scanner.summary().errors.map((error) => error.path)).toContain('racing.txt');
    expect(scanner.summary().preservePaths).toEqual(expect.arrayContaining(['blocked.txt', 'racing.txt']));
  });
});
