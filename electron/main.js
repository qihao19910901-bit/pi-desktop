// main.js - Electron 主进程（多窗口版）
// 职责：多窗口管理、pi-web 生命周期、托盘集成、窗口记忆、外链拦截
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  session,
} = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { createTray, destroyTray } = require('./tray');
const { initUpdater, checkForUpdatesManual } = require('./updater');

const PROJECT_ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PI_WEB_PORT || '30141', 10);
const PIWEB_URL = `http://localhost:${PORT}`;

// 开发时 userData 放项目内 F 盘（避免 C 盘）；打包后用 Electron 默认（AppData）
if (!app.isPackaged) {
  app.setPath('userData', path.join(PROJECT_ROOT, '.userdata'));
}
const USERDATA_DIR = app.getPath('userData');
const STATE_FILE = path.join(USERDATA_DIR, 'window-state.json');

// 多窗口管理
const windows = new Set();
let mainWindow = null; // 主窗口（窗口记忆用，第一个创建的窗口）
let piwebProcess = null;
let piwebReady = false;

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
  startPiWeb();
  createWindow();
  initUpdater();
  createTray({
    onNewWindow: () => createWindow(),
    onNewSession: () => {
      const w = BrowserWindow.getFocusedWindow() || mainWindow;
      if (w) w.webContents.send('menu-new-session');
    },
  });
  // 健康检查，就绪后所有窗口加载 pi-web
  waitForPiWeb(PIWEB_URL, 60000)
    .then(() => {
      piwebReady = true;
      for (const w of windows) {
        if (!w.isDestroyed()) w.loadURL(PIWEB_URL);
      }
    })
    .catch((err) => {
      console.error('[main] pi-web 启动失败:', err.message);
      showErrorPage('Pi 服务启动失败，请检查 API Key 配置或重试。\n错误: ' + err.message);
    });
}

// ============ pi-web 服务管理 ============
function startPiWeb() {
  let piwebEntry;
  if (app.isPackaged) {
    piwebEntry = path.join(process.resourcesPath, 'node_modules', '@agegr', 'pi-web', 'bin', 'pi-web.js');
  } else {
    try {
      piwebEntry = require.resolve('@agegr/pi-web/bin/pi-web.js');
    } catch (e) {
      console.error('[pi-web] 找不到 @agegr/pi-web 入口:', e.message);
      return;
    }
  }
  if (!fs.existsSync(piwebEntry)) {
    console.error('[pi-web] 入口文件不存在:', piwebEntry);
    return;
  }

  const piwebCwd = app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
  // polyfill worker_threads.markAsUncloneable（Node v24+ API，Electron Node v20 缺，undici 需要）
  const polyfillPath = path.join(__dirname, 'piweb-polyfill.js');

  // dev 用系统 Node v24（解决 Electron Node v20 undici 缺 markAsUncloneable）
  // 打包后用 electron + ELECTRON_RUN_AS_NODE（后续内嵌 Node v24 彻底解决）
  const nodeExe = app.isPackaged ? process.execPath : 'I:\\NODE\\node.exe';
  const nodeEnv = app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {};
  piwebProcess = spawn(nodeExe, ['-r', polyfillPath, piwebEntry, '--hostname', '0.0.0.0', '--port', String(PORT), '--no-open'], {
    cwd: piwebCwd,
    env: {
      ...process.env,
      ...nodeEnv,
      PI_WEB_NO_OPEN: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    windowsHide: true,
    shell: false,
  });

  piwebProcess.stdout.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.log('[pi-web]', s);
  });
  piwebProcess.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.error('[pi-web]', s);
  });
  piwebProcess.on('exit', (code, sig) => {
    console.log(`[pi-web] 进程退出 code=${code} sig=${sig}`);
    piwebProcess = null;
  });

  console.log('[pi-web] 已启动, pid=', piwebProcess.pid, 'entry=', piwebEntry);
}

function killPiWeb() {
  if (!piwebProcess) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${piwebProcess.pid} /f /t`, { stdio: 'ignore' });
    } else {
      piwebProcess.kill('SIGTERM');
    }
  } catch (e) {
    console.error('[pi-web] kill 失败:', e.message);
  }
  piwebProcess = null;
}

function waitForPiWeb(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`等待 ${timeoutMs}ms 超时`));
        else setTimeout(check, 500);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`等待 ${timeoutMs}ms 超时`));
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

// ============ 窗口管理（多窗口） ============
function createWindow(opts = {}) {
  const bounds = loadState().bounds || {};
  const win = new BrowserWindow({
    width: bounds.width || 1280,
    height: bounds.height || 820,
    x: typeof bounds.x === 'number' ? bounds.x + (windows.size * 30) % 200 : undefined,
    y: typeof bounds.y === 'number' ? bounds.y + (windows.size * 30) % 200 : undefined,
    minWidth: 900,
    minHeight: 600,
    title: 'Pi Desktop',
    backgroundColor: '#1e1e2e',
    icon: path.join(PROJECT_ROOT, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 多账号会话隔离：不同 partition 隔离 cookie/localStorage = 不同 pi-web 账号
      ...(opts.partition ? { partition: opts.partition } : {}),
    },
  });

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
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Microsoft YaHei',sans-serif;background:#1e1e2e;color:#e5e5e5;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center}
    .icon{font-size:48px;margin-bottom:16px}
    h1{color:#f38ba8;margin:0 0 12px}
    p{white-space:pre-wrap;line-height:1.6;max-width:500px}
    button{margin-top:20px;padding:10px 24px;background:#89b4fa;color:#1e1e2e;border:none;border-radius:6px;font-size:14px;cursor:pointer}
    button:hover{background:#74c7ec}
  </style></head><body><div class="icon">⚠️</div><h1>启动失败</h1><p>${msg}</p><button onclick="location.reload()">重试</button></body></html>`;
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
      label: '帮助',
      submenu: [
        { label: '检查更新...', click: () => checkForUpdatesManual() },
        { label: '关于 Pi Desktop', click: () => {
          const { dialog } = require('electron');
          dialog.showMessageBox(BrowserWindow.getFocusedWindow() || mainWindow, {
            type: 'info',
            title: '关于',
            message: 'Pi Desktop',
            detail: 'pi-web 的 Electron 桌面封装\n版本 1.1.0（多窗口）\n\nPi: 开源终端 AI 编程 Agent',
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

// ============ 外链拦截 ============
ipcMain.on('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

// ============ 退出处理 ============
app.on('before-quit', () => {
  app.isQuiting = true;
  console.log('[main] before-quit, 杀 pi-web');
  killPiWeb();
  destroyTray();
});

app.on('window-all-closed', () => {
  // 所有窗口关闭：托盘保活，不退出。除非 pi-web 没起来（异常）
  if (!piwebProcess && !piwebReady) {
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
