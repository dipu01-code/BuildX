import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('preload desktop API', () => {
  it('exposes only scoped app and project actions from the sandbox-compatible preload', async () => {
    const invoke = vi.fn().mockResolvedValue({ name: 'BUILDX', version: '0.1.0' });
    const exposeInMainWorld = vi.fn();
    const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
    const electron = { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } };
    vm.runInNewContext(source, { require: () => electron, Object });
    const [globalName, api] = exposeInMainWorld.mock.calls[0];

    expect(globalName).toBe('buildxDesktop');
    expect(Object.keys(api)).toEqual([
      'getAppInfo', 'getAIStatus', 'testAIConnection', 'generateProjectPlan', 'listProjectPlans', 'getProjectPlan', 'saveProjectPlan', 'updateProjectPlan', 'deleteProjectPlan', 'listProjects', 'getProject', 'createProject', 'updateProject', 'deleteProject',
      'chooseProjectDirectory', 'listWorkspaceDirectory', 'readWorkspaceText', 'writeWorkspaceText',
      'createWorkspaceFile', 'createWorkspaceFolder', 'moveWorkspaceItem', 'deleteWorkspaceItem',
      'refreshProjectIndex', 'getProjectIndexStatus', 'listProjectIndexedFiles', 'searchProjectContext',
      'createConversation', 'listConversations', 'getConversation', 'sendConversationMessage', 'deleteConversation',
      'generateChangeProposal', 'listChangeProposals', 'getChangeProposal', 'approveChangeProposal', 'rejectChangeProposal', 'applyApprovedChangeProposal',
    ]);
    await api.getAppInfo();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('app:get-info');
    await api.getAIStatus();
    await api.testAIConnection();
    expect(invoke).toHaveBeenCalledWith('ai:get-status');
    expect(invoke).toHaveBeenCalledWith('ai:test-connection');
    expect(api.send).toBeUndefined();
    expect(api.invoke).toBeUndefined();
    expect(api.readFile).toBeUndefined();
  });
});
