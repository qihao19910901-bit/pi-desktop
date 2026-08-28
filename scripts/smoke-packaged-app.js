const { spawn, execFile } = require('node:child_process'), fs = require('node:fs/promises');
const net = require('node:net'), os = require('node:os'), path = require('node:path');
const WEB_PORT = 30142, CDP_PORT = 9333;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const UI_LABELS = [
  ['Models', '模型'], ['Skills', '技能'], ['Settings', '设置'],
];
// 子进程环境：剥离 ELECTRON_RUN_AS_NODE（否则 electron.exe 以 Node 模式运行，
// --remote-debugging-port 报 bad option，smoke 必然失败）
function createChildEnv(userData) {
  const env = {
    ...process.env,
    PI_DESKTOP_SMOKE: '1',
    PI_DESKTOP_USER_DATA: userData,
    PI_WEB_PORT: String(WEB_PORT),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
async function probeHttp(url, { timeoutMs = 2000, signal = '<title>Pi Web</title>', now = () => performance.now() } = {}) {
  const started = now();
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`${url} request failed: ${error.message}`, { cause: error });
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  if (!body.includes(signal)) throw new Error(`${url} missing ${signal}`);
  return { statusCode: response.status, responseMs: now() - started };
}
async function waitForHttp(url, { timeoutMs = 60000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await probeHttp(url, { timeoutMs: Math.min(2000, deadline - Date.now()) }); }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`startup timed out after ${timeoutMs}ms: ${lastError?.message || 'no response'}`);
}
function createCdpDispatcher(send, timeoutMs = 5000) {
  let nextId = 1;
  const pending = new Map();
  function request(method, params = {}, requestTimeoutMs = timeoutMs) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  function handle(data) {
    const message = JSON.parse(data);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(`CDP error ${message.error.code}: ${message.error.message}`);
      error.cdpCode = message.error.code;
      item.reject(error);
    } else item.resolve(message.result);
  }
  function close(error) {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  }
  return { request, handle, close };
}
function portIsOpen(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const done = (open) => { if (!settled) { settled = true; socket.destroy(); resolve(open); } };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
async function waitForPortsClosed(ports, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const open = (await Promise.all(ports.map(async (port) => [port, await portIsOpen(port, Math.min(250, remaining))]))).filter(([, value]) => value);
    if (open.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`ports still open after ${timeoutMs}ms: ${ports.join(',')}`);
}
function stopTree(pid) {
  if (process.platform !== 'win32') return Promise.resolve().then(() => process.kill(pid, 'SIGTERM'));
  return new Promise((resolve, reject) => execFile('taskkill', ['/pid', String(pid), '/f', '/t'],
    { windowsHide: true, timeout: 8000 }, (error) => error ? reject(error) : resolve()));
}
async function cleanupOwnedProcess(child, ports, { stopTree: stop = stopTree, timeoutMs = 10000 } = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid < 1
    || !('exitCode' in child) || !('signalCode' in child)) throw new Error('invalid owned process');
  const { pid } = child;
  let stopError;
  if (child.exitCode === null && child.signalCode === null) {
    try { await withTimeout(Promise.resolve().then(() => stop(pid)), Math.min(timeoutMs, 8000), `stop process tree ${pid}`); }
    catch (error) { stopError = error; }
  }
  try { await waitForPortsClosed(ports, { timeoutMs }); }
  catch (error) {
    if (stopError) throw new AggregateError([stopError, error], `failed to stop process ${pid} and close ports`);
    throw error;
  }
  if (stopError && child.exitCode === null && child.signalCode === null) throw stopError;
  return { pid, portsClosed: ports, ...(stopError && { stopError: stopError.message }) };
}
function outputTail(maxChars = 8192) {
  let value = '';
  return { append: (chunk) => { value = (value + chunk).slice(-maxChars); }, read: () => value.trim() };
}
async function fetchTargets(timeoutMs = 2000) {
  let response;
  try { response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, { signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new Error(`CDP target request failed: ${error.message}`, { cause: error }); }
  if (!response.ok) throw new Error(`CDP target request returned HTTP ${response.status}`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('CDP target response is not an array');
  return targets;
}
async function waitForTarget(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const target = (await fetchTargets(Math.min(2000, deadline - Date.now()))).find((item) => item.url?.startsWith(WEB_URL) && item.webSocketDebuggerUrl);
      if (target) return target;
      lastError = new Error('Pi Web target is not ready');
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`CDP target timed out: ${lastError?.message}`);
}
function createCdpSession(webSocketUrl, { timeoutMs = 5000, WebSocketImpl = WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(webSocketUrl);
    const cdp = createCdpDispatcher((message) => socket.send(message), timeoutMs);
    let settled = false;
    let connected = false;
    let socketClosed = false;
    let sessionClosed = false;
    const closeSocket = () => {
      if (socketClosed) return;
      socketClosed = true;
      socket.close();
    };
    const fail = (error) => {
      if (settled && !connected) return;
      if (connected && sessionClosed) return;
      settled = true;
      sessionClosed = true;
      clearTimeout(timer);
      cdp.close(error);
      closeSocket();
      if (!connected) reject(error);
    };
    const timer = setTimeout(() => fail(new Error(`CDP WebSocket connect timed out after ${timeoutMs}ms`)), timeoutMs);
    socket.addEventListener('message', (event) => { try { cdp.handle(String(event.data)); } catch (error) { fail(error); } });
    socket.addEventListener('error', () => fail(new Error('CDP WebSocket error')));
    socket.addEventListener('close', () => fail(new Error('CDP WebSocket closed')));
    socket.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      connected = true;
      sessionClosed = false;
      clearTimeout(timer);
      resolve({
        async evaluateBody(requestTimeoutMs = timeoutMs) {
          const result = await cdp.request('Runtime.evaluate', { expression: "document.body?.innerText ?? ''", returnByValue: true }, requestTimeoutMs);
          if (result.exceptionDetails) throw new Error(`CDP body evaluation failed: ${result.exceptionDetails.text || 'exception'}`);
          if (result.result?.type === 'undefined') return ''; if (typeof result.result?.value !== 'string') throw new Error(`CDP body evaluation returned unexpected ${result.result?.type || 'missing'} result`);
          return result.result.value;
        },
        close() {
          if (sessionClosed) return;
          sessionClosed = true;
          cdp.close(new Error('CDP session closed'));
          closeSocket();
        },
      });
    });
  });
}
function uiTimeoutError(text, missing, http, lastCdpError) {
  const error = new Error(`UI content timed out; missing: ${missing.join(', ')}`, lastCdpError ? { cause: lastCdpError } : undefined);
  Object.assign(error, {
    lastText: text,
    lastBodyExcerpt: text.slice(0, 1000),
    missing,
    http,
    lastCdpError: lastCdpError?.message,
  });
  return error;
}
function isTransientExecutionContextError(error) {
  return error?.cdpCode === -32000
    && /^(?:CDP error -32000: )?(?:cannot find (?:default )?execution context|execution context (?:was )?(?:destroyed|not found)|cannot find context)[.!]?$/i.test(error.message);
}
async function waitForUiContent({
  evaluate, required = UI_LABELS, timeoutMs = 10000, now = Date.now,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), http,
}) {
  const deadline = now() + timeoutMs;
  let text = '';
  let lastCdpError;
  const semanticName = (labels) => labels[0];
  let missing = required.map(semanticName);
  while (now() < deadline) {
    const remaining = deadline - now();
    try { text = await evaluate(remaining); }
    catch (error) {
      if (!isTransientExecutionContextError(error)) throw error;
      lastCdpError = error;
      if (now() >= deadline) break;
      await delay(Math.min(100, Math.max(0, deadline - now())));
      continue;
    }
    missing = required.filter((labels) => !labels.some((label) => text.includes(label))).map(semanticName);
    if (missing.length === 0) return { content: required.map(semanticName) };
    await delay(Math.min(100, Math.max(0, deadline - now())));
  }
  throw uiTimeoutError(text, missing, http, lastCdpError);
}
async function removeWithRetry(target, {
  attempts = 30, rm = (value) => fs.rm(value, { recursive: true, force: true }),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await rm(target); return; }
    catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
      lastError = error;
      if (attempt < attempts) await delay(100);
    }
  }
  throw new Error(`temp cleanup failed after ${attempts} attempts: ${lastError.message}`, { cause: lastError });
}
async function runSmoke() {
  const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Pi Desktop.exe');
  await fs.access(exe);
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-desktop-smoke-'));
  const stdout = outputTail();
  const stderr = outputTail();
  let child;
  let cdpSession;
  let httpResult;
  try {
    await waitForPortsClosed([WEB_PORT, CDP_PORT], { timeoutMs: 250, intervalMs: 25 });
    const started = performance.now();
    const remainingMs = () => Math.max(0, Math.round(60000 - (performance.now() - started)));
    const uiBudget = () => {
      const remaining = remainingMs();
      if (remaining === 0) throw uiTimeoutError('', UI_LABELS.map((labels) => labels[0]), httpResult);
      return remaining;
    };
    child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`], {
      env: createChildEnv(userData),
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', stdout.append); child.stdout.on('error', stderr.append);
    child.stderr.on('data', stderr.append); child.stderr.on('error', stderr.append);
    const exited = new Promise((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => reject(new Error(`packaged app exited early (${code ?? signal})`)));
    });
    httpResult = await Promise.race([waitForHttp(WEB_URL, { timeoutMs: remainingMs() }), exited]);
    const httpReadyMs = Math.round(performance.now() - started);
    if (httpResult.responseMs > 2000) throw new Error(`HTTP response exceeded 2000ms: ${httpResult.responseMs}ms`);
    httpResult.responseMs = Math.round(httpResult.responseMs);
    const target = await waitForTarget(Math.min(10000, uiBudget()));
    cdpSession = await createCdpSession(target.webSocketDebuggerUrl, { timeoutMs: Math.min(5000, uiBudget()) });
    const ui = await waitForUiContent({
      evaluate: (timeoutMs) => cdpSession.evaluateBody(timeoutMs),
      timeoutMs: uiBudget(), http: httpResult,
    });
    const startupMs = Math.round(performance.now() - started);
    cdpSession.close(); cdpSession = null;
    const cleanup = await cleanupOwnedProcess(child, [WEB_PORT, CDP_PORT]);
    child = null;
    await removeWithRetry(userData);
    return { ok: true, startupMs, httpReadyMs, http: httpResult, content: ui.content, cleanup, userDataRemoved: true };
  } catch (error) {
    error.http ||= httpResult;
    if (cdpSession) { cdpSession.close(); cdpSession = null; }
    if (child?.pid) try { error.cleanup = await cleanupOwnedProcess(child, [WEB_PORT, CDP_PORT]); child = null; } catch (cleanupError) { error.cleanupError = cleanupError.message; }
    try { await removeWithRetry(userData); } catch (cleanupError) { error.userDataCleanupError = cleanupError.message; }
    error.stdoutTail = stdout.read(); error.stderrTail = stderr.read();
    throw error;
  }
}
module.exports = { withTimeout, probeHttp, createCdpDispatcher, createCdpSession, cleanupOwnedProcess, waitForPortsClosed, waitForUiContent, removeWithRetry, runSmoke };
if (require.main === module) {
  runSmoke().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message, http: error.http, missing: error.missing, lastBodyExcerpt: error.lastBodyExcerpt, lastCdpError: error.lastCdpError, cleanup: error.cleanup, cleanupError: error.cleanupError, userDataCleanupError: error.userDataCleanupError, stdoutTail: error.stdoutTail || '', stderrTail: error.stderrTail || '' }));
    process.exitCode = 1;
  });
}
