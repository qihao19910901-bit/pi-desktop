// tray.js - 系统托盘（多窗口版）
const { app, Tray, Menu, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const ICON_PATH = path.join(PROJECT_ROOT, 'assets', 'icon.png');

// 内嵌 16x16 PNG 占位图标（纯紫色方块），确保无图标文件时也能跑
const FALLBACK_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR42mPo3PLrPyWYYdSAUQNGDRguBgAAQds2LprfnS8AAAAASUVORK5CYII=';

let tray = null;

function getIcon() {
  if (fs.existsSync(ICON_PATH)) {
    try {
      const img = nativeImage.createFromPath(ICON_PATH);
      if (!img.isEmpty()) return img;
    } catch {}
  }
  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_BASE64, 'base64'));
}

// 动态获取活跃窗口（不依赖固定引用，适配多窗口）
function getActiveWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return all[0] || null;
}

function showActiveWindow() {
  const w = getActiveWindow();
  if (!w) return;
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.focus();
}

// createTray({ onNewWindow, onNewSession })
// onNewWindow: 新建窗口回调（main.js 的 createWindow）
// onNewSession: 新建会话回调（向当前窗口发 menu-new-session）
function createTray({ onNewWindow, onNewSession } = {}) {
  const icon = getIcon();
  icon.setTemplateImage(false);

  tray = new Tray(icon);
  tray.setToolTip('Pi Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '新建窗口',
      click: () => onNewWindow && onNewWindow(),
    },
    {
      label: '新建会话',
      click: () => {
        const w = getActiveWindow();
        if (w) {
          w.show();
          w.focus();
          if (onNewSession) onNewSession();
          else w.webContents.send('menu-new-session');
        }
      },
    },
    {
      label: '显示窗口',
      click: showActiveWindow,
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 单击托盘图标：切换显隐（作用于活跃窗口）
  tray.on('click', () => {
    const w = getActiveWindow();
    if (!w) {
      // 无窗口，新建
      if (onNewWindow) onNewWindow();
      return;
    }
    if (w.isVisible() && !w.isMinimized()) {
      if (!app.isQuiting) w.hide();
    } else {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });

  return tray;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };
