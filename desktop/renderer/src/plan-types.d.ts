export type Priority = 'must' | 'should' | 'could';
export interface PlanRequirement {
  id: string; title: string; description: string; priority: Priority;
  acceptance_criteria: string[]; dependencies: string[];
}
export interface PlanTask {
  id: string; title: string; description: string; rationale: string; priority: Priority;
  estimated_effort: string | null; dependencies: string[]; acceptance_criteria: string[];
  suggested_milestone: string | null;
}
export interface PlanMilestone {
  id: string; title: string; goal: string; tasks: PlanTask[]; completion_criteria: string[];
}
export interface PlanContent {
  project_title: string; problem_statement: string; intended_users: string[];
  main_objectives: string[]; assumptions: string[]; out_of_scope: string[];
  requirements: PlanRequirement[]; milestones: PlanMilestone[];
  recommendations: {
    recommended_stack: { technology: string; reason: string }[];
    architecture: string; risks: { risk: string; mitigation: string }[];
    testing_strategy: string[]; security_considerations: string[];
  };
}
export interface SavedPlan { id: string; project_id: string; plan: PlanContent; created_at: string; updated_at: string }
