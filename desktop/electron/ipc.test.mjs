import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { AI_CHANNELS, CONTEXT_CHANNELS, CONVERSATION_CHANNELS, PROJECT_CHANNELS, TERMINAL_CHANNELS, WORKSPACE_CHANNELS, registerIpcHandlers } = require('./ipc.cjs');
const APP_INFO_CHANNEL = 'app:get-info';

function makeIpc() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
}

describe('privileged IPC validation', () => {
  it('starts only an exact reviewed command and scopes list/stop to one project', async () => {
    const { ipcMain, handlers } = makeIpc();
    const startTerminalProcess = vi.fn().mockResolvedValue({ id: 'session' });
    const listTerminalProcesses = vi.fn().mockResolvedValue({ sessions: [], limits: {} });
    const stopTerminalProcess = vi.fn().mockResolvedValue({ accepted: true });
    registerIpcHandlers({ ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      startTerminalProcess, listTerminalProcesses, stopTerminalProcess });
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    const project = '550e8400-e29b-41d4-a716-446655440000';
    const requestId = '550e8400-e29b-41d4-a716-446655440001';
    const sessionId = '550e8400-e29b-41d4-a716-446655440002';
    const payload = { command: 'npm run dev', request_id: requestId,
      approval: { project_id: project, command: 'npm run dev', working_directory: '/project' } };
    await expect(handlers.get(TERMINAL_CHANNELS.start)(event, project, payload)).resolves.toEqual({ id: 'session' });
    await expect(handlers.get(TERMINAL_CHANNELS.list)(event, project)).resolves.toMatchObject({ sessions: [] });
    await expect(handlers.get(TERMINAL_CHANNELS.stop)(event, project, sessionId)).resolves.toEqual({ accepted: true });
    expect(() => handlers.get(TERMINAL_CHANNELS.start)(event, project, { ...payload, command: 'npm test' })).toThrow(/review/i);
    expect(() => handlers.get(TERMINAL_CHANNELS.stop)(event, project, '../other')).toThrow(/identifier/i);
    expect(startTerminalProcess).toHaveBeenCalledExactlyOnceWith(project, payload);
    expect(listTerminalProcesses).toHaveBeenCalledExactlyOnceWith(project);
    expect(stopTerminalProcess).toHaveBeenCalledExactlyOnceWith(project, sessionId);
  });

  it('exposes only validated project-scoped conversation actions', async () => {
    const { ipcMain, handlers } = makeIpc();
    const createConversation = vi.fn().mockResolvedValue({ id: 'conversation' });
    const listConversations = vi.fn().mockResolvedValue([]);
    const getConversation = vi.fn().mockResolvedValue({ id: 'conversation' });
    const sendConversationMessage = vi.fn().mockResolvedValue({ assistant_message: { status: 'complete' } });
    const deleteConversation = vi.fn().mockResolvedValue(null);
    registerIpcHandlers({ ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      createConversation, listConversations, getConversation, sendConversationMessage, deleteConversation });
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    const project = '550e8400-e29b-41d4-a716-446655440000';
    const conversation = '550e8400-e29b-41d4-a716-446655440001';
    const request = '550e8400-e29b-41d4-a716-446655440002';
    await handlers.get(CONVERSATION_CHANNELS.create)(event, project);
    await handlers.get(CONVERSATION_CHANNELS.list)(event, project);
    await handlers.get(CONVERSATION_CHANNELS.get)(event, project, conversation);
    await handlers.get(CONVERSATION_CHANNELS.send)(event, project, conversation, request, 'Question');
    await handlers.get(CONVERSATION_CHANNELS.delete)(event, project, conversation);
    expect(sendConversationMessage).toHaveBeenCalledExactlyOnceWith(project, conversation, request, 'Question');
    expect(() => handlers.get(CONVERSATION_CHANNELS.send)(event, project, conversation, request, ' ')).toThrow(/message/i);
    expect(() => handlers.get(CONVERSATION_CHANNELS.get)(event, project, '../other')).toThrow(/identifier/i);
  });

  it('exposes only project-scoped context refresh, status, and search actions', async () => {
    const { ipcMain, handlers } = makeIpc();
    const refreshProjectIndex = vi.fn().mockResolvedValue({ accepted: true });
    const getProjectIndexStatus = vi.fn().mockResolvedValue({ state: 'up_to_date' });
    const searchProjectContext = vi.fn().mockResolvedValue({ results: [] });
    registerIpcHandlers({
      ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      refreshProjectIndex, getProjectIndexStatus, searchProjectContext,
    });
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    const id = '550e8400-e29b-41d4-a716-446655440000';

    await expect(handlers.get(CONTEXT_CHANNELS.refresh)(event, id)).resolves.toEqual({ accepted: true });
    await expect(handlers.get(CONTEXT_CHANNELS.status)(event, id)).resolves.toEqual({ state: 'up_to_date' });
    await expect(handlers.get(CONTEXT_CHANNELS.search)(event, id, 'router', 8)).resolves.toEqual({ results: [] });
    expect(searchProjectContext).toHaveBeenCalledExactlyOnceWith(id, 'router', 8);
    expect(() => handlers.get(CONTEXT_CHANNELS.search)(event, id, 'x', 8)).toThrow(/query/i);
    expect(() => handlers.get(CONTEXT_CHANNELS.search)(event, id, 'router', 21)).toThrow(/limit/i);
    expect(() => handlers.get(CONTEXT_CHANNELS.refresh)(event, '../outside')).toThrow(/identifier/i);
    expect(refreshProjectIndex).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('validates sender and rejects arguments for AI status and test operations', async () => {
    const { ipcMain, handlers } = makeIpc();
    const getAIStatus = vi.fn(() => ({ provider_configured: false }));
    const testAIConnection = vi.fn(() => ({ success: false }));
    registerIpcHandlers({ ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      getAIStatus, testAIConnection,
      listProjects: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn() });
    const event = { senderFrame: { url: 'file:///app/index.html' } };

    expect(handlers.get(AI_CHANNELS.status)(event)).toEqual({ provider_configured: false });
    expect(handlers.get(AI_CHANNELS.testConnection)(event)).toEqual({ success: false });
    expect(getAIStatus).toHaveBeenCalledOnce();
    expect(testAIConnection).toHaveBeenCalledOnce();
    expect(() => handlers.get(AI_CHANNELS.status)(event, 'credential')).toThrow(/does not accept arguments/i);
    expect(() => handlers.get(AI_CHANNELS.testConnection)(event, 'prompt')).toThrow(/does not accept arguments/i);
  });

  it('validates sender and rejects unexpected arguments before returning app info', async () => {
    const { ipcMain, handlers } = makeIpc();
    const validateSender = vi.fn();
    const getAppInfo = vi.fn(() => ({ name: 'BUILDX' }));
    registerIpcHandlers({ ipcMain, validateSender, getAppInfo,
      listProjects: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn() });

    const handler = handlers.get(APP_INFO_CHANNEL);
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    expect(handler(event)).toEqual({ name: 'BUILDX' });
    expect(validateSender).toHaveBeenCalledExactlyOnceWith(event);

    expect(() => handler(event, 'unexpected')).toThrow(/does not accept arguments/i);
    expect(getAppInfo).toHaveBeenCalledTimes(1);
  });

  it('does not return data when sender validation fails', async () => {
    const { ipcMain, handlers } = makeIpc();
    const getAppInfo = vi.fn();
    registerIpcHandlers({
      ipcMain,
      validateSender: () => { throw new Error('untrusted sender'); },
      getAppInfo,
      listProjects: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
    });

    expect(() => handlers.get(APP_INFO_CHANNEL)({})).toThrow('untrusted sender');
    expect(getAppInfo).not.toHaveBeenCalled();
  });

  it('validates project payloads and identifiers before invoking scoped operations', async () => {
    const { ipcMain, handlers } = makeIpc();
    const createProject = vi.fn().mockResolvedValue({ id: 'id' });
    const getProject = vi.fn();
    registerIpcHandlers({ ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      listProjects: vi.fn(), getProject, createProject, updateProject: vi.fn(), deleteProject: vi.fn() });
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    const id = '550e8400-e29b-41d4-a716-446655440000';

    await handlers.get(PROJECT_CHANNELS.create)(event, { name: 'Atlas', description: null });
    expect(createProject).toHaveBeenCalledExactlyOnceWith({ name: 'Atlas', description: null });
    expect(() => handlers.get(PROJECT_CHANNELS.create)(event, { name: 'Atlas', root_path: '/outside' }))
      .toThrow(/unsupported project field/i);
    expect(() => handlers.get(PROJECT_CHANNELS.get)(event, '../etc/passwd')).toThrow(/identifier/i);
    expect(getProject).not.toHaveBeenCalled();
    await handlers.get(PROJECT_CHANNELS.get)(event, id);
    expect(getProject).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('validates project-scoped workspace requests and exposes no arbitrary filesystem method', async () => {
    const { ipcMain, handlers } = makeIpc();
    const listWorkspaceDirectory = vi.fn().mockResolvedValue({ path: '', entries: [] });
    const createWorkspaceFile = vi.fn();
    const writeWorkspaceText = vi.fn();
    registerIpcHandlers({ ipcMain, validateSender: vi.fn(), getAppInfo: vi.fn(),
      listProjects: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
      listWorkspaceDirectory, createWorkspaceFile, readWorkspaceText: vi.fn(), chooseProjectDirectory: vi.fn(),
      writeWorkspaceText, createWorkspaceFolder: vi.fn(), moveWorkspaceItem: vi.fn(), deleteWorkspaceItem: vi.fn() });
    const event = { senderFrame: { url: 'file:///app/index.html' } };
    const id = '550e8400-e29b-41d4-a716-446655440000';
    await handlers.get(WORKSPACE_CHANNELS.list)(event, id, 'src');
    expect(listWorkspaceDirectory).toHaveBeenCalledExactlyOnceWith(id, 'src');
    expect(() => handlers.get(WORKSPACE_CHANNELS.list)(event, id, '../outside')).toThrow();
    expect(() => handlers.get(WORKSPACE_CHANNELS.createFile)(event, id, '/etc/passwd')).toThrow(/relative/i);
    expect(createWorkspaceFile).not.toHaveBeenCalled();
    const revision = 'a'.repeat(64);
    await handlers.get(WORKSPACE_CHANNELS.writeText)(event, id, 'src/main.js', 'const x = 2;', revision);
    expect(writeWorkspaceText).toHaveBeenCalledExactlyOnceWith(id, 'src/main.js', 'const x = 2;', revision);
    expect(() => handlers.get(WORKSPACE_CHANNELS.writeText)(event, id, 'src/main.js', 'x', 'stale'))
      .toThrow(/save revision/i);
  });
});
