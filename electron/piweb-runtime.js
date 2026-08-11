const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_PORT = 30141;

function parsePort(value = String(DEFAULT_PORT)) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || String(port) !== String(value).trim() || port < 1 || port > 65535) {
    throw new Error(`invalid PI_WEB_PORT: ${value}`);
  }
  return port;
}

function buildPiWebLaunchSpec(options) {
  const {
    isPackaged, resourcesPath, developmentEntry, execPath,
    userDataDir, port = DEFAULT_PORT, env = process.env,
  } = options;
  const entry = isPackaged
    ? path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@agegr', 'pi-web', 'bin', 'pi-web.js')
    : developmentEntry;
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (key.toUpperCase() === 'NODE_OPTIONS' || key.toUpperCase() === 'NODE_OPTIONS_PATH') {
      delete childEnv[key];
    }
  }
  childEnv.ELECTRON_RUN_AS_NODE = '1';
  childEnv.PI_WEB_NO_OPEN = '1';
  childEnv.NEXT_TELEMETRY_DISABLED = '1';
  // 打包版 PATH 可能不含 npm/npx（pi-web 的 skills install 用 npx 拉技能包）
  const npmPrefix = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
  if (npmPrefix && fs.existsSync(npmPrefix)) {
    const existing = childEnv.PATH || childEnv.Path || '';
    if (existing && !existing.toLowerCase().includes(npmPrefix.toLowerCase())) {
      childEnv.PATH = npmPrefix + path.delimiter + existing;
    } else if (!existing) {
      childEnv.PATH = npmPrefix;
    }
  }
  return {
    command: execPath,
    entry,
    cwd: userDataDir,
    args: [entry, '--hostname', '127.0.0.1', '--port', String(parsePort(String(port))), '--no-open'],
    env: childEnv,
  };
}

module.exports = { DEFAULT_PORT, parsePort, buildPiWebLaunchSpec };
