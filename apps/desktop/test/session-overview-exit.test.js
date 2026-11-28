const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Opening a session "normally" from the Session Overview (openSessionNormally)
// clicks the Projects tab, whose handler shows what the selected project
// remembers. Nothing but the session asked for may be shown on the way: showing
// another one clears its unread and needs-you marks. The real tab handler
// (app.js), project navigation (projects-view.js), showSession
// (terminal-manager.js) and session-overview.js run here; the DOM is stubbed.

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const app = read('app.js');
const projects = read('projects-view.js');
const terminal = read('terminal-manager.js');
const model = read('session-overview-model.js');
const overview = read('session-overview.js');

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
}

function classes() {
  const set = new Set();
  return {
    add: (...names) => names.forEach(n => set.add(n)),
    remove: (...names) => names.forEach(n => set.delete(n)),
    toggle: (name, on = !set.has(name)) => (on ? set.add(name) : set.delete(name), on),
    contains: name => set.has(name),
  };
}

const element = () => ({ style: {}, hidden: false, dataset: {}, classList: classes() });

const PROJECT_P = { id: 'p', name: 'Demo', root: '/Users/demo/app', folders: [] };
const PROJECT_Q = { id: 'q', name: 'Other', root: '/Users/demo/other', folders: [] };

/**
 * The main window with the overview open on the Sessions tab, project `selected`
 * chosen in the Projects tab and remembering session `remembered` on its Session tab.
 */
function harness({ selected = 'p', remembered = 'b', away = false, tab = 'sessions', realUnmount = false } = {}) {
  const calls = { cleared: [], shown: [], loaded: 0, home: 0, overviewPages: 0 };
  const tabs = ['projects', 'sessions', 'plans', 'memory', 'stats'].map(name => {
    const listeners = [];
    return {
      ...element(),
      dataset: { tab: name },
      addEventListener: (type, fn) => { if (type === 'click') listeners.push(fn); },
      click: () => listeners.forEach(fn => fn()),
    };
  });
  let ready = null;
  const document = {
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') ready = fn; },
    querySelectorAll: selector => (selector === '.sidebar-tab' ? tabs : []),
    querySelector: selector => {
      const name = selector.match(/^\.sidebar-tab\[data-tab="(\w+)"\]$/)?.[1];
      return name ? tabs.find(t => t.dataset.tab === name) : null;
    },
    getElementById: () => null,
  };
  const sessions = {
    a: { sessionId: 'a', projectPath: '/Users/demo/app', projectId: 'p' },
    a2: { sessionId: 'a2', projectPath: '/Users/demo/other', projectId: 'q' },
    solo: { sessionId: 'solo', projectPath: '/Users/demo/loose' },
    b: { sessionId: 'b', projectPath: '/Users/demo/app', projectId: 'p' },
    c: { sessionId: 'c', projectPath: '/Users/demo/other', projectId: 'q' },
  };
  const terminalEntry = session => ({ session, element: element(), terminal: { focus() {} } });
  const context = vm.createContext({
    console, Map, Set, WeakSet, JSON, Promise,
    document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // app.js
    activeTab: tab, activeSessionId: null, projectsChangedWhileAway: away,
    REMEMBERED_TABS: ['sessions', 'projects'], LAST_TAB_KEY: 'lastTab',
    searchInput: element(), searchBar: element(), searchMatchIds: null, searchMatchProjectPaths: null,
    sidebarContent: element(), projectsContent: { ...element(), querySelectorAll: () => [] },
    plansContent: element(), statsContent: element(), memoryContent: element(),
    filesFilters: null, plansFilters: null, sessionFilters: element(), donateBar: null,
    placeholder: element(), terminalsEl: element(), terminalHeader: element(), gridViewActive: false,
    openSessions: new Map(Object.values(sessions).map(s => [s.sessionId, terminalEntry(s)])),
    sessionMap: new Map(Object.values(sessions).map(s => [s.sessionId, s])),
    cachedProjectTree: { projects: [PROJECT_P, PROJECT_Q] },
    cachedProjectTreeAll: { projects: [PROJECT_P, PROJECT_Q] },
    resetSearchExclusions() {}, updateSearchActions() {}, restoreTerminalArea() {},
    loadPlans() {}, loadFiles() {}, showStatsPage() {},
    loadProjects: () => { calls.loaded++; return Promise.resolve(); },
    setActiveSession: id => { context.activeSessionId = id; },
    clearNotifications: id => calls.cleared.push(id),
    // projects-view.js, around the functions taken from it
    projectsUi: { selectedProjectId: selected, navigationByProject: new Map(), trackByProject: {}, working: false },
    saveProjectsUi() {}, renderProjectList() {}, leaveProjectViews() {}, hideAllViewers() {},
    showProjectOverview: () => { calls.overviewPages++; },
    // terminal-manager.js, around showSession
    hidePlanViewer() {}, showTerminalHeader() {}, fitAndScroll() {}, onSessionShown() {},
    // session-overview.js, for its real unmount
    addEventListener() {}, removeEventListener() {}, clearInterval() {}, cancelAnimationFrame() {},
  });
  context.window = context;
  vm.runInContext([
    'const PROJECT_WORKSPACE_TABS = new Set(["overview", "session", "plan", "todos", "files", "git", "knowledge", "env", "settings"]);',
    body(projects, 'function isPathInside('),
    body(projects, 'function findTreeProject('),
    body(projects, 'function selectedProject('),
    body(projects, 'function projectForSession('),
    body(projects, 'function setProjectTab('),
    body(projects, 'function projectNavigation('),
    body(projects, 'function rememberProjectSession('),
    body(projects, 'function projectTabSession('),
    body(projects, 'function showRememberedProjectView('),
    body(projects, 'function showProjectHome('),
    body(terminal, 'function showSession('),
    model.slice(model.indexOf('function createOverviewLifecycle(')),
  ].join('\n'), context);
  // Every showSession that gets past the overview's routing reaches this one.
  const realShowSession = context.showSession;
  context.showSession = id => { calls.shown.push(id); return realShowSession(id); };
  const tabHandlers = app.slice(
    app.indexOf("document.querySelectorAll('.sidebar-tab').forEach(tab => {"),
    app.indexOf('// Plans & viewer helpers'),
  );
  assert.ok(tabHandlers.includes("tabName === 'projects'"));
  vm.runInContext(tabHandlers, context);
  context.loadOverviewPrefs = () => ({});
  vm.runInContext(overview, context);
  ready();
  if (remembered) vm.runInContext(`rememberProjectSession(projectsUi.selectedProjectId, ${JSON.stringify(remembered)});`, context);
  // The overview is open; mounting it needs a real page. Unmounting it with no
  // card drawn (`realUnmount`) does not.
  vm.runInContext(`overviewLifecycle = createOverviewLifecycle({ mount() {}, unmount: ${realUnmount ? 'unmountSessionOverview' : '() => {}'} }); overviewLifecycle.open();`, context);
  assert.equal(vm.runInContext('isSessionOverviewOpen()', context), true);
  const run = code => vm.runInContext(code, context);
  return { context, calls, run };
}

