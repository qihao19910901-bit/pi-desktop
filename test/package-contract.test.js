const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

const exact = (value) => /^\d+\.\d+\.\d+$/.test(value);

test('runtime and build dependencies are exact', () => {
  assert.equal(pkg.dependencies['@agegr/pi-web'], '0.8.5');
  assert.equal(pkg.dependencies['@earendil-works/pi-coding-agent'], '0.83.0');
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
  assert.equal(pkg.devDependencies.electron, '43.2.0');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.devDependencies['@electron/asar'], '3.4.1');
  assert.equal(pkg.devDependencies.yaml, '2.9.0');
  for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.equal(exact(version), true, `non-exact version: ${version}`);
  }
});

test('the repository exposes deterministic quality commands', () => {
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts['build:dir'], 'node electron/run-build.js --dir');
  assert.equal(pkg.scripts['verify:package'], 'node scripts/verify-package.js');
  assert.equal(pkg.scripts['smoke:package'], 'node scripts/smoke-packaged-app.js');
});

test('development pi-web script is loopback only', () => {
  assert.equal(pkg.scripts['start:piweb'], 'node_modules/@agegr/pi-web/bin/pi-web.js --hostname 127.0.0.1 --no-open');
});
