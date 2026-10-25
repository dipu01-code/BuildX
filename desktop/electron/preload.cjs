const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buildxDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  getProject: (projectId) => ipcRenderer.invoke('projects:get', projectId),
  createProject: (project) => ipcRenderer.invoke('projects:create', project),
  updateProject: (projectId, project) => ipcRenderer.invoke('projects:update', projectId, project),
  deleteProject: (projectId) => ipcRenderer.invoke('projects:delete', projectId),
}));
