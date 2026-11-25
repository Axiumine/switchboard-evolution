// The Pull Requests view with several repositories at once: the merged list
// (open ones whole, closed and merged ones merged by date as far as every
// repository has read), the repository named after each number, and every
// lookup that takes the row's repository, as the number alone is not unique.
// Loaded in a vm context like project-pull-requests-view.test.js, with the
// shared selection and color modules and the tabs' helpers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');

function loadContext(api = {}) {
  const icon = name => () => `<svg data-icon="${name}"></svg>`;
  const stored = new Map();
  const context = vm.createContext({
    window: { api },
    RepoSelection: require('../public/repo-selection'),
    RepoColors: require('../public/repo-colors'),
    escapeHtml: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    escapeAttr: (str) => String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    pathBasename: (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '',
    PICONS: new Proxy({}, { get: (_t, name) => icon(name) }),
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) },
  });
  for (const file of ['project-git-view.js', 'git-repo-tabs.js', 'pull-request-search.js', 'project-pull-requests-view.js']) vm.runInContext(read(file), context);
  return context;
}

const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

const API = '/code/api';
const WEB = '/code/web';
const DOCS = '/code/docs';
const REPO_OF = (name) => ({ nameWithOwner: `acme/${name}`, url: '', canWrite: true, mergeMethods: ['merge'], defaultMethod: 'merge' });

function pr(number, createdAt, extra = {}) {
  return {
    number, title: `Change ${number}`, url: '', state: 'OPEN', isDraft: false, createdAt, closedAt: null, mergedAt: null,
    author: 'dev-one', head: `feature-${number}`, headOid: 'c'.repeat(40), base: 'main', crossRepository: false,
    additions: 1, deletions: 1, changedFiles: 1, mergeable: 'MERGEABLE', reviewDecision: null, checks: null, viewerDidAuthor: false, ...extra,
  };
}

const merged = (number, createdAt) => pr(number, createdAt, { state: 'MERGED', mergedAt: createdAt });

/** A state with the repositories on screen (made-up paths), each read with the open and paged items given. */
function setup(ctx, repoSpecs, { filter = ['open', 'draft'], selected } = {}) {
  const state = ctx.prTabState('p1');
  state.filter = filter;
  state.repositories = repoSpecs.map(spec => ({ path: spec.path }));
  state.selectedRepo = selected ? selected[0] : repoSpecs[0].path;
  state.selectedRepos = selected || repoSpecs.map(spec => spec.path);
  for (const spec of repoSpecs) {
    const data = ctx.prRepoState('p1', state, spec.path);
    data.open = { repo: REPO_OF(spec.path.split('/').pop()), items: spec.open || [], totalCount: (spec.open || []).length, truncated: false };
    if (spec.page) {
      data.page = { ...ctx.prEmptyPage(filter.includes('merged') ? 'MERGED' : 'CLOSED'), loaded: true, items: spec.page, totalCount: spec.total ?? spec.page.length, hasNextPage: !!spec.more, endCursor: spec.more ? 'c1' : null };
    }
    if (spec.remotes) data.remotes = spec.remotes;
  }
  return state;
}

const numbers = (rows) => plain(rows.map(row => `${row.entry.path.split('/').pop()}#${row.pr.number}`));

test('the repositories shown are the tabs\' selection, in the tabs\' order', () => {
  const ctx = loadContext();
  const state = setup(ctx, [{ path: API }, { path: WEB }, { path: DOCS }], { selected: [DOCS, API] });
  assert.deepEqual(plain(ctx.prShownRepos(state).map(r => r.path)), [API, DOCS]);
  assert.equal(ctx.prIsShown(state, DOCS), true);
  assert.equal(ctx.prIsShown(state, WEB), false);
  // One repository selected: the same as before there were checkboxes.
  state.selectedRepos = [WEB];
  state.selectedRepo = WEB;
  assert.deepEqual(plain(ctx.prShownRepos(state).map(r => r.path)), [WEB]);
});

test('a folder that is not a Git repository is not shown among several', () => {
  const ctx = loadContext();
  const state = setup(ctx, [{ path: API }, { path: WEB }]);
  state.repositories[1].git = false;
  assert.deepEqual(plain(ctx.prShownRepos(state).map(r => r.path)), [API]);
});

