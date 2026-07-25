// piweb-polyfill.js
// 解决 Electron 33 内置 Node v20 缺 worker_threads.markAsUncloneable（Node v24+ API）
// undici 依赖它，缺失导致 "webidl.util.markAsUncloneable is not a function"
const path = require('path');
console.log('[piweb-polyfill] 开始加载');

// 1. 补 worker_threads.markAsUncloneable
try {
  const wt = require('node:worker_threads');
  if (typeof wt.markAsUncloneable !== 'function') {
    wt.markAsUncloneable = function () {};
    console.log('[piweb-polyfill] 补 worker_threads.markAsUncloneable noop');
  }
} catch (e) { console.warn('[piweb-polyfill] wt 失败:', e.message); }

// 2. 用 node_modules/undici 替换 globalThis.fetch（避开 Electron 内置 undici 旧版）
try {
  const undici = require('undici');
  if (undici.fetch) {
    globalThis.fetch = undici.fetch;
    globalThis.Headers = undici.Headers;
    globalThis.Request = undici.Request;
    globalThis.Response = undici.Response;
    globalThis.FormData = undici.FormData;
    if (undici.WebSocket) globalThis.WebSocket = undici.WebSocket;
    console.log('[piweb-polyfill] 替换 globalThis.fetch = node_modules/undici');
  }
} catch (e) { console.warn('[piweb-polyfill] fetch 替换失败:', e.message); }

// 3. 直接改 node_modules/undici 的 webidl.util.markAsUncloneable（强制 noop）
try {
  const pkgPath = require.resolve('undici/package.json');
  const webidlPath = path.join(path.dirname(pkgPath), 'lib', 'web', 'webidl', 'index.js');
  const webidl = require(webidlPath).webidl;
  console.log('[piweb-polyfill] webidl.util.markAsUncloneable 原类型:', typeof webidl.util.markAsUncloneable);
  webidl.util.markAsUncloneable = function () {};
  console.log('[piweb-polyfill] 强制设 webidl.util.markAsUncloneable = noop');
} catch (e) { console.warn('[piweb-polyfill] webidl 改失败:', e.message); }
