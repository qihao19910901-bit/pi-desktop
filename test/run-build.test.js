const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');

const MODULE_PATH = require.resolve('../electron/run-build');
const ENV_KEYS = ['ELECTRON_CACHE', 'ELECTRON_BUILDER_CACHE', 'TMP', 'TEMP'];

function loadRunBuild() {
  const originalSpawn = childProcess.spawn;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let spawnCount = 0;

  childProcess.spawn = () => {
    spawnCount += 1;
    return new EventEmitter();
  };
  delete require.cache[MODULE_PATH];

  try {
    return { runBuild: require(MODULE_PATH), spawnCount };
  } finally {
    childProcess.spawn = originalSpawn;
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

test('local builds leave the Electron Builder cache on its stable caller default', () => {
  const { runBuild, spawnCount } = loadRunBuild();
  const mkdirCalls = [];
  const env = { ELECTRON_BUILDER_CACHE: 'D:\\builder-cache' };
  const projectRoot = 'C:\\repo';

  assert.equal(spawnCount, 0, 'importing run-build must not start a build');
  assert.equal(typeof runBuild.configureLocalBuildEnvironment, 'function');

  runBuild.configureLocalBuildEnvironment(
    env,
    { mkdirSync: (directory) => mkdirCalls.push(directory) },
    projectRoot,
  );

  assert.equal(env.ELECTRON_BUILDER_CACHE, 'D:\\builder-cache');
  assert.equal(env.ELECTRON_CACHE, path.join(projectRoot, '.cache', 'electron'));
  assert.equal(env.TMP, path.join(projectRoot, '.cache', 'tmp'));
  assert.equal(env.TEMP, path.join(projectRoot, '.cache', 'tmp'));
  assert.deepEqual(mkdirCalls, [
    path.join(projectRoot, '.cache', 'electron'),
    path.join(projectRoot, '.cache', 'tmp'),
  ]);

  const defaultEnv = {};
  runBuild.configureLocalBuildEnvironment(defaultEnv, { mkdirSync() {} }, projectRoot);
  assert.equal(Object.hasOwn(defaultEnv, 'ELECTRON_BUILDER_CACHE'), false);
});

test('CI leaves cache environment and directories unchanged', () => {
  const { runBuild } = loadRunBuild();
  const mkdirCalls = [];
  const env = { CI: 'true' };

  runBuild.configureLocalBuildEnvironment(
    env,
    { mkdirSync: (directory) => mkdirCalls.push(directory) },
    'C:\\repo',
  );

  assert.deepEqual(env, { CI: 'true' });
  assert.deepEqual(mkdirCalls, []);
});