test('open pull requests of every repository show, newest first, then in the tabs\' order, then by number', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z'), pr(2, '2026-03-01T09:00:00Z')] },
    { path: WEB, open: [pr(3, '2026-03-05T09:00:00Z'), pr(9, '2026-03-10T09:00:00Z')] },
  ]);
  const view = ctx.prMergeRepoViews(ctx.prMultiEntries({ id: 'p1', folders: [{ path: API }, { path: WEB }] }, state), state);
  // The same number in both repositories is two rows; on the same instant the first tab goes first.
  assert.deepEqual(numbers(view.rows), ['web#9', 'api#3', 'web#3', 'api#2']);
  assert.equal(view.hasMore, false);
});

test('closed and merged pages merge by date only as far as every repository has read', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [], page: [merged(20, '2026-03-20T00:00:00Z'), merged(10, '2026-03-10T00:00:00Z')], more: true, total: 30 },
    { path: WEB, open: [], page: [merged(15, '2026-03-15T00:00:00Z'), merged(5, '2026-03-05T00:00:00Z')], more: false, total: 2 },
  ], { filter: ['merged'] });
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const view = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  // api's page ends at its #10: what api has not read could sit between web's #5 and #15, so web's #5 waits.
  assert.deepEqual(numbers(view.rows), ['api#20', 'web#15', 'api#10']);
  assert.equal(view.held[WEB], 1);
  assert.equal(view.hasMore, true);
  const footer = ctx.prMultiFooterHtml(ctx.prMultiEntries(project, state), view, ['merged']);
  assert.match(footer, /3 of 32 merged shown/);
  assert.match(footer, /data-act="page-more">Load 10 more</);
});

test('Load more reads the next page of the repositories that need it, and the held ones then show', async () => {
  const asked = [];
  const api = {
    getPullRequestsPage: async (_id, repoPath, opts) => {
      asked.push([repoPath, opts.after]);
      return { ok: true, items: [merged(7, '2026-03-07T00:00:00Z')], totalCount: 30, hasNextPage: false, endCursor: null };
    },
  };
  const ctx = loadContext(api);
  // web has read a page's worth (10) older than anything api has read: it holds them, so only api is asked.
  const older = Array.from({ length: 10 }, (_, i) => merged(100 + i, `2026-02-${String(20 - i).padStart(2, '0')}T00:00:00Z`));
  const state = setup(ctx, [
    { path: API, open: [], page: [merged(20, '2026-03-20T00:00:00Z'), merged(10, '2026-03-10T00:00:00Z')], more: true, total: 30 },
    { path: WEB, open: [], page: [merged(15, '2026-03-15T00:00:00Z'), ...older], more: true, total: 40 },
  ], { filter: ['merged'] });
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const before = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  assert.deepEqual(numbers(before.rows), ['api#20', 'web#15', 'api#10']);
  assert.equal(before.held[WEB], 10);
  const plan = ctx.prLoadMorePages(project, state);
  await tick();
  assert.deepEqual(plain(plan), [API]);
  assert.deepEqual(asked, [[API, 'c1']]);
  const after = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  assert.deepEqual(numbers(after.rows).slice(0, 4), ['api#20', 'web#15', 'api#10', 'api#7']);
  assert.equal(after.rows.length, 14);
});

test('a repository that holds less than a page is asked too, so every Load more moves on', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [], page: [merged(20, '2026-03-20T00:00:00Z'), merged(10, '2026-03-10T00:00:00Z')], more: true },
    { path: WEB, open: [], page: [merged(15, '2026-03-15T00:00:00Z'), merged(5, '2026-03-05T00:00:00Z')], more: true },
  ], { filter: ['merged'] });
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const view = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  assert.deepEqual(plain(ctx.prLoadMorePages(project, state)), [API, WEB]);
  assert.equal(view.hasMore, true);
});

test('the page size of Load more is 100 with the search or People on', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [], page: [merged(10, '2026-03-10T00:00:00Z')], more: true },
    { path: WEB, open: [], page: [], more: true },
  ], { filter: ['merged'] });
  state.people = ['dev-one'];
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const view = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  assert.equal(view.narrowed, true);
  assert.match(ctx.prMultiFooterHtml(ctx.prMultiEntries(project, state), view, ['merged'], { narrowed: true }), /Load 100 more/);
});

