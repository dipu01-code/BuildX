import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { registerIpcHandlers } = require('./ipc.cjs');
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
    registerIpcHandlers({ ipcMain, validateSender, getAppInfo });

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
    });

    expect(() => handlers.get(APP_INFO_CHANNEL)({})).toThrow('untrusted sender');
    expect(getAppInfo).not.toHaveBeenCalled();
  });
});
