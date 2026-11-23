// The toolbar of a pull request's page inside the app (public/web-page-view.js):
// the file only defines functions at top level, so its pure parts load in node.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const view = require('../public/web-page-view');

const acts = html => [...html.matchAll(/data-act="([a-z-]+)"/g)].map(m => m[1]);

test('in the panel: the title, the navigation, the address, then Copy, Open in a window, Open in the browser and Close', () => {
  const html = view.webPageToolbarHtml({ url: 'https://github.com/acme/widgets/pull/4', title: '#4 Add <filters>' });
  assert.deepEqual(acts(html), ['back', 'forward', 'reload', 'copy', 'window', 'browser', 'close']);
  assert.match(html, /<span class="web-page-title" title="#4 Add &lt;filters&gt;">#4 Add &lt;filters&gt;<\/span>/);
  assert.match(html, /value="https:\/\/github\.com\/acme\/widgets\/pull\/4"/);
  // Back and Forward wait for a page to go back to.
  assert.match(html, /data-act="back" title="Back" aria-label="Back" disabled/);
  assert.match(html, /data-act="forward" title="Forward" aria-label="Forward" disabled/);
  assert.doesNotMatch(html, /tool-window-pin/);
});

test('in a window: the pin first, and neither Open in a window nor Close', () => {
  const html = view.webPageToolbarHtml({ url: 'https://github.com/acme/widgets/pull/4', title: '#4', inWindow: true });
  assert.deepEqual(acts(html), ['back', 'forward', 'reload', 'copy', 'browser']);
  assert.match(html, /id="tool-window-pin"/);
  assert.doesNotMatch(html, /web-page-title/);
});

test('the address is escaped in its attribute', () => {
  const html = view.webPageToolbarHtml({ url: 'https://github.com/a"b?x=<y>&z=1' });
  assert.match(html, /value="https:\/\/github\.com\/a&quot;b\?x=&lt;y&gt;&amp;z=1"/);
});

test('only https shows inside the app, as main allows', () => {
  assert.equal(view.webPageCanShow('https://github.com/acme/widgets/pull/4'), true);
  for (const url of ['http://github.com/', 'javascript:alert(1)', 'file:///etc/hosts', '', null, `https://github.com/${'a'.repeat(2048)}`]) {
    assert.equal(view.webPageCanShow(url), false, String(url).slice(0, 30));
  }
});

test('a page that did not open says why, with Try again and Open in the browser', () => {
  const html = view.webPageErrorHtml('ERR_NAME_NOT_RESOLVED');
  assert.match(html, /The page did not open: ERR_NAME_NOT_RESOLVED\./);
  assert.deepEqual(acts(html), ['retry', 'error-browser']);
  assert.match(view.webPageErrorHtml(''), /The page did not open\./);
});
