const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: waitForImmediate } = require('node:timers/promises');
const { test, mock } = require('node:test');

const { createUpdaterController } = require('../electron/updater');

function createHarness({ isPackaged = true } = {}) {
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
  const controller = createUpdaterController({ isPackaged, autoUpdater, dialog, logger, schedule });

  return { autoUpdater, controller, dialog, logger, schedule };
}

test('createUpdaterController is exported', () => {
  assert.equal(typeof createUpdaterController, 'function');
});

test('downloaded update installs only after explicit restart choice', async () => {
  const { autoUpdater, controller, dialog } = createHarness();
  controller.init();

  dialog.showMessageBox.mock.mockImplementation(() => Promise.resolve({ response: 1 }));
  autoUpdater.emit('update-downloaded', { version: '2.0.0' });
  await waitForImmediate();
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 0);

  dialog.showMessageBox.mock.mockImplementation(() => Promise.resolve({ response: 0 }));
  autoUpdater.emit('update-downloaded', { version: '2.0.0' });
  await waitForImmediate();
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 1);
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
  const events = ['update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error'];
  for (const event of events) {
    assert.equal(autoUpdater.listenerCount(event), 1, event);
  }
  assert.equal(schedule.mock.callCount(), 1);
});
