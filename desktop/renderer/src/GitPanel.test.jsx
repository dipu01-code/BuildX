import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GitPanel from './GitPanel.jsx';

const project = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Atlas', root_path: '/approved/atlas' };
const file = (overrides) => ({ orig_path: null, conflicted: false, untracked: false, directory: false, ...overrides });
const dirty = {
  repository: true, branch: 'main', detached: false, initial: false, upstream: null, ahead: 0, behind: 0,
  files: [
    file({ path: 'src/app.js', index: '.', worktree: 'M', staged: false, unstaged: true }),
    file({ path: 'notes.md', index: '?', worktree: '?', untracked: true, staged: false, unstaged: true }),
  ],
};
const staged = { ...dirty, files: [file({ path: 'src/app.js', index: 'M', worktree: '.', staged: true, unstaged: false }), dirty.files[1]] };

describe('source control panel', () => {
  afterEach(() => { cleanup(); delete window.buildxDesktop; });

  it('explains when the folder is not a repository', async () => {
    window.buildxDesktop = { getGitStatus: vi.fn().mockResolvedValue({ project_id: project.id, repository: false }) };
    render(<GitPanel project={project} />);
    expect(await screen.findByText(/not a Git repository/)).toBeInTheDocument();
  });

  it('shows diffs, stages files, and commits only after reviewing the exact staged files', async () => {
    const api = {
      getGitStatus: vi.fn().mockResolvedValue(dirty),
      getGitDiff: vi.fn().mockResolvedValue({ diff: '-old\n+new' }),
      stageGitPaths: vi.fn().mockResolvedValue(staged),
      unstageGitPaths: vi.fn(),
      commitGit: vi.fn().mockResolvedValue({ commit: 'abcdef1234567890', status: { ...dirty, files: [dirty.files[1]] } }),
    };
    window.buildxDesktop = api;
    render(<GitPanel project={project} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Modified.*src\/app\.js$/ }));
    await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledExactlyOnceWith(project.id, 'src/app.js', false));
    expect(await screen.findByText(/\+new/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Untracked.*notes\.md$/ }));
    expect(screen.getByText(/Stage it to see its contents/)).toBeInTheDocument();
    expect(api.getGitDiff).toHaveBeenCalledOnce();

    expect(screen.getByRole('button', { name: 'Review commit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/app.js' }));
    await waitFor(() => expect(api.stageGitPaths).toHaveBeenCalledExactlyOnceWith(project.id, ['src/app.js']));
    expect(await screen.findByText('Staged changes (1)')).toBeInTheDocument();

    const messageInput = screen.getByRole('textbox', { name: 'Commit message' });
    fireEvent.change(messageInput, { target: { value: 'Update app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review commit' }));
    fireEvent.change(messageInput, { target: { value: 'Update app!' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/changed/);
    expect(screen.queryByRole('button', { name: /^Commit/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit 1 path' }));
    await waitFor(() => expect(api.commitGit).toHaveBeenCalledExactlyOnceWith(project.id, { message: 'Update app!', staged_paths: ['src/app.js'] }));
    expect(await screen.findByText('Committed abcdef1.')).toBeInTheDocument();
    expect(messageInput).toHaveValue('');
  });

  it('shows the diff for the last clicked file even if an earlier diff arrives later', async () => {
    let finishFirst;
    window.buildxDesktop = {
      getGitStatus: vi.fn().mockResolvedValue({ ...dirty, files: [dirty.files[0], file({ path: 'b.js', index: '.', worktree: 'M', staged: false, unstaged: true })] }),
      getGitDiff: vi.fn()
        .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
        .mockResolvedValueOnce({ diff: '+from b' }),
    };
    render(<GitPanel project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Modified.*src\/app\.js$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Modified.*b\.js$/ }));
    expect(await screen.findByText('+from b')).toBeInTheDocument();
    finishFirst({ diff: '+from app' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('+from app')).not.toBeInTheDocument();
    expect(screen.getByText('+from b')).toBeInTheDocument();
  });

  it('shows git errors without losing the commit message', async () => {
    window.buildxDesktop = {
      getGitStatus: vi.fn().mockResolvedValue(staged),
      commitGit: vi.fn().mockRejectedValue(new Error('The staged files changed after review.')),
    };
    render(<GitPanel project={project} />);
    const messageInput = await screen.findByRole('textbox', { name: 'Commit message' });
    fireEvent.change(messageInput, { target: { value: 'Fix' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit 1 path' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The staged files changed after review.');
    expect(messageInput).toHaveValue('Fix');
  });
});