test('each row names its repository in its color right after the number, and says which repository it is of', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z')] },
    { path: WEB, open: [pr(3, '2026-03-04T09:00:00Z')] },
  ]);
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const entries = ctx.prMultiEntries(project, state);
  const html = ctx.prMultiListHtml(entries, ctx.prMergeRepoViews(entries, state), state, new Date('2026-04-01T00:00:00Z'));
  const rows = [...html.matchAll(/<div class="pr-item[^"]*" data-pr="(\d+)" data-repo="(\d+)">[\s\S]*?<span class="pr-number">#\d+<\/span><span class="pr-repo" style="--repo-color:([^"]+)" title="([^"]+)">([^<]+)<\/span>/g)];
  assert.deepEqual(rows.map(m => [m[1], m[2], m[4], m[5]]), [['3', '0', API, 'api'], ['3', '1', WEB, 'web']]);
  // A color per repository, the one the tabs paint its name with.
  const colors = ctx.gitRepoColors(project, state.repositories);
  assert.deepEqual(rows.map(m => m[3]), [colors[API], colors[WEB]]);
  assert.notEqual(rows[0][3], rows[1][3]);
});

test('with one repository the row and the list are what they were', () => {
  const ctx = loadContext();
  const row = ctx.prRowHtml(pr(4, '2026-03-04T09:00:00Z'), { repo: REPO_OF('api') });
  assert.doesNotMatch(row, /pr-repo|data-repo/);
  assert.match(row, /<div class="pr-item" data-pr="4">/);
  assert.match(row, /<span class="pr-number">#4<\/span><span>opened /);
  const data = ctx.prRepoData();
  data.open = { repo: REPO_OF('api'), items: [pr(4, '2026-03-04T09:00:00Z')], totalCount: 1, truncated: false };
  assert.doesNotMatch(ctx.prListHtml(data, ['open']), /pr-repo|data-repo/);
});

test('a row is found by its number and its repository', () => {
  const ctx = loadContext();
  assert.equal(ctx.prItemSelector(null, 7), '.pr-item[data-pr="7"]');
  assert.equal(ctx.prItemSelector(2, 7), '.pr-item[data-repo="2"][data-pr="7"]');
  const state = setup(ctx, [{ path: API }, { path: WEB }]);
  assert.equal(ctx.prItemSelectorFor(state, WEB, 7), '.pr-item[data-repo="1"][data-pr="7"]');
  state.selectedRepos = [WEB];
  state.selectedRepo = WEB;
  assert.equal(ctx.prItemSelectorFor(state, WEB, 7), '.pr-item[data-pr="7"]');
});

test('the same number in two repositories keeps its own state per repository', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z')] },
    { path: WEB, open: [pr(3, '2026-03-04T09:00:00Z')] },
  ]);
  ctx.prRepoState('p1', state, WEB).expanded.add(3);
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const entries = ctx.prMultiEntries(project, state);
  const html = ctx.prMultiListHtml(entries, ctx.prMergeRepoViews(entries, state), state);
  const items = [...html.matchAll(/<div class="pr-item( open)?" data-pr="3" data-repo="(\d)"/g)].map(m => [m[2], !!m[1]]);
  assert.deepEqual(items, [['0', false], ['1', true]]);
});

test('People and the search narrow every repository; the view key tells the rows apart by repository', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z', { author: 'bob' }), pr(2, '2026-03-01T09:00:00Z', { author: 'alice' })] },
    { path: WEB, open: [pr(3, '2026-03-04T09:00:00Z', { author: 'bob' })] },
  ]);
  state.people = ['bob'];
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const view = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  assert.deepEqual(numbers(view.rows), ['api#3', 'web#3']);
  assert.equal(ctx.prMultiViewKey(view), `${API}#3:,${WEB}#3:`);
});

test('the summary counts the repositories, and says it is still reading', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z'), pr(2, '2026-03-01T09:00:00Z', { isDraft: true })] },
    { path: WEB, open: [pr(4, '2026-03-05T09:00:00Z'), pr(5, '2026-03-06T09:00:00Z')] },
    { path: DOCS },
  ]);
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }, { path: DOCS }] };
  state.repos.get(DOCS).open = null;
  assert.equal(ctx.prMultiSummaryText(ctx.prMultiEntries(project, state)), '3 repositories · 3 open, 1 draft');
  state.repos.get(DOCS).loading = true;
  assert.equal(ctx.prMultiSummaryText(ctx.prMultiEntries(project, state)), '3 repositories · 3 open, 1 draft · reading…');
});

