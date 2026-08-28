const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: waitForImmediate } = require('node:timers/promises');
const { test, mock } = require('node:test');

const { createUpdaterController } = require('../electron/updater');

async function waitForDialogCount(dialog, count) {
  for (let attempt = 0; attempt < 10 && dialog.showMessageBox.mock.callCount() < count; attempt += 1) {
    await waitForImmediate();
  }
}

function createHarness({ isPackaged = true, ...extra } = {}) {
  const autoUpdater = Object.assign(new EventEmitter(), {
    checkForUpdatesAndNotify: mock.fn(() => Promise.resolve()),
    checkForUpdates: mock.fn(() => Promise.resolve()),
    quitAndInstall: mock.fn(),
  });
  const dialog = {
    showMessageBox: mock.fn(() => Promise.resolve({ response: 1 })),
    showErrorBox: mock.fn(),
  };
  const logger = { log: mock.fn(), warn: mock.fn(), error: mock.fn() };
  const schedule = mock.fn((fn) => fn());
  const controller = createUpdaterController({ isPackaged, autoUpdater, dialog, logger, schedule, ...extra });

  return { autoUpdater, controller, dialog, logger, schedule };
}

test('createUpdaterController is exported', () => {
  assert.equal(typeof createUpdaterController, 'function');
});

test('update-available triggers the mirror download flow', async () => {
  const { autoUpdater, controller, dialog, logger } = createHarness({
    download: async (urls, dest, opts) => { return true; },
    buildUrls: (info) => ['https://mirror.test/x.exe'],
    desktopPath: 'C:/Users/me/Desktop',
  });
  controller.init();
  autoUpdater.emit('update-available', { version: '2.0.0', files: [{ url: 'https://github.com/x/y.exe', size: 100 }] });
  await waitForDialogCount(dialog, 2);
  // 先提示发现更新，下载完成后再提示手动安装（不自动安装）
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 0);
  assert.equal(dialog.showMessageBox.mock.callCount(), 2);
  assert.match(dialog.showMessageBox.mock.calls[0].arguments[0].message, /发现新版本/);
  assert.match(dialog.showMessageBox.mock.calls[1].arguments[0].message, /2\.0\.0/);
  assert.match(logger.log.mock.calls.map(c => c.arguments.join(' ')).join('\n'), /镜像下载开始/);
});

test('repeated update events do not repeat the discovery prompt', async () => {
  const { autoUpdater, controller, dialog } = createHarness({
    download: async () => new Promise(() => {}),
    buildUrls: () => ['https://mirror.test/x.exe'],
  });
  controller.init();
  const info = { version: '2.0.0', files: [{ url: 'https://github.com/x/y.exe', size: 100 }] };
  autoUpdater.emit('update-available', info);
  autoUpdater.emit('update-available', info);
  await waitForDialogCount(dialog, 1);
  assert.equal(dialog.showMessageBox.mock.callCount(), 1);
  assert.match(dialog.showMessageBox.mock.calls[0].arguments[0].message, /发现新版本/);
});

test('mirror download failure shows a manual-download hint', async () => {
  const { autoUpdater, controller, dialog } = createHarness({
    download: async () => false,
    desktopPath: 'C:/Users/me/Desktop',
  });
  controller.init();
  autoUpdater.emit('update-available', {
    version: '2.0.0',
    files: [{ url: 'https://github.com/qihao19910901-bit/pi-desktop/releases/download/v2.0.0/x.exe', size: 100 }],
  });
  await waitForDialogCount(dialog, 2);
  assert.equal(dialog.showMessageBox.mock.callCount(), 2);
  assert.match(dialog.showMessageBox.mock.calls[0].arguments[0].message, /发现新版本/);
  assert.match(dialog.showMessageBox.mock.calls[1].arguments[0].message, /下载失败/);
});

test('development mode skips listeners and automatic update checks', () => {
  const { autoUpdater, controller, logger, schedule } = createHarness({ isPackaged: false });
  controller.init();
  assert.deepEqual(autoUpdater.eventNames(), []);
  assert.equal(schedule.mock.callCount(), 0);
  assert.equal(autoUpdater.checkForUpdatesAndNotify.mock.callCount(), 0);
  assert.equal(logger.log.mock.callCount(), 1);
});

test('delayed automatic check rejection is caught and logged', async () => {
  const { autoUpdater, controller, logger, schedule } = createHarness();
  autoUpdater.checkForUpdatesAndNotify.mock.mockImplementation(() =>
    Promise.reject(new Error('offline')),
  );

  controller.init();
  await waitForImmediate();

  assert.equal(schedule.mock.callCount(), 1);
  assert.equal(schedule.mock.calls[0].arguments[1], 8000);
  assert.equal(autoUpdater.checkForUpdatesAndNotify.mock.callCount(), 1);
  assert.equal(logger.warn.mock.callCount(), 1);
});

test('manual check rejection is caught and shown through showErrorBox', async () => {
  const { autoUpdater, controller, dialog } = createHarness();
  autoUpdater.checkForUpdates.mock.mockImplementation(() => Promise.reject(new Error('offline')));
  assert.equal(controller.checkManual(), undefined);
  await waitForImmediate();

  assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 1);
  assert.equal(dialog.showErrorBox.mock.callCount(), 1);
  assert.deepEqual(dialog.showErrorBox.mock.calls[0].arguments, ['检查更新失败', 'offline']);
});

