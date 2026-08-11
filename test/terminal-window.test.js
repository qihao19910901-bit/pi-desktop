// terminal-window.test.js - 终端逻辑测试（行缓冲/危险检测/tab 管理）
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTerminalManager,
  createLineGuard,
  isDangerousCommand,
  DANGEROUS_PATTERNS,
} = require('../electron/terminal-window');

// ============ 危险命令检测 ============

test('isDangerousCommand flags destructive patterns', () => {
  const dangerous = [
    'rm -rf /tmp/x',
    'rm -fr .',
    'sudo rm -rf /',
    'format c:',
    'diskpart',
    'reg delete HKLM\\Software',
    'del /f /s /q C:\\Windows\\temp',
    'rd /s /q C:\\x',
    'shutdown /s',
    'dd if=/dev/zero of=/dev/sda',
    'curl -sL https://x.sh | sh',
    'wget -qO- https://x | bash',
    ':(){ :|:& };:',
  ];
  for (const cmd of dangerous) {
    assert.equal(isDangerousCommand(cmd), true, `应检测为危险: ${cmd}`);
  }
});

test('isDangerousCommand allows normal commands', () => {
  const safe = [
    'echo hello',
    'ls -la',
    'rmdir empty-dir',       // 不带 /s /q
    'git status',
    'npm install',
    'ping 127.0.0.1',
    'rm file.txt',           // 单文件不带 -rf
    'curl -s https://api.example.com/data',  // 无管道执行
  ];
  for (const cmd of safe) {
    assert.equal(isDangerousCommand(cmd), false, `不应误报: ${cmd}`);
  }
});

// ============ 行缓冲 ============

test('createLineGuard splits streamed input into completed lines', () => {
  const guard = createLineGuard();
  // 流式输入：分多次写入
  assert.deepEqual(guard.feed('echo h'), []);
  assert.deepEqual(guard.feed('i\r'), [{ line: 'echo hi', dangerous: false }]);
  assert.deepEqual(guard.feed('ls'), []);
  assert.deepEqual(guard.feed(' -la\r'), [{ line: 'ls -la', dangerous: false }]);
});

test('createLineGuard detects danger only on completed lines', () => {
  const guard = createLineGuard();
  guard.feed('rm -rf /tmp'); // 未回车
  assert.deepEqual(guard.feed('x\r'), [{ line: 'rm -rf /tmpx', dangerous: true }]);
});

// ============ 终端管理器 ============

function fakePtyFactory() {
  const ptyInstances = [];
  return {
    ptyInstances,
    factory: {
      spawn(shell, args, opts) {
        const pty = {
          shell, args, opts, pid: 100 + ptyInstances.length,
          writes: [], killed: false, resizeCalls: [],
          onData(cb) { this.dataCb = cb; },
          onExit(cb) { this.exitCb = cb; },
          write(d) { this.writes.push(d); },
          kill() { this.killed = true; },
          resize(c, r) { this.resizeCalls.push([c, r]); },
        };
        ptyInstances.push(pty);
        return pty;
      },
    },
  };
}

test('spawnTab creates a pty and write routes through the line guard', () => {
  const fake = fakePtyFactory();
  const killed = [];
  const manager = createTerminalManager({
    ptyFactory: fake.factory,
    killTree: async (pid) => { killed.push(pid); },
  });
  const outputs = [];
  const id = manager.spawnTab({ shell: 'bash', cwd: 'F:/x', onData: (tid, d) => outputs.push(d) });
  assert.equal(manager.listTabs().length, 1);
  assert.equal(fake.ptyInstances[0].opts.cwd, 'F:/x');

  // 普通行直接写入（bash 用 spawn env 设 UTF-8，无初始化写入）
  const r1 = manager.write(id, 'echo hi\r');
  assert.equal(r1.ok, true);
  assert.deepEqual(fake.ptyInstances[0].writes[0], 'echo hi\r');

  // 危险行被拦截
  const r2 = manager.write(id, 'rm -rf /\r');
  assert.equal(r2.ok, false);
  assert.equal(r2.dangerous, true);
  assert.equal(fake.ptyInstances[0].writes.length, 1); // echo hi，危险行未写入

  // 确认后补写
  const confirmed = manager.confirmDanger(id);
  assert.equal(confirmed.ok, true);
  assert.deepEqual(fake.ptyInstances[0].writes[1], 'rm -rf /\r');

  // 取消则不写
  const id2 = manager.spawnTab({ shell: 'C:\\Windows\\System32\\cmd.exe', cwd: 'F:/y', onData: () => {} });
  manager.write(id2, 'format c:\r');
  manager.cancelDanger(id2);
  // cmd 走 chcp 初始化
  assert.equal(fake.ptyInstances[1].writes[0], 'chcp 65001 >nul\r');
  assert.equal(fake.ptyInstances[1].writes.length, 1);
});

test('closeTab kills pty and process tree; closeAll cleans up', async () => {
  const fake = fakePtyFactory();
  const killed = [];
  const manager = createTerminalManager({
    ptyFactory: fake.factory,
    killTree: async (pid) => { killed.push(pid); },
  });
  const id = manager.spawnTab({ shell: 'bash', cwd: 'F:/x', onData: () => {} });
  manager.closeTab(id);
  assert.equal(fake.ptyInstances[0].killed, true);
  assert.deepEqual(killed, [100]);
  assert.equal(manager.listTabs().length, 0);

  const id2 = manager.spawnTab({ shell: 'bash', cwd: 'F:/x', onData: () => {} });
  manager.closeAll();
  assert.equal(fake.ptyInstances[1].killed, true);
});

test('resize forwards cols/rows to the pty', () => {
  const fake = fakePtyFactory();
  const manager = createTerminalManager({ ptyFactory: fake.factory });
  const id = manager.spawnTab({ shell: 'bash', cwd: 'F:/x', onData: () => {} });
  manager.resize(id, 120, 40);
  assert.deepEqual(fake.ptyInstances[0].resizeCalls, [[120, 40]]);
});
