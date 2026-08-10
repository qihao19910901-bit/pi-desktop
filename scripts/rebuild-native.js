// rebuild-native.js - 重建原生模块（node-pty）到 Electron ABI
// 用法：npm run rebuild:native
// 必要原因：
//   1. node-pty 的 binding.gyp 硬编码 SpectreMitigation: Spectre，
//      本机/CI 的 VS BuildTools 无该组件 → 编译失败 MSB8040
//   2. node-pty 需按 Electron ABI 重编译（npm 装的 .node 是 Node ABI）
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const PTY_DIR = path.join(PROJECT_ROOT, 'node_modules', 'node-pty');

function patchSpectre() {
  const files = [
    path.join(PTY_DIR, 'binding.gyp'),
    path.join(PTY_DIR, 'deps', 'winpty', 'src', 'winpty.gyp'),
  ];
  let patched = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const next = source.replace(/'SpectreMitigation': 'Spectre'/g, "'SpectreMitigation': 'false'");
    if (next !== source) {
      fs.writeFileSync(file, next);
      patched += 1;
    }
  }
  return patched;
}

function main() {
  if (!fs.existsSync(path.join(PTY_DIR, 'package.json'))) {
    console.error('[rebuild] node-pty 未安装，先 npm install');
    process.exit(1);
  }

  const patched = patchSpectre();
  console.log(`[rebuild] Spectre 补丁: ${patched > 0 ? '已应用 ' + patched + ' 个文件' : '无需补丁（已应用过）'}`);

  const electronVersion = require(path.join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json')).version;
  console.log(`[rebuild] 目标 Electron: ${electronVersion}`);

  const args = ['-f', '-w', 'node-pty'];
  console.log('[rebuild] electron-rebuild', args.join(' '));
  execFileSync(
    process.execPath,
    [path.join(PROJECT_ROOT, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'), ...args],
    { cwd: PROJECT_ROOT, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } },
  );

  const built = path.join(PTY_DIR, 'build', 'Release', 'conpty.node');
  if (!fs.existsSync(built)) {
    console.error('[rebuild] 编译产物缺失:', built);
    process.exit(1);
  }
  console.log('[rebuild] node-pty 编译成功 ✅');
}

main();
