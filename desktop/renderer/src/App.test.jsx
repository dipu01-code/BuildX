import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App.jsx';

describe('BUILDX startup screen', () => {
  beforeEach(() => {
    window.buildxDesktop = {
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'BUILDX',
        version: '0.1.0',
        platform: 'darwin',
      }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.buildxDesktop;
  });

  it('shows the app shell and confirms the desktop bridge is ready', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /your workspace, in focus/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('BUILDX 0.1.0')).toBeInTheDocument());
    expect(screen.getByText('Desktop ready')).toBeInTheDocument();
    expect(screen.getByText('NOT CONNECTED YET')).toBeInTheDocument();
  });

  it('explains when the desktop bridge is not available', async () => {
    delete window.buildxDesktop;
    render(<App />);

    expect(await screen.findByText('Bridge offline')).toBeInTheDocument();
  });

  it('shows a recoverable startup message when runtime metadata fails', async () => {
    window.buildxDesktop.getAppInfo.mockRejectedValue(new Error('IPC failure'));
    render(<App />);

    expect(await screen.findByText('Bridge offline')).toBeInTheDocument();
  });

  it('changes the selected workspace section and opens a matching tab', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: /projects, when you’re ready/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Projects/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/not connected yet/i)).toBeInTheDocument();
  });

  it('supports keyboard navigation in the workspace menu and announces actions', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Workspace options' }));
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Workspace settings' })).toHaveFocus();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Workspace settings' }));
    expect(screen.getByRole('status')).toHaveTextContent(/coming in a later phase/i);
  });

  it('opens a named-workspace dialog, validates input, and restores focus after Escape', async () => {
    render(<App />);
    const trigger = screen.getAllByRole('button', { name: /create a workspace/i })[0];
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Workspace name');
    expect(input).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Demo space' } });
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('filters quick switch commands and opens the selected view', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const palette = screen.getByRole('dialog', { name: 'Quick switch' });
    const actions = within(palette).getAllByRole('button', { name: /go to|create a workspace|open settings/i });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(actions[0]).toHaveFocus();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(actions[actions.length - 1]).toHaveFocus();
    const search = within(palette).getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'tasks' } });
    expect(within(palette).getByRole('button', { name: /go to tasks/i })).toBeInTheDocument();
    expect(within(palette).queryByRole('button', { name: /go to projects/i })).not.toBeInTheDocument();
    fireEvent.click(within(palette).getByRole('button', { name: /go to tasks/i }));
    expect(screen.getByRole('heading', { name: /room for what’s next/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports local-only actions in a dismissible toast', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('status')).toHaveTextContent(/stored locally/i);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
