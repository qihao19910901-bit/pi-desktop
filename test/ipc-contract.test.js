// ipc-contract.test.js - 静态契约：每个窗口模块的 handle 通道必须被 removeHandler 覆盖
// 防止"关窗再开 → Attempted to register a second handler"回归（2026-08-10 两次实战教训）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WINDOW_MODULES = [
  'plugins-window.js',
  'templates-window.js',
  'settings-window.js',
  'terminal-window.js',
];

function extractChannels(source, call) {
  // 提取 ipcMain.<call>('channel', ...) 的所有通道名
  const channels = [];
  const re = new RegExp(`ipcMain\\.${call}\\(\\s*'([^']+)'`, 'g');
  let m;
  while ((m = re.exec(source))) channels.push(m[1]);
  return channels;
}

function extractRemovableChannels(source) {
  // 支持两种形式：
  //   1. ipcMain.removeHandler('channel') 字面量
  //   2. for (const channel of ['a','b']) { ipcMain.removeHandler(channel); } 循环
  const removed = [];
  const literalRe = /ipcMain\.removeHandler\(\s*'([^']+)'/g;
  let m;
  while ((m = literalRe.exec(source))) removed.push(m[1]);
  const loopRe = /for\s*\(\s*const\s+(\w+)\s+of\s+\[([^\]]*)\]\s*\)[\s\S]*?ipcMain\.removeHandler\(\s*\1\s*\)/g;
  let loop;
  while ((loop = loopRe.exec(source))) {
    const items = loop[2].match(/'([^']+)'/g) || [];
    for (const item of items) removed.push(item.slice(1, -1));
  }
  return removed;
}

for (const file of WINDOW_MODULES) {
  test(`${file}: every handled channel is also removable (idempotent reopen)`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', file), 'utf8');
    const handled = extractChannels(source, 'handle');
    const removed = extractRemovableChannels(source);
    assert.ok(handled.length > 0, `${file} 应有 ipcMain.handle 调用`);
    const missing = handled.filter((ch) => !removed.includes(ch));
    assert.deepEqual(
      missing,
      [],
      `${file} 缺少 removeHandler 的通道: ${missing.join(', ')}（关窗再开会抛 second handler 异常）`,
    );
  });
}
