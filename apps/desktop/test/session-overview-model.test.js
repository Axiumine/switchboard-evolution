// The Session Overview model: prefs (with the one-time migration from the old
// Sessions tab choices), period buckets, filters, groups, card order, closed
// card truncation, geometry and the page lifecycle. public/session-overview-model.js
// is pure and is loaded next to session-list.js, which it builds on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
// Objects made inside the vm have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

// Constants declared with const are not properties of a vm context: read them with runInContext.
const lib = vm.createContext({});
vm.runInContext(read('session-list.js'), lib);
vm.runInContext(read('session-overview-model.js'), lib);
const constant = name => plain(vm.runInContext(name, lib));
const fn = name => vm.runInContext(name, lib);

const NOW = new Date(2026, 5, 15, 10, 0).getTime();
const t = (y, m, d, h = 12) => new Date(y, m, d, h, 0).getTime();
const day = 86400000;
const ago = days => NOW - days * day;
const memoryStorage = (initial = {}) => {
  const store = new Map(Object.entries(initial));
  return { store, getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
};

// A session whose last activity was `days` ago; the model reads it through ctx.timeOf.
const s = (id, extra = {}) => ({ sessionId: id, modified: new Date(ago(extra.days ?? 1)).toISOString(), projectPath: '/Users/demo/app', ...extra });
const labelOf = p => p.split('/').filter(Boolean).slice(-1)[0];
const ctxFor = (extra = {}) => ({
  isOpen: () => true,
  isRunning: () => false,
  needsInput: () => false,
  isBusy: () => false,
  isResponseReady: () => false,
  timeOf: x => Date.parse(x.modified),
  folderOf: x => ({ key: x.projectPath, label: labelOf(x.projectPath) }),
  projectOf: x => x.project || null,
  searchIds: null,
  leftOut: new Set(),
  excludeIds: new Set(),
  previousOrder: new Map(),
  resort: false,
  expanded: new Set(),
  visibleCount: 10,
  maxAgeDays: 30,
  now: NOW,
  ...extra,
});
const prefsWith = (extra = {}) => {
  const base = plain(constant('OVERVIEW_DEFAULTS'));
  return { ...base, ...extra, filters: { ...base.filters, ...extra.filters }, sort: { ...base.sort, ...extra.sort },
    group: { ...base.group, ...extra.group }, layout: { ...base.layout, ...extra.layout }, search: { ...base.search, ...extra.search } };
};
const build = (sessions, prefsExtra, ctxExtra) => plain(fn('buildOverview')(sessions, prefsWith(prefsExtra), ctxFor(ctxExtra)));
const cardIds = group => group.cards.map(c => c.id);
const allIds = result => result.groups.flatMap(cardIds);

test('the choices and defaults are the agreed ones', () => {
  const labels = name => constant(name).map(([, label]) => label);
  assert.deepEqual(labels('OVERVIEW_LAYOUTS'), ['Grid (fit)', 'Grid, scroll down', 'Grid, scroll across', 'Rows', 'Columns']);
  assert.deepEqual(constant('OVERVIEW_LAYOUTS').map(([v]) => v), ['grid-fit', 'grid-down', 'grid-across', 'rows', 'columns']);
  assert.deepEqual(labels('OVERVIEW_SORTS'), ['Recent activity', 'Running & pinned first', 'Created', 'Name', 'Status', 'Folder or project']);
  assert.deepEqual(constant('OVERVIEW_SORTS').map(([v]) => v), ['activity', 'priority', 'created', 'name', 'status', 'place']);
  assert.deepEqual(labels('OVERVIEW_GROUPS'), ['None', 'Folder', 'Project', 'CLI', 'Kind', 'Status', 'Period', 'Pinned']);
  assert.deepEqual(constant('OVERVIEW_GROUPS').map(([v]) => v), ['none', 'folder', 'project', 'cli', 'kind', 'status', 'period', 'pinned']);
  assert.deepEqual(labels('OVERVIEW_PERIODS'), ['Any time', 'Today', 'Yesterday', 'Last 3 days', 'Last week', 'Last month']);
  assert.deepEqual(constant('OVERVIEW_PERIODS').map(([v]) => v), ['any', 'today', 'yesterday', '3d', '7d', '30d']);
  assert.deepEqual(labels('OVERVIEW_PERIOD_BUCKETS'), ['Today', 'Yesterday', 'Last 3 days', 'Last week', 'Last month', 'Older']);
  assert.deepEqual(constant('OVERVIEW_PERIOD_BUCKETS').map(([v]) => v), ['today', 'yesterday', '3d', '7d', '30d', 'older']);
  assert.deepEqual(labels('OVERVIEW_STATUS_BUCKETS'), ['Needs input', 'Working', 'Response ready', 'Idle', 'Not running']);
  assert.deepEqual(constant('OVERVIEW_STATUS_BUCKETS').map(([v]) => v), ['attention', 'working', 'ready', 'idle', 'stopped']);
  assert.equal(constant('OVERVIEW_PREFS_KEY'), 'overview.prefs.v1');
  assert.deepEqual(constant('OVERVIEW_CLIS'), ['claude', 'codex', 'opencode', 'terminal']);
  assert.deepEqual(constant('OVERVIEW_LIMITS'), { cols: [1, 8], rows: [1, 6], cardWidth: [320, 1600], cardHeight: [200, 1200], n: [1, 20] });
  assert.deepEqual(plain(constant('OVERVIEW_DEFAULTS')), {
    includeClosed: false, showArchived: false,
    filters: { status: 'all', pinned: 'all', clis: [], period: 'any', place: null },
    sort: { by: 'activity', dir: 'desc' },
    group: { by: 'none', display: 'sections', axis: 'across', fit: false, collapsed: [] },
    layout: { mode: 'grid-fit', cols: 2, rows: 2, cardWidth: 560, cardHeight: 450 },
    search: { inMessages: false, which: 'first', n: 1 }, dock: null,
  });
});

test('prefs migrate once from sessions.* and then live under overview.prefs.v1', () => {
  const storage = memoryStorage({ 'sessions.status': 'attention', 'sessions.order': 'priority', 'sessions.groupByFolders': '1' });
  const migrated = plain(fn('loadOverviewPrefs')(storage));
  assert.equal(migrated.filters.status, 'attention');
  assert.equal(migrated.sort.by, 'priority');
  assert.equal(migrated.group.by, 'folder');

  fn('saveOverviewPrefs')(storage, migrated);
  assert.ok(storage.store.has('overview.prefs.v1'));
  storage.setItem('sessions.status', 'running');
  assert.equal(plain(fn('loadOverviewPrefs')(storage)).filters.status, 'attention');

  const recent = memoryStorage({ 'sessions.order': 'recent', 'sessions.pinned': 'pinned' });
  const fromRecent = plain(fn('loadOverviewPrefs')(recent));
  assert.equal(fromRecent.sort.by, 'activity');
  assert.equal(fromRecent.filters.pinned, 'pinned');
  assert.equal(fromRecent.group.by, 'none');
});

test('broken or old prefs fall back or clamp', () => {
  const normalize = raw => plain(fn('normalizeOverviewPrefs')(raw));
  const odd = normalize({ layout: { mode: 'mosaic', cols: 0, rows: 99 }, search: { n: 50, which: 'middle' }, filters: { clis: ['gpt', 'codex'] } });
  assert.equal(odd.layout.mode, 'grid-fit');
  assert.equal(odd.layout.cols, 1);
  assert.equal(odd.layout.rows, 6);
  assert.equal(odd.search.n, 20);
  assert.equal(odd.search.which, 'first');
  assert.deepEqual(odd.filters.clis, ['codex']);
  assert.equal(odd.layout.cardWidth, 560);

  assert.deepEqual(normalize(null), plain(constant('OVERVIEW_DEFAULTS')));
  assert.equal(normalize({ filters: { place: { kind: 'folder', path: '/Users/demo/app' } } }).filters.place.path, '/Users/demo/app');
  assert.deepEqual(normalize({ filters: { place: { kind: 'project', id: 'p1' } } }).filters.place, { kind: 'project', id: 'p1' });
  assert.equal(normalize({ filters: { place: { kind: 'folder' } } }).filters.place, null);
  assert.equal(normalize({ filters: { place: { kind: 'other', id: 'x' } } }).filters.place, null);
  assert.deepEqual(normalize({ dock: { side: 'right' } }).dock, { side: 'right' });

  const broken = memoryStorage({ 'overview.prefs.v1': '{not json', 'sessions.status': 'attention' });
  assert.deepEqual(plain(fn('loadOverviewPrefs')(broken)), plain(constant('OVERVIEW_DEFAULTS')));

  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(plain(fn('loadOverviewPrefs')(throwing)), plain(constant('OVERVIEW_DEFAULTS')));
  assert.doesNotThrow(() => fn('saveOverviewPrefs')(throwing, constant('OVERVIEW_DEFAULTS')));
});

test('period buckets follow local midnight', () => {
  const periodOf = fn('periodOf');
  assert.equal(periodOf(t(2026, 5, 15, 0) + 60000, NOW), 'today');
  assert.equal(periodOf(t(2026, 5, 14, 23) + 59 * 60000, NOW), 'yesterday');
  assert.equal(periodOf(t(2026, 5, 13), NOW), '3d');
  assert.equal(periodOf(t(2026, 5, 9), NOW), '7d');
  assert.equal(periodOf(t(2026, 4, 20), NOW), '30d');
  assert.equal(periodOf(t(2026, 4, 1), NOW), 'older');
  const passes = fn('passesPeriod');
  assert.equal(passes(t(2026, 5, 13), '7d', NOW), true);
  assert.equal(passes(t(2026, 5, 14), 'today', NOW), false);
  assert.equal(passes(t(2026, 5, 14), 'yesterday', NOW), true);
  assert.equal(passes(t(2026, 5, 13), 'yesterday', NOW), false);
  assert.equal(passes(t(2026, 5, 13), '3d', NOW), true);
  assert.equal(passes(t(2026, 5, 12), '3d', NOW), false);
  assert.equal(passes(t(2026, 4, 20), '30d', NOW), true);
  assert.equal(passes(t(2026, 4, 1), '30d', NOW), false);
  assert.equal(passes(t(2026, 0, 1), 'any', NOW), true);
});

test('the live state follows the agreed priority', () => {
  const probes = ({ run = [], input = [], busy = [], ready = [] } = {}) => ({
    isRunning: id => run.includes(id), needsInput: id => input.includes(id),
    isBusy: id => busy.includes(id), isResponseReady: id => ready.includes(id),
  });
  const state = fn('liveStateOf');
  assert.equal(state('a', probes({ run: ['a'], input: ['a'], busy: ['a'], ready: ['a'] })), 'attention');
  assert.equal(state('a', probes({ run: ['a'], busy: ['a'], ready: ['a'] })), 'working');
  assert.equal(state('a', probes({ run: ['a'], ready: ['a'] })), 'ready');
  assert.equal(state('a', probes({ run: ['a'] })), 'idle');
  assert.equal(state('a', probes()), 'stopped');
});

test('active filters are told from the defaults', () => {
  const active = prefs => fn('overviewFiltersActive')(prefs);
  assert.equal(active(prefsWith()), false);
  assert.equal(active(prefsWith({ filters: { status: 'running' } })), true);
  assert.equal(active(prefsWith({ filters: { pinned: 'pinned' } })), true);
  assert.equal(active(prefsWith({ filters: { clis: ['codex'] } })), true);
  assert.equal(active(prefsWith({ filters: { period: 'today' } })), true);
  assert.equal(active(prefsWith({ filters: { place: { kind: 'folder', path: '/Users/demo/app' } } })), true);
  assert.equal(active(prefsWith({ sort: { by: 'name' }, group: { by: 'folder' } })), false);
});

test('only open sessions show unless closed are included or a search is on', () => {
  const sessions = [s('open'), s('closed'), s('old', { archived: 1 })];
  const open = new Set(['open']);
  const ctx = { isOpen: id => open.has(id) };
  assert.deepEqual(allIds(build(sessions, {}, ctx)), ['open']);
  assert.deepEqual(allIds(build(sessions, { includeClosed: true }, ctx)).sort(), ['closed', 'open']);
  assert.deepEqual(allIds(build(sessions, { includeClosed: true, showArchived: true }, ctx)).sort(), ['closed', 'old', 'open']);
  // Archived is a kind of closed: it needs both boxes.
  assert.deepEqual(allIds(build(sessions, { showArchived: true }, ctx)), ['open']);
  // A search shows closed and archived ones too, but only the matches.
  assert.deepEqual(allIds(build(sessions, {}, { ...ctx, searchIds: new Set(['closed', 'old']) })).sort(), ['closed', 'old']);
  assert.deepEqual(allIds(build(sessions, {}, { ...ctx, searchIds: new Set() })), []);
  // Left out sessions stay out in every case.
  assert.deepEqual(allIds(build(sessions, { includeClosed: true }, { ...ctx, leftOut: new Set(['open']) })), ['closed']);
});

test('status, pinned, CLI, period and place filters combine', () => {
  const sessions = [
    s('a', { runtime: 'claude', starred: 1, days: 0.1 }),
    s('b', { runtime: 'codex', days: 0.1 }),
    s('c', { runtime: 'claude', type: 'terminal', days: 0.1 }),
    s('d', { runtime: 'claude', days: 5, projectPath: '/Users/demo/lib' }),
    s('e', { runtime: 'opencode', days: 0.1, project: { id: 'p1', name: 'Demo' } }),
  ];
  const running = new Set(['a', 'b', 'c', 'e']);
  const ctx = { isRunning: id => running.has(id) };
  const ids = (filters, extra = {}) => allIds(build(sessions, { filters }, { ...ctx, ...extra })).sort();
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ status: 'running' }), ['a', 'b', 'c', 'e']);
  assert.deepEqual(ids({ status: 'stopped' }), ['d']);
  assert.deepEqual(ids({ pinned: 'pinned' }), ['a']);
  assert.deepEqual(ids({ pinned: 'unpinned' }), ['b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ clis: ['claude'] }), ['a', 'd']);
  assert.deepEqual(ids({ clis: ['terminal', 'codex'] }), ['b', 'c']);
  assert.deepEqual(ids({ period: 'today' }), ['a', 'b', 'c', 'e']);
  assert.deepEqual(ids({ period: '7d' }), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ place: { kind: 'folder', path: '/Users/demo/lib' } }), ['d']);
  assert.deepEqual(ids({ place: { kind: 'project', id: 'p1' } }), ['e']);
  assert.deepEqual(ids({ status: 'running', clis: ['claude'], period: 'today', pinned: 'pinned' }), ['a']);
  const result = build(sessions, {}, ctx);
  assert.equal(result.total, 5);
  assert.equal(result.running, 4);
});

