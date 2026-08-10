// settings-window.test.js - 设置 handler 逻辑测试
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsHandlers, TOGGLE_SHORTCUT } = require('../electron/settings-window');

function makeEnv(overrides = {}) {
  let login = { openAtLogin: false };
  let shortcutRegistered = false;
  let toggleCalls = 0;
  const clipboard = { text: '' };
  const handlers = createSettingsHandlers({
    app: { getVersion: () => '1.1.13', getPath: () => 'C:/fake' },
    shell: { openPath: async () => '' },
    getLoginSettings: () => login,
    setLoginSettings: (opts) => { login = opts; },
    isShortcutRegistered: () => shortcutRegistered,
    registerShortcut: (accel, cb) => { shortcutRegistered = true; return true; },
    unregisterShortcut: () => { shortcutRegistered = false; },
    showActiveWindow: () => { toggleCalls += 1; },
    getDiagnostics: () => ({ pid: 123, restartCount: 2, stderr: ['line1', 'line2'] }),
    checkUpdate: () => {},
    readVersions: () => ({ 'pi-web': 'pi-web 0.8.7', 'Pi': 'Pi 0.84.1' }),
    port: 30141,
    updaterLogPath: 'C:/fake/updater.log',
    clipboardApi: { writeText: (t) => { clipboard.text = t; } },
    ...overrides,
  });
  return { handlers, state: () => ({ login, shortcutRegistered, toggleCalls, clipboard }) };
}

test('getState assembles version, autostart, shortcut and diagnostics', async () => {
  const { handlers } = makeEnv();
  const s = await handlers.getState();
  assert.equal(s.desktopVersion, '1.1.13');
  assert.equal(s.port, 30141);
  assert.equal(s.autostartEnabled, false);
  assert.equal(s.shortcutEnabled, false);
  assert.equal(s.shortcutLabel, TOGGLE_SHORTCUT);
  assert.equal(s.updaterLogPath, 'C:/fake/updater.log');
  assert.deepEqual(s.versions, { 'pi-web': 'pi-web 0.8.7', 'Pi': 'Pi 0.84.1' });
  assert.equal(s.piweb.pid, 123);
  assert.equal(s.piweb.restartCount, 2);
});

test('setAutostart toggles login item settings', async () => {
  const { handlers, state } = makeEnv();
  await handlers.setAutostart(true);
  assert.equal(state().login.openAtLogin, true);
  await handlers.setAutostart(false);
  assert.equal(state().login.openAtLogin, false);
});

test('setShortcut registers and unregisters the toggle shortcut', async () => {
  const { handlers, state } = makeEnv();
  assert.equal(await handlers.setShortcut(true).then((r) => r.enabled), true);
  assert.equal(state().shortcutRegistered, true);
  // 再开一次（幂等）
  assert.equal(await handlers.setShortcut(true).then((r) => r.enabled), true);
  assert.equal(await handlers.setShortcut(false).then((r) => r.enabled), false);
  assert.equal(state().shortcutRegistered, false);
});

test('shortcut registration failure surfaces an error', async () => {
  const { handlers } = makeEnv({
    registerShortcut: () => false,
  });
  await assert.rejects(() => handlers.setShortcut(true), /注册失败/);
});

test('copyDiagnostics writes a text summary to clipboard', async () => {
  const { handlers, state } = makeEnv();
  const r = await handlers.copyDiagnostics();
  assert.equal(r.ok, true);
  assert.ok(r.length > 50);
  assert.match(state().clipboard.text, /Pi Desktop 诊断信息/);
  assert.match(state().clipboard.text, /pi-web 0\.8\.7/);
  assert.match(state().clipboard.text, /line1/);
});
