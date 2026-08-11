// main.js - Electron 主进程（多窗口版）
// 职责：多窗口管理、pi-web 生命周期、托盘集成、窗口记忆、外链拦截
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
} = require('electron');
const { execFile, spawn } = require('node:child_process');
const path = require('path');
const fs = require('fs');
const { buildPiWebLaunchSpec, parsePort } = require('./piweb-runtime');
const { createPiWebService, waitForPiWeb } = require('./piweb-service');
const { escapeHtml } = require('./safe-html');
const { createTray, destroyTray } = require('./tray');
const { initUpdater, checkForUpdatesManual } = require('./updater');
const { createPluginsWindow, destroyPluginsWindow } = require('./plugins-window');
const { createTemplatesWindow, destroyTemplatesWindow } = require('./templates-window');
const { createSettingsWindow, destroySettingsWindow, createSettingsHandlers, TOGGLE_SHORTCUT } = require('./settings-window');
const { createTerminalWindow, destroyTerminalWindow } = require('./terminal-window');
const { accountLabel, buildWindowTitle, ACCOUNT_BADGE_HTML } = require('./window-meta');

const PROJECT_ROOT = path.join(__dirname, '..');
const PORT = parsePort(process.env.PI_WEB_PORT);
const PIWEB_URL = `http://127.0.0.1:${PORT}`;
const SMOKE_MODE = process.env.PI_DESKTOP_SMOKE === '1';

// 开发时 userData 放项目内 F 盘（避免 C 盘）；打包后用 Electron 默认（AppData）
if (SMOKE_MODE) {
  if (!process.env.PI_DESKTOP_USER_DATA) throw new Error('PI_DESKTOP_USER_DATA is required in smoke mode');
  app.setPath('userData', path.resolve(process.env.PI_DESKTOP_USER_DATA));
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(PROJECT_ROOT, '.userdata'));
}
const USERDATA_DIR = app.getPath('userData');
const STATE_FILE = path.join(USERDATA_DIR, 'window-state.json');

// 多窗口管理
const windows = new Set();
let mainWindow = null; // 主窗口（窗口记忆用，第一个创建的窗口）
let piwebReady = false;
let quitCleanupStarted = false;
let quitCleanupComplete = false;

function stopTree(pid) {
  if (!Number.isInteger(pid) || pid < 1) {
    return Promise.reject(new Error(`invalid owned pid: ${pid}`));
  }
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGTERM');
      return Promise.resolve();
    } catch (error) {
      if (error.code === 'ESRCH') return Promise.resolve();
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    execFile(
      'taskkill',
      ['/pid', String(pid), '/f', '/t'],
      { windowsHide: true, timeout: 10000 },
      (error) => error ? reject(error) : resolve(),
    );
  });
}

const piwebService = createPiWebService({
  spawnImpl: (command, args, options) => spawn(command, args, {
    ...options,
    windowsHide: true,
    shell: false,
  }),
  waitForReady: (url) => waitForPiWeb(url),
  stopTree,
});

function buildLaunchSpec() {
  return {
    ...buildPiWebLaunchSpec({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      developmentEntry: app.isPackaged ? undefined : require.resolve('@agegr/pi-web/bin/pi-web.js'),
      execPath: process.execPath,
      userDataDir: USERDATA_DIR,
      port: PORT,
      env: process.env,
    }),
    url: PIWEB_URL,
  };
}

// ============ 单实例锁 ============
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 第二实例：显示活跃窗口（无则新建）
    const win = BrowserWindow.getFocusedWindow() || mainWindow || windows.values().next().value;
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
  app.whenReady().then(bootstrap);
}

// ============ 启动流程 ============
async function bootstrap() {
  setAppMenu();
  createWindow();
  if (!SMOKE_MODE) initUpdater();
  initSettings();
  // smoke 测试钩子：自动打开终端窗口（仅 CI/本地验证用）
  if (SMOKE_MODE && process.env.PI_SMOKE_OPEN_TERMINAL === '1') {
    createTerminalWindow({ projectRoot: PROJECT_ROOT });
  }
  createTray({
    onNewWindow: () => createWindow(),
    onNewSession: () => {
      const w = BrowserWindow.getFocusedWindow() || mainWindow;
      if (w) w.webContents.send('menu-new-session');
    },
  });
  try {
    await piwebService.start(buildLaunchSpec());
  } catch (err) {
    console.error('[main] pi-web 启动失败:', err.message);
    showErrorPage('Pi 服务启动失败，请检查 API Key 配置或重试。\n错误: ' + err.message);
    return;
  }
  piwebReady = true;
  for (const w of windows) {
    if (!w.isDestroyed()) {
      w.loadURL(PIWEB_URL).catch((error) => console.error('[main] 窗口加载失败:', error.message));
    }
  }
}

