// project-knowledge-analysis.js: the arguments Impact sends, and results as
// markup with hostile names kept as text. Runs in a vm context with the tab's
// other files, the shared KnowledgeModel and escapeAttr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const utils = read('utils.js');
const escapeAttrSource = utils.slice(utils.indexOf('function escapeAttr('), utils.indexOf('\n}\n', utils.indexOf('function escapeAttr(')) + 3);

function load(windowStub = {}) {
  const context = vm.createContext({
    KnowledgeModel: require('../public/knowledge-model'),
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    PICONS: new Proxy({}, { get: (_t, name) => () => `<i:${String(name)}>` }),
    pathBasename: (p) => String(p).split('/').filter(Boolean).pop() || p,
    window: windowStub,
    console,
  });
  vm.runInContext(`${escapeAttrSource}\n${read('project-knowledge-view.js')}\n${read('project-knowledge-explore.js')}\n${read('project-knowledge-analysis.js')}
    this.api = { knImpactArgs, knImpactResultHtml, knQueryResultHtml, knMarkdownHtml, knCompareListHtml, knViewRenderers };`, context);
  return context.api;
}

test('the analysis views register with the tab', () => {
  const api = load();
  for (const view of ['impact', 'query', 'adr', 'coverage', 'compare']) assert.equal(typeof api.knViewRenderers[view], 'function', view);
});

test('Impact compares uncommitted work with HEAD, a branch with its base, or since a ref', () => {
  const api = load();
  const base = { scope: 'impact', depth: 2, fixpoint: false, ref: '' };
  assert.equal(api.knImpactArgs({ ...base, against: 'uncommitted' }).since, 'HEAD');
  const branch = api.knImpactArgs({ ...base, against: 'branch', ref: ' main ' });
  assert.equal(branch.base_branch, 'main');
  assert.equal(branch.since, undefined);
  assert.equal(api.knImpactArgs({ ...base, against: 'branch', ref: '' }).base_branch, undefined, 'empty: CBM picks the base');
  assert.equal(api.knImpactArgs({ ...base, against: 'since', ref: 'v1.2.0' }).since, 'v1.2.0');
  const deep = api.knImpactArgs({ ...base, against: 'uncommitted', depth: 99, fixpoint: true }, 'cur1');
  assert.equal(deep.depth, 8);
  assert.equal(deep.fixpoint, true);
  assert.equal(deep.impact_cursor, 'cur1');
  assert.equal(deep.via, true);
});

test('results keep hostile names as text', () => {
  const api = load();
  const impact = api.knImpactResultHtml({ result: {
    changedFiles: ['"><img src=x>'], changedTotal: 1, seeds: 1, impactedTotal: 1, base: 'main', modules: [{ module: '<b>m</b>', count: 1 }],
    impacted: [{ qn: 'x."><svg>', name: '<svg onload=1>', label: 'Function', file: 'a.js', hop: 1, viaName: '<i>v</i>', viaEdge: 'CALLS' }],
  } });
  assert.doesNotMatch(impact, /<img|<svg|<b>m|<i>v/);
  const query = api.knQueryResultHtml({ result: { columns: ['<th>'], rows: [['"><script>']], total: 1, hasMore: false, truncated: false } });
  assert.doesNotMatch(query, /<script>|<th><th>/);
  assert.match(query, /<th>&lt;th&gt;<\/th>/);
  const compare = api.knCompareListHtml('Only in <x>', [{ name: '<b>', label: 'Function', file: '"><i>' }], 'nodes');
  assert.doesNotMatch(compare, /<b>|<i>|Only in <x>/);
});

test('ADR Markdown goes through DOMPurify, and is plain text without it', () => {
  const plain = load({});
  assert.equal(plain.knMarkdownHtml('<img src=x onerror=1>'), '<pre>&lt;img src=x onerror=1&gt;</pre>');
  const sanitized = load({ marked: { parse: (t) => `<p>${t}</p>` }, DOMPurify: { sanitize: (h) => h.replace(/ onerror=[^ >]+/g, '') } });
  assert.equal(sanitized.knMarkdownHtml('<img src=x onerror=1>'), '<p><img src=x></p>');
});
