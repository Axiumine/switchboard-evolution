const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Sessions tab as the Session Overview's control panel
// (session-overview-panel.js): its search, the summary of the results bar, and
// the hooks in the files shared with upstream that make the tab open the page
// instead of listing sessions.

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const panelSource = read('session-overview-panel.js');
const searchResults = read('search-results.js');
// The panel reads the model's lists (OVERVIEW_*) when it runs, as in the app.
const model = read('session-list.js') + '\n' + read('session-overview-model.js');

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}

const element = () => {
  const attributes = new Map();
  return {
    style: {},
    hidden: false,
    setAttribute(name, value) { attributes.set(name, String(value)); if (name === 'hidden') this.hidden = true; },
    removeAttribute(name) { attributes.delete(name); if (name === 'hidden') this.hidden = false; },
    hasAttribute: name => attributes.has(name),
  };
};

const SESSIONS = [
  { sessionId: 'title', name: 'Fix the alpha build', projectPath: '/Users/demo/app' },
  { sessionId: 'folder', name: 'Refactor', projectPath: '/Users/demo/alphabet' },
  { sessionId: 'message', name: 'Tidy up', projectPath: '/Users/demo/app' },
  { sessionId: 'none', name: 'Unrelated', projectPath: '/Users/demo/other' },
];
// What each session's messages say: the stub of window.api.searchSessions looks here.
const MESSAGES = { message: ['first words', 'the alpha release is out'], none: ['nothing here'] };

/** The panel's script against stubs of the overview (session-overview.js) and the app. */
function panel({ search = { inMessages: true, which: 'last', n: 3 }, api = true } = {}) {
  const calls = { searched: [], refreshed: [], opened: 0, restored: 0, rendered: 0 };
  const prefs = { search };
  const context = vm.createContext({
    console, Map, Set, Promise, JSON, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null },
    ensureOverviewPrefs: () => prefs,
    overviewSessions: () => SESSIONS,
    overviewFolderOf: session => ({ key: session.projectPath, label: session.projectPath.split('/').pop() }),
    refreshSessionOverview: options => calls.refreshed.push(options || {}),
    sessionOverviewUnavailable: () => false,
  });
  context.window = context;
  if (api) {
    context.api = {
      searchSessions: async (query, options) => {
        calls.searched.push([query, { ...options }]);
        const q = query.toLowerCase();
        return Object.keys(MESSAGES).filter(id => MESSAGES[id].some(text => text.toLowerCase().includes(q)));
      },
    };
  }
  vm.runInContext([searchResults, model, panelSource].join('\n'), context);
  const run = code => vm.runInContext(code, context);
  const ids = () => [...(run('overviewSearch') ? run('overviewSearch').ids : [])].sort();
  return { context, calls, run, ids, prefs };
}

test('the search matches titles and folder names, and needs 3 characters for messages', async () => {
  // Two characters: titles and folders only, the messages are not searched.
  const short = panel();
  await short.run('runOverviewSearch("al")');
  assert.deepEqual(short.calls.searched, []);
  assert.deepEqual(short.ids(), ['folder', 'title']);
  assert.equal(short.run('overviewSearch.query'), 'al');

  // Three or more: the messages too, as the panel asks (Last 3), once.
  const long = panel();
  await long.run('runOverviewSearch("  alpha ")');
  assert.deepEqual(long.calls.searched, [['alpha', { which: 'last', n: 3 }]]);
  assert.deepEqual(long.ids(), ['folder', 'message', 'title']);
  assert.equal(long.run('overviewSearch.query'), 'alpha');
  assert.ok(long.calls.refreshed.length > 0, 'the page is drawn again');

  // "Search in messages" off: never the messages, whatever the length.
  const off = panel({ search: { inMessages: false, which: 'all', n: 1 } });
  await off.run('runOverviewSearch("alpha")');
  assert.deepEqual(off.calls.searched, []);
  assert.deepEqual(off.ids(), ['folder', 'title']);

  // Before the app can search messages (no window.api.searchSessions): titles and folders.
  const early = panel({ api: false });
  await early.run('runOverviewSearch("alpha")');
  assert.deepEqual(early.ids(), ['folder', 'title']);

  // An empty query ends the search.
  await long.run('runOverviewSearch("   ")');
  assert.equal(long.run('overviewSearch'), null);
});