// ============ 窗口管理（多窗口） ============
function createWindow(opts = {}) {
  const bounds = loadState().bounds || {};
  const account = accountLabel(opts.partition);
  const win = new BrowserWindow({
    width: bounds.width || 1280,
    height: bounds.height || 820,
    x: typeof bounds.x === 'number' ? bounds.x + (windows.size * 30) % 200 : undefined,
    y: typeof bounds.y === 'number' ? bounds.y + (windows.size * 30) % 200 : undefined,
    minWidth: 900,
    minHeight: 600,
    title: buildWindowTitle(account, 'Pi Desktop'),
    backgroundColor: '#1e1e2e',
    icon: path.join(PROJECT_ROOT, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 多账号会话隔离：不同 partition 隔离 cookie/localStorage = 不同 pi-web 账号
      ...(opts.partition ? { partition: opts.partition } : {}),
    },
  });

  // 标题：阻止页面覆盖，改为「账号 - 页面标题」组合
  win.on('page-title-updated', (event, pageTitle) => {
    event.preventDefault();
    win.setTitle(buildWindowTitle(account, pageTitle));
  });

  // 账号窗口：加载完成后注入状态角标
  if (account) {
    win.webContents.on('did-finish-load', () => {
      try {
        win.webContents.executeJavaScript(
          `(function(){
            if (document.getElementById('pi-account-badge')) return;
            const div = document.createElement('div');
            div.id = 'pi-account-badge';
            div.innerHTML = ${JSON.stringify(ACCOUNT_BADGE_HTML(account))};
            document.body.appendChild(div);
          })()`,
        ).catch(() => {});
      } catch (error) {
        console.error('[window] 角标注入失败:', error.message);
      }
    });
  }

  windows.add(win);
  if (!mainWindow) mainWindow = win;

  // 加载：pi-web 已就绪直接加载，否则 loading 页
  if (piwebReady) {
    win.loadURL(PIWEB_URL);
  } else {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
  }

  win.once('ready-to-show', () => win.show());

  // 窗口位置记忆（只记主窗口，避免多窗口互相覆盖）
  if (win === mainWindow) {
    const persistBounds = () => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      const b = mainWindow.getBounds();
      updateState((s) => ({ ...s, bounds: b }));
    };
    win.on('resize', persistBounds);
    win.on('move', persistBounds);
  }

  // 关闭逻辑：最后一个窗口最小化到托盘；其他正常关闭；真正退出时全关
  win.on('close', (e) => {
    if (!app.isQuiting && windows.size === 1) {
      e.preventDefault();
      if (!win.isDestroyed()) win.hide();
    }
  });

  win.on('closed', () => {
    windows.delete(win);
    if (win === mainWindow) {
      // 主窗口关闭，选下一个为主窗口
      mainWindow = windows.values().next().value || null;
    }
  });

  // 阻止默认标题更新
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle('Pi Desktop');
  });

  return win;
}

