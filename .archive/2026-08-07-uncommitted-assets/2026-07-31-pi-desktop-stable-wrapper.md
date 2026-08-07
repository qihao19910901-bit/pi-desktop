# Pi Desktop Stable Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Windows Pi Desktop that follows stable Pi/pi-web releases only after compatibility gates pass, then updates installed clients through GitHub Releases.

**Architecture:** Keep Pi and pi-web upstream-owned. Electron starts pi-web with its bundled Node runtime on loopback, preserves `~/.pi`, packages production dependencies once, and delegates client updates to electron-updater. A scheduled workflow creates a candidate dependency pair, tests the packaged app, then publishes a complete Release or publishes nothing.

**Tech Stack:** CommonJS, Electron 43.2.0, Node 24, `node:test`, electron-builder 26.15.3, electron-updater 6.8.9, GitHub Actions on Windows.

---

## Execution prerequisites

- Implement in an isolated worktree created with `superpowers:using-git-worktrees`. The current main worktree contains user-owned `.gitignore`, `_push*.js`, root `preload.js`, and planning changes that must not be staged.
- Fetch origin inside the isolated worktree and inspect divergence before editing. Rebase the feature branch onto the current `origin/main` without force-pushing; the remote has automated version commits newer than the local tracking ref.
- Re-read `docs/superpowers/specs/2026-07-31-pi-desktop-stable-wrapper-design.md` before Task 1.
- Preserve `F:\软件\我的秘籍\PI\Pi Desktop` and `C:\Users\Administrator\.pi`. Do not edit the installed app or user data during Tasks 1-9.
- Keep every commit at 8 files or fewer and 300 manually changed lines or fewer. Lockfiles, generated installer metadata, SVG, PNG, and Excalidraw output are generated-file exceptions.
- After every task, append the test result and AI self-review result to `.planning/2026-07-31-pi-desktop-audit-design/progress.md` in the main worktree.

## File map

| File | Responsibility |
| --- | --- |
| `electron/main.js` | Electron lifecycle, windows, menus, safe IPC, orchestration only |
| `electron/piweb-runtime.js` | Pure resolution of port, entry path, process command, environment, and component versions |
| `electron/piweb-service.js` | pi-web child lifecycle, health checks, stderr diagnostics, one restart, owned-process cleanup |
| `electron/safe-html.js` | Escape untrusted error text before rendering a local error page |
| `electron/preload.js` | Minimal external-link interception; no translation or filesystem access |
| `electron/updater.js` | Testable electron-updater controller and user prompts |
| `scripts/verify-package.js` | Assert app.asar/unpacked resources, versions, and non-duplication |
| `scripts/smoke-packaged-app.js` | Launch the packaged EXE, check HTTP/CDP UI, then prove child cleanup |
| `scripts/prepare-update.js` | Compute an idempotent stable Pi/pi-web candidate and desktop patch version |
| `.github/workflows/auto-update.yml` | Detect, test, build, tag, draft, verify, and publish a release |
| `test/*.test.js` | FIRST tests for each pure contract and failure path |

## Spec coverage

| Approved design requirement | Implemented by |
| --- | --- |
| Bundled Node, no `I:\NODE`, loopback only | Tasks 1-4 |
| Preserve `~/.pi` and keep old installation | Tasks 4, 7, 10 |
| One production dependency tree and complete app.asar | Task 6 |
| Dynamic, consistent component versions | Tasks 4, 6, 9 |
| Pi/pi-web stable detection and idempotent patching | Task 8 |
| Build and compatibility gates before publication | Tasks 6, 7, 9 |
| Complete, repairable GitHub Release | Task 9 |
| electron-updater prompt and failure isolation | Tasks 5, 10 |
| Real packaged-app and update smoke tests | Tasks 7, 10 |
| Controlled shortcut switch and rollback | Task 10 |

### Task 1: Pin the supported dependency baseline and add the test runner

**Files:**
- Create: `test/package-contract.test.js`
- Modify: `package.json`
- Modify (generated): `package-lock.json`

- [ ] **Step 1: Write the failing package contract test**

```js
// test/package-contract.test.js
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
```

- [ ] **Step 2: Run the test and confirm the baseline is currently rejected**