test('each grouping gives the agreed groups in the agreed order', () => {
  const sessions = [
    s('a', { days: 0.1, projectPath: '/Users/demo/zeta', runtime: 'codex', starred: 1, project: { id: 'p2', name: 'Beta' } }),
    s('b', { days: 0.6, projectPath: '/Users/demo/alpha', runtime: 'claude' }),
    s('c', { days: 40, projectPath: '/Users/demo/zeta', runtime: 'claude', type: 'terminal', project: { id: 'p1', name: 'Alpha' } }),
  ];
  const running = new Set(['a']);
  const input = new Set(['c']);
  const ctx = { isRunning: id => running.has(id) || input.has(id), needsInput: id => input.has(id) };
  const by = groupBy => build(sessions, { group: { by: groupBy } }, ctx).groups;
  const keys = groups => groups.map(g => g.key);
  const labels = groups => groups.map(g => g.label);

  const none = by('none');
  assert.equal(none.length, 1);
  assert.equal(none[0].kind, 'none');
  assert.deepEqual(cardIds(none[0]), ['a', 'b', 'c']);

  const folders = by('folder');
  assert.deepEqual(keys(folders), ['/Users/demo/zeta', '/Users/demo/alpha']);
  assert.deepEqual(labels(folders), ['zeta', 'alpha']);
  assert.equal(folders[0].kind, 'folder');
  assert.equal(folders[0].path, '/Users/demo/zeta');
  assert.deepEqual(cardIds(folders[0]), ['a', 'c']);

  // No project goes last, whatever its first card.
  const projects = by('project');
  assert.deepEqual(labels(projects), ['Beta', 'Alpha', 'No project']);
  assert.equal(projects[0].kind, 'project');
  assert.equal(projects[0].projectId, 'p2');
  assert.deepEqual(cardIds(projects[2]), ['b']);

  assert.deepEqual(labels(by('cli')), ['Codex', 'Claude Code', 'Terminal']);
  assert.deepEqual(labels(by('kind')), ['Agent', 'Terminal']);
  assert.deepEqual(labels(by('pinned')), ['Pinned', 'Others']);

  const statuses = by('status');
  assert.deepEqual(keys(statuses), ['attention', 'idle', 'stopped']);
  assert.deepEqual(labels(statuses), ['Needs input', 'Idle', 'Not running']);

  const periods = by('period');
  assert.deepEqual(keys(periods), ['today', 'yesterday', 'older']);
  assert.deepEqual(labels(periods), ['Today', 'Yesterday', 'Older']);

  assert.deepEqual(build([], {}, {}).groups, []);
});