test('a slower earlier search never replaces a later one', async () => {
  const { context, run, ids } = panel();
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  context.api.searchSessions = async query => (query === 'alpha' ? slow : []);
  const first = run('runOverviewSearch("alpha")');
  await run('runOverviewSearch("refactor")');
  release(['message']);
  await first;
  assert.equal(run('overviewSearch.query'), 'refactor');
  assert.deepEqual(ids(), ['folder']);
});

test('a new query starts with nothing left out, the same query keeps it', async () => {
  const { run } = panel();
  await run('runOverviewSearch("alpha")');
  run('overviewLeftOut.add("title")');
  await run('runOverviewSearch("alpha ")');
  assert.deepEqual([...run('overviewLeftOut')], ['title']);
  await run('runOverviewSearch("refactor")');
  assert.equal(run('overviewLeftOut').size, 0);
  run('overviewLeftOut.add("folder")');
  await run('runOverviewSearch("")');
  assert.equal(run('overviewLeftOut').size, 0);
});

test('the result summary counts running results', () => {
  const { run } = panel();
  // The page's last render: its total, and the ids of its running cards.
  const summary = results => run(`JSON.stringify(overviewSearchSummary(${JSON.stringify(results)}))`);
  assert.equal(summary({ total: 3, runningIds: ['b', 'c', 'b'] }), JSON.stringify({ count: 3, running: 2 }));
  assert.equal(summary({ total: 2, runningIds: [] }), JSON.stringify({ count: 2, running: 0 }));
  // No render yet, or the page closed: nothing to count.
  assert.equal(summary(null), 'null');
});

/** A stand-in element: text, hidden, and the children its querySelector finds by selector. */
function fakeElement(children = {}) {
  return { textContent: '', hidden: false, querySelector: selector => children[selector] || null };
}

test('the results bar counts what the page counts, also when closed sessions share a slug', () => {
  const overview = read('session-overview.js');
  const now = Date.now();
  const at = minutes => new Date(now - minutes * 60000).toISOString();
  // Two closed sessions of one conversation (one slug) and a running one, all found.
  const sessions = [
    { sessionId: 'old', name: 'Fix alpha', slug: 'fix-alpha', projectPath: '/Users/demo/app', modified: at(30) },
    { sessionId: 'new', name: 'Fix alpha again', slug: 'fix-alpha', projectPath: '/Users/demo/app', modified: at(20) },
    { sessionId: 'live', name: 'Alpha live', projectPath: '/Users/demo/app', modified: at(1) },
  ];
  const drawn = {};
  const context = vm.createContext({
    console, Map, Set, WeakSet, Promise, JSON, Date, Math, Number, Object, Array, String,
    setTimeout, clearTimeout, clearInterval() {}, cancelAnimationFrame() {}, removeEventListener() {},
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: () => null, setItem() {} },
    cachedAllProjects: [{ projectPath: '/Users/demo/app', sessions }],
    sessionMap: new Map(sessions.map(session => [session.sessionId, session])),
    openSessions: new Map([['live', { session: sessions[2], element: {} }]]),
    isSessionRunning: id => id === 'live',
    attentionSessions: new Set(), responseReadySessions: new Set(), sessionBusyState: new Map(),
    sessionEventTime: session => Date.parse(session.modified),
    visibleSessionCount: 10, sessionMaxAgeDays: 3,
    terminalsEl: {}, terminalHeader: { style: {} },
    updateRunningIndicators() {},
  });
  context.window = context;
  vm.runInContext([searchResults, model, overview, panelSource].join('\n'), context);
  const run = code => vm.runInContext(code, context);
  // The page as open, its drawing stubbed: the header shows the model's total.
  context.drawOverviewHeader = page => { drawn.total = page.total; drawn.running = page.running; };
  context.drawOverviewCards = () => {};
  context.layoutSessionOverview = () => {};
  run('ovState.root = { remove() {} }; overviewSearch = { query: "alpha", ids: new Set(["old", "new", "live"]) };');
  run('renderSessionOverview()');
  assert.deepEqual(drawn, { total: 3, running: 1 });

  // The panel's bar, drawn from that render.
  const parts = { '.ovp-results-count': fakeElement(), '.ovp-restore': fakeElement(), '.ovp-stop': fakeElement() };
  const bar = fakeElement(parts);
  run('ovPanel').el = fakeElement({ '.ovp-results': bar });
  run('syncOverviewResults()');
  assert.equal(bar.hidden, false);
  assert.equal(parts['.ovp-results-count'].textContent, '3 results');
  assert.equal(parts['.ovp-stop'].hidden, false);
  assert.equal(parts['.ovp-stop'].textContent, 'Stop 1 running');
  assert.equal(run('JSON.stringify(overviewLastResults().runningIds)'), '["live"]');
  // The panel never builds the model itself.
  assert.ok(!panelSource.includes('buildOverview('));

  // The page closed: no count from an old render.
  run('unmountSessionOverview()');
  assert.equal(run('overviewLastResults()'), null);
  run('syncOverviewResults()');
  assert.equal(bar.hidden, true);
});

