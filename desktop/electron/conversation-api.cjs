const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`A valid ${label} is required.`);
}

function isSource(value) {
  return Boolean(value && typeof value.relative_path === 'string' && value.relative_path.length <= 2048
    && !value.relative_path.startsWith('/') && !value.relative_path.includes('\\')
    && !value.relative_path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))
    && Number.isInteger(value.start_line) && value.start_line >= 1
    && Number.isInteger(value.end_line) && value.end_line >= value.start_line);
}

function isMessage(value) {
  return Boolean(value && typeof value.id === 'string' && ID_PATTERN.test(value.id)
    && (value.request_id === null || value.request_id === undefined || ID_PATTERN.test(value.request_id))
    && ['user', 'assistant'].includes(value.role) && typeof value.content === 'string'
    && value.content.length <= 16_000 && ['pending', 'complete', 'failed', 'interrupted'].includes(value.status)
    && Array.isArray(value.sources) && value.sources.length <= 5 && value.sources.every(isSource)
    && (value.error_message === null || typeof value.error_message === 'string')
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at)));
}

function isConversation(value) {
  return Boolean(value && typeof value.id === 'string' && ID_PATTERN.test(value.id)
    && typeof value.project_id === 'string' && ID_PATTERN.test(value.project_id)
    && typeof value.title === 'string' && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string' && Array.isArray(value.messages)
    && value.messages.length <= 100 && value.messages.every(isMessage));
}

function isConversationSummary(value) {
  return Boolean(value && typeof value.id === 'string' && ID_PATTERN.test(value.id)
    && typeof value.project_id === 'string' && ID_PATTERN.test(value.project_id)
    && typeof value.title === 'string' && Number.isInteger(value.message_count));
}

function createConversationApi({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1' }) {
  async function request(projectId, conversationId, suffix, { method = 'GET', body } = {}) {
    validateId(projectId, 'project identifier');
    if (conversationId) validateId(conversationId, 'conversation identifier');
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The assistant service is unavailable. Restart BUILDX and try again.');
    const path = `${apiPrefix}/projects/${encodeURIComponent(projectId)}/conversations`
      + (conversationId ? `/${encodeURIComponent(conversationId)}` : '') + suffix;
    let response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === 'POST' && suffix.endsWith('/messages') ? 75_000 : 15_000),
      });
    } catch {
      throw new Error('BUILDX could not reach the assistant service. Check the connection and retry.');
    }
    if (response.status === 204) return null;
    let result;
    try { result = await response.json(); }
    catch { throw new Error('The assistant service returned an invalid response.'); }
    if (!response.ok) {
      const message = result?.error?.message;
      const error = new Error(typeof message === 'string' ? message : 'The assistant request failed.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function checkedConversation(result) {
    if (!isConversation(result)) throw new Error('The assistant service returned an invalid conversation.');
    return result;
  }

  return Object.freeze({
    async createConversation(projectId) {
      return checkedConversation(await request(projectId, null, '', { method: 'POST', body: { title: 'New conversation' } }));
    },
    async listConversations(projectId, limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('The conversation list limit is invalid.');
      const result = await request(projectId, null, `?limit=${limit}`);
      if (!result || !Array.isArray(result.conversations) || !result.conversations.every(isConversationSummary)) {
        throw new Error('The assistant service returned an invalid conversation list.');
      }
      return result.conversations;
    },
    async getConversation(projectId, conversationId) {
      return checkedConversation(await request(projectId, conversationId, ''));
    },
    async sendMessage(projectId, conversationId, requestId, content) {
      validateId(requestId, 'message request identifier');
      if (typeof content !== 'string' || !content.trim() || content.length > 8000) {
        throw new TypeError('Enter a message of 1 to 8,000 characters.');
      }
      const result = await request(projectId, conversationId, '/messages', {
        method: 'POST', body: { request_id: requestId, content: content.trim() },
      });
      if (!result || !isMessage(result.user_message) || !isMessage(result.assistant_message)) {
        throw new Error('The assistant service returned an invalid message response.');
      }
      return result;
    },
    deleteConversation: (projectId, conversationId) => request(projectId, conversationId, '', { method: 'DELETE' }),
  });
}

module.exports = { createConversationApi, isConversation, isMessage, isSource };
