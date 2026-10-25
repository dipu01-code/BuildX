import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectPlanner, { validateDraft } from './ProjectPlanner.jsx';

const project = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Recipe Book' };
const plan = {
  project_title: 'Local Recipe Book', problem_statement: 'Organize home recipes.',
  intended_users: ['Home cooks'], main_objectives: ['Save recipes'], assumptions: [], out_of_scope: [],
  requirements: [{ id: 'req_catalog', title: 'Recipe catalog', description: 'Save recipes.', priority: 'must', acceptance_criteria: ['Recipe is saved'], dependencies: [] }],
  milestones: [{ id: 'mile_start', title: 'Foundation', goal: 'Start the app.', completion_criteria: ['App opens'], tasks: [{ id: 'task_schema', title: 'Define schema', description: 'Define recipe data.', rationale: 'Storage needs structure.', priority: 'must', estimated_effort: '2 hours (rough estimate)', dependencies: [], acceptance_criteria: ['Name and ingredients exist'], suggested_milestone: 'Foundation' }] }],
  recommendations: { recommended_stack: [{ technology: 'SQLite', reason: 'Local storage.' }], architecture: 'A local app.', risks: [], testing_strategy: ['Test persistence.'], security_considerations: ['Keep data local.'] },
};

describe('project planner', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      listProjectPlans: vi.fn().mockResolvedValue([]),
      generateProjectPlan: vi.fn().mockResolvedValue(plan),
      getProjectPlan: vi.fn(),
      saveProjectPlan: vi.fn().mockImplementation(async (_projectId, savedPlan) => ({ id: '550e8400-e29b-41d4-a716-446655440001', project_id: project.id, plan: savedPlan, created_at: '2026-10-25T10:00:00Z', updated_at: '2026-10-25T10:00:00Z' })),
      updateProjectPlan: vi.fn(), deleteProjectPlan: vi.fn().mockResolvedValue(null),
    };
  });
  afterEach(() => { cleanup(); delete window.buildxDesktop; });

  it('detects cycles in task dependencies before a save request', () => {
    const cyclic = structuredClone(plan);
    cyclic.milestones[0].tasks[0].dependencies = ['task_second'];
    cyclic.milestones[0].tasks.push({ ...cyclic.milestones[0].tasks[0], id: 'task_second', dependencies: ['task_schema'] });
    expect(validateDraft(cyclic)).toContain('Task dependencies contain a cycle.');
  });

  it('validates the brief, displays a draft, and reports success only after save resolves', async () => {
    render(<ProjectPlanner projects={[project]} selectedProject={project} />);
    const generateButton = screen.getByRole('button', { name: /generate plan/i });
    expect(generateButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What do you want to build?'), { target: { value: 'Build a local recipe catalog.' } });
    await waitFor(() => expect(generateButton).not.toBeDisabled());
    fireEvent.click(generateButton);
    expect(await screen.findByLabelText('Project title')).toHaveValue('Local Recipe Book');
    expect(await screen.findByText(/AI-generated draft · Unapproved/i)).toBeInTheDocument();
    expect(window.buildxDesktop.generateProjectPlan).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /save approved plan/i }));
    expect(await screen.findByText('Plan saved on this device.')).toBeInTheDocument();
    expect(window.buildxDesktop.saveProjectPlan).toHaveBeenCalledOnce();
  });

  it('shows provider failure and does not claim that a draft was generated', async () => {
    window.buildxDesktop.generateProjectPlan.mockRejectedValue(new Error('Configure the AI provider before generation.'));
    render(<ProjectPlanner projects={[project]} selectedProject={project} />);
    fireEvent.change(screen.getByLabelText('What do you want to build?'), { target: { value: 'Build a recipe catalog.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /generate plan/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/configure the AI provider/i);
    expect(screen.queryByText(/plan saved/i)).not.toBeInTheDocument();
  });

  it('blocks invalid task references and cycles before saving', async () => {
    render(<ProjectPlanner projects={[project]} selectedProject={project} />);
    fireEvent.change(screen.getByLabelText('What do you want to build?'), { target: { value: 'Build a recipe catalog.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /generate plan/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    await screen.findByLabelText('Project title');
    fireEvent.change(screen.getByLabelText('Task dependencies'), { target: { value: 'task_missing' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/refers to missing task/i);
    expect(screen.getByRole('button', { name: /save approved plan/i })).toBeDisabled();
    expect(window.buildxDesktop.saveProjectPlan).not.toHaveBeenCalled();
  });

  it('keeps save errors visible and does not claim persistence', async () => {
    window.buildxDesktop.saveProjectPlan.mockRejectedValue(new Error('The local database is unavailable.'));
    render(<ProjectPlanner projects={[project]} selectedProject={project} />);
    fireEvent.change(screen.getByLabelText('What do you want to build?'), { target: { value: 'Build a recipe catalog.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /generate plan/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    await screen.findByLabelText('Project title');
    fireEvent.click(screen.getByRole('button', { name: /save approved plan/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/database is unavailable/i);
    expect(screen.queryByText('Plan saved on this device.')).not.toBeInTheDocument();
  });

  it('requires confirmation before deleting a saved plan and supports cancellation', async () => {
    const saved = { id: '550e8400-e29b-41d4-a716-446655440001', project_id: project.id, plan, created_at: '2026-10-25T10:00:00Z', updated_at: '2026-10-25T10:00:00Z' };
    window.buildxDesktop.listProjectPlans.mockResolvedValue([saved]);
    window.buildxDesktop.getProjectPlan.mockResolvedValue(saved);
    render(<ProjectPlanner projects={[project]} selectedProject={project} />);
    await waitFor(() => expect(screen.getByLabelText('Saved plans')).toHaveTextContent('Local Recipe Book'));
    fireEvent.change(screen.getByLabelText('Saved plans'), { target: { value: saved.id } });
    await screen.findByLabelText('Project title');
    fireEvent.click(screen.getByRole('button', { name: /delete saved plan/i }));
    const confirmation = screen.getByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.buildxDesktop.deleteProjectPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /delete saved plan/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(window.buildxDesktop.deleteProjectPlan).toHaveBeenCalledExactlyOnceWith(project.id, saved.id));
  });
});