test('the CLI filter offers the switched-on CLIs, Terminal, and any already chosen', () => {
  const { run } = panel();
  const choices = (enabled, chosen) => [...run(`overviewCliChoices(${JSON.stringify(enabled)}, ${JSON.stringify(chosen)})`)];
  // Not known yet: every CLI.
  assert.deepEqual(choices(null, []), ['claude', 'codex', 'opencode', 'terminal']);
  assert.deepEqual(choices(['claude'], []), ['claude', 'terminal']);
  // Switched off while chosen: still there, so it can be unticked.
  assert.deepEqual(choices(['claude'], ['opencode']), ['claude', 'opencode', 'terminal']);
});

// ---- The Sessions tab ----

/** The tab handler of app.js, with the panel's showOverviewTab stubbed. */
function tabs({ tab = 'projects' } = {}) {
  const calls = { overviewTab: 0, restored: 0, loaded: 0 };
  const buttons = ['projects', 'sessions', 'plans', 'memory', 'stats'].map(name => {
    const listeners = [];
    return {
      ...element(), dataset: { tab: name }, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener: (type, fn) => { if (type === 'click') listeners.push(fn); },
      click: () => listeners.forEach(fn => fn()),
    };
  });
  const overviewPanel = element();
  overviewPanel.hidden = true;
  const context = vm.createContext({
    console, Map, Set, Promise,
    document: {
      querySelectorAll: selector => (selector === '.sidebar-tab' ? buttons : []),
      querySelector: () => null,
      getElementById: id => (id === 'overview-panel' ? overviewPanel : null),
    },
    localStorage: { getItem: () => null, setItem() {} },
    activeTab: tab, projectsChangedWhileAway: false,
    REMEMBERED_TABS: ['sessions', 'projects'], LAST_TAB_KEY: 'lastTab',
    searchInput: element(), searchBar: { ...element(), classList: { add() {}, remove() {} } },
    searchMatchIds: null, searchMatchProjectPaths: null,
    sidebarContent: element(), projectsContent: element(), plansContent: element(),
    statsContent: element(), memoryContent: element(), sessionFilters: element(),
    filesFilters: null, plansFilters: null, donateBar: null,
    resetSearchExclusions() {}, updateSearchActions() {}, leaveProjectViews() {},
    restoreTerminalArea: () => { calls.restored++; },
    showOverviewTab: () => { calls.overviewTab++; overviewPanel.hidden = false; },
    renderProjectList() {}, showProjectHome() {}, loadPlans() {}, loadFiles() {}, showStatsPage() {},
    loadProjects: () => { calls.loaded++; return Promise.resolve(); },
  });
  const app = read('app.js');
  vm.runInContext(app.slice(
    app.indexOf("document.querySelectorAll('.sidebar-tab').forEach(tab => {"),
    app.indexOf('// Plans & viewer helpers'),
  ), context);
  const click = name => buttons.find(b => b.dataset.tab === name).click();
  return { context, calls, click, overviewPanel };
}

