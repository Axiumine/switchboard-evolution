const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../pull-requests');
const edits = require('../pull-request-edits');

const DIR = '/code/widgets';
const HEAD = 'a'.repeat(40);
const GRAPHQL = ['api', 'graphql', '--hostname', 'github.com', '--input', '-'];

/** gh stand-in: `answer(args, opts, n)` gives { stdout, stderr, code }; a mutation answers with data by default. */
function setup(answer = () => ({ code: 0, stderr: '', stdout: JSON.stringify({ data: { done: { clientMutationId: null } } }) })) {
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

// One valid change of every GraphQL kind, the mutation it must run and the variables it must send.
const CASES = [
  [{ kind: 'title', pullRequestId: 'PR_7', title: '  Add widgets  ' }, 'updatePullRequest', { pullRequestId: 'PR_7', title: 'Add widgets' }, 'Title saved.'],
  [{ kind: 'body', pullRequestId: 'PR_7', body: '' }, 'updatePullRequest', { pullRequestId: 'PR_7', body: '' }, 'Description saved.'],
  [{ kind: 'base', pullRequestId: 'PR_7', base: 'release/2.0' }, 'baseRefName: $base', { pullRequestId: 'PR_7', base: 'release/2.0' }, 'The base is release/2.0 now.'],
  [{ kind: 'comment', pullRequestId: 'PR_7', body: 'Thanks!' }, 'addComment', { pullRequestId: 'PR_7', body: 'Thanks!' }, 'Comment added.'],
  [{ kind: 'comment-edit', type: 'issue', id: 'IC_1', body: 'Fixed' }, 'updateIssueComment', { id: 'IC_1', body: 'Fixed' }, 'Comment saved.'],
  [{ kind: 'comment-edit', type: 'review-comment', id: 'PRRC_1', body: 'Fixed' }, 'updatePullRequestReviewComment', { id: 'PRRC_1', body: 'Fixed' }, 'Comment saved.'],
  [{ kind: 'comment-edit', type: 'review', id: 'PRR_1', body: '' }, 'updatePullRequestReview', { id: 'PRR_1', body: '' }, 'Comment saved.'],
  [{ kind: 'comment-delete', type: 'issue', id: 'IC_1' }, 'deleteIssueComment', { id: 'IC_1' }, 'Comment deleted.'],
  [{ kind: 'comment-delete', type: 'review-comment', id: 'PRRC_1' }, 'deletePullRequestReviewComment', { id: 'PRRC_1' }, 'Comment deleted.'],
  [{ kind: 'comment-hide', id: 'IC_1', reason: 'OUTDATED' }, 'minimizeComment', { id: 'IC_1', reason: 'OUTDATED' }, 'Comment hidden.'],
  [{ kind: 'comment-unhide', id: 'IC_1' }, 'unminimizeComment', { id: 'IC_1' }, 'Comment shown again.'],
  [{ kind: 'thread-reply', threadId: 'PRRT_1', body: 'Done' }, 'addPullRequestReviewThreadReply', { threadId: 'PRRT_1', body: 'Done' }, 'Reply added.'],
  [{ kind: 'thread-resolve', threadId: 'PRRT_1' }, 'resolveReviewThread', { threadId: 'PRRT_1' }, 'Conversation resolved.'],
  [{ kind: 'thread-unresolve', threadId: 'PRRT_1' }, 'unresolveReviewThread', { threadId: 'PRRT_1' }, 'Conversation unresolved.'],
  [{ kind: 'react', subjectId: 'IC_1', content: 'ROCKET' }, 'addReaction', { subjectId: 'IC_1', content: 'ROCKET' }, ''],
  [{ kind: 'unreact', subjectId: 'IC_1', content: 'ROCKET' }, 'removeReaction', { subjectId: 'IC_1', content: 'ROCKET' }, ''],
  [{ kind: 'review', pullRequestId: 'PR_7', event: 'APPROVE' }, 'addPullRequestReview', { pullRequestId: 'PR_7', event: 'APPROVE', body: null }, 'Review submitted: approved.'],
  [{ kind: 'review', pullRequestId: 'PR_7', event: 'REQUEST_CHANGES', body: 'Rename it', pendingReviewId: 'PRR_9' }, 'submitPullRequestReview',
    { pendingReviewId: 'PRR_9', event: 'REQUEST_CHANGES', body: 'Rename it' }, 'Review submitted: changes requested.'],
  [{ kind: 'update-branch', pullRequestId: 'PR_7', headOid: HEAD, method: 'REBASE' }, 'updatePullRequestBranch', { pullRequestId: 'PR_7', headOid: HEAD, method: 'REBASE' }, 'The branch is rebased on its base.'],
  [{ kind: 'viewed', pullRequestId: 'PR_7', path: 'src/a b.js' }, 'markFileAsViewed', { pullRequestId: 'PR_7', path: 'src/a b.js' }, ''],
  [{ kind: 'unviewed', pullRequestId: 'PR_7', path: 'src/a.js' }, 'unmarkFileAsViewed', { pullRequestId: 'PR_7', path: 'src/a.js' }, ''],
  [{ kind: 'reviewers', pullRequestId: 'PR_7', users: ['dev-two', 'helper[bot]'], teams: ['core'] }, 'requestReviewsByLogin',
    { pullRequestId: 'PR_7', users: ['dev-two', 'helper[bot]'], teams: ['core'] }, 'Reviewers saved.'],
  [{ kind: 'labels', pullRequestId: 'PR_7', add: ['L_1'], remove: [] }, 'addLabelsToLabelable',
    { pullRequestId: 'PR_7', add: ['L_1'], remove: [], adding: true, removing: false }, 'Labels saved.'],
  [{ kind: 'assignees', pullRequestId: 'PR_7', add: [], remove: ['U_1'] }, 'removeAssigneesFromAssignable',
    { pullRequestId: 'PR_7', add: [], remove: ['U_1'], adding: false, removing: true }, 'Assignees saved.'],
];

test('every change is one fixed gh api graphql call, its texts only in the variables on stdin', async () => {
  for (const [params, mutation, variables, message] of CASES) {
    const calls = setup();
    const result = await edits.edit(DIR, { remote: 'origin', ...params });
    assert.deepEqual(result, { ok: true, kind: params.kind, message }, params.kind);
    assert.equal(calls.length, 1, params.kind);
    assert.deepEqual(calls[0].args, GRAPHQL, params.kind);
    assert.match(calls[0].input.query, /^mutation/, params.kind);
    assert.ok(calls[0].input.query.includes(mutation), `${params.kind}: ${mutation}`);
    assert.deepEqual(calls[0].input.variables, variables, params.kind);
    assert.equal(calls[0].opts.timeoutMs, pr.ACTION_TIMEOUT_MS);
  }
});

test('every kind has a case, and reviewers replace the whole set', () => {
  const covered = new Set([...CASES.map(([p]) => p.kind), 'rerun', 'rerun-job']);
  assert.deepEqual([...covered].sort(), Object.keys(edits.KINDS).sort());
  assert.match(edits.KINDS.reviewers.mutation, /union: false/);
});

test('re-runs are a POST whose path holds only the id', async () => {
  const calls = setup(() => ({ code: 0, stderr: '', stdout: '' }));
  assert.deepEqual(await edits.edit(DIR, { kind: 'rerun', runId: 123456789012 }), { ok: true, kind: 'rerun', message: 'The failed jobs run again.' });
  assert.deepEqual(await edits.edit(DIR, { kind: 'rerun', runId: 5, failedOnly: false }), { ok: true, kind: 'rerun', message: 'The workflow runs again.' });
  assert.deepEqual(await edits.edit(DIR, { kind: 'rerun-job', jobId: 131772433205 }), { ok: true, kind: 'rerun-job', message: 'The job runs again.' });
  assert.deepEqual(calls.map(c => c.args), [
    ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/widgets/actions/runs/123456789012/rerun-failed-jobs'],
    ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/widgets/actions/runs/5/rerun'],
    ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/widgets/actions/jobs/131772433205/rerun'],
  ]);
});

test('anything that is not one of the kinds, or not in its shape, is refused before gh runs', async () => {
  const calls = setup();
  const refused = [
    null,
    { kind: 'delete-repository' },
    { kind: 'constructor' },
    { kind: 'title', pullRequestId: 'PR_7' },
    { kind: 'title', pullRequestId: 'PR_7', title: '   ' },
    { kind: 'title', pullRequestId: 'PR_7', title: 'two\nlines' },
    { kind: 'title', pullRequestId: 'PR_7', title: 'x'.repeat(edits.MAX_TITLE + 1) },
    { kind: 'title', pullRequestId: 'PR 7', title: 'ok' },
    { kind: 'title', pullRequestId: 'PR_7', title: 'ok', state: 'CLOSED' },
    { kind: 'body', pullRequestId: 'PR_7', body: 'x'.repeat(edits.MAX_BODY + 1) },
    { kind: 'comment', pullRequestId: 'PR_7', body: '  ' },
    { kind: 'comment-edit', type: 'issue', id: 'IC_1', body: '' },
    { kind: 'comment-edit', type: 'discussion', id: 'IC_1', body: 'x' },
    { kind: 'comment-delete', type: 'review', id: 'PRR_1' },
    { kind: 'comment-hide', id: 'IC_1', reason: 'BORING' },
    { kind: 'react', subjectId: 'IC_1', content: 'PARTY' },
    { kind: 'review', pullRequestId: 'PR_7', event: 'COMMENT' },
    { kind: 'review', pullRequestId: 'PR_7', event: 'DISMISS', body: 'x' },
    { kind: 'base', pullRequestId: 'PR_7', base: '--upload-pack=x' },
    { kind: 'update-branch', pullRequestId: 'PR_7', headOid: 'main', method: 'MERGE' },
    { kind: 'update-branch', pullRequestId: 'PR_7', headOid: HEAD, method: 'SQUASH' },
    { kind: 'viewed', pullRequestId: 'PR_7', path: '' },
    { kind: 'reviewers', pullRequestId: 'PR_7', users: ['-rf'], teams: [] },
    { kind: 'reviewers', pullRequestId: 'PR_7', users: 'dev-two', teams: [] },
    { kind: 'labels', pullRequestId: 'PR_7', add: [], remove: [] },
    { kind: 'labels', pullRequestId: 'PR_7', add: ['L 1'], remove: [] },
    { kind: 'rerun', runId: '5/../../x' },
    { kind: 'rerun', runId: 1.5 },
    { kind: 'rerun-job', jobId: -3 },
  ];
  for (const params of refused) {
    const result = await edits.edit(DIR, params);
    assert.equal(result.code, 'bad-request', JSON.stringify(params));
  }
  assert.equal(calls.length, 0);
});

test('branch names follow git\'s rules', () => {
  for (const name of ['main', 'release/2.0', 'feature/a-b_c', 'v1.2.3', 'dependabot/npm_and_yarn/x-1.0']) assert.ok(edits.isBranchName(name), name);
  for (const name of ['', '-x', '/main', 'main/', 'a..b', 'a//b', 'a@{1}', 'with space', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', 'x.lock', 'a/.hidden', 'end.', '@', 'x'.repeat(256)]) {
    assert.ok(!edits.isBranchName(name), name);
  }
});

test('the base and the branch update wait for a merge of the same repository, other changes do not', async () => {
  let release;
  setup((args) => (args[1] === 'merge'
    ? new Promise((resolve) => { release = () => resolve({ code: 0, stdout: '', stderr: '' }); })
    : { code: 0, stderr: '', stdout: JSON.stringify({ data: {} }) }));
  const merging = pr.runAction(DIR, { number: 7, action: 'merge', method: 'merge' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await edits.edit(DIR, { kind: 'base', pullRequestId: 'PR_7', base: 'main' })).code, 'busy');
  assert.equal((await edits.edit(DIR, { kind: 'update-branch', pullRequestId: 'PR_7', headOid: HEAD, method: 'MERGE' })).code, 'busy');
  assert.equal((await edits.edit(DIR, { kind: 'comment', pullRequestId: 'PR_7', body: 'x' })).ok, true);
  release();
  await merging;
  assert.equal((await edits.edit(DIR, { kind: 'base', pullRequestId: 'PR_7', base: 'main' })).ok, true);
  // ...and a failed one lets the next one run.
  setup(() => ({ code: 0, stderr: '', stdout: JSON.stringify({ errors: [{ message: 'Proposed base branch not found' }] }) }));
  assert.match((await edits.edit(DIR, { kind: 'base', pullRequestId: 'PR_7', base: 'gone' })).error, /base branch not found/);
  assert.equal((await edits.edit(DIR, { kind: 'base', pullRequestId: 'PR_7', base: 'gone' })).code, 'gh-failed');
});

test('GitHub\'s refusals come back in plain words', async () => {
  const refuse = message => setup(() => ({ code: 0, stderr: '', stdout: JSON.stringify({ errors: [{ message }] }) }));
  refuse('Review Can not approve your own pull request');
  assert.equal((await edits.edit(DIR, { kind: 'review', pullRequestId: 'PR_7', event: 'APPROVE' })).error, 'You cannot approve your own pull request.');
  refuse('Review Can not request changes on your own pull request');
  assert.equal((await edits.edit(DIR, { kind: 'review', pullRequestId: 'PR_7', event: 'REQUEST_CHANGES', body: 'x' })).error, 'You cannot request changes on your own pull request.');
  refuse('User can only have one pending review per pull request');
  assert.match((await edits.edit(DIR, { kind: 'review', pullRequestId: 'PR_7', event: 'COMMENT', body: 'x' })).error, /pending review/);
  refuse("Could not resolve to a node with the global id of 'IC_1'");
  assert.deepEqual(await edits.edit(DIR, { kind: 'comment-delete', type: 'issue', id: 'IC_1' }),
    { error: 'GitHub no longer has it: it may have been deleted meanwhile. Refresh to see the pull request as it is now.', code: 'not-found' });
  refuse('Expected head oid did not match');
  assert.match((await edits.edit(DIR, { kind: 'update-branch', pullRequestId: 'PR_7', headOid: HEAD, method: 'MERGE' })).error, /New commits/);
  setup(() => ({ code: 4, stderr: 'gh auth login', stdout: '' }));
  assert.equal((await edits.edit(DIR, { kind: 'comment', pullRequestId: 'PR_7', body: 'x' })).code, 'gh-auth');
  setup(() => ({ code: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)', stdout: '' }));
  assert.match((await edits.edit(DIR, { kind: 'rerun-job', jobId: 5 })).error, /Resource not accessible/);
});

test('without a GitHub remote nothing is changed', async () => {
  const calls = [];
  pr.init({ git: { remoteList: async () => [], configListIncludes: async () => [] }, runGh: async (args) => { calls.push(args); return {}; } });
  assert.equal((await edits.edit(DIR, { kind: 'comment', pullRequestId: 'PR_7', body: 'x' })).code, 'no-github-remote');
  assert.equal(calls.length, 0);
});
