const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buildxDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
}));