test('the Sessions tab shows the panel and the overview, not the list', () => {
  const { context, calls, click, overviewPanel } = tabs();
  context.projectsChangedWhileAway = true;
  click('sessions');
  assert.equal(calls.overviewTab, 1);
  assert.equal(calls.restored, 0);
  assert.equal(overviewPanel.hidden, false);
  // The list, its combos and the shared search field stay out of sight.
  assert.equal(context.sidebarContent.style.display, 'none');
  assert.equal(context.sessionFilters.style.display, 'none');
  assert.equal(context.searchBar.style.display, 'none');
  // Changes seen while away are still caught up.
  assert.equal(calls.loaded, 1);
  assert.equal(context.projectsChangedWhileAway, false);

  // Every other tab hides the panel.
  for (const name of ['projects', 'plans', 'memory', 'stats']) {
    click('sessions');
    assert.equal(overviewPanel.hidden, false, name);
    click(name);
    assert.equal(overviewPanel.hidden, true, name);
  }

  // Back from a page over it (Task Manager, Global settings): the overview again.
  click('sessions');
  const before = calls.overviewTab;
  const underlined = { classList: { remove() {} } };
  context.document.querySelector = selector => (selector === '#sidebar-tabs .sidebar-tab.open.selected' ? underlined : null);
  context.document.querySelectorAll = selector => (selector === '#sidebar-tabs .sidebar-tab.selected' ? [underlined] : []);
  click('sessions');
  assert.equal(calls.overviewTab, before + 1);
  assert.equal(calls.restored, 0);

  const html = read('index.html');
  const sidebar = html.slice(html.indexOf('<div id="sidebar">'), html.indexOf('<div id="sidebar-resize-handle">'));
  const searchBar = sidebar.indexOf('<div id="search-bar">');
  const overview = sidebar.indexOf('<div id="overview-panel" hidden></div>');
  assert.ok(searchBar !== -1 && overview > searchBar, 'the panel comes after #search-bar, in #sidebar');
  assert.ok(sidebar.includes('<div id="session-filters">'), '#session-filters stays: app.js looks it up');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.equal(scripts[scripts.indexOf('session-overview.js') + 1], 'session-overview-panel.js');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.indexOf('<link rel="stylesheet" href="session-overview-panel.css">') > head.indexOf('href="session-overview.css"'));
});

/** showOverviewTab and refreshOverviewTab against stubs of the page and the sidebar. */
function overviewTab({ ready = true, unavailable = false } = {}) {
  const calls = { opened: 0, restored: 0, refreshed: 0, rendered: 0 };
  const overviewPanel = element();
  overviewPanel.hidden = true;
  const context = vm.createContext({
    console, Map, Set, Promise, JSON, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById: id => (id === 'overview-panel' ? overviewPanel : null), querySelector: () => null },
    sessionOverviewReady: ready,
    sessionOverviewUnavailable: () => unavailable,
    openSessionOverview: () => { calls.opened++; },
    restoreTerminalArea: () => { calls.restored++; },
    refreshSessionOverview: () => { calls.refreshed++; },
    sidebarContent: element(), sessionFilters: element(), searchBar: element(),
  });
  context.window = context;
  vm.runInContext([searchResults, model, panelSource].join('\n'), context);
  context.renderOverviewPanel = () => { calls.rendered++; };
  context.loadOverviewClis = () => {};
  return { context, calls, overviewPanel, run: code => vm.runInContext(code, context) };
}

test('the Sessions tab opens the page only once the app is restored, and never in another window', () => {
  const ready = overviewTab();
  ready.run('showOverviewTab()');
  assert.deepEqual([ready.calls.opened, ready.calls.restored], [1, 0]);
  assert.equal(ready.overviewPanel.hidden, false);
  assert.equal(ready.context.sidebarContent.style.display, 'none');
  assert.equal(ready.context.sessionFilters.style.display, 'none');
  assert.equal(ready.context.searchBar.style.display, 'none');

  // During a start the tab shows what it always did; onAppRestored opens the page later.
  const starting = overviewTab({ ready: false });
  starting.run('showOverviewTab()');
  assert.deepEqual([starting.calls.opened, starting.calls.restored], [0, 1]);
  assert.equal(starting.overviewPanel.hidden, false);

  const projectWindow = overviewTab({ unavailable: true });
  projectWindow.run('showOverviewTab()');
  assert.equal(projectWindow.calls.opened, 0);
  assert.equal(projectWindow.overviewPanel.hidden, true);
});

test('refreshSidebar draws the page and the panel again', () => {
  const app = read('app.js');
  const refresh = body(app, 'function refreshSidebar(');
  const lines = refresh.trim().split('\n');
  assert.equal(lines[lines.length - 2].trim(), "if (typeof refreshOverviewTab === 'function') refreshOverviewTab();");

  const shown = overviewTab();
  shown.overviewPanel.hidden = false;
  shown.run('refreshOverviewTab()');
  assert.deepEqual([shown.calls.refreshed, shown.calls.rendered], [1, 1]);
  // The panel out of sight is not drawn; the page still is (it can stay over the Plans tab).
  const hidden = overviewTab();
  hidden.run('refreshOverviewTab()');
  assert.deepEqual([hidden.calls.refreshed, hidden.calls.rendered], [1, 0]);
});

