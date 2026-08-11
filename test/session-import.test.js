// session-import.test.js - 会话导入逻辑测试
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  encodeSessionDir,
  parseClaude,
  parseCodex,
  buildPiSession,
  importSession,
} = require('../electron/session-import');

test('encodeSessionDir matches pi session directory convention', () => {
  assert.equal(encodeSessionDir('F:\\软件\\我的秘籍'), '--F--软件-我的秘籍--');
  assert.equal(encodeSessionDir('C:\\Users\\Administrator\\x'), '--C--Users-Administrator-x--');
  assert.equal(encodeSessionDir('F:/软件/我的秘籍'), '--F--软件-我的秘籍--');
  assert.equal(encodeSessionDir('/unix/path'), '--unix-path--');
});

test('parseClaude extracts user/assistant text messages', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-imp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'ignored' }),
    JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: '你好' }], timestamp: '2026-07-01T00:00:00.000Z' } }),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'skip me' }, { type: 'text', text: '回复' }], timestamp: '2026-07-01T00:00:01.000Z' } }),
    JSON.stringify({ message: { role: 'tool', content: [{ type: 'tool_result' }] } }),
  ].join('\n'));
  const messages = parseClaude(file);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: 'user', text: '你好', timestamp: '2026-07-01T00:00:00.000Z' });
  assert.equal(messages[1].text, '回复'); // thinking 被跳过
});

test('parseCodex extracts response_item and agent_message', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-imp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ timestamp: '2026-07-01T00:00:00Z', type: 'session_meta', payload: {} }),
    JSON.stringify({ timestamp: '2026-07-01T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题' }] } }),
    JSON.stringify({ timestamp: '2026-07-01T00:00:02Z', type: 'event_msg', payload: { type: 'agent_message', message: '答案' } }),
  ].join('\n'));
  const messages = parseCodex(file);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: 'user', text: '问题', timestamp: '2026-07-01T00:00:01Z' });
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].text, '答案');
});

test('buildPiSession produces a version-3 session with chained entries', () => {
  const messages = [
    { role: 'user', text: 'hi', timestamp: '2026-07-01T00:00:00.000Z' },
    { role: 'assistant', text: 'hello', timestamp: '2026-07-01T00:00:01.000Z' },
  ];
  const content = buildPiSession(messages, 'F:\\软件\\我的秘籍');
  const lines = content.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].type, 'session');
  assert.equal(lines[0].version, 3);
  assert.equal(lines[0].cwd, 'F:\\软件\\我的秘籍');
  assert.equal(lines[1].type, 'message');
  assert.equal(lines[1].message.role, 'user');
  assert.equal(lines[1].message.content[0].text, 'hi');
  assert.equal(lines[1].parentId, null);
  assert.equal(lines[2].parentId, lines[1].id); // 线性链
});

test('importSession writes a pi session file and reports count', (t) => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-imp-home-'));
  t.after(() => fs.rmSync(homedir, { recursive: true, force: true }));
  const src = path.join(homedir, 'claude-session.jsonl');
  fs.writeFileSync(src, JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: 'x' }], timestamp: '2026-07-01T00:00:00.000Z' } }) + '\n');
  const r = importSession({ source: src, type: 'claude', cwd: 'F:\\软件\\我的秘籍' }, homedir);
  assert.equal(r.ok, true);
  assert.equal(r.messageCount, 1);
  assert.ok(fs.existsSync(r.sessionFile));
  assert.match(r.sessionFile, /--F--软件-我的秘籍--/);
  const content = fs.readFileSync(r.sessionFile, 'utf8');
  assert.match(content, /"version":3/);
});

test('importSession rejects bad inputs', (t) => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-imp-home2-'));
  t.after(() => fs.rmSync(homedir, { recursive: true, force: true }));
  assert.throws(() => importSession({ source: '', type: 'claude', cwd: 'F:/x' }, homedir), /source 不能为空/);
  assert.throws(() => importSession({ source: 'a.jsonl', type: 'gemini', cwd: 'F:/x' }, homedir), /不支持的类型/);
  assert.throws(() => importSession({ source: 'a.jsonl', type: 'claude', cwd: '' }, homedir), /cwd 不能为空/);
  assert.throws(() => importSession({ source: 'nonexistent.jsonl', type: 'claude', cwd: 'F:/x' }, homedir), /源文件不存在/);
  // 空会话
  const src = path.join(homedir, 'empty.jsonl');
  fs.writeFileSync(src, '{"type":"session_meta"}\n');
  assert.throws(() => importSession({ source: src, type: 'codex', cwd: 'F:/x' }, homedir), /没有可导入的消息/);
});
