import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TestingPanel from './TestingPanel.jsx';

const project = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Atlas', root_path: '/approved/atlas' };
const sessionId = '550e8400-e29b-41d4-a716-446655440001';
let terminalListener;

function installBridge(overrides = {}) {
  window.buildxDesktop = {
    discoverTestCommands: vi.fn().mockResolvedValue({ project_id: project.id, commands: [
      { id: 'npm:test', command: 'npm test', runner: 'vitest', source: 'package.json scripts.test', kind: 'discovered', available: true },
    ], issues: [], manual_command_supported: true, message: '' }),
    listTerminalProcesses: vi.fn().mockResolvedValue({ sessions: [], limits: { timeoutMs: 300000, maxConcurrent: 2, maxOutputBytes: 32768 } }),
    onTerminalEvent: vi.fn((callback) => { terminalListener = callback; return vi.fn(); }),
    startTestProcess: vi.fn().mockResolvedValue({ id: sessionId, project_id: project.id, command: 'npm test',
      working_directory: project.root_path, purpose: 'test', configuration_source: 'package.json scripts.test', test_runner: 'vitest',
      status: 'running', exit_code: null, elapsed_ms: 0, started_at: new Date().toISOString(), stdout: '', stderr: '', output_truncated: false }),
    stopTerminalProcess: vi.fn().mockResolvedValue({ accepted: true }),
    createConversation: vi.fn().mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440002' }),
    sendConversationMessage: vi.fn().mockResolvedValue({ assistant_message: { status: 'complete', content: 'Observed: one assertion failed. Hypothesis: the expected value is stale.', sources: [{ relative_path: 'src/math.js', start_line: 8, end_line: 10 }] } }),
    readWorkspaceText: vi.fn().mockResolvedValue({ content: 'export const add = (a, b) => a + b;' }),
    generateChangeProposal: vi.fn().mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440003', status: 'pending_review' }),
    ...overrides,
  };
}

function emitSession(overrides = {}) {
  return terminalListener({ project_id: project.id, session_id: sessionId, type: 'status', session: {
    id: sessionId, project_id: project.id, command: 'npm test', working_directory: project.root_path,
    purpose: 'test', configuration_source: 'package.json scripts.test', test_runner: 'vitest',
    status: 'failed', exit_code: 1, elapsed_ms: 2500, started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    termination_reason: 'exit_code', stdout: 'Tests  1 failed | 2 passed (3)\n[LOCAL PATH] error\napi_key=[REDACTED]\n', stderr: '', output_truncated: false,
    ...overrides,
  } });
}

