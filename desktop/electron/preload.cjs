const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buildxDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getAIStatus: () => ipcRenderer.invoke('ai:get-status'),
  testAIConnection: () => ipcRenderer.invoke('ai:test-connection'),
  generateProjectPlan: (projectId, payload) => ipcRenderer.invoke('plans:generate', projectId, payload),
  listProjectPlans: (projectId) => ipcRenderer.invoke('plans:list', projectId),
  getProjectPlan: (projectId, planId) => ipcRenderer.invoke('plans:get', projectId, planId),
  saveProjectPlan: (projectId, plan) => ipcRenderer.invoke('plans:save', projectId, plan),
  updateProjectPlan: (projectId, planId, plan) => ipcRenderer.invoke('plans:update', projectId, planId, plan),
  deleteProjectPlan: (projectId, planId) => ipcRenderer.invoke('plans:delete', projectId, planId),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (projectId) => ipcRenderer.invoke('projects:get', projectId),
  createProject: (project) => ipcRenderer.invoke('projects:create', project),
  updateProject: (projectId, project) => ipcRenderer.invoke('projects:update', projectId, project),
  deleteProject: (projectId) => ipcRenderer.invoke('projects:delete', projectId),
  chooseProjectDirectory: (projectId) => ipcRenderer.invoke('workspace:choose-directory', projectId),
  listWorkspaceDirectory: (projectId, relativePath = '') => ipcRenderer.invoke('workspace:list', projectId, relativePath),
  readWorkspaceText: (projectId, relativePath) => ipcRenderer.invoke('workspace:read-text', projectId, relativePath),
  writeWorkspaceText: (projectId, relativePath, content, revision) => ipcRenderer.invoke('workspace:write-text', projectId, relativePath, content, revision),
  createWorkspaceFile: (projectId, relativePath) => ipcRenderer.invoke('workspace:create-file', projectId, relativePath),
  createWorkspaceFolder: (projectId, relativePath) => ipcRenderer.invoke('workspace:create-folder', projectId, relativePath),
  moveWorkspaceItem: (projectId, fromPath, toPath) => ipcRenderer.invoke('workspace:move', projectId, fromPath, toPath),
  deleteWorkspaceItem: (projectId, relativePath) => ipcRenderer.invoke('workspace:delete', projectId, relativePath),
  refreshProjectIndex: (projectId) => ipcRenderer.invoke('context:index-refresh', projectId),
  getProjectIndexStatus: (projectId) => ipcRenderer.invoke('context:index-status', projectId),
  listProjectIndexedFiles: (projectId) => ipcRenderer.invoke('context:index-files', projectId),
  searchProjectContext: (projectId, query, limit = 8) => ipcRenderer.invoke('context:search', projectId, query, limit),
  createConversation: (projectId) => ipcRenderer.invoke('conversations:create', projectId),
  listConversations: (projectId) => ipcRenderer.invoke('conversations:list', projectId),
  getConversation: (projectId, conversationId) => ipcRenderer.invoke('conversations:get', projectId, conversationId),
  sendConversationMessage: (projectId, conversationId, requestId, content) => ipcRenderer.invoke(
    'conversations:send', projectId, conversationId, requestId, content,
  ),
  deleteConversation: (projectId, conversationId) => ipcRenderer.invoke('conversations:delete', projectId, conversationId),
  generateChangeProposal: (projectId, payload) => ipcRenderer.invoke('proposals:generate', projectId, payload),
  listChangeProposals: (projectId) => ipcRenderer.invoke('proposals:list', projectId),
  getChangeProposal: (projectId, proposalId) => ipcRenderer.invoke('proposals:get', projectId, proposalId),
  approveChangeProposal: (projectId, proposalId) => ipcRenderer.invoke('proposals:approve', projectId, proposalId),
  rejectChangeProposal: (projectId, proposalId) => ipcRenderer.invoke('proposals:reject', projectId, proposalId),
  applyApprovedChangeProposal: (projectId, proposalId) => ipcRenderer.invoke('proposals:apply', projectId, proposalId),
  startTerminalProcess: (projectId, payload) => ipcRenderer.invoke('terminal:start', projectId, payload),
  listTerminalProcesses: (projectId) => ipcRenderer.invoke('terminal:list', projectId),
  stopTerminalProcess: (projectId, sessionId) => ipcRenderer.invoke('terminal:stop', projectId, sessionId),
  onTerminalEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A terminal event callback is required.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.removeListener('terminal:event', listener);
  },
  discoverTestCommands: (projectId) => ipcRenderer.invoke('testing:discover', projectId),
  startTestProcess: (projectId, payload) => ipcRenderer.invoke('testing:start', projectId, payload),
}));
