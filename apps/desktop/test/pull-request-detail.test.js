const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../pull-requests');
const detail = require('../pull-request-detail');

const DIR = '/code/widgets';
const SHA = 'b'.repeat(40);

/** gh stand-in for pull-requests.js and its siblings: `answer(args, opts, n)` gives { stdout, stderr, code }. */
function setup(answer) {
  const calls = [];
  pr.init({
    git: { remoteList: async () => [{ name: 'origin', url: 'git@github.com:acme/widgets.git' }], configListIncludes: async () => [] },
    runGh: async (args, opts = {}) => {
      calls.push({ args, opts, input: opts.input ? JSON.parse(opts.input) : null });
      return answer(args, opts, calls.length);
    },
  });
  return calls;
}

const json = data => ({ code: 0, stderr: '', stdout: JSON.stringify({ data }) });
const pullRequest = node => json({ repository: { pullRequest: node } });

const reactionGroups = [
  { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 2 } },
  { content: 'HEART', viewerHasReacted: false, reactors: { totalCount: 0 } },
];

function comment(id, extra = {}) {
  return {
    __typename: 'IssueComment', id, url: `https://github.com/acme/widgets/pull/7#issuecomment-${id}`,
    body: 'Looks **good**', bodyHTML: '<p>Looks <strong>good</strong></p>', createdAt: '2026-01-02T10:00:00Z', lastEditedAt: null,
    authorAssociation: 'MEMBER', author: { login: 'dev-two', avatarUrl: 'https://avatars.example/dev-two' },
    viewerCanUpdate: true, viewerCanDelete: true, viewerCanReact: true, viewerDidAuthor: true,
    viewerCanMinimize: false, isMinimized: false, minimizedReason: null, reactionGroups,
    ...extra,
  };
}

