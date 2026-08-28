const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const pkg = require('../package.json');

const exact = (value) => /^\d+\.\d+\.\d+$/.test(value);
const builder = YAML.parse(fs.readFileSync(
  path.join(__dirname, '..', 'electron-builder.yml'),
  'utf8',
));

test('runtime and build dependencies are exact', () => {
  assert.equal(pkg.overrides?.['@agegr/pi-web']?.['@earendil-works/pi-coding-agent'],
    '$@earendil-works/pi-coding-agent');
  assert.equal(pkg.dependencies['@agegr/pi-web'], '0.8.11');
  assert.equal(pkg.dependencies['@earendil-works/pi-coding-agent'], '0.84.3');
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
  assert.equal(pkg.devDependencies.electron, '43.2.0');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.devDependencies['@electron/asar'], '4.2.1');
  assert.equal(pkg.devDependencies.yaml, '2.9.0');
  for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.equal(exact(version), true, `non-exact version: ${version}`);
  }
});

test('installer artifact name matches updater metadata', () => {
  assert.equal(builder.artifactName, 'Pi-Desktop-Setup-${version}.${ext}');
});

test('the repository exposes deterministic quality commands', () => {
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts['build:dir'], 'npm run rebuild:native && node electron/run-build.js --dir');
  assert.equal(pkg.scripts['verify:package'], 'node scripts/verify-package.js');
  assert.equal(pkg.scripts['smoke:package'], 'node scripts/smoke-packaged-app.js');
  assert.equal(pkg.scripts['rebuild:native'], 'node scripts/rebuild-native.js');
});

test('development pi-web script is loopback only', () => {
  assert.equal(pkg.scripts['start:piweb'], 'node_modules/@agegr/pi-web/bin/pi-web.js --hostname 127.0.0.1 --no-open');
});
