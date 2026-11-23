// knowledge-model.js (packages/shared): CBM 0.12 answers as the Node
// Knowledge tab shows them. The fixtures have the shapes of real answers with
// made-up names.
const test = require('node:test');
const assert = require('node:assert/strict');
const KM = require('../public/knowledge-model');

test('short names drop the qualified path and the quotes around dashed names', () => {
  assert.equal(KM.shortName('shop.api.orders.createOrder'), 'createOrder');
  assert.equal(KM.shortName("shop.api.main.'place-order'"), 'place-order');
  assert.equal(KM.shortName("shop.api.main.'a.b'"), 'a.b');
  assert.equal(KM.shortName('solo'), 'solo');
  assert.equal(KM.shortName(null), '');
});

test('line ranges', () => {
  assert.deepEqual(KM.parseLines('12-40'), { start: 12, end: 40 });
  assert.deepEqual(KM.parseLines('7'), { start: 7, end: 7 });
  assert.deepEqual(KM.parseLines(9), { start: 9, end: 9 });
  assert.equal(KM.parseLines('x'), null);
});

test('tables: plain rows, grouped rows with qn and file from the group, query columns', () => {
  assert.deepEqual(KM.tableRows({ cols: ['qn', 'label'], rows: [['shop.a.f', 'Function']] }), [{ qn: 'shop.a.f', label: 'Function' }]);
  assert.deepEqual(KM.tableRows({
    cols: ['name', 'label', 'lines'],
    groups: [{ qn_prefix: 'shop.api.orders', file: 'api/orders.js', rows: [['createOrder', 'Function', '3-9']] }, { qn_prefix: '', rows: [['top', 'Module', '1-1']] }],
  }), [
    { name: 'createOrder', label: 'Function', lines: '3-9', qn: 'shop.api.orders.createOrder', file: 'api/orders.js' },
    { name: 'top', label: 'Module', lines: '1-1', qn: 'top' },
  ]);
  assert.deepEqual(KM.tableRows({ columns: ['f.name'], rows: [['x']] }), [{ 'f.name': 'x' }]);
  assert.deepEqual(KM.tableRows(null), []);
});

test('search results: BM25 rows, semantic rows and paging', () => {
  const r = KM.searchResults({
    cols: ['qn', 'label', 'file', 'lines', 'rank'],
    rows: [["shop.api.main.'place-order'", 'Function', 'api/main.js', '20-31', -21.5]],
    total: 7, has_more: true, next_offset: 1, search_mode: 'bm25',
    semantic: { cols: ['qn', 'label', 'file', 'lines'], rows: [['shop.web.cart.checkout', 'Function', 'web/cart.ts', '5-12']] },
    semantic_total: 3, semantic_has_more: false,
  });
  assert.deepEqual(r.items[0], { qn: "shop.api.main.'place-order'", name: 'place-order', label: 'Function', file: 'api/main.js', start: 20, end: 31, rank: -21.5 });
  assert.equal(r.total, 7);
  assert.equal(r.hasMore, true);
  assert.equal(r.nextOffset, 1);
  assert.equal(r.semantic[0].name, 'checkout');
  assert.equal(r.semanticTotal, 3);
});

test('code search: symbols with their match lines, plain matches and folders', () => {
  const r = KM.codeResults({
    cols: ['qn', 'label', 'file', 'lines', 'matches', 'matches_omitted', 'in', 'out'],
    rows: [['shop.api.pay.charge', 'Function', 'api/pay.js', '10-30', [12, 18], 0, 2, 3]],
    raw_matches: { cols: ['file', 'line', 'content'], rows: [['README.md', 4, 'charge the card']] },
    directories: { 'api/': 2, 'README.md': 1 },
    total_results: 1, total_grep_matches: 3, has_more: false,
  });
  assert.deepEqual(r.items[0].matches, [12, 18]);
  assert.deepEqual(r.raw, [{ file: 'README.md', line: 4, content: 'charge the card' }]);
  assert.deepEqual(r.directories, [{ path: 'api/', count: 2 }, { path: 'README.md', count: 1 }]);
  assert.equal(r.matches, 3);
});

