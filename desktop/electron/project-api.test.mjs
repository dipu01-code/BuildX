import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createProjectApi } = require('./project-api.cjs');

const project = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Atlas',
  description: null,
  root_path: null,
  project_type: null,
  created_at: '2026-10-25T10:00:00Z',
  updated_at: '2026-10-25T10:00:00Z',
};

describe('main-process project API client', () => {
  it('uses the loopback API URL and validates list payloads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [project] });
    const api = createProjectApi({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl });

    await expect(api.listProjects()).resolves.toEqual([project]);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      new URL('http://127.0.0.1:54321/api/v1/projects'), expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns safe service errors and rejects malformed responses', async () => {
    const offline = createProjectApi({ getBaseUrl: () => null });
    await expect(offline.listProjects()).rejects.toThrow(/service is unavailable/i);

    const malformed = createProjectApi({ getBaseUrl: () => 'http://127.0.0.1:54321',
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [] }) }) });
    await expect(malformed.listProjects()).rejects.toThrow(/invalid project list/i);
  });

  it('uses API validation errors without allowing arbitrary endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422,
      json: async () => ({ error: { message: 'The request is invalid' } }) });
    const api = createProjectApi({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl });
    await expect(api.createProject({ name: '   ' })).rejects.toThrow('The request is invalid');
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/v1/projects');
  });
});
