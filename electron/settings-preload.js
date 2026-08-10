// settings-preload.js - 设置窗口 preload 桥（sandbox 兼容）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piSettings', {
  getState: () => ipcRenderer.invoke('settings:get-state'),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  setShortcut: (enabled) => ipcRenderer.invoke('settings:set-shortcut', enabled),
  openLogDir: () => ipcRenderer.invoke('settings:open-log-dir'),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),
  copyDiagnostics: () => ipcRenderer.invoke('settings:copy-diagnostics'),
});
