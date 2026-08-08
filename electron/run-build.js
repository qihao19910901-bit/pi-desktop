// run-build.js - 打包脚本（绕过 .bin，直接调用 electron-builder CLI）
// v2: 增加前置环境检查与失败诊断（2026-08-08 实战踩坑总结）
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

function configureLocalBuildEnvironment(env = process.env, fsApi = fs, projectRoot = PROJECT_ROOT) {
  if (env.CI) return;

  const cacheDir = path.join(projectRoot, '.cache');
  const electronCache = path.join(cacheDir, 'electron');
  const tempDir = path.join(cacheDir, 'tmp');
  fsApi.mkdirSync(electronCache, { recursive: true });
  fsApi.mkdirSync(tempDir, { recursive: true });
  env.ELECTRON_CACHE = electronCache;
  env.TMP = tempDir;
  env.TEMP = tempDir;
}

// ============ 前置环境检查（本地构建诊断） ============
function readJson(filePath, fsApi) {
  try {
    return JSON.parse(fsApi.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 构建前检查已知的环境坑（均为 2026-08-08 实战确认）：
 * 1. ELECTRON_RUN_AS_NODE 导致打包产物以 Node 模式运行，smoke 必挂
 * 2. node_modules 的 electron 版本与 package.json 漂移 → 产物与 CI 不一致
 * 3. node_modules 是 junction（worktree）→ electron-builder 依赖扫描漏包
 * 返回 [{ id, severity: 'warn'|'error', message, fix }]
 */
function runPreflightChecks(env = process.env, projectRoot = PROJECT_ROOT, fsApi = fs) {
  const issues = [];
  if (env.CI) return issues;

  // 1. ELECTRON_RUN_AS_NODE
  if (env.ELECTRON_RUN_AS_NODE) {
    issues.push({
      id: 'ELECTRON_RUN_AS_NODE',
      severity: 'warn',
      message: `ELECTRON_RUN_AS_NODE=${env.ELECTRON_RUN_AS_NODE} 已设置：打包产物会以 Node 模式运行，smoke:package 必然失败`,
      fix: 'unset ELECTRON_RUN_AS_NODE（smoke 脚本已自动免疫，但建议清理）',
    });
  }

  // 2. electron 版本漂移 / 缺失
  const pkg = readJson(path.join(projectRoot, 'package.json'), fsApi);
  const expected = pkg?.devDependencies?.electron;
  const installedPkg = readJson(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), fsApi);
  if (!expected) {
    issues.push({
      id: 'ELECTRON_UNSPECIFIED',
      severity: 'error',
      message: 'package.json 未声明 devDependencies.electron',
      fix: 'npm install --include=dev',
    });
  } else if (!installedPkg) {
    issues.push({
      id: 'ELECTRON_NOT_INSTALLED',
      severity: 'error',
      message: 'node_modules/electron 未安装（npm 可能因 omit=dev 跳过了 devDependencies）',
      fix: 'npm ci --include=dev',
    });
  } else if (installedPkg.version !== expected) {
    issues.push({
      id: 'ELECTRON_VERSION_DRIFT',
      severity: 'warn',
      message: `electron 版本漂移：node_modules=${installedPkg.version}，package.json=${expected}（electron-builder 按实际安装版本下载，本机产物可能与 CI 不一致）`,
      fix: 'ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci --include=dev',
    });
  }

  // 3. node_modules 是 junction / 符号链接（git worktree 场景）
  const nmPath = path.join(projectRoot, 'node_modules');
  try {
    if (fsApi.lstatSync(nmPath).isSymbolicLink()) {
      issues.push({
        id: 'NODE_MODULES_JUNCTION',
        severity: 'warn',
        message: 'node_modules 是符号链接/junction：electron-builder 依赖扫描会漏打包（如 next、react），运行时 pi-web 起不来',
        fix: `删除链接后在该目录真实安装：rm node_modules && npm ci --include=dev`,
      });
    }
  } catch {
    // node_modules 不存在：由 electron-builder 或后续步骤处理
  }

  return issues;
}

function formatDiagnostics(issues) {
  if (issues.length === 0) return '';
  const lines = [`[build] ⚠ 环境检查发现 ${issues.length} 个问题：`];
  issues.forEach((issue, i) => {
    lines.push(`  [${i + 1}] (${issue.severity}) ${issue.message}`);
    lines.push(`      → 修复: ${issue.fix}`);
  });
  return lines.join('\n');
}

const FAILURE_HINTS = [
  '如果 electron zip 下载超时/失败（GitHub 直连被阻断）：',
  '  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build:dir',
  '如果报 "cannot find path for dependency" 或 next/react 漏打包：',
  '  node_modules 是 junction 导致，删除后真实 npm ci --include=dev',
  '如果打包产物 smoke 报 "bad option: --remote-debugging-port"：',
  '  ELECTRON_RUN_AS_NODE 环境变量未清理，unset ELECTRON_RUN_AS_NODE 后重试',
];

function main() {
  configureLocalBuildEnvironment();

  // 前置环境检查
  const issues = runPreflightChecks();
  if (issues.length) {
    console.warn(formatDiagnostics(issues));
    if (issues.some((issue) => issue.severity === 'error')) {
      console.error('[build] 环境检查存在错误，请先修复再构建。');
      process.exit(1);
    }
  }

  // electron-builder 的 CLI 入口
  let builderEntry;
  try {
    builderEntry = require.resolve('electron-builder/out/cli/cli.js');
  } catch (e) {
    console.error('[build] 找不到 electron-builder CLI 入口:', e.message);
    console.error('      → 修复: npm ci --include=dev');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  console.log('[build] 启动 electron-builder...', args.join(' ') || '(默认)');
  const child = spawn(process.execPath, [builderEntry, ...args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[build] electron-builder 退出, code:', code);
    } else {
      console.error(`[build] electron-builder 失败, code: ${code}`);
      console.error('[build] 常见原因与修复：');
      FAILURE_HINTS.forEach((line) => console.error('  ' + line));
    }
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error('[build] 启动失败:', err);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { configureLocalBuildEnvironment, runPreflightChecks, formatDiagnostics, FAILURE_HINTS };