const HEAD_NODE = {
  id: 'PR_7', number: 7, title: 'Add widgets', url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN', isDraft: false,
  body: 'The **why**', bodyHTML: '<p>The <strong>why</strong></p>', createdAt: '2026-01-01T09:00:00Z', lastEditedAt: '2026-01-01T09:30:00Z',
  authorAssociation: 'OWNER', author: { login: 'dev-one', avatarUrl: null },
  viewerCanUpdate: true, viewerCanReact: true, viewerCanClose: true, viewerCanReopen: false, viewerCanUpdateBranch: true,
  viewerCanLabel: true, viewerCanAssign: false, viewerDidAuthor: true,
  mergeStateStatus: 'BEHIND', mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED', totalCommentsCount: 5, allCommits: { totalCount: 2 },
  headRefName: 'feature', headRefOid: SHA, baseRefName: 'main', isCrossRepository: false,
  reactionGroups,
  reviewRequests: { nodes: [
    { requestedReviewer: { __typename: 'User', login: 'dev-three', avatarUrl: null } },
    { requestedReviewer: { __typename: 'Team', name: 'Core', slug: 'core' } },
    { requestedReviewer: { __typename: 'User', login: 'dev-two', avatarUrl: null } },
  ] },
  latestReviews: { nodes: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-02T11:00:00Z', author: { login: 'dev-two', avatarUrl: null } },
    { state: 'APPROVED', submittedAt: '2026-01-02T12:00:00Z', author: { login: 'dev-four', avatarUrl: null } }] },
  assignees: { nodes: [{ id: 'U_1', login: 'dev-one', avatarUrl: null }] },
  labels: { nodes: [{ id: 'L_1', name: 'bug', color: 'd73a4a', description: 'Something is wrong' }] },
  pendingReviews: { nodes: [{ id: 'PRR_pending' }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
};

const TIMELINE = [
  comment('IC_1'),
  comment('IC_2', { viewerDidAuthor: false, viewerCanUpdate: false, viewerCanDelete: false, isMinimized: true, minimizedReason: 'OUTDATED' }),
  { __typename: 'PullRequestReview', id: 'PRR_1', url: 'https://github.com/acme/widgets/pull/7#pullrequestreview-1', body: 'Please rename', bodyHTML: '<p>Please rename</p>',
    createdAt: '2026-01-02T11:00:00Z', lastEditedAt: null, authorAssociation: 'MEMBER', author: { login: 'dev-two', avatarUrl: null },
    viewerCanUpdate: false, viewerCanDelete: false, viewerCanReact: true, viewerDidAuthor: false, reactionGroups: [],
    state: 'CHANGES_REQUESTED', submittedAt: '2026-01-02T11:00:00Z' },
  { __typename: 'PullRequestCommit', url: 'https://github.com/acme/widgets/pull/7/commits/abc', commit: {
    oid: SHA, abbreviatedOid: 'bbbbbbb', messageHeadline: 'Rename it', committedDate: '2026-01-02T12:00:00Z',
    author: { name: 'Dev One', user: { login: 'dev-one' } }, statusCheckRollup: { state: 'SUCCESS' } } },
  { __typename: 'RenamedTitleEvent', createdAt: '2026-01-02T13:00:00Z', actor: { login: 'dev-one' }, previousTitle: 'WIP', currentTitle: 'Add widgets' },
  { __typename: 'BaseRefChangedEvent', createdAt: '2026-01-02T13:01:00Z', actor: { login: 'dev-one' }, previousRefName: 'develop', currentRefName: 'main' },
  { __typename: 'ReviewRequestedEvent', createdAt: '2026-01-02T13:02:00Z', actor: { login: 'dev-one' }, requestedReviewer: { __typename: 'Team', name: 'Core', slug: 'core' } },
  { __typename: 'LabeledEvent', createdAt: '2026-01-02T13:03:00Z', actor: { login: 'dev-one' }, label: { name: 'bug', color: 'd73a4a' } },
  { __typename: 'AssignedEvent', createdAt: '2026-01-02T13:04:00Z', actor: { login: 'dev-one' }, assignee: { login: 'dev-one' } },
  { __typename: 'MergedEvent', createdAt: '2026-01-02T14:00:00Z', actor: null, mergeRefName: 'main', mergeCommit: { abbreviatedOid: 'ccccccc' } },
  { __typename: 'SomethingNewEvent', createdAt: '2026-01-02T15:00:00Z' },
  null,
];

const THREADS = [{
  id: 'PRRT_1', isResolved: false, isOutdated: true, path: 'src/widget.js', line: null, originalLine: 12,
  resolvedBy: null, viewerCanResolve: true, viewerCanUnresolve: false, viewerCanReply: true,
  comments: { nodes: [
    { ...comment('PRRC_1'), __typename: undefined, diffHunk: '@@ -10,3 +10,4 @@\n a\n+b', outdated: true, replyTo: null, pullRequestReview: { id: 'PRR_1' } },
    { ...comment('PRRC_2'), __typename: undefined, diffHunk: '@@ -10,3 +10,4 @@\n a\n+b', outdated: true, replyTo: { id: 'PRRC_1' }, pullRequestReview: { id: 'PRR_2' } },
  ] },
}];

function conversationAnswer({ hasNextPage = true, endCursor = 'cursor-1' } = {}) {
  return pullRequest({
    id: 'PR_7', ...HEAD_NODE,
    timelineItems: { filteredCount: 10, pageInfo: { hasNextPage, endCursor }, nodes: TIMELINE },
    reviewThreads: { nodes: THREADS },
  });
}

// --- Conversation ---

test('the conversation comes in one GraphQL read: the pull request, a page of its timeline and its review threads', async () => {
  const calls = setup(() => conversationAnswer());
  const result = await detail.conversation(DIR, { number: 7 });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', number: 7, after: null, full: true });
  for (const type of detail.TIMELINE_TYPES) assert.match(calls[0].input.query, new RegExp(type));

  assert.deepEqual(result.pr.can, { update: true, react: true, close: true, reopen: false, updateBranch: true, label: true, assign: false });
  assert.equal(result.pr.bodyHtml, '<p>The <strong>why</strong></p>');
  assert.equal(result.pr.editedAt, '2026-01-01T09:30:00Z');
  assert.equal(result.pr.mergeStateStatus, 'BEHIND');
  assert.deepEqual([result.pr.comments, result.pr.commitCount], [5, 2]);
  assert.equal(result.pr.checks, 'PENDING');
  assert.equal(result.pr.pendingReviewId, 'PRR_pending');
  assert.deepEqual(result.pr.reactions, [{ content: 'THUMBS_UP', count: 2, mine: true }]);
  // Who reviewed keeps the latest review's state; asked again counts as asked.
  assert.deepEqual(result.pr.reviewers.map(r => [r.kind, r.login, r.state]), [
    ['user', 'dev-two', 'REQUESTED'], ['user', 'dev-four', 'APPROVED'], ['user', 'dev-three', 'REQUESTED'], ['team', 'core', 'REQUESTED'],
  ]);
  assert.deepEqual(result.pr.labels, [{ id: 'L_1', name: 'bug', color: 'd73a4a', description: 'Something is wrong' }]);
  assert.deepEqual(result.pr.assignees, [{ id: 'U_1', login: 'dev-one', avatar: null }]);

  const items = result.timeline.items;
  assert.deepEqual(items.map(i => (i.kind === 'event' ? i.type : i.kind)),
    ['comment', 'comment', 'review', 'commit', 'renamed', 'base-changed', 'review-requested', 'labeled', 'assigned', 'merged']);
  assert.deepEqual(items[0].can, { update: true, delete: true, minimize: false, react: true });
  assert.equal(items[0].mine, true);
  assert.equal(items[0].minimized, null);
  assert.equal(items[1].minimized, 'outdated');
  assert.equal(items[2].state, 'CHANGES_REQUESTED');
  assert.deepEqual(items[3], {
    kind: 'commit', oid: SHA, short: 'bbbbbbb', headline: 'Rename it', author: 'dev-one', createdAt: '2026-01-02T12:00:00Z',
    checks: 'SUCCESS', url: 'https://github.com/acme/widgets/pull/7/commits/abc',
  });
  assert.deepEqual([items[4].from, items[4].to], ['WIP', 'Add widgets']);
  assert.deepEqual([items[5].from, items[5].to], ['develop', 'main']);
  assert.equal(items[6].subject, 'Core');
  assert.deepEqual(items[7].label, { name: 'bug', color: 'd73a4a' });
  assert.equal(items[8].subject, 'dev-one');
  assert.deepEqual([items[9].actor, items[9].commit, items[9].to], ['ghost', 'ccccccc', 'main']);
  assert.deepEqual(result.timeline, { items, totalCount: 10, hasNextPage: true, endCursor: 'cursor-1' });

  assert.equal(result.threads.length, 1);
  const [thread] = result.threads;
  assert.deepEqual([thread.id, thread.path, thread.line, thread.resolved, thread.outdated, thread.reviewId], ['PRRT_1', 'src/widget.js', 12, false, true, 'PRR_1']);
  assert.deepEqual(thread.can, { resolve: true, unresolve: false, reply: true });
  assert.match(thread.diffHunk, /^@@ -10,3/);
  assert.deepEqual(thread.comments.map(c => [c.kind, c.id, c.replyTo]), [['review-comment', 'PRRC_1', null], ['review-comment', 'PRRC_2', 'PRRC_1']]);
});

test('the next page of the timeline comes alone, without the pull request again', async () => {
  const calls = setup(() => pullRequest({ id: 'PR_7', timelineItems: { filteredCount: 10, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [comment('IC_9')] } }));
  const result = await detail.conversation(DIR, { number: 7, after: 'cursor-1' });
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', number: 7, after: 'cursor-1', full: false });
  assert.equal(result.pr, undefined);
  assert.equal(result.threads, undefined);
  assert.deepEqual(result.timeline.items.map(i => i.id), ['IC_9']);
  assert.equal(result.timeline.hasNextPage, false);
});

test('a conversation needs a pull request number and a real cursor, and says when GitHub has no such pull request', async () => {
  const calls = setup(() => json({ repository: { pullRequest: null } }));
  assert.equal((await detail.conversation(DIR, { number: '7 --x' })).code, 'bad-request');
  assert.equal((await detail.conversation(DIR, { number: 7, after: '' })).code, 'bad-request');
  assert.equal(calls.length, 0);
  assert.equal((await detail.conversation(DIR, { number: 7 })).code, 'not-found');
  setup(() => ({ code: 0, stderr: '', stdout: JSON.stringify({ errors: [{ message: 'Could not resolve to a PullRequest with the number of 7.' }] }) }));
  assert.equal((await detail.conversation(DIR, { number: 7 })).code, 'not-found');
});

// --- Commits ---

function commitNode(i) {
  return { commit: {
    oid: String(i).padStart(40, '0'), abbreviatedOid: String(i).padStart(7, '0'), messageHeadline: `Step ${i}`, messageBody: i === 1 ? 'Why it changed' : '',
    committedDate: '2026-01-03T10:00:00Z', url: `https://github.com/acme/widgets/commit/${i}`,
    author: i === 2 ? { name: 'Somebody', user: null } : { name: 'Dev One', user: { login: 'dev-one', avatarUrl: null } },
    statusCheckRollup: i === 1 ? { state: 'FAILURE' } : null,
  } };
}

test('commits are read 100 at a time, at most the 250 GitHub lists', async () => {
  const calls = setup(() => pullRequest({ commits: { totalCount: 300, pageInfo: { hasNextPage: true, endCursor: 'next' }, nodes: [commitNode(1), commitNode(2)] } }));
  const result = await detail.commits(DIR, { number: 7 });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].input.variables.after, 'next');
  assert.equal(result.truncated, true);
  assert.equal(result.totalCount, 300);
  assert.deepEqual(result.commits[0], {
    oid: '1'.padStart(40, '0'), short: '0000001', headline: 'Step 1', body: 'Why it changed', date: '2026-01-03T10:00:00Z',
    author: 'dev-one', avatar: null, url: 'https://github.com/acme/widgets/commit/1', checks: 'FAILURE',
  });
  assert.equal(result.commits[1].author, 'Somebody');
  assert.equal(result.commits[1].checks, null);
});

