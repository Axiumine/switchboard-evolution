// The Session Overview's group headers (public/session-overview-groups.js): a
// folder's or a project's + and ⋯, and nothing for the other groups. Also the
// cards' menus, which end with "Leave out of this search" during a search
// (overviewLeaveOutItems, public/session-overview-panel.js). The menus are
// built in a vm against stubs; the headers themselves are checked in the app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const groupsSource = read('session-overview-groups.js');
const overviewSource = read('session-overview.js');
const panelSource = read('session-overview-panel.js');
const closedSource = read('session-overview-closed.js');

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}

/** A line of a source, from its start to its end. */
function line(source, start) {
  const at = source.indexOf(start);
  assert.ok(at !== -1, `${start} not found`);
  return source.slice(at, source.indexOf('\n', at) + 1);
}

// Icons are their names: the menus are compared by label.
const icons = new Proxy({}, { get: (_, name) => () => `<${String(name)}>` });

const FOLDER = '/work/demo-app';
const WORKTREE = '/work/demo-app/.claude/worktrees/fix-login';
const PROJECT = { id: 'p1', name: 'Demo', root: '/work/demo' };

function groups({ folders = {}, schedules = [], running = 0 } = {}) {
  const calls = [];
  const call = name => (...args) => { calls.push([name, ...args]); };
  const context = vm.createContext({
    WeakMap, PICONS: icons, ICONS: icons,
    findProject: projectPath => folders[projectPath] || null,
    overviewFolderFor: projectPath => ({ projectPath, sessions: [], madeUp: true }),
    runningTaskCount: () => running,
    schedulesForFolder: () => schedules,
    scheduleMenuItems: (list, place) => [{ label: 'schedules', list, place }],
    findTreeProject: id => (id === PROJECT.id ? PROJECT : null),
    newSessionItems: project => [{ label: `new in ${project.name}` }],
    projectMenuItems: project => [{ label: `menu of ${project.name}` }],
    showOverviewNewSessionPopover: call('showOverviewNewSessionPopover'),
    showTaskPopover: call('showTaskPopover'),
    showScheduleDialog: call('showScheduleDialog'),
    openSettingsViewer: call('openSettingsViewer'),
    archiveFolderSessions: call('archiveFolderSessions'),
    hideWorktree: call('hideWorktree'),
    showContextMenu: call('showContextMenu'),
  });
  vm.runInContext(line(overviewSource, 'const OV_WORKTREE_PATH = '), context);
  vm.runInContext(groupsSource, context);
  return { context, calls };
}

// Array.from: the vm's arrays are of another realm, which deepEqual tells apart.
const labels = items => Array.from(items, item => (item.sep ? '—' : item.label));

test("a folder's ⋯ has New session…, its tasks, its schedules, Folder settings and Archive all sessions…", () => {
  const anchor = { name: 'the ⋯' };
  const { context, calls } = groups();
  const group = { key: FOLDER, label: 'demo-app', kind: 'folder', path: FOLDER };
  const items = context.overviewGroupMenuItems(group, anchor);
  assert.deepEqual(labels(items), [
    'New session…', 'Set up project tasks', 'New scheduled task…', 'Folder settings', '—', 'Archive all sessions…',
  ]);
  for (const item of items) item.onClick?.();
  const folder = { projectPath: FOLDER, sessions: [], madeUp: true };
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['showOverviewNewSessionPopover', folder, anchor],
    ['showTaskPopover', folder, anchor],
    ['showScheduleDialog', { cwd: FOLDER }],
    ['openSettingsViewer', 'project', FOLDER],
    ['archiveFolderSessions', FOLDER],
  ]);
});

test("a folder's tasks and schedules, when it has some, and a worktree's Hide worktree", () => {
  const listed = { projectPath: WORKTREE, sessions: [], hasTaskFile: true };
  const schedules = [{ id: 's1' }, { id: 's2' }];
  const { context, calls } = groups({ folders: { [WORKTREE]: listed }, schedules, running: 2 });
  const anchor = {};
  const items = context.overviewGroupMenuItems({ key: WORKTREE, label: 'demo-app · worktree fix-login', kind: 'folder', path: WORKTREE }, anchor);
  assert.deepEqual(labels(items), [
    'New session…', 'Run project task', 'Scheduled tasks', 'Folder settings', '—', 'Archive all sessions…', 'Hide worktree',
  ]);
  assert.equal(items[1].hint, '2 running');
  assert.equal(items[2].hint, '2');
  assert.deepEqual(JSON.parse(JSON.stringify(items[2].submenu)), [{ label: 'schedules', list: schedules, place: { cwd: WORKTREE } }]);
  items[0].onClick();
  items[6].onClick();
  assert.equal(calls[0][1], listed, 'the folder as the Sessions lists hold it, with its tasks');
  assert.deepEqual(calls[1], ['hideWorktree', WORKTREE]);
});

test("a folder's + is its New session popover", () => {
  const { context, calls } = groups();
  const anchor = {};
  context.overviewGroupNew({ key: FOLDER, kind: 'folder', path: FOLDER }, anchor);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'showOverviewNewSessionPopover');
  assert.equal(calls[0][1].projectPath, FOLDER);
  assert.equal(calls[0][2], anchor);
});

test("a project's + is its New session menu and its ⋯ its right-click menu", () => {
  const { context, calls } = groups();
  const anchor = {};
  const group = { key: PROJECT.id, label: PROJECT.name, kind: 'project', projectId: PROJECT.id };
  assert.deepEqual(labels(context.overviewGroupMenuItems(group, anchor)), ['menu of Demo']);
  context.overviewGroupNew(group, anchor);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['showContextMenu', [{ label: 'new in Demo' }], { anchor: {} }]]);
  assert.equal(calls[0][2].anchor, anchor);
  // A project gone from the tree: nothing.
  assert.deepEqual(labels(context.overviewGroupMenuItems({ ...group, projectId: 'gone' }, anchor)), []);
});

