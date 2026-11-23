const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../pull-requests');

const DIR = '/code/widgets';
const HEAD = 'a'.repeat(40);

function fakeGit(remotes, config = []) {
  return {
    remoteList: async () => remotes,
    configListIncludes: async () => config,
  };
}

const ORIGIN = { name: 'origin', url: 'git@github.com:acme/widgets.git' };
const UPSTREAM = { name: 'upstream', url: 'https://github.com/widget-org/widgets.git' };
const GITLAB = { name: 'mirror', url: 'https://gitlab.com/acme/widgets.git' };

/** gh stand-in: `answer(args, opts, n)` gives { stdout, stderr, code } (or throws). */
function setup({ remotes = [ORIGIN], config = [], answer } = {}) {
  const calls = [];
  pr.init({
    git: fakeGit(remotes, config),
    runGh: async (args, opts = {}) => {
      calls.push({ args, opts, input: opts.input ? JSON.parse(opts.input) : null });
      return answer(args, opts, calls.length);
    },
  });
  return calls;
}

function node(number, extra = {}) {
  return {
    number, title: `Change ${number}`, url: `https://github.com/acme/widgets/pull/${number}`,
    state: 'OPEN', isDraft: false, createdAt: `2026-01-${String(30 - number).padStart(2, '0')}T10:00:00Z`,
    updatedAt: '2026-02-01T08:00:00Z', closedAt: null, mergedAt: null,
    author: { login: 'dev-one', avatarUrl: 'https://avatars.example.com/u/1' },
    headRefName: `feature-${number}`, headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false,
    additions: 3, deletions: 1, changedFiles: 2, mergeable: 'MERGEABLE', reviewDecision: null, viewerDidAuthor: true,
    id: `PR_${number}`, viewerCanUpdate: true, viewerCanReopen: false,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...extra,
  };
}

function page(nodes, { hasNextPage = false, endCursor = null, totalCount = nodes.length } = {}) {
  return {
    code: 0, stderr: '',
    stdout: JSON.stringify({ data: { repository: {
      nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets', viewerPermission: 'WRITE',
      mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true,
      viewerDefaultMergeMethod: 'REBASE', deleteBranchOnMerge: true,
      pullRequests: { totalCount, pageInfo: { hasNextPage, endCursor }, nodes },
    } } }),
  };
}

// --- Remotes ---