Run: `node --test test/package-contract.test.js`  
Expected: FAIL because versions use `^`, Electron is 33, and scripts are absent.

- [ ] **Step 3: Apply the exact package contract**

Set these exact fields in `package.json`:

```json
{
  "scripts": {
    "dev": "node electron/dev.js",
    "test": "node --test",
    "build:dir": "node electron/run-build.js --dir",
    "build": "node electron/run-build.js",
    "verify:package": "node scripts/verify-package.js",
    "smoke:package": "node scripts/smoke-packaged-app.js"
  },
  "dependencies": {
    "@agegr/pi-web": "0.8.5",
    "@earendil-works/pi-coding-agent": "0.83.0",
    "electron-updater": "6.8.9"
  },
  "devDependencies": {
    "@electron/asar": "3.4.1",
    "electron": "43.2.0",
    "electron-builder": "26.15.3",
    "yaml": "2.9.0"
  },
  "engines": {
    "node": ">=24"
  }
}
```

Remove unused `cross-env`. Keep the existing Pi override so pi-web and the root resolve one Pi version.

- [ ] **Step 4: Regenerate and verify the lockfile from a clean install**

Run: `npm install --package-lock-only --ignore-scripts`  
Expected: exit 0 and exact root dependency versions in `package-lock.json`.

Run: `npm ci`  
Expected: exit 0; `npm ls @agegr/pi-web @earendil-works/pi-coding-agent electron` reports no invalid dependencies.

Run: `npm test`  
Expected: 2 tests PASS.

- [ ] **Step 5: Review and commit**

Run: `git diff --check`  
Run: `git diff --stat`  
Confirm the AI self-review checklist is 6/6 and no unrelated file is staged.

```powershell
git add package.json package-lock.json test/package-contract.test.js
git commit -m "build: pin Pi Desktop runtime versions"
```

### Task 2: Define the self-contained pi-web launch contract

**Files:**
- Create: `electron/piweb-runtime.js`
- Create: `test/piweb-runtime.test.js`

- [ ] **Step 1: Write failing tests for packaged and development launch specs**

```js
// test/piweb-runtime.test.js
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
```

- [ ] **Step 2: Run the tests and see the missing module failure**

Run: `node --test test/piweb-runtime.test.js`  
Expected: FAIL with `Cannot find module '../electron/piweb-runtime'`.

- [ ] **Step 3: Implement the pure launch contract**

```js
// electron/piweb-runtime.js
const path = require('node:path');

const DEFAULT_PORT = 30141;

function parsePort(value = String(DEFAULT_PORT)) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || String(port) !== String(value).trim() || port < 1 || port > 65535) {
    throw new Error(`invalid PI_WEB_PORT: ${value}`);
  }
  return port;
}

function buildPiWebLaunchSpec(options) {
  const {
    isPackaged, resourcesPath, developmentEntry, execPath,
    userDataDir, port = DEFAULT_PORT, env = process.env,
  } = options;
  const entry = isPackaged
    ? path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@agegr', 'pi-web', 'bin', 'pi-web.js')
    : developmentEntry;
  const childEnv = { ...env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NODE_OPTIONS_PATH;
  childEnv.ELECTRON_RUN_AS_NODE = '1';
  childEnv.PI_WEB_NO_OPEN = '1';
  childEnv.NEXT_TELEMETRY_DISABLED = '1';
  return {
    command: execPath,
    entry,
    cwd: userDataDir,
    args: [entry, '--hostname', '127.0.0.1', '--port', String(parsePort(String(port))), '--no-open'],
    env: childEnv,
  };
}

module.exports = { DEFAULT_PORT, parsePort, buildPiWebLaunchSpec };
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/piweb-runtime.test.js`  
Expected: 3 PASS.

Run: `npm test`  
Expected: all tests PASS.

- [ ] **Step 5: Review and commit**

```powershell
git add electron/piweb-runtime.js test/piweb-runtime.test.js
git commit -m "feat: define bundled pi-web runtime"
```

### Task 3: Add health checks and owned child-process lifecycle

**Files:**
- Create: `electron/piweb-service.js`
- Create: `test/piweb-service.test.js`

- [ ] **Step 1: Write failing tests for readiness, diagnostics, restart, and stop**

