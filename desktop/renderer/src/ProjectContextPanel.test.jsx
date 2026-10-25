import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectContextPanel from './ProjectContextPanel.jsx';

const project = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Fixture' };
const status = {
  project_id: project.id, state: 'up_to_date', discovered_count: 3, processed_count: 3,
  skipped_count: 2, indexed_file_count: 3, chunk_count: 6, skip_reasons: { gitignore: 1, sensitive_file: 1 },
  errors: [], started_at: '2026-10-25T10:00:00Z', completed_at: '2026-10-25T10:00:01Z', updated_at: '2026-10-25T10:00:01Z',
};

describe('project context panel', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      getProjectIndexStatus: vi.fn().mockResolvedValue(status),
      refreshProjectIndex: vi.fn().mockResolvedValue({ accepted: true }),
      searchProjectContext: vi.fn().mockResolvedValue({ query: 'router', total: 1, results: [
        { relative_path: 'backend/app/main.py', start_line: 12, end_line: 14, excerpt: 'The project router handles requests.', score: 4.25, chunk_hash: 'a'.repeat(64) },
      ] }),
    };
  });
  afterEach(() => { cleanup(); delete window.buildxDesktop; });

  it('shows local index status, skipped reasons, and opens a result in the editor', async () => {
    const onOpenResult = vi.fn();
    render(<ProjectContextPanel project={project} onOpenResult={onOpenResult} />);
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText(/3 indexed files · 6 searchable chunks · 2 skipped entries/)).toBeInTheDocument();
    expect(screen.getByText(/ignored by \.gitignore/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search indexed context' }), { target: { value: 'router' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Lines 12–14')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /backend\/app\/main.py/ }));
    expect(onOpenResult).toHaveBeenCalledExactlyOnceWith('backend/app/main.py', 12);
    expect(window.buildxDesktop.searchProjectContext).toHaveBeenCalledExactlyOnceWith(project.id, 'router', 8);
  });

  it('starts an index refresh and displays an empty search result', async () => {
    window.buildxDesktop.searchProjectContext.mockResolvedValue({ query: 'missing', total: 0, results: [] });
    const indexingStatus = { ...status, state: 'indexing' };
    window.buildxDesktop.getProjectIndexStatus.mockResolvedValueOnce(status).mockResolvedValue(indexingStatus);
    render(<ProjectContextPanel project={project} onOpenResult={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh index' }));
    await waitFor(() => expect(window.buildxDesktop.refreshProjectIndex).toHaveBeenCalledExactlyOnceWith(project.id));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search indexed context' }), { target: { value: 'missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/No matching context found/)).toBeInTheDocument();
  });

  it('keeps indexing failures visible and retries status reads', async () => {
    window.buildxDesktop.getProjectIndexStatus
      .mockRejectedValueOnce(new Error('The local context service is unavailable.'))
      .mockResolvedValueOnce(status);
    render(<ProjectContextPanel project={project} onOpenResult={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/context service is unavailable/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Up to date')).toBeInTheDocument());
  });
});
