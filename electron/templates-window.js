// templates-window.js - 提示词模板管理窗口
// 模板来源：~/.pi/agent/prompts/*.md（全局）+ {cwd}/.pi/prompts/*.md（项目，需信任）
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { BrowserWindow, ipcMain } = require('electron');
const { resolveDefaultCwd } = require('./default-cwd');

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(content) {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { description: undefined, argumentHint: undefined, body: content };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([a-zA-Z0-9-]+):\s*(.*)$/.exec(line);
    if (m) {
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      meta[m[1]] = value;
    }
  }
  return {
    description: meta.description || undefined,
    argumentHint: meta['argument-hint'] || undefined,
    body: content.slice(match[0].length),
  };
}

// 模板根目录：全局 + 项目（cwd 必须被信任才有项目目录）
function templateRoots(cwd, homedir = os.homedir()) {
  const roots = [{
    scope: 'global',
    label: '全局',
    dir: path.join(homedir, '.pi', 'agent', 'prompts'),
  }];
  if (typeof cwd === 'string' && cwd.length > 0) {
    roots.push({
      scope: 'project',
      label: '项目',
      dir: path.join(cwd, '.pi', 'prompts'),
    });
  }
  return roots;
}

// 路径安全校验：目标必须位于某个模板根目录内
function assertTemplatePath(filePath, roots) {
  const resolved = path.resolve(filePath);
  const inside = roots.some(({ dir }) => {
    const root = path.resolve(dir);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
  if (!inside) throw new Error('路径不在模板目录内，已拒绝');
  return resolved;
}

function listTemplates(cwd, fsApi = fs, homedir = os.homedir()) {
  const roots = templateRoots(cwd, homedir);
  const templates = [];
  for (const { scope, label, dir } of roots) {
    let entries = [];
    try {
      entries = fsApi.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 目录不存在
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const fullPath = path.join(dir, entry.name);
      const name = entry.name.slice(0, -3);
      let description;
      let size = 0;
      let mtime;
      try {
        const stat = fsApi.statSync(fullPath);
        size = stat.size;
        mtime = stat.mtime;
        const content = fsApi.readFileSync(fullPath, 'utf8');
        description = parseFrontmatter(content).description;
      } catch {
        description = undefined;
      }
      templates.push({ name, scope, label, path: fullPath, description, size, mtime: mtime ? mtime.toISOString() : undefined });
    }
  }
  return templates.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
}

function createTemplateHandlers({ getCwd, fsApi = fs, homedir = os.homedir() } = {}) {
  const rootsFor = (cwd) => templateRoots(cwd, homedir);
  return {
    list(cwd) {
      return listTemplates(cwd, fsApi, homedir);
    },
    newPath(cwd, name, isProject) {
      if (typeof name !== 'string' || !NAME_RE.test(name)) {
        throw new Error('模板名只能包含字母、数字、下划线和连字符');
      }
      if (isProject) {
        if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('未找到项目目录');
        return path.join(cwd, '.pi', 'prompts', `${name}.md`);
      }
      return path.join(homedir, '.pi', 'agent', 'prompts', `${name}.md`);
    },
    read(cwd, filePath) {
      const resolved = assertTemplatePath(filePath, rootsFor(cwd));
      return fsApi.readFileSync(resolved, 'utf8');
    },
    write(cwd, filePath, content) {
      if (typeof content !== 'string') throw new Error('内容必须是文本');
      const resolved = assertTemplatePath(filePath, rootsFor(cwd));
      fsApi.mkdirSync(path.dirname(resolved), { recursive: true });
      fsApi.writeFileSync(resolved, content, 'utf8');
      return { ok: true, path: resolved };
    },
    remove(cwd, filePath) {
      const resolved = assertTemplatePath(filePath, rootsFor(cwd));
      fsApi.rmSync(resolved, { force: true });
      return { ok: true };
    },
    defaultCwd() {
      return resolveDefaultCwd(homedir);
    },
  };
}

let templatesWindow = null;

function createTemplatesWindow({ projectRoot } = {}) {
  if (templatesWindow && !templatesWindow.isDestroyed()) {
    templatesWindow.show();
    templatesWindow.focus();
    return templatesWindow;
  }

  const win = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 680,
    minHeight: 500,
    title: '提示词模板 - Pi Desktop',
    backgroundColor: '#1e1e2e',
    icon: path.join(projectRoot, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'templates-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  templatesWindow = win;
  win.on('closed', () => { templatesWindow = null; });

  const handlers = createTemplateHandlers();
  // 幂等注册：窗口关闭后再次打开时先移除旧 handler，避免重复注册异常
  for (const channel of [
    'templates:list', 'templates:new-path', 'templates:read',
    'templates:write', 'templates:delete', 'templates:default-cwd',
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('templates:list', (_event, cwd) => handlers.list(cwd || null));
  ipcMain.handle('templates:new-path', (_event, cwd, name, isProject) => handlers.newPath(cwd || null, name, isProject));
  ipcMain.handle('templates:read', (_event, cwd, filePath) => handlers.read(cwd || null, filePath));
  ipcMain.handle('templates:write', (_event, cwd, filePath, content) => handlers.write(cwd || null, filePath, content));
  ipcMain.handle('templates:delete', (_event, cwd, filePath) => handlers.remove(cwd || null, filePath));
  ipcMain.handle('templates:default-cwd', () => handlers.defaultCwd());

  win.loadFile(path.join(__dirname, 'templates.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

function destroyTemplatesWindow() {
  if (templatesWindow && !templatesWindow.isDestroyed()) {
    templatesWindow.destroy();
  }
  templatesWindow = null;
}

module.exports = {
  createTemplatesWindow,
  destroyTemplatesWindow,
  createTemplateHandlers,
  templateRoots,
  parseFrontmatter,
  assertTemplatePath,
};
