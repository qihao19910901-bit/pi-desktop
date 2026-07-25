// run-build.js - 打包脚本（绕过 .bin，直接调用 electron-builder CLI）
// 设 ELECTRON_CACHE / ELECTRON_BUILDER_CACHE 到项目内 F 盘，再 spawn electron-builder
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
process.env.ELECTRON_CACHE = path.join(PROJECT_ROOT, '.cache', 'electron');
process.env.ELECTRON_BUILDER_CACHE = path.join(PROJECT_ROOT, '.cache', 'electron-builder');
process.env.TMP = path.join(PROJECT_ROOT, '.cache', 'tmp');
process.env.TEMP = path.join(PROJECT_ROOT, '.cache', 'tmp');

// electron-builder 的 CLI 入口
let builderEntry;
try {
  builderEntry = require.resolve('electron-builder/out/cli/cli.js');
} catch (e) {
  console.error('[build] 找不到 electron-builder CLI 入口:', e.message);
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, [builderEntry, ...args], {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[build] 启动失败:', err);
  process.exit(1);
});
