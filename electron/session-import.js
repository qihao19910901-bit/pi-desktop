// session-import.js - Claude/Codex 会话导入 pi（纯逻辑，可测）
// 借鉴 PiDeck ClaudeSessionImporter/CodexSessionImporter
// 流程：扫描源 jsonl → 提取 (role, text, timestamp) 消息序列 → 构建 pi 会话（version 3）→ 写入 ~/.pi/agent/sessions
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

// ============ pi 会话目录编码 ============
// F:\软件\我的秘籍 → --F--软件-我的秘籍--
function encodeSessionDir(cwd) {
  const match = /^([A-Za-z]):[\\/]?(.*)$/.exec(cwd || '');
  const drive = match ? match[1] : '';
  const rest = match ? match[2] : (cwd || '');
  const clean = rest.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '-');
  return drive ? `--${drive}--${clean}--` : `--${clean}--`;
}

function sessionsRoot(homedir = os.homedir()) {
  return path.join(homedir, '.pi', 'agent', 'sessions');
}

// ============ 扫描 ============

function scanClaude(homedir = os.homedir()) {
  const root = path.join(homedir, '.claude', 'projects');
  const results = [];
  if (!fs.existsSync(root)) return results;
  for (const projectDir of fs.readdirSync(root)) {
    const dir = path.join(root, projectDir);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      results.push({
        type: 'claude',
        source: filePath,
        projectDir,
        sessionId: file.replace(/\.jsonl$/, ''),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  }
  return results;
}

function scanCodex(homedir = os.homedir()) {
  const root = path.join(homedir, '.codex', 'sessions');
  const results = [];
  if (!fs.existsSync(root)) return results;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) {
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        results.push({
          type: 'codex',
          source: full,
          projectDir: path.basename(dir),
          sessionId: entry.name.replace(/\.jsonl$/, ''),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    }
  };
  walk(root);
  return results;
}

// ============ 解析 ============

function parseClaude(filePath) {
  const messages = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const msg = entry.message;
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    const texts = content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text);
    const text = texts.join('\n').trim();
    if (!text) continue;
    messages.push({
      role: msg.role,
      text,
      timestamp: msg.timestamp || entry.timestamp || new Date().toISOString(),
    });
  }
  return messages;
}

function parseCodex(filePath) {
  const messages = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const ts = entry.timestamp || new Date().toISOString();
    if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role) {
      const content = Array.isArray(entry.payload.content) ? entry.payload.content : [];
      const texts = content.filter((c) => c && (c.type === 'input_text' || c.type === 'output_text') && typeof c.text === 'string').map((c) => c.text);
      const text = texts.join('\n').trim();
      if (text) messages.push({ role: entry.payload.role, text, timestamp: ts });
    } else if (entry.type === 'event_msg' && entry.payload?.type === 'agent_message' && typeof entry.payload.message === 'string') {
      const text = entry.payload.message.trim();
      if (text) messages.push({ role: 'assistant', text, timestamp: ts });
    }
  }
  return messages;
}

// ============ 构建 pi 会话（version 3） ============

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function buildPiSession(messages, cwd, { sessionId = crypto.randomUUID(), firstTimestamp } = {}) {
  const firstTs = firstTimestamp || (messages[0]?.timestamp) || new Date().toISOString();
  const lines = [{ type: 'session', version: 3, id: sessionId, timestamp: firstTs, cwd }];
  let parentId = null;
  for (const m of messages) {
    const id = shortId();
    lines.push({
      type: 'message',
      id,
      parentId,
      timestamp: m.timestamp,
      message: {
        role: m.role,
        content: [{ type: 'text', text: m.text }],
        timestamp: Date.parse(m.timestamp) || Date.now(),
      },
    });
    parentId = id;
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

// ============ 导入 ============

function importSession({ source, type, cwd }, homedir = os.homedir()) {
  if (!source || typeof source !== 'string') throw new Error('source 不能为空');
  if (type !== 'claude' && type !== 'codex') throw new Error(`不支持的类型: ${type}`);
  if (!cwd || typeof cwd !== 'string') throw new Error('cwd 不能为空');
  if (!fs.existsSync(source)) throw new Error(`源文件不存在: ${source}`);

  const messages = type === 'claude' ? parseClaude(source) : parseCodex(source);
  if (messages.length === 0) throw new Error('会话中没有可导入的消息');

  const sessionId = crypto.randomUUID();
  const content = buildPiSession(messages, cwd, { sessionId });
  const dir = path.join(sessionsRoot(homedir), encodeSessionDir(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (messages[0]?.timestamp || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 23);
  const fileName = `${stamp}_${sessionId}.jsonl`;
  const target = path.join(dir, fileName);
  fs.writeFileSync(target, content, 'utf8');
  return { ok: true, sessionFile: target, messageCount: messages.length, sessionId };
}

module.exports = {
  encodeSessionDir,
  sessionsRoot,
  scanClaude,
  scanCodex,
  parseClaude,
  parseCodex,
  buildPiSession,
  importSession,
  shortId,
};
