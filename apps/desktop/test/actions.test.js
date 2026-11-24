// actions.js: what the Actions view reads of GitHub Actions through gh. The
// answers have the shapes of real REST and GraphQL answers, with made-up names.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../pull-requests');
const actions = require('../actions');

const DIR = '/code/widgets';
const SHA = 'c'.repeat(40);

/** gh stand-in: `answer(args, opts, n)` gives { stdout, stderr, code }. */
function setup(answer) {
  const calls = [];
  pr.init({
    git: { remoteList: async () => [{ name: 'origin', url: 'git@github.com:acme/widgets.git' }], configListIncludes: async () => [] },
    runGh: async (args, opts = {}) => {
      calls.push({ args, opts });
      return answer(args, opts, calls.length);
    },
  });
  return calls;
}

beforeEach(() => actions.resetCaches());

const RATE = { 'X-Ratelimit-Limit': '5000', 'X-Ratelimit-Remaining': '4990', 'X-Ratelimit-Reset': '1800000000', 'X-Ratelimit-Resource': 'core' };

/** What `gh api -i` prints: the status line, the headers (CRLF), a blank line, the body. */
function http(status, body, headers = {}) {
  const head = Object.entries({ ...RATE, ...headers }).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const ok = status >= 200 && status < 300;
  return { code: ok ? 0 : 1, stdout: `HTTP/2.0 ${status} X\n${head}\r\n${status === 304 ? '' : text}`, stderr: ok ? '' : `gh: HTTP ${status}` };
}
const graphql = data => ({ code: 0, stderr: '', stdout: JSON.stringify({ data }) });
const isGraphql = args => args[1] === 'graphql';
const path = args => args.find(a => /^repos\//.test(a));

const REPO = { nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets', viewerPermission: 'WRITE', isArchived: false, isFork: false, defaultBranchRef: { name: 'main' } };

function apiRun(id, extra = {}) {
  return {
    id, run_number: id % 1000, run_attempt: 1, name: 'CI', display_title: 'Fix the widget', workflow_id: 11, path: '.github/workflows/ci.yml',
    event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: SHA,
    actor: { login: 'dev-one', avatar_url: 'https://avatars.example/dev-one' }, triggering_actor: { login: 'dev-one' },
    repository: { full_name: 'acme/widgets' }, head_repository: { full_name: 'acme/widgets' },
    pull_requests: [], head_commit: { id: SHA, message: 'Fix the widget\n\nLonger text', author: { name: 'Dev One' } },
    created_at: '2026-01-01T10:00:00Z', run_started_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:03:00Z',
    html_url: `https://github.com/acme/widgets/actions/runs/${id}`, check_suite_id: 5, check_suite_node_id: 'CS_kwDOABC', referenced_workflows: [],
    ...extra,
  };
}

function apiJob(id, name, extra = {}) {
  return {
    id, name, status: 'completed', conclusion: 'success', created_at: '2026-01-01T10:00:00Z', started_at: '2026-01-01T10:00:01Z', completed_at: '2026-01-01T10:01:00Z',
    html_url: `https://github.com/acme/widgets/actions/runs/900/job/${id}`, run_id: 900, run_attempt: 1, runner_name: 'GitHub Actions 7', runner_group_name: 'GitHub Actions',
    labels: ['ubuntu-latest'], workflow_name: 'CI', head_branch: 'main', head_sha: SHA,
    steps: [{ number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', started_at: '2026-01-01T10:00:01Z', completed_at: '2026-01-01T10:00:02Z' }],
    ...extra,
  };
}

// --- gh -i ---

test('gh -i\'s output gives the status, the headers and the body', () => {
  const answer = actions.parseHttp('HTTP/2.0 200 OK\nEtag: W/"abc"\r\nX-Ratelimit-Remaining: 12\r\n\r\n{"a":1}');
  assert.deepEqual(answer, { status: 200, headers: { etag: 'W/"abc"', 'x-ratelimit-remaining': '12' }, body: '{"a":1}' });
  assert.equal(actions.parseHttp('HTTP/2.0 304 Not Modified\nEtag: "abc"\r\n\r\n').status, 304);
  assert.equal(actions.parseHttp('HTTP/2.0 200 OK\n\r\n[]').body, '[]');
  assert.equal(actions.parseHttp('not http'), null);
});

// --- Workflows ---

test('the workflows come with the account\'s permission, active ones by name first, deleted ones left out', async () => {
  const calls = setup(args => (isGraphql(args) ? graphql({ repository: REPO }) : path(args).includes('/contents/') ? { ...http(404, { message: 'Not Found' }), stderr: 'gh: Not Found (HTTP 404)' } : http(200, { total_count: 4, workflows: [
    { id: 1, name: 'lint', path: '.github/workflows/lint.yml', state: 'active', html_url: 'https://github.com/acme/widgets/blob/main/.github/workflows/lint.yml' },
    { id: 2, name: 'Build', path: '.github/workflows/build.yml', state: 'disabled_manually' },
    { id: 3, name: 'Old', path: '.github/workflows/old.yml', state: 'deleted' },
    { id: 4, name: 'Copilot', path: 'dynamic/copilot-swe-agent/copilot', state: 'active' },
  ] })));
  const result = await actions.workflows(DIR, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.workflows.map(w => [w.name, w.file, w.state, w.dynamic]), [
    ['Copilot', 'copilot', 'active', true], ['lint', 'lint.yml', 'active', false], ['Build', 'build.yml', 'disabled_manually', false],
  ]);
  assert.deepEqual([result.repo.permission, result.repo.canWrite, result.repo.isAdmin, result.repo.defaultBranch], ['WRITE', true, false, 'main']);
  assert.deepEqual(result.rate, { limit: 5000, remaining: 4990, resetAt: 1800000000000 });
  assert.equal(result.lockfile, false);
  const rest = calls.find(c => !isGraphql(c.args) && !path(c.args).includes('/contents/'));
  assert.deepEqual(rest.args, ['api', '--hostname', 'github.com', '-i', 'repos/acme/widgets/actions/workflows?per_page=100&page=1']);
});

// --- Runs ---

test('a page of runs: the qualifiers become the API\'s filters, and the runs come normalised', async () => {
  const fork = apiRun(902, {
    event: 'pull_request', head_repository: { full_name: 'someone/widgets' },
    pull_requests: [
      { number: 7, head: { ref: 'feature' }, base: { ref: 'main', repo: { url: 'https://api.github.com/repos/acme/widgets' } } },
      { number: 3, head: { ref: 'main' }, base: { ref: 'main', repo: { url: 'https://api.github.com/repos/other/fork' } } },
    ],
  });
  const calls = setup(() => http(200, { total_count: 40, workflow_runs: [apiRun(901), fork] }, { Etag: 'W/"runs1"' }));
  const result = await actions.runs(DIR, { query: 'is:failure branch:feature/x flaky', page: 2 });
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.com', '-i', 'repos/acme/widgets/actions/runs?per_page=25&page=2&status=failure&branch=feature%2Fx']);
  assert.deepEqual([result.total, result.page, result.text, result.runs.length], [40, 2, 'flaky', 2]);
  const [first, second] = result.runs;
  assert.deepEqual([first.id, first.number, first.title, first.workflow, first.sha, first.actor, first.commit.message, first.fromFork],
    [901, 901, 'Fix the widget', 'CI', SHA, 'dev-one', 'Fix the widget', false]);
  // Only the repository's own pull requests count; a fork's run says so.
  assert.deepEqual(second.pullRequests, [{ number: 7, head: 'feature', base: 'main' }]);
  assert.equal(second.fromFork, true);
});

test('the same page asked again sends its ETag, and a 304 gives the answer kept, at no cost', async () => {
  const calls = setup((args, opts, n) => (n === 1
    ? http(200, { total_count: 1, workflow_runs: [apiRun(901)] }, { Etag: 'W/"runs1"' })
    : http(304, '', { Etag: '"runs1"', 'X-Ratelimit-Remaining': '4990' })));
  const first = await actions.runs(DIR, {});
  const second = await actions.runs(DIR, {});
  assert.equal(calls[1].args.includes('If-None-Match: W/"runs1"'), true);
  assert.deepEqual([first.fresh, second.fresh], [true, false]);
  assert.deepEqual(second.runs.map(r => r.id), [901]);
});

test('workflow: in the search names a workflow by name or file; one that does not exist lists nothing', async () => {
  const workflowsAnswer = http(200, { total_count: 1, workflows: [{ id: 11, name: 'Deploy site', path: '.github/workflows/deploy.yml', state: 'active' }] });
  let calls = setup(args => (path(args).includes('/actions/workflows?') ? workflowsAnswer : http(200, { total_count: 0, workflow_runs: [] })));
  await actions.runs(DIR, { query: 'workflow:"deploy site"' });
  assert.equal(path(calls[1].args), 'repos/acme/widgets/actions/workflows/11/runs?per_page=25&page=1');
  calls = setup(args => (path(args).includes('/actions/workflows?') ? workflowsAnswer : http(200, { total_count: 0, workflow_runs: [] })));
  await actions.runs(DIR, { query: 'workflow:deploy.yml' });
  assert.equal(path(calls[1].args), 'repos/acme/widgets/actions/workflows/11/runs?per_page=25&page=1');
  calls = setup(() => workflowsAnswer);
  const none = await actions.runs(DIR, { query: 'workflow:nothing' });
  assert.deepEqual([none.ok, none.total, calls.length], [true, 0, 1]);
  assert.match(none.notice, /No workflow is named "nothing"/);
  // A workflow chosen in the sidebar goes in the path, by id or file name.
  calls = setup(() => http(200, { total_count: 0, workflow_runs: [] }));
  await actions.runs(DIR, { workflowId: 'ci.yml' });
  assert.equal(path(calls[0].args), 'repos/acme/widgets/actions/workflows/ci.yml/runs?per_page=25&page=1');
});

test('what is not a page, a search or a workflow never reaches gh', async () => {
  const calls = setup(() => http(200, { total_count: 0, workflow_runs: [] }));
  for (const opts of [{ page: 0 }, { page: 1.5 }, { page: true }, { perPage: 101 }, { query: 'is:broken' }, { query: 'x'.repeat(201) },
    { workflowId: '../secrets' }, { workflowId: 'ci.yml --method DELETE' }, { query: 'branch:-x' }]) {
    const result = await actions.runs(DIR, opts);
    assert.equal(result.code, 'bad-request', JSON.stringify(opts));
  }
  assert.equal(calls.length, 0);
});

test('GitHub\'s hourly limit used up says when it answers again', async () => {
  setup(() => http(403, { message: 'API rate limit exceeded' }, { 'X-Ratelimit-Remaining': '0', 'X-Ratelimit-Reset': '1800000000' }));
  const result = await actions.runs(DIR, {});
  assert.equal(result.code, 'rate-limited');
  assert.equal(result.resetAt, 1800000000000);
  assert.match(result.error, /limit of requests for this hour is used up/);
});

test('a repository GitHub does not know is worded for Actions, not for pull requests', async () => {
  setup(() => ({ ...http(404, { message: 'Not Found' }), stderr: 'gh: Not Found (HTTP 404)' }));
  const result = await actions.runs(DIR, {});
  assert.deepEqual([result.code, result.error], ['not-found', 'GitHub does not know this repository, or your account cannot see it.']);
});

// --- One run ---

const WORKFLOW_YAML = `name: CI
on:
  push:
  workflow_dispatch:
    inputs:
      target: { type: choice, options: [staging, production] }
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: \${{ matrix.os }}
  test:
    needs: build
  deploy:
    needs: [test]
    environment: production
`;

test('a run comes with its jobs, artifacts, annotations and the jobs of its workflow file at the run\'s commit', async () => {
  const calls = setup((args) => {
    if (isGraphql(args)) {
      return graphql({ node: { checkRuns: { pageInfo: { hasNextPage: false }, nodes: [
        { databaseId: 31, annotations: { totalCount: 1, nodes: [{ path: 'src/widget.js', title: 'Lint', message: 'Unused variable', rawDetails: '', annotationLevel: 'WARNING', location: { start: { line: 4, column: 2 }, end: { line: 4, column: 9 } } }] } },
        { databaseId: 99, annotations: { totalCount: 1, nodes: [{ path: 'x', message: 'from another attempt', annotationLevel: 'FAILURE', location: { start: { line: 1 }, end: { line: 1 } } }] } },
      ] } } });
    }
    const p = path(args);
    if (p.includes('/contents/')) return http(200, WORKFLOW_YAML);
    if (p.includes('/jobs')) return http(200, { total_count: 3, jobs: [apiJob(31, 'build (ubuntu-latest)'), apiJob(32, 'build (macos-latest)'), apiJob(33, 'test', { status: 'in_progress', conclusion: null, completed_at: null })] });
    if (p.includes('/artifacts')) return http(200, { total_count: 2, artifacts: [
      { id: 71, name: 'coverage', size_in_bytes: 2048, digest: 'sha256:abc', expired: false, created_at: '2026-01-01T10:02:00Z', expires_at: '2026-04-01T10:02:00Z' },
      { id: 72, name: 'old', size_in_bytes: 1, expired: true },
    ] });
    return http(200, apiRun(900, { status: 'in_progress', conclusion: null }));
  });
  const result = await actions.run(DIR, { runId: 900 });
  assert.equal(result.ok, true);
  assert.deepEqual([result.run.id, result.attempt, result.attempts], [900, 1, 1]);
  assert.deepEqual(result.jobs.map(j => [j.id, j.name, j.status, j.steps.length]), [[31, 'build (ubuntu-latest)', 'completed', 1], [32, 'build (macos-latest)', 'completed', 1], [33, 'test', 'in_progress', 1]]);
  assert.deepEqual(result.artifacts.map(a => [a.id, a.name, a.size, a.digest]), [[71, 'coverage', 2048, 'sha256:abc']]);
  assert.deepEqual(Object.keys(result.annotations), ['31']);
  assert.deepEqual(result.annotations[31].items[0], { path: 'src/widget.js', startLine: 4, endLine: 4, startColumn: 2, endColumn: 9, level: 'warning', title: 'Lint', message: 'Unused variable', details: '', url: '' });
  assert.deepEqual(result.workflow.jobs.map(j => [j.key, j.needs, j.matrix, j.environment]), [['build', [], true, ''], ['test', ['build'], false, ''], ['deploy', ['test'], false, 'production']]);
  const paths = calls.filter(c => !isGraphql(c.args)).map(c => path(c.args));
  assert.ok(paths.includes('repos/acme/widgets/actions/runs/900'));
  assert.ok(paths.includes('repos/acme/widgets/actions/runs/900/jobs?filter=latest&per_page=100&page=1'));
  assert.ok(paths.includes(`repos/acme/widgets/contents/.github/workflows/ci.yml?ref=${SHA}`));
  const contents = calls.find(c => path(c.args) && path(c.args).includes('/contents/'));
  assert.ok(contents.args.includes('Accept: application/vnd.github.raw'));
  assert.equal(calls.find(c => isGraphql(c.args)).args.includes('graphql'), true);
  // Waiting for nothing and not queued: no deployments or concurrency read.
  assert.equal(paths.some(p => /pending_deployments|approvals|concurrency/.test(p)), false);
});

test('an attempt reads that attempt and its jobs, and a run waiting for a review reads what waits', async () => {
  const calls = setup((args) => {
    const p = path(args);
    if (p.endsWith('/pending_deployments')) return http(200, [{ environment: { id: 5, name: 'production', html_url: 'https://github.com/acme/widgets/deployments/production' }, wait_timer: 30, wait_timer_started_at: '2026-01-01T10:05:00Z', current_user_can_approve: true, reviewers: [{ type: 'User', reviewer: { login: 'dev-two' } }, { type: 'Team', reviewer: { slug: 'ops', name: 'Ops' } }] }]);
    if (p.endsWith('/approvals')) return http(200, [{ state: 'approved', user: { login: 'dev-two' }, comment: 'Go', environments: [{ name: 'staging' }] }]);
    if (p.includes('/jobs')) return http(200, { total_count: 0, jobs: [] });
    if (p.includes('/artifacts')) return http(200, { total_count: 0, artifacts: [] });
    if (p.includes('/contents/')) return http(200, WORKFLOW_YAML);
    if (p.endsWith('/attempts/2')) return http(200, apiRun(900, { run_attempt: 2, status: 'waiting', conclusion: null }));
    return http(200, apiRun(900, { run_attempt: 3, status: 'completed' }));
  });
  const result = await actions.run(DIR, { runId: 900, attempt: 2 });
  assert.deepEqual([result.attempt, result.attempts], [2, 3]);
  assert.deepEqual(result.pendingDeployments, [{ environment: { id: 5, name: 'production', url: 'https://github.com/acme/widgets/deployments/production' }, waitTimer: 30, waitTimerStartedAt: '2026-01-01T10:05:00Z', canApprove: true, reviewers: [{ type: 'User', name: 'dev-two' }, { type: 'Team', name: 'ops' }] }]);
  assert.deepEqual(result.approvals, [{ state: 'approved', user: 'dev-two', comment: 'Go', environments: ['staging'] }]);
  const paths = calls.map(c => path(c.args));
  assert.ok(paths.includes('repos/acme/widgets/actions/runs/900/attempts/2/jobs?per_page=100&page=1'));
  for (const bad of [0, 101, 'x', 1.5]) assert.equal((await actions.run(DIR, { runId: 900, attempt: bad })).code, 'bad-request');
  for (const bad of [0, -1, 'abc', '1 2', true, null]) assert.equal((await actions.run(DIR, { runId: bad })).code, 'bad-request');
});

test('a dynamic workflow (no file) reads no file, and a queued run reads its concurrency group', async () => {
  const calls = setup((args) => {
    const p = path(args);
    if (p.includes('/concurrency_groups')) return http(200, { total_count: 1, concurrency_groups: [{ group_name: 'deploy-main', group_members: [{ run_id: 899, status: 'in_progress', position: 0 }, { run_id: 900, status: 'pending', position: 1 }] }] });
    if (p.includes('/jobs')) return http(200, { total_count: 0, jobs: [] });
    if (p.includes('/artifacts')) return http(200, { total_count: 0, artifacts: [] });
    return http(200, apiRun(900, { status: 'pending', conclusion: null, path: 'dynamic/copilot-swe-agent/copilot' }));
  });
  const result = await actions.run(DIR, { runId: 900 });
  assert.equal(result.workflow.dynamic, true);
  assert.deepEqual(result.concurrency, [{ name: 'deploy-main', members: [{ runId: 899, jobId: null, status: 'in_progress', position: 0 }, { runId: 900, jobId: null, status: 'pending', position: 1 }] }]);
  assert.equal(calls.some(c => path(c.args) && path(c.args).includes('/contents/')), false);
});

test('a run that is a 404 for a moment, as one just started can be, is read again before "Not found"', async () => {
  const saved = { ...actions.RUN_RETRY };
  actions.RUN_RETRY.delayMs = 1;
  try {
    const missing = { ...http(404, { message: 'Not Found' }), stderr: 'gh: Not Found (HTTP 404)' };
    let reads = 0;
    setup((args) => {
      const p = path(args);
      if (p.includes('/jobs')) return http(200, { total_count: 0, jobs: [] });
      if (p.includes('/artifacts')) return http(200, { total_count: 0, artifacts: [] });
      if (p.includes('/concurrency_groups')) return http(200, { total_count: 0, concurrency_groups: [] });
      if (p.includes('/contents/')) return missing;
      reads += 1;
      return reads === 1 ? missing : http(200, apiRun(901, { status: 'queued', conclusion: null }));
    });
    const result = await actions.run(DIR, { runId: 901 });
    assert.deepEqual([result.ok, result.run.id, reads], [true, 901, 2]);
    // Gone for good: "Not found" after the tries.
    actions.resetCaches();
    const calls = setup(() => missing);
    const gone = await actions.run(DIR, { runId: 902 });
    assert.equal(gone.code, 'not-found');
    assert.equal(calls.filter(c => /actions\/runs\/902$/.test(path(c.args) || '')).length, actions.RUN_RETRY.tries);
  } finally {
    Object.assign(actions.RUN_RETRY, saved);
  }
});

// --- Jobs and logs ---

test('a job comes with its steps and annotations', async () => {
  setup(args => (path(args).includes('/annotations')
    ? http(200, [{ path: 'src/a.js', start_line: 3, end_line: 3, annotation_level: 'failure', title: 'Test failed', message: 'expected 1', raw_details: 'stack', blob_href: 'https://github.com/acme/widgets/blob/x/src/a.js' }])
    : http(200, apiJob(31, 'test'))));
  const result = await actions.job(DIR, { jobId: 31 });
  assert.deepEqual([result.job.id, result.job.runnerName, result.job.labels, result.job.steps[0].name], [31, 'GitHub Actions 7', ['ubuntu-latest'], 'Set up job']);
  assert.deepEqual(result.annotations, [{ path: 'src/a.js', startLine: 3, endLine: 3, startColumn: null, endColumn: null, level: 'failure', title: 'Test failed', message: 'expected 1', details: 'stack', url: 'https://github.com/acme/widgets/blob/x/src/a.js' }]);
});

test('a finished step\'s log keeps its timestamps and is kept; one still running says so', async () => {
  let calls = setup(() => ({ code: 0, stderr: '', stdout: '﻿2026-01-01T10:00:01.1234567Z ##[group]Run npm test\r\n2026-01-01T10:00:02.0000000Z \x1b[32mok\x1b[0m\n' }));
  const first = await actions.stepLog(DIR, { jobId: 31, step: 3 });
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.com', 'repos/acme/widgets/actions/jobs/31/steps/3/logs']);
  assert.equal(first.text, '2026-01-01T10:00:01.1234567Z ##[group]Run npm test\n2026-01-01T10:00:02.0000000Z ok\n');
  const again = await actions.stepLog(DIR, { jobId: 31, step: 3 });
  assert.deepEqual([again.text, calls.length], [first.text, 1]);
  calls = setup(() => ({ code: 1, stderr: 'gh: Not Found (HTTP 404)', stdout: '' }));
  const pending = await actions.stepLog(DIR, { jobId: 31, step: 4 });
  assert.deepEqual([pending.code, pending.pending], ['not-found', true]);
  for (const bad of [{ jobId: 31, step: 0 }, { jobId: 31, step: 1001 }, { jobId: 'x', step: 1 }, { jobId: 31 }]) {
    assert.equal((await actions.stepLog(DIR, bad)).code, 'bad-request', JSON.stringify(bad));
  }
  assert.equal(calls.length, 1);
});

test('a whole job\'s log keeps its timestamps for the Actions view', async () => {
  setup(() => ({ code: 0, stderr: '', stdout: '2026-01-01T10:00:01.0000000Z hello\n' }));
  assert.equal((await actions.jobLog(DIR, { jobId: 31 })).text, '2026-01-01T10:00:01.0000000Z hello\n');
});

// --- Workflow files ---

test('a workflow file gives its events, the "Run workflow" fields, its schedule and its jobs', () => {
  const parsed = actions.parseWorkflow(`
name: Nightly
run-name: Nightly for \${{ github.actor }}
on:
  schedule:
    - cron: '0 3 * * *'
      timezone: Europe/Rome
  workflow_dispatch:
    inputs:
      dry: { type: boolean, default: true }
defaults: &defaults
  runs-on: ubuntu-latest
jobs:
  build:
    <<: *defaults
    name: Build it
  release:
    uses: ./.github/workflows/release.yml
    needs: build
`);
  assert.deepEqual([parsed.name, parsed.events, parsed.schedule], ['Nightly', ['schedule', 'workflow_dispatch'], [{ cron: '0 3 * * *', timezone: 'Europe/Rome' }]]);
  assert.deepEqual(parsed.dispatch.map(f => [f.name, f.type, f.default]), [['dry', 'boolean', 'true']]);
  assert.deepEqual(parsed.jobs.map(j => [j.key, j.name, j.needs, j.uses]), [['build', 'Build it', [], null], ['release', 'release', ['build'], './.github/workflows/release.yml']]);
  assert.deepEqual(actions.parseWorkflow('on: push\njobs: {}').events, ['push']);
  assert.deepEqual(actions.parseWorkflow('on: [push, pull_request]\njobs: {}').events, ['push', 'pull_request']);
  assert.equal(actions.parseWorkflow('on: push').dispatch, null);
  assert.deepEqual(actions.parseWorkflow('on:\n  workflow_dispatch:\njobs: {}').dispatch, []);
  assert.match(actions.parseWorkflow('jobs: [').error, /not valid YAML/);
  assert.match(actions.parseWorkflow('just text').error, /no workflow/);
});

test('"Run workflow" reads the file at the chosen ref, and offers environments for an environment input', async () => {
  const calls = setup((args) => {
    if (isGraphql(args)) return graphql({ repository: REPO });
    const p = path(args);
    if (p.includes('/environments')) return http(200, { total_count: 2, environments: [{ name: 'staging' }, { name: 'production' }] });
    if (p.includes('/contents/')) return http(200, 'on:\n  workflow_dispatch:\n    inputs:\n      where: { type: environment, required: true }\njobs: {}\n');
    return http(200, { id: 11, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' });
  });
  const form = await actions.dispatchForm(DIR, { workflowId: 11, ref: 'release/1.x' });
  assert.deepEqual([form.available, form.ref, form.defaultBranch, form.canWrite], [true, 'release/1.x', 'main', true]);
  assert.deepEqual(form.fields.map(f => [f.name, f.type, f.required]), [['where', 'environment', true]]);
  assert.deepEqual(form.environments, ['staging', 'production']);
  assert.deepEqual([form.events, form.schedule], [['workflow_dispatch'], []]);
  assert.ok(calls.some(c => path(c.args) === 'repos/acme/widgets/contents/.github/workflows/deploy.yml?ref=release%2F1.x'));
  assert.equal((await actions.dispatchForm(DIR, { workflowId: 11, ref: '-x' })).code, 'bad-request');
  assert.equal((await actions.dispatchForm(DIR, { workflowId: '../../x' })).code, 'bad-request');
});

test('a workflow without workflow_dispatch, or disabled, cannot run, and says why', async () => {
  setup((args) => {
    if (isGraphql(args)) return graphql({ repository: REPO });
    if (path(args).includes('/contents/')) return http(200, 'on: push\njobs: {}\n');
    return http(200, { id: 11, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' });
  });
  const form = await actions.dispatchForm(DIR, { workflowId: 'ci.yml' });
  assert.deepEqual([form.available, form.ref], [false, 'main']);
  assert.match(form.reason, /ci\.yml at main has no workflow_dispatch trigger/);
  setup((args) => {
    if (isGraphql(args)) return graphql({ repository: REPO });
    if (path(args).includes('/contents/')) return http(200, 'on: workflow_dispatch\njobs: {}\n');
    return http(200, { id: 11, name: 'CI', path: '.github/workflows/ci.yml', state: 'disabled_manually' });
  });
  const disabled = await actions.dispatchForm(DIR, { workflowId: 'ci.yml' });
  assert.deepEqual([disabled.available, disabled.reason], [false, 'The workflow is disabled: enable it to run it.']);
});

test('a workflow file is read only from .github/workflows, at a ref git would take', async () => {
  const calls = setup(() => http(200, 'on: push\njobs:\n  a: {}\n'));
  const file = await actions.workflowFile(DIR, { path: '.github/workflows/ci.yml', ref: SHA });
  assert.deepEqual([file.ok, file.parsed.jobs.map(j => j.key)], [true, ['a']]);
  // At a commit it cannot change: read once.
  await actions.workflowFile(DIR, { path: '.github/workflows/ci.yml', ref: SHA });
  assert.equal(calls.length, 1);
  for (const bad of [{ path: '../.env', ref: 'main' }, { path: '.github/workflows/../../x.yml', ref: 'main' }, { path: '.github/workflows/ci.yml', ref: 'a..b' }]) {
    assert.equal((await actions.workflowFile(DIR, bad)).code, 'bad-request', JSON.stringify(bad));
  }
});

test('branches and tags for "Use workflow from", the default branch first', async () => {
  const calls = setup(() => graphql({ repository: { defaultBranchRef: { name: 'main' }, heads: { nodes: [{ name: 'dev' }] }, tags: { nodes: [{ name: 'v1.0.0' }] } } }));
  const result = await actions.refs(DIR, { query: '' });
  assert.deepEqual([result.branches, result.tags], [['main', 'dev'], ['v1.0.0']]);
  assert.equal(JSON.parse(calls[0].opts.input).variables.query, null);
  assert.equal((await actions.refs(DIR, { query: 'x'.repeat(201) })).code, 'bad-request');
});

// --- Management ---

test('a page of caches comes with what they take together; the sort and the branch are checked', async () => {
  const calls = setup(args => (path(args).endsWith('/cache/usage')
    ? http(200, { full_name: 'acme/widgets', active_caches_size_in_bytes: 5 * 1024 * 1024, active_caches_count: 2 })
    : http(200, { total_count: 2, actions_caches: [
      { id: 44, ref: 'refs/heads/main', key: 'npm-linux-abc', version: 'v1', last_accessed_at: '2026-01-02T10:00:00Z', created_at: '2026-01-01T10:00:00Z', size_in_bytes: 4 * 1024 * 1024 },
    ] })));
  const result = await actions.caches(DIR, { ref: 'refs/heads/main', key: 'npm-', sort: 'size_in_bytes', direction: 'asc', page: 2 });
  assert.deepEqual(result.caches, [{ id: 44, key: 'npm-linux-abc', ref: 'refs/heads/main', version: 'v1', size: 4194304, createdAt: '2026-01-01T10:00:00Z', lastAccessedAt: '2026-01-02T10:00:00Z' }]);
  assert.deepEqual(result.usage, { count: 2, size: 5242880 });
  assert.ok(calls.some(c => path(c.args) === 'repos/acme/widgets/actions/caches?per_page=30&page=2&sort=size_in_bytes&direction=asc&ref=refs%2Fheads%2Fmain&key=npm-'));
  for (const bad of [{ sort: 'name' }, { direction: 'up' }, { ref: 'main' }, { key: 'a\nb' }, { page: 0 }]) {
    assert.equal((await actions.caches(DIR, bad)).code, 'bad-request', JSON.stringify(bad));
  }
});

test('the self-hosted runners are read only for an admin, each Idle, Active or Offline', async () => {
  let calls = setup(() => graphql({ repository: REPO }));
  const notAdmin = await actions.runners(DIR, {});
  assert.deepEqual([notAdmin.ok, notAdmin.admin, notAdmin.runners, calls.length], [true, false, [], 1]);
  calls = setup(args => (isGraphql(args) ? graphql({ repository: { ...REPO, viewerPermission: 'ADMIN' } }) : http(200, { total_count: 3, runners: [
    { id: 1, name: 'mac-mini', os: 'macOS', status: 'online', busy: false, labels: [{ name: 'self-hosted', type: 'read-only' }, { name: 'gpu', type: 'custom' }] },
    { id: 2, name: 'linux-box', os: 'Linux', status: 'online', busy: true, labels: [] },
    { id: 3, name: 'old', os: 'Linux', status: 'offline', busy: false, labels: [] },
  ] })));
  const admin = await actions.runners(DIR, {});
  assert.deepEqual(admin.runners.map(r => [r.name, r.status]), [['mac-mini', 'idle'], ['linux-box', 'active'], ['old', 'offline']]);
  assert.deepEqual(admin.runners[0].labels, [{ name: 'self-hosted', custom: false }, { name: 'gpu', custom: true }]);
});

test('deployments: the environments with their active deployment, and a log on Actions opens in the app', async () => {
  const calls = setup(() => graphql({ repository: {
    environments: { totalCount: 2, nodes: [{ databaseId: 5, name: 'production' }, { databaseId: 6, name: 'staging' }] },
    deployments: { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'c2' }, nodes: [
      { databaseId: 81, environment: 'production', state: 'ACTIVE', task: 'deploy', commitOid: 'abc', createdAt: '2026-01-02T10:00:00Z', ref: { name: 'main' }, creator: { login: 'dev-one' },
        latestStatus: { state: 'SUCCESS', logUrl: 'https://github.com/acme/widgets/actions/runs/900/job/31', environmentUrl: 'https://widgets.example' } },
      { databaseId: 80, environment: 'production', state: 'INACTIVE', ref: null, creator: null, latestStatus: null },
    ] },
  } }));
  const result = await actions.deployments(DIR, { environment: 'production' });
  assert.deepEqual(JSON.parse(calls[0].opts.input).variables, { owner: 'acme', repo: 'widgets', envs: ['production'], after: null });
  assert.deepEqual(result.environments.map(e => [e.name, e.active && e.active.id]), [['production', 81], ['staging', null]]);
  assert.deepEqual(result.deployments[0].actions, { owner: 'acme', repo: 'widgets', runId: 900, attempt: null, jobId: 31 });
  assert.deepEqual([result.deployments[0].state, result.deployments[0].status, result.deployments[1].ref], ['active', 'success', '']);
  assert.deepEqual([result.hasNextPage, result.endCursor], [true, 'c2']);
  assert.equal((await actions.deployments(DIR, { environment: '' })).code, 'bad-request');
});
