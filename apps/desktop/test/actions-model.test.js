// actions-model.js (packages/shared): what the Actions view shows of GitHub's
// answers. The runs and jobs have the shapes actions.js gives them, with
// made-up names.
const test = require('node:test');
const assert = require('node:assert/strict');
const AM = require('../public/actions-model');

test('a run\'s state is its conclusion once completed, else its status, with GitHub\'s words', () => {
  assert.deepEqual(AM.runState('completed', 'success'), { key: 'success', bucket: 'success', label: 'Success', a11y: 'completed successfully', verb: 'succeeded' });
  assert.equal(AM.runState('completed', 'failure').bucket, 'failure');
  assert.equal(AM.runState('completed', 'timed_out').label, 'Timed out');
  assert.equal(AM.runState('completed', 'startup_failure').a11y, 'failed at startup');
  assert.equal(AM.runState('completed', 'action_required').bucket, 'action');
  assert.equal(AM.runState('completed', 'cancelled').bucket, 'cancelled');
  assert.equal(AM.runState('in_progress', null).a11y, 'currently running');
  assert.equal(AM.runState('waiting', null).bucket, 'waiting');
  assert.equal(AM.runState('pending', null).bucket, 'queued');
  // Completed without a conclusion is still being wrapped up; something unknown is neutral or queued.
  assert.equal(AM.runState('completed', null).key, 'in_progress');
  assert.equal(AM.runState('completed', 'something_new').key, 'neutral');
  assert.equal(AM.runState('mystery', null).key, 'queued');
  assert.equal(AM.runState('success', null).key, 'queued');
  assert.equal(AM.isActive('in_progress'), true);
  assert.equal(AM.isActive('completed'), false);
});

test('a group of jobs speaks with its worst state, and is skipped only when all of them are', () => {
  const job = (status, conclusion) => ({ status, conclusion });
  assert.equal(AM.groupState([job('completed', 'success'), job('completed', 'failure'), job('in_progress')]).bucket, 'failure');
  assert.equal(AM.groupState([job('completed', 'success'), job('in_progress')]).bucket, 'running');
  assert.equal(AM.groupState([job('completed', 'success'), job('completed', 'skipped')]).bucket, 'success');
  assert.equal(AM.groupState([job('completed', 'skipped'), job('completed', 'skipped')]).bucket, 'skipped');
  assert.equal(AM.groupState([]).bucket, 'queued');
});

