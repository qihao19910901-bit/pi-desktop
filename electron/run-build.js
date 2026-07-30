// run-build.js - 打包脚本（绕过 .bin，直接调用 electron-builder CLI）
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

// 本地开发时用项目内 F 盘缓存。CI 环境跳过，用默认路径。
if (!process.env.CI) {
  const cacheDir = path.join(PROJECT_ROOT, '.cache');
  fs.mkdirSync(path.join(cacheDir, 'electron'), { recursive: true });
  fs.mkdirSync(path.join(cacheDir, 'electron-builder'), { recursive: true });
  fs.mkdirSync(path.join(cacheDir, 'tmp'), { recursive: true });
  process.env.ELECTRON_CACHE = path.join(cacheDir, 'electron');
  process.env.ELECTRON_BUILDER_CACHE = path.join(cacheDir, 'electron-builder');
  process.env.TMP = path.join(cacheDir, 'tmp');
  process.env.TEMP = path.join(cacheDir, 'tmp');
}

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
