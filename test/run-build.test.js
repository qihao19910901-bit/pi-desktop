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

// ============ 前置环境检查（preflight diagnostics） ============

function fakeFs(files) {
  return {
    readFileSync(filePath, encoding) {
      if (Object.hasOwn(files, filePath)) return files[filePath];
      throw new Error(`ENOENT: ${filePath}`);
    },
    lstatSync(filePath) {
      const entry = files[filePath];
      if (entry && typeof entry === 'object' && entry.isSymbolicLink) {
        return { isSymbolicLink: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    },
    mkdirSync() {},
  };
}

test('preflight passes cleanly on a normal local environment', () => {
  const { runPreflightChecks } = loadRunBuild().runBuild;
  const projectRoot = 'C:\repo';
  const fsApi = fakeFs({
    [path.join(projectRoot, 'package.json')]: JSON.stringify({ devDependencies: { electron: '43.2.0' } }),
    [path.join(projectRoot, 'node_modules', 'electron', 'package.json')]: JSON.stringify({ version: '43.2.0' }),
  });
  const issues = runPreflightChecks({}, projectRoot, fsApi);
  assert.deepEqual(issues, []);
});

test('preflight warns about ELECTRON_RUN_AS_NODE', () => {
  const { runPreflightChecks } = loadRunBuild().runBuild;
  const projectRoot = 'C:\repo';
  const fsApi = fakeFs({
    [path.join(projectRoot, 'package.json')]: JSON.stringify({ devDependencies: { electron: '43.2.0' } }),
    [path.join(projectRoot, 'node_modules', 'electron', 'package.json')]: JSON.stringify({ version: '43.2.0' }),
  });
  const issues = runPreflightChecks({ ELECTRON_RUN_AS_NODE: '1' }, projectRoot, fsApi);
  assert.equal(issues.some((i) => i.id === 'ELECTRON_RUN_AS_NODE' && i.severity === 'warn'), true);
});

test('preflight detects electron version drift', () => {
  const { runPreflightChecks } = loadRunBuild().runBuild;
  const projectRoot = 'C:\repo';
  const fsApi = fakeFs({
    [path.join(projectRoot, 'package.json')]: JSON.stringify({ devDependencies: { electron: '43.2.0' } }),
    [path.join(projectRoot, 'node_modules', 'electron', 'package.json')]: JSON.stringify({ version: '33.4.11' }),
  });
  const issues = runPreflightChecks({}, projectRoot, fsApi);
  const drift = issues.find((i) => i.id === 'ELECTRON_VERSION_DRIFT');
  assert.ok(drift, 'expected version drift issue');
  assert.match(drift.message, /33\.4\.11/);
  assert.match(drift.fix, /npmmirror/);
});

test('preflight errors when electron is missing', () => {
  const { runPreflightChecks } = loadRunBuild().runBuild;
  const projectRoot = 'C:\repo';
  const fsApi = fakeFs({
    [path.join(projectRoot, 'package.json')]: JSON.stringify({ devDependencies: { electron: '43.2.0' } }),
  });
  const issues = runPreflightChecks({}, projectRoot, fsApi);
  const missing = issues.find((i) => i.id === 'ELECTRON_NOT_INSTALLED');
  assert.ok(missing);
  assert.equal(missing.severity, 'error');
  assert.match(missing.fix, /npm ci --include=dev/);
});

test('preflight warns about junction node_modules', () => {
  const { runPreflightChecks } = loadRunBuild().runBuild;
  const projectRoot = 'C:\repo';
  const nmPath = path.join(projectRoot, 'node_modules');
  const fsApi = fakeFs({
    [path.join(projectRoot, 'package.json')]: JSON.stringify({ devDependencies: { electron: '43.2.0' } }),
    [path.join(projectRoot, 'node_modules', 'electron', 'package.json')]: JSON.stringify({ version: '43.2.0' }),
    [nmPath]: { isSymbolicLink: true },
  });
  const issues = runPreflightChecks({}, projectRoot, fsApi);
  const junction = issues.find((i) => i.id === 'NODE_MODULES_JUNCTION');
  assert.ok(junction);
  assert.equal(junction.severity, 'warn');
  assert.match(junction.message, /junction/);
});

test('preflight skips checks in CI', () => {
  const { runPreflightChecks } = loadRunBuild().runBuild;
  const issues = runPreflightChecks({ CI: 'true', ELECTRON_RUN_AS_NODE: '1' }, 'C:\repo', fakeFs({}));
  assert.deepEqual(issues, []);
});

test('formatDiagnostics renders copyable fixes', () => {
  const { formatDiagnostics } = loadRunBuild().runBuild;
  const text = formatDiagnostics([{ id: 'X', severity: 'warn', message: '问题描述', fix: 'unset ELECTRON_RUN_AS_NODE' }]);
  assert.match(text, /环境检查发现 1 个问题/);
  assert.match(text, /问题描述/);
  assert.match(text, /→ 修复: unset ELECTRON_RUN_AS_NODE/);
  assert.equal(formatDiagnostics([]), '');
});
