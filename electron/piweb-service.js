const fs = require('node:fs');
const http = require('node:http');
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_STDERR_FRAGMENT_CHARS = 64 * 1024;
async function probePiWeb(url, { requestTimeoutMs = 2000, contentSignal = 'Pi Agent Web' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
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
    deadlineTimer = setTimeout(() => {
      request.destroy(new Error(`pi-web probe timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
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
  let generation = 0;
  let inFlight = null;
  const addLine = (line) => {
    stderr.push(line);
    if (stderr.length > 20) stderr = stderr.slice(-20);
  };

  const launch = async (spec, token) => {
    const launched = spawnImpl(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
    child = launched;
    let ready = false;
    let terminated = false;
    let rejectEarlyFailure;
    const earlyFailure = new Promise((_resolve, reject) => { rejectEarlyFailure = reject; });
    const terminate = (error, code = null, signal = null) => {
      if (terminated) return;
      terminated = true;
      if (!ready) {
        rejectEarlyFailure(error);
        return;
      }
      if (child !== launched) return;
      child = null;
      if (intentional) return;
      if (restartCount >= 1) {
        logger.error(`pi-web exited again (code=${code}, signal=${signal})`, error);
        return;
      }
      restartCount += 1;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (intentional || generation !== token) return;
        launch(activeSpec, token).catch((restartError) => logger.error('pi-web restart failed', restartError));
      }, restartDelayMs);
    };
    launched.once('error', (error) => terminate(error));
    launched.once('exit', (code, signal) => terminate(
      new Error(`pi-web exited (code=${code}, signal=${signal})`), code, signal));
    launched.stdout?.resume();
    let pending = '';
    launched.stderr?.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop().slice(-MAX_STDERR_FRAGMENT_CHARS);
      lines.forEach(addLine);
    });
    launched.stderr?.on('end', () => {
      if (pending) addLine(pending);
      pending = '';
    });
    try {
      await Promise.race([waitForReady(spec.url), earlyFailure]);
      if (generation !== token) throw new Error('pi-web start cancelled');
      ready = true;
    } catch (readinessError) {
      if (generation !== token) throw new Error('pi-web start cancelled');
      intentional = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const ownsLaunched = child === launched;
      if (ownsLaunched) child = null;
      if (ownsLaunched && Number.isInteger(launched.pid)) {
        try {
          await stopTree(launched.pid);
        } catch (cleanupError) {
          logger.error('pi-web readiness cleanup failed', cleanupError);
        }
      }
      throw readinessError;
    }
  };

  return {
    async start(spec) {
      if (!fs.existsSync(spec.entry)) throw new Error(`pi-web entry not found: ${spec.entry}`);
      if (child || restartTimer || inFlight !== null) throw new Error('pi-web service already active');
      activeSpec = spec;
      restartCount = 0;
      stderr = [];
      intentional = false;
      const token = ++generation;
      inFlight = token;
      try {
        await launch(spec, token);
      } finally {
        if (inFlight === token) inFlight = null;
      }
    },
    async stop() {
      intentional = true;
      generation += 1;
      inFlight = null;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const owned = child;
      const pid = owned && owned.pid;
      if (Number.isInteger(pid)) await stopTree(pid);
      if (child === owned) child = null;
    },
    getDiagnostics: () => ({
      pid: child && Number.isInteger(child.pid) ? child.pid : null,
      restartCount,
      stderr: stderr.slice(),
    }),
  };
}

module.exports = { probePiWeb, waitForPiWeb, createPiWebService };
