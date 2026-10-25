import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAIAPI } = require('./ai-api.cjs');

const configuredStatus = {
  provider_configured: true,
  provider_id: 'openai',
  model_id: 'gpt-5.4-mini',
  credential_available: true,
  connection_status: 'not_tested',
};

describe('main-process AI API client', () => {
  it('retrieves only validated safe provider status fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ...configuredStatus, api_key: 'sk-never-return-this', reachable: true,
    }) });
    const api = createAIAPI({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl });

    await expect(api.getAIStatus()).resolves.toEqual(configuredStatus);
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/v1/ai/status');
  });

  it('maps provider errors to local sanitized messages and drops response details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      success: false, provider_id: 'openai', model_id: 'gpt-5.4-mini',
      error_category: 'authentication_error', message: 'Authorization: sk-secret', body: 'sensitive',
    }) });
    const api = createAIAPI({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl });

    await expect(api.testAIConnection()).resolves.toEqual({
      success: false,
      provider_id: 'openai',
      model_id: 'gpt-5.4-mini',
      error_category: 'authentication_error',
      message: 'The provider rejected the configured credential. Check BUILDX_OPENAI_API_KEY.',
    });
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/v1/ai/test-connection');
    expect(fetchImpl.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });

  it('does not report local backend failures as successful provider connections', async () => {
    const offline = createAIAPI({ getBaseUrl: () => null });
    await expect(offline.testAIConnection()).rejects.toThrow(/local ai service is unavailable/i);

    const invalid = createAIAPI({ getBaseUrl: () => 'http://127.0.0.1:54321',
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, provider_id: 'openai' }) }) });
    await expect(invalid.testAIConnection()).rejects.toThrow(/invalid connection result/i);
  });
});
