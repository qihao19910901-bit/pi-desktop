const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPreload({ currentAlerts = [], observerError, readyState = 'loading' } = {}) {
  const listeners = new Map();
  const observers = [];
  const errors = [];
  const module = { exports: {} };
  const document = {
    body: {},
    querySelectorAllCalls: 0,
    readyState,
    addEventListener(type, handler) { listeners.set(type, handler); },
    querySelectorAll() {
      this.querySelectorAllCalls += 1;
      return currentAlerts;
    },
    createTreeWalker(root) {
      const nodes = [];
      const collect = (el) => {
        if (!el || typeof el !== 'object') return;
        nodes.push(el);
        if (Array.isArray(el.childNodes)) el.childNodes.forEach(collect);
      };
      collect(root);
      let i = 0;
      return {
        nextNode() { return i < nodes.length ? nodes[i++] : null; },
        get currentNode() { return nodes[i - 1] ?? null; },
      };
    },
  };
  const context = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === 'electron') return { ipcRenderer: { send() {} } };
      if (specifier === 'fs') return require('node:fs');
      if (specifier === 'path') return require('node:path');
      throw new Error(`unexpected require: ${specifier}`);
    },
    document,
    MutationObserver: class {
      constructor(callback) {
        if (observerError) throw observerError;
        this.callback = callback;
        this.observations = [];
        observers.push(this);
      }

      observe(target, options) {
        this.observations.push({ target, options });
      }
    },
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 },
    __dirname: path.join(__dirname, '..', 'electron'),
    setTimeout: () => 0,
    setInterval: () => 0,
    URL,
    location: { href: 'http://127.0.0.1:30141/', origin: 'http://127.0.0.1:30141' },
    console: { error(...args) { errors.push(args); } },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'electron/preload.js' });
  return { api: module.exports, document, errors, listeners, observers };
}

function fakeElement(text, role = 'alert', descendants = []) {
  const attributes = new Map([['role', role]]);
  return {
    nodeType: 1,
    parentElement: null,
    textContent: text,
    dataset: {},
    style: {},
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    matches(selector) {
      if (selector === '[role="alert"]') return attributes.get('role') === 'alert';
      if (selector === '[role="alert"], [data-pi-desktop-notice="compact-noop"]') {
        return attributes.get('role') === 'alert' || this.dataset.piDesktopNotice === 'compact-noop';
      }
      return false;
    },
    closest(selector) {
      if (this.matches(selector)) return this;
      return this.parentElement?.closest?.(selector) ?? null;
    },
    querySelectorAll(selector) { return selector === '[role="alert"]' ? descendants : []; },
  };
}

test('turns the exact Compact no-op into the approved Chinese info notice', () => {
  const { applyCompactNoopNotice, isCompactNoopMessage } = loadPreload().api;
  const alert = fakeElement('Nothing to compact (session too small)');

  assert.equal(isCompactNoopMessage(alert.textContent), true);
  assert.equal(applyCompactNoopNotice(alert), true);
  assert.equal(alert.textContent, 'ⓘ 当前会话内容较少，暂时无需压缩');
  assert.equal(alert.getAttribute('role'), 'status');
  assert.equal(alert.getAttribute('aria-live'), 'polite');
  assert.equal(alert.dataset.piDesktopNotice, 'compact-noop');
  assert.equal(alert.style.background, '#f0f6fc');
  assert.equal(alert.style.border, '1px solid #c9def1');
  assert.equal(alert.style.color, '#315b80');
  assert.equal(alert.style.fontFamily, 'inherit');
});

test('accepts surrounding whitespace but leaves unrelated and non-alert elements unchanged', () => {
  const { applyCompactNoopNotice } = loadPreload().api;
  const whitespace = fakeElement('  Nothing to compact (session too small)\n');
  const realError = fakeElement('Compaction failed: provider returned HTTP 403');
  const ordinaryText = fakeElement('Nothing to compact (session too small)', 'status');

  assert.equal(applyCompactNoopNotice(whitespace), true);
  assert.equal(applyCompactNoopNotice(realError), false);
  assert.equal(applyCompactNoopNotice(ordinaryText), false);
  assert.equal(realError.textContent, 'Compaction failed: provider returned HTTP 403');
  assert.equal(realError.getAttribute('role'), 'alert');
  assert.deepEqual(realError.style, {});
  assert.equal(ordinaryText.textContent, 'Nothing to compact (session too small)');
  assert.equal(ordinaryText.getAttribute('role'), 'status');
});