test('cards keep their places until resort and new ones go on top', () => {
  const sessions = [s('a', { days: 3 }), s('b', { days: 2 }), s('c', { days: 1 })];
  const first = build(sessions, {}, {});
  assert.deepEqual(cardIds(first.groups[0]), ['c', 'b', 'a']);
  const key = first.groups[0].key;

  // a is now the most recent and d is new, but the places held stay.
  const later = [s('a', { days: 0.1 }), s('b', { days: 2 }), s('c', { days: 1 }), s('d', { days: 0.5 })];
  const previousOrder = new Map([[key, ['c', 'b', 'a']]]);
  assert.deepEqual(cardIds(build(later, {}, { previousOrder }).groups[0]), ['d', 'c', 'b', 'a']);
  assert.deepEqual(cardIds(build(later, {}, { previousOrder, resort: true }).groups[0]), ['a', 'd', 'c', 'b']);
});

test('groups keep their places until resort and new ones go on top', () => {
  const sessions = [
    s('a', { days: 3, projectPath: '/Users/demo/alpha' }),
    s('b', { days: 0.1, projectPath: '/Users/demo/beta' }),
  ];
  const groupKeys = (list, ctx) => build(list, { group: { by: 'folder' } }, ctx).groups.map(g => g.key);
  const alpha = '/Users/demo/alpha';
  const beta = '/Users/demo/beta';
  const gamma = '/Users/demo/gamma';
  assert.deepEqual(groupKeys(sessions, {}), [beta, alpha]);
  // The older group was first at the last render: a newer card does not move it.
  const previousGroups = [alpha, beta];
  assert.deepEqual(groupKeys(sessions, { previousGroups }), [alpha, beta]);
  assert.deepEqual(groupKeys(sessions, { previousGroups, resort: true }), [beta, alpha]);
  // A new group goes on top, even with the oldest card.
  const withNew = [...sessions, s('c', { days: 9, projectPath: gamma })];
  assert.deepEqual(groupKeys(withNew, { previousGroups }), [gamma, alpha, beta]);
  // Several new groups: the newest first card first.
  const withTwo = [...withNew, s('d', { days: 5, projectPath: '/Users/demo/delta' })];
  assert.deepEqual(groupKeys(withTwo, { previousGroups }), ['/Users/demo/delta', gamma, alpha, beta]);
  // No project stays last, and period keeps its fixed order.
  const projects = [s('p', { days: 0.1 }), s('q', { days: 3, project: { id: 'p1', name: 'One' } })];
  const projectKeys = ctx => build(projects, { group: { by: 'project' } }, ctx).groups.map(g => g.key);
  assert.deepEqual(projectKeys({ previousGroups: ['__no-project__', 'p1'] }), ['p1', '__no-project__']);
  const periodKeys = build(sessions, { group: { by: 'period' } }, { previousGroups: ['older', 'today'] }).groups.map(g => g.key);
  assert.deepEqual(periodKeys, ['today', '7d']);
});

