// The Worktrees view's repository tabs: a tab is a repository (a group by its
// git common directory), and the selection, shared with History and Pull
// Requests as folder paths, is mapped to the groups through the folders
// attached to each. Loaded in a vm context like project-worktrees-view.test.js,
// with the shared selection and color modules and the tabs' helpers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const utilsSource = read('utils.js');
const cliTable = utilsSource.slice(utilsSource.indexOf('// --- CLIs ---'), utilsSource.indexOf('// --- end CLIs ---'));

function loadContext(extra = {}) {
  const icon = name => () => `<svg data-icon="${name}"></svg>`;
  const menus = [];
  const context = vm.createContext({
    window: { api: { platform: 'darwin' } },
    RepoSelection: require('../public/repo-selection'),
    RepoColors: require('../public/repo-colors'),
    escapeHtml: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    escapeAttr: (str) => String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    pathBasename: (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '',
    isPathInside: (child, root) => child === root || child.startsWith(root + '/'),
    formatDate: () => '2d ago',
    PICONS: new Proxy({}, { get: (_t, name) => icon(name) }),
    ICONS: new Proxy({}, { get: (_t, name) => icon(`ICONS.${name}`) }),
    showContextMenu: (items) => menus.push(items),
    ...extra,
  });
  vm.runInContext(cliTable, context);
  vm.runInContext(read('git-repo-tabs.js'), context);
  vm.runInContext(read('project-worktrees-view.js'), context);
  context.menus = menus;
  return context;
}

const plain = value => JSON.parse(JSON.stringify(value));

function wt(p, extra = {}) {
  return {
    path: p, head: 'abcdef1234567890', branch: '', detached: false, bare: false,
    locked: false, lockReason: '', prunable: false, prunableReason: '', isMain: false,
    exists: true, kind: 'classic', attached: false, dirty: false, ahead: null, behind: null,
    lastCommit: null, created: null, ...extra,
  };
}

/** A repository group as worktrees.js describes it (made-up paths). */
function group(name, extra = {}) {
  const main = wt(`/code/${name}`, { isMain: true, branch: 'main', kind: 'main' });
  return {
    id: `/code/${name}/.git`, commonDir: `/code/${name}/.git`, name, mainPath: `/code/${name}`, nested: false,
    attachedFolders: [`/code/${name}`], worktrees: [main, wt(`/code/${name}.worktrees/feat`, { branch: `${name}-feat` })], ...extra,
  };
}

const API = group('api');
const WEB = group('web');
const DOCS = group('docs');
const project = { id: 'p1', root: '/code/api', folders: [{ path: '/code/api' }, { path: '/code/web' }, { path: '/code/docs' }] };

function stateOf(ctx, repositories, selection = {}) {
  const state = ctx.wtTabState('p1');
  state.repositories = repositories;
  state.settings = {};
  state.selectedRepo = selection.primary ?? null;
  state.selectedRepos = selection.paths ?? [];
  return state;
}

const names = (groups) => plain(groups.map(g => g.name));
const rowsIn = (html) => [...html.matchAll(/<span class="wt-row-label[^"]*">([^<]+)<\/span>/g)].map(m => m[1]);

test('a tab is a repository, keyed by the folder it is attached as, or its git directory when it was found inside a folder', () => {
  const ctx = loadContext();
  assert.equal(ctx.wtGroupKey(API), '/code/api');
  // Attached twice (the clone and a worktree of it): the first folder keys it.
  const twice = group('app', { attachedFolders: ['/code/app', '/code/app.worktrees/feat'] });
  assert.equal(ctx.wtGroupKey(twice), '/code/app');
  // Found inside a folder that is not itself a repository: its git directory.
  const nested = group('lib', { nested: true, attachedFolders: ['/code/mono'] });
  assert.equal(ctx.wtGroupKey(nested), '/code/lib/.git');
  assert.deepEqual(plain(ctx.wtSelectionForGroup(nested)), { primary: '/code/lib/.git', paths: ['/code/lib/.git'] });
  assert.deepEqual(plain(ctx.wtTabRepos([API, nested])), [
    { path: '/code/api', label: 'api', title: '/code/api' },
    { path: '/code/lib/.git', label: 'lib', title: '/code/lib' },
  ]);
});

test('a selection of folder paths names a repository through any folder attached to it', () => {
  const ctx = loadContext();
  const twice = group('app', { attachedFolders: ['/code/app', '/code/app.worktrees/feat'] });
  assert.equal(ctx.wtGroupSelected(twice, ['/code/app.worktrees/feat']), true);
  assert.equal(ctx.wtGroupSelected(twice, ['/code/app']), true);
  assert.equal(ctx.wtGroupSelected(twice, ['/code/web']), false);
  assert.equal(ctx.wtGroupSelected(twice, ['/code/app/.git']), true, 'its git directory too');
  assert.equal(ctx.wtGroupSelected(twice, []), false);
});

test('the list shows only the repository selected, the first one when the selection names none', () => {
  const ctx = loadContext();
  const state = stateOf(ctx, [API, WEB, DOCS], { primary: '/code/web', paths: ['/code/web'] });
  assert.deepEqual(names(ctx.wtShownGroups(state)), ['web']);
  let html = ctx.wtListHtml(project, state);
  assert.deepEqual(rowsIn(html), ['main', 'web-feat']);
  assert.doesNotMatch(html, /api-feat|docs-feat/);
  // Nothing of this project selected (a repository History had that is not one here): the first.
  state.selectedRepo = '/elsewhere';
  state.selectedRepos = ['/elsewhere'];
  assert.deepEqual(names(ctx.wtShownGroups(state)), ['api']);
  // No selection yet: the first too.
  state.selectedRepo = null;
  state.selectedRepos = [];
  html = ctx.wtListHtml(project, state);
  assert.match(html, /api-feat/);
  assert.doesNotMatch(html, /web-feat/);
});

test('the checkbox widens the filter: several repositories are listed, in the tabs\' order', () => {
  const ctx = loadContext();
  const state = stateOf(ctx, [API, WEB, DOCS], { primary: '/code/docs', paths: ['/code/docs', '/code/api'] });
  assert.deepEqual(names(ctx.wtShownGroups(state)), ['api', 'docs']);
  const html = ctx.wtListHtml(project, state);
  assert.deepEqual([...html.matchAll(/<span class="wt-repo-name">([^<]+)</g)].map(m => m[1]), ['api', 'docs']);
  assert.deepEqual(names(ctx.wtGroups(state).map(g => g.repo)), ['api', 'docs']);
});

test('the filter and the search work inside the repositories shown', () => {
  const ctx = loadContext();
  const state = stateOf(ctx, [API, WEB], { primary: '/code/api', paths: ['/code/api'] });
  state.query = 'feat';
  assert.deepEqual(rowsIn(ctx.wtListHtml(project, state)), ['api-feat']);
  state.query = 'web-feat';
  assert.match(ctx.wtListHtml(project, state), /Nothing matches “web-feat”/, 'a worktree of a repository not shown is not found');
});

test('with several shown each group\'s header takes its repository color, the same as in History; one alone has none', () => {
  const ctx = loadContext();
  const state = stateOf(ctx, [API, WEB], { primary: '/code/api', paths: ['/code/api', '/code/web'] });
  const html = ctx.wtListHtml(project, state);
  const colors = ctx.gitRepoColors(project, ctx.wtTabRepos([API, WEB]));
  const sections = [...html.matchAll(/<section class="git-section wt-repo is-colored" data-repo="(\d)" style="--repo-color:([^"]+)"/g)];
  assert.deepEqual(sections.map(m => m[2]), [colors['/code/api'], colors['/code/web']]);
  assert.notEqual(sections[0][2], sections[1][2]);
  // One repository: the header is what it was.
  state.selectedRepos = ['/code/api'];
  const single = ctx.wtListHtml(project, state);
  assert.match(single, /<section class="git-section wt-repo" data-repo="0">/);
  assert.doesNotMatch(single, /--repo-color/);
});

test('a repository found inside a folder gets a color after the project\'s folders', () => {
  const ctx = loadContext();
  const nested = group('lib', { nested: true, attachedFolders: ['/code/mono'] });
  const state = stateOf(ctx, [API, nested], { primary: '/code/api', paths: ['/code/api', '/code/lib/.git'] });
  const colors = ctx.wtGroupColors(project, state);
  assert.ok(colors['/code/api'] && colors['/code/lib/.git']);
  assert.notEqual(colors['/code/api'], colors['/code/lib/.git']);
  assert.deepEqual(names(ctx.wtShownGroups(state)), ['api', 'lib']);
});

test('the tabs show the selection as keys, and the state is brought to keys once painted', () => {
  const ctx = loadContext();
  const twice = group('app', { attachedFolders: ['/code/app', '/code/app.worktrees/feat'] });
  // History handed over the second folder of the repository, and another repository.
  const state = stateOf(ctx, [API, twice], { primary: '/code/app.worktrees/feat', paths: ['/code/app.worktrees/feat'] });
  assert.deepEqual(plain(ctx.wtTabSelection(state)), { primary: '/code/app', paths: ['/code/app'] });
  const html = ctx.wtTabsHtml(project, state);
  assert.match(html, /<div class="gg-repo-option active checked primary" data-index="1"/);
  assert.match(html, /gg-repo-picker--multi/);
  ctx.wtSyncSelection(state);
  assert.equal(state.selectedRepo, '/code/app');
  assert.deepEqual(plain(state.selectedRepos), ['/code/app']);
  // One repository only: no tabs.
  assert.equal(ctx.wtTabsHtml(project, stateOf(ctx, [API], { primary: '/code/api', paths: ['/code/api'] })), '');
});

test('a tab\'s name and checkbox change the selection as in the other views', () => {
  const ctx = loadContext();
  const state = stateOf(ctx, [API, WEB, DOCS], { primary: '/code/api', paths: ['/code/api'] });
  const repos = ctx.wtTabRepos([API, WEB, DOCS]);
  ctx.wtSyncSelection(state);
  assert.equal(ctx.gitRepoToggle(state, repos, repos[1]), true);
  assert.deepEqual(plain(state.selectedRepos), ['/code/api', '/code/web']);
  assert.deepEqual(names(ctx.wtShownGroups(state)), ['api', 'web']);
  assert.equal(ctx.gitRepoSelectOnly(state, repos, repos[2]), true);
  assert.deepEqual(plain(state.selectedRepos), ['/code/docs']);
  assert.deepEqual(names(ctx.wtShownGroups(state)), ['docs']);
  // The last one shown cannot be taken away.
  assert.equal(ctx.gitRepoToggle(state, repos, repos[2]), false);
});

test('Remove merged and Prune offer only the repositories shown; one shown goes straight on', () => {
  const ctx = loadContext();
  const state = stateOf(ctx, [API, WEB, DOCS], { primary: '/code/web', paths: ['/code/web'] });
  const picked = [];
  ctx.wtPickRepository(project, null, repo => picked.push(repo.name));
  assert.deepEqual(plain(picked), ['web']);
  assert.equal(ctx.menus.length, 0);
  state.selectedRepos = ['/code/web', '/code/docs'];
  ctx.wtPickRepository(project, null, repo => picked.push(repo.name));
  const items = ctx.menus[0];
  assert.deepEqual(plain(items.filter(i => i.label).map(i => i.label)), ['web', 'docs']);
  items[2].onClick();
  assert.deepEqual(plain(picked), ['web', 'docs']);
  // A repository that failed is not offered.
  state.repositories = [API, { ...WEB, error: 'bad' }, DOCS];
  state.selectedRepos = ['/code/web', '/code/docs'];
  ctx.menus.length = 0;
  ctx.wtPickRepository(project, null, repo => picked.push(repo.name));
  assert.equal(ctx.menus.length, 0);
  assert.equal(picked.at(-1), 'docs');
});

test('"Open in the file manager" has its own icon, on the row and in both menus', () => {
  const ctx = loadContext();
  const row = ctx.wtRowHtml(wt('/code/api.worktrees/feat', { branch: 'feat' }), 'w0', [], API);
  assert.match(row, /data-act="open" title="Open in Finder"><svg data-icon="ICONS.folderOpen">/);
  const rowMenu = ctx.wtRowMenuItems({ id: 'p', folders: [] }, API, wt('/code/api.worktrees/feat', { branch: 'feat' }));
  assert.match(rowMenu.find(i => i.label === 'Open in Finder').icon, /ICONS\.folderOpen/);
  const repoMenu = ctx.wtRepoMenuItems({ id: 'p', folders: [] }, API);
  assert.match(repoMenu.find(i => i.label === 'Open in Finder').icon, /ICONS\.folderOpen/);
});

test('without the new icon the folder icon stays', () => {
  const ctx = loadContext({ ICONS: {} });
  const row = ctx.wtRowHtml(wt('/code/api.worktrees/feat', { branch: 'feat' }), 'w0', [], API);
  assert.match(row, /data-act="open" title="Open in Finder"><svg data-icon="folder">/);
});

test('showing a worktree in the Git Graph hands History its own folder, not the repository this view had selected', () => {
  const calls = [];
  const ctx = loadContext({
    gitGraphState: () => ctx.__graph,
    setProjectGitView: () => calls.push([ctx.wtTabState('p1').selectedRepo, [...ctx.wtTabState('p1').selectedRepos]]),
    showProjectTab: () => {},
  });
  ctx.__graph = { selectedRepo: '/code/api', repositories: [] };
  stateOf(ctx, [API, WEB], { primary: '/code/api', paths: ['/code/api', '/code/web'] });
  ctx.wtOpenInGitGraph(project, { path: '/code/api.worktrees/feat' });
  assert.deepEqual(calls, [['/code/api.worktrees/feat', ['/code/api.worktrees/feat']]]);
  assert.equal(ctx.__graph.selectedRepo, '/code/api.worktrees/feat');
});
