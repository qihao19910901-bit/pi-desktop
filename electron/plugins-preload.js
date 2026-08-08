// plugins-preload.js - 插件管理窗口的 preload 桥（sandbox 兼容：只依赖 electron）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piDesktop', {
  listPlugins: (cwd) => ipcRenderer.invoke('plugins:list', cwd),
  runAction: (payload) => ipcRenderer.invoke('plugins:action', payload),
  getDefaultCwd: () => ipcRenderer.invoke('plugins:default-cwd'),
});
