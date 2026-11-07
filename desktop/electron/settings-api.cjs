const SETTINGS_HEALTH_STATUSES = new Set([
  'healthy',
  'degraded',
  'unavailable',
  'not_configured',
  'unknown',
]);
const SETTINGS_SECTIONS = new Set([
  'general',
  'appearance',
  'editor',
  'ai_provider',
  'terminal',
  'project_context',
  'privacy',
]);

function createSettingsAPI({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1', timeoutMs = 15000 }) {
  async function request(path, { method = 'GET', body = undefined, timeout = false } = {}) {
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The local backend service is unavailable. Restart BUILDX and retry.');

    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      let response;
      try {
        const init = { method, signal: controller.signal, headers: { 'Content-Type': 'application/json' } };
        if (body !== undefined) init.body = JSON.stringify(body);
        response = await fetchImpl(new URL(`${apiPrefix}${path}`, baseUrl), init);
      } catch {
        throw new Error(controller.signal.aborted
          ? 'The settings request timed out. Retry it.'
          : 'The local backend could not be reached. Restart BUILDX and retry.');
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error('The backend returned an invalid response.');
      }
      if (!response.ok) {
        const detail = result && result.error && result.error.message ? result.error.message : '';
        throw new Error(detail || 'The backend could not complete this request. Retry it.');
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function validateSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The backend returned invalid settings.');
    }
    const version = value.version;
    if (version !== 1 && version !== undefined && version !== null) {
      throw new Error('The backend returned unsupported settings.');
    }
    return value;
  }

  return Object.freeze({
    async getSettings() {
      const result = await request('/settings');
      return validateSettings(result);
    },
    async patchSettings(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('Settings patch data must be an object.');
      }
      const sections = Object.keys(patch).filter((key) => SETTINGS_SECTIONS.has(key));
      if (sections.length === 0) {
        throw new Error('At least one settings section must be provided.');
      }
      const result = await request('/settings', { method: 'PATCH', body: patch });
      return validateSettings(result);
    },
    async resetSettings() {
      const result = await request('/settings/reset', { method: 'POST' });
      return validateSettings(result);
    },
    async getSettingsHealth() {
      const result = await request('/settings/health', { timeout: true });
      if (!result || typeof result !== 'object' || typeof result.overall !== 'string'
        || !SETTINGS_HEALTH_STATUSES.has(result.overall)
        || !Array.isArray(result.components)) {
        throw new Error('The backend returned invalid health status.');
      }
      for (const component of result.components) {
        if (!component || typeof component !== 'object'
          || typeof component.name !== 'string'
          || typeof component.status !== 'string'
          || !SETTINGS_HEALTH_STATUSES.has(component.status)
          || typeof component.message !== 'string') {
          throw new Error('The backend returned an invalid health component.');
        }
      }
      return result;
    },
  });
}

module.exports = { createSettingsAPI };
