const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buildxDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
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
}));
