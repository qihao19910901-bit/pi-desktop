// settings-window.js - 设置窗口（P2-1：开机自启/全局快捷键/更新/诊断）
const path = require('node:path');
const { BrowserWindow, ipcMain, globalShortcut } = require('electron');

// 全局快捷键：显示/隐藏主窗口
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+P';

// 纯逻辑：构建设置 handler（可测）
function createSettingsHandlers({
  app,
  shell,
  getLoginSettings = () => ({ openAtLogin: false }),
  setLoginSettings = () => {},
  isShortcutRegistered = () => false,
  registerShortcut = () => true,
  unregisterShortcut = () => {},
  showActiveWindow = () => {},
  getDiagnostics = () => ({ pid: null, restartCount: 0, stderr: [] }),
  checkUpdate = () => {},
  readVersions = () => ({}),
  port = 30141,
  updaterLogPath = '',
  clipboardApi = null,
} = {}) {
  let clipboard;
  if (clipboardApi) {
    clipboard = clipboardApi;
  } else {
    try { clipboard = require('electron').clipboard; } catch { clipboard = { writeText: () => {} }; }
  }
  return {
    async getState() {
      const login = getLoginSettings();
      return {
        desktopVersion: typeof app.getVersion === 'function' ? app.getVersion() : 'dev',
        port,
        autostartEnabled: Boolean(login.openAtLogin),
        shortcutEnabled: isShortcutRegistered(),
        shortcutLabel: TOGGLE_SHORTCUT,
        updaterLogPath,
        versions: readVersions(),
        piweb: getDiagnostics(),
      };
    },
    async setAutostart(enabled) {
      setLoginSettings({
        openAtLogin: Boolean(enabled),
        path: typeof app.getPath === 'function' ? process.execPath : undefined,
      });
      return { ok: true, enabled: Boolean(enabled) };
    },
    async setShortcut(enabled, { toggleWindow = showActiveWindow } = {}) {
      const want = Boolean(enabled);
      const currently = isShortcutRegistered();
      if (want === currently) return { ok: true, enabled: currently };
      if (want) {
        const ok = registerShortcut(TOGGLE_SHORTCUT, () => toggleWindow());
        if (!ok) throw new Error(`快捷键注册失败: ${TOGGLE_SHORTCUT}`);
        return { ok: true, enabled: true };
      }
      unregisterShortcut(TOGGLE_SHORTCUT);
      return { ok: true, enabled: false };
    },
    async openLogDir() {
      if (!updaterLogPath || typeof shell?.openPath !== 'function') {
        throw new Error('日志目录不可用');
      }
      return shell.openPath(path.dirname(updaterLogPath));
    },
    async checkUpdate() {
      checkUpdate();
      return { ok: true };
    },
    async copyDiagnostics() {
      const state = await this.getState();
      const lines = [
        'Pi Desktop 诊断信息',
        `桌面版本: ${state.desktopVersion}`,
        `端口: ${state.port}`,
        `开机自启: ${state.autostartEnabled ? '开' : '关'}`,
        `全局快捷键: ${state.shortcutEnabled ? '开' : '关'} (${state.shortcutLabel})`,
        `pi-web 进程: ${state.piweb.pid ? '运行中 (pid ' + state.piweb.pid + ')' : '未运行'}`,
        `重启次数: ${state.piweb.restartCount}`,
        `updater 日志: ${state.updaterLogPath || '（无）'}`,
      ];
      for (const [k, v] of Object.entries(state.versions)) {
        if (v) lines.push(`${k}: ${v}`);
      }
      if (state.piweb.stderr && state.piweb.stderr.length > 0) {
        lines.push('pi-web stderr 尾部:');
        lines.push(state.piweb.stderr.slice(-5).join('\n'));
      }
      clipboard.writeText(lines.join('\n'));
      return { ok: true, length: lines.join('\n').length };
    },
  };
}

let settingsWindow = null;

function createSettingsWindow({ projectRoot, app, shell, handlers } = {}) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const win = new BrowserWindow({
    width: 620,
    height: 560,
    minWidth: 520,
    minHeight: 480,
    title: '设置 - Pi Desktop',
    backgroundColor: '#1e1e2e',
    icon: path.join(projectRoot, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow = win;
  win.on('closed', () => { settingsWindow = null; });

  // 幂等注册 IPC
  for (const channel of [
    'settings:get-state', 'settings:set-autostart', 'settings:set-shortcut',
    'settings:open-log-dir', 'settings:check-update', 'settings:copy-diagnostics',
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('settings:get-state', () => handlers.getState());
  ipcMain.handle('settings:set-autostart', (_e, enabled) => handlers.setAutostart(enabled));
  ipcMain.handle('settings:set-shortcut', (_e, enabled) => handlers.setShortcut(enabled));
  ipcMain.handle('settings:open-log-dir', () => handlers.openLogDir());
  ipcMain.handle('settings:check-update', () => handlers.checkUpdate());
  ipcMain.handle('settings:copy-diagnostics', () => handlers.copyDiagnostics());

  win.loadFile(path.join(__dirname, 'settings.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

function destroySettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.destroy();
  }
  settingsWindow = null;
}

module.exports = {
  createSettingsWindow,
  destroySettingsWindow,
  createSettingsHandlers,
  TOGGLE_SHORTCUT,
};
