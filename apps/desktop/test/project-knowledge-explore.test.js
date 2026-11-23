// project-knowledge-explore.js: the trace's arguments, the graph and the
// source as markup, with hostile names kept as text. Runs in a vm context with
// project-knowledge-view.js, the shared KnowledgeModel and escapeAttr.
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
  vm.runInContext(`${escapeAttrSource}\n${read('project-knowledge-view.js')}\n${read('project-knowledge-explore.js')}\nthis.api = { knTraceArgs, knTraceGraphHtml, knSourceHtml, knSymbolRowHtml, knNamesHtml, knViewRenderers };`, context);
  return context.api;
}

test('the explore views register with the tab', () => {
  const api = load();
  assert.equal(typeof api.knViewRenderers.search, 'function');
  assert.equal(typeof api.knViewRenderers.trace, 'function');
});

test('trace arguments: risk labels always, the mode only when not calls, tests when asked', () => {
  const api = load();
  assert.deepEqual(JSON.parse(JSON.stringify(api.knTraceArgs({ mode: 'calls', tests: false }, 'shop.api.charge', 1, 'both'))),
    { function_name: 'shop.api.charge', direction: 'both', depth: 1, limit: 200, risk_labels: true });
  const args = api.knTraceArgs({ mode: 'data_flow', tests: true }, 'charge', 3, 'outbound');
  assert.equal(args.mode, 'data_flow');
  assert.equal(args.include_tests, true);
});

test('the graph keeps hostile names as text and marks the risk on each node', () => {
  const api = load();
  const html = api.knTraceGraphHtml({
    tree: { qn: 'r', name: '<img src=x onerror=1>', callees: [{ qn: 'shop."><svg onload=1>', name: '"><svg onload=1>', risk: 'CRITICAL' }] },
    selected: null,
  });
  assert.doesNotMatch(html, /<img|<svg onload/);
  assert.match(html, /--kn-risk:#e05070/);
  assert.match(html, /class="kn-node kn-node--root"/);
  assert.match(html, /kn-node-more/, 'an unopened node offers its next step');
  assert.match(html, /<path d="M/, 'one edge from the root to its callee');
});

test('source lines are numbered from the symbol\'s first line, and escaped', () => {
  const api = load();
  const html = api.knSourceHtml('function a() {\n  return "<b>";\n}\n', 10, 10);
  assert.match(html, /kn-src-no">10</);
  assert.match(html, /kn-src-no">12</);
  assert.match(html, /kn-src-line--mark/);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('result rows and neighbour names escape what CBM returns', () => {
  const api = load();
  const row = api.knSymbolRowHtml({ qn: 'x."><b>', name: '<b>bold</b>', label: 'Function', file: 'a"b.js', start: 3 }, 0);
  assert.doesNotMatch(row, /<b>/);
  assert.match(row, /a"b\.js:3/, 'quotes in text content are harmless');
  assert.doesNotMatch(row, /title="x\."><b>/);
  const names = api.knNamesHtml(['cbm-locator.test.js', '"><i>'], 'in');
  assert.match(names, />cbm-locator\.test\.js</, 'module names keep their dots');
  assert.doesNotMatch(names, /<i>/);
});