Use `node:http` with `server.listen(0, '127.0.0.1')` for the readiness test. The test must assert that a 503 response and a 200 response without `Pi Agent Web` are rejected, then a 200 response containing the signal resolves. Use a fake `EventEmitter` child to assert:

```js
test('service restarts an unexpected exit once', async () => {
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = 100 + children.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    children.push(child);
    return child;
  };
  const service = createPiWebService({
    spawnImpl,
    waitForReady: async () => {},
    stopTree: () => {},
    restartDelayMs: 0,
    logger: { log() {}, error() {}, warn() {} },
  });
  await service.start(LAUNCH_SPEC);
  children[0].emit('exit', 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2);
  children[1].emit('exit', 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 2);
});
```

Also assert `stop()` sends the owned PID to `stopTree`, and a missing entry fails before spawn.

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test test/piweb-service.test.js`  
Expected: FAIL because `electron/piweb-service.js` is missing.

- [ ] **Step 3: Implement `probePiWeb`, `waitForPiWeb`, and `createPiWebService`**

The module must export these exact APIs:

```js
async function probePiWeb(url, { requestTimeoutMs = 2000, contentSignal = 'Pi Agent Web' } = {})
async function waitForPiWeb(url, { timeoutMs = 60000, intervalMs = 500, probe = probePiWeb } = {})
function createPiWebService({ spawnImpl, waitForReady, stopTree, restartDelayMs = 1000, logger = console })
```

Implementation requirements:

- `probePiWeb` reads at most 256 KiB, requires status 200-299 and `contentSignal`, and destroys timed-out requests.
- `waitForPiWeb` keeps the last error and includes it in the final timeout error.
- `start(spec)` checks `fs.existsSync(spec.entry)` before spawn, records the last 20 stderr lines, and resolves only after readiness.
- An unexpected child exit schedules one restart using the same spec. A second exit records an error and stops retrying.
- `stop()` marks the service as intentional shutdown and invokes `stopTree` only for the current owned PID.
- Expose `getDiagnostics()` with `{ pid, restartCount, stderr }`; do not expose the child object.

- [ ] **Step 4: Run focused tests and the full suite**

Run: `node --test test/piweb-service.test.js`  
Expected: readiness, timeout, one-restart, missing-entry, and owned-stop tests PASS.

Run: `npm test`  
Expected: all tests PASS.

- [ ] **Step 5: Run the core-logic cross-review and commit**

From `F:\软件\我的秘籍`, run: `node docs/workflow/review-diff.js`  
Expected: GLM-5.2 review returns no unresolved high-severity finding.

```powershell
git add electron/piweb-service.js test/piweb-service.test.js
git commit -m "feat: manage pi-web lifecycle safely"
```

### Task 4: Integrate the safe runtime into Electron and remove DOM translation

**Files:**
- Create: `electron/safe-html.js`
- Create: `test/safe-html.test.js`
- Modify: `electron/main.js`
- Replace: `electron/preload.js`
- Delete: `electron/piweb-polyfill.js`

- [ ] **Step 1: Write the failing HTML escaping test**

```js
// test/safe-html.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../electron/safe-html');

test('error text cannot inject markup', () => {
  assert.equal(
    escapeHtml('<img src=x onerror=alert(1)> & "bad"'),
    '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;bad&quot;',
  );
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test test/safe-html.test.js`  
Expected: FAIL with `Cannot find module '../electron/safe-html'`.

- [ ] **Step 3: Implement escaping and replace preload with the minimum bridge**

```js
// electron/safe-html.js
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
module.exports = { escapeHtml };
```

```js
// electron/preload.js
const { ipcRenderer } = require('electron');

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const url = new URL(link.href, location.href);
  if (url.origin === location.origin || !['http:', 'https:'].includes(url.protocol)) return;
  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('open-external', url.href);
}, true);
```

- [ ] **Step 4: Refactor `electron/main.js` to orchestrate the new service**

Make these concrete changes:

- Replace `spawn`, `execSync`, and `http` ownership with imports from `piweb-runtime` and `piweb-service`.
- Use `http://127.0.0.1:${PORT}` everywhere.
- Resolve the development pi-web entry with `require.resolve('@agegr/pi-web/bin/pi-web.js')` and pass it to `buildPiWebLaunchSpec`.
- Use `process.execPath` in both modes; remove every reference to `I:\NODE` and `piweb-polyfill.js`.
- Await `service.start(spec)` before loading Pi Web into windows.
- Set `sandbox: true`, keep `contextIsolation: true`, and keep `nodeIntegration: false`.
- Escape error text through `escapeHtml` before inserting it into `showErrorPage`.
- Replace the hardcoded About version with `app.getVersion()` and versions read from the actual packaged pi-web/Pi package.json files.
- Validate external URLs with `new URL`; call `shell.openExternal(url).catch(...)`.
- On `before-quit`, call `service.stop()` and destroy the tray.