test('a commit\'s files come from REST with only its full hash in the path', async () => {
  const line = JSON.stringify({ filename: 'src/a.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n-a\n+b' });
  const calls = setup(() => ({ code: 0, stderr: '', stdout: `${line}\n` }));
  const result = await detail.commitFiles(DIR, { sha: SHA });
  assert.deepEqual(calls[0].args, [
    'api', '--hostname', 'github.com', '--paginate', `repos/acme/widgets/commits/${SHA}?per_page=100`,
    '--jq', '.files[] | {filename, previous_filename, status, additions, deletions, patch}',
  ]);
  assert.deepEqual(result.files.map(f => [f.path, f.status, f.insertions]), [['src/a.js', 'modified', 1]]);
  for (const sha of ['main', 'abc', `${SHA}; rm -rf`, SHA.toUpperCase(), undefined]) {
    assert.equal((await detail.commitFiles(DIR, { sha })).code, 'bad-request', String(sha));
  }
  assert.equal(calls.length, 1);
});

// --- Checks ---

test('checks are sorted as gh pr checks sorts them', () => {
  const run = (status, conclusion) => detail.checkBucket('run', status, conclusion);
  assert.equal(run('IN_PROGRESS', null), 'pending');
  assert.equal(run('QUEUED', null), 'pending');
  assert.equal(run('COMPLETED', 'SUCCESS'), 'pass');
  assert.equal(run('COMPLETED', 'NEUTRAL'), 'pass');
  assert.equal(run('COMPLETED', 'SKIPPED'), 'skipped');
  assert.equal(run('COMPLETED', 'CANCELLED'), 'cancelled');
  for (const conclusion of ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) assert.equal(run('COMPLETED', conclusion), 'fail');
  assert.equal(detail.checkBucket('status', 'SUCCESS'), 'pass');
  assert.equal(detail.checkBucket('status', 'ERROR'), 'fail');
  assert.equal(detail.checkBucket('status', 'EXPECTED'), 'pending');
});

