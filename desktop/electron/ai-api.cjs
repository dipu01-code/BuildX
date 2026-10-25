const ERROR_MESSAGES = Object.freeze({
  configuration_error: 'Add BUILDX_OPENAI_API_KEY to the backend environment, then restart BUILDX.',
  authentication_error: 'The provider rejected the configured credential. Check BUILDX_OPENAI_API_KEY.',
  rate_limited: 'The provider rate limit was reached. Wait a moment before retrying.',
  timeout: 'The provider did not respond before the connection test timed out.',
  network_error: 'BUILDX could not reach the AI provider. Check your network connection.',
  malformed_response: 'The provider returned an unexpected response. Try again later.',
  provider_error: 'The provider could not complete the connection test. Try again later.',
});
const CONNECTION_STATUSES = new Set(['not_tested', 'missing_credentials']);

function createAIAPI({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1', timeoutMs = 15000 }) {
  async function request(path, { timeout = false, method = 'GET' } = {}) {
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The local AI service is unavailable. Restart BUILDX and retry.');

    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      let response;
      try {
        response = await fetchImpl(new URL(`${apiPrefix}${path}`, baseUrl), { method, signal: controller.signal });
      } catch {
        throw new Error(controller.signal.aborted
          ? 'The AI connection test timed out. Retry the test.'
          : 'The local AI service could not be reached. Restart BUILDX and retry.');
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error('The AI service returned an invalid response.');
      }
      if (!response.ok) throw new Error('The AI service could not complete this request. Retry it.');
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return Object.freeze({
    async getAIStatus() {
      const result = await request('/ai/status');
      if (!result || typeof result !== 'object'
        || typeof result.provider_configured !== 'boolean'
        || typeof result.credential_available !== 'boolean'
        || result.provider_id !== 'openai'
        || typeof result.model_id !== 'string'
        || !CONNECTION_STATUSES.has(result.connection_status)) {
        throw new Error('The AI service returned invalid configuration status.');
      }
      return {
        provider_configured: result.provider_configured,
        provider_id: result.provider_id,
        model_id: result.model_id,
        credential_available: result.credential_available,
        connection_status: result.connection_status,
      };
    },
    async testAIConnection() {
      const result = await request('/ai/test-connection', { method: 'POST', timeout: true });
      if (!result || typeof result !== 'object' || typeof result.success !== 'boolean'
        || result.provider_id !== 'openai' || typeof result.model_id !== 'string') {
        throw new Error('The AI service returned an invalid connection result.');
      }
      if (result.success) {
        if (typeof result.response_text !== 'string' || !result.response_text.trim()
          || !Number.isInteger(result.duration_ms) || result.duration_ms < 0) {
          throw new Error('The AI service returned an invalid connection result.');
        }
        return {
          success: true,
          provider_id: result.provider_id,
          model_id: result.model_id,
          response_text: result.response_text,
          duration_ms: result.duration_ms,
        };
      }
      const category = typeof result.error_category === 'string' ? result.error_category : '';
      return {
        success: false,
        provider_id: result.provider_id,
        model_id: result.model_id,
        error_category: ERROR_MESSAGES[category] ? category : 'provider_error',
        message: ERROR_MESSAGES[category] || ERROR_MESSAGES.provider_error,
      };
    },
  });
}

module.exports = { createAIAPI };
