// The Actions view (public/project-actions-view.js, actions-run-view.js,
// actions-manage-view.js): the pure parts, loaded in a vm context after the
// files they build on, as index.html loads them. Without a document nothing is
// painted; the HTML each part draws, and what it offers to whom, is checked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const SOURCES = ['project-git-view.js', 'project-pull-requests-view.js', 'actions-model.js', 'project-actions-view.js', 'actions-run-view.js', 'actions-manage-view.js'].map(read);

function loadContext() {
  const icon = name => () => `<svg data-icon="${name}"></svg>`;
  const context = vm.createContext({
    window: { api: {} },
    escapeHtml: str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    pathBasename: p => String(p).split(/[\\/]/).filter(Boolean).pop() || '',
    PICONS: new Proxy({}, { get: (_t, name) => icon(name) }),
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  for (const source of SOURCES) vm.runInContext(source, context);
  return context;
}

const ctx = loadContext();
const NOW = new Date('2026-01-10T12:00:00Z');
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';

function run(extra = {}) {
  return {
    id: 900, number: 42, attempt: 1, title: 'Fix the widget', workflowId: 11, workflow: 'CI', path: '.github/workflows/ci.yml',
    event: 'push', status: 'completed', conclusion: 'success', branch: 'main', sha: SHA, actor: 'dev-one', triggeringActor: 'dev-one',
    headRepository: 'acme/widgets', fromFork: false, pullRequests: [], createdAt: '2026-01-10T11:00:00Z', startedAt: '2026-01-10T11:00:00Z',
    updatedAt: '2026-01-10T11:03:08Z', url: 'https://github.com/acme/widgets/actions/runs/900', ...extra,
  };
}

function job(id, name, extra = {}) {
  return { id, name, status: 'completed', conclusion: 'success', startedAt: '2026-01-10T11:00:00Z', completedAt: '2026-01-10T11:01:00Z', url: `https://github.com/acme/widgets/actions/runs/900/job/${id}`, labels: [], steps: [], ...extra };
}

function repoData(extra = {}) {
  const data = ctx.actRepoData(null);
  data.repo = { nameWithOwner: 'acme/widgets', host: 'github.com', owner: 'acme', repo: 'widgets', canWrite: true, isAdmin: false, defaultBranch: 'main' };
  return Object.assign(data, extra);
}

// --- The runs ---

test('a run\'s row says its state, its title and what started it, as GitHub\'s list does', () => {
  const html = ctx.actRunRowHtml(run({ conclusion: 'failure' }), { now: NOW });
  assert.match(html, /act-state--failure/);
  assert.match(html, /aria-label="failed: Fix the widget"/);
  assert.match(html, /CI #42: Commit abcdef1 pushed by dev-one/);
  assert.match(html, /<span class="act-branch" title="main">main<\/span>/);
  assert.match(html, /3m 8s/);
  assert.match(html, /data-act="run-menu" data-id="900"/);
  // A fork's branch carries its owner, and a running run says so instead of a duration.
  const fork = ctx.actRunRowHtml(run({ fromFork: true, headRepository: 'someone/widgets', branch: 'feature', status: 'in_progress', conclusion: null }), { now: NOW });
  assert.match(fork, />someone:feature</);
  assert.match(fork, /act-state--running/);
  assert.match(ctx.actRunRowHtml(run({ status: 'queued', conclusion: null }), { now: NOW }), />Queued</);
  // Titles are text, never markup.
  assert.match(ctx.actRunRowHtml(run({ title: '<img src=x>' }), { now: NOW }), /&lt;img src=x&gt;/);
});

test('a run\'s "…" offers only what the account may do', () => {
  const keys = (r, canWrite) => JSON.parse(JSON.stringify(ctx.actRunMenuItems(r, { canWrite }))).map(i => i.key || '—');
  assert.deepEqual(keys(run(), false), ['view-file', '—', 'web', 'browser']);
  assert.deepEqual(keys(run(), true), ['view-file', 'rerun', '—', 'web', 'browser', '—', 'delete']);
  assert.deepEqual(keys(run({ conclusion: 'failure' }), true), ['view-file', 'rerun', 'rerun-failed', '—', 'web', 'browser', '—', 'delete']);
  assert.deepEqual(keys(run({ status: 'in_progress', conclusion: null }), true), ['view-file', 'cancel', '—', 'web', 'browser']);
  assert.ok(keys(run({ conclusion: 'action_required' }), true).includes('approve'));
});

test('the count over the list is GitHub\'s, capped at 2,500+, and says when the free words filter a page', () => {
  const data = repoData();
  assert.equal(ctx.actCountText(data, { data: { total: 31000, runs: [] } }), '2,500+ workflow runs');
  assert.equal(ctx.actCountText(data, { data: { total: 1, runs: [] } }), '1 workflow run');
  data.query = 'is:failure';
  assert.equal(ctx.actCountText(data, { data: { total: 4, runs: [] } }), '4 workflow run results');
  data.query = 'widget';
  assert.equal(ctx.actCountText(data, { data: { total: 40, runs: [run(), run({ id: 901, title: 'Other' })] } }), '1 of this page\'s 2 runs match "widget"');
});

test('the list says when nothing matched, and pages like GitHub', () => {
  const data = repoData({ query: 'is:failure' });
  assert.match(ctx.actRunsListHtml(data, { data: { total: 0, runs: [] } }), /No results matched your search\./);
  assert.match(ctx.actRunsListHtml(data, { data: { total: 0, runs: [] } }), /Clear filter/);
  data.query = '';
  data.pageNo = 2;
  const html = ctx.actRunsListHtml(data, { data: { total: 60, runs: [run()] } }, NOW);
  assert.match(html, /Page 2 of 3/);
  assert.doesNotMatch(html, /data-act="page-prev" disabled/);
  assert.match(ctx.actRunsListHtml(data, { loading: true }), /Reading workflow runs/);
  assert.match(ctx.actRunsListHtml(data, { error: 'Nope', errorCode: 'gh-auth' }), /Sign in to GitHub/);
});

test('the sidebar lists the workflows, the disabled ones marked, and Management', () => {
  const workflows = [
    { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', dynamic: false },
    { id: 2, name: 'Nightly', path: '.github/workflows/nightly.yml', state: 'disabled_inactivity', dynamic: false },
  ];
  const data = repoData();
  data.workflows.data = { workflows, lockfile: false };
  data.page = { kind: 'runs', workflowId: 1 };
  const html = ctx.actSideHtml(data);
  assert.match(html, /data-act="nav-workflow" data-id="1"[^>]*>.*CI/);
  assert.match(html, /class="act-nav-item is-on" data-act="nav-workflow" data-id="1"/);
  assert.match(html, /Nightly<\/span><span class="act-nav-tag">Disabled<\/span>/);
  for (const label of ['Caches', 'Deployments', 'Runners', 'Attestations', 'Usage metrics', 'Performance metrics']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /Lockfile/);
  data.workflows.data.lockfile = true;
  assert.match(ctx.actSideHtml(data), /Lockfile/);
  data.workflows.data.workflows = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `W${i}`, path: '', state: 'active' }));
  assert.match(ctx.actSideHtml(data), /Show more workflows/);
  assert.doesNotMatch(ctx.actSideHtml(data, { showAll: true }), /Show more workflows/);
});

test('a workflow\'s page offers Run workflow and Enable only to those who may, and says why it is off', () => {
  const workflow = { id: 11, name: 'Deploy', file: 'deploy.yml', path: '.github/workflows/deploy.yml', state: 'active', dynamic: false };
  const form = { data: { available: true, schedule: [{ cron: '0 3 * * *', timezone: 'Europe/Rome' }] } };
  const writer = ctx.actWorkflowHeadHtml(repoData(), workflow, form);
  assert.match(writer, /workflow_dispatch<\/code> event trigger/);
  assert.match(writer, /data-act="dispatch"/);
  assert.match(writer, /<code>0 3 \* \* \*<\/code> \(Europe\/Rome\)/);
  const reader = ctx.actWorkflowHeadHtml(repoData({ repo: { canWrite: false } }), workflow, form);
  assert.doesNotMatch(reader, /data-act="dispatch"|workflow_dispatch/);
  const off = ctx.actWorkflowHeadHtml(repoData(), { ...workflow, state: 'disabled_inactivity' }, null);
  assert.match(off, /at least 60 days/);
  assert.match(off, /data-act="enable"/);
  assert.doesNotMatch(ctx.actWorkflowHeadHtml(repoData({ repo: { canWrite: false } }), { ...workflow, state: 'disabled_manually' }, null), /data-act="enable"/);
});

test('each "Run workflow" field is drawn for its type, with its default', () => {
  const field = (extra) => ({ name: 'target', type: 'string', description: '', required: false, default: '', options: [], ...extra });
  assert.match(ctx.actDispatchFieldHtml(field({ type: 'boolean', default: 'true' })), /type="checkbox"[^>]*data-input="target" checked/);
  const choice = ctx.actDispatchFieldHtml(field({ type: 'choice', options: ['staging', 'production'], default: 'production' }));
  assert.match(choice, /<option value="production" selected>/);
  assert.match(ctx.actDispatchFieldHtml(field({ type: 'environment' }), ['staging']), /<select[^>]*><option value=""><\/option><option value="staging">/);
  assert.match(ctx.actDispatchFieldHtml(field({ type: 'number', default: '3' })), /type="number"[^>]*value="3"/);
  assert.match(ctx.actDispatchFieldHtml(field({ required: true, description: 'Where to deploy' })), /Where to deploy <span class="act-required"/);
  assert.match(ctx.actDispatchFieldHtml(field({ default: '"><script>' })), /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(ctx.actDispatchFieldsHtml({ available: false, reason: 'No trigger here.' }), /No trigger here\./);
  assert.match(ctx.actDispatchFieldsHtml({ available: true, fields: [] }), /takes no inputs/);
});

test('the view reads again every 30 s on a list, every 5 s on a running run, never on a finished one or past the budget', () => {
  const data = repoData();
  assert.equal(ctx.actPollDelay(data), 30_000);
  assert.equal(ctx.actPollDelay(data, { focused: false }), 60_000);
  data.page = { kind: 'run', runId: 900, attempt: null };
  data.run.set(ctx.actRunKey(900, null), { data: { run: run({ status: 'in_progress', conclusion: null }) } });
  assert.equal(ctx.actPollDelay(data), 5_000);
  data.run.set(ctx.actRunKey(900, null), { data: { run: run() } });
  assert.equal(ctx.actPollDelay(data), null);
  data.page = { kind: 'runs', workflowId: null };
  data.rate = { remaining: 150, limit: 5000 };
  assert.equal(ctx.actPollDelay(data), null);
});

// --- A run ---

const AM = () => ctx.window.ActionsModel;

test('the graph draws a matrix as a group, its jobs on demand, and jobs not started as waiting', () => {
  const yamlJobs = [{ key: 'build', needs: [], matrix: true }, { key: 'deploy', needs: ['build'] }];
  const jobs = [job(1, 'build (linux)'), job(2, 'build (mac)', { status: 'in_progress', conclusion: null, completedAt: null })];
  const graph = AM().graphLayout(yamlJobs, jobs, NOW.getTime());
  const closed = ctx.actGraphHtml(graph, { open: new Set(), zoom: 1 });
  assert.match(closed, /Matrix: build/);
  assert.match(closed, /1 of 2 jobs completed/);
  assert.match(closed, /Show all jobs/);
  assert.match(closed, /act-node act-node--idle" data-node="deploy"/);
  assert.match(closed, /style="zoom: 1"/);
  const open = ctx.actGraphHtml(graph, { open: new Set(['build']), zoom: 0.8 });
  assert.match(open, /data-act="open-job" data-id="2"/);
  assert.match(open, /Show less/);
  assert.equal(ctx.actGraphHtml({ columns: [], edges: [], nodes: [] }), '');
});

test('annotations are counted by level and grouped by job; GitHub\'s own notices on .github have no file', () => {
  const jobs = [job(1, 'lint'), job(2, 'test')];
  const html = ctx.actAnnotationsHtml({
    1: { items: [{ level: 'failure', title: 'ESLint', message: 'no-unused-vars', path: 'src/a.js', startLine: 4 }], total: 1 },
    2: { items: [{ level: 'notice', message: 'Ubuntu moves', path: '.github', startLine: 1 }, { level: 'notice', message: 'two', path: '' }], total: 5 },
  }, jobs, { sha: SHA });
  assert.match(html, /1 error and 2 notices/);
  assert.match(html, /data-act="open-annotation" data-path="src\/a.js" data-line="4"/);
  assert.match(html, /src\/a\.js#L4/);
  assert.doesNotMatch(html, /data-path="\.github"/);
  assert.match(html, /3 more annotations on GitHub/);
  assert.equal(ctx.actAnnotationsHtml({}, jobs), '');
});

test('artifacts: delete only for those who may write; their digest shortened', () => {
  const artifacts = [{ id: 7, name: 'coverage', size: 2048, digest: 'sha256:0123456789abcdef0123456789', expiresAt: '2026-04-01T00:00:00Z' }];
  const writer = ctx.actArtifactsHtml(artifacts, { canWrite: true, now: NOW });
  assert.match(writer, /data-act="artifact-download" data-name="coverage"/);
  assert.match(writer, /data-act="artifact-delete" data-id="7"/);
  assert.match(writer, /2 KB/);
  assert.match(writer, /sha256:0123456789ab…/);
  assert.doesNotMatch(ctx.actArtifactsHtml(artifacts, { canWrite: false, now: NOW }), /artifact-delete/);
  assert.equal(ctx.actArtifactsHtml([]), '');
});

test('what a run waits for: a fork\'s approval, a review of its deployments, its place in a concurrency group', () => {
  const answer = {
    run: run({ status: 'waiting', conclusion: null }),
    pendingDeployments: [{ environment: { id: 5, name: 'production' }, waitTimer: 0, canApprove: true, reviewers: [{ type: 'User', name: 'dev-two' }] }],
    approvals: [{ state: 'approved', user: 'dev-two', comment: 'Go', environments: ['staging'] }],
    concurrency: [{ name: 'deploy', members: [{ runId: 899, position: 0 }, { runId: 900, position: 1 }] }],
  };
  const html = ctx.actRunWaitsHtml(answer, { canWrite: true, now: NOW });
  assert.match(html, /production needs approval to start deploying changes/);
  assert.match(html, /data-act="review-deployments"/);
  assert.match(html, /reviewers: dev-two/);
  assert.match(html, /<strong>dev-two<\/strong> approved staging: Go/);
  assert.match(html, /concurrency group <code>deploy<\/code> \(position 2 of 2\)/);
  answer.pendingDeployments[0].canApprove = false;
  assert.match(ctx.actRunWaitsHtml(answer, { now: NOW }), /You are not one of their reviewers/);
  const fork = ctx.actRunWaitsHtml({ run: run({ conclusion: 'action_required' }) }, { canWrite: true, now: NOW });
  assert.match(fork, /data-act="approve-fork"/);
  assert.doesNotMatch(ctx.actRunWaitsHtml({ run: run({ conclusion: 'action_required' }) }, { canWrite: false, now: NOW }), /data-act="approve-fork"/);
});

test('a run\'s head: attempts, Re-run jobs once it has finished, Cancel while it runs, only for those who may', () => {
  const done = ctx.actRunHeadHtml({ run: run(), attempt: 2, attempts: 3 }, { canWrite: true, now: NOW });
  assert.match(done, /Attempt #2/);
  assert.match(done, /data-act="rerun-menu"/);
  assert.doesNotMatch(done, /data-act="cancel-run"/);
  assert.match(ctx.actRunHeadHtml({ run: run(), attempt: 3, attempts: 3 }, { canWrite: true }), /Latest #3/);
  const running = ctx.actRunHeadHtml({ run: run({ status: 'in_progress', conclusion: null }), attempt: 1, attempts: 1 }, { canWrite: true });
  assert.match(running, /data-act="cancel-run"/);
  assert.doesNotMatch(running, /rerun-menu|attempt-menu/);
  assert.doesNotMatch(ctx.actRunHeadHtml({ run: run(), attempt: 1, attempts: 1 }, { canWrite: false }), /rerun-menu|cancel-run/);
});

test('Usage lists each job\'s run time and the total', () => {
  const html = ctx.actUsageHtml({ jobs: [job(1, 'a'), job(2, 'b', { startedAt: null, completedAt: null })] }, NOW);
  assert.match(html, /a<\/span><span role="cell">1m 0s/);
  assert.match(html, /b<\/span><span role="cell">–/);
  assert.match(html, /act-tfoot[^]*1m 0s/);
});

// --- A job ---

test('a log\'s groups start closed, the search opens them and marks what it finds, timestamps show on demand', () => {
  const text = '2026-01-10T11:00:01.0000000Z ##[group]Run npm test\n2026-01-10T11:00:02.0000000Z inside the group\n2026-01-10T11:00:03.0000000Z ##[endgroup]\n2026-01-10T11:00:04.0000000Z ##[error]Process completed with exit code 1.\n';
  const closed = ctx.actLogHtml(text, { stepKey: '31/3' });
  assert.match(closed, /data-act="log-group" data-step-key="31\/3" data-line="0"/);
  assert.match(closed, /▸ Run npm test/);
  assert.doesNotMatch(closed, /inside the group/);
  assert.match(closed, /act-log--error/);
  assert.doesNotMatch(closed, /act-log-time/);
  const open = ctx.actLogHtml(text, { stepKey: '31/3', open: new Set([0]), timestamps: true });
  assert.match(open, /▾ Run npm test/);
  assert.match(open, /inside the group/);
  // The time on this computer's clock, GitHub's own in the tooltip.
  const local = new Date('2026-01-10T11:00:02Z');
  const two = n => String(n).padStart(2, '0');
  assert.ok(open.includes(`<span class="act-log-time" title="2026-01-10T11:00:02.0000000Z">${two(local.getHours())}:${two(local.getMinutes())}:${two(local.getSeconds())}</span>`));
  const found = ctx.actLogHtml(text, { stepKey: '31/3', search: 'INSIDE' });
  assert.match(found, /<mark class="act-hit">inside<\/mark> the group/);
  const long = Array.from({ length: 4100 }, (_, i) => `line ${i}`).join('\n');
  const end = ctx.actLogHtml(long);
  assert.match(end, /The first 100 lines are left out/);
  assert.match(end, /line 4099/);
  assert.doesNotMatch(end, />line 99</);
});

test('a job\'s steps: the one running offers GitHub\'s live log, a finished one its log or a retry', () => {
  const data = repoData();
  const theJob = job(31, 'test', {
    status: 'in_progress', conclusion: null, completedAt: null,
    steps: [
      { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', startedAt: '2026-01-10T11:00:00Z', completedAt: '2026-01-10T11:00:02Z' },
      { number: 2, name: 'Run tests', status: 'in_progress', conclusion: null, startedAt: '2026-01-10T11:00:02Z', completedAt: null },
      { number: 3, name: 'Upload', status: 'completed', conclusion: 'failure' },
    ],
  });
  data.openSteps.set('31', new Set([1, 2, 3]));
  data.stepLogs.set('31/1', { text: 'hello\n', truncated: false });
  data.stepLogs.set('31/3', { error: 'GitHub said no' });
  const html = ctx.actStepsHtml(theJob, data, { now: NOW });
  assert.match(html, /data-step-log="31\/1"/);
  assert.match(html, /This step is running/);
  assert.match(html, /Follow live on GitHub/);
  assert.match(html, /GitHub said no <button[^>]*data-act="step-log-retry" data-step="3"/);
  assert.match(html, /aria-expanded="true"/);
});

test('a job\'s head says how it went and offers Re-run only once the run has finished, to those who may', () => {
  const done = ctx.actJobHeadHtml(job(31, 'test', { runnerName: 'GitHub Actions 7', runnerGroup: 'GitHub Actions', labels: ['ubuntu-latest'] }), run(), { canWrite: true, now: NOW });
  assert.match(done, /succeeded .* in 1m 0s/);
  assert.match(done, /data-act="rerun-job" data-id="31"/);
  assert.match(done, /Runner: GitHub Actions 7 · GitHub Actions · <span class="act-label">ubuntu-latest<\/span>/);
  assert.doesNotMatch(ctx.actJobHeadHtml(job(31, 'test'), run({ status: 'in_progress', conclusion: null }), { canWrite: true, now: NOW }), /rerun-job/);
  assert.doesNotMatch(ctx.actJobHeadHtml(job(31, 'test'), run(), { canWrite: false, now: NOW }), /rerun-job/);
});

// --- Management ---

test('caches: their total, a delete for those who may write, and an empty list in words', () => {
  const data = repoData();
  data.caches.entry.data = { caches: [{ id: 44, key: 'npm-linux-abc', ref: 'refs/heads/main', version: 'v', size: 4 * 1024 * 1024, lastAccessedAt: '2026-01-10T10:00:00Z' }], total: 1, perPage: 30, usage: { count: 1, size: 4 * 1024 * 1024 } };
  const html = ctx.actCachesHtml(data, { now: NOW });
  assert.match(html, /1 cache · 4 MB in all/);
  assert.match(html, /data-act="cache-delete" data-id="44"/);
  assert.match(html, /<span class="act-branch">main<\/span>/);
  data.repo.canWrite = false;
  assert.doesNotMatch(ctx.actCachesHtml(data, { now: NOW }), /cache-delete/);
  data.caches.entry.data = { caches: [], total: 0, usage: null };
  assert.match(ctx.actCachesHtml(data), /This repository has no caches/);
  data.caches.opts.key = 'npm';
  assert.match(ctx.actCachesHtml(data), /No caches match/);
});

test('runners: their admins see them, Idle, Active or Offline; anyone else is told why not', () => {
  const data = repoData();
  data.runners.data = { admin: false, runners: [] };
  assert.match(ctx.actRunnersHtml(data), /to its admins only/);
  assert.doesNotMatch(ctx.actRunnersHtml(data), /New self-hosted runner/);
  data.runners.data = { admin: true, runners: [
    { id: 1, name: 'mac-mini', os: 'macOS', status: 'idle', labels: [{ name: 'self-hosted', custom: false }, { name: 'gpu', custom: true }] },
    { id: 2, name: 'old', os: 'Linux', status: 'offline', labels: [] },
  ] };
  const html = ctx.actRunnersHtml(data);
  assert.match(html, /act-runner-status--idle">● Idle/);
  assert.match(html, /act-runner-status--offline">● Offline/);
  assert.match(html, /act-label act-label--custom">gpu/);
  assert.match(html, /New self-hosted runner/);
});

test('deployments: a log on GitHub Actions opens in the view, another one as a page', () => {
  const data = repoData();
  data.deployments.entry.data = {
    totalCount: 2, hasNextPage: true, endCursor: 'c2',
    environments: [{ id: 5, name: 'production', active: { id: 81, ref: 'main', sha: SHA, createdAt: '2026-01-09T00:00:00Z', creator: 'dev-one', environmentUrl: 'https://widgets.example' } }],
    deployments: [
      { id: 81, environment: 'production', state: 'active', status: 'success', ref: 'main', sha: SHA, creator: 'dev-one', createdAt: '2026-01-09T00:00:00Z', actions: { runId: 900, jobId: 31 }, logUrl: 'https://github.com/acme/widgets/actions/runs/900/job/31' },
      { id: 80, environment: 'production', state: 'inactive', status: 'inactive', ref: 'main', sha: SHA, actions: null, logUrl: 'https://ci.example/80' },
    ],
  };
  const html = ctx.actDeploymentsHtml(data, { now: NOW });
  assert.match(html, /data-act="deploy-log" data-run="900" data-job="31"/);
  assert.match(html, /data-act="link-view" data-url="https:\/\/ci.example\/80"/);
  assert.match(html, /Active deployments/);
  assert.match(html, /data-act="deploy-more"/);
  assert.equal(ctx.actDeploymentState({ state: 'active' }).bucket, 'success');
  assert.equal(ctx.actDeploymentState({ state: 'inactive', status: 'failure' }).bucket, 'failure');
});