test('manual check warns when updater is absent', async () => {
  const { dialog, logger, schedule } = createHarness();
  const controller = createUpdaterController({ isPackaged: true, autoUpdater: null, dialog, logger, schedule });
  assert.equal(controller.checkManual(), undefined);
  await waitForImmediate();

  assert.equal(dialog.showMessageBox.mock.callCount(), 1);
  assert.equal(dialog.showMessageBox.mock.calls[0].arguments[0].type, 'warning');
  assert.equal(dialog.showMessageBox.mock.calls[0].arguments[0].detail, 'electron-updater 未安装');
});

test('listeners register once even when init is called twice', () => {
  const { autoUpdater, controller, schedule } = createHarness();
  controller.init();
  controller.init();
  const events = ['update-available', 'update-not-available', 'error'];
  for (const event of events) {
    assert.equal(autoUpdater.listenerCount(event), 1, event);
  }
  assert.equal(schedule.mock.callCount(), 1);
});

// ============ 镜像下载逻辑 ============

const { buildDownloadUrls, downloadWithRetry } = require('../electron/updater');

test('buildDownloadUrls prefers mirrors then falls back to github direct', () => {
  const info = { files: [{ url: 'https://github.com/qihao19910901-bit/pi-desktop/releases/download/v1.0.0/x.exe' }] };
  const urls = buildDownloadUrls(info);
  assert.equal(urls.length, 3);
  assert.match(urls[0], /^https:\/\/ghproxy\.net\//);
  assert.match(urls[1], /^https:\/\/gh-proxy\.com\//);
  assert.equal(urls[2], 'https://github.com/qihao19910901-bit/pi-desktop/releases/download/v1.0.0/x.exe');
});

test('buildDownloadUrls resolves relative release assets to the GitHub release', () => {
  const info = {
    version: '1.1.27',
    releaseUrl: 'https://github.com/qihao19910901-bit/pi-desktop/releases/tag/v1.1.27',
    files: [{ url: 'Pi-Desktop-Setup-1.1.27.exe' }],
  };
  const urls = buildDownloadUrls(info);
  const direct = 'https://github.com/qihao19910901-bit/pi-desktop/releases/download/v1.1.27/Pi-Desktop-Setup-1.1.27.exe';
  assert.deepEqual(urls, [
    `https://ghproxy.net/${direct}`,
    `https://gh-proxy.com/${direct}`,
    direct,
  ]);
});

test('buildDownloadUrls keeps a trusted full asset URL unchanged', () => {
  const direct = 'https://github.com/qihao19910901-bit/pi-desktop/releases/download/v1.1.27/Pi-Desktop-Setup-1.1.27.exe';
  assert.equal(buildDownloadUrls({ version: '1.1.27', files: [{ url: direct }] })[2], direct);
});

test('buildDownloadUrls rejects a full asset URL from another host', () => {
  assert.deepEqual(buildDownloadUrls({
    version: '1.1.27',
    files: [{ url: 'https://example.com/Pi-Desktop-Setup-1.1.27.exe' }],
  }), []);
});

test('buildDownloadUrls rejects a relative asset without release metadata', () => {
  assert.deepEqual(buildDownloadUrls({ files: [{ url: 'Pi-Desktop-Setup-1.1.27.exe' }] }), []);
});

test('buildDownloadUrls returns empty without files metadata', () => {
  assert.deepEqual(buildDownloadUrls({}), []);
  assert.deepEqual(buildDownloadUrls({ files: [] }), []);
});

test('downloadWithRetry resumes from partial bytes via Range and completes', async () => {
  const http = require('node:http');
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');

  const content = Buffer.from('0123456789abcdef'.repeat(64)); // 1KB
  const server = http.createServer((req, res) => {
    const range = req.headers.range;
    if (range) {
      const start = Number(range.replace('bytes=', '').split('-')[0]);
      res.writeHead(206, { 'Content-Length': content.length - start });
      res.end(content.subarray(start));
    } else {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dest = path.join(os.tmpdir(), 'updater-test-' + Date.now() + '.exe');
  try {
    // 预写一半字节，模拟断点
    fs.writeFileSync(dest, content.subarray(0, content.length / 2));
    const ok = await downloadWithRetry([`http://127.0.0.1:${port}/x.exe`], dest, { maxRounds: 2, timeoutMs: 5000, expectedSize: content.length });
    assert.equal(ok, true);
    assert.deepEqual(fs.readFileSync(dest), content);
  } finally {
    server.close();
    fs.rmSync(dest, { force: true });
  }
});

test('downloadWithRetry fails when the server never completes', async () => {
  const http = require('node:http');
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': 1000 });
    res.write('partial');
    // 不结束响应
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dest = path.join(os.tmpdir(), 'updater-test-fail-' + Date.now() + '.exe');
  try {
    const ok = await downloadWithRetry([`http://127.0.0.1:${server.address().port}/x.exe`], dest, { maxRounds: 1, timeoutMs: 1500, expectedSize: 1000 });
    assert.equal(ok, false);
  } finally {
    server.close();
    fs.rmSync(dest, { force: true });
  }
});