Delete the old in-file `startPiWeb`, `killPiWeb`, and `waitForPiWeb` implementations after all callers use the service.

- [ ] **Step 5: Run static and behavioral checks**

Run: `npm test`  
Expected: all tests PASS.

Run: `node --check electron/main.js`  
Run: `node --check electron/preload.js`  
Run: `node --check electron/piweb-service.js`  
Expected: all exit 0.

Run: `git grep -n -E 'I:\\NODE|0\.0\.0\.0|piweb-polyfill|ZH_MAP|MutationObserver' -- electron package.json`  
Expected: no matches.

- [ ] **Step 6: Cross-review and commit**

Run `node docs/workflow/review-diff.js` from the workspace root. Fix every high-severity finding before commit.

```powershell
git add electron/main.js electron/preload.js electron/safe-html.js test/safe-html.test.js
git rm electron/piweb-polyfill.js
git commit -m "refactor: run Pi Web through bundled Electron"
```

### Task 5: Make auto-update behavior testable and non-blocking

**Files:**
- Modify: `electron/updater.js`
- Create: `test/updater.test.js`

- [ ] **Step 1: Write failing tests around an injected updater controller**

The tests must use an `EventEmitter` fake and verify:

```js
test('downloaded update installs only after explicit restart choice', async () => {
  const autoUpdater = new EventEmitter();
  autoUpdater.quitAndInstall = mock.fn();
  const dialog = { showMessageBox: mock.fn(async () => ({ response: 1 })) };
  const controller = createUpdaterController({
    isPackaged: true,
    autoUpdater,
    dialog,
    logger: silentLogger,
    schedule: (fn) => fn(),
  });
  controller.init();
  autoUpdater.emit('update-downloaded', { version: '2.0.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(autoUpdater.quitAndInstall.mock.callCount(), 0);
});
```

Add tests for development mode skip, delayed automatic check rejection, manual check rejection, and response 0 calling `quitAndInstall()`.

- [ ] **Step 2: Run the focused test and verify API mismatch**

Run: `node --test test/updater.test.js`  
Expected: FAIL because `createUpdaterController` is not exported.

- [ ] **Step 3: Implement the controller without changing user-visible behavior**

Export:

```js
function createUpdaterController({ isPackaged, autoUpdater, dialog, logger = console, schedule = setTimeout })
```

The returned object has `init()` and `checkManual()`. `init()` registers listeners once, schedules `checkForUpdatesAndNotify` after 8000 ms, and catches every promise. Keep auto-download, install-on-quit, no downgrade, and the existing “立即重启/稍后” choice. The top-level `initUpdater` and `checkForUpdatesManual` call a singleton controller so `main.js` keeps a small API.

Run new Chinese strings through humanizer-zh before committing.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/updater.test.js`  
Run: `npm test`  
Expected: all PASS.

```powershell
git add electron/updater.js test/updater.test.js
git commit -m "test: harden desktop auto-updates"
```

### Task 6: Package production dependencies once and verify the artifact

**Files:**
- Modify: `electron-builder.yml`
- Create: `scripts/verify-package.js`
- Create: `test/verify-package.test.js`

- [ ] **Step 1: Write failing tests for an artifact manifest verifier**

Create a temp fake `resources` tree and assert `verifyResources(resourcesDir)`:

- fails when `app.asar`, updater, main, or packaged pi-web entry is absent;
- fails when both `resources/node_modules` and `app.asar.unpacked/node_modules` exist;
- fails when app, pi-web, and Pi versions differ from expected inputs;
- passes with one unpacked dependency tree and all required shell files.

- [ ] **Step 2: Run the focused test and see the missing verifier**

Run: `node --test test/verify-package.test.js`  
Expected: FAIL because `scripts/verify-package.js` is missing.

- [ ] **Step 3: Replace the manual extraResources filter with standard asar unpacking**

Use this structure in `electron-builder.yml`:

```yaml
asar: true
files:
  - electron/**/*.js
  - assets/icon.png
  - package.json
