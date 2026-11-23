// The Pull Requests view's pure parts (list, filter, rows, menus, files,
// dialogs) and how it reads: public/project-pull-requests-view.js only defines
// functions, constants and a Map at top level, so it loads whole in a vm
// context given the renderer's globals. Without a document nothing is painted,
// which leaves the reading to be checked through a fake window.api.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/project-pull-requests-view.js'), 'utf8');

function loadContext(api = {}, extra = {}) {
  const icon = name => () => `<svg data-icon="${name}"></svg>`;
  const stored = new Map();
  const context = vm.createContext({
    window: { api },
    escapeHtml: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    pathBasename: (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '',
    PICONS: new Proxy({}, { get: (_t, name) => icon(name) }),
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) },
    ...extra,
  });
  vm.runInContext(source, context);
  return context;
}

// Values built in the vm are objects of its realm; a JSON round-trip makes
// them comparable with deepEqual here.
const plain = value => JSON.parse(JSON.stringify(value));

const HEAD = 'c'.repeat(40);

function pr(number, extra = {}) {
  return {
    number, title: `Change ${number}`, url: '', state: 'OPEN', isDraft: false,
    createdAt: `2026-03-${String(number).padStart(2, '0')}T09:00:00Z`, closedAt: null, mergedAt: null,
    author: 'dev-one', head: `feature-${number}`, headOid: HEAD, base: 'main', crossRepository: false,
    additions: 4, deletions: 2, changedFiles: 3, mergeable: 'MERGEABLE', reviewDecision: null, checks: null,
    viewerDidAuthor: false, ...extra,
  };
}

const REPO = { nameWithOwner: 'acme/widgets', url: '', permission: 'WRITE', canWrite: true, mergeMethods: ['merge', 'squash'], defaultMethod: 'squash', deleteBranchOnMerge: true };

// --- The list and its filter ---

test('a pull request is open, draft, closed or merged, and the filter shows those it names', () => {
  const ctx = loadContext();
  assert.equal(ctx.prStatus(pr(1)), 'open');
  assert.equal(ctx.prStatus(pr(1, { isDraft: true })), 'draft');
  assert.equal(ctx.prStatus(pr(1, { state: 'CLOSED' })), 'closed');
  assert.equal(ctx.prStatus(pr(1, { state: 'MERGED' })), 'merged');
  // A const of the file is not a property of the context: read it in there.
  const defaults = vm.runInContext('PR_DEFAULT_FILTER', ctx);
  assert.deepEqual(plain(defaults), ['open', 'draft']);
  assert.equal(ctx.prVisible(pr(1, { isDraft: true }), defaults), true);
  assert.equal(ctx.prVisible(pr(1, { state: 'MERGED' }), defaults), false);
  assert.deepEqual(plain(ctx.prPageStates(['open', 'draft'])), []);
  assert.deepEqual(plain(ctx.prPageStates(['merged', 'open', 'closed'])), ['CLOSED', 'MERGED']);
});

test('the open ones and the pages read so far make one list, newest first', () => {
  const ctx = loadContext();
  const open = [pr(3), pr(9, { isDraft: true }), pr(1)];
  const page = [pr(7, { state: 'MERGED' }), pr(5, { state: 'CLOSED' }), pr(3)];
  assert.deepEqual(plain(ctx.prMergeLists(open, page, ['open', 'draft', 'closed', 'merged']).map(p => p.number)), [9, 7, 5, 3, 1]);
  assert.deepEqual(plain(ctx.prMergeLists(open, page, ['open']).map(p => p.number)), [3, 1]);
  assert.deepEqual(plain(ctx.prMergeLists(open, page, ['merged']).map(p => p.number)), [7]);
});

test('the filter keeps at least one choice, in a fixed order, and says what it shows', () => {
  const ctx = loadContext();
  let filter = ['open', 'draft'];
  assert.equal(ctx.prFilterLabel(filter), 'Open, Draft');
  assert.equal(ctx.prIsDefaultFilter(filter), true);
  filter = ctx.prToggleFilter(filter, 'merged');
  filter = ctx.prToggleFilter(filter, 'closed');
  assert.deepEqual(plain(filter), ['open', 'draft', 'closed', 'merged']);
  assert.equal(ctx.prFilterLabel(filter), 'All');
  filter = ctx.prToggleFilter(ctx.prToggleFilter(ctx.prToggleFilter(filter, 'open'), 'draft'), 'closed');
  assert.deepEqual(plain(filter), ['merged']);
  assert.deepEqual(plain(ctx.prToggleFilter(filter, 'merged')), ['merged'], 'the last one stays');
  assert.deepEqual(plain(ctx.prToggleFilter(filter, 'nonsense')), ['merged']);
  assert.equal(ctx.prEmptyText(['open', 'draft']), 'No open or draft pull requests');
  assert.equal(ctx.prEmptyText(['open', 'closed', 'merged']), 'No open, closed or merged pull requests');
});