test('GitHub remotes are read from https, ssh and scp-like URLs', () => {
  assert.deepEqual(pr.parseGitHubRemote('https://github.com/acme/widgets.git'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(pr.parseGitHubRemote('https://user@github.com/acme/widgets/'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(pr.parseGitHubRemote('ssh://git@github.com:22/acme/widgets.git'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(pr.parseGitHubRemote('git@github.com:acme/widgets.git'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(pr.parseGitHubRemote('github.com:acme/widgets'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  // A second account's ssh alias, and ssh over port 443.
  assert.deepEqual(pr.parseGitHubRemote('git@github.com-work:acme/widgets.git'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(pr.parseGitHubRemote('ssh://git@ssh.github.com:443/acme/widgets.git'), { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(pr.parseGitHubRemote('https://github.example.com/acme/widgets'), { host: 'github.example.com', owner: 'acme', repo: 'widgets' });
  for (const url of ['', null, '/srv/git/widgets.git', 'file:///srv/git/widgets.git', 'https://gitlab.com/group/sub/widgets.git', 'C:\\code\\widgets']) {
    assert.equal(pr.parseGitHubRemote(url), null, String(url));
  }
});

test('only GitHub hosts count', () => {
  for (const host of ['github.com', 'acme.ghe.com', 'github.example.com', 'code-github.example.com']) assert.ok(pr.isGitHubHost(host), host);
  for (const host of ['gitlab.com', 'bitbucket.org', 'mygithubhost.com', '', null]) assert.ok(!pr.isGitHubHost(host), String(host));
});

test('the remote is the asked one, else gh\'s default, else origin, else upstream', async () => {
  setup({ remotes: [UPSTREAM, ORIGIN, GITLAB], answer: () => ({}) });
  let target = await pr.resolveRepo(DIR);
  assert.equal(target.remote, 'origin');
  assert.deepEqual(target.remotes.map(r => r.name), ['upstream', 'origin']); // no GitLab
  assert.deepEqual(target.remotes[0], { name: 'upstream', host: 'github.com', slug: 'widget-org/widgets' });

  target = await pr.resolveRepo(DIR, 'upstream');
  assert.equal(target.remote, 'upstream');
  assert.equal(`${target.owner}/${target.repo}`, 'widget-org/widgets');
  assert.equal((await pr.resolveRepo(DIR, 'nope')).remote, 'origin');

  setup({ remotes: [ORIGIN, UPSTREAM], config: [{ key: 'remote.upstream.gh-resolved', value: 'base' }], answer: () => ({}) });
  assert.equal((await pr.resolveRepo(DIR)).remote, 'upstream');

  setup({ remotes: [ORIGIN], config: [{ key: 'remote.origin.gh-resolved', value: 'parent-org/widgets' }], answer: () => ({}) });
  target = await pr.resolveRepo(DIR);
  assert.equal(`${target.owner}/${target.repo}`, 'parent-org/widgets');

  setup({ remotes: [UPSTREAM, { name: 'fork', url: 'git@github.com:dev-one/widgets.git' }], answer: () => ({}) });
  assert.equal((await pr.resolveRepo(DIR)).remote, 'upstream');

  setup({ remotes: [GITLAB], answer: () => ({}) });
  assert.equal(await pr.resolveRepo(DIR), null);
});

// --- Listing ---

test('every open pull request is read, 100 at a time, through gh api graphql', async () => {
  const first = Array.from({ length: 100 }, (_, i) => node(i + 1));
  const calls = setup({
    answer: (_args, _opts, n) => (n === 1
      ? page(first, { hasNextPage: true, endCursor: 'cursor-1', totalCount: 101 })
      : page([node(101, { isDraft: true })], { totalCount: 101 })),
  });
  const result = await pr.listOpen(DIR);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 101);
  assert.equal(result.totalCount, 101);
  assert.equal(result.truncated, false);
  assert.equal(result.remote, 'origin');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', states: ['OPEN'], first: 100, after: null });
  assert.equal(calls[1].input.variables.after, 'cursor-1');
  assert.match(calls[0].input.query, /orderBy: \{ field: CREATED_AT, direction: DESC \}/);
  assert.deepEqual(result.repo, {
    nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets', permission: 'WRITE', canWrite: true,
    mergeMethods: ['squash', 'rebase'], defaultMethod: 'rebase', deleteBranchOnMerge: true,
  });
  assert.deepEqual(result.items[100], {
    id: 'PR_101', number: 101, title: 'Change 101', url: 'https://github.com/acme/widgets/pull/101', state: 'OPEN', isDraft: true,
    createdAt: result.items[100].createdAt, updatedAt: '2026-02-01T08:00:00Z', closedAt: null, mergedAt: null,
    author: 'dev-one', authorAvatar: 'https://avatars.example.com/u/1',
    head: 'feature-101', headOid: HEAD, base: 'main', crossRepository: false,
    additions: 3, deletions: 1, changedFiles: 2, mergeable: 'MERGEABLE', reviewDecision: null, checks: 'SUCCESS', viewerDidAuthor: true,
    viewerCanUpdate: true, viewerCanReopen: false,
  });
  // The pencil and Reopen need these; what GitHub computes per pull request stays out of the list.
  assert.match(calls[0].input.query, /viewerCanUpdate viewerCanReopen/);
  // The search reads a pull request's texts again once it moves on; People shows the avatars.
  assert.match(calls[0].input.query, /createdAt updatedAt closedAt/);
  assert.match(calls[0].input.query, /author \{ login avatarUrl\(size: 40\) \}/);
  assert.doesNotMatch(calls[0].input.query, /mergeStateStatus|viewerCanUpdateBranch|totalCommentsCount/);
});

test('when GitHub gives up on a page of 100, the same page comes again in smaller ones', async () => {
  const calls = setup({
    answer: (_args, opts) => {
      const { first } = JSON.parse(opts.input).variables;
      if (first > 25) return { code: 1, stdout: '', stderr: 'gh: HTTP 502: Bad Gateway' };
      return page([node(1)], { totalCount: 1 });
    },
  });
  const result = await pr.listOpen(DIR);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(c => c.input.variables.first), [100, 50, 25]);
  // Not a time-out: no second try.
  const refused = setup({ answer: () => ({ code: 1, stdout: '', stderr: 'gh: HTTP 403: Forbidden' }) });
  assert.equal((await pr.listOpen(DIR)).ok, undefined);
  assert.equal(refused.length, 1);
});

test('open pull requests stop at 1000 and say so', async () => {
  const full = Array.from({ length: 100 }, (_, i) => node(i + 1));
  let calls = setup({ answer: () => page(full, { hasNextPage: true, endCursor: 'more' }) });
  let result = await pr.listOpen(DIR);
  assert.equal(calls.length, 10);
  assert.equal(result.items.length, 1000);
  assert.equal(result.truncated, true);
  // Pages that never fill up still stop.
  calls = setup({ answer: () => page([node(1)], { hasNextPage: true, endCursor: 'more' }) });
  result = await pr.listOpen(DIR);
  assert.equal(calls.length, 40);
  assert.equal(result.truncated, true);
});

test('the default merge method is one the repository allows', () => {
  const info = pr.repositoryInfo({ mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false, viewerDefaultMergeMethod: 'SQUASH', viewerPermission: 'READ' });
  assert.deepEqual(info.mergeMethods, ['merge']);
  assert.equal(info.defaultMethod, 'merge');
  assert.equal(info.canWrite, false);
});

test('closed and merged pull requests come one page at a time', async () => {
  const calls = setup({ answer: () => page([node(5, { state: 'MERGED' })], { hasNextPage: true, endCursor: 'cursor-2', totalCount: 31 }) });
  const result = await pr.listPage(DIR, { states: ['closed', 'MERGED'], first: 10, after: 'cursor-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.states, ['CLOSED', 'MERGED']);
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', states: ['CLOSED', 'MERGED'], first: 10, after: 'cursor-1' });
  assert.equal(result.items[0].state, 'MERGED');
  assert.equal(result.totalCount, 31);
  assert.equal(result.hasNextPage, true);
  assert.equal(result.endCursor, 'cursor-2');
});

test('a page asks only for closed or merged pull requests, at most 100', async () => {
  const calls = setup({ answer: () => page([]) });
  for (const opts of [{ states: ['OPEN'] }, { states: [] }, { states: 'CLOSED' }, { states: ['CLOSED'], first: 0 }, { states: ['CLOSED'], first: 101 }, { states: ['CLOSED'], after: 42 }]) {
    assert.equal((await pr.listPage(DIR, opts)).code, 'bad-request', JSON.stringify(opts));
  }
  assert.equal(calls.length, 0);
});

// --- Files ---

test('a pull request\'s files come with their patches, in History\'s shape', async () => {
  const lines = [
    { filename: 'src/a.js', previous_filename: null, status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1,2 @@\n-a\n+b\n+c' },
    { filename: 'src/new.js', status: 'renamed', previous_filename: 'src/old.js', additions: 0, deletions: 0 },
    { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
    { filename: 'gone.txt', status: 'removed', additions: 0, deletions: 4, patch: '@@ -1,4 +0,0 @@' },
  ].map(line => JSON.stringify(line)).join('\n');
  const calls = setup({ answer: () => ({ code: 0, stdout: `${lines}\n`, stderr: '' }) });
  const result = await pr.files(DIR, { number: 7 });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, [
    'api', '--hostname', 'github.com', '--paginate', 'repos/acme/widgets/pulls/7/files?per_page=100',
    '--jq', '.[] | {filename, previous_filename, status, additions, deletions, patch}',
  ]);
  assert.deepEqual(result.files.map(f => [f.path, f.oldPath, f.status, f.insertions, f.deletions, f.patch === null]), [
    ['src/a.js', null, 'modified', 2, 1, false],
    ['src/new.js', 'src/old.js', 'renamed', 0, 0, true],
    ['logo.png', null, 'added', 0, 0, true],
    ['gone.txt', null, 'deleted', 0, 4, false],
  ]);
  assert.equal(result.truncated, false);
  assert.equal((await pr.files(DIR, { number: '7; rm' })).code, 'bad-request');
  assert.equal((await pr.files(DIR, { number: -1 })).code, 'bad-request');
});

// --- Actions ---

test('each action is one fixed gh command, always with -R', () => {
  const target = { host: 'github.com', owner: 'acme', repo: 'widgets' };
  assert.deepEqual(pr.actionArgs(target, { number: 7, action: 'merge', method: 'squash', deleteBranch: true, headOid: HEAD }).args,
    ['pr', 'merge', '7', '-R', 'acme/widgets', '--squash', '--delete-branch', '--match-head-commit', HEAD]);
  assert.deepEqual(pr.actionArgs(target, { number: 7, action: 'merge', method: 'merge', deleteBranch: 'yes' }).args,
    ['pr', 'merge', '7', '-R', 'acme/widgets', '--merge']);
  assert.deepEqual(pr.actionArgs(target, { number: 7, action: 'draft' }).args, ['pr', 'ready', '7', '-R', 'acme/widgets', '--undo']);
  assert.deepEqual(pr.actionArgs(target, { number: 7, action: 'ready' }).args, ['pr', 'ready', '7', '-R', 'acme/widgets']);
  assert.deepEqual(pr.actionArgs(target, { number: 7, action: 'close' }).args, ['pr', 'close', '7', '-R', 'acme/widgets']);
  assert.deepEqual(pr.actionArgs(target, { number: 7, action: 'reopen' }).args, ['pr', 'reopen', '7', '-R', 'acme/widgets']);
  assert.deepEqual(pr.actionArgs({ ...target, host: 'github.example.com' }, { number: 7, action: 'close' }).args,
    ['pr', 'close', '7', '-R', 'github.example.com/acme/widgets']);
});

test('anything else is refused before gh runs', async () => {
  const target = { host: 'github.com', owner: 'acme', repo: 'widgets' };
  assert.match(pr.actionArgs(target, { number: 7, action: 'lock' }).error, /Unknown pull request action/);
  assert.match(pr.actionArgs(target, { number: 7, action: 'merge', method: '--admin' }).error, /Unknown merge method/);
  assert.match(pr.actionArgs(target, { number: 7, action: 'merge', method: 'merge', headOid: 'main' }).error, /commit hash/);
  assert.match(pr.actionArgs(target, { number: '7 --admin', action: 'close' }).error, /number/);
  const calls = setup({ answer: () => ({ code: 0, stdout: '', stderr: '' }) });
  assert.equal((await pr.runAction(DIR, { number: 7, action: 'delete' })).code, 'bad-request');
  assert.equal(calls.length, 0);
});

test('an action says what it did, and one runs at a time per repository', async () => {
  let release;
  const calls = setup({ answer: (args) => (args[1] === 'merge'
    ? new Promise((resolve) => { release = () => resolve({ code: 0, stdout: '', stderr: '' }); })
    : { code: 0, stdout: '', stderr: '' }) });
  const merging = pr.runAction(DIR, { number: 7, action: 'merge', method: 'rebase' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await pr.runAction(DIR, { number: 8, action: 'close' })).code, 'busy');
  release();
  assert.deepEqual(await merging, { ok: true, message: 'Merged pull request #7.' });
  assert.deepEqual(await pr.runAction(DIR, { number: 8, action: 'close' }), { ok: true, message: 'Closed pull request #8.' });
  assert.deepEqual(await pr.runAction(DIR, { number: 8, action: 'draft' }), { ok: true, message: 'Pull request #8 is a draft now.' });
  assert.deepEqual(await pr.runAction(DIR, { number: 8, action: 'ready' }), { ok: true, message: 'Pull request #8 is ready for review.' });
  assert.deepEqual(await pr.runAction(DIR, { number: 8, action: 'reopen' }), { ok: true, message: 'Reopened pull request #8.' });
  assert.equal(calls.length, 5);
});

test('a merge queue or auto-merge is reported in gh\'s own words', async () => {
  setup({ answer: () => ({ code: 0, stdout: '', stderr: '✓ Pull request acme/widgets#7 will be added to the merge queue for main when ready\n' }) });
  assert.deepEqual(await pr.runAction(DIR, { number: 7, action: 'merge', method: 'merge' }),
    { ok: true, message: 'Pull request acme/widgets#7 will be added to the merge queue for main when ready' });
});

// --- Errors ---

test('gh missing, signed out, an unknown repository and other failures become words to show', async () => {
  setup({ answer: () => { const err = new Error('x'); err.code = 'gh-missing'; throw err; } });
  let result = await pr.listOpen(DIR);
  assert.equal(result.code, 'gh-missing');
  assert.match(result.error, /brew install gh/);

  setup({ answer: () => ({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }) });
  result = await pr.listOpen(DIR);
  assert.equal(result.code, 'gh-auth');
  assert.match(result.error, /gh auth login"/);
  assert.equal(result.remote, 'origin');

  setup({ remotes: [{ name: 'origin', url: 'https://github.example.com/acme/widgets' }], answer: () => ({ code: 4, stdout: '', stderr: 'authentication required' }) });
  assert.match((await pr.listOpen(DIR)).error, /gh auth login --hostname github\.example\.com/);

  setup({ answer: () => ({ code: 1, stdout: JSON.stringify({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository with the name 'acme/widgets'." }] }), stderr: 'gh: Could not resolve' }) });
  assert.equal((await pr.listOpen(DIR)).code, 'not-found');

  setup({ answer: () => ({ code: 1, stdout: '', stderr: 'X Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.\n' }) });
  assert.deepEqual(await pr.runAction(DIR, { number: 7, action: 'merge', method: 'merge' }),
    { error: 'Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.', code: 'gh-failed' });

  setup({ answer: () => ({ code: 1, stdout: '', stderr: 'GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)\n' }) });
  assert.deepEqual(await pr.runAction(DIR, { number: 7, action: 'merge', method: 'merge', headOid: 'a'.repeat(40) }),
    { error: 'New commits reached the branch since the list was read. Look at them, then merge again.', code: 'gh-failed' });

  setup({ answer: () => ({ code: 1, stdout: '', stderr: 'GraphQL: Pull Request is still a draft (mergePullRequest)\n' }) });
  assert.equal((await pr.runAction(DIR, { number: 7, action: 'merge', method: 'merge' })).error, 'Pull Request is still a draft');

  setup({ remotes: [GITLAB], answer: () => ({}) });
  assert.deepEqual(await pr.listOpen(DIR), { error: 'This repository has no GitHub remote.', code: 'no-github-remote' });
});

test('without gh on the computer nothing is started', async () => {
  pr.init({ git: fakeGit([ORIGIN]), findBinary: () => null });
  const result = await pr.listOpen(DIR);
  assert.equal(result.code, 'gh-missing');
});

test('the gh installed on the computer comes first, then the one in the app', () => {
  const RES = '/Applications/Demo.app/Contents/Resources';
  const files = new Set(['/opt/homebrew/bin/gh', `${RES}/bin/gh`, '/tmp/my-gh', 'C:\\App\\resources\\bin\\gh.exe']);
  const exists = (p) => files.has(p);
  const installed = (name) => (name === 'gh' ? '/opt/homebrew/bin/gh' : null);
  const none = () => null;
  assert.deepEqual(pr.locateGh({ override: undefined, finder: installed, resourcesPath: RES, exists, platform: 'darwin' }),
    { path: '/opt/homebrew/bin/gh', source: 'installed' });
  assert.deepEqual(pr.locateGh({ override: undefined, finder: none, resourcesPath: RES, exists, platform: 'darwin' }),
    { path: `${RES}/bin/gh`, source: 'bundled' });
  assert.deepEqual(pr.locateGh({ override: '/tmp/my-gh', finder: installed, resourcesPath: RES, exists, platform: 'darwin' }),
    { path: '/tmp/my-gh', source: 'override' });
  // An override that is not there is passed over.
  assert.equal(pr.locateGh({ override: '/tmp/gone', finder: none, resourcesPath: '/elsewhere', exists, platform: 'darwin' }), null);
  // Electron run from node_modules has no gh in its resources.
  assert.equal(pr.locateGh({ override: undefined, finder: none, resourcesPath: undefined, exists, platform: 'darwin' }), null);
  // Windows looks for gh.exe.
  const asked = [];
  pr.locateGh({ override: undefined, finder: (name) => { asked.push(name); return null; }, resourcesPath: 'C:\\App\\resources', exists: () => false, platform: 'win32' });
  assert.deepEqual(asked, ['gh.exe']);
});

test('signed out with the gh in the app, the sign-in command names it in full', async () => {
  const gh = { path: '/Applications/Demo App.app/Contents/Resources/bin/gh', source: 'bundled' };
  setup({ answer: () => ({ code: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login\n', gh }) });
  const result = await pr.listOpen(DIR);
  assert.equal(result.code, 'gh-auth');
  assert.equal(result.error, 'Sign in to GitHub: in a terminal, run "/Applications/Demo App.app/Contents/Resources/bin/gh" auth login, then try again.');
});

test('gh runs without prompts, colours or update notices, with Homebrew in PATH', () => {
  const env = pr.ghEnv({ PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', HOME: '/home/dev' });
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  assert.equal(env.GH_NO_UPDATE_NOTIFIER, '1');
  assert.equal(env.NO_COLOR, '1');
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.HOME, '/home/dev');
  assert.ok(env.PATH.split(':').includes('/opt/homebrew/bin'));
  assert.ok(env.PATH.startsWith('/usr/bin:/bin'));
});

test('gh\'s marks and colours are taken off its messages', () => {
  assert.equal(pr.cleanGhText('\x1b[32m✓\x1b[0m Merged pull request #7\n! Branch kept\nX failed\ngh: oops\n'), 'Merged pull request #7\nBranch kept\nfailed\noops');
});