asarUnpack:
  - node_modules/**
```

Remove the current `extraResources` block and comments claiming pi-web is copied separately. Keep NSIS, icon, output directory, GitHub publish metadata, maximum compression, and `npmRebuild: false`.

- [ ] **Step 4: Implement `verifyResources` and its CLI**

Use `@electron/asar` to list `app.asar`. Require these shell paths:

```js
const REQUIRED_ASAR = [
  '/electron/main.js',
  '/electron/preload.js',
  '/electron/tray.js',
  '/electron/updater.js',
  '/electron/piweb-runtime.js',
  '/electron/piweb-service.js',
  '/electron/safe-html.js',
  '/package.json',
];
```

Require these unpacked paths:

```js
const REQUIRED_UNPACKED = [
  'node_modules/@agegr/pi-web/bin/pi-web.js',
  'node_modules/@agegr/pi-web/package.json',
  'node_modules/@earendil-works/pi-coding-agent/package.json',
];
```

The CLI defaults to `dist/win-unpacked/resources`, reads the expected versions from root package.json, prints a compact JSON summary, and exits 1 on any mismatch.

- [ ] **Step 5: Build the unpacked app and verify it**

Run: `npm test`  
Expected: all tests PASS.

Run: `npm run build:dir`  
Expected: `dist/win-unpacked/Pi Desktop.exe` exists.

Run: `npm run verify:package`  
Expected: exit 0; output reports one dependency tree and matching app/pi-web/Pi versions.

- [ ] **Step 6: Commit**

```powershell
git add electron-builder.yml scripts/verify-package.js test/verify-package.test.js
git commit -m "build: verify packaged runtime contents"
```

### Task 7: Add a packaged-application smoke test

**Files:**
- Create: `scripts/smoke-packaged-app.js`
- Create: `test/smoke-helpers.test.js`
- Modify: `electron/main.js`

- [ ] **Step 1: Write failing tests for polling and CDP evaluation helpers**

Export pure helpers from the smoke script behind `if (require.main === module)`. Test timeout, HTTP signal validation, CDP response matching by request id, and process cleanup.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/smoke-helpers.test.js`  
Expected: FAIL because the smoke module is missing.

- [ ] **Step 3: Implement the smoke runner**

The script must:

1. Find `dist/win-unpacked/Pi Desktop.exe`.
2. Create a unique temp userData directory.
3. Start the EXE with environment `PI_DESKTOP_SMOKE=1`, `PI_DESKTOP_USER_DATA=<temp>`, and `PI_WEB_PORT=30142`, plus `--remote-debugging-port=9333`.
4. Wait up to 60 seconds for `http://127.0.0.1:30142` to return 2xx with `Pi Agent Web`.
5. Fetch `http://127.0.0.1:9333/json`, connect to the Pi Web page using Node 24 global `WebSocket`, and evaluate `document.body.innerText`.
6. Require the text to contain `Models`, `Skills`, `Plugins`, and `Compact`.
7. Record the local HTTP response time and require <=2000 ms.
8. Stop the owned EXE, then prove port 30142 closes within 10 seconds.
9. Print one JSON result and exit 0. On failure, include stderr tail and exit 1.

`electron/main.js` may honor `PI_DESKTOP_USER_DATA` only when `PI_DESKTOP_SMOKE=1`, before `app.getPath('userData')` is read. Smoke mode skips updater initialization but still creates the real BrowserWindow and pi-web service.

- [ ] **Step 4: Run the packaged smoke test**

Run: `npm run build:dir`  
Run: `npm run verify:package`  
Run: `npm run smoke:package`  
Expected: all exit 0; no listener remains on 30142 or 9333.

- [ ] **Step 5: Commit**

```powershell
git add scripts/smoke-packaged-app.js test/smoke-helpers.test.js electron/main.js
git commit -m "test: smoke test packaged Pi Desktop"
```

### Task 8: Make upstream candidate generation exact and idempotent

**Files:**
- Create: `scripts/prepare-update.js`
- Create: `test/prepare-update.test.js`

- [ ] **Step 1: Write failing candidate tests**

Test these exact cases using a temp package.json:

- unchanged Pi/pi-web returns `{ action: 'none' }` and writes nothing;
- pi-web change updates only pi-web and bumps desktop patch once;
- Pi change updates only Pi and bumps desktop patch once;
- both change together still bump desktop patch once;
- `--force` with unchanged dependencies returns `{ action: 'rebuild' }` without bumping;
- rerunning the same candidate never bumps again;
- prerelease strings such as `0.84.0-beta.1` are rejected.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/prepare-update.test.js`  
Expected: FAIL because `scripts/prepare-update.js` is missing.

- [ ] **Step 3: Implement the candidate API and CLI**

Export:

```js
function prepareUpdate({ packagePath, piWebVersion, piVersion, force = false, write = false })
```

Use `node:util.parseArgs`. Accept CLI flags `--package`, `--pi-web`, `--pi`, `--force`, and `--write`. Only `X.Y.Z` versions are valid. On `--write`, write formatted JSON atomically through a sibling temp file and rename. Print exactly one JSON object with `action`, old/new component versions, and `desktopVersion`.

- [ ] **Step 4: Run tests, cross-review, and commit**

Run: `node --test test/prepare-update.test.js`  
Run: `npm test`  
Expected: all PASS.

From the workspace root run: `node docs/workflow/review-diff.js`.

```powershell
git add scripts/prepare-update.js test/prepare-update.test.js
git commit -m "feat: prepare stable upstream updates"
```

### Task 9: Replace the release workflow with a gated, repairable pipeline

**Files:**
- Modify: `.github/workflows/auto-update.yml`
- Create: `scripts/verify-release-assets.js`
- Create: `test/verify-release-assets.test.js`

- [ ] **Step 1: Write failing tests for Release asset completeness**

```js
test('requires installer, latest metadata, and blockmap for one version', () => {
  assert.deepEqual(
    verifyReleaseAssets({
      version: '1.2.3',
      assets: [
        'Pi-Desktop-Setup-1.2.3.exe',
        'Pi-Desktop-Setup-1.2.3.exe.blockmap',
        'latest.yml',
      ],
    }),
    { ok: true, missing: [] },
  );
});
```

Add failures for a wrong-version EXE, missing latest.yml, missing blockmap, and extra installers for another version.

- [ ] **Step 2: Implement the verifier and run tests**

Export `verifyReleaseAssets({ version, assets })`. The CLI accepts `--version` and repeated `--asset`, prints JSON, and exits 1 unless the set is exact.

Run: `node --test test/verify-release-assets.test.js`  
Expected: all PASS after implementation.

- [ ] **Step 3: Rewrite the workflow in this exact order**

Use `windows-latest`, Node 24, `permissions.contents: write`, a 45-minute timeout, concurrency group `pi-desktop-release`, and `cancel-in-progress: false`.

The steps are:

1. Checkout with full history (`fetch-depth: 0`).
2. `npm ci` and `npm test` on the current tree.
3. Read stable versions with `npm view <package> version`.
4. Run `prepare-update.js` without write and expose its JSON through a step id.
5. Exit cleanly when action is `none` and the matching Release is already complete.
6. For update actions, run `prepare-update.js --write`, then `npm install --package-lock-only --ignore-scripts`.
7. Run a second clean `npm ci`, `npm test`, `npm run build`, `npm run verify:package`, and `npm run smoke:package`.
8. Read the actual desktop/pi-web/Pi versions from package files and assert them against candidate output.
9. For a new candidate only, configure bot identity, commit package.json/package-lock.json, create `v<desktopVersion>`, and push main plus tag using `git push --atomic`.
10. Create or reuse a draft Release for the same tag. Upload `dist/*.exe`, `dist/*.blockmap`, and `dist/latest.yml` using `gh release upload --clobber`.
11. Read draft assets with `gh api`, run `verify-release-assets.js`, and keep the Release draft on failure.
12. Publish with `gh release edit <tag> --draft=false --latest` only after verification.
13. Write a summary containing the three component versions, test results, and Release URL.

If the current package version has a tag/draft but incomplete assets, treat it as `repair`: rebuild and upload the same version without another patch bump or commit.

Do not use `steps.check.outputs.desktop_ver`; every value must come from the step that actually sets it.

- [ ] **Step 4: Validate workflow syntax and local helper tests**

Run: `npm test`  
Expected: all PASS.

Run this fixed syntax check with the pinned `yaml@2.9.0` dependency:

```powershell
node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/auto-update.yml','utf8')); console.log('workflow yaml ok')"
```

Expected: `workflow yaml ok`. Always run GitHub's workflow by `workflow_dispatch` on the feature branch before merging.

Run from workspace root: `node docs/workflow/review-diff.js`  
Expected: no unresolved high-severity release or permission issue.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/auto-update.yml scripts/verify-release-assets.js test/verify-release-assets.test.js
git commit -m "ci: gate Pi Desktop releases"
```

### Task 10: Complete end-to-end verification and controlled local rollout

**Files:**
- No application file is planned for this task. If a quality gate fails, stop and add a focused repair task before editing code.
- Update: `.planning/2026-07-31-pi-desktop-audit-design/progress.md` in the main worktree
- Update after successful release: `基恩知识库/05-技术资料/Pi Desktop 差距分析报告.md`

- [ ] **Step 1: Run the full local quality gate**

Run in the isolated worktree:

```powershell
npm ci
npm test
npm run build
npm run verify:package
npm run smoke:package
git diff --check
```

Expected: all exit 0. Record exact test counts, installer size, app.asar size, startup time, HTTP status/content/response time, ports, and child cleanup.

- [ ] **Step 2: Run security and AI review gates**

Confirm:

- no secrets or fallback tokens;
- no `0.0.0.0`, hardcoded Node path, raw error HTML, empty catch, DOM translation, or unknown-process kill;
- BrowserWindow isolation settings are present;
- update source is fixed to `qihao19910901-bit/pi-desktop`;
- all external calls have timeout/error handling;
- AI self-review 6/6 is recorded.

From `F:\软件\我的秘籍`, run: `node docs/workflow/review-diff.js`.

- [ ] **Step 3: Trigger a draft Release and verify assets before publication**

Use `workflow_dispatch` on the implementation branch with force rebuild. Confirm the workflow builds but does not expose an incomplete Release. Inspect the draft and verify the EXE, blockmap, and latest.yml versions and hashes.

- [ ] **Step 4: Publish the first verified release and run update smoke**

Publish only after all gates pass. Start the retained old app, use its manual update check, and verify it discovers the new stable release. Do not install while an Agent turn is running. Choose “稍后”, close the app normally, then confirm the installer runs.

- [ ] **Step 5: Verify user data and real workflows**

Because both versions use 30141, run them one at a time:

1. Exit old Pi Desktop and confirm its Node/Next children are gone.
2. Start the new installation from its separate directory.
3. Confirm existing sessions, models, Plugins, and Skills load from `~/.pi`.
4. Complete one real Agent request in an existing project.
5. Test Models, Skills, Plugins, Branches, Compact, tray hide/show, window restart, and application exit.
6. Confirm only `127.0.0.1:30141` listens.

- [ ] **Step 6: Switch the desktop shortcut only after user approval**

Record the old shortcut target. Ask the user for an explicit switch confirmation. Update `F:\其他\桌面\Pi Desktop.lnk` to the new EXE only after confirmation. Keep `F:\软件\我的秘籍\PI\Pi Desktop` unchanged for rollback.

- [ ] **Step 7: Correct the old gap report with verified facts**

Update the report to distinguish Pi core, pi-web, and Pi Desktop; replace the false Extensions/Packages/i18n findings; record actual released versions and the gated update flow. Run humanizer-zh on changed Chinese prose. Do not claim “已记录” until the Obsidian report and planning progress are both updated.

- [ ] **Step 8: Final verification and handoff**

Run `git status --short`, list every implementation commit, confirm no unrelated user file is included, and run `superpowers:verification-before-completion`. If implementation is ready to integrate, use `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`.

Do not delete the old installation. That is a separate one-way decision.
