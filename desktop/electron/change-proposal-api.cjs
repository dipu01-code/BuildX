const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function validateId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`A valid ${label} is required.`);
}

function isProposal(value) {
  return Boolean(value && ID_PATTERN.test(value.id) && ID_PATTERN.test(value.project_id)
    && (value.conversation_id == null || ID_PATTERN.test(value.conversation_id))
    && typeof value.summary === 'string' && value.summary.length <= 1200
    && ['pending_review', 'approved', 'applying', 'applied', 'rejected', 'conflicted', 'failed'].includes(value.status)
    && value.operation && ['create', 'modify'].includes(value.operation.operation)
    && typeof value.operation.relative_path === 'string' && value.operation.relative_path.length <= 2048
    && typeof value.operation.proposed_content === 'string' && value.operation.proposed_content.length <= 1_000_000
    && (value.operation.original_hash === null || HASH_PATTERN.test(value.operation.original_hash)));
}

function createChangeProposalApi({ getBaseUrl, fetchImpl = fetch, apiPrefix = '/api/v1' }) {
  async function request(path, { method = 'GET', body } = {}) {
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('The change proposal service is unavailable.');
    let response;
    try {
      response = await fetchImpl(new URL(`${apiPrefix}${path}`, baseUrl), {
        method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(method === 'POST' ? 75_000 : 15_000),
      });
    } catch { throw new Error('BUILDX could not reach the local proposal service.'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('The proposal service returned an invalid response.'); }
    if (!response.ok) throw new Error(typeof result?.error?.message === 'string' ? result.error.message : 'The proposal request failed.');
    return result;
  }
  function checked(result) {
    if (!isProposal(result)) throw new Error('The proposal service returned invalid change data.');
    return result;
  }
  return Object.freeze({
    async generateProposal(projectId, payload) {
      validateId(projectId, 'project identifier');
      if (!payload || typeof payload.request !== 'string' || payload.request.length > 4000
        || typeof payload.relative_path !== 'string' || payload.relative_path.length > 2048) throw new TypeError('The change proposal request is invalid.');
      return checked(await request(`/projects/${encodeURIComponent(projectId)}/change-proposals`, { method: 'POST', body: payload }));
    },
    async listProposals(projectId) {
      validateId(projectId, 'project identifier');
      const result = await request(`/projects/${encodeURIComponent(projectId)}/change-proposals`);
      if (!Array.isArray(result?.proposals) || !result.proposals.every(isProposal)) throw new Error('The proposal list is invalid.');
      return result.proposals;
    },
    async getProposal(projectId, proposalId) { validateId(projectId, 'project identifier'); validateId(proposalId, 'proposal identifier'); const result = checked(await request(`/change-proposals/${encodeURIComponent(proposalId)}`)); if (result.project_id !== projectId) throw new Error('The proposal belongs to a different project.'); return result; },
    async approveProposal(projectId, proposalId) { validateId(projectId, 'project identifier'); validateId(proposalId, 'proposal identifier'); const result = checked(await request(`/change-proposals/${encodeURIComponent(proposalId)}/approve`, { method: 'POST' })); if (result.project_id !== projectId) throw new Error('The proposal belongs to a different project.'); return result; },
    async rejectProposal(projectId, proposalId) { validateId(projectId, 'project identifier'); validateId(proposalId, 'proposal identifier'); const result = checked(await request(`/change-proposals/${encodeURIComponent(proposalId)}/reject`, { method: 'POST' })); if (result.project_id !== projectId) throw new Error('The proposal belongs to a different project.'); return result; },
    async recordProposalOutcome(projectId, proposalId, outcome) { validateId(projectId, 'project identifier'); validateId(proposalId, 'proposal identifier'); const result = checked(await request(`/change-proposals/${encodeURIComponent(proposalId)}/apply`, { method: 'POST', body: outcome })); if (result.project_id !== projectId) throw new Error('The proposal belongs to a different project.'); return result; },
  });
}

module.exports = { createChangeProposalApi, isProposal };
