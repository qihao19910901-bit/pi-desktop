// default-cwd.js - 解析 pi 的默认工作目录（trust.json 第一个信任目录）
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

function resolveDefaultCwd(homedir = os.homedir()) {
  try {
    const trustFile = path.join(homedir, '.pi', 'agent', 'trust.json');
    const data = JSON.parse(fs.readFileSync(trustFile, 'utf8'));
    const trusted = Object.entries(data).filter(([, v]) => v === true).map(([k]) => k);
    if (trusted.length > 0) return trusted[0];
  } catch {
    // trust.json 不存在或损坏：回退主目录
  }
  return homedir;
}

module.exports = { resolveDefaultCwd };