// --- Rows, Merge and the "…" menu ---

test('Merge is on only for an open pull request that may be merged, and says why not', () => {
  const ctx = loadContext();
  assert.equal(ctx.prMergeBlock(pr(1), REPO), null);
  assert.match(ctx.prMergeBlock(pr(1, { isDraft: true }), REPO), /ready for review/);
  assert.match(ctx.prMergeBlock(pr(1, { mergeable: 'CONFLICTING' }), REPO), /conflicts with main/);
  assert.match(ctx.prMergeBlock(pr(1), { ...REPO, canWrite: false }), /cannot merge/);
  assert.match(ctx.prMergeBlock(pr(1), { ...REPO, mergeMethods: [] }), /no merge method/);

  const open = ctx.prRowHtml(pr(4), { repo: REPO });
  assert.match(open, /data-act="merge">/);
  assert.match(open, /data-act="more"/);
  assert.match(open, /#4/);
  assert.match(open, /feature-4 → main/);
  assert.match(open, /aria-expanded="false"/);
  assert.match(open, /class="pr-detail" data-detail="4" hidden/);

  const draft = ctx.prRowHtml(pr(4, { isDraft: true }), { repo: REPO, expanded: true });
  assert.match(draft, /class="pr-merge-wrap" title="A draft cannot be merged\. Mark it ready for review first\."/);
  assert.match(draft, /data-act="merge" disabled/);
  assert.match(draft, /pr-badge--draft/);
  assert.match(draft, /aria-expanded="true"/);

  for (const state of ['CLOSED', 'MERGED']) {
    const html = ctx.prRowHtml(pr(4, { state }), { repo: REPO });
    assert.doesNotMatch(html, /data-act="merge"|data-act="more"/, state);
  }
});

test('a row\'s badges: conflicts, the review and the checks', () => {
  const ctx = loadContext();
  const html = ctx.prBadgesHtml(pr(1, { mergeable: 'CONFLICTING', reviewDecision: 'APPROVED', checks: 'FAILURE' }));
  assert.deepEqual([...html.matchAll(/pr-badge--([\w-]+)">([^<]+)/g)].map(m => [m[1], m[2]]),
    [['conflict', 'Conflicts'], ['approved', 'Approved'], ['checks-fail', 'Checks failed']]);
  assert.equal(ctx.prBadgesHtml(pr(1, { state: 'MERGED', checks: 'FAILURE' })), '');
});

test('the "…" menu: Convert to draft or Ready for review, then Close', () => {
  const calls = [];
  const ctx = loadContext();
  const actions = { draft: () => calls.push('draft'), ready: () => calls.push('ready'), close: () => calls.push('close') };
  const open = ctx.prRowMenuItems(pr(1), REPO, actions);
  assert.deepEqual(plain(open.map(i => i.sep ? '—' : `${i.label}${i.danger ? ' (danger)' : ''}${i.disabled ? ' (off)' : ''}`)),
    ['Convert to draft…', '—', 'Close pull request… (danger)']);
  const draft = ctx.prRowMenuItems(pr(1, { isDraft: true }), REPO, actions);
  assert.equal(draft[0].label, 'Ready for review…');
  open[0].onClick(); draft[0].onClick(); open[2].onClick();
  assert.deepEqual(calls, ['draft', 'ready', 'close']);
  assert.deepEqual(plain(ctx.prRowMenuItems(pr(1, { state: 'MERGED' }), REPO, actions)), []);
  // Neither the author nor allowed to write: the items are there but off.
  const reader = ctx.prRowMenuItems(pr(1), { ...REPO, canWrite: false }, actions);
  assert.ok(reader.filter(i => !i.sep).every(i => i.disabled));
  assert.ok(ctx.prRowMenuItems(pr(1, { viewerDidAuthor: true }), { ...REPO, canWrite: false }, actions).filter(i => !i.sep).every(i => !i.disabled));
});

test('the list: rows, an empty line, and "Load 10 more" while closed or merged ones are left', () => {
  const ctx = loadContext();
  const data = ctx.prRepoData();
  data.open = { repo: REPO, items: [pr(2), pr(1, { isDraft: true })], totalCount: 2, truncated: false };
  let html = ctx.prListHtml(data, ['open', 'draft']);
  assert.deepEqual([...html.matchAll(/data-pr="(\d+)"/g)].map(m => m[1]), ['2', '1']);
  assert.doesNotMatch(html, /pr-footer/);

  html = ctx.prListHtml(data, ['merged']);
  assert.match(html, /Reading merged pull requests…/);
  assert.doesNotMatch(html, /git-empty-state/, 'no "nothing here" while the first page is on its way');

  Object.assign(data.page, { key: 'MERGED', loaded: true, items: [pr(5, { state: 'MERGED' })], totalCount: 23, hasNextPage: true, endCursor: 'c1' });
  html = ctx.prListHtml(data, ['open', 'merged']);
  assert.deepEqual([...html.matchAll(/data-pr="(\d+)"/g)].map(m => m[1]), ['5', '2']);
  assert.match(html, /1 of 23 merged shown/);
  assert.match(html, /data-act="page-more">Load 10 more</);
  data.page.loading = true;
  assert.match(ctx.prListHtml(data, ['merged']), /data-act="page-more" disabled>Loading…</);
  Object.assign(data.page, { loading: false, hasNextPage: false, totalCount: 1 });
  assert.doesNotMatch(ctx.prListHtml(data, ['merged']), /page-more/);

  data.open.items = [];
  assert.match(ctx.prListHtml(data, ['open', 'draft']), /No open or draft pull requests/);
  data.open.truncated = true;
  assert.match(ctx.prListHtml(data, ['open']), /newest 1000 open pull requests/);
});

// --- Files and diffs ---

test('the files opened at first stay within the line budget, in order', () => {
  const ctx = loadContext();
  const patch = n => Array.from({ length: n }, () => '+x').join('\n');
  const files = [
    { path: 'a', patch: patch(900) },
    { path: 'bin.png', patch: null },
    { path: 'b', patch: patch(500) },
    { path: 'c', patch: patch(200) },
    { path: 'd', patch: patch(10) },
  ];
  assert.deepEqual([...ctx.prFileBudget(files)], ['a', 'b']);
  assert.deepEqual([...ctx.prFileBudget(files, 100)], []);
});

test('a pull request\'s files: each with its diff, or why there is none', () => {
  const ctx = loadContext();
  const entry = {
    truncated: false,
    files: [
      { path: 'src/app.js', oldPath: null, status: 'modified', insertions: 2, deletions: 1, patch: '@@ -1 +1,2 @@\n-a\n+b' },
      { path: 'src/new.js', oldPath: 'src/old.js', status: 'renamed', insertions: 0, deletions: 0, patch: null },
      { path: 'logo.png', oldPath: null, status: 'added', insertions: 0, deletions: 0, patch: null },
      { path: 'big.json', oldPath: null, status: 'modified', insertions: 9, deletions: 9, patch: null, tooLarge: true },
    ],
  };
  const html = ctx.prFilesHtml(entry, new Set(['src/app.js']));
  assert.match(html, /4 files changed/);
  assert.match(html, /\+11<\/span> <span class="pr-del">−10/);
  assert.match(html, /data-file="0" aria-expanded="true"/);
  assert.match(html, /<div class="pr-file-diff" data-diff="0"><pre class="git-diff">@@ -1 \+1,2 @@/);
  assert.match(html, /<div class="pr-file-diff" data-diff="1" hidden><\/div>/);
  assert.match(html, /from src\/old\.js/);
  assert.match(html, /git-file-code renamed">R</);
  assert.match(ctx.prPatchHtml(entry.files[1]), /Renamed, nothing else changed/);
  assert.match(ctx.prPatchHtml(entry.files[2]), /binary file/);
  assert.match(ctx.prPatchHtml(entry.files[3]), /too large/);
  assert.match(ctx.prFilesHtml({ loading: true }), /Reading the changed files/);
  assert.match(ctx.prFilesHtml({ error: 'HTTP 502' }), /HTTP 502.*data-act="files-retry"/s);
  assert.match(ctx.prFilesHtml({ files: [] }), /No files changed/);
});

// --- Dialogs ---

test('the Merge dialog offers the repository\'s merge methods and deleting the branch', () => {
  const ctx = loadContext();
  let html = ctx.prMergeDialogHtml(pr(8), REPO);
  assert.deepEqual([...html.matchAll(/<option value="(\w+)"( selected)?>([^<]+)/g)].map(m => [m[1], !!m[2], m[3]]),
    [['merge', false, 'Create a merge commit'], ['squash', true, 'Squash and merge']]);
  assert.match(html, /id="pr-merge-delete" checked>/);
  assert.match(html, /Your local checkout is not changed/);
  assert.doesNotMatch(html, /gg-dialog-warning/);

  html = ctx.prMergeDialogHtml(pr(8, { crossRepository: true, checks: 'FAILURE', reviewDecision: 'REVIEW_REQUIRED' }), { ...REPO, deleteBranchOnMerge: false });
  assert.match(html, /id="pr-merge-delete" disabled>/);
  assert.match(html, /a fork/);
  assert.match(html, /Its checks failed\./);
  assert.match(html, /not been approved yet/);
});

test('the Merge dialog asks to delete the branch even once its busy state has disabled the checkbox', () => {
  const ctx = loadContext();
  // While gh runs, gitGraphOpenDialog disables every field: the answer is read then.
  const dialog = (method, box) => ({ querySelector: (sel) => (sel === '#pr-merge-method' ? { value: method } : sel === '#pr-merge-delete' ? box : null) });
  assert.deepEqual(plain(ctx.prMergeParams(dialog('squash', { checked: true, disabled: true }), pr(8))),
    { action: 'merge', method: 'squash', deleteBranch: true, headOid: HEAD });
  assert.equal(ctx.prMergeParams(dialog('merge', { checked: false, disabled: true }), pr(8)).deleteBranch, false);
  // A fork's branch is never deleted, whatever the box says.
  assert.equal(ctx.prMergeParams(dialog('merge', { checked: true, disabled: true }), pr(8, { crossRepository: true })).deleteBranch, false);
  assert.equal('headOid' in ctx.prMergeParams(dialog('rebase', null), pr(8, { headOid: 'abc' })), false);
});

test('every other action has a confirmation of its own', () => {
  const ctx = loadContext();
  assert.match(ctx.prConfirmHtml(pr(8), 'draft'), /A draft cannot be merged/);
  assert.match(ctx.prConfirmHtml(pr(8), 'ready'), /Reviewers are asked/);
  assert.match(ctx.prConfirmHtml(pr(8), 'close'), /closed without merging/);
  assert.match(ctx.prConfirmHtml(pr(8), 'close'), /Change 8.*#8/s);
});

// --- Reading ---

function fakeApi(answers) {
  const calls = [];
  const api = {};
  for (const name of ['getPullRequests', 'getPullRequestsPage', 'getPullRequestFiles', 'runPullRequestAction']) {
    api[name] = async (...args) => {
      calls.push([name, ...plain(args)]);
      return typeof answers[name] === 'function' ? answers[name](...args) : answers[name];
    };
  }
  return { api, calls };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('every open one is read, then a first page of 10 when the filter asks for closed or merged ones', async () => {
  const { api, calls } = fakeApi({
    getPullRequests: { ok: true, remote: 'origin', remotes: [{ name: 'origin', host: 'github.com', slug: 'acme/widgets' }], repo: REPO, items: [pr(2)], totalCount: 1, truncated: false },
    getPullRequestsPage: (_id, _path, opts) => ({ ok: true, items: [pr(opts.after ? 1 : 3, { state: 'MERGED' })], totalCount: 12, hasNextPage: !opts.after, endCursor: opts.after ? null : 'c1' }),
  });
  const ctx = loadContext(api);
  const state = ctx.prTabState('p1');
  state.filter = ['open', 'draft', 'merged'];
  await ctx.prLoad({ id: 'p1' }, state, '/code/widgets');
  await tick();
  const data = state.repos.get('/code/widgets');
  assert.equal(data.remote, 'origin');
  assert.deepEqual(calls, [
    ['getPullRequests', 'p1', '/code/widgets', {}],
    ['getPullRequestsPage', 'p1', '/code/widgets', { remote: 'origin', states: ['MERGED'], first: 10 }],
  ]);
  assert.equal(data.page.items.length, 1);

  await ctx.prLoadPage({ id: 'p1' }, state, '/code/widgets', { more: true });
  assert.deepEqual(calls.at(-1), ['getPullRequestsPage', 'p1', '/code/widgets', { remote: 'origin', states: ['MERGED'], first: 10, after: 'c1' }]);
  assert.deepEqual(plain(data.page.items.map(p => p.number)), [3, 1]);
  assert.equal(data.page.hasNextPage, false);

  // Reading again (after an action) reads as many as were read: 2, so a first page of 10.
  await ctx.prLoad({ id: 'p1' }, state, '/code/widgets', { quiet: true });
  await tick();
  assert.deepEqual(calls.at(-1), ['getPullRequestsPage', 'p1', '/code/widgets', { remote: 'origin', states: ['MERGED'], first: 10 }]);
});

test('a failed read keeps what was on screen when it was only a refresh', async () => {
  let fail = false;
  const { api } = fakeApi({
    getPullRequests: () => (fail ? { error: 'Sign in to GitHub', code: 'gh-auth' } : { ok: true, remote: 'origin', remotes: [], repo: REPO, items: [pr(2)], totalCount: 1 }),
  });
  const ctx = loadContext(api);
  const state = ctx.prTabState('p1');
  await ctx.prLoad({ id: 'p1' }, state, '/r');
  fail = true;
  assert.equal(await ctx.prLoad({ id: 'p1' }, state, '/r', { quiet: true }), false);
  const data = state.repos.get('/r');
  assert.equal(data.open.items.length, 1);
  assert.equal(data.errorCode, 'gh-auth');
  await ctx.prLoad({ id: 'p1' }, state, '/r');
  assert.equal(data.open, null);
  assert.match(ctx.prErrorHtml(data), /Sign in to GitHub/);
});

test('an answer for a remote no longer chosen is dropped', async () => {
  let release;
  const { api } = fakeApi({
    getPullRequests: (_id, _path, opts) => (opts.remote === 'upstream'
      ? { ok: true, remote: 'upstream', remotes: [], repo: REPO, items: [pr(9)], totalCount: 1 }
      : new Promise(resolve => { release = () => resolve({ ok: true, remote: 'origin', remotes: [], repo: REPO, items: [pr(1)], totalCount: 1 }); })),
  });
  const ctx = loadContext(api);
  const state = ctx.prTabState('p1');
  const first = ctx.prLoad({ id: 'p1' }, state, '/r');
  await tick();
  // The user picks another remote meanwhile (prWireRemote).
  state.repos.set('/r', ctx.prRepoData('upstream'));
  await ctx.prLoad({ id: 'p1' }, state, '/r');
  release();
  await first;
  assert.deepEqual(plain(state.repos.get('/r').open.items.map(p => p.number)), [9]);
});

test('a chosen remote is remembered per project and repository', () => {
  const ctx = loadContext();
  ctx.prSaveRemote('p1', '/r', 'upstream');
  assert.equal(ctx.prSavedRemote('p1', '/r'), 'upstream');
  assert.equal(ctx.prSavedRemote('p1', '/other'), null);
  assert.equal(ctx.prRepoState('p1', ctx.prTabState('p1'), '/r').remote, 'upstream');
});

test('files are kept per head commit and open within the budget', async () => {
  const { api, calls } = fakeApi({
    getPullRequestFiles: { ok: true, files: [{ path: 'a.js', status: 'modified', insertions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+a' }], truncated: false },
  });
  const ctx = loadContext(api);
  const state = ctx.prTabState('p1');
  const data = ctx.prRepoState('p1', state, '/r');
  data.remote = 'origin';
  await ctx.prLoadFiles({ id: 'p1' }, state, '/r', pr(4));
  assert.deepEqual(calls, [['getPullRequestFiles', 'p1', '/r', { remote: 'origin', number: 4 }]]);
  assert.deepEqual([...data.openFiles.get(`4@${HEAD}`)], ['a.js']);
  assert.equal(data.files.get(`4@${HEAD}`).files.length, 1);
});