test('a choice made on the page shows in the panel', () => {
  const overview = read('session-overview.js');
  const calls = { page: [], panel: 0 };
  const context = vm.createContext({
    localStorage: {},
    overviewPrefs: null,
    ovState: { page: 0 },
    ensureOverviewPrefs: () => context.overviewPrefs,
    normalizeOverviewPrefs: prefs => prefs,
    saveOverviewPrefs() {},
    refreshSessionOverview: options => calls.page.push(options),
    refreshOverviewPanel: () => { calls.panel++; },
  });
  context.overviewPrefs = { filters: { status: 'running' }, group: { by: 'none' }, layout: { mode: 'grid-fit' } };
  vm.runInContext(body(overview, 'function setOverviewPrefs(') + body(overview, 'function mergeOverviewPrefs('), context);
  // A filter chip's × (drawOverviewHeader) takes the filter off.
  vm.runInContext('setOverviewPrefs({ filters: { status: "all" } })', context);
  assert.equal(context.overviewPrefs.filters.status, 'all');
  assert.equal(calls.page.length, 1);
  assert.equal(calls.panel, 1);
});

test('the overview reads the search and what was left out of it', () => {
  const overview = read('session-overview.js');
  const context = vm.createContext({
    Map, Set, Date,
    ovState: { previousOrder: null, previousGroups: undefined },
    visibleSessionCount: 10, sessionMaxAgeDays: 3,
    overviewFolderOf() {}, overviewProjectOf() {},
  });
  vm.runInContext(body(overview, 'function overviewContext('), context);
  const ctx = () => vm.runInContext('overviewContext({ resort: false })', context);
  // Without the panel: no search, nothing left out.
  assert.equal(ctx().searchIds, null);
  assert.equal(ctx().leftOut.size, 0);
  vm.runInContext('var overviewSearch = null; var overviewLeftOut = new Set(["x"]);', context);
  assert.equal(ctx().searchIds, null);
  assert.deepEqual([...ctx().leftOut], ['x']);
  vm.runInContext('overviewSearch = { query: "api", ids: new Set(["a", "b"]) };', context);
  assert.deepEqual([...ctx().searchIds], ['a', 'b']);
});

test('Add folder can go on to the new folder', () => {
  const dialog = body(read('dialogs.js'), 'function showAddProjectDialog(');
  assert.ok(dialog.startsWith('function showAddProjectDialog({ onAdded } = {}) {'), dialog.slice(0, 80));
  assert.match(dialog, /await loadProjects\(\);\n\s+if \(typeof onAdded === 'function'\) onAdded\(result\.projectPath \|\| projectPath\);/);
});

test("the overview's New session popover stays inside the window", () => {
  const shown = [];
  const observers = [];
  const popover = { style: { left: '1500px' }, offsetWidth: 200 };
  const context = vm.createContext({
    document: { querySelector: selector => (selector === '.new-session-popover' ? popover : null) },
    showNewSessionPopover: (folder, anchor) => shown.push([folder, anchor]),
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
  });
  context.window = { innerWidth: 1592 };
  vm.runInContext(body(panelSource, 'function showOverviewNewSessionPopover('), context);
  const folder = { projectPath: '/Users/demo/app' };
  const anchor = {};
  context.showOverviewNewSessionPopover(folder, anchor);
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], folder);
  assert.equal(shown[0][1], anchor);
  // Past the right edge: moved in, 8px from it.
  assert.equal(popover.style.left, '1384px');
  // Laid out again (main listed the CLIs): moved in again.
  popover.style.left = '1500px';
  popover.offsetWidth = 230;
  observers[0]();
  assert.equal(popover.style.left, '1354px');
  // One that fits stays where it is; in a window narrower than it, at 8px.
  popover.style.left = '400px';
  observers[0]();
  assert.equal(popover.style.left, '400px');
  context.window.innerWidth = 200;
  observers[0]();
  assert.equal(popover.style.left, '8px');

  // Every folder popover the overview opens goes through it.
  for (const header of ['function showOverviewNewSession(', 'function buildOverviewPanel(']) {
    const source = body(panelSource, header);
    assert.ok(!source.includes('showNewSessionPopover('), header);
    assert.ok(source.includes('showOverviewNewSessionPopover('), header);
  }
  const groups = read('session-overview-groups.js');
  assert.ok(!groups.includes('showNewSessionPopover('));
});
