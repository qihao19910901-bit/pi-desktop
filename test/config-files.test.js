// config-files.test.js - pi 配置文件读写/校验/备份测试
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  CONFIG_FILES,
  listConfigFiles,
  readConfigFile,
  writeConfigFile,
  assertConfigName,
} = require('../electron/config-files');

function makeEnv(t) {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cfg-'));
  fs.mkdirSync(path.join(homedir, '.pi', 'agent'), { recursive: true });
  t.after(() => fs.rmSync(homedir, { recursive: true, force: true }));
  return homedir;
}

test('CONFIG_FILES covers the three pi config files', () => {
  assert.deepEqual(Object.keys(CONFIG_FILES).sort(), ['auth.json', 'models.json', 'settings.json']);
  assert.equal(CONFIG_FILES['auth.json'].sensitive, true);
  assert.equal(CONFIG_FILES['models.json'].sensitive, false);
});

test('listConfigFiles reports existence and size', (t) => {
  const homedir = makeEnv(t);
  fs.writeFileSync(path.join(homedir, '.pi', 'agent', 'models.json'), '{"providers":{}}');
  const files = listConfigFiles(homedir);
  const models = files.find((f) => f.name === 'models.json');
  assert.equal(models.exists, true);
  assert.ok(models.size > 0);
  assert.equal(files.find((f) => f.name === 'auth.json').exists, false);
});

test('readConfigFile parses JSON and rejects invalid content', (t) => {
  const homedir = makeEnv(t);
  fs.writeFileSync(path.join(homedir, '.pi', 'agent', 'settings.json'), '{"defaultProvider":"deepseek"}');
  const r = readConfigFile('settings.json', homedir);
  assert.equal(r.parsed.defaultProvider, 'deepseek');
  // 非法 JSON
  fs.writeFileSync(path.join(homedir, '.pi', 'agent', 'models.json'), '{broken');
  assert.throws(() => readConfigFile('models.json', homedir), /不是合法 JSON/);
});

test('writeConfigFile validates JSON, backs up, and normalizes', (t) => {
  const homedir = makeEnv(t);
  const file = path.join(homedir, '.pi', 'agent', 'settings.json');
  fs.writeFileSync(file, '{"a":1}');

  // 非法 JSON 拒绝
  assert.throws(() => writeConfigFile('settings.json', '{bad', homedir), /JSON 语法错误/);

  // 合法写入 + 备份
  const r = writeConfigFile('settings.json', '{"a":2,"b":[1,2]}', homedir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.keys.sort(), ['a', 'b']);
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content, '{\n  "a": 2,\n  "b": [\n    1,\n    2\n  ]\n}\n');
  // 备份存在
  const baks = fs.readdirSync(path.join(homedir, '.pi', 'agent')).filter((f) => f.startsWith('settings.json.bak-'));
  assert.equal(baks.length, 1);
  assert.equal(fs.readFileSync(path.join(homedir, '.pi', 'agent', baks[0]), 'utf8'), '{"a":1}');
});

test('writeConfigFile rejects unknown names', (t) => {
  const homedir = makeEnv(t);
  assert.throws(() => writeConfigFile('evil.json', '{}', homedir), /不支持的配置文件/);
  assert.throws(() => assertConfigName('../settings.json'), /不支持的配置文件/);
});

test('writeConfigFile creates missing files', (t) => {
  const homedir = makeEnv(t);
  const r = writeConfigFile('auth.json', '{"deepseek":"sk-test"}', homedir);
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(path.join(homedir, '.pi', 'agent', 'auth.json')), true);
});
