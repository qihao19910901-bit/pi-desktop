// run-build.js - 打包脚本（绕过 .bin，直接调用 electron-builder CLI）
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

function main() {
  configureLocalBuildEnvironment();

  // electron-builder 的 CLI 入口
  let builderEntry;
  try {
    builderEntry = require.resolve('electron-builder/out/cli/cli.js');
  } catch (e) {
    console.error('[build] 找不到 electron-builder CLI 入口:', e.message);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  console.log('[build] 启动 electron-builder...', args.join(' ') || '(默认)');
  const child = spawn(process.execPath, [builderEntry, ...args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    console.log('[build] electron-builder 退出, code:', code);
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error('[build] 启动失败:', err);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { configureLocalBuildEnvironment };
