const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isProject(value) {
  return value && typeof value === 'object'
    && typeof value.id === 'string' && PROJECT_ID_PATTERN.test(value.id)
    && typeof value.name === 'string'
    && (value.description === null || typeof value.description === 'string')
    && (value.root_path === null || typeof value.root_path === 'string')
    && (value.project_type === null || typeof value.project_type === 'string')
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))
    && typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at));
}

function createProjectApi({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1' }) {
  async function request(path, { method = 'GET', body } = {}) {
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The project service is unavailable. Restart BUILDX and try again.');

    let response;
    try {
      response = await fetchImpl(new URL(`${apiPrefix}${path}`, baseUrl), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('The project service could not be reached. Restart BUILDX and retry.');
    }

    if (response.status === 204) return null;
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('The project service returned an invalid response.');
    }
    if (!response.ok) {
      const message = result?.error?.message;
      throw new Error(typeof message === 'string' ? message : 'The project request failed.');
    }
    return result;
  }

  async function checkedProject(path, options) {
    const result = await request(path, options);
    if (!isProject(result)) throw new Error('The project service returned an invalid project.');
    return result;
  }

  return Object.freeze({
    async listProjects() {
      const result = await request('/projects');
      if (!Array.isArray(result) || !result.every(isProject)) {
        throw new Error('The project service returned an invalid project list.');
      }
      return result;
    },
    getProject: (id) => checkedProject(`/projects/${encodeURIComponent(id)}`),
    createProject: (payload) => checkedProject('/projects', { method: 'POST', body: payload }),
    updateProject: (id, payload) => checkedProject(`/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: payload,
    }),
    deleteProject: (id) => request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  });
}

module.exports = { createProjectApi, isProject };
