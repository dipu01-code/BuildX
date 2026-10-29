import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createTerminalProcesses, terminalLimits } = require('./terminal-processes.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';
const requestId = '550e8400-e29b-41d4-a716-446655440001';
let projectRoot;

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 101;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killedWith = [];
  }

  kill(signal) {
    this.killedWith.push(signal);
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  }
}

async function makeManager({ limits, emit = vi.fn(), spawnImpl } = {}) {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-terminal-'));
  projectRoot = await fs.realpath(projectRoot);
  const child = new FakeChild();
  const launch = spawnImpl || vi.fn(() => child);
  const manager = createTerminalProcesses({
    getProjectRoot: async () => projectRoot,
    emit,
    spawnImpl: launch,
    platform: 'win32',
    environment: { PATH: '/safe/bin', HOME: '/user', OPENAI_API_KEY: 'must-not-inherit', COMSPEC: 'cmd.exe' },
    limits: limits || { timeoutMs: 60_000, maxConcurrent: 2, maxOutputBytes: 64 },
  });
  return { manager, child, launch, emit };
}

afterEach(async () => {
  vi.useRealTimers();
  if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true });
  projectRoot = null;
});

describe('approved terminal process manager', () => {
  it('starts only the reviewed command in the canonical project root with a filtered environment', async () => {
    const { manager, child, launch } = await makeManager();
    const command = 'echo hello';
    const approval = { project_id: projectId, command, working_directory: projectRoot };
    const session = await manager.start({ projectId, command, requestId, approval });
    expect(session).toMatchObject({ project_id: projectId, command, working_directory: projectRoot, status: 'running' });
    expect(launch).toHaveBeenCalledWith('cmd.exe', ['/d', '/s', '/c', command], expect.objectContaining({ cwd: projectRoot, shell: false }));
    const options = launch.mock.calls[0][2];
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
    expect(options.env.PATH).toBe('/safe/bin');
    expect(child).toBeDefined();
  });

  it('rejects empty commands and approvals bound to a different command or project directory', async () => {
    const { manager, launch } = await makeManager();
    await expect(manager.start({ projectId, command: '  ', requestId, approval: {} })).rejects.toThrow(/1 to 4000/i);
    await expect(manager.start({ projectId, command: 'echo x', requestId, approval: { project_id: projectId, command: 'echo y', working_directory: projectRoot } })).rejects.toThrow(/changed after review/i);
    expect(launch).not.toHaveBeenCalled();
  });

  it('streams stdout and stderr and reports exit status and exit code', async () => {
    const { manager, child, emit } = await makeManager();
    const command = 'write output';
    await manager.start({ projectId, command, requestId, approval: { project_id: projectId, command, working_directory: projectRoot } });
    child.stdout.emit('data', Buffer.from('out\n'));
    child.stderr.emit('data', Buffer.from('err\n'));
    child.emit('close', 7, null);
    const session = manager.list(projectId)[0];
    expect(session).toMatchObject({ status: 'failed', exit_code: 7, stdout: 'out\n', stderr: 'err\n' });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'output', stream: 'stdout', data: 'out\n' }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', session: expect.objectContaining({ status: 'failed', exit_code: 7 }) }));
  });

  it('bounds retained output and emits a truncation marker', async () => {
    const { manager, child, emit } = await makeManager({ limits: { timeoutMs: 60_000, maxConcurrent: 2, maxOutputBytes: 16 * 1024 } });
    const command = 'large output';
    await manager.start({ projectId, command, requestId, approval: { project_id: projectId, command, working_directory: projectRoot } });
    child.stdout.emit('data', Buffer.alloc(17 * 1024, 49));
    const session = manager.list(projectId)[0];
    expect(session.stdout.startsWith('111111')).toBe(true);
    expect(Buffer.byteLength(session.stdout + session.stderr, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(session.output_truncated).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'truncated' }));
  });

  it('deduplicates request IDs and isolates process sessions by project', async () => {
    const { manager, launch } = await makeManager();
    const command = 'echo once';
    const approval = { project_id: projectId, command, working_directory: projectRoot };
    const first = await manager.start({ projectId, command, requestId, approval });
    await expect(manager.start({ projectId, command, requestId, approval })).resolves.toMatchObject({ id: first.id });
    expect(() => manager.stop('550e8400-e29b-41d4-a716-446655440002', first.id)).toThrow(/not found/i);
    expect(launch).toHaveBeenCalledOnce();
  });

  it('stops only the requested session and waits for confirmed process closure', async () => {
    const { manager, child } = await makeManager();
    const command = 'long task';
    const session = await manager.start({ projectId, command, requestId, approval: { project_id: projectId, command, working_directory: projectRoot } });
    expect(manager.stop(projectId, session.id)).toMatchObject({ accepted: true, status: 'running' });
    expect(child.killedWith).toContain('SIGTERM');
    await Promise.resolve();
    expect(manager.list(projectId)[0].status).toBe('terminated');
  });

  it('enforces concurrency and marks timed out commands only after process closure', async () => {
    const { manager } = await makeManager({ limits: { timeoutMs: 15, maxConcurrent: 1, maxOutputBytes: 64 } });
    const command = 'long task';
    const approval = { project_id: projectId, command, working_directory: projectRoot };
    const session = await manager.start({ projectId, command, requestId, approval });
    await expect(manager.start({ projectId, command: 'another task', requestId: '550e8400-e29b-41d4-a716-446655440003',
      approval: { project_id: projectId, command: 'another task', working_directory: projectRoot } })).rejects.toThrow(/up to 1 running/i);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(manager.list(projectId).find((item) => item.id === session.id).status).toBe('timed_out');
  });

  it('records spawn errors as failed sessions and removes active work from the limit', async () => {
    const { manager } = await makeManager({ spawnImpl: () => {
      const child = new FakeChild();
      queueMicrotask(() => child.emit('error', new Error('spawn failed')));
      return child;
    } });
    const command = 'missing command';
    const session = await manager.start({ projectId, command, requestId, approval: { project_id: projectId, command, working_directory: projectRoot } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(manager.list(projectId).find((item) => item.id === session.id).status).toBe('failed');
  });

  it('applies conservative and bounded environment settings', () => {
    expect(terminalLimits({ BUILDX_TERMINAL_TIMEOUT_MS: '2000', BUILDX_TERMINAL_MAX_CONCURRENCY: '3', BUILDX_TERMINAL_MAX_OUTPUT_BYTES: '32000' }))
      .toEqual({ timeoutMs: 2000, maxConcurrent: 3, maxOutputBytes: 32000 });
    expect(terminalLimits({ BUILDX_TERMINAL_TIMEOUT_MS: '10', BUILDX_TERMINAL_MAX_CONCURRENCY: '99' }))
      .toEqual({ timeoutMs: 300000, maxConcurrent: 2, maxOutputBytes: 512 * 1024 });
  });
});