test('an ambiguous name gives its suggestions', () => {
  assert.equal(KM.ambiguity({ function: 'x' }), null);
  const a = KM.ambiguity({ status: 'ambiguous', message: '3 matches for "emit".', suggestions: [{ qualified_name: 'shop.api.bus.emit', name: 'emit', label: 'Function', file_path: 'api/bus.js' }] });
  assert.equal(a.message, '3 matches for "emit".');
  assert.deepEqual(a.suggestions[0], { qn: 'shop.api.bus.emit', name: 'emit', label: 'Function', file: 'api/bus.js', start: null, end: null });
});

test('snippet and outline', () => {
  const s = KM.snippetModel({ name: 'charge', qualified_name: 'shop.api.pay.charge', label: 'Function', file_path: '/repo/api/pay.js', start_line: 10, end_line: 30, source: 'function charge() {}', callers: 1, callees: 2, callee_names: ['round', 'send'] });
  assert.equal(s.start, 10);
  assert.equal(s.end, 30);
  assert.equal(s.file, '/repo/api/pay.js');
  assert.deepEqual(s.calleeNames, ['round', 'send']);
  const o = KM.outlineModel({ file_path: 'api/pay.js', cols: ['name', 'label', 'lines', 'qn'], rows: [['charge', 'Function', '10-30', 'shop.api.pay.charge']], total: 12, offset: 0, returned: 1, has_more: true });
  assert.equal(o.items[0].qn, 'shop.api.pay.charge');
  assert.equal(o.nextOffset, 1);
});

test('trace sides come sorted by hop, with risk levels', () => {
  const t = KM.traceSides({
    function: 'charge',
    callers: { cols: ['name', 'hop', 'risk'], groups: [{ qn_prefix: 'shop.api', rows: [['main', 2, 'HIGH'], ['checkout', 1, 'CRITICAL']] }] },
    callees: { cols: ['name', 'hop', 'risk'], groups: [{ qn_prefix: 'shop.api.pay', rows: [['round', 1, 'odd']] }] },
    callers_total: 2, callees_total: 1,
  });
  assert.deepEqual(t.callers.map(c => [c.name, c.hop, c.risk]), [['checkout', 1, 'CRITICAL'], ['main', 2, 'HIGH']]);
  assert.equal(t.callees[0].risk, null, 'an unknown level is none');
  assert.equal(t.callersTotal, 2);
  assert.equal(KM.riskColor('critical'), KM.RISK_COLORS.CRITICAL);
  assert.equal(KM.riskColor(null), KM.RISK_COLORS.NONE);
});

test('trace layout: callers left, callees right, parents centred on their children, edges along the calls', () => {
  const tree = {
    qn: 'shop.api.pay.charge', name: 'charge',
    callers: [{ qn: 'shop.api.checkout', name: 'checkout', children: [{ qn: 'shop.api.main', name: 'main' }, { qn: 'shop.api.retry', name: 'retry' }] }],
    callees: [{ qn: 'shop.api.round', name: 'round' }, { qn: 'shop.api.send', name: 'send' }, { qn: 'shop.api.log', name: 'log' }],
  };
  const L = KM.traceLayout(tree, { colWidth: 100, rowHeight: 10 });
  const at = (name) => L.nodes.find(n => n.name === name);
  assert.equal(at('charge').x, 0);
  assert.equal(at('checkout').x, -100);
  assert.equal(at('main').x, -200);
  assert.equal(at('round').x, 100);
  assert.equal(at('checkout').y, (at('main').y + at('retry').y) / 2);
  assert.equal(at('charge').y, 10, 'the root sits in the middle of three rows');
  assert.equal(at('send').y, 10);
  assert.equal(L.height, 30);
  assert.equal(L.width, 400);
  const edge = (a, b) => L.edges.some(e => e.from === at(a).id && e.to === at(b).id);
  assert.ok(edge('checkout', 'charge'), 'a caller points at what it calls');
  assert.ok(edge('main', 'checkout'));
  assert.ok(edge('charge', 'round'), 'the root points at its callees');
  assert.equal(at('checkout').expandable, false, 'opened');
  assert.equal(at('main').expandable, true);
  assert.deepEqual(KM.traceLayout(null), { nodes: [], edges: [], width: 0, height: 0, minX: 0, maxX: 0 });
});

