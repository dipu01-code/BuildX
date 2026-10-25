import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createPlannerApi } = require('./planner-api.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';
const savedPlan = { id: projectId, project_id: projectId, plan: {
  project_title: 'Example', problem_statement: 'Problem', intended_users: [], main_objectives: [],
  assumptions: [], out_of_scope: [], requirements: [], milestones: [], recommendations: {},
}, created_at: '2026-10-25T10:00:00Z', updated_at: '2026-10-25T10:00:00Z' };

describe('main-process planner API client', () => {
  it('uses project scoped paths and validates plan responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [savedPlan] });
    const api = createPlannerApi({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl });
    await expect(api.listPlans(projectId)).resolves.toEqual([savedPlan]);
    expect(fetchImpl.mock.calls[0][0].pathname).toBe(`/api/v1/projects/${projectId}/plans`);
  });

  it('reports backend validation and provider errors without hiding safe messages', async () => {
    const api = createPlannerApi({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl: vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: { code: 'AI_PROVIDER_UNCONFIGURED', message: 'Configure the provider.' } }),
    }) });
    await expect(api.generatePlan(projectId, { project_brief: 'Brief' })).rejects.toThrow('Configure the provider.');
  });

  it('rejects malformed project and plan identifiers before making a request', async () => {
    const fetchImpl = vi.fn();
    const api = createPlannerApi({ getBaseUrl: () => 'http://127.0.0.1:54321', fetchImpl });
    await expect(api.listPlans('../outside')).rejects.toThrow(/project identifier/i);
    await expect(api.getPlan(projectId, '../outside')).rejects.toThrow(/plan identifier/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
