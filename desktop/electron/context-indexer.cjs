const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_FILES = 8;
const MAX_BATCH_BYTES = 7 * 1024 * 1024;

function createContextIndexer({ workspaceFiles, projectApi, contextApi, schedule = setImmediate, logger = console }) {
  const running = new Set();

  async function existingFiles(projectId) {
    const files = [];
    let offset = 0;
    while (true) {
      const page = await contextApi.listIndexedFiles(projectId, { offset, limit: 200 });
      files.push(...page.files);
      offset += page.files.length;
      if (offset >= page.total || page.files.length === 0) break;
    }
    return files;
  }

  async function refresh(projectId) {
    if (typeof projectId !== 'string' || !ID_PATTERN.test(projectId)) {
      throw new TypeError('A valid project identifier is required.');
    }
    if (running.has(projectId)) {
      return { accepted: false, status: await contextApi.getIndexStatus(projectId) };
    }
    running.add(projectId);
    try {
      const previousFiles = await existingFiles(projectId);
      // This checks the native-picker authorization and canonical root before the job is persisted.
      const scanner = await workspaceFiles.discoverIndexableFiles(projectApi, projectId, previousFiles);
      const started = await contextApi.startIndex(projectId);
      schedule(() => {
        runRefresh(projectId, scanner).catch(async (error) => {
          logger.error('Project context refresh failed', { projectId, code: error?.code || 'INDEX_ERROR' });
          try { await contextApi.failIndex(projectId, 'Indexing stopped unexpectedly. Refresh the index to try again.'); }
          catch { /* The local database may be unavailable; keep the failure log free of file content. */ }
        }).finally(() => running.delete(projectId));
      });
      return { accepted: true, status: started };
    } catch (error) {
      running.delete(projectId);
      throw error;
    }
  }

  async function runRefresh(projectId, scanner) {
    const eligiblePaths = [];
    const failedPaths = new Set();
    const errors = [];
    let batch = [];
    let lastProgress = Date.now();

    async function reportProgress() {
      const summary = scanner.summary();
      try {
        await contextApi.reportIndexProgress(projectId, {
          discovered_count: summary.discoveredCount,
          processed_count: summary.processedCount,
          skipped_count: summary.skippedCount,
          skip_reasons: summary.skipReasons,
          errors: [...summary.errors, ...errors].slice(0, 100),
        });
      } catch {
        // Progress is advisory; the next file upload or final status update can still complete the job.
      }
      lastProgress = Date.now();
    }

    async function flush() {
      if (!batch.length) return;
      const current = batch;
      batch = [];
      let group = [];
      for (const file of current) {
        const candidate = [...group, file];
        if (group.length && (candidate.length > BATCH_FILES || Buffer.byteLength(JSON.stringify({ files: candidate })) > MAX_BATCH_BYTES)) {
          await uploadGroup(group);
          group = [];
        }
        group.push(file);
      }
      if (group.length) await uploadGroup(group);
      await reportProgress();
    }

    async function uploadGroup(files) {
      try {
        await contextApi.uploadIndexFiles(projectId, files);
      } catch {
        for (const file of files) {
          failedPaths.add(file.relative_path);
          if (errors.length < 100) errors.push({ path: file.relative_path, message: 'The local index could not save this file.' });
        }
      }
    }

    let eventCount = 0;
    for await (const item of scanner.iterate()) {
      eventCount += 1;
      if (item.type === 'file') {
        eligiblePaths.push(item.file.relative_path);
        batch.push(item.file);
        if (batch.length >= BATCH_FILES) await flush();
      }
      if (eventCount % 50 === 0 || Date.now() - lastProgress > 2000) await reportProgress();
    }
    await flush();

    const summary = scanner.summary();
    for (const path of summary.preservePaths) failedPaths.add(path);
    for (const error of errors) if (error.path) failedPaths.add(error.path);
    await contextApi.completeIndex(projectId, {
      eligible_paths: eligiblePaths,
      failed_paths: [...failedPaths],
      discovered_count: summary.discoveredCount,
      processed_count: summary.processedCount,
      skipped_count: summary.skippedCount,
      skip_reasons: summary.skipReasons,
      errors: [...summary.errors, ...errors].slice(0, 100),
      incomplete: summary.incomplete,
    });
  }

  return Object.freeze({ refresh, isRunning: (projectId) => running.has(projectId) });
}

module.exports = { BATCH_FILES, MAX_BATCH_BYTES, createContextIndexer };
