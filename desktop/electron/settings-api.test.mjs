import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createSettingsAPI } = require('./settings-api.cjs');

function respond(body, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }));
}

describe('settings bridge', () => {
  it('reads settings from the loopback backend', async () => {
    const fetchImpl = respond({ version: 1, editor: { font_size: 14 } });
    const api = createSettingsAPI({ getBaseUrl: () => 'http://127.0.0.1:9000', fetchImpl });
    await expect(api.getSettings()).resolves.toMatchObject({ editor: { font_size: 14 } });
    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://127.0.0.1:9000/api/v1/settings');
  });

  it('rejects patches without a known section before calling the backend', async () => {
    const fetchImpl = respond({});
    const api = createSettingsAPI({ getBaseUrl: () => 'http://127.0.0.1:9000', fetchImpl });
    await expect(api.patchSettings({ secrets: {} })).rejects.toThrow(/section/);
    await expect(api.patchSettings(null)).rejects.toThrow(/object/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces backend errors, unsupported versions, and a missing backend', async () => {
    const failing = createSettingsAPI({ getBaseUrl: () => 'http://127.0.0.1:9000',
      fetchImpl: respond({ error: { message: 'Invalid settings' } }, false) });
    await expect(failing.patchSettings({ editor: { font_size: 1 } })).rejects.toThrow('Invalid settings');
    const future = createSettingsAPI({ getBaseUrl: () => 'http://127.0.0.1:9000', fetchImpl: respond({ version: 2 }) });
    await expect(future.getSettings()).rejects.toThrow(/unsupported/);
    const offline = createSettingsAPI({ getBaseUrl: () => '', fetchImpl: respond({}) });
    await expect(offline.getSettings()).rejects.toThrow(/unavailable/);
  });

  it('validates the health dashboard shape', async () => {
    const api = createSettingsAPI({ getBaseUrl: () => 'http://127.0.0.1:9000',
      fetchImpl: respond({ overall: 'healthy', components: [{ name: 'db', status: 'bogus', message: '' }] }) });
    await expect(api.getSettingsHealth()).rejects.toThrow(/health component/);
  });
});
