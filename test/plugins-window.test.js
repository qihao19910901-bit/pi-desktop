// plugins-window.test.js - 插件面板 handler 逻辑测试
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginHandlers, VALID_ACTIONS } = require('../electron/plugins-window');

function fakeRequest() {
  const calls = [];
  return {
    calls,
    impl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true };
    },
  };
}

test('list builds the GET url with the encoded cwd', async () => {
  const req = fakeRequest();
  const handlers = createPluginHandlers({ port: 30141, request: req.impl });
  await handlers.list('F:/我的秘籍/项目 A');
  assert.equal(req.calls.length, 1);
  assert.equal(req.calls[0].url, 'http://127.0.0.1:30141/api/plugins?cwd=F%3A%2F%E6%88%91%E7%9A%84%E7%A7%98%E7%B1%8D%2F%E9%A1%B9%E7%9B%AE%20A');
  assert.equal(req.calls[0].options.method, 'GET');
});

test('list rejects empty or missing cwd', async () => {
  const handlers = createPluginHandlers({ port: 30141, request: fakeRequest().impl });
  await assert.rejects(() => handlers.list(''), /cwd 不能为空/);
  await assert.rejects(() => handlers.list(undefined), /cwd 不能为空/);
});

test('action posts JSON body with cwd and optional source/scope', async () => {
  const req = fakeRequest();
  const handlers = createPluginHandlers({ port: 30141, request: req.impl });
  await handlers.action({ cwd: 'C:/repo', action: 'install', source: 'npm:demo', scope: 'global' });
  assert.equal(req.calls[0].url, 'http://127.0.0.1:30141/api/plugins');
  assert.deepEqual(req.calls[0].options, {
    method: 'POST',
    body: { cwd: 'C:/repo', action: 'install', source: 'npm:demo', scope: 'global' },
  });
});

test('action omits absent source and scope', async () => {
  const req = fakeRequest();
  const handlers = createPluginHandlers({ port: 30141, request: req.impl });
  await handlers.action({ cwd: 'C:/repo', action: 'update' });
  assert.deepEqual(req.calls[0].options.body, { cwd: 'C:/repo', action: 'update' });
});

test('action rejects unsupported actions and bad types', async () => {
  const handlers = createPluginHandlers({ port: 30141, request: fakeRequest().impl });
  await assert.rejects(() => handlers.action({ cwd: 'C:/repo', action: 'hack' }), /不支持的插件操作/);
  await assert.rejects(() => handlers.action({ cwd: 'C:/repo', action: 'install', source: 42 }), /必须是字符串/);
  await assert.rejects(() => handlers.action({ cwd: 'C:/repo', action: 'install', scope: 'local' }), /project 或 global/);
  await assert.rejects(() => handlers.action({ action: 'install', source: 'npm:x' }), /cwd 不能为空/);
});

test('exposes exactly the documented actions', () => {
  assert.deepEqual(VALID_ACTIONS, ['install', 'remove', 'update', 'disable', 'enable']);
});

test('defaultCwd resolves the first trusted directory from trust.json', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-trust-'));
  const agentDir = path.join(tmp, '.pi', 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'trust.json'), JSON.stringify({
    'C:/not-trusted': false,
    'F:/软件/我的秘籍': true,
    'F:/其他项目': true,
  }));
  const { resolveDefaultCwd } = require('../electron/plugins-window');
  assert.equal(resolveDefaultCwd(tmp), 'F:/软件/我的秘籍');
  // 回退：trust.json 缺失
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-trust-empty-'));
  assert.equal(resolveDefaultCwd(empty), empty);
});
