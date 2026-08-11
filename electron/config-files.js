// config-files.js - pi 配置文件读写（纯逻辑，可测）
// 借鉴 PiDeck ConfigManager：JSON 校验 + 保存前备份
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const CONFIG_FILES = {
  'models.json': { label: '模型配置', sensitive: false },
  'settings.json': { label: '设置', sensitive: false },
  'auth.json': { label: 'API 密钥', sensitive: true },
};

function agentDir(homedir = os.homedir()) {
  return path.join(homedir, '.pi', 'agent');
}

// 列出可编辑的配置文件（含是否存在/大小）
function listConfigFiles(homedir = os.homedir()) {
  const dir = agentDir(homedir);
  return Object.entries(CONFIG_FILES).map(([name, meta]) => {
    const filePath = path.join(dir, name);
    let exists = false;
    let size = 0;
    let mtime;
    try {
      const stat = fs.statSync(filePath);
      exists = true;
      size = stat.size;
      mtime = stat.mtime;
    } catch {
      // 不存在
    }
    return { name, label: meta.label, sensitive: meta.sensitive, filePath, exists, size, mtime: mtime ? mtime.toISOString() : undefined };
  });
}

function assertConfigName(name) {
  if (!Object.hasOwn(CONFIG_FILES, name)) throw new Error(`不支持的配置文件: ${name}`);
  return name;
}

// 读取（校验 JSON 结构，返回解析结果）
function readConfigFile(name, homedir = os.homedir()) {
  assertConfigName(name);
  const filePath = path.join(agentDir(homedir), name);
  const content = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${name} 不是合法 JSON: ${error.message}`);
  }
  return { name, filePath, content, parsed };
}

// 写入（JSON 校验 → 备份 → 原子写）
function writeConfigFile(name, content, homedir = os.homedir()) {
  assertConfigName(name);
  if (typeof content !== 'string') throw new Error('内容必须是文本');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`JSON 语法错误: ${error.message}`);
  }
  const filePath = path.join(agentDir(homedir), name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 备份现有文件
  if (fs.existsSync(filePath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(filePath, `${filePath}.bak-${stamp}`);
  }
  // 规范化写入（2 空格缩进）
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return { ok: true, filePath, keys: Object.keys(parsed) };
}

module.exports = { CONFIG_FILES, agentDir, listConfigFiles, readConfigFile, writeConfigFile, assertConfigName };
