const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { requestJson } = require('./piweb-fetch');
const { resolveDefaultCwd } = require('./default-cwd');

const VALID_ACTIONS = ['install', 'remove', 'update', 'disable', 'enable'];

// 容错：剥离常见命令前缀（pi install / npm install），防止用户把完整命令当来源填
function normalizeSource(source) {
  if (typeof source !== 'string') return source;
  const s = source.trim();
  const stripped = s.replace(/^(?:pi|npm)\s+install(?:\s+--[\w-]+(?:\s*=\s*\S+)?)*\s+/i, '');
  return stripped === s ? s : stripped.trim();
}

function assertCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cwd 不能为空');
  return cwd;
}

// 纯函数：构建插件 API handler（可测试）
function createPluginHandlers({ port, request = requestJson } = {}) {
  const base = `http://127.0.0.1:${port}`;
  return {
    async list(cwd) {
      const resolved = assertCwd(cwd);
      const url = `${base}/api/plugins?cwd=${encodeURIComponent(resolved)}`;
      return request(url, { method: 'GET' });
    },
    async action(payload) {
      const { action, source, scope } = payload || {};
      const cwd = payload && typeof payload.cwd === 'string' ? payload.cwd : null;
      assertCwd(cwd);
      if (!VALID_ACTIONS.includes(action)) throw new Error(`不支持的插件操作: ${action}`);
      if (source !== undefined && source !== null && typeof source !== 'string') {
        throw new Error('插件来源必须是字符串');
      }
      if (scope !== undefined && scope !== 'project' && scope !== 'global') {
        throw new Error('作用域只能是 project 或 global');
      }
      const body = { cwd, action };
      if (source) body.source = normalizeSource(source);
      if (scope) body.scope = scope;
      return request(`${base}/api/plugins`, { method: 'POST', body });
    },
    async defaultCwd() {
      return resolveDefaultCwd();
    },
  };
}
let pluginsWindow = null;

function createPluginsWindow({ port, projectRoot } = {}) {
  if (pluginsWindow && !pluginsWindow.isDestroyed()) {
    pluginsWindow.show();
    pluginsWindow.focus();
    return pluginsWindow;
  }

  const win = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 600,
    minHeight: 480,
    title: '插件管理 - Pi Desktop',
    backgroundColor: '#1e1e2e',
    icon: path.join(projectRoot, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'plugins-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  pluginsWindow = win;
  win.on('closed', () => { pluginsWindow = null; });

  const handlers = createPluginHandlers({ port });
  // 幂等注册：窗口关闭后再次打开时先移除旧 handler，避免重复注册异常
  for (const channel of ['plugins:list', 'plugins:action', 'plugins:default-cwd']) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('plugins:list', (_event, cwd) => handlers.list(cwd));
  ipcMain.handle('plugins:action', (_event, payload) => handlers.action(payload));
  ipcMain.handle('plugins:default-cwd', () => handlers.defaultCwd());

  win.loadFile(path.join(__dirname, 'plugins.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

function destroyPluginsWindow() {
  if (pluginsWindow && !pluginsWindow.isDestroyed()) {
    pluginsWindow.destroy();
  }
  pluginsWindow = null;
}

module.exports = { createPluginsWindow, destroyPluginsWindow, createPluginHandlers, VALID_ACTIONS, resolveDefaultCwd };
