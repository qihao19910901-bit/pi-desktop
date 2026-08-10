// terminal-window.js - 内嵌终端窗口（P2-3）
// 架构：terminal.html (xterm.js) ←IPC→ 主进程 ←node-pty→ shell（ConPTY）
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { BrowserWindow, ipcMain } = require('electron');

// 危险命令模式（输入行命中时需确认）
const DANGEROUS_PATTERNS = [
  /rm\s+-\s*rf\b/i,          // rm -rf
  /rm\s+-\s*fr\b/i,          // rm -fr
  /\bformat\b/i,             // format
  /\bdiskpart\b/i,
  /\breg\s+delete\b/i,
  /\bdel\s+\/[a-z]*[fsq][a-z]*\b/i,  // del /f /s /q
  /\brd\s+\/[a-z]*[sq][a-z]*\b/i,    // rd /s /q
  /\brmdir\s+\/[a-z]*[sq][a-z]*\b/i,
  /\bshutdown\b/i,
  /\bmkfs\b|\bfdisk\b|\bdd\s+if=/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/i,   // curl | sh
  /\bwget\b[^|]*\|\s*(ba)?sh\b/i,
  /:\s*\(\s*\)\s*\{\s*:.*\|\s*:.*&\s*\}/s,  // fork bomb
];

function isDangerousCommand(line) {
  return DANGEROUS_PATTERNS.some((re) => re.test(line));
}

// 纯逻辑：行缓冲 + 危险检测（可测）
function createLineGuard() {
  let buffer = '';
  return {
    // 返回 { line, dangerous, pending }：pending=true 表示该行在等确认
    feed(data) {
      buffer += data;
      const lines = buffer.split(/\r|\n/);
      buffer = lines.pop() || '';
      const results = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        results.push({ line, dangerous: isDangerousCommand(line) });
      }
      return results;
    },
    // 确认后补写该行
    flushConfirmedLine(line) {
      return line + '\r';
    },
  };
}

// 纯逻辑：终端管理器（可测，注入 ptyFactory）
function createTerminalManager({ ptyFactory, killTree } = {}) {
  const tabs = new Map(); // id -> { id, shell, cwd, pty, guard, queue }
  let nextId = 1;

  return {
    listTabs() {
      return [...tabs.values()].map(({ id, shell, cwd }) => ({ id, shell, cwd }));
    },
    spawnTab({ shell, cwd, cols = 100, rows = 30, onData, onExit }) {
      const id = nextId++;
      const pty = ptyFactory.spawn(shell, shell.endsWith('cmd.exe') ? [] : [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      const tab = { id, shell, cwd, pty, guard: createLineGuard(), queue: null };
      tabs.set(id, tab);
      pty.onData((data) => onData && onData(id, data));
      pty.onExit(({ exitCode }) => onExit && onExit(id, exitCode));
      return id;
    },
    write(id, data) {
      const tab = tabs.get(id);
      if (!tab) return { ok: false };
      // 行缓冲 + 危险检测
      const completed = tab.guard.feed(data);
      for (const { line, dangerous } of completed) {
        if (dangerous) {
          tab.queue = { line };
          return { ok: false, dangerous: true, line };
        }
      }
      tab.pty.write(data);
      return { ok: true };
    },
    confirmDanger(id) {
      const tab = tabs.get(id);
      if (!tab || !tab.queue) return { ok: false };
      const { line } = tab.queue;
      tab.queue = null;
      tab.pty.write(tab.guard.flushConfirmedLine(line));
      return { ok: true, line };
    },
    cancelDanger(id) {
      const tab = tabs.get(id);
      if (!tab) return;
      // 危险行从未写入 shell，取消时无需补写任何内容
      tab.queue = null;
    },
    resize(id, cols, rows) {
      const tab = tabs.get(id);
      if (tab && tab.pty.resize) tab.pty.resize(cols, rows);
    },
    closeTab(id) {
      const tab = tabs.get(id);
      if (!tab) return;
      tabs.delete(id);
      try { tab.pty.kill(); } catch (e) { /* 已退出 */ }
      if (killTree && tab.pty.pid) {
        killTree(tab.pty.pid).catch(() => {});
      }
    },
    closeAll() {
      for (const id of [...tabs.keys()]) this.closeTab(id);
    },
  };
}

// Windows 进程树清理（同 main.js stopTree 语义）
function killTree(pid) {
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true, timeout: 10000 },
      (error) => error ? reject(error) : resolve());
  });
}

