import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TerminalPanel from './TerminalPanel.jsx';

const project = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Atlas', root_path: '/approved/atlas' };
const sessionId = '550e8400-e29b-41d4-a716-446655440001';
let terminalListener;

describe('project terminal panel', () => {
  afterEach(() => { cleanup(); delete window.buildxDesktop; });

  it('requires exact command review before starting and waits for trusted stop confirmation', async () => {
    const session = {
      id: sessionId, project_id: project.id, command: 'npm run dev', working_directory: project.root_path,
      status: 'running', exit_code: null, elapsed_ms: 0, started_at: new Date().toISOString(),
      stdout: '', stderr: '', output_truncated: false,
    };
    const stopTerminalProcess = vi.fn().mockResolvedValue({ accepted: true, status: 'running' });
    const startTerminalProcess = vi.fn().mockResolvedValue(session);
    window.buildxDesktop = {
      listTerminalProcesses: vi.fn().mockResolvedValue({ sessions: [], limits: { timeoutMs: 300000, maxConcurrent: 2, maxOutputBytes: 32768 } }),
      onTerminalEvent: vi.fn((callback) => { terminalListener = callback; return vi.fn(); }),
      startTerminalProcess,
      stopTerminalProcess,
    };
    render(<TerminalPanel project={project} />);
    const commandInput = screen.getByRole('textbox', { name: 'Command' });
    fireEvent.change(commandInput, { target: { value: 'npm run dev' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review command' }));
    expect(await screen.findAllByText(project.root_path)).toHaveLength(2);
    expect(startTerminalProcess).not.toHaveBeenCalled();
    fireEvent.change(commandInput, { target: { value: 'npm test' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/changed/i);
    expect(screen.queryByRole('button', { name: 'Run approved command' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review command' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run approved command' }));
    await waitFor(() => expect(startTerminalProcess).toHaveBeenCalledOnce());
    expect(startTerminalProcess.mock.calls[0][0]).toBe(project.id);
    expect(startTerminalProcess.mock.calls[0][1]).toMatchObject({
      command: 'npm test', approval: { project_id: project.id, command: 'npm test', working_directory: project.root_path },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Running/);

    fireEvent.click(screen.getByRole('button', { name: 'Stop process' }));
    await waitFor(() => expect(stopTerminalProcess).toHaveBeenCalledExactlyOnceWith(project.id, sessionId));
    expect(screen.getByRole('status')).toHaveTextContent(/Running/);
    terminalListener({ project_id: project.id, session_id: sessionId, type: 'status', session: { ...session, status: 'terminated', termination_reason: 'user', ended_at: new Date().toISOString() } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Terminated/));
  });

  it('renders stdout and stderr as text and clears only the visible output', async () => {
    const session = { id: sessionId, project_id: project.id, command: 'command', working_directory: project.root_path,
      status: 'running', exit_code: null, elapsed_ms: 0, started_at: new Date().toISOString(), stdout: '', stderr: '', output_truncated: false };
    window.buildxDesktop = {
      listTerminalProcesses: vi.fn().mockResolvedValue({ sessions: [session], limits: { maxOutputBytes: 32768 } }),
      onTerminalEvent: vi.fn((callback) => { terminalListener = callback; return vi.fn(); }),
      startTerminalProcess: vi.fn(), stopTerminalProcess: vi.fn().mockResolvedValue({ accepted: true }),
    };
    render(<TerminalPanel project={project} />);
    await screen.findByRole('option', { name: /Running · command/ });
    terminalListener({ project_id: project.id, session_id: sessionId, type: 'output', stream: 'stdout', data: '<tag>safe text\n' });
    terminalListener({ project_id: project.id, session_id: sessionId, type: 'output', stream: 'stderr', data: 'warning\n' });
    expect(await screen.findByText('<tag>safe text')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('stdout')).toBeInTheDocument();
    expect(screen.getByText('stderr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear output' }));
    expect(screen.getByText(/Command output will appear here/)).toBeInTheDocument();
  });
});
