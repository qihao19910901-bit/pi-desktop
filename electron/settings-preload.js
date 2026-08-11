// settings-preload.js - 设置窗口 preload 桥（sandbox 兼容）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piSettings', {
  getState: () => ipcRenderer.invoke('settings:get-state'),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  setShortcut: (enabled) => ipcRenderer.invoke('settings:set-shortcut', enabled),
  openLogDir: () => ipcRenderer.invoke('settings:open-log-dir'),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),
  copyDiagnostics: () => ipcRenderer.invoke('settings:copy-diagnostics'),
  configList: () => ipcRenderer.invoke('settings:config-list'),
  configRead: (name) => ipcRenderer.invoke('settings:config-read', name),
  configWrite: (name, content) => ipcRenderer.invoke('settings:config-write', name, content),
  sessionScan: () => ipcRenderer.invoke('settings:session-scan'),
  sessionImport: (payload) => ipcRenderer.invoke('settings:session-import', payload),
});
