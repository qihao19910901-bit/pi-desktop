// window-meta.test.js - 多窗口账号命名逻辑测试
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCOUNT_PARTITIONS,
  accountLabel,
  buildWindowTitle,
  ACCOUNT_BADGE_HTML,
} = require('../electron/window-meta');

test('accountLabel maps known partitions and rejects others', () => {
  assert.equal(accountLabel('persist:account-1'), '账号 1');
  assert.equal(accountLabel('persist:account-2'), '账号 2');
  assert.equal(accountLabel('persist:account-3'), '账号 3');
  assert.equal(accountLabel(undefined), null);
  assert.equal(accountLabel(null), null);
  assert.equal(accountLabel('persist:other'), null);
});

test('buildWindowTitle combines account label with page title', () => {
  assert.equal(buildWindowTitle(null, '我的秘籍 - Pi Web'), '我的秘籍 - Pi Web');
  assert.equal(buildWindowTitle('账号 1', '我的秘籍 - Pi Web'), '账号 1 - 我的秘籍 - Pi Web');
  assert.equal(buildWindowTitle('账号 1', 'Pi Desktop'), '账号 1 - Pi Desktop');
  // 空页面标题回退
  assert.equal(buildWindowTitle('账号 2', '  '), '账号 2 - Pi Desktop');
  assert.equal(buildWindowTitle(null, ''), 'Pi Desktop');
});

test('ACCOUNT_PARTITIONS covers exactly three accounts', () => {
  assert.deepEqual(ACCOUNT_PARTITIONS, {
    'persist:account-1': '账号 1',
    'persist:account-2': '账号 2',
    'persist:account-3': '账号 3',
  });
});

test('ACCOUNT_BADGE_HTML embeds the account label safely', () => {
  const html = ACCOUNT_BADGE_HTML('账号 1');
  assert.match(html, /账号 1/);
  assert.match(html, /position:fixed/);
  assert.match(html, /pi-account-badge/);
});
