const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { prepareUpdate } = require('../scripts/prepare-update');

const BASE_PACKAGE = {
  name: 'pi-desktop-test',
  version: '1.1.5',
  dependencies: {
    '@agegr/pi-web': '0.8.5',
    '@earendil-works/pi-coding-agent': '0.83.0',
    untouched: '4.5.6',
  },
};

function tempPackage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-update-'));
  const packagePath = path.join(directory, 'package.json');
  const source = `${JSON.stringify(BASE_PACKAGE, null, 2)}\n`;
  fs.writeFileSync(packagePath, source);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, packagePath, source };
}

function run(packagePath, options = {}) {
  return prepareUpdate({
    packagePath,
    piWebVersion: options.piWebVersion ?? '0.8.5',
    piVersion: options.piVersion ?? '0.83.0',
    force: options.force,
    write: options.write ?? true,
  });
}

test('unchanged components return none and do not rewrite package.json', (t) => {
  const { packagePath, source } = tempPackage(t);

  assert.deepEqual(run(packagePath), {
    action: 'none',
    old: { piWebVersion: '0.8.5', piVersion: '0.83.0' },
    new: { piWebVersion: '0.8.5', piVersion: '0.83.0' },
    desktopVersion: '1.1.5',
  });
  assert.equal(fs.readFileSync(packagePath, 'utf8'), source);
});

test('a pi-web change updates only pi-web and bumps the desktop patch once', (t) => {
  const { packagePath } = tempPackage(t);

  const result = run(packagePath, { piWebVersion: '0.8.6' });
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  assert.equal(result.action, 'update');
  assert.equal(result.desktopVersion, '1.1.6');
  assert.equal(pkg.version, '1.1.6');
  assert.equal(pkg.dependencies['@agegr/pi-web'], '0.8.6');
  assert.equal(pkg.dependencies['@earendil-works/pi-coding-agent'], '0.83.0');
  assert.equal(pkg.dependencies.untouched, '4.5.6');
});

test('a Pi change updates only Pi and bumps the desktop patch once', (t) => {
  const { packagePath } = tempPackage(t);

  const result = run(packagePath, { piVersion: '0.84.0' });
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  assert.equal(result.action, 'update');
  assert.equal(result.desktopVersion, '1.1.6');
  assert.equal(pkg.version, '1.1.6');
  assert.equal(pkg.dependencies['@agegr/pi-web'], '0.8.5');
  assert.equal(pkg.dependencies['@earendil-works/pi-coding-agent'], '0.84.0');
});

test('changing both components still bumps the desktop patch only once', (t) => {
  const { packagePath } = tempPackage(t);

  const result = run(packagePath, { piWebVersion: '0.9.0', piVersion: '0.84.0' });
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  assert.equal(result.desktopVersion, '1.1.6');
  assert.equal(pkg.version, '1.1.6');
  assert.equal(pkg.dependencies['@agegr/pi-web'], '0.9.0');
  assert.equal(pkg.dependencies['@earendil-works/pi-coding-agent'], '0.84.0');
});

test('force rebuilds unchanged components without bumping or rewriting', (t) => {
  const { packagePath, source } = tempPackage(t);

  const result = run(packagePath, { force: true });

  assert.equal(result.action, 'rebuild');
  assert.equal(result.desktopVersion, '1.1.5');
  assert.equal(fs.readFileSync(packagePath, 'utf8'), source);
});

test('rerunning the same candidate does not bump the desktop again', (t) => {
  const { packagePath } = tempPackage(t);

  assert.equal(run(packagePath, { piVersion: '0.84.0' }).desktopVersion, '1.1.6');
  const second = run(packagePath, { piVersion: '0.84.0' });

  assert.equal(second.action, 'none');
  assert.equal(second.desktopVersion, '1.1.6');
  assert.equal(JSON.parse(fs.readFileSync(packagePath, 'utf8')).version, '1.1.6');
});

test('rejects prerelease component versions without writing', (t) => {
  const { packagePath, source } = tempPackage(t);

  assert.throws(
    () => run(packagePath, { piVersion: '0.84.0-beta.1' }),
    /Pi version.*exact X\.Y\.Z/i,
  );
  assert.equal(fs.readFileSync(packagePath, 'utf8'), source);
});

test('bumps an arbitrarily large exact desktop patch without losing precision', (t) => {
  const { packagePath } = tempPackage(t);
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '1.1.999999999999999999999';
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  assert.equal(run(packagePath, { piVersion: '0.84.0' }).desktopVersion, '1.1.1000000000000000000000');
});

test('retries a transient Windows rename conflict without rewriting again', (t) => {
  const { packagePath } = tempPackage(t);
  const originalRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('busy'), { code: 'EPERM' });
    return originalRename(...args);
  };
  t.after(() => { fs.renameSync = originalRename; });
  assert.equal(run(packagePath, { piVersion: '0.84.0' }).action, 'update');
  assert.equal(calls, 2);
});

test('CLI prints one JSON object and atomically writes formatted JSON', (t) => {
  const { directory, packagePath } = tempPackage(t);
  const script = path.join(__dirname, '..', 'scripts', 'prepare-update.js');
  const child = spawnSync(process.execPath, [
    script,
    '--package', packagePath,
    '--pi-web', '0.8.6',
    '--pi', '0.84.0',
    '--write',
  ], { encoding: 'utf8' });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const lines = child.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    action: 'update',
    old: { piWebVersion: '0.8.5', piVersion: '0.83.0' },
    new: { piWebVersion: '0.8.6', piVersion: '0.84.0' },
    desktopVersion: '1.1.6',
  });
  assert.match(fs.readFileSync(packagePath, 'utf8'), /\n  "version": "1\.1\.6",/);
  assert.deepEqual(fs.readdirSync(directory), ['package.json']);
});
