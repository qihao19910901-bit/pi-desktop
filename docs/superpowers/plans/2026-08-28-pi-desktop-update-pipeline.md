# Pi Desktop 更新链路与内置组件升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Pi Desktop GitHub 更新下载地址处理，升级内置 pi-web/Pi Agent，并在本地构建验证新包。

**Architecture:** 保留现有 electron-updater 检查与自定义镜像下载架构，只在 URL 解析边界补齐 GitHub Release 基准地址；发现更新后仍采用下载完成再提示手动安装。依赖使用固定版本并通过现有包验证脚本检查最终产物。

**Tech Stack:** Electron 43、electron-updater 6.8.9、Node.js `node:test`、electron-builder、npm lockfile。

---

### Task 1: 记录基线并锁定依赖版本

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/package-contract.test.js`

- [ ] **Step 1: 确认当前基线**

Run from `F:/软件/我的秘籍/pi-desktop`:

```bash
node -e "const p=require('./package.json'); console.log(p.version,p.dependencies['@agegr/pi-web'],p.dependencies['@earendil-works/pi-coding-agent'])"
node -e "const j=require('./package-lock.json'); console.log(j.packages['node_modules/@agegr/pi-web'].version,j.packages['node_modules/@earendil-works/pi-coding-agent'].version)"
```

Expected: current package is `1.1.23`, pi-web is `0.8.7`, Pi Agent is `0.84.1`.

- [ ] **Step 2: Update only the two direct dependency declarations**

Set exact versions:

```json
"@agegr/pi-web": "0.8.11",
"@earendil-works/pi-coding-agent": "0.84.3"
```

Do not change Electron, updater, xterm, node-pty, scripts, overrides, or unrelated dependencies.

- [ ] **Step 3: Regenerate the lockfile without broad upgrades**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: lockfile resolves `@agegr/pi-web@0.8.11` and `@earendil-works/pi-coding-agent@0.84.3`; no install scripts run.

- [ ] **Step 4: Run package contract tests**

Run:

```bash
node --test test/package-contract.test.js
```

Expected: PASS, or a focused failure showing a stale expected version that must be updated only if it asserts the old baseline.

- [ ] **Step 5: Commit the dependency-only change**

```bash
git add package.json package-lock.json test/package-contract.test.js
git commit -m "chore: update bundled pi dependencies"
```

If the test file needs no change, omit it from `git add`.

---

### Task 2: Add failing tests for Release URL resolution

**Files:**
- Modify: `test/updater.test.js`
- Modify: `electron/updater.js` only after the failing test is observed

- [ ] **Step 1: Add a test for the actual relative `latest.yml` shape**

Add a test using `files[0].url: 'Pi-Desktop-Setup-1.1.27.exe'` and `releaseUrl: 'https://github.com/qihao19910901-bit/pi-desktop/releases/tag/v1.1.27'`. Assert that:

```js
urls[2] === 'https://github.com/qihao19910901-bit/pi-desktop/releases/download/v1.1.27/Pi-Desktop-Setup-1.1.27.exe'
```

Also assert mirror URLs are built from that full GitHub URL.

- [ ] **Step 2: Add a test for a pre-resolved full URL**

Assert that an `https://github.com/.../releases/download/.../x.exe` input remains unchanged as the direct fallback and is not double-prefixed.

- [ ] **Step 3: Add a test for missing release context**

Assert that a relative filename without `releaseUrl` or equivalent release metadata returns `[]`, rather than creating a local or malformed URL.

- [ ] **Step 4: Run only updater tests to verify RED**

```bash
node --test test/updater.test.js
```

Expected: new relative-URL test fails against the current implementation because it returns malformed mirror/direct URLs.

---

### Task 3: Implement minimal updater URL fix and immediate update status

**Files:**
- Modify: `electron/updater.js`
- Test: `test/updater.test.js`

- [ ] **Step 1: Add a small URL resolver**

Implement the smallest pure helper needed by `buildDownloadUrls(info)`:

- Keep full `http:`/`https:` URLs unchanged.
- For a relative filename, derive the release tag from `info.releaseUrl` when it matches `/releases/tag/<tag>`; otherwise use an explicit `info.releaseName`/`info.tag` only if the existing event provides it.
- Build the canonical URL as `https://github.com/qihao19910901-bit/pi-desktop/releases/download/<tag>/<filename>`.
- Return `[]` for missing/invalid metadata.
- Generate mirrors only after the canonical GitHub URL exists.

Do not add a config system, new dependency, or a second updater implementation.

- [ ] **Step 2: Make the update state visible immediately**

On `update-available`, keep the existing log and add one non-blocking informational dialog before the custom download begins, or use the existing project-approved UI status mechanism if tests show one already exists. The dialog must not block the async download and must not create duplicate prompts when retries emit the same update. Preserve the final “更新包已就绪” dialog.

- [ ] **Step 3: Add/adjust harness assertions**

Verify the controller still:

- downloads once per update event;
- shows the final ready dialog on success;
- shows the failure dialog on failed download;
- does not auto-install;
- registers listeners once.

- [ ] **Step 4: Run focused updater tests**

```bash
node --test test/updater.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit updater change**

```bash
git add electron/updater.js test/updater.test.js
git commit -m "fix: resolve relative desktop update assets"
```

---

### Task 4: Run full tests and package verification

**Files:**
- Modify: `progress.md`
- Modify: `findings.md` only for errors or new decisions

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: all tests pass. Record any failure and resolution in `findings.md` before retrying.

- [ ] **Step 2: Build an unpacked directory**

```bash
npm run build:dir
```

Expected: build completes and produces a packaged directory under `dist/`.

- [ ] **Step 3: Verify package contents and versions**

```bash
npm run verify:package
```

Expected: package verification passes and reports `@agegr/pi-web 0.8.11` plus `@earendil-works/pi-coding-agent 0.84.3` in the packaged resources.

- [ ] **Step 4: Build the Windows installer locally**

```bash
npm run build
```

Expected: electron-builder creates `Pi-Desktop-Setup-1.1.28.exe`, with no GitHub publish step.

- [ ] **Step 5: Run package smoke verification if the build succeeds**

```bash
npm run smoke:package
```

Expected: the packaged app starts in smoke mode, serves Pi Web, and exits cleanly. If the environment cannot launch Electron, record that as not verified rather than claiming success.

- [ ] **Step 6: Write the quality-gate result**

Append to `progress.md`:

```markdown
- [x] AI 自审查 6/6 通过；安全基础、边界处理、代码质量、数据正确性均已检查。
- [x] 测试/构建质量门：`npm test`、`npm run verify:package`、构建与 smoke 结果已记录。
```

Do not claim installation or release publication.