test('expandTrace opens one node by its id, leaving the tree it came from as it was', () => {
  const tree = { qn: 'r', callees: [{ qn: 'a' }, { qn: 'b' }], callers: [] };
  const first = KM.expandTrace(tree, 'e/a', [{ qn: 'a1', name: 'a1', risk: 'LOW' }]);
  assert.deepEqual(first.callees[0].children, [{ qn: 'a1', name: 'a1', label: undefined, risk: 'LOW' }]);
  assert.equal(tree.callees[0].children, undefined);
  const second = KM.expandTrace(first, 'e/a/a1', [{ qn: 'a2' }]);
  assert.equal(second.callees[0].children[0].children[0].qn, 'a2');
  assert.equal(KM.expandTrace(tree, 'e/missing', []), tree);
  const L = KM.traceLayout(second);
  assert.ok(L.nodes.some(n => n.id === 'e/a/a1/a2' && n.depth === 3));
});

test('impact of a change', () => {
  const r = KM.impactModel({
    base: 'main', merge_base: 'abc', changed_total: 4, changed_has_more: true, changed_next_cursor: 'c1',
    changed_files: ['api/pay.js', 'api/cart.js'], seed_symbols: 12, impacted_total: 30, impacted_has_more: true, impacted_next_cursor: 'i1',
    impacted: [{ qn: 'shop.api.checkout', label: 'Function', file: 'api/checkout.js', hop: 1, via_qn: 'shop.api.pay.charge', via_edge: 'CALLS' }],
    impacted_modules: [{ module: 'api', count: 30 }], truncated: true,
  });
  assert.equal(r.changedCursor, 'c1');
  assert.equal(r.impacted[0].viaName, 'charge');
  assert.equal(r.impacted[0].hop, 1);
  assert.deepEqual(r.modules, [{ module: 'api', count: 30 }]);
  const tests = KM.testImpactModel({ test_impact: { decision: 'nothing', experimental: true, totals: { tests: 0, suites: 0 }, warnings: [], run_all_reasons: [] } });
  assert.equal(tests.decision, 'nothing');
  assert.equal(tests.experimental, true);
});

test('architecture sections in a fixed order, cycles apart', () => {
  const a = KM.architectureModel({
    total_nodes: 100, total_edges: 300,
    hotspots: { cols: ['qn', 'fan_in'], rows: [['shop.util.escape', 40]] },
    languages: { cols: ['language', 'files'], rows: [['JavaScript', 30]] },
    cycles: [{ size: 2, members: ['shop.a.x', 'shop.a.y'] }], cycles_total: 1,
  });
  assert.deepEqual(a.sections.map(s => s.id), ['languages', 'hotspots']);
  assert.deepEqual(a.sections[1].rows, [{ qn: 'shop.util.escape', fan_in: 40 }]);
  assert.equal(a.cycles[0].size, 2);
});

test('schema, index status and coverage', () => {
  assert.deepEqual(KM.schemaModel({ node_labels: [{ label: 'Function', count: 9 }], edge_types: [{ type: 'CALLS', count: 4 }], adr_present: true }),
    { labels: [{ label: 'Function', count: 9 }], edges: [{ type: 'CALLS', count: 4 }], adr: true });
  const s = KM.indexSummary({
    status: 'ready', nodes: 10, edges: 20, indexed_at: '2026-01-02T03:04:05Z',
    cross_repo: { status: 'ran', targets: ['web'], total_cross_edges: 5, last_run_at: '2026-01-02T03:05:00Z', outcome: 'complete' },
    parse_partial: { count: 2 }, not_indexed: { files_count: 7, dirs_count: 1 },
  });
  assert.deepEqual(s.crossRepo, { status: 'ran', lastRunAt: '2026-01-02T03:05:00Z', targets: ['web'], edges: 5, outcome: 'complete' });
  assert.deepEqual(s.gaps, { partial: 2, unusable: 0, skipped: 0, files: 7, dirs: 1 });
  assert.equal(KM.indexSummary({}).crossRepo.status, 'never_run');
  const c = KM.coverageModel({ signal: 'best_effort', paths: [{ path: 'gen/out.ts', status: 'excluded', freshness: 'not_tracked', recommended_action: 'read_source_and_reindex', coverage: [{ path: 'gen/out.ts', kind: 'not_indexed_file', detail: 'gitignore' }] }] });
  assert.equal(c.paths[0].action, 'read_source_and_reindex');
  assert.equal(c.paths[0].details[0].detail, 'gitignore');
});

