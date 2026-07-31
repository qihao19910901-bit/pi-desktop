const fs = require('node:fs');
const http = require('node:http');
const MAX_RESPONSE_BYTES = 256 * 1024;
async function probePiWeb(url, { requestTimeoutMs = 2000, contentSignal = 'Pi Agent Web' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const request = http.get(url, (response) => {
      const status = response.statusCode || 0;
      if (status < 200 || status > 299) {
        response.resume();
        finish(new Error(`pi-web probe returned status ${status}`));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          const error = new Error(`pi-web probe response exceeded ${MAX_RESPONSE_BYTES} bytes`);
          finish(error);
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        const body = Buffer.concat(chunks).toString('utf8');
        finish(body.includes(contentSignal)
          ? undefined
          : new Error(`pi-web probe missing content signal: ${contentSignal}`));
      });
      response.on('error', finish);
    });
    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error(`pi-web probe timed out after ${requestTimeoutMs}ms`));
    });
    request.on('error', finish);
  });
}
async function waitForPiWeb(url, { timeoutMs = 60000, intervalMs = 500, probe = probePiWeb } = {}) {
  const startedAt = Date.now();
  let lastError;
  while (true) {
    try {
      await probe(url);
      return;
    } catch (error) {
      lastError = error;
    }
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      throw new Error(`pi-web readiness timed out: ${lastError.message}`, { cause: lastError });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}
function createPiWebService({ spawnImpl, waitForReady, stopTree, restartDelayMs = 1000, logger = console }) {
  let child = null;
  let activeSpec;
  let restartCount = 0;
  let stderr = [];
  let intentional = true;
  let restartTimer = null;
  const addLine = (line) => {
    stderr.push(line);
    if (stderr.length > 20) stderr = stderr.slice(-20);
  };

  const launch = async (spec) => {
    const launched = spawnImpl(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
    child = launched;
    let pending = '';
    launched.stderr.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach(addLine);
    });
    launched.stderr.on('end', () => {
      if (pending) addLine(pending);
      pending = '';
    });
    launched.once('exit', (code, signal) => {
      if (child !== launched) return;
      child = null;
      if (intentional) return;
      if (restartCount >= 1) {
        logger.error(`pi-web exited again (code=${code}, signal=${signal})`);
        return;
      }
      restartCount += 1;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (intentional) return;
        launch(activeSpec).catch((error) => logger.error('pi-web restart failed', error));
      }, restartDelayMs);
    });
    await waitForReady(spec.url);
  };

  return {
    async start(spec) {
      if (!fs.existsSync(spec.entry)) throw new Error(`pi-web entry not found: ${spec.entry}`);
      activeSpec = spec;
      restartCount = 0;
      stderr = [];
      intentional = false;
      await launch(spec);
    },
    async stop() {
      intentional = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const pid = child && child.pid;
      child = null;
      if (Number.isInteger(pid)) await stopTree(pid);
    },
    getDiagnostics: () => ({
      pid: child && Number.isInteger(child.pid) ? child.pid : null,
      restartCount,
      stderr: stderr.slice(),
    }),
  };
}

module.exports = { probePiWeb, waitForPiWeb, createPiWebService };
