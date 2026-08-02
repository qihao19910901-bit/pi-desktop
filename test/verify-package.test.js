const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const { verifyResources } = require('../scripts/verify-package');

const EXPECTED = { desktop: '1.1.5', piWeb: '0.8.5', pi: '0.83.0' };
const SHELL_FILES = [
  'electron/main.js', 'electron/preload.js', 'electron/tray.js', 'electron/updater.js',
  'electron/piweb-runtime.js', 'electron/piweb-service.js', 'electron/safe-html.js',
  'package.json',
];

const write = (file, content = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

async function fakeResources(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-package-'));
  const external = options.externalUnpacked
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'verify-package-external-'))
    : null;
  const resources = path.join(root, 'resources');
  const source = path.join(root, 'asar-source');
  t.after(() => {
    const unpacked = path.join(resources, 'app.asar.unpacked');
    if (external && fs.existsSync(unpacked)) {
      if (process.platform === 'win32') fs.rmdirSync(unpacked);
      else fs.unlinkSync(unpacked);
    }
    fs.rmSync(root, { recursive: true, force: true });
    if (external) fs.rmSync(external, { recursive: true, force: true });
  });
  fs.mkdirSync(resources, { recursive: true });

  if (!options.noAsar) {
    for (const file of SHELL_FILES) {
      if (file !== 'package.json' && file !== options.omit) {
        if (file === options.directoryShell) fs.mkdirSync(path.join(source, file), { recursive: true });
        else write(path.join(source, file));
      }
    }
    if (options.omit !== 'package.json') {
      write(path.join(source, 'package.json'), options.desktopJson ?? JSON.stringify({ version: EXPECTED.desktop }));
    }
    await asar.createPackage(source, path.join(resources, 'app.asar'));
  }

  if (!options.noUnpacked) {
    const modules = path.join(external || path.join(resources, 'app.asar.unpacked'), 'node_modules');
    if (options.omit !== 'pi-web.js') write(path.join(modules, '@agegr/pi-web/bin/pi-web.js'));
    if (options.omit !== 'pi-web-package') write(path.join(modules, '@agegr/pi-web/package.json'), options.piWebJson ?? JSON.stringify({ version: EXPECTED.piWeb }));
    if (options.omit !== 'pi-package') write(path.join(modules, '@earendil-works/pi-coding-agent/package.json'), options.piJson ?? JSON.stringify({ version: EXPECTED.pi }));
    write(path.join(modules, '@agegr/pi-web/.next/static/chunks/app/page-test.js'),
      options.compactBundle ?? 'chat.commandCompact chat.compactContext');
    if (external) {
      fs.symlinkSync(external, path.join(resources, 'app.asar.unpacked'), process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  if (options.duplicate) fs.mkdirSync(path.join(resources, 'node_modules'), { recursive: true });
  return resources;
}

test('rejects a missing app.asar', async (t) => {
  const resources = await fakeResources(t, { noAsar: true });
  assert.throws(() => verifyResources(resources, EXPECTED), /app\.asar.*missing/i);
});

test('rejects every missing shell file in app.asar', async (t) => {
  for (const file of SHELL_FILES) {
    const resources = await fakeResources(t, { omit: file });
    assert.throws(() => verifyResources(resources, EXPECTED), new RegExp(file.replace('/', '[\\\\/]')));
  }
});

test('rejects an ASAR directory masquerading as a required shell file', async (t) => {
  const resources = await fakeResources(t, { directoryShell: 'electron/main.js' });
  assert.throws(() => verifyResources(resources, EXPECTED), /electron\/main\.js.*regular file/i);
});

test('rejects missing unpacked dependency files and tree', async (t) => {
  for (const omit of ['pi-web.js', 'pi-web-package', 'pi-package']) {
    const resources = await fakeResources(t, { omit });
    assert.throws(() => verifyResources(resources, EXPECTED), /app\.asar\.unpacked.*missing/i);
  }
  const resources = await fakeResources(t, { noUnpacked: true });
  assert.throws(() => verifyResources(resources, EXPECTED), /app\.asar\.unpacked.*missing/i);
});

test('rejects a duplicate resources/node_modules dependency tree', async (t) => {
  const resources = await fakeResources(t, { duplicate: true });
  assert.throws(() => verifyResources(resources, EXPECTED), /resources[\\\\/]node_modules.*duplicate/i);
});

test('rejects an unpacked dependency tree linked outside resources', async (t) => {
  const resources = await fakeResources(t, { externalUnpacked: true });
  assert.throws(() => verifyResources(resources, EXPECTED), /app\.asar\.unpacked.*symbolic link|junction/i);
});

test('rejects a pi-web package without both Compact capability markers', async (t) => {
  for (const compactBundle of ['', 'chat.commandCompact', 'chat.compactContext']) {
    const resources = await fakeResources(t, { compactBundle });
    assert.throws(() => verifyResources(resources, EXPECTED), /Compact capability.*missing/i);
  }
});

test('rejects invalid metadata and each version mismatch', async (t) => {
  const cases = [
    [{ desktopJson: '{' }, /package\.json.*JSON/i],
    [{ desktopJson: '{}' }, /Desktop.*version/i],
    [{ desktopJson: '{"version":"9.0.0"}' }, /Desktop.*9\.0\.0.*1\.1\.5/i],
    [{ piWebJson: '{"version":"9.0.0"}' }, /pi-web.*9\.0\.0.*0\.8\.5/i],
    [{ piJson: '{"version":"9.0.0"}' }, /Pi.*9\.0\.0.*0\.83\.0/i],
  ];
  for (const [options, pattern] of cases) {
    const resources = await fakeResources(t, options);
    assert.throws(() => verifyResources(resources, EXPECTED), pattern);
  }
});

test('passes with exactly one unpacked tree and all required files', async (t) => {
  const resources = await fakeResources(t);
  assert.deepEqual(verifyResources(resources, EXPECTED), {
    desktop: '1.1.5', piWeb: '0.8.5', pi: '0.83.0', dependencyTree: 'app.asar.unpacked/node_modules',
  });
});
