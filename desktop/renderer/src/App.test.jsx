import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App.jsx';

function project(overrides = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Atlas',
    description: 'Product design',
    root_path: null,
    project_type: 'TypeScript',
    created_at: '2026-10-25T10:00:00Z',
    updated_at: '2026-10-25T10:00:00Z',
    ...overrides,
  };
}

function openProjects() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Projects' })[0]);
}

describe('BUILDX project management', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.buildxDesktop = {
      getAppInfo: vi.fn().mockResolvedValue({ name: 'BUILDX', version: '0.1.0', platform: 'darwin' }),
      listProjects: vi.fn().mockResolvedValue([]),
      getProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      chooseProjectDirectory: vi.fn(),
      listWorkspaceDirectory: vi.fn().mockResolvedValue({ path: '', entries: [] }),
      readWorkspaceText: vi.fn(),
      createWorkspaceFile: vi.fn(),
      createWorkspaceFolder: vi.fn(),
      moveWorkspaceItem: vi.fn(),
      deleteWorkspaceItem: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.buildxDesktop;
  });

  it('shows the app shell and loads projects through the desktop bridge', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /your workspace, in focus/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('BUILDX 0.1.0')).toBeInTheDocument());
    expect(screen.getByText('Desktop ready')).toBeInTheDocument();
    expect(window.buildxDesktop.listProjects).toHaveBeenCalledOnce();
  });

  it('shows loading and empty project states', async () => {
    let finishLoad;
    window.buildxDesktop.listProjects.mockReturnValue(new Promise((resolve) => { finishLoad = resolve; }));
    render(<App />);
    openProjects();
    expect(screen.getByRole('status')).toHaveTextContent(/loading projects/i);
    finishLoad([]);
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });

  it('shows a recoverable project load error with retry', async () => {
    window.buildxDesktop.listProjects.mockRejectedValueOnce(new Error('The project service could not be reached.'));
    render(<App />);
    openProjects();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be reached/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });

  it('reports when the desktop bridge is missing', async () => {
    delete window.buildxDesktop;
    render(<App />);
    expect(await screen.findByText('Bridge offline')).toBeInTheDocument();
  });

  it('opens a create form, validates the project name, and restores focus on Escape', async () => {
    render(<App />);
    const trigger = screen.getAllByRole('button', { name: /create a project/i })[0];
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Project name');
    expect(input).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: /create project/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Demo project' } });
    expect(within(dialog).getByRole('button', { name: /create project/i })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('creates through the backend and refreshes the project list', async () => {
    const created = project();
    window.buildxDesktop.listProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    window.buildxDesktop.createProject.mockResolvedValue(created);
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /create a project/i })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: ' Atlas ' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Product design' } });
    fireEvent.change(within(dialog).getByLabelText('Project type'), { target: { value: 'TypeScript' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /create project/i }));

    expect(await screen.findByRole('heading', { name: 'Atlas' })).toBeInTheDocument();
    expect(window.buildxDesktop.createProject).toHaveBeenCalledWith({
      name: 'Atlas', description: 'Product design', project_type: 'TypeScript',
    });
    expect(window.buildxDesktop.listProjects).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Product design')).toBeInTheDocument();
  });

  it('prevents duplicate creates and shows API save errors', async () => {
    let finishSave;
    window.buildxDesktop.createProject.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
    window.buildxDesktop.listProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([project()]);
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /create a project/i })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Atlas' } });
    const submit = within(dialog).getByRole('button', { name: /create project/i });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(window.buildxDesktop.createProject).toHaveBeenCalledOnce();
    finishSave(project());
    expect(await screen.findByText('Atlas')).toBeInTheDocument();

    cleanup();
    window.buildxDesktop.listProjects.mockRejectedValueOnce(new Error('Database unavailable'));
    window.buildxDesktop.createProject.mockRejectedValueOnce(new Error('Project write failed'));
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /create a project/i })[0]);
    const failedDialog = screen.getByRole('dialog');
    fireEvent.change(within(failedDialog).getByLabelText('Project name'), { target: { value: 'Broken' } });
    fireEvent.click(within(failedDialog).getByRole('button', { name: /create project/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Project write failed');
  });

  it('updates project metadata only after the API confirms success', async () => {
    const existing = project();
    const updated = project({ description: 'Updated description' });
    window.buildxDesktop.listProjects.mockResolvedValueOnce([existing]).mockResolvedValueOnce([updated]);
    window.buildxDesktop.updateProject.mockResolvedValue(updated);
    render(<App />);
    openProjects();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Atlas' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Updated description' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));
    expect(window.buildxDesktop.updateProject).toHaveBeenCalledWith(existing.id, {
      name: existing.name, description: 'Updated description', project_type: existing.project_type,
    });
    await waitFor(() => expect(screen.getByText('Updated description')).toBeInTheDocument());
  });

  it('requires delete confirmation and keeps the project after a failed delete', async () => {
    const existing = project();
    window.buildxDesktop.listProjects.mockResolvedValue([existing]);
    render(<App />);
    openProjects();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Atlas' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Its local directory and files will not be deleted.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep project' }));
    expect(screen.getByText('Atlas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Atlas' }));
    window.buildxDesktop.deleteProject.mockRejectedValueOnce(new Error('Delete failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');
    expect(screen.getByText('Atlas')).toBeInTheDocument();
  });

  it('opens an associated project folder and previews text through the desktop bridge', async () => {
    const existing = project({ root_path: '/tmp/buildx-fixture' });
    window.buildxDesktop.listProjects.mockResolvedValue([existing]);
    window.buildxDesktop.listWorkspaceDirectory.mockResolvedValue({ path: '', entries: [
      { name: 'README.md', path: 'README.md', type: 'file', size: 12 },
    ] });
    window.buildxDesktop.readWorkspaceText.mockResolvedValue({ path: 'README.md', content: 'Hello workspace', size: 15, encoding: 'utf-8' });
    render(<App />);
    openProjects();
    fireEvent.click(await screen.findByText('Atlas'));
    fireEvent.click(screen.getByRole('button', { name: /open workspace/i }));
    expect(await screen.findByText('/tmp/buildx-fixture')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Select README.md' }));
    expect(await screen.findByText('Hello workspace')).toBeInTheDocument();
    expect(window.buildxDesktop.readWorkspaceText).toHaveBeenCalledWith(existing.id, 'README.md');
  });

  it('associates a folder only after the native picker confirms a selection', async () => {
    const existing = project();
    window.buildxDesktop.listProjects.mockResolvedValue([existing]);
    window.buildxDesktop.chooseProjectDirectory.mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({ canceled: false, project: project({ root_path: '/tmp/selected-project' }) });
    render(<App />);
    openProjects();
    fireEvent.click(await screen.findByText('Atlas'));
    fireEvent.click(screen.getByRole('button', { name: /choose project folder/i }));
    expect(await screen.findByText(/Not set. Choose a directory/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /choose project folder/i }));
    expect(await screen.findByText('/tmp/selected-project')).toBeInTheDocument();
  });

  it('deletes a project after confirmation without deleting local files', async () => {
    const existing = project();
    window.buildxDesktop.listProjects.mockResolvedValue([existing]);
    window.buildxDesktop.deleteProject.mockResolvedValue(null);
    render(<App />);
    openProjects();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Atlas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(window.buildxDesktop.deleteProject).toHaveBeenCalledExactlyOnceWith(existing.id);
  });

  it('supports keyboard navigation in the workspace menu', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Workspace options' }));
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Workspace settings' })).toHaveFocus();
  });

  it('filters quick switch commands and opens the selected view', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = screen.getByRole('dialog', { name: 'Quick switch' });
    const actions = within(palette).getAllByRole('button', { name: /go to|create a project|open settings/i });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(actions[0]).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(actions[actions.length - 1]).toHaveFocus();
    const search = within(palette).getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'tasks' } });
    expect(within(palette).getByRole('button', { name: /go to tasks/i })).toBeInTheDocument();
    fireEvent.click(within(palette).getByRole('button', { name: /go to tasks/i }));
    expect(screen.getByRole('heading', { name: /room for what’s next/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('announces and dismisses local help messages', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('status')).toHaveTextContent(/stored on this device/i);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
