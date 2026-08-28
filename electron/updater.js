// updater.js - 自动更新模块（electron-updater）
// v3: 检查走 electron-updater；下载走自研镜像链路（ghproxy → 直连，断点续传）
// 2026-08-10 实战教训：GitHub 直连下载 196MB 安装包在国内网络极不稳定，
// electron-updater 原生下载失败率高且无断点续传。
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

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

// ============ 镜像下载（纯逻辑，可测） ============

const RELEASE_DOWNLOAD_BASE = 'https://github.com/qihao19910901-bit/pi-desktop/releases/download';

function resolveReleaseTag(info) {
  const releaseUrl = typeof info?.releaseUrl === 'string' ? info.releaseUrl : '';
  const match = releaseUrl.match(/\/releases\/tag\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (match) return match[1];

  const version = typeof info?.version === 'string' ? info.version.trim() : '';
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
  return version.startsWith('v') ? version : `v${version}`;
}

function resolveGithubAssetUrl(info) {
  const assetUrl = info?.files?.[0]?.url;
  if (typeof assetUrl !== 'string' || assetUrl.length === 0) return null;

  try {
    const parsed = new URL(assetUrl);
    if (parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && parsed.pathname.startsWith('/qihao19910901-bit/pi-desktop/releases/download/')) {
      return parsed.href;
    }
    return null;
  } catch {
    // latest.yml normally contains a relative asset filename.
  }

  if (assetUrl.includes('/') || assetUrl.includes('\\')) return null;
  const tag = resolveReleaseTag(info);
  if (!tag) return null;
  return `${RELEASE_DOWNLOAD_BASE}/${encodeURIComponent(tag)}/${encodeURIComponent(assetUrl)}`;
}

// 生成候选下载 URL：ghproxy 镜像优先，GitHub 直连兜底
function buildDownloadUrls(info) {
  const githubUrl = resolveGithubAssetUrl(info);
  if (!githubUrl) return [];
  const mirrors = [
    'https://ghproxy.net/',
    'https://gh-proxy.com/',
  ];
  return [...mirrors.map((m) => m + githubUrl), githubUrl];
}

// 带断点续传的单 URL 下载：返回 true=完成 / false=失败（可重试）
function downloadFile(url, destPath, { timeoutMs = 100000, onProgress } = {}) {
  return new Promise((resolve) => {
    const existing = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    const mod = url.startsWith('https:') ? https : http;
    const request = mod.get(url, {
      headers: existing > 0 ? { Range: `bytes=${existing}-` } : {},
      timeout: timeoutMs,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status === 416) {
        // 已完整下载
        response.resume();
        resolve(true);
        return;
      }
      if (status !== 200 && status !== 206) {
        response.resume();
        resolve(false);
        return;
      }
      const stream = fs.createWriteStream(destPath, { flags: 'a' });
      let received = existing;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received);
      });
      stream.on('finish', () => resolve(true));
      stream.on('error', () => resolve(false));
      response.pipe(stream);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

// 多 URL + 多轮断点续传下载；返回 true=成功 false=失败
async function downloadWithRetry(urls, destPath, {
  maxRounds = 20, timeoutMs = 100000, onProgress,
  expectedSize = 0,
} = {}) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (let round = 0; round < maxRounds; round += 1) {
    for (const url of urls) {
      const ok = await downloadFile(url, destPath, { timeoutMs, onProgress });
      if (ok && (!expectedSize || fs.statSync(destPath).size >= expectedSize)) {
        return true;
      }
      // 未完成：继续下一个 URL / 下一轮（断点续传从已有字节继续）
    }
  }
  return false;
}

// ============ 更新控制器 ============

function createUpdaterController({
  isPackaged,
  autoUpdater,
  dialog,
  shell,
  logger = console,
  schedule = setTimeout,
  desktopPath = '',
  download = downloadWithRetry,
  buildUrls = buildDownloadUrls,
}) {
  let initialized = false;
  let checkAttempts = 0;
  let mirrorDownloading = false;
  let announcedVersion = null;
  const MAX_CHECK_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 60000;

  function init() {
    if (initialized) return;
    initialized = true;

    if (!autoUpdater) return;

    if (!isPackaged) {
      logger.log('[updater] 开发模式，跳过自动更新');
      return;
    }

    // 下载改由镜像链路处理（autoDownload 关闭，避免 electron-updater 直连下载）
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('update-available', (info) => {
      logger.log('[updater] 发现新版本:', info.version);
      if (mirrorDownloading) return;
      mirrorDownloading = true;
      startUpdate(info);
    });
    autoUpdater.on('update-not-available', () => {
      logger.log('[updater] 已是最新版本');
    });
    autoUpdater.on('error', (err) => {
      logger.error('[updater] 错误:', err.message);
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

    schedule(() => {
      Promise.resolve()
        .then(() => autoUpdater.checkForUpdatesAndNotify())
        .catch((e) => logger.warn('[updater] 检查失败:', e.message));
    }, 8000);

    logger.log('[updater] 自动更新已启用（镜像下载模式），日志: ' + (logger.getLogFile ? logger.getLogFile() : '(控制台)'));
  }

  async function startUpdate(info) {
    if (announcedVersion !== info.version) {
      announcedVersion = info.version;
      await Promise.resolve().then(() => dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${info.version}`,
        detail: '正在准备下载更新包，完成后会提示你手动安装。',
        buttons: ['确定'],
      })).catch((e) => logger.error('[updater] 更新提示失败:', e.message));
    }
    try {
      await startMirrorDownload(info);
    } catch (e) {
      logger.error('[updater] 更新下载异常:', e.message);
    } finally {
      mirrorDownloading = false;
    }
  }

  async function startMirrorDownload(info) {
    const urls = buildUrls(info);
    if (urls.length === 0) {
      logger.error('[updater] 无法构造下载地址（缺少有效 Release 或 files 元数据）');
      return;
    }
    const dest = path.join(desktopPath || require('node:os').homedir(), `Pi-Desktop-Setup-${info.version}.exe`);
    logger.log(`[updater] 镜像下载开始: v${info.version} → ${dest}`);
    logger.log(`[updater] 候选源: ${urls.join(' | ')}`);
    const ok = await download(urls, dest, { onProgress: (bytes) => logger.log(`[updater] 下载进度: ${Math.round(bytes / 1048576)}MB`), expectedSize: info.files?.[0]?.size || 0 });
    if (!ok) {
      logger.error('[updater] 镜像下载失败（已重试多轮），请手动下载: https://github.com/qihao19910901-bit/pi-desktop/releases');
      await Promise.resolve().then(() => dialog.showMessageBox({
        type: 'warning',
        title: '更新下载失败',
        message: `新版本 ${info.version} 下载失败`,
        detail: '网络不稳定。可稍后在"设置 → 检查更新"重试，或到 GitHub Releases 手动下载。',
        buttons: ['确定'],
      })).catch(() => {});
      return;
    }
    logger.log('[updater] 镜像下载完成');
    await Promise.resolve().then(() => dialog.showMessageBox({
      type: 'info',
      title: '更新包已就绪',
      message: `新版本 ${info.version} 已下载到桌面`,
      detail: `双击 Pi-Desktop-Setup-${info.version}.exe 安装，重启后生效。`,
      buttons: ['打开所在文件夹', '稍后'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0 && shell && shell.showItemInFolder) {
        shell.showItemInFolder(dest);
      }
    })).catch((e) => logger.error('[updater] 提示失败:', e.message));
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

  const { app, dialog, shell } = require('electron');
  let autoUpdater = null;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater 未安装，跳过自动更新:', e.message);
  }

  let logger = console;
  let desktopPath = '';
  try {
    logger = createFileLogger(app.getPath('userData'));
    desktopPath = app.getPath('desktop');
  } catch (e) {
    console.warn('[updater] 文件日志/桌面路径不可用:', e.message);
  }

  defaultController = createUpdaterController({
    isPackaged: app.isPackaged,
    autoUpdater,
    dialog,
    shell,
    logger,
    desktopPath,
  });
  return defaultController;
}

function initUpdater() {
  getDefaultController().init();
}

function checkForUpdatesManual() {
  getDefaultController().checkManual();
}

module.exports = {
  createUpdaterController,
  createFileLogger,
  buildDownloadUrls,
  downloadFile,
  downloadWithRetry,
  initUpdater,
  checkForUpdatesManual,
};