test('query tables and cells', () => {
  const q = KM.queryTable({ columns: ['f.name', 'n'], rows: [['main', 3], ['x', { a: 1 }]], total: 2, has_more: false });
  assert.deepEqual(q.columns, ['f.name', 'n']);
  assert.equal(KM.cellText(q.rows[1][1]), '{"a":1}');
  assert.equal(KM.cellText(null), '');
});

test('ADR outline and its byte limit', () => {
  const o = KM.adrOutline({ headings: [{ heading: '# Decisions', level: 1, start_line: 1, end_line: 2 }, { heading: '## Context', level: 2, start_line: 3, end_line: 5 }], total_lines: 5, full_content_available: true });
  assert.deepEqual(o.headings.map(h => [h.level, h.title]), [[1, 'Decisions'], [2, 'Context']]);
  assert.equal(o.empty, false);
  assert.equal(KM.adrOutline({ headings: [], full_content_available: false }).empty, true);
  assert.equal(KM.utf8Bytes('aé€😀'), 1 + 2 + 3 + 4);
});

test('compare: project names are taken off, what both sides have is dropped, partial when cut short', () => {
  const node = (qn, label, file) => ({ qualified_name: qn, label, file_path: file });
  const c = KM.compareModel({
    base: { project: 'shop-main', node_count: 5, edge_count: 4 },
    target: { project: 'shop-feature', node_count: 6, edge_count: 5 },
    nodes: {
      added: { items: [node('shop-feature', 'Project', '{}'), node('shop-feature.api.pay.charge', 'Function', 'api/pay.js'), node('shop-feature.api.pay.refund', 'Function', 'api/pay.js')], truncated: false },
      removed: { items: [node('shop-main', 'Project', '{}'), node('shop-main.api.pay.charge', 'Function', 'api/pay.js'), node('shop-main.api.pay.legacy', 'Function', 'api/pay.js')], truncated: true },
    },
    edges: {
      added: { items: [{ source: node('shop-feature.api.pay.charge'), target: node('shop-feature.api.pay.refund'), type: 'CALLS' }] },
      removed: { items: [{ source: node('shop-main.api.pay.charge'), target: node('shop-main.api.pay.legacy'), type: 'CALLS' }] },
    },
  });
  assert.deepEqual(c.addedNodes.map(n => n.name), ['refund']);
  assert.deepEqual(c.removedNodes.map(n => n.name), ['legacy']);
  assert.deepEqual(c.addedEdges, [{ type: 'CALLS', from: 'charge', to: 'refund', fromFile: null }]);
  assert.deepEqual(c.removedEdges.map(e => e.to), ['legacy']);
  assert.equal(c.partial, true);
  assert.equal(c.base.project, 'shop-main');
});

test('jobs and times', () => {
  assert.equal(KM.jobText({ state: 'running' }), 'Indexing…');
  assert.equal(KM.jobText({ state: 'running', kind: 'refresh' }), 'Refreshing…');
  assert.equal(KM.jobText({ state: 'failed', error: 'disk full' }), 'Indexing failed: disk full');
  assert.equal(KM.jobActive({ state: 'queued' }), true);
  assert.equal(KM.jobActive({ state: 'succeeded' }), false);
  const now = Date.parse('2026-01-02T03:10:00Z');
  assert.equal(KM.ago('2026-01-02T03:05:00Z', now), '5 min ago');
  assert.equal(KM.ago('2026-01-01T03:10:00Z', now), '1 d ago');
  assert.equal(KM.ago('nope', now), '');
});

test('the views list marks the Lens as desktop only', () => {
  assert.equal(KM.VIEWS.find(v => v.id === 'lens').desktopOnly, true);
  assert.ok(KM.VIEWS.filter(v => !v.desktopOnly).every(v => v.id !== 'lens'));
  assert.ok(KM.CYPHER_EXAMPLES.length >= 5);
});