test('cards follow the chosen sort and direction on resort', () => {
  const sessions = [
    s('a', { days: 3, name: 'Beta', created: new Date(ago(10)).toISOString(), projectPath: '/Users/demo/zeta' }),
    s('b', { days: 2, name: 'alpha', created: new Date(ago(30)).toISOString(), starred: 1, projectPath: '/Users/demo/alpha' }),
    s('c', { days: 1, aiTitle: 'Gamma', created: new Date(ago(20)).toISOString(), projectPath: '/Users/demo/mid' }),
  ];
  const running = new Set(['a']);
  const input = new Set(['c']);
  const ctx = { resort: true, isRunning: id => running.has(id) || input.has(id), needsInput: id => input.has(id) };
  const order = (sort, extra = {}) => cardIds(build(sessions, { sort }, { ...ctx, ...extra }).groups[0]);
  assert.deepEqual(order({ by: 'activity', dir: 'desc' }), ['c', 'b', 'a']);
  assert.deepEqual(order({ by: 'activity', dir: 'asc' }), ['a', 'b', 'c']);
  assert.deepEqual(order({ by: 'priority', dir: 'desc' }), ['c', 'a', 'b']);
  assert.deepEqual(order({ by: 'created', dir: 'desc' }), ['a', 'c', 'b']);
  assert.deepEqual(order({ by: 'name', dir: 'desc' }), ['b', 'a', 'c']);
  assert.deepEqual(order({ by: 'name', dir: 'asc' }), ['c', 'a', 'b']);
  assert.deepEqual(order({ by: 'status', dir: 'desc' }), ['c', 'a', 'b']);
  assert.deepEqual(order({ by: 'place', dir: 'desc' }), ['b', 'c', 'a']);
});

