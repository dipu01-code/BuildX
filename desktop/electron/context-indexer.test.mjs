import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createContextIndexer } = require('./context-indexer.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';

function createScanner(fileCount = 9) {
  const summary = {
    discoveredCount: fileCount + 1, processedCount: fileCount, skippedCount: 1,
    skipReasons: { gitignore: 1 }, errors: [], preservePaths: [], incomplete: false,
  };
  return {
    summary: () => summary,
    async *iterate() {
      for (let index = 0; index < fileCount; index += 1) {
        const content = `context ${index}`;
        yield { type: 'file', file: {
          relative_path: `src/${index}.txt`, content_hash: String(index).padStart(64, '0'),
          file_size: content.length, modified_at_ms: 1000, content,
        } };
      }
      yield { type: 'skip', reason: 'gitignore', path: '.gitignore' };
    },
  };
}

describe('background project context indexer', () => {
  it('starts once, uploads in bounded batches, and completes with relative paths', async () => {
    const scheduled = [];
    let complete;
    const completed = new Promise((resolve) => { complete = resolve; });
    const contextApi = {
      listIndexedFiles: vi.fn().mockResolvedValue({ files: [], total: 0 }),
      startIndex: vi.fn().mockResolvedValue({ project_id: projectId, state: 'indexing' }),
      getIndexStatus: vi.fn().mockResolvedValue({ state: 'indexing' }),
      uploadIndexFiles: vi.fn().mockResolvedValue({ state: 'indexing' }),
      reportIndexProgress: vi.fn().mockResolvedValue({ state: 'indexing' }),
      completeIndex: vi.fn().mockImplementation(async (_id, payload) => { complete(payload); return { state: 'up_to_date' }; }),
      failIndex: vi.fn(),
    };
    const workspaceFiles = {
      discoverIndexableFiles: vi.fn().mockResolvedValue(createScanner()),
    };
    const indexer = createContextIndexer({
      workspaceFiles, projectApi: {}, contextApi, schedule: (callback) => scheduled.push(callback), logger: { error: vi.fn() },
    });
    const accepted = await indexer.refresh(projectId);
    expect(accepted.accepted).toBe(true);
    expect(indexer.isRunning(projectId)).toBe(true);
    expect(scheduled).toHaveLength(1);
    expect(contextApi.startIndex).toHaveBeenCalledOnce();

    const duplicate = await indexer.refresh(projectId);
    expect(duplicate.accepted).toBe(false);
    expect(contextApi.startIndex).toHaveBeenCalledOnce();

    scheduled[0]();
    const finalPayload = await completed;
    expect(contextApi.uploadIndexFiles).toHaveBeenCalledTimes(2);
    expect(contextApi.uploadIndexFiles.mock.calls.map(([, files]) => files.length)).toEqual([8, 1]);
    expect(finalPayload.eligible_paths).toHaveLength(9);
    expect(finalPayload.failed_paths).toEqual([]);
    expect(finalPayload.skip_reasons).toEqual({ gitignore: 1 });
    await vi.waitFor(() => expect(indexer.isRunning(projectId)).toBe(false));
  });

  it('does not start a refresh before folder authorization is confirmed', async () => {
    const contextApi = {
      listIndexedFiles: vi.fn().mockResolvedValue({ files: [], total: 0 }),
      startIndex: vi.fn(),
    };
    const indexer = createContextIndexer({
      workspaceFiles: { discoverIndexableFiles: vi.fn().mockRejectedValue(new Error('Confirm the folder first.')) },
      projectApi: {}, contextApi,
    });
    await expect(indexer.refresh(projectId)).rejects.toThrow(/confirm the folder/i);
    expect(contextApi.startIndex).not.toHaveBeenCalled();
    expect(indexer.isRunning(projectId)).toBe(false);
  });
});