test('handles current and future alerts after DOMContentLoaded idempotently', () => {
  const currentAlerts = [fakeElement('Nothing to compact (session too small)')];
  const { api, document, listeners, observers } = loadPreload({ currentAlerts });

  assert.equal(typeof api.enhanceCompactNotices, 'function');
  assert.equal(typeof api.initCompactNoticeEnhancer, 'function');
  assert.equal(observers.length, 0);
  listeners.get('DOMContentLoaded')();
  assert.equal(currentAlerts[0].textContent, 'ⓘ 当前会话内容较少，暂时无需压缩');
  assert.equal(observers.length, 1);
  assert.equal(observers[0].observations[0].target, document.body);
  assert.equal(observers[0].observations[0].options.childList, true);
  assert.equal(observers[0].observations[0].options.subtree, true);
  assert.equal(observers[0].observations[0].options.characterData, true);
  assert.equal(document.querySelectorAllCalls, 1);

  const futureAlert = fakeElement('Nothing to compact (session too small)');
  currentAlerts.push(futureAlert);
  const records = [{ type: 'childList', target: document.body, addedNodes: [futureAlert] }];
  observers[0].callback(records);
  observers[0].callback(records);
  assert.equal(futureAlert.textContent, 'ⓘ 当前会话内容较少，暂时无需压缩');
  assert.equal(futureAlert.dataset.piDesktopNotice, 'compact-noop');
  assert.equal(document.querySelectorAllCalls, 1);
});

test('restores only owned presentation when a transformed node becomes a real error', () => {
  const { applyCompactNoopNotice } = loadPreload().api;
  const alert = fakeElement('Nothing to compact (session too small)');
  alert.style.color = '#a00';
  alert.style.padding = '8px';

  assert.equal(applyCompactNoopNotice(alert), true);
  alert.textContent = 'Compaction failed: provider returned HTTP 403';
  alert.setAttribute('role', 'alert');

  assert.equal(applyCompactNoopNotice(alert), false);
  assert.equal(alert.textContent, 'Compaction failed: provider returned HTTP 403');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.equal(alert.getAttribute('aria-live'), null);
  assert.equal(alert.dataset.piDesktopNotice, undefined);
  assert.equal(alert.style.background, undefined);
  assert.equal(alert.style.border, undefined);
  assert.equal(alert.style.color, '#a00');
  assert.equal(alert.style.fontFamily, undefined);
  assert.equal(alert.style.padding, '8px');
});

test('processes added alert subtrees and child text without rescanning the document', () => {
  const { document, listeners, observers } = loadPreload();
  listeners.get('DOMContentLoaded')();
  assert.equal(document.querySelectorAllCalls, 1);

  const nestedAlert = fakeElement('Nothing to compact (session too small)');
  const addedSubtree = fakeElement('', 'region', [nestedAlert]);
  observers[0].callback([{ type: 'childList', target: document.body, addedNodes: [addedSubtree] }]);
  assert.equal(nestedAlert.dataset.piDesktopNotice, 'compact-noop');

  const streamingAlert = fakeElement('', 'alert');
  const textNode = { nodeType: 3, parentElement: streamingAlert };
  streamingAlert.textContent = 'Nothing to compact (session too small)';
  observers[0].callback([{ type: 'childList', target: streamingAlert, addedNodes: [textNode] }]);
  assert.equal(streamingAlert.dataset.piDesktopNotice, 'compact-noop');
  assert.equal(document.querySelectorAllCalls, 1);
});

test('restores a marked status node when React changes only its text', () => {
  const { api, listeners, observers } = loadPreload();
  const alert = fakeElement('Nothing to compact (session too small)');
  alert.style.padding = '8px';
  assert.equal(api.applyCompactNoopNotice(alert), true);
  listeners.get('DOMContentLoaded')();

  alert.textContent = 'Compaction failed: provider returned HTTP 403';
  const textNode = { nodeType: 3, parentElement: alert };
  observers[0].callback([{ type: 'childList', target: alert, addedNodes: [textNode] }]);

  assert.equal(alert.textContent, 'Compaction failed: provider returned HTTP 403');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.equal(alert.getAttribute('aria-live'), null);
  assert.equal(alert.dataset.piDesktopNotice, undefined);
  assert.equal(alert.style.background, undefined);
  assert.equal(alert.style.border, undefined);
  assert.equal(alert.style.color, undefined);
  assert.equal(alert.style.fontFamily, undefined);
  assert.equal(alert.style.padding, '8px');
});

test('logs DOMContentLoaded initialization failures without crashing the page', () => {
  const observerError = new Error('observer unavailable');
  const { errors, listeners } = loadPreload({ observerError });

  assert.doesNotThrow(() => listeners.get('DOMContentLoaded')());
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], 'observer unavailable');
});

// ============ 中文字典翻译 ============

test('translates exact text nodes with the ZH dictionary', () => {
  const { api } = loadPreload();
  const node = { nodeType: 3, nodeValue: 'Send' };
  api.translateNode(node);
  assert.equal(node.nodeValue, '发送');
});

