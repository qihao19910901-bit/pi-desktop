const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DEFAULT_PORT, buildPiWebLaunchSpec, parsePort } = require('../electron/piweb-runtime');

test('packaged app uses Electron as Node and loopback only', () => {
  const spec = buildPiWebLaunchSpec({
    isPackaged: true,
    resourcesPath: 'C:\\Pi\\resources',
    developmentEntry: 'C:\\src\\node_modules\\@agegr\\pi-web\\bin\\pi-web.js',
    execPath: 'C:\\Pi\\Pi Desktop.exe',
    userDataDir: 'C:\\Users\\me\\AppData\\Roaming\\pi-desktop',
    port: 30141,
    env: { KEEP_ME: 'yes', NODE_OPTIONS: '--bad-flag' },
  });
  assert.equal(spec.command, 'C:\\Pi\\Pi Desktop.exe');
  assert.equal(spec.entry, path.join('C:\\Pi\\resources', 'app.asar.unpacked', 'node_modules', '@agegr', 'pi-web', 'bin', 'pi-web.js'));
  assert.deepEqual(spec.args, [spec.entry, '--hostname', '127.0.0.1', '--port', '30141', '--no-open']);
  assert.equal(spec.cwd, 'C:\\Users\\me\\AppData\\Roaming\\pi-desktop');
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(spec.env.KEEP_ME, 'yes');
  assert.equal('NODE_OPTIONS' in spec.env, false);
});

test('development uses the resolved package entry without a machine path', () => {
  const developmentEntry = 'C:\\src\\node_modules\\@agegr\\pi-web\\bin\\pi-web.js';
  const spec = buildPiWebLaunchSpec({
    isPackaged: false,
    resourcesPath: '',
    developmentEntry,
    execPath: 'C:\\src\\node_modules\\electron\\dist\\electron.exe',
    userDataDir: 'C:\\src\\.userdata',
    port: 30141,
    env: {},
  });
  assert.equal(spec.entry, developmentEntry);
  assert.deepEqual(spec.args, [developmentEntry, '--hostname', '127.0.0.1', '--port', '30141', '--no-open']);
  assert.equal(spec.cwd, 'C:\\src\\.userdata');
  assert.equal(spec.command, 'C:\\src\\node_modules\\electron\\dist\\electron.exe');
});

test('removes Node option injection case-insensitively without mutating input env', () => {
  const env = {
    KEEP_ME: 'yes',
    NODE_OPTIONS: '--bad-flag',
    NODE_OPTIONS_PATH: 'C:\\bad-options-uppercase',
    Node_Options: '--mixed-case-flag',
    node_options_path: 'C:\\bad-options',
  };
  const originalEnv = { ...env };
  const spec = buildPiWebLaunchSpec({
    isPackaged: false,
    resourcesPath: '',
    developmentEntry: 'C:\\src\\pi-web.js',
    execPath: 'C:\\src\\electron.exe',
    userDataDir: 'C:\\src\\.userdata',
    env,
  });

  assert.deepEqual(env, originalEnv);
  assert.notStrictEqual(spec.env, env);
  assert.equal('NODE_OPTIONS' in spec.env, false);
  assert.equal('NODE_OPTIONS_PATH' in spec.env, false);
  assert.equal('Node_Options' in spec.env, false);
  assert.equal('node_options_path' in spec.env, false);
  assert.equal(spec.env.KEEP_ME, 'yes');
});

test('ports outside 1-65535 are rejected', () => {
  assert.throws(() => parsePort('0'), /invalid PI_WEB_PORT/);
  assert.throws(() => parsePort('65536'), /invalid PI_WEB_PORT/);
  assert.throws(() => parsePort('abc'), /invalid PI_WEB_PORT/);
  assert.throws(() => parsePort('30141junk'), /invalid PI_WEB_PORT/);
  assert.equal(parsePort('1'), 1);
  assert.equal(parsePort('30141'), 30141);
  assert.equal(parsePort('65535'), 65535);
  assert.equal(parsePort(), DEFAULT_PORT);
});
