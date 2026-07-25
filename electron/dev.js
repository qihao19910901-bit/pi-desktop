// dev.js - 开发模式启动脚本（绕过 .bin 和路径分隔符问题）
// require('electron') 返回 electron.exe 的绝对路径，最可靠
const { spawn } = require('child_process');
const path = require('path');

let electronPath;
try {
  electronPath = require('electron');
} catch (e) {
  // fallback: 直接拼路径
  electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
}

const PROJECT_ROOT = path.join(__dirname, '..');

// electron 主进程不允许 NODE_OPTIONS 里的某些 flag（如 --use-system-ca）
// 且必须清除 ELECTRON_RUN_AS_NODE（否则 electron.exe 当 node 跑，require('electron') 返回字符串）
// 清掉这些，避免启动失败
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.NODE_OPTIONS_PATH;
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[dev] 启动失败:', err.message);
  process.exit(1);
});