const DEFAULT_SHELLS = () => {
  const shells = [
    { name: 'Git Bash', file: process.env.SHELL_PATH || null },
    { name: 'PowerShell', file: 'powershell.exe' },
    { name: 'cmd', file: 'C:\\Windows\\System32\\cmd.exe' },
  ];
  // 从 pi 配置读 shellPath（settings.json）
  try {
    const settings = JSON.parse(fs.readFileSync(
      path.join(process.env.USERPROFILE || '', '.pi', 'agent', 'settings.json'), 'utf8'));
    if (settings.shellPath && fs.existsSync(settings.shellPath)) {
      shells[0].file = settings.shellPath;
    }
  } catch (e) { /* 忽略，用默认 */ }
  return shells.filter((s) => s.file && (s.file.includes(':') ? fs.existsSync(s.file) : true));
};

let terminalWindow = null;

function createTerminalWindow({ projectRoot } = {}) {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    terminalWindow.show();
    terminalWindow.focus();
    return terminalWindow;
  }

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 640,
    minHeight: 400,
    title: '终端 - Pi Desktop',
    backgroundColor: '#1e1e2e',
    icon: path.join(projectRoot, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'terminal-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  terminalWindow = win;
  win.on('closed', () => { terminalWindow = null; });

  let pty;
  try {
    pty = require('node-pty');
  } catch (e) {
    // node-pty 未编译：窗口内显示错误
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="background:#1e1e2e;color:#f38ba8;font-family:monospace;padding:20px;">' +
      'node-pty 原生模块不可用：请运行 npm run rebuild:native 后重启。' +
      '<pre>' + e.message + '</pre></body>'));
    win.once('ready-to-show', () => win.show());
    return win;
  }

  const manager = createTerminalManager({ ptyFactory: pty, killTree });
  const shells = DEFAULT_SHELLS();

  // 幂等注册 IPC
  for (const channel of [
    'terminal:list-tabs', 'terminal:spawn', 'terminal:input', 'terminal:confirm-danger',
    'terminal:cancel-danger', 'terminal:resize', 'terminal:close-tab', 'terminal:get-shells',
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('terminal:get-shells', () => shells);
  ipcMain.handle('terminal:xterm-base', () => {
    // 打包后 xterm 静态资源在 app.asar.unpacked/node_modules/@xterm；dev 在项目 node_modules
    const base = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@xterm')
      : path.join(projectRoot, 'node_modules', '@xterm');
    return base;
  });
  ipcMain.handle('terminal:list-tabs', () => manager.listTabs());
  ipcMain.handle('terminal:spawn', (_e, { shell, cwd, cols, rows }) => {
    const id = manager.spawnTab({
      shell, cwd, cols, rows,
      onData: (tid, data) => { if (!win.isDestroyed()) win.webContents.send('terminal:output', tid, data); },
      onExit: (tid, code) => { if (!win.isDestroyed()) win.webContents.send('terminal:exit', tid, code); },
    });
    return { id };
  });
  ipcMain.handle('terminal:input', (_e, id, data) => {
    const result = manager.write(id, data);
    if (result && result.dangerous && !win.isDestroyed()) {
      win.webContents.send('terminal:danger', id, result.line);
    }
    return result;
  });
  ipcMain.handle('terminal:confirm-danger', (_e, id) => manager.confirmDanger(id));
  ipcMain.handle('terminal:cancel-danger', (_e, id) => { manager.cancelDanger(id); return { ok: true }; });
  ipcMain.handle('terminal:resize', (_e, id, cols, rows) => { manager.resize(id, cols, rows); return { ok: true }; });
  ipcMain.handle('terminal:close-tab', (_e, id) => { manager.closeTab(id); return { ok: true }; });

  win.on('closed', () => manager.closeAll());

  win.loadFile(path.join(__dirname, 'terminal.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

function destroyTerminalWindow() {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    terminalWindow.destroy();
  }
  terminalWindow = null;
}

module.exports = {
  createTerminalWindow,
  destroyTerminalWindow,
  createTerminalManager,
  createLineGuard,
  isDangerousCommand,
  DANGEROUS_PATTERNS,
};
