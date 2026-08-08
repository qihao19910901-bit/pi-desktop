// templates-window.test.js - 模板面板 handler 逻辑测试
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {
  createTemplateHandlers,
  templateRoots,
  parseFrontmatter,
  assertTemplatePath,
} = require('../electron/templates-window');

function makeEnv(t) {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tpl-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-tpl-project-'));
  fs.mkdirSync(path.join(homedir, '.pi', 'agent', 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.pi', 'prompts'), { recursive: true });
  t.after(() => { fs.rmSync(homedir, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); });
  return { homedir, cwd };
}

test('templateRoots covers global and project scopes', () => {
  const roots = templateRoots('C:/proj', 'C:/Users/me');
  assert.equal(roots.length, 2);
  assert.equal(roots[0].scope, 'global');
  assert.equal(roots[0].dir, path.join('C:/Users/me', '.pi', 'agent', 'prompts'));
  assert.equal(roots[1].scope, 'project');
  assert.equal(roots[1].dir, path.join('C:/proj', '.pi', 'prompts'));
});

test('templateRoots omits project scope without cwd', () => {
  const roots = templateRoots(null, 'C:/Users/me');
  assert.equal(roots.length, 1);
  assert.equal(roots[0].scope, 'global');
});

test('parseFrontmatter extracts description and strips frontmatter', () => {
  const parsed = parseFrontmatter('---\ndescription: Review staged git changes\nargument-hint: "<PR-URL>"\n---\n\n正文内容');
  assert.equal(parsed.description, 'Review staged git changes');
  assert.equal(parsed.argumentHint, '<PR-URL>');
  assert.equal(parsed.body, '\n正文内容');
  // 无 frontmatter
  const plain = parseFrontmatter('只有正文');
  assert.equal(plain.description, undefined);
  assert.equal(plain.body, '只有正文');
});

test('list returns templates from both scopes with parsed descriptions', (t) => {
  const { homedir, cwd } = makeEnv(t);
  fs.writeFileSync(path.join(homedir, '.pi', 'agent', 'prompts', 'review.md'),
    '---\ndescription: 代码审查\n---\n内容');
  fs.writeFileSync(path.join(cwd, '.pi', 'prompts', 'local.md'), '本地模板');
  fs.writeFileSync(path.join(homedir, '.pi', 'agent', 'prompts', 'notes.txt'), '忽略非 md');

  const handlers = createTemplateHandlers({ homedir });
  const list = handlers.list(cwd);
  assert.equal(list.length, 2);
  const review = list.find((t) => t.name === 'review');
  const local = list.find((t) => t.name === 'local');
  assert.ok(review);
  assert.equal(review.scope, 'global');
  assert.equal(review.description, '代码审查');
  assert.equal(local.scope, 'project');
  assert.equal(local.description, undefined);
});

test('read and write round-trip within allowed roots', (t) => {
  const { homedir, cwd } = makeEnv(t);
  const handlers = createTemplateHandlers({ homedir });
  const file = path.join(homedir, '.pi', 'agent', 'prompts', 'new.md');
  handlers.write(cwd, file, '---\ndescription: 新建\n---\n内容');
  assert.equal(handlers.read(cwd, file), '---\ndescription: 新建\n---\n内容');
  handlers.remove(cwd, file);
  assert.equal(fs.existsSync(file), false);
});

test('rejects paths outside template roots (path traversal)', (t) => {
  const { homedir, cwd } = makeEnv(t);
  const handlers = createTemplateHandlers({ homedir });
  const evil = path.join(cwd, '..', '..', 'secret.md');
  assert.throws(() => handlers.write(cwd, evil, 'x'), /不在模板目录内/);
  assert.throws(() => handlers.read(cwd, evil), /不在模板目录内/);
  assert.throws(() => handlers.remove(cwd, evil), /不在模板目录内/);
});

test('newPath validates names and resolves scope directories', (t) => {
  const { homedir, cwd } = makeEnv(t);
  const handlers = createTemplateHandlers({ homedir });
  assert.throws(() => handlers.newPath(cwd, 'bad name', false), /模板名只能/);
  assert.throws(() => handlers.newPath(cwd, '../evil', false), /模板名只能/);
  assert.equal(
    handlers.newPath(cwd, 'demo', false),
    path.join(homedir, '.pi', 'agent', 'prompts', 'demo.md'),
  );
  assert.equal(
    handlers.newPath(cwd, 'demo', true),
    path.join(cwd, '.pi', 'prompts', 'demo.md'),
  );
  assert.throws(() => handlers.newPath(null, 'demo', true), /未找到项目目录/);
});

test('assertTemplatePath normalizes separators and rejects siblings', (t) => {
  const { homedir, cwd } = makeEnv(t);
  const roots = templateRoots(cwd, homedir);
  const ok = path.join(homedir, '.pi', 'agent', 'prompts', 'a.md');
  assert.equal(assertTemplatePath(ok, roots), ok);
  const sibling = path.join(homedir, '.pi', 'agent', 'prompts-backup', 'a.md');
  assert.throws(() => assertTemplatePath(sibling, roots), /不在模板目录内/);
});
