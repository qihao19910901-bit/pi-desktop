// piweb-fetch.test.js - 回环 HTTP 封装测试
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requestJson } = require('../electron/piweb-fetch');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test('GET parses JSON responses', async () => {
  const { server, port } = await startServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ packages: [{ source: 'npm:demo' }] }));
  });
  try {
    const data = await requestJson(`http://127.0.0.1:${port}/api/plugins?cwd=X`);
    assert.deepEqual(data, { packages: [{ source: 'npm:demo' }] });
  } finally {
    server.close();
  }
});

test('POST sends JSON body with content-type', async () => {
  let received;
  const { server, port } = await startServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = { method: req.method, type: req.headers['content-type'], body: JSON.parse(body) };
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  });
  try {
    await requestJson(`http://127.0.0.1:${port}/api/plugins`, {
      method: 'POST',
      body: { cwd: 'C:/repo', action: 'install', source: 'npm:demo' },
    });
    assert.equal(received.method, 'POST');
    assert.match(received.type, /application\/json/);
    assert.equal(received.body.action, 'install');
  } finally {
    server.close();
  }
});

test('surfaces the pi-web error message from error responses', async () => {
  const { server, port } = await startServer((req, res) => {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Access denied' }));
  });
  try {
    await assert.rejects(
      () => requestJson(`http://127.0.0.1:${port}/api/plugins?cwd=X`),
      (error) => error.message === 'Access denied' && error.status === 403,
    );
  } finally {
    server.close();
  }
});

test('rejects non-loopback targets', async () => {
  await assert.rejects(
    () => requestJson('http://example.com/api/plugins'),
    /non-loopback/,
  );
});

test('times out on silent servers', async () => {
  const { server, port } = await startServer(() => { /* 不响应 */ });
  try {
    await assert.rejects(
      () => requestJson(`http://127.0.0.1:${port}/x`, { timeoutMs: 300 }),
      /timed out/,
    );
  } finally {
    server.close();
  }
});