test('the other groups have no + and no menu', () => {
  const { context, calls } = groups();
  const others = [
    { key: 'claude', label: 'Claude', kind: 'other' },
    { key: '__no-project__', label: 'No project', kind: 'other' },
    { key: '__all__', label: '', kind: 'none' },
    // Sessions with no folder.
    { key: '', label: 'No folder', kind: 'folder', path: '' },
  ];
  for (const group of others) {
    assert.equal(context.overviewGroupHasActions(group), false, group.label);
    assert.deepEqual(labels(context.overviewGroupMenuItems(group, {})), [], group.label);
    context.overviewGroupNew(group, {});
  }
  assert.deepEqual(calls, []);
});

test("a card's menu ends with Leave out of this search only during a search", () => {
  const refreshed = [];
  const context = vm.createContext({
    Set, PICONS: icons,
    OV_ICONS: { openInProject: '', maximize: '' },
    sessionMenuItems: () => [{ label: 'Rename…' }],
    refreshSessionOverview: () => refreshed.push('page'),
    document: { getElementById: () => null },
  });
  vm.runInContext([
    'let overviewSearch = null;',
    'const overviewLeftOut = new Set();',
    body(panelSource, 'function overviewLeaveOutItems('),
    body(panelSource, 'function leaveOutOfOverviewSearch('),
    body(panelSource, 'function refreshOverviewTab('),
    body(panelSource, 'function refreshOverviewPanel('),
    body(panelSource, 'function overviewPanelShown('),
    body(overviewSource, 'function overviewCardMenuItems('),
  ].join('\n'), context);
  const run = code => vm.runInContext(code, context);

  const menu = () => labels(run('overviewCardMenuItems({ sessionId: "a" })'));
  assert.deepEqual(menu(), ['Open in project', 'Maximize', '—', 'Rename…']);
  run('overviewSearch = { query: "api", ids: new Set(["a"]) }');
  assert.deepEqual(menu(), ['Open in project', 'Maximize', '—', 'Rename…', '—', 'Leave out of this search']);

  run('overviewCardMenuItems({ sessionId: "a" }).at(-1).onClick()');
  assert.deepEqual([...run('overviewLeftOut')], ['a']);
  assert.deepEqual(refreshed, ['page'], 'the page is drawn again, and the panel with it');
});

test("a closed card's Leave out takes the earlier sessions it stands for too", () => {
  const context = vm.createContext({
    Map, Set, Promise, Date, setTimeout: () => 1, clearTimeout() {},
    PICONS: icons,
    sessionMenuItems: () => [{ label: 'Rename…' }],
  });
  context.window = context;
  vm.runInContext(closedSource, context);
  const left = [];
  context.overviewLeaveOutItems = ids => [{ label: 'Leave out of this search', onClick: () => left.push(...ids) }];
  vm.runInContext('ovClosed.cards.set("c", { el: null, card: { id: "c", earlierIds: ["c1", "c2"] } })', context);
  const items = context.overviewClosedMenuItems({ sessionId: 'c' });
  assert.deepEqual(labels(items), ['Resume', '—', 'Rename…', 'Leave out of this search']);
  items.at(-1).onClick();
  assert.deepEqual(left, ['c', 'c1', 'c2']);
});

test('the page loads the group headers after the other overview scripts', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  const at = scripts.indexOf('session-overview-groups.js');
  assert.ok(at !== -1);
  for (const other of ['session-overview.js', 'session-overview-panel.js', 'session-overview-closed.js']) {
    assert.ok(at > scripts.indexOf(other), other);
  }
  assert.ok(body(overviewSource, 'function ensureOverviewGroup(')
    .includes("if (typeof decorateOverviewGroupHeader === 'function') decorateOverviewGroupHeader(header, group);"));
});

test('a session launched while the page is open is new until the render that puts it on top', () => {
  const container = () => ({ classList: { contains: name => name === 'terminal-container' } });
  const entry = id => ({ element: container(), session: { sessionId: id } });
  const entries = { launched: entry('launched'), resumed: entry('resumed'), restored: entry('restored'), attached: entry('attached') };
  const context = vm.createContext({
    Set, WeakSet,
    ovState: { bornHere: new WeakSet(), newIds: new Set() },
    openSessions: new Map(Object.entries(entries)),
    // Launched here: pending, no PTY yet. A terminal from an earlier run: pending, restored.
    // A terminal running in main, attached now: pending, with its PTY. A resumed session: not pending.
    pendingSessions: new Map([['launched', {}], ['restored', { restored: true }], ['attached', {}]]),
    activePtyIds: new Set(['attached']),
  });
  vm.runInContext(body(overviewSource, 'function noteNewTerminals('), context);
  const added = Object.values(entries).map(e => e.element);
  assert.equal(context.noteNewTerminals([{ addedNodes: added }]), true);
  assert.deepEqual([...context.ovState.newIds], ['launched']);
  for (const e of Object.values(entries)) assert.ok(context.ovState.bornHere.has(e));

  // The model is told, and the render forgets them once it has placed them.
  assert.ok(body(overviewSource, 'function overviewContext(').includes('newIds: ovState.newIds,'));
  const render = body(overviewSource, 'function renderSessionOverview(');
  const built = render.indexOf('const model = buildOverview(');
  assert.ok(built !== -1 && render.indexOf('ovState.newIds.clear();') > built);
});