test('a repository that failed has its own line with Try again; all failing gives each its full message', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z')] },
    { path: WEB },
  ]);
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const web = state.repos.get(WEB);
  web.open = null;
  web.error = 'Sign in to GitHub';
  web.errorCode = 'gh-auth';
  let entries = ctx.prMultiEntries(project, state);
  let html = ctx.prMultiListHtml(entries, ctx.prMergeRepoViews(entries, state), state);
  assert.match(html, /<div class="pr-footer is-error"><span><span class="pr-repo"[^>]*>web<\/span> Sign in to GitHub<\/span><button[^>]*data-act="retry" data-repo="1">Try again/);
  assert.match(html, /data-pr="3"/);
  // Both failing: the full states, one per repository.
  state.repos.get(API).open = null;
  state.repos.get(API).error = 'Sign in to GitHub';
  state.repos.get(API).errorCode = 'gh-auth';
  entries = ctx.prMultiEntries(project, state);
  html = ctx.prMultiListHtml(entries, ctx.prMergeRepoViews(entries, state), state);
  assert.equal([...html.matchAll(/<div class="git-empty-title">Sign in to GitHub<\/div>/g)].length, 2);
  assert.match(html, /class="pr-error-repo"/);
  // One repository's error markup is unchanged.
  assert.doesNotMatch(ctx.prErrorHtml(web), /pr-error-repo|data-repo/);
});

test('a page that failed says which repository, with its Retry, and does not hold the others back', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [], page: [merged(10, '2026-03-10T00:00:00Z')], more: false },
    { path: WEB, open: [] },
  ], { filter: ['merged'] });
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  state.repos.get(WEB).page = { ...ctx.prEmptyPage('MERGED'), error: 'HTTP 502' };
  const entries = ctx.prMultiEntries(project, state);
  const view = ctx.prMergeRepoViews(entries, state);
  assert.deepEqual(numbers(view.rows), ['api#10']);
  assert.match(ctx.prMultiFooterHtml(entries, view, ['merged']), /web<\/span> HTTP 502<\/span><button[^>]*data-act="page-retry" data-repo="1">Retry/);
});

test('Remotes is one menu, with a section for each repository that has two or more remotes', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [], remotes: [{ name: 'origin', slug: 'acme/api' }, { name: 'upstream', slug: 'other/api' }] },
    { path: WEB, open: [], remotes: [{ name: 'origin', slug: 'acme/web' }] },
  ]);
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const entries = ctx.prMultiEntries(project, state);
  assert.match(ctx.prRemotesButtonHtml(entries), /id="pr-remotes"[^>]*><span>Remotes<\/span>/);
  const picked = [];
  const items = ctx.prRemotesMenuItems(entries, (repoPath, remote) => picked.push([repoPath, remote]));
  assert.deepEqual(plain(items.map(item => item.head || item.label)), ['api', 'origin · acme/api', 'upstream · other/api']);
  assert.match(items[1].icon, /data-icon="check"/);
  assert.equal(items[2].icon, '');
  items[2].onClick();
  assert.deepEqual(picked, [[API, 'upstream']]);
  state.repos.get(API).remotes = [];
  assert.equal(ctx.prRemotesButtonHtml(ctx.prMultiEntries(project, state)), '');
});

test('the prompt of several repositories is the prompt of each, naming its own repository', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z')] },
    { path: WEB, open: [pr(3, '2026-03-04T09:00:00Z')] },
  ]);
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const view = ctx.prMergeRepoViews(ctx.prMultiEntries(project, state), state);
  const text = ctx.prMultiPromptText('numbers', view.rows);
  assert.match(text, /pull request in acme\/api on GitHub: #3\./);
  assert.match(text, /pull request in acme\/web on GitHub: #3\./);
  assert.ok(text.indexOf('acme/api') < text.indexOf('acme/web'));
});

test('the search status adds up what every repository has read', () => {
  const ctx = loadContext();
  const state = setup(ctx, [
    { path: API, open: [pr(3, '2026-03-05T09:00:00Z', { title: 'Add login' })] },
    { path: WEB, open: [pr(3, '2026-03-04T09:00:00Z', { title: 'Fix login' }), pr(4, '2026-03-03T09:00:00Z', { title: 'Docs' })] },
  ]);
  state.search = 'login';
  const project = { id: 'p1', folders: [{ path: API }, { path: WEB }] };
  const entries = ctx.prMultiEntries(project, state);
  const view = ctx.prMergeRepoViews(entries, state);
  // Nothing read yet: the titles match what they match, and the other texts are awaited.
  assert.equal(view.unread, 3);
  const html = ctx.prMultiListHtml(entries, view, state);
  assert.match(html, /Searching descriptions, comments and files: 0 of 3 read/);
});
