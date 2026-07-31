const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { probePiWeb, waitForPiWeb, createPiWebService } = require('../electron/piweb-service');

const SPEC = {
  command: 'electron.exe', args: ['pi-web.js'],
  cwd: __dirname, env: { TEST: '1' },
  entry: __filename, url: 'http://127.0.0.1:30141',
};
const silentLogger = { log() {}, warn() {}, error() {} };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

const close = (server) => new Promise((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()));

test('probe requires a 2xx response containing the Pi Agent Web signal', async () => {
  const { server, url } = await serve((request, response) => {
    if (request.url === '/unavailable') response.writeHead(503).end('Pi Agent Web');
    else if (request.url === '/wrong-content') response.writeHead(200).end('starting');
    else response.writeHead(201).end('Pi Agent Web ready');
  });
  try {
    await assert.rejects(probePiWeb(`${url}/unavailable`), /status 503/);
    await assert.rejects(probePiWeb(`${url}/wrong-content`), /missing content signal/);
    await assert.doesNotReject(probePiWeb(`${url}/ready`));
  } finally {
    await close(server);
  }
});

test('probe rejects oversized responses and destroys timed-out requests', async () => {
  const oversized = await serve((_request, response) => response.end(Buffer.alloc(256 * 1024 + 1, 65)));
  try {
    await assert.rejects(probePiWeb(oversized.url), /exceeded 262144 bytes/);
  } finally {
    await close(oversized.server);
  }

  let closed;
  const requestClosed = new Promise((resolve) => { closed = resolve; });
  const hanging = await serve((request) => request.once('close', closed));
  try {
    await assert.rejects(probePiWeb(hanging.url, { requestTimeoutMs: 20 }), /timed out after 20ms/);
    await requestClosed;
  } finally {
    await close(hanging.server);
  }
});

test('wait timeout reports and preserves the last probe error', async () => {
  const last = new Error('still booting');
  await assert.rejects(
    waitForPiWeb('http://unused', {
      timeoutMs: 10,
      intervalMs: 1,
      probe: async () => { throw last; },
    }),
    (error) => error.message.includes('still booting') && error.cause === last,
  );
});

test('missing entry rejects before spawn', async () => {
  let spawned = false;
  const service = createPiWebService({
    spawnImpl: () => { spawned = true; },
    waitForReady: async () => {},
    stopTree() {},
  });
  await assert.rejects(service.start({ ...SPEC, entry: `${__filename}.missing` }), /entry not found/);
  assert.equal(spawned, false);
});

test('start waits for readiness and diagnostics retain only the last 20 lines', async () => {
  const child = fakeChild(101);
  let ready;
  const readiness = new Promise((resolve) => { ready = resolve; });
  const service = createPiWebService({
    spawnImpl: () => child,
    waitForReady: () => readiness,
    stopTree() {},
  });
  let settled = false;
  const started = service.start(SPEC).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  ready();
  await started;
  child.stderr.write(`${Array.from({ length: 25 }, (_, index) => `line-${index + 1}`).join('\n')}\n`);
  const diagnostics = service.getDiagnostics();
  assert.deepEqual(Object.keys(diagnostics), ['pid', 'restartCount', 'stderr']);
  assert.deepEqual(diagnostics, {
    pid: 101,
    restartCount: 0,
    stderr: Array.from({ length: 20 }, (_, index) => `line-${index + 6}`),
  });
  assert.equal('child' in diagnostics, false);
});

test('first unexpected exit restarts once with the same spec and second does not', async () => {
  const children = [];
  const calls = [];
  const service = createPiWebService({
    spawnImpl: (...args) => {
      calls.push(args);
      const child = fakeChild(200 + children.length);
      children.push(child);
      return child;
    },
    waitForReady: async () => {},
    stopTree() {},
    restartDelayMs: 0,
    logger: silentLogger,
  });
  await service.start(SPEC);
  children[0].emit('exit', 1, null);
  await tick();
  assert.equal(children.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  children[1].emit('exit', 1, null);
  await tick();
  assert.equal(children.length, 2);
  assert.equal(service.getDiagnostics().restartCount, 1);
});

test('stop targets only the current owned PID and intentional exit does not restart', async () => {
  const children = [];
  const stopped = [];
  const service = createPiWebService({
    spawnImpl: () => {
      const child = fakeChild(300 + children.length);
      children.push(child);
      return child;
    },
    waitForReady: async () => {},
    stopTree: (pid) => stopped.push(pid),
    restartDelayMs: 0,
    logger: silentLogger,
  });
  await service.start(SPEC);
  children[0].emit('exit', 1, null);
  await tick();
  await service.stop();
  assert.deepEqual(stopped, [301]);
  children[1].emit('exit', 0, null);
  await tick();
  assert.equal(children.length, 2);
  assert.equal(service.getDiagnostics().pid, null);
});
