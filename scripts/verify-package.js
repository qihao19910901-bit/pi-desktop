const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const SHELL_PATHS = [
  '/electron/main.js',
  '/electron/preload.js',
  '/electron/tray.js',
  '/electron/updater.js',
  '/electron/piweb-runtime.js',
  '/electron/piweb-service.js',
  '/electron/safe-html.js',
  '/electron/plugins-preload.js',
  '/electron/plugins-window.js',
  '/electron/plugins.html',
  '/electron/templates-preload.js',
  '/electron/templates-window.js',
  '/electron/templates.html',
  '/package.json',
];
const UNPACKED_PATHS = [
  'node_modules/@agegr/pi-web/bin/pi-web.js',
  'node_modules/@agegr/pi-web/package.json',
  'node_modules/@earendil-works/pi-coding-agent/package.json',
];
const COMPACT_MARKERS = ['chat.commandCompact', 'chat.compactContext'];
const COMPACT_NOTICE_MARKERS = [
  'Nothing to compact (session too small)',
  '当前会话内容较少，暂时无需压缩',
];
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function readJsonFile(file, label) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${error.message}`, { cause: error });
  }
}

function requirePath(file, label, directory = false) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} is missing`);
    throw new Error(`${label} cannot be accessed: ${error.message}`, { cause: error });
  }
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`${label} is not a ${directory ? 'directory' : 'file'}`);
  }
}

function pathExists(file, label) {
  try {
    fs.statSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error(`${label} cannot be accessed: ${error.message}`, { cause: error });
  }
}

function requireUnlinkedFile(root, relative) {
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const label = parts.slice(0, index + 1).join('/');
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`${label} is missing`);
      throw new Error(`${label} cannot be accessed: ${error.message}`, { cause: error });
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} is a symbolic link or junction`);
    const final = index === parts.length - 1;
    if (final ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(`${label} is not a ${final ? 'regular file' : 'directory'}`);
    }
  }
}

function readExpectedVersions() {
  const pkg = readJsonFile(path.join(ROOT, 'package.json'), 'root package.json');
  const expected = {
    desktop: pkg.version,
    piWeb: pkg.dependencies?.['@agegr/pi-web'],
    pi: pkg.dependencies?.['@earendil-works/pi-coding-agent'],
  };
  for (const [name, version] of Object.entries(expected)) {
    if (!EXACT_VERSION.test(version || '')) throw new Error(`expected ${name} version is not exact`);
  }
  return expected;
}

function readAsarPackage(archive) {
  // 防御：asar 偶发读到 header 填充区（NUL 字节）时重试一次
  const extract = () => asar.extractFile(archive, 'package.json').toString('utf8');
  let source;
  try {
    source = extract();
    if (/^\0/.test(source)) source = extract();
  } catch (error) {
    throw new Error(`app.asar package.json cannot be read: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`app.asar package.json contains invalid JSON: ${error.message}`, { cause: error });
  }
}

function checkVersion(label, actual, expected) {
  if (!EXACT_VERSION.test(actual || '')) throw new Error(`${label} version is invalid`);
  if (!EXACT_VERSION.test(expected || '')) throw new Error(`expected ${label} version is invalid`);
  if (actual !== expected) throw new Error(`${label} version ${actual} does not match ${expected}`);
}

function requireCompactCapability(unpacked) {
  const directory = path.join(unpacked, 'node_modules', '@agegr', 'pi-web', '.next', 'static', 'chunks', 'app');
  let bundles;
  try {
    bundles = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^page-.*\.js$/.test(entry.name))
      .map((entry) => fs.readFileSync(path.join(directory, entry.name), 'utf8'));
  } catch (error) {
    throw new Error(`pi-web app bundle cannot be read: ${error.message}`, { cause: error });
  }
  const missing = COMPACT_MARKERS.filter((marker) => !bundles.some((source) => source.includes(marker)));
  if (missing.length) throw new Error(`Compact capability markers are missing: ${missing.join(', ')}`);
}

function requireCompactNoticeCapability(archive) {
  let source;
  try {
    source = asar.extractFile(archive, 'electron/preload.js').toString('utf8');
  } catch (error) {
    throw new Error(`desktop preload cannot be read: ${error.message}`, { cause: error });
  }
  const missing = COMPACT_NOTICE_MARKERS.filter((marker) => !source.includes(marker));
  if (missing.length) throw new Error(`Compact notice markers are missing: ${missing.join(', ')}`);
}

function verifyResources(resourcesDir, expected = readExpectedVersions()) {
  const archive = path.join(resourcesDir, 'app.asar');
  const looseModules = path.join(resourcesDir, 'node_modules');
  const unpacked = path.join(resourcesDir, 'app.asar.unpacked');
  requirePath(archive, 'app.asar');
  if (pathExists(looseModules, 'resources/node_modules')) {
    throw new Error('resources/node_modules is a duplicate dependency tree');
  }
  for (const required of SHELL_PATHS) {
    let stat;
    try {
      stat = asar.statFile(archive, required.slice(1), false);
    } catch (error) {
      throw new Error(`app.asar path ${required} is missing or invalid: ${error.message}`, { cause: error });
    }
    if (Object.hasOwn(stat, 'files') || Object.hasOwn(stat, 'link') || !Object.hasOwn(stat, 'size')) {
      throw new Error(`app.asar path ${required} is not a regular file`);
    }
  }
  requireCompactNoticeCapability(archive);
  for (const required of UNPACKED_PATHS) {
    requireUnlinkedFile(resourcesDir, `app.asar.unpacked/${required}`);
  }
  requireCompactCapability(unpacked);

  const desktop = readAsarPackage(archive).version;
  const piWeb = readJsonFile(path.join(unpacked, UNPACKED_PATHS[1]), 'pi-web package.json').version;
  const pi = readJsonFile(path.join(unpacked, UNPACKED_PATHS[2]), 'Pi package.json').version;
  checkVersion('Desktop', desktop, expected.desktop);
  checkVersion('pi-web', piWeb, expected.piWeb);
  checkVersion('Pi', pi, expected.pi);
  return { desktop, piWeb, pi, dependencyTree: 'app.asar.unpacked/node_modules' };
}

module.exports = { verifyResources };

if (require.main === module) {
  try {
    const resources = process.argv[2] || path.join(ROOT, 'dist', 'win-unpacked', 'resources');
    console.log(JSON.stringify(verifyResources(resources)));
  } catch (error) {
    console.error(`[verify:package] ${error.message}`);
    process.exitCode = 1;
  }
}
