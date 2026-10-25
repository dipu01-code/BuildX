const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`A valid ${label} is required.`);
}

function isPlan(value) {
  return Boolean(value && typeof value === 'object'
    && typeof value.project_title === 'string'
    && typeof value.problem_statement === 'string'
    && Array.isArray(value.intended_users)
    && Array.isArray(value.main_objectives)
    && Array.isArray(value.assumptions)
    && Array.isArray(value.out_of_scope)
    && Array.isArray(value.requirements)
    && Array.isArray(value.milestones)
    && value.recommendations && typeof value.recommendations === 'object');
}

function isSavedPlan(value) {
  return Boolean(value && typeof value === 'object'
    && typeof value.id === 'string' && ID_PATTERN.test(value.id)
    && typeof value.project_id === 'string' && ID_PATTERN.test(value.project_id)
    && isPlan(value.plan)
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))
    && typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at)));
}

function createPlannerApi({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1' }) {
  async function request(projectId, suffix = '', { method = 'GET', body } = {}) {
    validateId(projectId, 'project identifier');
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The project service is unavailable. Restart BUILDX and try again.');
    let response;
    try {
      response = await fetchImpl(new URL(`${apiPrefix}/projects/${encodeURIComponent(projectId)}/plans${suffix}`, baseUrl), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: method === 'POST' && suffix === '/generate' ? AbortSignal.timeout(60000) : undefined,
      });
    } catch {
      throw new Error('BUILDX could not reach the planning service. Check the connection and retry.');
    }
    if (response.status === 204) return null;
    let result;
    try { result = await response.json(); } catch { throw new Error('The planning service returned an invalid response.'); }
    if (!response.ok) {
      const message = result?.error?.message;
      const details = Array.isArray(result?.error?.details)
        ? result.error.details.slice(0, 4).map((detail) => {
          const path = Array.isArray(detail.location) ? detail.location.filter((part) => part !== 'body').join('.') : '';
          return [path, detail.message].filter((part) => typeof part === 'string' && part).join(': ');
        }).filter(Boolean)
        : [];
      const safeDetails = details.length ? ` ${details.join(' ')}` : '';
      throw new Error(`${typeof message === 'string' ? message : 'The planning request failed.'}${safeDetails}`);
    }
    return result;
  }

  function checkedSaved(value) {
    if (!isSavedPlan(value)) throw new Error('The planning service returned an invalid saved plan.');
    return value;
  }

  return Object.freeze({
    async generatePlan(projectId, payload) {
      const result = await request(projectId, '/generate', { method: 'POST', body: payload });
      if (!isPlan(result)) throw new Error('The planning service returned an invalid draft.');
      return result;
    },
    async listPlans(projectId) {
      const result = await request(projectId);
      if (!Array.isArray(result) || !result.every(isSavedPlan)) throw new Error('The planning service returned an invalid plan list.');
      return result;
    },
    async getPlan(projectId, planId) {
      validateId(planId, 'plan identifier');
      return checkedSaved(await request(projectId, `/${encodeURIComponent(planId)}`));
    },
    async savePlan(projectId, plan) {
      return checkedSaved(await request(projectId, '', { method: 'POST', body: { plan } }));
    },
    async updatePlan(projectId, planId, plan) {
      validateId(planId, 'plan identifier');
      return checkedSaved(await request(projectId, `/${encodeURIComponent(planId)}`, { method: 'PATCH', body: plan }));
    },
    async deletePlan(projectId, planId) {
      validateId(planId, 'plan identifier');
      return request(projectId, `/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    },
  });
}

module.exports = { createPlannerApi, isPlan, isSavedPlan };
