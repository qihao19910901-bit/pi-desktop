const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildPiWebLaunchSpec, parsePort } = require('../electron/piweb-runtime');

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
  assert.deepEqual(spec.args.slice(-5), ['--hostname', '127.0.0.1', '--port', '30141', '--no-open']);
  assert.equal(spec.cwd, 'C:\\Users\\me\\AppData\\Roaming\\pi-desktop');
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(spec.env.KEEP_ME, 'yes');
  assert.equal('NODE_OPTIONS' in spec.env, false);
});

test('development uses the resolved package entry without a machine path', () => {
  const spec = buildPiWebLaunchSpec({
    isPackaged: false,
    resourcesPath: '',
    developmentEntry: 'C:\\src\\node_modules\\@agegr\\pi-web\\bin\\pi-web.js',
    execPath: 'C:\\src\\node_modules\\electron\\dist\\electron.exe',
    userDataDir: 'C:\\src\\.userdata',
    port: 30141,
    env: {},
  });
  assert.equal(spec.entry.includes('I:\\NODE'), false);
  assert.equal(spec.command, 'C:\\src\\node_modules\\electron\\dist\\electron.exe');
});

test('ports outside 1-65535 are rejected', () => {
  assert.throws(() => parsePort('0'), /invalid PI_WEB_PORT/);
  assert.throws(() => parsePort('abc'), /invalid PI_WEB_PORT/);
  assert.equal(parsePort('30141'), 30141);
});
