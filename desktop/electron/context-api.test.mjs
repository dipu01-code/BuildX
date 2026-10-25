import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createContextApi, isRelativePath } = require('./context-api.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';
const status = {
  project_id: projectId, state: 'indexing', discovered_count: 2, processed_count: 1,
  skipped_count: 0, indexed_file_count: 1, chunk_count: 1, errors: [],
};

function response(value, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => value };
}

describe('local project context API client', () => {
  it('uses only project-scoped local endpoints and validates bounded response shapes', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ project_id: projectId, state: 'indexing', started_at: '2026-10-25T10:00:00Z' }))
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response({
        query: 'route', total: 1, results: [{ relative_path: 'backend/app.py', start_line: 4, end_line: 5, excerpt: 'local route', score: 2.5 }],
      }));
    const api = createContextApi({ getBaseUrl: () => 'http://127.0.0.1:53123', fetchImpl });
    await expect(api.startIndex(projectId)).resolves.toMatchObject({ state: 'indexing' });
    await expect(api.reportIndexProgress(projectId, {
      discovered_count: 2, processed_count: 1, skipped_count: 0, skip_reasons: {}, errors: [],
    })).resolves.toMatchObject({ state: 'indexing' });
    await expect(api.searchProjectContext(projectId, 'route', 3)).resolves.toMatchObject({ total: 1 });
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(['127.0.0.1', '127.0.0.1', '127.0.0.1']);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(isRelativePath('../outside')).toBe(false);
    expect(isRelativePath('/Users/dipu/project/file')).toBe(false);
    expect(isRelativePath('src/main.py')).toBe(true);
  });

  it('rejects malformed project ids before making a request and surfaces API errors safely', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: { message: 'The request is invalid' } }, false));
    const api = createContextApi({ getBaseUrl: () => 'http://127.0.0.1:53123', fetchImpl });
    await expect(api.getIndexStatus('../outside')).rejects.toThrow(/project identifier/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(api.getIndexStatus(projectId)).rejects.toThrow('The request is invalid');
  });
});