test('opening a session from the overview shows and clears only that session', () => {
  for (const { label, selected, remembered, open, project } of [
    { label: 'same project', selected: 'p', remembered: 'b', open: 'a', project: 'p' },
    { label: 'another project', selected: 'p', remembered: 'b', open: 'a2', project: 'q' },
    { label: 'no project', selected: 'q', remembered: 'c', open: 'solo', project: null },
  ]) {
    const { context, calls, run } = harness({ selected, remembered });
    run(`openSessionNormally(${JSON.stringify(open)})`);
    assert.deepEqual(calls.cleared, [open], label);
    assert.deepEqual(calls.shown, [open], label);
    assert.equal(context.activeTab, 'projects', label);
    assert.equal(context.activeSessionId, open, label);
    assert.equal(run('isSessionOverviewOpen()'), false, label);
    if (project) {
      // The Projects tab is on the session's project, its Session tab on this session.
      assert.equal(context.projectsUi.selectedProjectId, project, label);
      assert.deepEqual({ ...run(`projectNavigation(${JSON.stringify(project)})`) }, { tab: 'session', sessionId: open }, label);
    } else {
      // A session with no project leaves the selected project and what it remembers alone.
      assert.equal(context.projectsUi.selectedProjectId, selected, label);
      assert.deepEqual({ ...run(`projectNavigation(${JSON.stringify(selected)})`) }, { tab: 'session', sessionId: remembered }, label);
      assert.equal(calls.overviewPages, 0, label);
    }
  }
});

test('changes seen while away are caught up without showing the remembered session later', async () => {
  for (const open of ['a', 'solo']) {
    const { context, calls, run } = harness({ selected: 'q', remembered: 'c', away: true, tab: 'plans' });
    run(`openSessionNormally(${JSON.stringify(open)})`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.loaded, 1, open);
    assert.equal(context.projectsChangedWhileAway, false, open);
    assert.deepEqual(calls.cleared, [open], open);
    assert.deepEqual(calls.shown, [open], open);
  }
});

test('the Projects tab already open still shows the session once', () => {
  const { calls, run } = harness({ selected: 'p', remembered: 'b', tab: 'projects' });
  run('openSessionNormally("a")');
  assert.deepEqual(calls.cleared, ['a']);
  assert.deepEqual(calls.shown, ['a']);
});

test('closing onto a page with no session leaves no session header behind', () => {
  // The Projects tab with no project selected shows the placeholder. Every
  // terminal went back out of view with the page, so the single view's header
  // must go too.
  const { context, run } = harness({ selected: null, remembered: null, realUnmount: true });
  // The start showed the active session (showSession) before the page opened over it.
  context.terminalHeader.style.display = '';
  // hideAllViewers closes the page (hideViewerPanels' hook).
  context.hideAllViewers = () => run("closeSessionOverview('page')");
  context.document.querySelector('.sidebar-tab[data-tab="projects"]').click();
  assert.equal(context.activeTab, 'projects');
  assert.equal(run('isSessionOverviewOpen()'), false);
  assert.equal(context.placeholder.style.display, '');
  assert.equal(context.terminalHeader.style.display, 'none');
});