function showErrorPage(msg) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win || win.isDestroyed()) return;
  const safeMsg = escapeHtml(msg);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Microsoft YaHei',sans-serif;background:#1e1e2e;color:#e5e5e5;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center}
    .icon{font-size:48px;margin-bottom:16px}
    h1{color:#f38ba8;margin:0 0 12px}
    p{white-space:pre-wrap;line-height:1.6;max-width:500px}
    button{margin-top:20px;padding:10px 24px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:6px;font-size:14px;cursor:pointer}
    button:hover{background:#74c7ec}
  </style></head><body><div class="icon">⚠️</div><h1>启动失败</h1><p>${safeMsg}</p><button onclick="location.reload()">重试</button></body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ============ 打印 / PDF 导出 ============
function printCurrent() {
  const w = BrowserWindow.getFocusedWindow();
  if (!w) return;
  w.webContents.print({ printBackground: true }, (success, failureReason) => {
    if (!success) console.error('[print] 失败:', failureReason);
  });
}

async function exportPDF() {
  const w = BrowserWindow.getFocusedWindow();
  if (!w) return;
  const { dialog } = require('electron');
  try {
    const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    const { filePath } = await dialog.showSaveDialog(w, {
      title: '导出 PDF',
      defaultPath: 'pi-desktop-export.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (filePath) {
      require('fs').writeFileSync(filePath, pdf);
      dialog.showMessageBox(w, { type: 'info', title: '导出成功', message: 'PDF 已保存', detail: filePath });
    }
  } catch (e) {
    dialog.showErrorBox('导出 PDF 失败', e.message);
  }
}

function readComponentVersion(label, ...packageParts) {
  const nodeModulesDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    : path.join(PROJECT_ROOT, 'node_modules');
  const packageFile = path.join(nodeModulesDir, ...packageParts, 'package.json');
  try {
    const { version } = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    if (typeof version !== 'string' || version.length === 0) {
      throw new Error('package version is missing');
    }
    return `${label} ${version}`;
  } catch (error) {
    console.error(`[about] ${label} 版本读取失败 (${packageFile}):`, error.message);
    return null;
  }
}

// ============ 应用菜单 ============
function setAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建窗口',
          submenu: [
            { label: '默认账号', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
            { type: 'separator' },
            { label: '账号 1（隔离会话）', click: () => createWindow({ partition: 'persist:account-1' }) },
            { label: '账号 2（隔离会话）', click: () => createWindow({ partition: 'persist:account-2' }) },
            { label: '账号 3（隔离会话）', click: () => createWindow({ partition: 'persist:account-3' }) },
          ],
        },
        { label: '新建会话', accelerator: 'CmdOrCtrl+N', click: () => {
          const w = BrowserWindow.getFocusedWindow();
          if (w) w.webContents.send('menu-new-session');
        }},
        { type: 'separator' },
        { label: '关闭窗口', accelerator: 'CmdOrCtrl+W', click: () => {
          const w = BrowserWindow.getFocusedWindow();
          if (w) w.close();
        }},
        { type: 'separator' },
        { label: '打印...', accelerator: 'CmdOrCtrl+P', click: () => printCurrent() },
        { label: '导出 PDF...', click: () => exportPDF() },
        { type: 'separator' },
        { label: '退出', accelerator: isMac ? 'Cmd+Q' : 'Alt+F4', click: () => { app.isQuiting = true; app.quit(); } },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '工具',
      submenu: [
        { label: '插件管理…', click: () => createPluginsWindow({ port: PORT, projectRoot: PROJECT_ROOT }) },
        { label: '提示词模板…', click: () => createTemplatesWindow({ projectRoot: PROJECT_ROOT }) },
        { label: '终端…', click: () => createTerminalWindow({ projectRoot: PROJECT_ROOT }) },
        { type: 'separator' },
        { label: '设置…', click: () => openSettingsWindow() },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新...', click: () => checkForUpdatesManual() },
        { label: '关于 Pi Desktop', click: () => {
          const { dialog } = require('electron');
          const detail = [
            'pi-web 的 Electron 桌面封装',
            `Desktop ${app.getVersion()}`,
            readComponentVersion('pi-web', '@agegr', 'pi-web'),
            readComponentVersion('Pi', '@earendil-works', 'pi-coding-agent'),
            '',
            'Pi: 开源终端 AI 编程 Agent',
          ].filter((line) => line !== null).join('\n');
          dialog.showMessageBox(BrowserWindow.getFocusedWindow() || mainWindow, {
            type: 'info',
            title: '关于',
            message: 'Pi Desktop',
            detail,
          });
        }},
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============ 状态持久化（窗口位置/大小） ============
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[state] 读取失败:', e.message);
  }
  return {};
}

function updateState(updater) {
  try {
    fs.mkdirSync(USERDATA_DIR, { recursive: true });
    const cur = loadState();
    const next = updater(cur);
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch (e) {
    console.error('[state] 写入失败:', e.message);
  }
}

// ============ 设置（P2-1：开机自启/全局快捷键/更新/诊断） ============
let globalShortcutEnabled = false;
let settingsHandlers = null;

function initSettings() {
  const showMain = () => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x !== settingsHandlers?.__window);
    if (w) { if (w.isMinimized()) w.restore(); if (!w.isVisible()) w.show(); w.focus(); }
  };
  settingsHandlers = createSettingsHandlers({
    app,
    shell,
    getLoginSettings: () => app.getLoginItemSettings(),
    setLoginSettings: (opts) => app.setLoginItemSettings(opts),
    isShortcutRegistered: () => globalShortcutEnabled,
    registerShortcut: (accelerator, callback) => {
      const ok = globalShortcut.register(accelerator, callback);
      if (ok) globalShortcutEnabled = true;
      return ok;
    },
    unregisterShortcut: (accelerator) => {
      globalShortcut.unregister(accelerator);
      globalShortcutEnabled = false;
    },
    showActiveWindow: showMain,
    getDiagnostics: () => piwebService.getDiagnostics(),
    checkUpdate: () => checkForUpdatesManual(),
    readVersions: () => ({
      'pi-web': readComponentVersion('pi-web', '@agegr', 'pi-web'),
      'Pi': readComponentVersion('Pi', '@earendil-works', 'pi-coding-agent'),
    }),
    port: PORT,
    updaterLogPath: path.join(app.getPath('userData'), 'updater.log'),
  });

  // 恢复快捷键状态（window-state.json）
  const saved = loadState();
  if (saved.globalShortcut === true && !SMOKE_MODE) {
    try {
      settingsHandlers.setShortcut(true).catch((error) => {
        console.error('[settings] 快捷键恢复失败:', error.message);
      });
    } catch (error) {
      console.error('[settings] 快捷键恢复失败:', error.message);
    }
  }
}

function openSettingsWindow() {
  if (!settingsHandlers) initSettings();
  const win = createSettingsWindow({ projectRoot: PROJECT_ROOT, app, shell, handlers: settingsHandlers });
  // 记住快捷键开关状态
  win.once('closed', () => {
    if (settingsHandlers) {
      settingsHandlers.getState().then((s) => {
        updateState((cur) => ({ ...cur, globalShortcut: s.shortcutEnabled }));
      }).catch(() => {});
    }
  });
  return win;
}

// ============ @ 文件引用（preload 补全用） ============
ipcMain.handle('shell:list-cwd', () => {
  // 列出当前项目目录（信任目录第一个）的文件/目录名
  const cwd = resolveDefaultCwd();
  try {
    return fs.readdirSync(cwd, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => e.isDirectory() ? e.name + '/' : e.name)
      .slice(0, 200);
  } catch (error) {
    console.error('[main] list-cwd 失败:', error.message);
    return [];
  }
});

// ============ 外链拦截 ============
ipcMain.on('open-external', (_event, value) => {
  try {
    if (typeof value !== 'string') throw new TypeError('URL must be a string');
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.error('[open-external] 已拒绝协议:', url.protocol);
      return;
    }
    shell.openExternal(url.href).catch((error) => {
      console.error('[open-external] 打开失败:', error.message);
    });
  } catch (error) {
    console.error('[open-external] URL 解析失败:', error.message);
  }
});

