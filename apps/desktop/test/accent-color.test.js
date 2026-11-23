const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '../public');
const source = fs.readFileSync(path.join(PUBLIC, 'accent.js'), 'utf8');

/** accent.js in a window of its own, with a localStorage shared by the windows of one test. */
function openWindow(storage = new Map()) {
  const props = new Map();
  const listeners = {};
  const window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = vm.createContext({
    window,
    document: { documentElement: { style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
  });
  vm.runInContext(source, context);
  return { api: window.AccentColor, props, storage, fire: (key, newValue) => listeners.storage?.({ key, newValue }) };
}

test('only #rrggbb colours are taken; anything else is the default', () => {
  const { api } = openWindow();
  assert.equal(api.normalize('#12AB34'), '#12ab34');
  for (const bad of [null, '', 'red', '#123', '#12345g', 'url(x)', '#123456; color: red']) assert.equal(api.normalize(bad), api.DEFAULT, String(bad));
});

test('a colour is painted at once, kept for the next windows, and the default clears both', () => {
  const storage = new Map();
  const first = openWindow(storage);
  assert.equal(first.props.size, 0, 'the stylesheet default until one is chosen');
  first.api.apply('#2fc4b2');
  assert.equal(first.props.get('--accent'), '#2fc4b2');
  const second = openWindow(storage);
  assert.equal(second.props.get('--accent'), '#2fc4b2', 'a window opened later starts with it');
  first.api.apply(first.api.DEFAULT);
  assert.equal(first.props.has('--accent'), false);
  assert.equal(storage.size, 0);
});

test('a change in another window reaches this one', () => {
  const { props, fire } = openWindow();
  fire('switchboard-e.accentColor', '#f06464');
  assert.equal(props.get('--accent'), '#f06464');
  fire('something-else', '#000000');
  assert.equal(props.get('--accent'), '#f06464');
  fire('switchboard-e.accentColor', null);
  assert.equal(props.has('--accent'), false);
});

test('at start the saved setting wins over the copy', () => {
  const storage = new Map([['switchboard-e.accentColor', '#5b9dff']]);
  const w = openWindow(storage);
  assert.equal(w.api.sync({ accentColor: '#e8b23a' }), '#e8b23a');
  assert.equal(w.props.get('--accent'), '#e8b23a');
  assert.equal(storage.get('switchboard-e.accentColor'), '#e8b23a');
  w.api.sync({});
  assert.equal(w.props.has('--accent'), false);
});

test('the presets are valid and the default is one of them', () => {
  const { api } = openWindow();
  assert.ok(api.PRESETS.some(p => p.color === api.DEFAULT));
  for (const p of api.PRESETS) assert.equal(api.normalize(p.color), p.color);
});

test('every page loads accent.js in its head, after the stylesheets', () => {
  for (const page of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    if (!html.includes('href="style.css"')) continue;
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script src="accent\.js"><\/script>/, page);
    assert.ok(head.indexOf('accent.js') > head.lastIndexOf('rel="stylesheet"'), page);
  }
});

test('the stylesheets draw the accent from --accent, not from its old values', () => {
  const old = /#8088ff|#a6abff|rgba?\(\s*(120\s*,\s*130|122\s*,\s*132|128\s*,\s*136)\s*,\s*255\b/gi;
  for (const file of ['style.css', 'git-graph.css', 'pull-requests.css', 'whats-new.css', 'web-page.css']) {
    const css = fs.readFileSync(path.join(PUBLIC, file), 'utf8').replace(/:root\s*\{[^}]*\}/, '');
    const left = css.match(old) || [];
    assert.deepEqual(left, [], `${file}: use var(--accent) (see the top of style.css)`);
  }
  assert.match(fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8'), /:root \{ --accent: #8088ff; \}/);
});
