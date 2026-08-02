const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');

const PI_WEB = '@agegr/pi-web';
const PI = '@earendil-works/pi-coding-agent';
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requireVersion(label, version) {
  if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
    throw new Error(`${label} version must be an exact X.Y.Z version`);
  }
  return version;
}

function readPackage(packagePath) {
  let source;
  try {
    source = fs.readFileSync(packagePath, 'utf8');
  } catch (error) {
    throw new Error(`package.json cannot be read: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`package.json contains invalid JSON: ${error.message}`, { cause: error });
  }
}

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.');
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

function renameWithRetry(source, destination, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try { fs.renameSync(source, destination); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function writePackage(packagePath, pkg) {
  const tempPath = path.join(
    path.dirname(packagePath),
    `.${path.basename(packagePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    renameWithRetry(tempPath, packagePath);
  } catch (error) {
    let cleanupDetail = '';
    try {
      fs.rmSync(tempPath, { force: true });
    } catch (cleanupError) {
      cleanupDetail = `; temp cleanup also failed: ${cleanupError.message}`;
    }
    throw new Error(
      `package.json cannot be written atomically: ${error.message}${cleanupDetail}`,
      { cause: error },
    );
  }
}

function prepareUpdate({ packagePath, piWebVersion, piVersion, force = false, write = false }) {
  if (typeof packagePath !== 'string' || packagePath.length === 0) {
    throw new Error('packagePath is required');
  }
  requireVersion('pi-web', piWebVersion);
  requireVersion('Pi', piVersion);

  const pkg = readPackage(packagePath);
  const desktopVersion = requireVersion('Desktop', pkg.version);
  const old = {
    piWebVersion: requireVersion('current pi-web', pkg.dependencies?.[PI_WEB]),
    piVersion: requireVersion('current Pi', pkg.dependencies?.[PI]),
  };
  const next = { piWebVersion, piVersion };
  const changed = old.piWebVersion !== piWebVersion || old.piVersion !== piVersion;
  const action = changed ? 'update' : force ? 'rebuild' : 'none';
  const nextDesktopVersion = changed ? bumpPatch(desktopVersion) : desktopVersion;

  if (changed && write) {
    pkg.version = nextDesktopVersion;
    pkg.dependencies[PI_WEB] = piWebVersion;
    pkg.dependencies[PI] = piVersion;
    writePackage(packagePath, pkg);
  }

  return { action, old, new: next, desktopVersion: nextDesktopVersion };
}

module.exports = { prepareUpdate };

if (require.main === module) {
  try {
    const { values } = parseArgs({
      options: {
        package: { type: 'string', default: path.join(__dirname, '..', 'package.json') },
        'pi-web': { type: 'string' },
        pi: { type: 'string' },
        force: { type: 'boolean', default: false },
        write: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    const result = prepareUpdate({
      packagePath: values.package,
      piWebVersion: values['pi-web'],
      piVersion: values.pi,
      force: values.force,
      write: values.write,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(`[prepare-update] ${error.message}`);
    process.exitCode = 1;
  }
}
