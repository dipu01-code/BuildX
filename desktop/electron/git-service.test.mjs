import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createGitService, parseStatus } = require('./git-service.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';
let roots = [];

async function repository({ init = true } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-git-')));
  roots.push(root);
  if (init) {
    const git = (...args) => execFileSync('git', args, { cwd: root });
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.name', 'BUILDX Test');
    git('config', 'user.email', 'test@example.invalid');
  }
  return root;
}

function service(root) {
  return createGitService({ getProjectRoot: async (id) => { expect(id).toBe(projectId); return root; } });
}

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots = [];
});

describe('git service', () => {
  it('parses branch, renamed, conflicted, and untracked entries including spaces in paths', () => {
    const output = [
      '# branch.oid abc', '# branch.head feature', '# branch.upstream origin/feature', '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a a src/with space.js',
      '2 R. N... 100644 100644 100644 a a R100 new.js', 'old.js',
      'u UU N... 100644 100644 100644 100644 a a a conflict.txt',
      '? notes/', '',
    ].join('\0');
    const status = parseStatus(output);
    expect(status).toMatchObject({ branch: 'feature', detached: false, initial: false, upstream: 'origin/feature', ahead: 2, behind: 1 });
    expect(status.files).toEqual([
      expect.objectContaining({ path: 'src/with space.js', staged: false, unstaged: true }),
      expect.objectContaining({ path: 'new.js', orig_path: 'old.js', staged: true, unstaged: false }),
      expect.objectContaining({ path: 'conflict.txt', conflicted: true, staged: false }),
      expect.objectContaining({ path: 'notes', untracked: true, directory: true }),
    ]);
  });

  it('reports a folder that is not a repository without failing', async () => {
    const root = await repository({ init: false });
    await expect(service(root).status(projectId)).resolves.toEqual({ project_id: projectId, repository: false });
  });

  it('refuses a project folder that is a subfolder of a larger repository', async () => {
    const root = await repository();
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested);
    await expect(service(nested).status(projectId)).rejects.toThrow(/inside a larger Git repository/);
  });

  it('stages, diffs, unstages, and commits only the reviewed staged files', async () => {
    const root = await repository();
    const git = service(root);
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n');
    await fs.writeFile(path.join(root, '*'), 'literal star\n');

    let status = await git.status(projectId);
    expect(status).toMatchObject({ repository: true, branch: 'main', initial: true });
    expect(status.files.map((file) => file.path).sort()).toEqual(['*', 'a.txt']);

    // Literal pathspecs: staging "*" must not stage every file.
    status = await git.stage(projectId, ['*']);
    expect(status.files.filter((file) => file.staged).map((file) => file.path)).toEqual(['*']);
    status = await git.unstage(projectId, ['*']);
    expect(status.files.some((file) => file.staged)).toBe(false);

    await git.stage(projectId, ['a.txt']);
    expect((await git.diff(projectId, 'a.txt', true)).diff).toMatch(/\+one/);
    await expect(git.commit(projectId, { message: 'first', staged_paths: ['a.txt', '*'] })).rejects.toThrow(/changed after review/);
    const result = await git.commit(projectId, { message: 'first', staged_paths: ['a.txt'] });
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.status.files.map((file) => file.path)).toEqual(['*']);

    await fs.writeFile(path.join(root, 'a.txt'), 'two\n');
    expect((await git.diff(projectId, 'a.txt', false)).diff).toMatch(/-one\n\+two/);
  });

  it('does not run repository hooks on commit', async () => {
    const root = await repository();
    const marker = path.join(root, 'hook-ran');
    await fs.writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
    const git = service(root);
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n');
    await git.stage(projectId, ['a.txt']);
    await expect(git.commit(projectId, { message: 'no hooks', staged_paths: ['a.txt'] })).resolves.toHaveProperty('commit');
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it('rejects unsafe paths and empty messages before running git', async () => {
    const git = service(await repository());
    await expect(git.stage(projectId, ['../outside'])).rejects.toThrow(/invalid path segment/);
    await expect(git.stage(projectId, ['/etc/passwd'])).rejects.toThrow(/Absolute paths/);
    await expect(git.stage(projectId, [])).rejects.toThrow(/Choose 1/);
    await expect(git.diff(projectId, ':(top)a', false)).rejects.toThrow(/invalid path segment/);
    await expect(git.commit(projectId, { message: '  ', staged_paths: ['a'] })).rejects.toThrow(/commit message/);
  });
});
