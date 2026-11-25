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
    this.api = { knImpactArgs, knImpactResultHtml, knQueryResultHtml, knMarkdownHtml, knCompareListHtml, knViewRenderers, knState };`, context);
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

// A view element for a renderer: the markup it draws, and the controls it wires (none clicked here).
function fakeView() {
  const stub = () => ({ value: '', addEventListener() {}, set onclick(_) {}, set onsubmit(_) {} });
  return { innerHTML: '', isConnected: true, querySelector: () => stub(), querySelectorAll: () => [] };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

test('Coverage asks for every row, gives whole counts, counts a left-out folder by name, and lists the repositories inside', async () => {
  const asked = [];
  const dirs = ['.claude', 'backend/.claude', 'frontend/.claude', 'frontend/src/.claude', '.git'];
  const windowStub = { api: {
    knowledgeQuery: async (id, folder, tool, args) => {
      asked.push({ tool, args });
      return {
        parse_partial: { files: [{ path: 'db/1.sql', error_ranges: '3-9' }], count: 410 },
        not_indexed: { dirs, dirs_count: dirs.length, files: [{ path: 'a.png', reason: 'binary' }], files_count: 1345, truncated: true },
      };
    },
    knowledgeModules: async () => ({ modules: [
      { path: '/work/api/libs/auth', rel: 'libs/auth', kind: 'submodule', state: 'in', gaps: 3, graph: 'api' },
      { path: '/work/api/tools/<x>', rel: 'tools/<x>', kind: 'clone', state: 'out', gaps: 0, graph: null },
    ], limited: false }),
  } };
  const api = load(windowStub);
  const project = { id: 'cov', root: '/work/proj', folders: [{ path: '/work/api', mode: 'in-place' }] };
  const view = fakeView();
  // The tab's state: the folder's status with a graph CBM made of a subfolder.
  api.knState(project).status = { folders: [{ path: '/work/api', indexed: true, index: { indexed_at: 't1' }, inner: [{ name: 'work-api-backend', path: '/work/api/backend', rel: 'backend' }] }] };
  api.knViewRenderers.coverage(project, view, '/work/api', {});
  await settle();
  const status = asked.find(a => a.tool === 'index_status');
  assert.equal(status.args.diagnostics, 'full', 'every row, not five samples');
  const html = view.innerHTML;
  assert.match(html, /1 of 410 listed files/, 'the whole count beside the rows listed');
  assert.match(html, /1 of 1,345 listed files · 5 folders/);
  assert.match(html, /<span class="mono">\.claude<\/span><b>4<\/b>/, '.claude counted once by name, in each place');
  assert.match(html, /title="\.claude is left out in 4 places: \(top\), backend, frontend, frontend\/src"/);
  assert.match(html, /not a cut made by Switchboard/);
  assert.match(html, /lists at most 500 rows of each list/);
  assert.match(html, /Repositories inside/);
  assert.match(html, /libs\/auth[\s\S]*in this graph · 3 gaps flagged/);
  assert.match(html, /tools\/&lt;x&gt;[\s\S]*in no graph[\s\S]*data-kn-module-attach="1"/, 'a repository the rules leave out can be attached; its name stays text');
  assert.match(html, /Other graphs inside this folder[\s\S]*backend[\s\S]*data-kn-inner-delete="0"/);
});