describe('project testing panel', () => {
  afterEach(() => { cleanup(); delete window.buildxDesktop; });

  it('discovers without execution and requires review bound to the command, source, and directory', async () => {
    installBridge();
    render(<TestingPanel project={project} />);
    await screen.findByRole('option', { name: /vitest · npm test · package.json scripts.test/ });
    expect(window.buildxDesktop.discoverTestCommands).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(window.buildxDesktop.startTestProcess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review test command' }));
    expect(await screen.findByRole('button', { name: 'Run reviewed tests' })).toBeInTheDocument();
    expect(window.buildxDesktop.startTestProcess).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Command to review' }), { target: { value: 'npm run test:unit' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/changed after review/i);
    expect(screen.queryByRole('button', { name: 'Run reviewed tests' })).not.toBeInTheDocument();
  });

  it('allows a manual command when discovery finds none and waits for manager confirmation when stopped', async () => {
    const stopTerminalProcess = vi.fn().mockResolvedValue({ accepted: true, status: 'running' });
    installBridge({
      discoverTestCommands: vi.fn().mockResolvedValue({ commands: [], issues: [], manual_command_supported: true,
        message: 'No recognized test command was found. Enter a command manually to configure a run.' }),
      startTestProcess: vi.fn().mockResolvedValue({ id: sessionId, project_id: project.id, command: 'npm test',
        working_directory: project.root_path, purpose: 'test', configuration_source: 'Manually entered', test_runner: 'unknown',
        status: 'running', exit_code: null, elapsed_ms: 10, started_at: new Date().toISOString(), stdout: '', stderr: '', output_truncated: false }),
      stopTerminalProcess,
    });
    render(<TestingPanel project={project} />);
    expect(await screen.findByText(/No recognized test command was found/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Command to review' }), { target: { value: 'npm test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review test command' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run reviewed tests' }));
    await waitFor(() => expect(window.buildxDesktop.startTestProcess).toHaveBeenCalledOnce());
    expect(window.buildxDesktop.startTestProcess.mock.calls[0][1]).toMatchObject({ configuration_source: 'Manually entered', runner: 'unknown' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));
    await waitFor(() => expect(stopTerminalProcess).toHaveBeenCalledExactlyOnceWith(project.id, sessionId));
    expect(screen.getByRole('status')).toHaveTextContent(/Running/);
    emitSession({ status: 'terminated', exit_code: null, termination_reason: 'user' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Cancelled/));
  });

  it('starts only after approval, parses a failed result, analyzes captured evidence, and routes fixes to Phase 12 review', async () => {
    installBridge();
    const onOpenAssistant = vi.fn();
    const onOpenSource = vi.fn();
    render(<TestingPanel project={project} onOpenAssistant={onOpenAssistant} onOpenSource={onOpenSource} />);
    await screen.findByRole('option', { name: /npm test/ });
    fireEvent.click(screen.getByRole('button', { name: 'Review test command' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run reviewed tests' }));
    await waitFor(() => expect(window.buildxDesktop.startTestProcess).toHaveBeenCalledOnce());
    expect(window.buildxDesktop.startTestProcess.mock.calls[0][0]).toBe(project.id);
    expect(window.buildxDesktop.startTestProcess.mock.calls[0][1]).toMatchObject({
      command: 'npm test', configuration_source: 'package.json scripts.test', runner: 'vitest',
      approval: { project_id: project.id, command: 'npm test', working_directory: project.root_path,
        source: 'package.json scripts.test', runner: 'vitest' },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/Running/);
    terminalListener({ project_id: project.id, session_id: sessionId, type: 'status', session: {
      id: sessionId, project_id: project.id, command: 'npm test', working_directory: project.root_path,
      purpose: 'test', configuration_source: 'package.json scripts.test', test_runner: 'vitest', status: 'running',
      exit_code: null, elapsed_ms: 0, started_at: new Date().toISOString(), stdout: '', stderr: '', output_truncated: false,
    } });
    terminalListener({ project_id: project.id, session_id: sessionId, type: 'output', stream: 'stdout', data: 'Tests  1 failed | 2 passed (3)\napi_key=sk-proj-12345678901234567890\n/Users/alice/private.js' });
    emitSession();
    expect(await screen.findByRole('status')).toHaveTextContent(/Tests failed/);
    expect(await screen.findByText('1', { selector: '.testing-counts dd' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask AI to explain this failure' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI to explain this failure' }));
    expect(await screen.findByText(/one assertion failed/i)).toBeInTheDocument();
    await waitFor(() => expect(window.buildxDesktop.sendConversationMessage).toHaveBeenCalledOnce());
    const prompt = window.buildxDesktop.sendConversationMessage.mock.calls[0][3];
    expect(prompt).toContain('Tests  1 failed');
    expect(prompt).not.toContain('sk-proj-12345678901234567890');
    expect(prompt).not.toContain('/Users/alice');
    fireEvent.click(screen.getByRole('button', { name: 'src/math.js:8–10' }));
    expect(onOpenSource).toHaveBeenCalledExactlyOnceWith('src/math.js', 8);
    fireEvent.change(screen.getByRole('textbox', { name: 'File to propose a change for' }), { target: { value: 'src/math.js' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Requested fix' }), { target: { value: 'Correct the arithmetic behavior' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate reviewable proposal' }));
    expect(await screen.findByRole('button', { name: 'Review proposal in Assistant' })).toBeInTheDocument();
    expect(window.buildxDesktop.generateChangeProposal).toHaveBeenCalledOnce();
    expect(window.buildxDesktop.readWorkspaceText).toHaveBeenCalledExactlyOnceWith(project.id, 'src/math.js');
    fireEvent.click(screen.getByRole('button', { name: 'Review proposal in Assistant' }));
    expect(onOpenAssistant).toHaveBeenCalledOnce();
  });

  it('shows an infrastructure error separately when the process manager rejects a run', async () => {
    installBridge({ startTestProcess: vi.fn().mockRejectedValue(new Error('The project folder is no longer authorized.')) });
    render(<TestingPanel project={project} />);
    await screen.findByRole('option', { name: /npm test/ });
    fireEvent.click(screen.getByRole('button', { name: 'Review test command' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run reviewed tests' }));
    expect(await screen.findByText(/Infrastructure error/)).toBeInTheDocument();
    expect(screen.queryByText(/Tests passed/)).not.toBeInTheDocument();
  });
});
