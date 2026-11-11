import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { backendCommand, runMigrations } = require('./backend-process.cjs');
let roots = [];

async function folder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-backend-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots = [];
});

describe('backend launcher', () => {
  it('uses the bundled executable in the data folder when it exists', async () => {
    const backendDir = await folder();
    const name = process.platform === 'win32' ? 'buildx-backend.exe' : 'buildx-backend';
    await fs.writeFile(path.join(backendDir, name), '');
    expect(backendCommand(backendDir, '/data', {})).toEqual({
      command: path.join(backendDir, name), cwd: '/data', migrate: ['migrate'], serve: ['serve'],
    });
    // An explicit interpreter still wins, for debugging an installed build.
    expect(backendCommand(backendDir, '/data', { BUILDX_PYTHON: '/usr/bin/python3' })).toMatchObject({
      command: '/usr/bin/python3', cwd: backendDir, serve: ['-m', 'app'],
    });
  });

  it('falls back to Python modules in development and passes the data folder to migrations', async () => {
    const backendDir = await folder();
    expect(backendCommand(backendDir, '/data', {})).toMatchObject({ cwd: backendDir, migrate: ['-m', 'alembic', 'upgrade', 'head'] });
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
    const spawnImpl = vi.fn(() => child);
    const done = runMigrations({ backendDir, dataDir: '/data', env: {}, spawnImpl });
    child.emit('close', 0);
    await expect(done).resolves.toBeUndefined();
    expect(spawnImpl.mock.calls[0][2].env).toMatchObject({ BUILDX_DATA_DIR: '/data', BUILDX_HOST: '127.0.0.1' });
  });
});
