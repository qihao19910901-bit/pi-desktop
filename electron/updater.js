// updater.js - 自动更新模块（electron-updater）
// v2: 日志写文件 + 检查失败自动重试 + 下载失败重试（2026-08-10 实战教训）
const fs = require('node:fs');
const path = require('node:path');

function createFileLogger(userDataDir) {
  const logFile = path.join(userDataDir, 'updater.log');
  const write = (level, args) => {
    try {
      const line = `[${new Date().toISOString()}] [${level}] ${args.map(String).join(' ')}\n`;
      fs.appendFileSync(logFile, line);
      console[level === 'error' ? 'error' : 'log']('[updater]', ...args);
    } catch {
      // 日志写入失败不影响更新流程
    }
  };
  return {
    log: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    getLogFile: () => logFile,
  };
}

function createUpdaterController({
  isPackaged,
  autoUpdater,
  dialog,
  logger = console,
  schedule = setTimeout,
}) {
  let initialized = false;
  let checkAttempts = 0;
  const MAX_CHECK_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 60000;

  function init() {
    if (initialized) return;
    initialized = true;

    if (!autoUpdater) return;

    // 打包后才检查更新（开发模式跳过）
    if (!isPackaged) {
      logger.log('[updater] 开发模式，跳过自动更新');
      return;
    }

    autoUpdater.autoDownload = true; // 发现新版本自动下载
    autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('update-available', (info) => {
      logger.log('[updater] 发现新版本:', info.version);
    });
    autoUpdater.on('update-not-available', () => {
      logger.log('[updater] 已是最新版本');
    });
    autoUpdater.on('download-progress', (progress) => {
      logger.log(
        `[updater] 下载进度: ${Math.round(progress.percent)}% (${progress.transferred}/${progress.total})`,
      );
    });
    autoUpdater.on('update-downloaded', (info) => {
      logger.log('[updater] 新版本已下载:', info.version);
      Promise.resolve()
        .then(() =>
          dialog.showMessageBox({
            type: 'info',
            title: '更新就绪',
            message: `新版本 ${info.version} 已下载完成`,
            detail: '重启应用后即可使用新版本。',
            buttons: ['立即重启', '稍后'],
            defaultId: 0,
          }),
        )
        .then((result) => {
          if (result.response === 0) autoUpdater.quitAndInstall();
        })
        .catch((e) => logger.error('[updater] 错误:', e.message));
    });
    autoUpdater.on('error', (err) => {
      logger.error('[updater] 错误:', err.message);
      // 检查失败自动重试（最多 3 次，间隔 60 秒）
      if (checkAttempts < MAX_CHECK_ATTEMPTS) {
        checkAttempts += 1;
        logger.log(`[updater] ${RETRY_DELAY_MS / 1000} 秒后重试检查（第 ${checkAttempts}/${MAX_CHECK_ATTEMPTS} 次）`);
        schedule(() => {
          autoUpdater.checkForUpdatesAndNotify().catch((e) => logger.warn('[updater] 重试检查失败:', e.message));
        }, RETRY_DELAY_MS);
      } else {
        logger.error('[updater] 检查重试次数已达上限，本次启动不再尝试');
      }
    });

    // 启动后延迟 8 秒检查更新（避免抢启动资源）
    schedule(() => {
      Promise.resolve()
        .then(() => autoUpdater.checkForUpdatesAndNotify())
        .catch((e) => logger.warn('[updater] 检查失败:', e.message));
    }, 8000);

    logger.log('[updater] 自动更新已启用，日志: ' + (logger.getLogFile ? logger.getLogFile() : '(控制台)'));
  }

  // 手动检查更新（菜单触发）
  function checkManual() {
    if (!autoUpdater) {
      Promise.resolve()
        .then(() =>
          dialog.showMessageBox({
            type: 'warning',
            title: '自动更新未启用',
            message: '当前环境不支持自动更新',
            detail: isPackaged ? 'electron-updater 未安装' : '开发模式下不可用',
            buttons: ['确定'],
          }),
        )
        .catch((e) => logger.error('[updater] 错误:', e.message));
      return;
    }

    Promise.resolve()
      .then(() =>
        dialog.showMessageBox({
          type: 'info',
          title: '检查更新',
          message: '正在检查更新...',
          buttons: ['确定'],
        }),
      )
      .then(() => autoUpdater.checkForUpdates())
      .catch((e) => dialog.showErrorBox('检查更新失败', e.message))
      .catch((e) => logger.error('[updater] 错误:', e.message));
  }

  return { init, checkManual };
}

let defaultController;

function getDefaultController() {
  if (defaultController) return defaultController;

  const { app, dialog } = require('electron');
  let autoUpdater = null;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater 未安装，跳过自动更新:', e.message);
  }

  let logger = console;
  try {
    logger = createFileLogger(app.getPath('userData'));
  } catch (e) {
    console.warn('[updater] 文件日志不可用，回退控制台:', e.message);
  }

  defaultController = createUpdaterController({
    isPackaged: app.isPackaged,
    autoUpdater,
    dialog,
    logger,
  });
  return defaultController;
}

function initUpdater() {
  getDefaultController().init();
}

function checkForUpdatesManual() {
  getDefaultController().checkManual();
}

module.exports = { createUpdaterController, createFileLogger, initUpdater, checkForUpdatesManual };
