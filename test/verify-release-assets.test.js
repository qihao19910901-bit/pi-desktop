const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { verifyReleaseAssets } = require('../scripts/verify-release-assets');

test('accepts exactly one installer, its blockmap, and latest metadata', () => {
  assert.deepEqual(verifyReleaseAssets({
    version: '1.2.3',
    assets: [
      'Pi-Desktop-Setup-1.2.3.exe',
      'Pi-Desktop-Setup-1.2.3.exe.blockmap',
      'latest.yml',
    ],
  }), { ok: true, missing: [] });
});

test('rejects an installer for the wrong version', () => {
  const result = verifyReleaseAssets({
    version: '1.2.3',
    assets: [
      'Pi-Desktop-Setup-9.9.9.exe',
      'Pi-Desktop-Setup-1.2.3.exe.blockmap',
      'latest.yml',
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['Pi-Desktop-Setup-1.2.3.exe']);
  assert.deepEqual(result.unexpected, ['Pi-Desktop-Setup-9.9.9.exe']);
});

test('rejects missing latest metadata', () => {
  const result = verifyReleaseAssets({
    version: '1.2.3',
    assets: [
      'Pi-Desktop-Setup-1.2.3.exe',
      'Pi-Desktop-Setup-1.2.3.exe.blockmap',
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['latest.yml']);
});

test('rejects a missing blockmap', () => {
  const result = verifyReleaseAssets({
    version: '1.2.3',
    assets: ['Pi-Desktop-Setup-1.2.3.exe', 'latest.yml'],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['Pi-Desktop-Setup-1.2.3.exe.blockmap']);
});

test('rejects an additional installer from another version', () => {
  const result = verifyReleaseAssets({
    version: '1.2.3',
    assets: [
      'Pi-Desktop-Setup-1.2.3.exe',
      'Pi-Desktop-Setup-1.2.3.exe.blockmap',
      'latest.yml',
      'Pi-Desktop-Setup-1.2.2.exe',
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, ['Pi-Desktop-Setup-1.2.2.exe']);
});

test('rejects duplicate expected assets', () => {
  const result = verifyReleaseAssets({
    version: '1.2.3',
    assets: [
      'Pi-Desktop-Setup-1.2.3.exe',
      'Pi-Desktop-Setup-1.2.3.exe',
      'Pi-Desktop-Setup-1.2.3.exe.blockmap',
      'latest.yml',
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, ['Pi-Desktop-Setup-1.2.3.exe']);
});

test('rejects a non-exact desktop version', () => {
  assert.throws(
    () => verifyReleaseAssets({ version: 'v1.2.3', assets: [] }),
    /version.*exact X\.Y\.Z/i,
  );
});

test('CLI prints one JSON object and exits 1 unless the asset set is exact', () => {
  const script = path.join(__dirname, '..', 'scripts', 'verify-release-assets.js');
  const exact = spawnSync(process.execPath, [
    script,
    '--version', '1.2.3',
    '--asset', 'Pi-Desktop-Setup-1.2.3.exe',
    '--asset', 'Pi-Desktop-Setup-1.2.3.exe.blockmap',
    '--asset', 'latest.yml',
  ], { encoding: 'utf8' });
  const incomplete = spawnSync(process.execPath, [
    script,
    '--version', '1.2.3',
    '--asset', 'Pi-Desktop-Setup-1.2.3.exe',
    '--asset', 'Pi-Desktop-Setup-1.2.3.exe.blockmap',
  ], { encoding: 'utf8' });

  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(exact.stdout.trim().split(/\r?\n/).length, 1);
  assert.deepEqual(JSON.parse(exact.stdout), { ok: true, missing: [] });
  assert.equal(incomplete.status, 1, incomplete.stderr);
  assert.equal(incomplete.stdout.trim().split(/\r?\n/).length, 1);
  assert.deepEqual(JSON.parse(incomplete.stdout), {
    ok: false,
    missing: ['latest.yml'],
    unexpected: [],
  });
});