test('durations and sizes are written as GitHub writes them', () => {
  assert.equal(AM.formatDuration(45_000), '45s');
  assert.equal(AM.formatDuration(188_000), '3m 8s');
  assert.equal(AM.formatDuration(3_725_000), '1h 2m');
  assert.equal(AM.formatDuration(null), '');
  assert.equal(AM.durationMs('2026-01-01T10:00:00Z', '2026-01-01T10:03:08Z'), 188_000);
  assert.equal(AM.durationMs('2026-01-01T10:00:00Z', null, Date.parse('2026-01-01T10:00:30Z')), 30_000);
  assert.equal(AM.durationMs(null, '2026-01-01T10:00:00Z'), null);
  const run = { status: 'completed', startedAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:01:00Z' };
  assert.equal(AM.runDuration(run), 60_000);
  assert.equal(AM.runDuration({ ...run, status: 'in_progress' }, Date.parse('2026-01-01T10:00:10Z')), 10_000);
  // A run just ended while GitHub still shows a job going is read again, for a while.
  const ended = { status: 'completed', updatedAt: '2026-01-01T10:01:00Z' };
  const at = Date.parse('2026-01-01T10:01:30Z');
  assert.equal(AM.runStillGoing({ ...ended, status: 'in_progress' }, [], at), true);
  assert.equal(AM.runStillGoing(ended, [{ status: 'in_progress' }], at), true);
  assert.equal(AM.runStillGoing(ended, [{ status: 'completed' }], at), false);
  assert.equal(AM.runStillGoing(ended, [{ status: 'in_progress' }], at + 5 * 60_000), false);
  // Logs deleted later move the run's last change: the jobs' ends still say when it ended.
  assert.equal(AM.runDuration({ ...run, updatedAt: '2026-01-01T11:00:00Z' }, undefined, [{ completedAt: '2026-01-01T10:00:20Z' }, { completedAt: '2026-01-01T10:00:40Z' }, { completedAt: null }]), 40_000);
  assert.equal(AM.formatBytes(512), '512 B');
  assert.equal(AM.formatBytes(3 * 1024 + 400), '3.4 KB');
  assert.equal(AM.formatBytes(12.3 * 1024 * 1024), '12.3 MB');
  assert.equal(AM.formatBytes(150 * 1024 * 1024), '150 MB');
});

test('the line under a run says what started it', () => {
  const base = { actor: 'dev-one', sha: 'abcdef1234567890', branch: 'main' };
  assert.equal(AM.triggerText({ ...base, event: 'push' }), 'Commit abcdef1 pushed by dev-one');
  assert.equal(AM.triggerText({ ...base, event: 'pull_request', pullRequests: [{ number: 12 }] }), 'Pull request #12 by dev-one');
  assert.equal(AM.triggerText({ ...base, event: 'pull_request', pullRequests: [] }), 'Pull request by dev-one');
  assert.equal(AM.triggerText({ ...base, event: 'schedule' }), 'Scheduled');
  assert.equal(AM.triggerText({ ...base, event: 'workflow_dispatch', triggeringActor: 'dev-two' }), 'Manually run by dev-two');
  assert.equal(AM.triggerText({ ...base, event: 'merge_group' }), 'Merge group checks requested');
  assert.equal(AM.triggerText({ ...base, event: 'release', branch: 'v1.2.0' }), 'Release v1.2.0 by dev-one');
  assert.equal(AM.triggerText({ ...base, event: 'dynamic', actor: 'Copilot' }), 'by Copilot');
  assert.equal(AM.triggerText({ ...base, event: 'deployment_status' }), 'Deployment status by dev-one');
  assert.equal(AM.eventWords('pull_request'), 'pull request');
});

test('the search box\'s qualifiers come out of the text and go back in, in GitHub\'s order', () => {
  const parsed = AM.parseQuery('is:failure  branch:main workflow:"Deploy site" flaky  created:>=2026-11-01 foo:bar');
  assert.deepEqual(parsed, { is: 'failure', branch: 'main', workflow: 'Deploy site', created: '>=2026-11-01', text: 'flaky foo:bar' });
  assert.equal(AM.queryString(parsed), 'workflow:"Deploy site" is:failure branch:main created:>=2026-11-01 flaky foo:bar');
  assert.equal(AM.setQualifier('is:failure branch:main', 'branch', 'dev'), 'is:failure branch:dev');
  assert.equal(AM.setQualifier('is:failure branch:main', 'is', ''), 'branch:main');
  assert.equal(AM.setQualifier('', 'actor', 'dev-one'), 'actor:dev-one');
  assert.deepEqual(AM.parseQuery(''), { text: '' });
});

test('the qualifiers become the REST API\'s filters, and a value GitHub would not take is refused', () => {
  assert.deepEqual(AM.runFilters(AM.parseQuery('is:Failure event:push branch:feature/x actor:dev-one created:2026-11-01..2026-11-15 workflow:CI')), {
    params: { status: 'failure', event: 'push', branch: 'feature/x', actor: 'dev-one', created: '2026-11-01..2026-11-15' },
    workflow: 'CI',
  });
  assert.deepEqual(AM.runFilters({}), { params: {}, workflow: null });
  assert.match(AM.runFilters({ is: 'broken' }).error, /not a state/);
  assert.match(AM.runFilters({ branch: 'a b' }).error, /not a branch/);
  assert.match(AM.runFilters({ branch: '-x' }).error, /not a branch/);
  assert.match(AM.runFilters({ actor: 'not a login' }).error, /not a GitHub login/);
  assert.match(AM.runFilters({ created: 'yesterday' }).error, /not a date/);
  for (const created of ['2026-11-01', '>2026-11-01', '<=2026-11-01T10:00:00Z', '*..2026-11-01', '2026-11-01..*']) {
    assert.equal(AM.runFilters({ created }).error, undefined, created);
  }
});

test('the free words of the search look through a run\'s title, workflow, branch, actor and number', () => {
  const run = { number: 42, title: 'Fix the flaky widget test', workflow: 'CI', branch: 'main', actor: 'dev-one', sha: 'abcdef1234', event: 'push' };
  assert.equal(AM.matchesText(run, 'flaky ci'), true);
  assert.equal(AM.matchesText(run, '#42'), true);
  assert.equal(AM.matchesText(run, 'abcdef1'), true);
  assert.equal(AM.matchesText(run, 'deploy'), false);
  assert.equal(AM.matchesText(run, ''), true);
});

test('workflows: the disabled ones go last, and their state has words', () => {
  const sorted = AM.sortWorkflows([
    { name: 'lint', state: 'active' }, { name: 'Build', state: 'disabled_manually' }, { name: 'Deploy', state: 'active' },
  ]);
  assert.deepEqual(sorted.map(w => w.name), ['Deploy', 'lint', 'Build']);
  assert.equal(AM.workflowStateText('disabled_inactivity'), 'Disabled for inactivity');
  assert.equal(AM.workflowStateText('active'), '');
  assert.equal(AM.fileName('.github/workflows/ci.yml'), 'ci.yml');
});

test('a status badge has GitHub\'s address and Markdown', () => {
  const repo = { owner: 'acme', repo: 'widgets', file: 'ci.yml' };
  assert.equal(AM.badgeUrl(repo), 'https://github.com/acme/widgets/actions/workflows/ci.yml/badge.svg');
  assert.equal(AM.badgeUrl({ ...repo, branch: 'release/1.x', event: 'push' }),
    'https://github.com/acme/widgets/actions/workflows/ci.yml/badge.svg?branch=release%2F1.x&event=push');
  assert.equal(AM.badgeMarkdown({ ...repo, name: 'CI' }),
    '[![CI](https://github.com/acme/widgets/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/widgets/actions/workflows/ci.yml)');
});

test('the "Run workflow" fields follow the file\'s inputs, and their values are checked as GitHub would', () => {
  const fields = AM.dispatchFields({
    target: { description: 'Where to', type: 'choice', options: ['staging', 'production'], required: true },
    dry: { type: 'boolean', default: true },
    count: { type: 'number', default: 3 },
    note: { description: 'Anything', default: null },
    env: { type: 'environment' },
    odd: { type: 'weird' },
  });
  assert.deepEqual(fields.map(f => [f.name, f.type, f.required, f.default]), [
    ['target', 'choice', true, 'staging'], ['dry', 'boolean', false, 'true'], ['count', 'number', false, '3'],
    ['note', 'string', false, ''], ['env', 'environment', false, ''], ['odd', 'string', false, ''],
  ]);
  assert.deepEqual(fields[0].options, ['staging', 'production']);
  assert.deepEqual(AM.validateDispatch(fields, { target: 'production', dry: false, count: '5' }).inputs,
    { target: 'production', dry: 'false', count: '5', note: '', env: '', odd: '' });
  const bad = AM.validateDispatch(fields, { target: 'moon', count: 'many', ghost: 'x' });
  assert.deepEqual(bad.errors, { ghost: 'The workflow has no such input', target: 'Not one of the options', count: 'Not a number' });
  const required = AM.validateDispatch([{ name: 'why', type: 'string', required: true, default: '', options: [] }], {});
  assert.equal(required.errors.why, 'Required');
  assert.deepEqual(AM.dispatchFields(null), []);
  const many = Array.from({ length: 26 }, (_, i) => ({ name: `i${i}`, type: 'string', required: false, default: '', options: [] }));
  assert.match(AM.validateDispatch(many, {}).error, /at most 25/);
  assert.match(AM.validateDispatch([{ name: 'big', type: 'string', required: false, default: '', options: [] }], { big: 'x'.repeat(70000) }).error, /longer than GitHub/);
});

test('the job graph follows needs, groups a matrix and a reusable workflow, and keeps jobs not yet started', () => {
  const yaml = [
    { key: 'lint', name: 'Lint', needs: [] },
    { key: 'build', needs: [], matrix: true },
    { key: 'test', name: 'Test ${{ matrix.os }}', needs: ['build'], matrix: true },
    { key: 'release', needs: ['test', 'lint'], uses: './.github/workflows/release.yml' },
    { key: 'deploy', needs: ['release'] },
  ];
  const job = (id, name, status, conclusion, startedAt, completedAt) => ({ id, name, status, conclusion, startedAt, completedAt });
  const api = [
    job(1, 'Lint', 'completed', 'success', '2026-01-01T10:00:00Z', '2026-01-01T10:00:30Z'),
    job(2, 'build (ubuntu-latest)', 'completed', 'success', '2026-01-01T10:00:00Z', '2026-01-01T10:01:00Z'),
    job(3, 'build (macos-latest)', 'completed', 'failure', '2026-01-01T10:00:05Z', '2026-01-01T10:02:00Z'),
    job(4, 'Test ubuntu', 'in_progress', null, '2026-01-01T10:02:00Z', null),
    job(5, 'release / publish', 'queued', null, null, null),
    job(6, 'Mystery job', 'completed', 'success', '2026-01-01T10:00:00Z', '2026-01-01T10:00:01Z'),
  ];
  const graph = AM.graphLayout(yaml, api, Date.parse('2026-01-01T10:03:00Z'));
  assert.deepEqual(graph.columns.map(col => col.map(n => n.key)), [['lint', 'build'], ['test'], ['release'], ['deploy'], ['job:6']]);
  const byKey = Object.fromEntries(graph.nodes.map(n => [n.key, n]));
  assert.deepEqual(byKey.build.jobs.map(j => j.id), [2, 3]);
  assert.deepEqual([byKey.build.group, byKey.build.kind, byKey.build.state.bucket, byKey.build.done, byKey.build.durationMs], [true, 'matrix', 'failure', 2, 120_000]);
  assert.deepEqual([byKey.test.name, byKey.test.group, byKey.test.state.bucket, byKey.test.durationMs], ['test', true, 'running', 60_000]);
  assert.deepEqual([byKey.release.kind, byKey.release.jobs.map(j => j.id)], ['reusable', [5]]);
  assert.deepEqual([byKey.lint.name, byKey.lint.group, byKey.lint.kind], ['Lint', false, 'job']);
  assert.deepEqual([byKey.deploy.jobs.length, byKey.deploy.state.bucket], [0, 'queued']);
  // Once the run has finished, a job that never started was skipped.
  assert.equal(AM.graphLayout(yaml, api, undefined, true).nodes.find(n => n.key === 'deploy').state.bucket, 'skipped');
  assert.equal(byKey['job:6'].other, true);
  assert.deepEqual(graph.edges, [
    { from: 'build', to: 'test' }, { from: 'test', to: 'release' }, { from: 'lint', to: 'release' }, { from: 'release', to: 'deploy' },
  ]);
});

test('a workflow without a file (Copilot, Dependabot) puts its jobs in one column, and a cycle does not hang', () => {
  const api = [{ id: 1, name: 'a', status: 'completed', conclusion: 'success' }, { id: 2, name: 'b', status: 'queued' }];
  const graph = AM.graphLayout([], api);
  assert.deepEqual(graph.columns.map(col => col.map(n => n.key)), [['job:1', 'job:2']]);
  assert.equal(graph.nodes[0].other, false);
  const cycle = AM.graphLayout([{ key: 'x', needs: ['y'] }, { key: 'y', needs: ['x'] }], []);
  assert.equal(cycle.nodes.length, 2);
  // A lone job whose name has expressions shows the name GitHub evaluated.
  const lone = AM.graphLayout([{ key: 'greet', name: 'Hello ${{ github.actor }}' }], [{ id: 7, name: 'Hello dev-one', status: 'completed', conclusion: 'success' }]);
  assert.deepEqual([lone.nodes[0].name, lone.nodes[0].group], ['Hello dev-one', false]);
});

test('usage lists each job\'s run time and their sum', () => {
  const usage = AM.usageRows([
    { id: 1, name: 'a', status: 'completed', conclusion: 'success', startedAt: '2026-01-01T10:00:00Z', completedAt: '2026-01-01T10:01:00Z' },
    { id: 2, name: 'b', status: 'completed', conclusion: 'skipped', startedAt: null, completedAt: null },
  ]);
  assert.deepEqual(usage.rows.map(r => [r.name, r.ms]), [['a', 60_000], ['b', null]]);
  assert.equal(usage.total, 60_000);
});

test('log lines are sorted by their marks and fold under their group', () => {
  const lines = AM.logLines('##[group]Run tests\nnpm test\n##[endgroup]\n##[error]Process completed with exit code 1.\nplain\n');
  assert.deepEqual(lines, [
    { kind: 'group', text: 'Run tests', group: null, time: null },
    { kind: 'plain', text: 'npm test', group: 0, time: null },
    { kind: 'error', text: 'Process completed with exit code 1.', group: null, time: null },
    { kind: 'plain', text: 'plain', group: null, time: null },
  ]);
  // GitHub's timestamps come apart from the text, a BOM in front of the first one too.
  assert.deepEqual(AM.logLines('\uFEFF2026-01-01T10:00:01.1234567Z ##[group]Run x\n2026-01-01T10:00:02.0000000Z hi\n'), [
    { kind: 'group', text: 'Run x', group: null, time: '2026-01-01T10:00:01.1234567Z' },
    { kind: 'plain', text: 'hi', group: 0, time: '2026-01-01T10:00:02.0000000Z' },
  ]);
  // The time on this computer's clock: the same instant, in its own time zone.
  const at = new Date('2026-01-01T10:00:01.123Z');
  const two = n => String(n).padStart(2, '0');
  assert.equal(AM.logTime('2026-01-01T10:00:01.1234567Z'), `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`);
  assert.deepEqual([AM.logTime(null), AM.logTime('soon')], ['', '']);
  // A finished step without a log: not ready yet while the job runs, gone once it is over.
  assert.match(AM.missingStepLog(true), /yet/);
  assert.match(AM.missingStepLog(false), /deleted|expired/);
  assert.equal(AM.logLineKind('##[warning]careful'), 'warning');
  assert.equal(AM.logLineText('##[command]/usr/bin/git version'), '/usr/bin/git version');
  assert.deepEqual([AM.logLineKind('[command]/usr/bin/tar xz'), AM.logLineText('[command]/usr/bin/tar xz')], ['command', '/usr/bin/tar xz']);
  assert.equal(AM.logLineKind('[a link] in text'), 'plain');
});

test('a GitHub Actions address gives its run, attempt and job, and the pages that stay on GitHub have theirs', () => {
  assert.deepEqual(AM.parseActionsUrl('https://github.com/acme/widgets/actions/runs/123/job/456'), { owner: 'acme', repo: 'widgets', runId: 123, attempt: null, jobId: 456 });
  assert.deepEqual(AM.parseActionsUrl('https://github.com/acme/widgets/actions/runs/123/attempts/2'), { owner: 'acme', repo: 'widgets', runId: 123, attempt: 2, jobId: null });
  assert.equal(AM.parseActionsUrl('https://ci.example/acme/widgets/77'), null);
  assert.equal(AM.githubPage({ owner: 'acme', repo: 'widgets' }, 'attestations'), 'https://github.com/acme/widgets/attestations');
  assert.equal(AM.githubPage({ host: 'git.example.ghe.com', owner: 'acme', repo: 'widgets' }, 'usageMetrics'), 'https://git.example.ghe.com/acme/widgets/actions/metrics/usage');
  assert.equal(AM.githubPage({ owner: 'acme', repo: 'widgets' }, 'nope'), null);
});