test('closed cards are truncated per group, open ones never, and a search, a filter or an expanded group shows all', () => {
  const sessions = [
    s('open', { days: 0.5 }),
    s('c1', { days: 1 }), s('c2', { days: 2 }), s('c3', { days: 3 }), s('c4', { days: 4 }),
    s('c5', { days: 40, starred: 1 }), s('c6', { days: 41 }),
  ];
  const open = new Set(['open']);
  const ctx = { isOpen: id => open.has(id), visibleCount: 2 };
  const base = build(sessions, { includeClosed: true }, ctx);
  const group = base.groups[0];
  assert.deepEqual(cardIds(group), ['open', 'c1', 'c2', 'c5']);
  assert.deepEqual(group.older.map(c => c.id), ['c3', 'c4', 'c6']);

  const key = group.key;
  assert.deepEqual(build(sessions, { includeClosed: true }, { ...ctx, expanded: new Set([key]) }).groups[0].older, []);
  assert.equal(build(sessions, { includeClosed: true }, { ...ctx, expanded: new Set([key]) }).groups[0].cards.length, 7);
  assert.equal(build(sessions, { includeClosed: true }, { ...ctx, searchIds: new Set(sessions.map(x => x.sessionId)) }).groups[0].cards.length, 7);
  assert.equal(build(sessions, { includeClosed: true, filters: { clis: ['claude'] } }, ctx).groups[0].cards.length, 7);

  // Open sessions are never held back, however many and however old.
  const many = [1, 2, 3, 4, 5].map(i => s('o' + i, { days: 60 + i }));
  const everyone = build(many, {}, { visibleCount: 1, maxAgeDays: 1 });
  assert.equal(everyone.groups[0].cards.length, 5);
  assert.deepEqual(everyone.groups[0].older, []);

  // A group of closed cards alone, none recent enough, still shows them.
  const stale = build([s('x', { days: 50 }), s('y', { days: 60 })], { includeClosed: true }, { isOpen: () => false });
  assert.deepEqual(cardIds(stale.groups[0]), ['x', 'y']);
});

