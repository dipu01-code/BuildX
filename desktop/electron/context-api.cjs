const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateProjectId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError('A valid project identifier is required.');
}

function isRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048
    && !value.includes('\\') && !value.startsWith('/') && !/^[a-z]:/i.test(value)
    && !value.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'));
}

function isIndexStatus(value) {
  return Boolean(value && typeof value === 'object' && ID_PATTERN.test(value.project_id)
    && ['not_indexed', 'indexing', 'up_to_date', 'partial', 'failed'].includes(value.state)
    && Number.isInteger(value.discovered_count) && Number.isInteger(value.processed_count)
    && Number.isInteger(value.indexed_file_count) && Number.isInteger(value.chunk_count)
    && Array.isArray(value.errors));
}

function isFilePage(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.files)
    && Number.isInteger(value.total) && value.files.every((file) => isRelativePath(file.relative_path)
      && /^[0-9a-f]{64}$/.test(file.content_hash) && Number.isInteger(file.file_size)
      && Number.isInteger(file.modified_at_ms)));
}

function createContextApi({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1' }) {
  async function request(projectId, suffix, { method = 'GET', body } = {}) {
    validateProjectId(projectId);
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The context service is unavailable. Restart BUILDX and try again.');
    let response;
    try {
      response = await fetchImpl(new URL(`${apiPrefix}/projects/${encodeURIComponent(projectId)}/context${suffix}`, baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === 'GET' ? 15000 : 45000),
      });
    } catch {
      throw new Error('BUILDX could not reach the local context service. Restart the app and retry.');
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('The context service returned an invalid response.'); }
    if (!response.ok) {
      const message = result?.error?.message;
      throw new Error(typeof message === 'string' ? message : 'The context request failed.');
    }
    return result;
  }

  async function checkedStatus(projectId, suffix, options) {
    const result = await request(projectId, suffix, options);
    if (!isIndexStatus(result)) throw new Error('The context service returned an invalid index status.');
    return result;
  }

  return Object.freeze({
    startIndex: async (projectId) => {
      const result = await request(projectId, '/index/refresh', { method: 'POST', body: {} });
      if (result?.state !== 'indexing' || result.project_id !== projectId) throw new Error('The context service could not start indexing.');
      return result;
    },
    uploadIndexFiles: async (projectId, files) => checkedStatus(projectId, '/index/files', { method: 'PUT', body: { files } }),
    reportIndexProgress: async (projectId, progress) => checkedStatus(projectId, '/index/progress', { method: 'PATCH', body: progress }),
    completeIndex: async (projectId, payload) => checkedStatus(projectId, '/index/complete', { method: 'POST', body: payload }),
    failIndex: async (projectId, message) => checkedStatus(projectId, '/index/fail', { method: 'POST', body: { message } }),
    getIndexStatus: async (projectId) => checkedStatus(projectId, '/status'),
    async listIndexedFiles(projectId, { offset = 0, limit = 200 } = {}) {
      const result = await request(projectId, `/files?offset=${offset}&limit=${limit}`);
      if (!isFilePage(result)) throw new Error('The context service returned an invalid file list.');
      return result;
    },
    async searchProjectContext(projectId, query, limit = 8) {
      const result = await request(projectId, `/search?q=${encodeURIComponent(query)}&limit=${limit}`);
      if (!result || !Array.isArray(result.results) || !Number.isInteger(result.total)
        || !result.results.every((item) => isRelativePath(item.relative_path)
          && Number.isInteger(item.start_line) && Number.isInteger(item.end_line)
          && typeof item.excerpt === 'string' && typeof item.score === 'number')) {
        throw new Error('The context service returned invalid search results.');
      }
      return result;
    },
    async getIndexedFileChunks(projectId, relativePath) {
      if (!isRelativePath(relativePath)) throw new TypeError('A valid project-relative path is required.');
      const result = await request(projectId, `/files/chunks?relative_path=${encodeURIComponent(relativePath)}`);
      if (!Array.isArray(result)) throw new Error('The context service returned invalid file chunks.');
      return result;
    },
  });
}

module.exports = { createContextApi, isFilePage, isIndexStatus, isRelativePath };
