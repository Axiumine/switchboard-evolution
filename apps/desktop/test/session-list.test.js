// The Sessions tab's list: the status, pinned and order combos, the flat list
// of "Group by folders" off, and its truncation. public/session-list.js is
// pure; processProjectSessions (public/sidebar.js) is run with its row
// builders stubbed, since those need a DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const day = 86400000;
const NOW = Date.parse('2026-06-15T12:00:00Z');
const ago = days => new Date(NOW - days * day).toISOString();
// Objects made inside the vm have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

// Constants declared with const are not properties of a vm context: read them with runInContext.
const lib = vm.createContext({});
vm.runInContext(read('session-list.js'), lib);
const constant = name => plain(vm.runInContext(name, lib));

const s = (id, extra = {}) => ({ sessionId: id, modified: ago(1), ...extra });
// Array.from: a host array, whatever realm the list came from.
const ids = list => Array.from(list, x => x.sessionId);
const probes = ({ running = [], attention = [] } = {}) => ({
  isRunning: id => running.includes(id),
  needsInput: id => attention.includes(id),
});
const prefs = (extra = {}) => ({ status: 'all', pinned: 'all', order: 'recent', groupByFolders: false, ...extra });

test('the combos offer the agreed choices and the defaults are the quiet ones', () => {
  assert.deepEqual(constant('SESSION_STATUS_FILTERS').map(([, label]) => label), ['All statuses', 'Running', 'Needs input', 'Not running']);
  assert.deepEqual(constant('SESSION_PIN_FILTERS').map(([, label]) => label), ['Pinned or not', 'Pinned', 'Not pinned']);
  assert.deepEqual(constant('SESSION_ORDERS').map(([, label]) => label), ['Most recent first', 'Running & pinned first']);
  assert.deepEqual(constant('SESSION_LIST_DEFAULTS'), { status: 'all', pinned: 'all', order: 'recent', groupByFolders: false });
});

test('choices are saved under sessions.* keys and a bad value falls back to the default', () => {
  const store = new Map();
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(plain(lib.loadSessionListPrefs(storage)), prefs());
  lib.saveSessionListPrefs(storage, prefs({ status: 'attention', pinned: 'unpinned', order: 'priority', groupByFolders: true }));
  assert.deepEqual([...store.keys()].sort(), ['sessions.groupByFolders', 'sessions.order', 'sessions.pinned', 'sessions.status']);
  assert.deepEqual(plain(lib.loadSessionListPrefs(storage)), prefs({ status: 'attention', pinned: 'unpinned', order: 'priority', groupByFolders: true }));
  store.set('sessions.status', 'today');
  store.set('sessions.order', 'oldest');
  assert.equal(lib.loadSessionListPrefs(storage).status, 'all');
  assert.equal(lib.loadSessionListPrefs(storage).order, 'recent');
  // Storage that throws (a private window) changes nothing and breaks nothing.
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(plain(lib.loadSessionListPrefs(broken)), prefs());
  assert.doesNotThrow(() => lib.saveSessionListPrefs(broken, prefs()));
});

test('only status and pinned count as filters', () => {
  assert.equal(lib.sessionFiltersActive(prefs()), false);
  assert.equal(lib.sessionFiltersActive(prefs({ order: 'priority', groupByFolders: true })), false);
  assert.equal(lib.sessionFiltersActive(prefs({ status: 'stopped' })), true);
  assert.equal(lib.sessionFiltersActive(prefs({ pinned: 'pinned' })), true);
});