test('the checks of the last commit come with their workflow, their job and a count per state', async () => {
  const calls = setup(() => pullRequest({ headRefOid: SHA, commits: { nodes: [{ commit: { oid: SHA, statusCheckRollup: { state: 'FAILURE', contexts: {
    totalCount: 3, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
      { __typename: 'CheckRun', databaseId: 9001, name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-01-04T10:00:00Z',
        completedAt: '2026-01-04T10:03:00Z', detailsUrl: 'https://github.com/acme/widgets/actions/runs/1/job/9001', title: null, isRequired: true,
        checkSuite: { app: { name: 'GitHub Actions' }, workflowRun: { databaseId: 1, event: 'pull_request', url: 'https://github.com/acme/widgets/actions/runs/1', workflow: { name: 'CI' } } } },
      { __typename: 'CheckRun', databaseId: 77, name: 'coverage', status: 'IN_PROGRESS', conclusion: null, startedAt: null, completedAt: null,
        detailsUrl: 'https://ci.example/77', title: 'Measuring', isRequired: false, checkSuite: { app: { name: 'Example CI' }, workflowRun: null } },
      { __typename: 'StatusContext', context: 'deploy/preview', state: 'SUCCESS', description: 'Deployed', targetUrl: 'https://preview.example/7', createdAt: '2026-01-04T10:05:00Z', isRequired: false },
    ] } } } }] } }));
  const result = await detail.checks(DIR, { number: 7 });
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', number: 7, after: null });
  assert.equal(result.rollup, 'FAILURE');
  assert.equal(result.headOid, SHA);
  assert.deepEqual(result.summary, { pass: 1, fail: 1, pending: 1, skipped: 0, cancelled: 0 });
  const [test1, coverage, deploy] = result.checks;
  assert.deepEqual([test1.kind, test1.id, test1.group, test1.runId, test1.bucket, test1.required, test1.actions], ['run', 9001, 'CI', 1, 'fail', true, true]);
  assert.deepEqual([coverage.group, coverage.bucket, coverage.actions, coverage.title], ['Example CI', 'pending', false, 'Measuring']);
  assert.deepEqual([deploy.kind, deploy.name, deploy.bucket, deploy.url, deploy.actions], ['status', 'deploy/preview', 'pass', 'https://preview.example/7', false]);
});

