// templates-preload.js - 提示词模板窗口的 preload 桥（sandbox 兼容）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piTemplates', {
  list: (cwd) => ipcRenderer.invoke('templates:list', cwd),
  newPath: (cwd, name, isProject) => ipcRenderer.invoke('templates:new-path', cwd, name, isProject),
  read: (cwd, filePath) => ipcRenderer.invoke('templates:read', cwd, filePath),
  write: (cwd, filePath, content) => ipcRenderer.invoke('templates:write', cwd, filePath, content),
  remove: (cwd, filePath) => ipcRenderer.invoke('templates:delete', cwd, filePath),
  getDefaultCwd: () => ipcRenderer.invoke('templates:default-cwd'),
});
