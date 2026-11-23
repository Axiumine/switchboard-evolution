// project-knowledge-lens.js and project-knowledge-settings.js: the Lens view
// registers with the tab, and CBM's settings become the right controls with
// their values escaped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const utils = read('utils.js');
const escapeAttrSource = utils.slice(utils.indexOf('function escapeAttr('), utils.indexOf('\n}\n', utils.indexOf('function escapeAttr(')) + 3);

function load() {
  const context = vm.createContext({
    KnowledgeModel: require('../public/knowledge-model'),
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    PICONS: new Proxy({}, { get: (_t, name) => () => `<i:${String(name)}>` }),
    pathBasename: (p) => String(p).split('/').filter(Boolean).pop() || p,
    window: {},
    console,
  });
  vm.runInContext(`${escapeAttrSource}\n${read('project-knowledge-view.js')}\n${read('project-knowledge-lens.js')}\n${read('project-knowledge-settings.js')}
    this.api = { knViewRenderers, knConfigControl, KN_CONFIG_FIELDS, KN_LENS_PARTITION, knLensRecolor, KN_LENS_CSS };`, context);
  return context.api;
}

test('the Lens view registers, in the session main allows for it', () => {
  const api = load();
  assert.equal(typeof api.knViewRenderers.lens, 'function');
  assert.equal(api.KN_LENS_PARTITION, require('../web-page').LENS_PARTITION);
});

test('CBM settings become a switch, a list or a field, with the value escaped', () => {
  const api = load();
  const keys = { auto_watch: 'bool', doc_candidates: ['auto', 'true', 'false'], index_max_files: 'limit', ui_port: 'port' };
  assert.match(api.knConfigControl({ key: 'auto_watch' }, 'true', keys), /type="checkbox"[^>]* checked/);
  assert.doesNotMatch(api.knConfigControl({ key: 'auto_watch' }, 'false', keys), /checked/);
  assert.match(api.knConfigControl({ key: 'doc_candidates' }, 'false', keys), /<option value="false" selected>/);
  const limit = api.knConfigControl({ key: 'index_max_files' }, undefined, keys);
  assert.match(limit, /placeholder="off"/, 'a limit CBM does not list is off');
  assert.doesNotMatch(api.knConfigControl({ key: 'ui_port' }, '"><b>', keys), /<b>/);
  for (const field of api.KN_CONFIG_FIELDS) assert.ok(field.label && field.help, field.key);
});


/** A rule as the CSSOM gives it: indexed property names, values and priorities. */
function fakeRule(decls) {
  const map = new Map(Object.entries(decls).map(([k, v]) => [k, { value: v, priority: '' }]));
  const style = {
    get length() { return map.size; },
    getPropertyValue: (p) => map.get(p)?.value ?? '',
    getPropertyPriority: (p) => map.get(p)?.priority ?? '',
    setProperty: (p, v, prio) => map.set(p, { value: v, priority: prio || '' }),
  };
  [...map.keys()].forEach((k, i) => { style[i] = k; });
  return { style, read: (p) => map.get(p)?.value };
}

/** The Lens's recolouring, as in its page, over a few rules: call it with an accent, as often as wanted. */
function lensPage(rules) {
  const api = load();
  const page = vm.createContext({ document: { styleSheets: [{ cssRules: rules }], head: null }, window: {}, Array, Math, Number, Map, parseInt, setTimeout });
  page.window.__sbLensRecolor = vm.runInContext(`(${api.knLensRecolor.toString()})`, page);
  return (accent) => page.window.__sbLensRecolor(accent);
}
const recolorIn = (rules, accent) => lensPage(rules)(accent);

test('the Lens takes the accent: its variables and bright greens the colour itself, other greens its hue', () => {
  const root = fakeRule({ '--atlas-phosphor': '#33ff99', '--atlas-phosphor-mute': '#1f7f4c', '--atlas-line': '#243a30', '--atlas-alarm': '#ff5f8f', '--atlas-fg': '#dce8e1' });
  const tab = fakeRule({ color: 'rgb(101, 237, 176)', 'border-top-color': 'rgba(101, 237, 176, 0.18)' });
  const pin = fakeRule({ 'background-color': 'rgb(17, 45, 34)' });
  const grey = fakeRule({ color: 'rgb(200, 200, 200)' });
  assert.ok(recolorIn([root, tab, pin, grey], '#f06464') > 0);
  assert.equal(root.read('--atlas-phosphor'), '#f06464');
  assert.equal(root.read('--atlas-phosphor-mute'), 'color-mix(in srgb, #f06464 50%, black)');
  assert.equal(root.read('--atlas-alarm'), '#ff5f8f', 'not a green: left as it is');
  assert.equal(tab.read('color'), 'rgb(240, 100, 100)');
  assert.equal(tab.read('border-top-color'), 'rgba(240, 100, 100, 0.18)');
  // A dark green keeps its darkness, in the accent's hue (red).
  const [r, g, b] = pin.read('background-color').match(/\d+/g).map(Number);
  assert.ok(r > g && r > b && r < 80, pin.read('background-color'));
  assert.equal(grey.read('color'), 'rgb(200, 200, 200)');
  const line = root.read('--atlas-line').match(/\d+/g).map(Number);
  assert.ok(line[2] > line[0] && line[2] > line[1] && line[2] < 80, `the greenish line turns a cool grey, as the app's: ${root.read('--atlas-line')}`);
});

test('another accent starts again from the Lens\'s own colours', () => {
  const tab = fakeRule({ color: '#65edb0' });
  const dark = fakeRule({ 'background-color': 'rgb(17, 45, 34)' });
  const recolor = lensPage([tab, dark]);
  recolor('#f06464');
  assert.equal(tab.read('color'), 'rgb(240, 100, 100)');
  const redDark = dark.read('background-color');
  recolor('#5b9dff');
  assert.equal(tab.read('color'), 'rgb(91, 157, 255)');
  const [r, g, b] = dark.read('background-color').match(/\d+/g).map(Number);
  assert.ok(b > r && b > g, `from the Lens's green, not from the red: ${dark.read('background-color')} (was ${redDark})`);
  recolor('#f06464');
  assert.equal(dark.read('background-color'), redDark, 'the same accent gives the same colour');
});

test('the Lens\'s title reads LENS, drawn over its own text', () => {
  const api = load();
  assert.match(api.KN_LENS_CSS, /\.atlas-brand \{ font-size: 0/);
  assert.match(api.KN_LENS_CSS, /content: 'LENS'/);
});