test('a pull request without checks has none', async () => {
  setup(() => pullRequest({ headRefOid: SHA, commits: { nodes: [{ commit: { oid: SHA, statusCheckRollup: null } }] } }));
  const result = await detail.checks(DIR, { number: 7 });
  assert.deepEqual([result.ok, result.rollup, result.checks.length], [true, null, 0]);
});

// --- A job's log ---

test('a job\'s log loses its colours and timestamps, and asks gh to let escapes through only when gh says so', async () => {
  const raw = '﻿2026-01-04T10:00:00.1234567Z ##[group]Run tests\n2026-01-04T10:00:01.0000000Z \x1b[31mFAIL\x1b[0m widget.test.js\r\n';
  const calls = setup((args) => (args.includes('--allow-escape-sequences')
    ? { code: 0, stderr: '', stdout: raw }
    : { code: 1, stderr: 'the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway', stdout: '' }));
  const result = await detail.jobLog(DIR, { jobId: 131772433205 });
  assert.deepEqual(calls.map(c => c.args), [
    ['api', '--hostname', 'github.com', 'repos/acme/widgets/actions/jobs/131772433205/logs'],
    ['api', '--hostname', 'github.com', 'repos/acme/widgets/actions/jobs/131772433205/logs', '--allow-escape-sequences'],
  ]);
  assert.deepEqual(result, { ok: true, jobId: 131772433205, text: '##[group]Run tests\nFAIL widget.test.js\n', truncated: false });
});

test('a log without escapes is read once, a missing one is explained, and only a job id reaches gh', async () => {
  let calls = setup(() => ({ code: 0, stderr: '', stdout: 'plain\n' }));
  assert.equal((await detail.jobLog(DIR, { jobId: 5 })).text, 'plain\n');
  assert.equal(calls.length, 1);
  setup(() => ({ code: 1, stderr: 'gh: Not Found (HTTP 404)', stdout: '' }));
  assert.match((await detail.jobLog(DIR, { jobId: 5 })).error, /once the job has finished/);
  calls = setup(() => ({ code: 0, stderr: '', stdout: '' }));
  for (const jobId of ['5/../../x', -1, 0, 1.5, 'abc', undefined]) assert.equal((await detail.jobLog(DIR, { jobId })).code, 'bad-request', String(jobId));
  assert.equal(calls.length, 0);
});

test('only the end of a very long log is kept, from a whole line', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const result = detail.cleanLog(lines, 60);
  assert.equal(result.truncated, true);
  assert.ok(result.text.endsWith('line 99'));
  assert.ok(/^line \d+/.test(result.text));
  assert.ok(Buffer.byteLength(result.text) <= 60);
});

// --- Viewed, branches, candidates, preview ---

test('viewed files are those this account marked, or whose mark a change dismissed', async () => {
  const calls = setup((_a, _o, n) => pullRequest({ files: n === 1
    ? { pageInfo: { hasNextPage: true, endCursor: 'f1' }, nodes: [{ path: 'a.js', viewerViewedState: 'VIEWED' }, { path: 'b.js', viewerViewedState: 'UNVIEWED' }] }
    : { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: 'c.js', viewerViewedState: 'DISMISSED' }] } }));
  const result = await detail.viewed(DIR, { number: 7 });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.viewed, { 'a.js': 'VIEWED', 'c.js': 'DISMISSED' });
});

