const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { parsePlan, parseTodos } = require('../public/plan-parser');

// Arrays built inside a vm context have that context's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

const source = fs.readFileSync(path.join(__dirname, '../public/projects-view.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `markers ${from} … ${to}`);
  return source.slice(start, end);
};

// --- Navigation: the Session tab and the session it remembers ---

function navigation({ open = ['s1'] } = {}) {
  const project = { id: 'p1' };
  const sessions = new Map([['s1', { sessionId: 's1', projectId: 'p1' }], ['s2', { sessionId: 's2', projectId: 'p2' }]]);
  const context = vm.createContext({
    projectsUi: { selectedProjectId: 'p1', navigationByProject: new Map() },
    openSessions: new Map(open.map(id => [id, { session: sessions.get(id) }])),
    sessionMap: sessions,
    projectForSession: session => session ? { project: { id: session.projectId } } : null,
  });
  vm.runInContext(between('const PROJECT_WORKSPACE_TABS', 'const projectViewer = document.getElementById'), context);
  return { context, project };
}

test('opening a session selects the Session tab and leaving it keeps the session', () => {
  const { context, project } = navigation();
  context.rememberProjectSession(project, 's1');
  assert.equal(context.projectTab(project), 'session');
  assert.equal(context.projectTabSession(project)?.sessionId, 's1');

  context.setProjectTab(project, 'plan');
  context.rememberProjectOverview(project);
  assert.equal(context.projectTab(project), 'plan', 'another tab stays where the user put it');
  assert.equal(context.projectNavigation(project).sessionId, 's1', 'the Session tab can bring it back');

  context.setProjectTab(project, 'session');
  context.rememberProjectOverview(project);
  assert.equal(context.projectTab(project), 'overview', 'the page never stays on Session without the terminal');
});

test('a session whose terminal is gone takes the Session tab with it', () => {
  const { context, project } = navigation({ open: [] });
  context.rememberProjectSession(project, 's1');
  assert.equal(context.projectTabSession(project), null, 'no open terminal, nothing to show');

  const live = navigation();
  live.context.rememberProjectSession(live.project, 's1');
  live.context.forgetProjectSessionState('s1');
  assert.equal(live.context.projectTab(live.project), 'overview');
  assert.equal(live.context.projectNavigation(live.project).sessionId, null);
});

test("the Session tab only shows the project's own session", () => {
  const { context, project } = navigation({ open: ['s2'] });
  context.rememberProjectSession(project, 's2');
  assert.equal(context.projectTabSession(project), null);
});

// --- The project row's second line: numbers only, the word on hover ---

function subline({ files = {}, tracks = 0, sessions = 0, tail = '7m ago' } = {}) {
  const context = vm.createContext({
    parsePlan, parseTodos,
    fileContent: (_project, name) => files[name] ?? null,
    projectSessionsAll: p => p.sessions,
    escapeHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  });
  vm.runInContext(between('function projectRowStats(', '/** What follows the numbers'), context);
  vm.runInContext(between('function projectSubline(', '/** Put the current second line on a row'), context);
  vm.runInContext(between('function projectDrawerStats(', '/**\n * The drawer under a project row'), context);
  context.projectSublineTail = () => tail;
  const project = { id: 'p1', tracks: Array.from({ length: tracks }, (_, i) => ({ id: 't' + i })), sessions: Array.from({ length: sessions }, (_, i) => ({ sessionId: 's' + i })) };
  return { text: context.projectSubline(project), html: context.projectSublineHtml(project) };
}

test('the second line lists plan, todos, tracks and sessions as numbers, then the time', () => {
  const { text, html } = subline({
    files: { 'plan-tracker.md': '## [x] Phase 1: One\n- [x] a\n\n## Phase 2: Two\n- [ ] b\n', 'todos.md': '- [ ] a\n- [x] b\n- [ ] c\n' },
    tracks: 3, sessions: 36,
  });
  assert.equal(text, 'Plan 1/2 · Todos 2/3 · Tracks 3 · Sessions 36 · 7m ago');
  const shown = html.replace(/<span class="proj-stat-label">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '');
  assert.equal(shown, '1/2 · 2/3 · 3 · 36 · 7m ago', 'without the pointer only the numbers show');
  assert.match(html, /data-stat="plan"><span class="proj-stat-label">Plan&nbsp;<\/span>1\/2/);
  assert.match(html, /data-stat="sessions"><span class="proj-stat-label">Sessions&nbsp;<\/span>36/);
});

test('none is a long dash, and unread plan files show as still loading', () => {
  const empty = subline({ files: { 'plan-tracker.md': '', 'todos.md': '' } });
  assert.equal(empty.text, 'Plan — · Todos — · Tracks — · Sessions — · 7m ago');
  const loading = subline({ files: {}, tracks: 1, sessions: 2, tail: '' });
  assert.equal(loading.text, 'Plan … · Todos … · Tracks 1 · Sessions 2');
});

// --- Redrawing a drawer ---

function redraw(current, next) {
  const replaced = [];
  const el = { innerHTML: current, replaceChildren: (...nodes) => replaced.push(nodes) };
  const context = vm.createContext({});
  vm.runInContext(between('function replaceDrawerContent(', 'const projectCountsLoading'), context);
  const changed = context.replaceDrawerContent(el, { innerHTML: next, childNodes: ['bar', 'list'] });
  return { changed, replaced };
}

test('a drawer whose rows did not change is left alone', () => {
  const { changed, replaced } = redraw('<b>same</b>', '<b>same</b>');
  assert.equal(changed, false);
  assert.equal(replaced.length, 0, 'no flicker under the pointer while a session writes');
});

test('a changed drawer gets the new content', () => {
  const { changed, replaced } = redraw('<b>old</b>', '<b>new</b>');
  assert.equal(changed, true);
  assert.deepEqual(replaced, [['bar', 'list']]);
});

// --- The sidebar search opens the drawers that hold matches ---

function drawers({ matches = null, expanded = {} } = {}) {
  const projects = [
    { id: 'p1', sessions: [{ sessionId: 'a' }], tracks: [{ sessions: [{ sessionId: 'b', archived: 1 }] }] },
    { id: 'p2', sessions: [{ sessionId: 'c' }], tracks: [] },
  ];
  let renders = 0;
  const context = vm.createContext({
    searchMatchIds: matches ? new Set(matches) : null,
    projectsUi: { expandedProjects: { ...expanded }, searchDrawerOverride: new Map() },
    cachedProjectTreeAll: { projects },
    projectSessionsAll: p => [...p.sessions, ...p.tracks.flatMap(t => t.sessions)],
    sessionEventTime: () => 0,
    findTreeProject: id => projects.find(p => p.id === id),
    saveProjectsUi() {},
    renderProjectList: () => renders++,
  });
  vm.runInContext(between('function projectSearchMatches(', '/** Plan phases done of all'), context);
  return { context, projects, renders: () => renders };
}

test('without a search only the chevron opens a drawer', () => {
  const { context, projects } = drawers({ expanded: { p2: true } });
  assert.equal(context.projectDrawerOpen(projects[0]), false);
  assert.equal(context.projectDrawerOpen(projects[1]), true);
  context.toggleProjectDrawer('p1');
  assert.equal(context.projectDrawerOpen(projects[0]), true);
  assert.equal(context.projectsUi.expandedProjects.p1, true);
});

test('during a search the matches show under the rows, so drawers stay closed', () => {
  const { context, projects } = drawers({ matches: ['a'], expanded: { p1: true } });
  assert.equal(context.projectDrawerOpen(projects[0]), false, 'an open drawer would list the matches twice');
  context.searchMatchIds = null;
  assert.equal(context.projectDrawerOpen(projects[0]), true, 'and comes back after the search');
});

test('the chevron still opens a drawer during a search, for that search only', () => {
  const { context, projects } = drawers({ matches: ['a'] });
  context.toggleProjectDrawer('p1');
  assert.equal(context.projectDrawerOpen(projects[0]), true);
  assert.equal(context.projectsUi.expandedProjects.p1, true, 'and is remembered after the search');
});

// --- "No project": the sessions outside every project ---

function others({ matches = null, archived = false, excluded = [] } = {}) {
  const at = t => ({ t });
  const folders = [
    { projectPath: '/w/old', sessions: [{ sessionId: 'o1', ...at(10) }] },
    { projectPath: '/w/app', sessions: [{ sessionId: 'a1', ...at(20) }, { sessionId: 'a2', ...at(50), projectId: 'p1' }, { sessionId: 'a3', ...at(30) }] },
    { projectPath: '/w/filed', sessions: [{ sessionId: 'f1', ...at(99), projectId: 'p1' }] },
  ];
  const all = [...folders, { projectPath: '/w/archive', sessions: [{ sessionId: 'z1', archived: 1, ...at(5) }] }];
  const context = vm.createContext({
    searchMatchIds: matches ? new Set(matches) : null,
    showArchived: archived,
    cachedProjects: folders,
    cachedAllProjects: all,
    projectForSession: s => (s.projectId ? { project: { id: s.projectId } } : null),
    sessionEventTime: s => s.t,
    projectsUi: { otherOpen: false, searchDrawerOverride: new Map() },
    searchExcluded: { sessions: new Set(excluded), projects: new Set() },
  });
  vm.runInContext(between('function sessionsWithoutProject(', 'function toggleOtherSessions('), context);
  return context;
}

test('sessions outside every project, by folder, newest folder and session first', () => {
  const groups = others().sessionsWithoutProject();
  assert.deepEqual(plain(groups.map(g => [g.folder.projectPath, g.sessions.map(s => s.sessionId)])), [
    ['/w/app', ['a3', 'a1']],
    ['/w/old', ['o1']],
  ], 'a session filed in a project and a folder with only those stay out');
});

test('archived sessions follow the Archive switch, and a search narrows the list', () => {
  assert.deepEqual(plain(others({ archived: true }).sessionsWithoutProject().map(g => g.folder.projectPath)), ['/w/app', '/w/old', '/w/archive']);
  const searching = others({ matches: ['o1', 'z1'] });
  assert.deepEqual(plain(searching.sessionsWithoutProject().map(g => g.sessions.map(s => s.sessionId))), [['o1'], ['z1']]);
  assert.equal(searching.otherSessionsOpen(), true, 'a search opens the row');
  assert.deepEqual(plain(others({ matches: ['o1', 'z1'], excluded: ['z1'] }).sessionsWithoutProject().map(g => g.sessions.map(s => s.sessionId))), [['o1']], 'a match left out with its X stays out');
  assert.equal(others().otherSessionsOpen(), false, 'closed by default');
});

// --- Cmd+Shift+[ / ] while a session is open ---

function navRows({ drawerOpen }) {
  const project = { id: 'p1' };
  const context = vm.createContext({
    selectedProject: () => project,
    paneGroupMode: () => 'time',
    groupSessions: () => [{ sessions: [{ sessionId: 'a' }, { sessionId: 'b' }] }, { sessions: [{ sessionId: 'c' }] }],
    document: {
      getElementById: id => (drawerOpen && id === 'proj-drawer-p1'
        ? { querySelectorAll: () => [{ dataset: { sessionId: 'c' } }, { dataset: { sessionId: 'a' } }] }
        : null),
    },
  });
  vm.runInContext(between('function workingSessionNavRows(', 'function selectProject('), context);
  return [...context.workingSessionNavRows()].map(row => row.dataset.sessionId);
}

test('session navigation follows the open drawer, or its grouping when closed', () => {
  assert.deepEqual(navRows({ drawerOpen: true }), ['c', 'a']);
  assert.deepEqual(navRows({ drawerOpen: false }), ['a', 'b', 'c']);
});

function tabRows({ working = false, active = null, viewerShown = true }) {
  const row = id => ({ dataset: { sessionId: id } });
  const context = vm.createContext({
    projectsUi: { working },
    workingSessionNavRows: () => [row('drawer')],
    activeSessionId: active,
    sessionMap: new Map([['loose', { sessionId: 'loose' }], ['filed', { sessionId: 'filed', projectId: 'p1' }]]),
    projectForSession: s => (s.projectId ? { project: { id: s.projectId } } : null),
    projectViewer: { style: { display: viewerShown ? 'flex' : 'none' }, querySelectorAll: () => [row('card')] },
    document: { getElementById: id => (id === 'proj-drawer-other' ? { querySelectorAll: () => [row('other')] } : null) },
  });
  vm.runInContext(between('function projectsTabNavRows(', 'function workingSessionNavRows('), context);
  return plain(context.projectsTabNavRows().map(r => r.dataset.sessionId));
}

test('in the Projects tab, navigation follows the list the session on screen came from', () => {
  assert.deepEqual(tabRows({ working: true }), ['drawer'], 'Session tab: the project drawer');
  assert.deepEqual(tabRows({ active: 'loose', viewerShown: false }), ['other'], 'a session outside every project: the No project list');
  assert.deepEqual(tabRows({ active: 'filed' }), ['card'], 'the page: its track cards');
});

// --- Starred projects ---

function starContext() {
  const context = vm.createContext({
    escapeHtml: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    starIconSvg: filled => `<svg data-filled="${filled}"></svg>`,
  });
  vm.runInContext(between('function projectStarHtml(', '/** Star a project, or take its star off'), context);
  return context;
}

test('starred projects at work get a section of their own above Active, newest first', () => {
  const { projectListGroups } = starContext();
  const time = { a: 1, b: 5, c: 3, d: 9, e: 2, f: 4, g: 7, h: 8 };
  const projects = [
    { id: 'a', status: 'active', starred: true },
    { id: 'b', status: 'active' },
    { id: 'c', status: 'active', starred: true },
    { id: 'd', status: 'active' },
    { id: 'e', status: 'active', starred: true, snoozedUntil: '2026-12-02T08:00:00.000Z' },
    { id: 'f', status: 'active', snoozedUntil: '2026-12-01T08:00:00.000Z' },
    { id: 'g', status: 'done', starred: true },
    { id: 'h', status: 'done' },
  ];
  const groups = projectListGroups(projects, { isSnoozed: p => !!p.snoozedUntil, sortTime: p => time[p.id] });
  const ids = list => plain(list).map(p => p.id);
  assert.deepEqual(ids(groups.starred), ['c', 'a']);
  assert.deepEqual(ids(groups.active), ['d', 'b']);
  assert.deepEqual(ids(groups.snoozed), ['e', 'f'], 'a snoozed project stays on its shelf, starred ones first');
  assert.deepEqual(ids(groups.done), ['g', 'h'], 'a finished one too, though h moved later');
});

test("a project row's star says what a click does, and is filled once starred", () => {
  const { projectStarHtml } = starContext();
  const off = projectStarHtml({ name: 'A & B', starred: false });
  assert.match(off, /class="proj-star"/);
  assert.match(off, /title="Star project"/);
  assert.match(off, /aria-label="Star A &amp; B"/);
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, /data-filled="false"/);
  const on = projectStarHtml({ name: 'A', starred: true });
  assert.match(on, /class="proj-star starred"/);
  assert.match(on, /title="Unstar project"/);
  assert.match(on, /aria-pressed="true"/);
  assert.match(on, /data-filled="true"/);
});