test('closed sessions sharing a slug show the latest with the earlier count', () => {
  const sessions = [
    s('x1', { slug: 'job', days: 3 }), s('x2', { slug: 'job', days: 1 }), s('x3', { slug: 'job', days: 2 }),
    s('y1', { slug: 'other', days: 1 }),
    s('o1', { slug: 'job', days: 4 }), s('o2', { slug: 'job', days: 5 }),
  ];
  const open = new Set(['o1', 'o2']);
  const group = build(sessions, { includeClosed: true }, { isOpen: id => open.has(id) }).groups[0];
  const byId = Object.fromEntries(group.cards.map(c => [c.id, c]));
  assert.deepEqual(Object.keys(byId).sort(), ['o1', 'o2', 'x2', 'y1']);
  assert.equal(byId.x2.earlier, 2);
  assert.equal(byId.y1.earlier, 0);
  assert.equal(byId.o1.earlier, 0);
});

test('docked sessions are not cards', () => {
  const sessions = [s('a'), s('b')];
  const result = build(sessions, {}, { excludeIds: new Set(['a']) });
  assert.deepEqual(allIds(result), ['b']);
});

test('a card says what it is', () => {
  const sessions = [s('a', { days: 0.2, starred: 1 })];
  const card = build(sessions, {}, { isRunning: () => true, isResponseReady: () => true }).groups[0].cards[0];
  assert.equal(card.id, 'a');
  assert.equal(card.session.sessionId, 'a');
  assert.equal(card.live, true);
  assert.equal(card.state, 'ready');
  assert.equal(card.pinned, true);
  assert.equal(card.running, true);
  assert.equal(card.earlier, 0);
  assert.equal(card.sortTime, Date.parse(sessions[0].modified));
  const closed = build(sessions, { includeClosed: true }, { isOpen: () => false }).groups[0].cards[0];
  assert.equal(closed.live, false);
  assert.equal(closed.state, 'stopped');
});

