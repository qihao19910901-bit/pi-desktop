// terminal-preload.js - 终端窗口 preload 桥（sandbox 兼容）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piTerminal', {
  getShells: () => ipcRenderer.invoke('terminal:get-shells'),
  listTabs: () => ipcRenderer.invoke('terminal:list-tabs'),
  spawn: (opts) => ipcRenderer.invoke('terminal:spawn', opts),
  input: (id, data) => ipcRenderer.invoke('terminal:input', id, data),
  confirmDanger: (id) => ipcRenderer.invoke('terminal:confirm-danger', id),
  cancelDanger: (id) => ipcRenderer.invoke('terminal:cancel-danger', id),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  closeTab: (id) => ipcRenderer.invoke('terminal:close-tab', id),
  getXtermBase: () => ipcRenderer.invoke('terminal:xterm-base'),
  onOutput: (cb) => ipcRenderer.on('terminal:output', (_e, id, data) => cb(id, data)),
  onExit: (cb) => ipcRenderer.on('terminal:exit', (_e, id, code) => cb(id, code)),
  onDanger: (cb) => ipcRenderer.on('terminal:danger', (_e, id, line) => cb(id, line)),
});