test('the status combo: running includes sessions needing input, not running is the rest', () => {
  const all = [s('a'), s('b'), s('c'), s('d')];
  const p = probes({ running: ['a', 'b'], attention: ['b'] });
  const by = status => ids(lib.filterSessionsByPrefs(all, prefs({ status }), p));
  assert.deepEqual(by('all'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(by('running'), ['a', 'b']);
  assert.deepEqual(by('attention'), ['b']);
  assert.deepEqual(by('stopped'), ['c', 'd']);
});

test('the pinned combo and the status combo apply together', () => {
  const all = [s('a', { starred: 1 }), s('b'), s('c', { starred: 1 }), s('d')];
  const p = probes({ running: ['a', 'b'] });
  const by = (status, pinned) => ids(lib.filterSessionsByPrefs(all, prefs({ status, pinned }), p));
  assert.deepEqual(by('all', 'pinned'), ['a', 'c']);
  assert.deepEqual(by('all', 'unpinned'), ['b', 'd']);
  assert.deepEqual(by('running', 'pinned'), ['a']);
  assert.deepEqual(by('stopped', 'unpinned'), ['d']);
});

test('most recent first is the time alone; running and pinned first is today\'s priority', () => {
  const all = [
    s('old-running', { modified: ago(9) }),
    s('new', { modified: ago(0.1) }),
    s('mid-pinned', { modified: ago(5), starred: 1 }),
    s('older-pinned-running', { modified: ago(20), starred: 1 }),
    s('mid', { modified: ago(2) }),
  ];
  const running = ['old-running', 'older-pinned-running'];
  assert.deepEqual(ids(lib.sortSessionsByOrder(all, 'recent', id => running.includes(id))),
    ['new', 'mid', 'mid-pinned', 'old-running', 'older-pinned-running']);
  assert.deepEqual(ids(lib.sortSessionsByOrder(all, 'priority', id => running.includes(id))),
    ['older-pinned-running', 'old-running', 'mid-pinned', 'new', 'mid']);
});

const item = (id, extra = {}) => ({ sortTime: NOW - day, pinned: false, running: false, element: { id }, ...extra });
const itemIds = list => Array.from(list, i => i.element.id);

test('render items follow the order combo, or the earlier order until a resort', () => {
  const items = [
    item('si-a', { sortTime: NOW - 5 * day, running: true }),
    item('si-b', { sortTime: NOW - 1 * day }),
    item('si-c', { sortTime: NOW - 3 * day, pinned: true }),
  ];
  assert.deepEqual(itemIds(lib.orderRenderItems(items, { order: 'recent', resort: true, previousIds: null })), ['si-b', 'si-c', 'si-a']);
  assert.deepEqual(itemIds(lib.orderRenderItems(items, { order: 'priority', resort: true, previousIds: null })), ['si-a', 'si-c', 'si-b']);
  // Kept order: rows stay where they were even when time says otherwise, and a new row goes on top.
  const kept = lib.orderRenderItems([...items, item('si-new', { sortTime: NOW - 9 * day })], { order: 'recent', resort: false, previousIds: ['si-c', 'si-a', 'si-b'] });
  assert.deepEqual(itemIds(kept), ['si-new', 'si-c', 'si-a', 'si-b']);
  // A list with no earlier order is sorted fresh.
  assert.deepEqual(itemIds(lib.orderRenderItems(items, { order: 'recent', resort: false, previousIds: undefined })), ['si-b', 'si-c', 'si-a']);
});

test('truncation keeps running and pinned rows and counts the rest against the limit and the age', () => {
  const items = [
    item('si-1', { sortTime: NOW - 0.5 * day }),
    item('si-2', { sortTime: NOW - 1 * day }),
    item('si-3', { sortTime: NOW - 2 * day }),
    item('si-stale-running', { sortTime: NOW - 30 * day, running: true }),
    item('si-stale-pinned', { sortTime: NOW - 30 * day, pinned: true }),
    item('si-stale', { sortTime: NOW - 30 * day }),
  ];
  const cut = lib.truncateRenderItems(items, { showAll: false, visibleCount: 2, maxAgeDays: 3, now: NOW });
  // si-1 and si-2 fill the two places; the pinned and the running row show whatever their age.
  assert.deepEqual(itemIds(cut.visible), ['si-1', 'si-2', 'si-stale-running', 'si-stale-pinned']);
  assert.deepEqual(itemIds(cut.older), ['si-3', 'si-stale']);
  // A search or a filter on: nothing is held back.
  const all = lib.truncateRenderItems(items, { showAll: true, visibleCount: 2, maxAgeDays: 3, now: NOW });
  assert.equal(all.visible.length, 6);
  assert.equal(all.older.length, 0);
  // Everything stale and idle: the older rows show instead of an empty list.
  const stale = lib.truncateRenderItems([item('si-x', { sortTime: NOW - 30 * day })], { showAll: false, visibleCount: 5, maxAgeDays: 3, now: NOW });
  assert.deepEqual(itemIds(stale.visible), ['si-x']);
  assert.deepEqual(itemIds(stale.older), []);
});

test('a folder label is short: a worktree names its repo, a project folder its project', () => {
  assert.equal(lib.sessionFolderLabel('/Users/me/code/api'), 'code/api');
  assert.equal(lib.sessionFolderLabel('C:\\code\\api'), 'code/api');
  assert.equal(lib.sessionFolderLabel('/Users/me/code/api/.claude/worktrees/fix-login'), 'api/fix-login');
  assert.equal(lib.sessionFolderLabel('/Users/me/code/api', 'Shop · repos/api'), 'Shop · repos/api');
  assert.equal(lib.sessionFolderLabel(''), '');
});

test('the flat folder holds every folder\'s sessions once, with where each lives', () => {
  const folders = [
    { projectPath: '/c/api', sessions: [s('a1'), s('a2')] },
    { projectPath: '/c/api/.claude/worktrees/fix', sessions: [s('w1'), s('a2')] },
    { projectPath: '/c/web', sessions: [] },
  ];
  const flat = lib.flatSessionsFolder(folders, p => `<${p}>`);
  assert.equal(flat.projectPath, '__flat__');
  assert.deepEqual(ids(flat.sessions), ['a1', 'a2', 'w1']);
  assert.deepEqual(Object.fromEntries(flat.folderLabels), { a1: '</c/api>', a2: '</c/api>', w1: '</c/api/.claude/worktrees/fix>' });
});

// --- processProjectSessions, with the row builders stubbed ---

function sidebarContext({ running = [], attention = [], prefs: p = prefs(), searching = false, visibleSessionCount = 10, sessionMaxAgeDays = 3, sortedOrder = [] } = {}) {
  const context = vm.createContext({
    activePtyIds: new Set(running), pendingSessions: new Map(), attentionSessions: new Set(attention),
    sessionListPrefs: p, searchMatchIds: searching ? new Set() : null,
    visibleSessionCount, sessionMaxAgeDays, sortedOrder,
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
  });
  vm.runInContext(read('session-list.js') + '\n' + read('sidebar.js'), context);
  // The real row builders make DOM; the processing only reads their ids.
  context.buildSessionItem = (session, opts = {}) => ({ id: 'si-' + session.sessionId, folderLabel: opts.folderLabel });
  context.buildSlugGroup = slug => ({ id: 'slug-' + slug });
  return context;
}
const rowIds = result => itemIds(result.visible);

test('a folder is filtered by the combos and ordered by the order combo', () => {
  const folder = { projectPath: '/c/api', sessions: [
    s('a', { modified: ago(5), starred: 1 }), s('b', { modified: ago(1) }), s('c', { modified: ago(2) }),
  ] };
  const recent = sidebarContext({ running: ['c'] }).processProjectSessions(folder, true);
  assert.deepEqual(rowIds(recent), ['si-b', 'si-c', 'si-a']);
  const priority = sidebarContext({ running: ['c'], prefs: prefs({ order: 'priority' }) }).processProjectSessions(folder, true);
  assert.deepEqual(rowIds(priority), ['si-c', 'si-a', 'si-b']);
  const pinned = sidebarContext({ prefs: prefs({ pinned: 'pinned' }) }).processProjectSessions(folder, true);
  assert.deepEqual(rowIds(pinned), ['si-a']);
  assert.deepEqual(ids(pinned.filtered), ['a']);
  const needs = sidebarContext({ running: ['b', 'c'], attention: ['c'], prefs: prefs({ status: 'attention' }) }).processProjectSessions(folder, true);
  assert.deepEqual(rowIds(needs), ['si-c']);
});

test('a folder with nothing left after a filter is skipped, with nothing to filter it is kept', () => {
  const folder = { projectPath: '/c/api', sessions: [s('a')] };
  assert.equal(sidebarContext({ prefs: prefs({ status: 'running' }) }).processProjectSessions(folder, true), null);
  assert.notEqual(sidebarContext().processProjectSessions({ projectPath: '/c/new', sessions: [] }, true), null);
});

test('a filter shows every match; unfiltered, the limit and the age hold back the rest', () => {
  const sessions = Array.from({ length: 6 }, (_, i) => s('s' + i, { modified: ago(0.1 * (i + 1)) }));
  const folder = { projectPath: '/c/api', sessions };
  const plainRun = sidebarContext({ visibleSessionCount: 3 }).processProjectSessions(folder, true);
  assert.equal(plainRun.visible.length, 3);
  assert.equal(plainRun.older.length, 3);
  const filtered = sidebarContext({ visibleSessionCount: 3, prefs: prefs({ pinned: 'unpinned' }) }).processProjectSessions(folder, true);
  assert.equal(filtered.visible.length, 6);
  assert.equal(filtered.older.length, 0);
  const searching = sidebarContext({ visibleSessionCount: 3, searching: true }).processProjectSessions(folder, true);
  assert.equal(searching.visible.length, 6);
});

test('sessions sharing a slug collapse into one group, in the flat list too', () => {
  const flat = lib.flatSessionsFolder([
    { projectPath: '/c/api', sessions: [s('a', { slug: 'plan-x', modified: ago(1) }), s('b', { modified: ago(3) })] },
    { projectPath: '/c/web', sessions: [s('c', { slug: 'plan-x', modified: ago(2) })] },
  ], p => p);
  const result = sidebarContext().processProjectSessions(flat, true);
  assert.deepEqual(rowIds(result), ['slug-plan-x', 'si-b']);
});

test('the flat list is one list across folders, newest first, with each row knowing its folder', () => {
  const flat = lib.flatSessionsFolder([
    { projectPath: '/c/api', sessions: [s('a1', { modified: ago(4) }), s('a2', { modified: ago(0.5) })] },
    { projectPath: '/c/api/.claude/worktrees/fix', sessions: [s('w1', { modified: ago(1) })] },
    { projectPath: '/c/web', sessions: [s('b1', { modified: ago(2) })] },
  ], p => lib.sessionFolderLabel(p));
  const result = sidebarContext({ visibleSessionCount: 10, sessionMaxAgeDays: 30 }).processProjectSessions(flat, true);
  assert.deepEqual(rowIds(result), ['si-a2', 'si-w1', 'si-b1', 'si-a1']);
  assert.deepEqual(Array.from(result.visible, i => i.element.folderLabel), ['c/api', 'api/fix', 'c/web', 'c/api']);
  assert.deepEqual(plain(result.sortOrderEntry), { projectPath: '__flat__', itemIds: ['si-a2', 'si-w1', 'si-b1', 'si-a1'] });
});

test('the flat list is truncated as a whole: running and pinned stay, the rest sit under older', () => {
  const flat = lib.flatSessionsFolder([
    { projectPath: '/c/api', sessions: [s('a1', { modified: ago(0.1) }), s('a2', { modified: ago(0.2) }), s('a3', { modified: ago(0.3) })] },
    { projectPath: '/c/web', sessions: [s('b1', { modified: ago(0.15) }), s('b2', { modified: ago(40), starred: 1 }), s('b3', { modified: ago(40) }), s('b4', { modified: ago(41) })] },
  ], p => p);
  const result = sidebarContext({ visibleSessionCount: 3, sessionMaxAgeDays: 3, running: ['b4'] }).processProjectSessions(flat, true);
  // Three rows by time (a1, b1, a2), then the pinned and the running one, which always show.
  assert.deepEqual(rowIds(result), ['si-a1', 'si-b1', 'si-a2', 'si-b2', 'si-b4']);
  assert.deepEqual(itemIds(result.older).sort(), ['si-a3', 'si-b3']);
});

test('the flat list keeps its order between renders until a resort', () => {
  const flat = () => lib.flatSessionsFolder([
    { projectPath: '/c/api', sessions: [s('a', { modified: ago(1) }), s('b', { modified: ago(2) }), s('c', { modified: ago(3) })] },
  ], p => p);
  const first = sidebarContext().processProjectSessions(flat(), true);
  assert.deepEqual(rowIds(first), ['si-a', 'si-b', 'si-c']);
  // c gets newer, which would move it up on a resort; a new row d goes on top.
  const next = flat();
  next.sessions.find(x => x.sessionId === 'c').modified = ago(0.01);
  next.sessions.push(s('d', { modified: ago(10) }));
  const previous = [plain(first.sortOrderEntry)];
  const kept = sidebarContext({ visibleSessionCount: 10, sessionMaxAgeDays: 30 }).processProjectSessions(next, false, previous);
  assert.deepEqual(rowIds(kept), ['si-d', 'si-a', 'si-b', 'si-c']);
  const resorted = sidebarContext({ visibleSessionCount: 10, sessionMaxAgeDays: 30 }).processProjectSessions(next, true, previous);
  assert.deepEqual(rowIds(resorted), ['si-c', 'si-a', 'si-b', 'si-d']);
});
