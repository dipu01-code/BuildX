import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { PROJECT_CHANNELS, registerIpcHandlers } = require('./ipc.cjs');
const APP_INFO_CHANNEL = 'app:get-info';

function makeIpc() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

describe('privileged IPC validation', () => {
  it('validates sender and rejects unexpected arguments before returning app info', async () => {
    const { ipcMain, handlers } = makeIpc();
    const validateSender = vi.fn();
    const getAppInfo = vi.fn(() => ({ name: 'BUILDX' }));
    registerIpcHandlers({ ipcMain, validateSender, getAppInfo,
      listProjects: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn() });

    const handler = handlers.get(APP_INFO_CHANNEL);
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    expect(handler(event)).toEqual({ name: 'BUILDX' });
    expect(validateSender).toHaveBeenCalledExactlyOnceWith(event);

    expect(() => handler(event, 'unexpected')).toThrow(/does not accept arguments/i);
    expect(getAppInfo).toHaveBeenCalledTimes(1);
  });

  it('does not return data when sender validation fails', async () => {
    const { ipcMain, handlers } = makeIpc();
    const getAppInfo = vi.fn();
    registerIpcHandlers({
      ipcMain,
      validateSender: () => { throw new Error('untrusted sender'); },
      getAppInfo,
      listProjects: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
    });

    expect(() => handlers.get(APP_INFO_CHANNEL)({})).toThrow('untrusted sender');
    expect(getAppInfo).not.toHaveBeenCalled();
  });

  it('validates project payloads and identifiers before invoking scoped operations', async () => {
    const { ipcMain, handlers } = makeIpc();
    const createProject = vi.fn().mockResolvedValue({ id: 'id' });
    const getProject = vi.fn();
    registerIpcHandlers({ ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      listProjects: vi.fn(), getProject, createProject, updateProject: vi.fn(), deleteProject: vi.fn() });
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    const id = '550e8400-e29b-41d4-a716-446655440000';

    await handlers.get(PROJECT_CHANNELS.create)(event, { name: 'Atlas', description: null });
    expect(createProject).toHaveBeenCalledExactlyOnceWith({ name: 'Atlas', description: null });
    expect(() => handlers.get(PROJECT_CHANNELS.create)(event, { name: 'Atlas', root_path: '/outside' }))
      .toThrow(/unsupported project field/i);
    expect(() => handlers.get(PROJECT_CHANNELS.get)(event, '../etc/passwd')).toThrow(/identifier/i);
    expect(getProject).not.toHaveBeenCalled();
    await handlers.get(PROJECT_CHANNELS.get)(event, id);
    expect(getProject).toHaveBeenCalledExactlyOnceWith(id);
  });
});