// ============ 退出处理 ============
app.on('before-quit', (event) => {
  app.isQuiting = true;
  if (quitCleanupComplete) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  console.log('[main] before-quit, 杀 pi-web');
  try {
    destroyTray();
    destroyPluginsWindow();
    destroyTemplatesWindow();
    destroySettingsWindow();
    destroyTerminalWindow();
    if (globalShortcutEnabled) {
      try { globalShortcut.unregister(TOGGLE_SHORTCUT); } catch (error) { /* 忽略 */ }
    }
  } catch (error) {
    console.error('[main] 托盘销毁失败:', error.message);
  }
  piwebService.stop()
    .catch((error) => console.error('[main] pi-web 停止失败:', error.message))
    .finally(() => {
      quitCleanupComplete = true;
      app.quit();
    });
});

app.on('window-all-closed', () => {
  // 所有窗口关闭：托盘保活，不退出。除非 pi-web 没起来（异常）
  if (!piwebReady && piwebService.getDiagnostics().pid === null) {
    app.quit();
  }
});

app.on('activate', () => {
  // mac 点 dock：无窗口则新建
  if (windows.size === 0) {
    createWindow();
  } else {
    const w = mainWindow || windows.values().next().value;
    if (w) { w.show(); w.focus(); }
  }
});

// ============ Loading 页 HTML ============
const LOADING_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Microsoft YaHei',-apple-system,sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;overflow:hidden}
  .logo{width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#89b4fa,#cba6f7);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:bold;color:#1e1e2e;margin-bottom:24px;box-shadow:0 8px 32px rgba(137,180,250,0.3)}
  .title{font-size:22px;font-weight:600;margin-bottom:8px}
  .subtitle{font-size:13px;color:#6c7086;margin-bottom:32px}
  .spinner{width:32px;height:32px;border:3px solid #313244;border-top-color:#89b4fa;border-radius:50%;animation:spin 0.9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
  <div class="logo">π</div>
  <div class="title">Pi Desktop</div>
  <div class="subtitle">正在启动 Pi 服务...</div>
  <div class="spinner"></div>
</body></html>`;
