// updater.js - 自动更新模块（electron-updater）
// 配合 electron-builder.yml 的 publish: github provider 使用
const { app, dialog } = require('electron');

let autoUpdater = null;
let initialized = false;

function initUpdater() {
  if (initialized) return;
  initialized = true;

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater 未安装，跳过自动更新:', e.message);
    return;
  }

  // 打包后才检查更新（开发模式跳过）
  if (!app.isPackaged) {
    console.log('[updater] 开发模式，跳过自动更新');
    return;
  }

  autoUpdater.autoDownload = true; // 发现新版本自动下载
  autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] 发现新版本:', info.version);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 已是最新版本');
  });
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] 下载进度: ${Math.round(progress.percent)}% (${progress.transferred}/${progress.total})`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] 新版本已下载:', info.version);
    dialog
      .showMessageBox({
        type: 'info',
        title: '更新就绪',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '重启应用后即可使用新版本。',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater] 错误:', err.message);
  });

  // 启动后延迟 8 秒检查更新（避免抢启动资源）
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => {
      console.warn('[updater] 检查失败:', e.message);
    });
  }, 8000);

  console.log('[updater] 自动更新已启用');
}

// 手动检查更新（菜单触发）
function checkForUpdatesManual() {
  if (!autoUpdater) {
    dialog.showMessageBox({
      type: 'warning',
      title: '自动更新未启用',
      message: '当前环境不支持自动更新',
      detail: app.isPackaged ? 'electron-updater 未安装' : '开发模式下不可用',
      buttons: ['确定'],
    });
    return;
  }
  dialog
    .showMessageBox({
      type: 'info',
      title: '检查更新',
      message: '正在检查更新...',
      buttons: ['确定'],
    })
    .then(() => {
      autoUpdater.checkForUpdates().catch((e) => {
        dialog.showErrorBox('检查更新失败', e.message);
      });
    });
}

module.exports = { initUpdater, checkForUpdatesManual };
