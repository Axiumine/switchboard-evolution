import { expect, test } from '@jest/globals';

import {
  VIEWS,
  impactModel,
  indexGaps,
  modulesModel,
  searchResults,
  traceLayout,
  type TraceTree,
} from '@/shared/vendor/knowledge-model';

test('the phone reads the same views, minus the desktop-only Lens', () => {
  const ids = VIEWS.filter((v) => !v.desktopOnly).map((v) => v.id);
  expect(ids).not.toContain('lens');
  expect(ids[0]).toBe('overview');
});

test('search rows come back as symbols with lines', () => {
  const r = searchResults({ cols: ['qn', 'label', 'file', 'lines'], rows: [['shop.api.orders.create', 'Function', 'api/orders.js', '4-9']] });
  expect(r.items[0]).toEqual({ qn: 'shop.api.orders.create', name: 'create', label: 'Function', file: 'api/orders.js', start: 4, end: 9 });
});

test('a trace tree lays out on both sides of its root', () => {
  const tree: TraceTree = { qn: 'r', name: 'r', callers: [{ qn: 'a' }], callees: [{ qn: 'b' }, { qn: 'c' }] };
  const layout = traceLayout(tree, { colWidth: 120, rowHeight: 40 });
  expect(layout.nodes.find((n) => n.qn === 'a')?.x).toBe(-120);
  expect(layout.nodes.find((n) => n.qn === 'c')?.x).toBe(120);
  expect(layout.height).toBe(80);
});

test('impact keeps the edge each symbol was reached by', () => {
  const r = impactModel({ impacted: [{ qn: 'shop.web.cart', hop: 2, via_qn: 'shop.api.orders.create', via_edge: 'HTTP_CALLS' }] });
  expect(r.impacted[0].viaName).toBe('create');
  expect(r.impacted[0].viaEdge).toBe('HTTP_CALLS');
});

test('the phone counts a left-out folder by name and keeps whole counts beside the rows listed', () => {
  const g = indexGaps({
    parse_partial: { files: [{ path: 'db/1.sql', error_ranges: '1-2' }], count: 410 },
    not_indexed: { dirs: ['.claude', 'backend/.claude', 'frontend/.claude'], dirs_count: 3, files: [], files_count: 12 },
  });
  expect(g.counts.partial).toBe(410);
  expect(g.listed.partial).toBe(1);
  expect(g.truncated).toBe(true);
  expect(g.dirsByName).toEqual([{ name: '.claude', count: 3, where: ['.', 'backend', 'frontend'] }]);
  expect(modulesModel({ modules: [{ path: '/w/a/x', rel: 'x', kind: 'submodule', state: 'out' }] }).modules[0].state).toBe('out');
});
