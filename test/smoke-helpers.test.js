const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const { withTimeout, probeHttp, createCdpDispatcher, cleanupOwnedProcess, waitForPortsClosed,
  waitForUiContent, removeWithRetry, createCdpSession } = require('../scripts/smoke-packaged-app');
function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}
function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
class FakeSocket {
  constructor() { this.listeners = new Map(); this.sent = []; this.closeCalls = 0; FakeSocket.instances.push(this); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.closeCalls += 1; }
  static reset() { FakeSocket.instances = []; }
}
FakeSocket.reset();
test('withTimeout rejects work that exceeds its deadline', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10, 'slow work'), /slow work timed out/);
});
test('probeHttp requires a 2xx response containing the canonical Pi Web title signal', async (t) => {
  const server = await listen((request, response) => {
    if (request.url === '/status') response.writeHead(503).end('<title>Pi Web</title>');
    else if (request.url === '/plain') response.end('Pi Web');
    else if (request.url === '/markup') response.end('<h1>Pi Web</h1>');
    else response.end('<title>Pi Web</title>');
  });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(probeHttp(`${base}/status`), /HTTP 503/);
  await assert.rejects(probeHttp(`${base}/plain`), /missing <title>Pi Web<\/title>/);
  await assert.rejects(probeHttp(`${base}/markup`), /missing <title>Pi Web<\/title>/);
  const result = await probeHttp(`${base}/ok`);
  assert.equal(result.statusCode, 200);
  assert.equal(Number.isFinite(result.responseMs), true);
});
test('probeHttp preserves sub-millisecond precision for the 2000ms limit', async (t) => {
  const server = await listen((_request, response) => response.end('<title>Pi Web</title>'));
  t.after(() => close(server));
  const times = [100, 2100.4];
  const result = await probeHttp(`http://127.0.0.1:${server.address().port}`, {
    now: () => times.shift(),
  });
  assert.equal(result.responseMs, 2000.4);
});
test('CDP responses resolve only the request with the matching id', async () => {
  const sent = [];
  const cdp = createCdpDispatcher((message) => sent.push(JSON.parse(message)), 100);
  const first = cdp.request('Runtime.evaluate', { expression: 'first' });
  const second = cdp.request('Runtime.evaluate', { expression: 'second' });
  assert.deepEqual(sent.map(({ id }) => id), [1, 2]);
  cdp.handle(JSON.stringify({ id: 2, result: { value: 'two' } }));
  cdp.handle(JSON.stringify({ id: 999, result: { value: 'ignored' } }));
  cdp.handle(JSON.stringify({ id: 1, result: { value: 'one' } }));
  assert.deepEqual(await Promise.all([first, second]), [{ value: 'one' }, { value: 'two' }]);
});
test('one CDP WebSocket serves multiple evaluations and closes once', async () => {
  FakeSocket.reset();
  const connecting = createCdpSession('ws://test', { timeoutMs: 100, WebSocketImpl: FakeSocket });
  const sockets = FakeSocket.instances;
  sockets[0].emit('open');
  const session = await connecting;
  const first = session.evaluateBody(100);
  const second = session.evaluateBody(100);
  assert.equal(sockets.length, 1);
  assert.deepEqual(sockets[0].sent.map(({ id }) => id), [1, 2]);
  assert.equal(sockets[0].sent[0].params.expression, "document.body?.innerText ?? ''");
  sockets[0].emit('message', { data: JSON.stringify({ id: 999, result: {} }) });
  sockets[0].emit('message', { data: JSON.stringify({ id: 2, result: { result: { value: 'second' } } }) });
  sockets[0].emit('message', { data: JSON.stringify({ id: 1, result: { result: { value: 'first' } } }) });
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  session.close(); session.close();
  assert.equal(sockets[0].closeCalls, 1);
});
test('CDP body evaluation treats a not-yet-created body as empty text', async () => {
  FakeSocket.reset();
  const connecting = createCdpSession('ws://test', { timeoutMs: 100, WebSocketImpl: FakeSocket });
  FakeSocket.instances[0].emit('open');
  const session = await connecting;
  const evaluation = session.evaluateBody(100);
  FakeSocket.instances[0].emit('message', { data: JSON.stringify({ id: 1, result: { result: { type: 'undefined' } } }) });
  assert.equal(await evaluation, '');
  session.close();
});
test('CDP body evaluation rejects unexpected non-string result shapes', async () => {
  FakeSocket.reset();
  const connecting = createCdpSession('ws://test', { timeoutMs: 100, WebSocketImpl: FakeSocket });
  FakeSocket.instances[0].emit('open');
  const evaluation = (await connecting).evaluateBody(100);
  FakeSocket.instances[0].emit('message', { data: JSON.stringify({ id: 1, result: { result: { type: 'object', value: null } } }) });
  await assert.rejects(evaluation, /unexpected object result/);
});
test('CDP connection timeout closes once and a late open is ignored', async () => {
  FakeSocket.reset();
  const connecting = createCdpSession('ws://test', { timeoutMs: 5, WebSocketImpl: FakeSocket });
  const sockets = FakeSocket.instances;
  await assert.rejects(connecting, /connect timed out/);
  sockets[0].emit('open');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sockets[0].closeCalls, 1);
});
test('CDP pre-connect error closes once and a late open is ignored', async () => {
  FakeSocket.reset();
  const connecting = createCdpSession('ws://test', { timeoutMs: 100, WebSocketImpl: FakeSocket });
  const sockets = FakeSocket.instances;
  sockets[0].emit('error');
  await assert.rejects(connecting, /WebSocket error/);
  sockets[0].emit('open');
  assert.equal(sockets[0].closeCalls, 1);
});
test('cleanup stops only the live owned process and proves both ports close', async () => {
  const first = await listen((_request, response) => response.end('one'));
  const second = await listen((_request, response) => response.end('two'));
  const ports = [first.address().port, second.address().port];
  const stopped = [];
  const result = await cleanupOwnedProcess({ pid: 4321, exitCode: null, signalCode: null }, ports, {
    stopTree: async (pid) => {
      stopped.push(pid);
      await Promise.all([close(first), close(second)]);
    },
    timeoutMs: 500,
  });
  assert.deepEqual(stopped, [4321]);
  assert.deepEqual(result, { pid: 4321, portsClosed: ports });
  await waitForPortsClosed(ports, { timeoutMs: 50, intervalMs: 5 });
});
test('cleanup never kills an owned process that has already exited', async () => {
  const stopped = [];
  const result = await cleanupOwnedProcess({ pid: 4321, exitCode: 1, signalCode: null }, [], {
    stopTree: async (pid) => stopped.push(pid),
    timeoutMs: 50,
  });
  assert.deepEqual(stopped, []);
  assert.deepEqual(result, { pid: 4321, portsClosed: [] });
});
test('cleanup rejects when stopping the owned process fails and it is still live', async () => {
  const child = { pid: 4321, exitCode: null, signalCode: null };
  await assert.rejects(cleanupOwnedProcess(child, [], {
    stopTree: async () => { throw new Error('already gone'); },
    timeoutMs: 50,
  }), /already gone/);
});
test('cleanup accepts a stop race only after the owned process exits', async () => {
  const child = { pid: 4321, exitCode: null, signalCode: null };
  const result = await cleanupOwnedProcess(child, [], {
    stopTree: async () => { child.exitCode = 1; throw new Error('already gone'); },
    timeoutMs: 50,
  });
  assert.deepEqual(result, { pid: 4321, portsClosed: [], stopError: 'already gone' });
});
test('UI polling requires the stable empty-page labels without real sleeps', async () => {
  const values = ['Loading', 'Models 技能', 'Models 技能 设置'];
  let delays = 0;
  const result = await waitForUiContent({
    evaluate: async () => values.shift(),
    now: () => 0,
    delay: async () => { delays += 1; },
  });
  assert.deepEqual(result.content, ['Models', 'Skills', 'Settings']);
  assert.equal(delays, 2);
});
test('UI polling requires every semantic label in either supported locale', async () => {
  await assert.rejects(waitForUiContent({
    evaluate: async () => '模型 Skills',
    timeoutMs: 1,
    now: (() => { const times = [0, 0, 1]; return () => times.shift() ?? 1; })(),
    delay: async () => {},
  }), (error) => error.missing.length === 1 && error.missing[0] === 'Settings');
});
test('UI polling retries a transient missing execution context', async () => {
  const transient = Object.assign(new Error('Cannot find default execution context'), { cdpCode: -32000 });
  const values = [transient, '模型 技能 设置'];
  const result = await waitForUiContent({
    evaluate: async () => { const value = values.shift(); if (value instanceof Error) throw value; return value; },
    now: () => 0,
    delay: async () => {},
  });
  assert.deepEqual(result.content, ['Models', 'Skills', 'Settings']);
});
test('UI polling retries an explicitly destroyed execution context', async () => {
  const transient = Object.assign(new Error('Execution context was destroyed.'), { cdpCode: -32000 });
  const values = [transient, 'Models Skills Settings'];
  const result = await waitForUiContent({
    evaluate: async () => { const value = values.shift(); if (value instanceof Error) throw value; return value; },
    now: () => 0,
    delay: async () => {},
  });
  assert.deepEqual(result.content, ['Models', 'Skills', 'Settings']);
});
test('UI polling rethrows a non-transient CDP error immediately', async () => {
  const fatal = Object.assign(new Error('Permission denied'), { cdpCode: -32000 });
  let calls = 0;
  await assert.rejects(waitForUiContent({
    evaluate: async () => { calls += 1; throw fatal; },
    now: () => 0,
    delay: async () => {},
  }), (error) => error === fatal);
  assert.equal(calls, 1);
});
test('UI polling does not retry unrelated -32000 errors mentioning default execution context', async () => {
  const fatal = Object.assign(new Error('Permission denied in default execution context'), { cdpCode: -32000 });
  let calls = 0;
  await assert.rejects(waitForUiContent({
    evaluate: async () => { calls += 1; throw fatal; },
    now: () => 0,
    delay: async () => {},
  }), (error) => error === fatal);
  assert.equal(calls, 1);
});
test('UI polling rethrows a fatal evaluation error even when it reaches the deadline', async () => {
  const fatal = Object.assign(new Error('Permission denied'), { cdpCode: -32000 });
  let current = 0;
  let calls = 0;
  await assert.rejects(waitForUiContent({
    evaluate: async () => { calls += 1; current = 10; throw fatal; },
    timeoutMs: 10,
    now: () => current,
    delay: async () => {},
  }), (error) => error === fatal);
  assert.equal(calls, 1);
});
test('UI timeout preserves last text, missing labels, and HTTP evidence', async () => {
  let current = 0;
  await assert.rejects(waitForUiContent({
    evaluate: async () => { current = 11; return 'Skills only'; },
    timeoutMs: 10,
    now: () => current,
    delay: async () => {},
    http: { statusCode: 200, responseMs: 42 },
  }), (error) => {
    assert.match(error.message, /UI content timed out.*Models, Settings/);
    assert.equal(error.lastText, 'Skills only');
    assert.equal(error.lastBodyExcerpt, 'Skills only');
    assert.deepEqual(error.missing, ['Models', 'Settings']);
    assert.deepEqual(error.http, { statusCode: 200, responseMs: 42 });
    return true;
  });
});
test('UI timeout preserves the last transient dispatcher error after the fixed deadline', async () => {
  const transient = Object.assign(new Error('CDP error -32000: Cannot find default execution context'), { cdpCode: -32000 });
  const httpEvidence = { statusCode: 200, responseMs: 42 };
  const times = [0, 0, 10, 10];
  await assert.rejects(waitForUiContent({
    evaluate: async () => { throw transient; },
    timeoutMs: 10,
    now: () => times.shift() ?? 10,
    delay: async () => {},
    http: httpEvidence,
  }), (error) => {
    assert.equal(error.cause, transient);
    assert.equal(error.lastCdpError, 'CDP error -32000: Cannot find default execution context');
    assert.equal(error.lastText, '');
    assert.deepEqual(error.missing, ['Models', 'Skills', 'Settings']);
    assert.deepEqual(error.http, httpEvidence);
    return true;
  });
});
test('temp cleanup retries EBUSY and EPERM without real waits', async () => {
  const errors = [Object.assign(new Error('busy'), { code: 'EBUSY' }), Object.assign(new Error('locked'), { code: 'EPERM' })];
  let calls = 0;
  await removeWithRetry('temp', {
    rm: async () => { calls += 1; if (errors.length) throw errors.shift(); },
    delay: async () => {},
  });
  assert.equal(calls, 3);
});
test('temp cleanup retries ENOTEMPTY without a real wait', async () => {
  let calls = 0;
  await removeWithRetry('temp', {
    rm: async () => { calls += 1; if (calls === 1) throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' }); },
    delay: async () => {},
  });
  assert.equal(calls, 2);
});
test('temp cleanup fails immediately for a non-retryable error', async () => {
  let calls = 0;
  await assert.rejects(removeWithRetry('temp', {
    rm: async () => { calls += 1; throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    delay: async () => {},
  }), /denied/);
  assert.equal(calls, 1);
});
test('temp cleanup reports retry exhaustion', async () => {
  let calls = 0;
  await assert.rejects(removeWithRetry('temp', {
    attempts: 2,
    rm: async () => { calls += 1; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); },
    delay: async () => {},
  }), (error) => error.message.includes('after 2 attempts') && error.cause?.code === 'EBUSY');
  assert.equal(calls, 2);
});