test('layout geometry', () => {
  const geometry = (layout, size) => plain(fn('layoutGeometry')({ ...plain(constant('OVERVIEW_DEFAULTS')).layout, ...layout }, size));
  const fit = geometry({ mode: 'grid-fit', cols: 2, rows: 2 }, { width: 1000, height: 800, count: 9 });
  assert.equal(fit.perPage, 4);
  assert.equal(fit.pages, 3);
  assert.equal(fit.cols, 2);
  assert.equal(fit.rows, 2);
  assert.equal(fit.cardWidth, (1000 - 14) / 2);
  assert.equal(fit.cardHeight, (800 - 14) / 2);

  const down = geometry({ mode: 'grid-down', cols: 3 }, { width: 1000, height: 800, count: 9 });
  assert.equal(down.cols, 3);
  assert.equal(down.cardHeight, 450);
  assert.equal(down.pages, 1);

  const across = geometry({ mode: 'grid-across', rows: 2, cardWidth: 600 }, { width: 1000, height: 800, count: 9 });
  assert.equal(across.rows, 2);
  assert.equal(across.cardWidth, 600);
  assert.equal(across.cardHeight, (800 - 14) / 2);
  assert.equal(across.pages, 1);

  assert.equal(geometry({ mode: 'rows' }, { width: 1000, height: 800, count: 5 }).cols, 1);
  assert.equal(geometry({ mode: 'columns' }, { width: 1000, height: 800, count: 5 }).rows, 1);
  assert.equal(geometry({ mode: 'grid-fit' }, { width: 1000, height: 800, count: 0 }).pages, 1);
  assert.equal(geometry({ mode: 'grid-fit', cols: 2, rows: 2 }, { width: 1000, height: 800, count: 9, gap: 0 }).cardWidth, 500);

  const slice = fn('pageSlice');
  assert.deepEqual(Array.from(slice([1, 2, 3, 4, 5, 6, 7, 8, 9], 0, 4)), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(slice([1, 2, 3, 4, 5, 6, 7, 8, 9], 2, 4)), [9]);
  assert.deepEqual(Array.from(slice([1, 2, 3], 5, 4)), []);
});

test('the lifecycle ignores the close its own mount causes', () => {
  const calls = [];
  let lifecycle;
  lifecycle = fn('createOverviewLifecycle')({
    mount() { calls.push('mount'); lifecycle.close('page'); },
    unmount(reason) { calls.push('unmount:' + reason); },
  });
  assert.equal(lifecycle.isOpen(), false);
  lifecycle.close('tab');
  assert.deepEqual(calls, []);
  lifecycle.open();
  assert.equal(lifecycle.isOpen(), true);
  assert.deepEqual(calls, ['mount']);
  lifecycle.close('tab');
  assert.equal(lifecycle.isOpen(), false);
  lifecycle.close('tab');
  assert.deepEqual(calls, ['mount', 'unmount:tab']);
});
