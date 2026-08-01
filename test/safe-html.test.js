const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../electron/safe-html');

test('error text cannot inject markup', () => {
  assert.equal(
    escapeHtml('<img src=x onerror=alert(1)> & "bad"'),
    '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;bad&quot;',
  );
});

test('single quotes are escaped', () => {
  assert.equal(escapeHtml("hello 'world'"), 'hello &#39;world&#39;');
});
