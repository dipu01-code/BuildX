const { contextBridge, ipcRenderer } = require('electron');

// Electron prefixes main-process errors with "Error invoking remote method '<channel>': Error: "; show only the message.
async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = String(error?.message || '').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
    throw new Error(message || 'The request could not be completed.');
  }
}

contextBridge.exposeInMainWorld('buildxDesktop', Object.freeze({
  getAppInfo: () => invoke('app:get-info'),
  getAIStatus: () => invoke('ai:get-status'),
  testAIConnection: () => invoke('ai:test-connection'),
  generateProjectPlan: (projectId, payload) => invoke('plans:generate', projectId, payload),
  listProjectPlans: (projectId) => invoke('plans:list', projectId),
  getProjectPlan: (projectId, planId) => invoke('plans:get', projectId, planId),
  saveProjectPlan: (projectId, plan) => invoke('plans:save', projectId, plan),
  updateProjectPlan: (projectId, planId, plan) => invoke('plans:update', projectId, planId, plan),
  deleteProjectPlan: (projectId, planId) => invoke('plans:delete', projectId, planId),
  listProjects: () => invoke('projects:list'),
  getProject: (projectId) => invoke('projects:get', projectId),
  createProject: (project) => invoke('projects:create', project),
  updateProject: (projectId, project) => invoke('projects:update', projectId, project),
  deleteProject: (projectId) => invoke('projects:delete', projectId),
  chooseProjectDirectory: (projectId) => invoke('workspace:choose-directory', projectId),
  listWorkspaceDirectory: (projectId, relativePath = '') => invoke('workspace:list', projectId, relativePath),
  readWorkspaceText: (projectId, relativePath) => invoke('workspace:read-text', projectId, relativePath),
  writeWorkspaceText: (projectId, relativePath, content, revision) => invoke('workspace:write-text', projectId, relativePath, content, revision),
  createWorkspaceFile: (projectId, relativePath) => invoke('workspace:create-file', projectId, relativePath),
  createWorkspaceFolder: (projectId, relativePath) => invoke('workspace:create-folder', projectId, relativePath),
  moveWorkspaceItem: (projectId, fromPath, toPath) => invoke('workspace:move', projectId, fromPath, toPath),
  deleteWorkspaceItem: (projectId, relativePath) => invoke('workspace:delete', projectId, relativePath),
  refreshProjectIndex: (projectId) => invoke('context:index-refresh', projectId),
  getProjectIndexStatus: (projectId) => invoke('context:index-status', projectId),
  listProjectIndexedFiles: (projectId) => invoke('context:index-files', projectId),
  searchProjectContext: (projectId, query, limit = 8) => invoke('context:search', projectId, query, limit),
  createConversation: (projectId) => invoke('conversations:create', projectId),
  listConversations: (projectId) => invoke('conversations:list', projectId),
  getConversation: (projectId, conversationId) => invoke('conversations:get', projectId, conversationId),
  sendConversationMessage: (projectId, conversationId, requestId, content) => invoke(
    'conversations:send', projectId, conversationId, requestId, content,
  ),
  deleteConversation: (projectId, conversationId) => invoke('conversations:delete', projectId, conversationId),
  generateChangeProposal: (projectId, payload) => invoke('proposals:generate', projectId, payload),
  listChangeProposals: (projectId) => invoke('proposals:list', projectId),
  getChangeProposal: (projectId, proposalId) => invoke('proposals:get', projectId, proposalId),
  approveChangeProposal: (projectId, proposalId) => invoke('proposals:approve', projectId, proposalId),
  rejectChangeProposal: (projectId, proposalId) => invoke('proposals:reject', projectId, proposalId),
  applyApprovedChangeProposal: (projectId, proposalId) => invoke('proposals:apply', projectId, proposalId),
  startTerminalProcess: (projectId, payload) => invoke('terminal:start', projectId, payload),
  listTerminalProcesses: (projectId) => invoke('terminal:list', projectId),
  stopTerminalProcess: (projectId, sessionId) => invoke('terminal:stop', projectId, sessionId),
  onTerminalEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A terminal event callback is required.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.removeListener('terminal:event', listener);
  },
  discoverTestCommands: (projectId) => invoke('testing:discover', projectId),
  startTestProcess: (projectId, payload) => invoke('testing:start', projectId, payload),
  getGitStatus: (projectId) => invoke('git:status', projectId),
  getGitDiff: (projectId, relativePath, staged) => invoke('git:diff', projectId, relativePath, staged),
  stageGitPaths: (projectId, paths) => invoke('git:stage', projectId, paths),
  unstageGitPaths: (projectId, paths) => invoke('git:unstage', projectId, paths),
  commitGit: (projectId, payload) => invoke('git:commit', projectId, payload),
  getSettings: () => invoke('settings:get'),
  patchSettings: (patch) => invoke('settings:patch', patch),
  resetSettings: () => invoke('settings:reset'),
  getSettingsHealth: () => invoke('settings:health'),
}));