test('translates case-insensitively as a fallback', () => {
  const { api } = loadPreload();
  const node = { nodeType: 3, nodeValue: '  send  ' };
  api.translateNode(node);
  // 原行为：保留原文周围空白，仅替换匹配部分
  assert.equal(node.nodeValue, '  发送  ');
});

test('leaves untranslated text untouched', () => {
  const { api } = loadPreload();
  const node = { nodeType: 3, nodeValue: 'Nothing to compact (session too small)' };
  api.translateNode(node);
  assert.equal(node.nodeValue, 'Nothing to compact (session too small)');
});

test('ignores non-string node values safely', () => {
  const { api } = loadPreload();
  const node = { nodeType: 3 };
  assert.doesNotThrow(() => api.translateNode(node));
});

test('translates placeholder and title attributes on elements', () => {
  const { api } = loadPreload();
  const el = { nodeType: 1, placeholder: 'Type a message...', title: 'Settings' };
  api.translateNode(el);
  assert.equal(el.placeholder, '输入消息...');
  assert.equal(el.title, '设置');
});

test('walks and translates a DOM subtree via the shared walker', () => {
  const { api } = loadPreload();
  const textA = { nodeType: 3, nodeValue: 'Cancel' };
  const textB = { nodeType: 3, nodeValue: 'Send' };
  const inner = { nodeType: 1, childNodes: [textB] };
  const root = { nodeType: 1, childNodes: [textA, inner] };
  api.walkAndTranslate(root);
  assert.equal(textA.nodeValue, '取消');
  assert.equal(textB.nodeValue, '发送');
});

test('translates text arriving through characterData mutations', () => {
  const { listeners, observers } = loadPreload();
  listeners.get('DOMContentLoaded')();
  const textNode = { nodeType: 3, nodeValue: 'Retry' };
  observers[0].callback([{ type: 'characterData', target: textNode }]);
  assert.equal(textNode.nodeValue, '重试');
});

test('keeps Compact English message intact during translation (dictionary has no compact key)', () => {
  const { api } = loadPreload();
  const raw = 'Nothing to compact (session too small)';
  assert.equal(api.ZH_MAP[raw], undefined);
  const alert = fakeElement(raw);
  assert.equal(api.applyCompactNoopNotice(alert), true);
  assert.equal(alert.textContent, 'ⓘ 当前会话内容较少，暂时无需压缩');
});

test('full pipeline: DOMContentLoaded translates, compacts and observes once', () => {
  const currentAlerts = [fakeElement('Nothing to compact (session too small)')];
  const { api, document, listeners, observers } = loadPreload({ currentAlerts });
  listeners.get('DOMContentLoaded')();
  assert.equal(currentAlerts[0].textContent, 'ⓘ 当前会话内容较少，暂时无需压缩');
  assert.equal(observers.length, 1);
  assert.equal(typeof api.translateNode, 'function');
  assert.equal(typeof api.walkAndTranslate, 'function');
  assert.equal(Object.keys(api.ZH_MAP).length > 100, true);
  assert.equal(document.querySelectorAllCalls, 1);
  // 幂等：重复初始化不产生第二个 observer
  listeners.get('DOMContentLoaded')();
  assert.equal(observers.length, 1);
});

// ============ notranslate 尊重 ============

test('skips translation inside .notranslate regions (user data, file trees)', () => {
  const { api } = loadPreload();
  // 文本节点：父元素在 notranslate 容器内
  const container = {
    nodeType: 1,
    closest: (sel) => sel === '.notranslate' ? {} : null,
  };
  const textNode = { nodeType: 3, nodeValue: 'Settings', parentElement: container };
  api.translateNode(textNode);
  assert.equal(textNode.nodeValue, 'Settings');

  // 元素节点：自身在 notranslate 内
  const el = {
    nodeType: 1,
    placeholder: 'Type a message...',
    title: 'Settings',
    closest: (sel) => sel === '.notranslate' ? {} : null,
  };
  api.translateNode(el);
  assert.equal(el.placeholder, 'Type a message...');
  assert.equal(el.title, 'Settings');
});

test('translates normally when closest returns null', () => {
  const { api } = loadPreload();
  const container = {
    nodeType: 1,
    closest: () => null,
  };
  const textNode = { nodeType: 3, nodeValue: 'Send', parentElement: container };
  api.translateNode(textNode);
  assert.equal(textNode.nodeValue, '发送');
});

test('tolerates elements without closest (defensive)', () => {
  const { api } = loadPreload();
  const el = { nodeType: 1, placeholder: 'Search...' };
  api.translateNode(el);
  assert.equal(el.placeholder, '搜索...');
});