test('branches for Change base come by name, with the default one', async () => {
  const calls = setup(() => json({ repository: { defaultBranchRef: { name: 'main' }, refs: { totalCount: 3, nodes: [{ name: 'develop' }, { name: 'main' }, { name: 'release' }] } } }));
  const result = await detail.branches(DIR, { query: 'rel' });
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', query: 'rel' });
  assert.match(calls[0].input.query, /refPrefix: "refs\/heads\/"/);
  assert.deepEqual(result, { ok: true, defaultBranch: 'main', branches: ['develop', 'main', 'release'], totalCount: 3 });
  assert.equal((await detail.branches(DIR, { query: 'x'.repeat(201) })).code, 'bad-request');
  // Not among the first 100 by name: the default branch comes all the same, when it matches.
  setup(() => json({ repository: { defaultBranchRef: { name: 'trunk' }, refs: { totalCount: 300, nodes: [{ name: 'aaa' }] } } }));
  assert.deepEqual((await detail.branches(DIR, {})).branches, ['trunk', 'aaa']);
  assert.deepEqual((await detail.branches(DIR, { query: 'TR' })).branches, ['trunk', 'aaa']);
  assert.deepEqual((await detail.branches(DIR, { query: 'aa' })).branches, ['aaa']);
});

test('the sidebar is offered the repository\'s labels and the people who may be assigned', async () => {
  let calls = setup(() => json({ repository: { labels: { totalCount: 1, nodes: [{ id: 'L_1', name: 'bug', color: 'd73a4a', description: null }] } } }));
  assert.deepEqual(await detail.candidates(DIR, { kind: 'labels' }), { ok: true, kind: 'labels', items: [{ id: 'L_1', name: 'bug', color: 'd73a4a', description: '' }], totalCount: 1 });
  assert.match(calls[0].input.query, /labels\(first: 100/);
  calls = setup(() => json({ repository: { assignableUsers: { totalCount: 1, nodes: [{ id: 'U_2', login: 'dev-two', name: null, avatarUrl: null }] } } }));
  assert.deepEqual((await detail.candidates(DIR, { kind: 'users', query: 'dev' })).items, [{ id: 'U_2', login: 'dev-two', name: '', avatar: null }]);
  assert.equal(calls[0].input.variables.query, 'dev');
  assert.equal((await detail.candidates(DIR, { kind: 'teams' })).code, 'bad-request');
  assert.equal(calls.length, 1);
});

test('the preview is GitHub\'s own HTML, the text going on stdin', async () => {
  const calls = setup(() => ({ code: 0, stderr: '', stdout: '<p>Hi <strong>there</strong></p>\n' }));
  const result = await detail.renderMarkdown(DIR, { text: 'Hi **there**' });
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.com', '--method', 'POST', 'markdown', '--input', '-']);
  assert.deepEqual(calls[0].input, { text: 'Hi **there**', mode: 'gfm', context: 'acme/widgets' });
  assert.deepEqual(result, { ok: true, html: '<p>Hi <strong>there</strong></p>\n' });
  assert.deepEqual(await detail.renderMarkdown(DIR, { text: '   ' }), { ok: true, html: '' });
  assert.equal((await detail.renderMarkdown(DIR, { text: 'x'.repeat(detail.MAX_MARKDOWN + 1) })).code, 'bad-request');
  assert.equal((await detail.renderMarkdown(DIR, { text: 42 })).code, 'bad-request');
  assert.equal(calls.length, 1);
});

test('without a GitHub remote nothing is read', async () => {
  const calls = [];
  pr.init({ git: { remoteList: async () => [{ name: 'origin', url: 'https://gitlab.com/acme/widgets.git' }], configListIncludes: async () => [] }, runGh: async (args) => { calls.push(args); return {}; } });
  for (const result of [await detail.conversation(DIR, { number: 7 }), await detail.checks(DIR, { number: 7 }), await detail.branches(DIR, {})]) {
    assert.equal(result.code, 'no-github-remote');
  }
  assert.equal(calls.length, 0);
});
