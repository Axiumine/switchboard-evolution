// actions-edits.js: every change the Actions view makes is one fixed REST
// call, its texts on stdin, and nothing unchecked reaches gh.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pr = require('../pull-requests');
const actions = require('../actions');
const edits = require('../actions-edits');

const DIR = '/code/widgets';

function setup(answer = () => ({ code: 0, stderr: '', stdout: '' })) {
  const calls = [];
  pr.init({
    git: { remoteList: async () => [{ name: 'origin', url: 'https://github.com/acme/widgets.git' }], configListIncludes: async () => [] },
    runGh: async (args, opts = {}) => {
      calls.push({ args, opts, input: opts.input ? JSON.parse(opts.input) : null });
      return answer(args, opts, calls.length);
    },
  });
  return calls;
}

beforeEach(() => actions.resetCaches());

const R = 'repos/acme/widgets/actions';
const head = ['api', '--hostname', 'github.com', '--method'];

test('each kind makes exactly its own REST call, with its body on stdin', async () => {
  const cases = [
    [{ kind: 'dispatch', workflowId: 'deploy.yml', ref: 'main', inputs: { target: 'production', dry: 'false' } },
      ['POST', `${R}/workflows/deploy.yml/dispatches`], { ref: 'main', inputs: { target: 'production', dry: 'false' }, return_run_details: true }],
    [{ kind: 'dispatch', workflowId: 11, ref: 'v1.2.0' }, ['POST', `${R}/workflows/11/dispatches`], { ref: 'v1.2.0', inputs: {}, return_run_details: true }],
    [{ kind: 'rerun', runId: 900 }, ['POST', `${R}/runs/900/rerun`], null],
    [{ kind: 'rerun', runId: 900, failedOnly: true, debug: true }, ['POST', `${R}/runs/900/rerun-failed-jobs`], { enable_debug_logging: true }],
    [{ kind: 'rerun-job', jobId: 131772433205, debug: true }, ['POST', `${R}/jobs/131772433205/rerun`], { enable_debug_logging: true }],
    [{ kind: 'cancel', runId: 900 }, ['POST', `${R}/runs/900/cancel`], null],
    [{ kind: 'force-cancel', runId: 900 }, ['POST', `${R}/runs/900/force-cancel`], null],
    [{ kind: 'delete-run', runId: 900 }, ['DELETE', `${R}/runs/900`], null],
    [{ kind: 'delete-logs', runId: 900 }, ['DELETE', `${R}/runs/900/logs`], null],
    [{ kind: 'enable', workflowId: 'ci.yml' }, ['PUT', `${R}/workflows/ci.yml/enable`], null],
    [{ kind: 'disable', workflowId: 11 }, ['PUT', `${R}/workflows/11/disable`], null],
    [{ kind: 'approve-fork', runId: 900 }, ['POST', `${R}/runs/900/approve`], null],
    [{ kind: 'review-deployments', runId: 900, environmentIds: [5, 6], state: 'approved', comment: 'Ship it; "quoted" --method DELETE' },
      ['POST', `${R}/runs/900/pending_deployments`], { environment_ids: [5, 6], state: 'approved', comment: 'Ship it; "quoted" --method DELETE' }],
    [{ kind: 'delete-artifact', artifactId: 71 }, ['DELETE', `${R}/artifacts/71`], null],
    [{ kind: 'delete-cache', cacheId: 44 }, ['DELETE', `${R}/caches/44`], null],
    [{ kind: 'delete-cache', key: 'npm-linux-abc &x=1', ref: 'refs/heads/main' }, ['DELETE', `${R}/caches?key=npm-linux-abc%20%26x%3D1&ref=refs%2Fheads%2Fmain`], null],
    [{ kind: 'runner-remove', runnerId: 3 }, ['DELETE', `${R}/runners/3`], null],
    [{ kind: 'runner-labels', runnerId: 3, labels: ['gpu', 'linux.large'] }, ['PUT', `${R}/runners/3/labels`], { labels: ['gpu', 'linux.large'] }],
    [{ kind: 'runner-labels', runnerId: 3, labels: [] }, ['PUT', `${R}/runners/3/labels`], { labels: [] }],
  ];
  for (const [params, [method, apiPath], body] of cases) {
    const calls = setup();
    const result = await edits.edit(DIR, params);
    assert.equal(result.ok, true, `${params.kind}: ${result.error}`);
    assert.equal(calls.length, 1, params.kind);
    assert.deepEqual(calls[0].args, [...head, method, apiPath, ...(body ? ['--input', '-'] : [])], params.kind);
    assert.deepEqual(calls[0].input, body, params.kind);
  }
});

test('"Run workflow" gives the run it started, as GitHub answers it', async () => {
  setup(() => ({ code: 0, stderr: '', stdout: JSON.stringify({ workflow_run_id: 45311767835, run_url: 'https://api.github.com/x', html_url: 'https://github.com/acme/widgets/actions/runs/45311767835' }) }));
  const result = await edits.edit(DIR, { kind: 'dispatch', workflowId: 11, ref: 'main' });
  assert.deepEqual([result.runId, result.url, result.message], [45311767835, 'https://github.com/acme/widgets/actions/runs/45311767835', 'Workflow run was successfully requested.']);
  // An older GitHub answers 204, with nothing.
  setup(() => ({ code: 0, stderr: '', stdout: '' }));
  const quiet = await edits.edit(DIR, { kind: 'dispatch', workflowId: 11, ref: 'main' });
  assert.deepEqual([quiet.ok, quiet.runId], [true, undefined]);
});

test('"Run workflow" waits until GitHub can read the run it started, and leaves out one it never can', async () => {
  const saved = { ...edits.RUN_WAIT };
  edits.RUN_WAIT.delayMs = 1;
  try {
    const started = JSON.stringify({ workflow_run_id: 45311767835, html_url: 'https://github.com/acme/widgets/actions/runs/45311767835' });
    const missing = { code: 1, stderr: 'gh: Not Found (HTTP 404)', stdout: '' };
    // The run is a 404 twice, then there.
    let calls = setup((args, opts, n) => (n === 1 ? { code: 0, stderr: '', stdout: started } : n <= 3 ? missing : { code: 0, stderr: '', stdout: '45311767835' }));
    let result = await edits.edit(DIR, { kind: 'dispatch', workflowId: 11, ref: 'main' });
    assert.equal(result.runId, 45311767835);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[1].args, ['api', '--hostname', 'github.com', `${R}/runs/45311767835`, '--jq', '.id']);
    // Never there: started all the same, without the run to open.
    calls = setup((args, opts, n) => (n === 1 ? { code: 0, stderr: '', stdout: started } : missing));
    result = await edits.edit(DIR, { kind: 'dispatch', workflowId: 11, ref: 'main' });
    assert.deepEqual([result.ok, result.runId, result.message], [true, undefined, 'Workflow run was successfully requested.']);
    assert.equal(calls.length, 1 + edits.RUN_WAIT.tries);
    // Another failure stops the waiting: the view reads the run and says what it finds.
    calls = setup((args, opts, n) => (n === 1 ? { code: 0, stderr: '', stdout: started } : { code: 1, stderr: 'gh: Server Error (HTTP 502)', stdout: '' }));
    result = await edits.edit(DIR, { kind: 'dispatch', workflowId: 11, ref: 'main' });
    assert.deepEqual([result.runId, calls.length], [45311767835, 2]);
  } finally {
    Object.assign(edits.RUN_WAIT, saved);
  }
});

test('what a kind does not take, or does not take in that shape, never reaches gh', async () => {
  const calls = setup();
  const refused = [
    { kind: 'nope' },
    { kind: 'toString' },
    { kind: 'cancel' },
    { kind: 'cancel', runId: '900' },
    { kind: 'cancel', runId: 900, extra: 1 },
    { kind: 'cancel', runId: -1 },
    { kind: 'dispatch', workflowId: '../x.yml', ref: 'main' },
    { kind: 'dispatch', workflowId: 11, ref: '-x' },
    { kind: 'dispatch', workflowId: 11, ref: 'c'.repeat(40) },
    { kind: 'dispatch', workflowId: 11, ref: 'main', inputs: { 'bad key': 'x' } },
    { kind: 'dispatch', workflowId: 11, ref: 'main', inputs: { n: 3 } },
    { kind: 'dispatch', workflowId: 11, ref: 'main', inputs: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`i${i}`, 'x'])) },
    { kind: 'dispatch', workflowId: 11, ref: 'main', inputs: { big: 'x'.repeat(70000) } },
    { kind: 'review-deployments', runId: 900, environmentIds: [], state: 'approved' },
    { kind: 'review-deployments', runId: 900, environmentIds: [5], state: 'maybe' },
    { kind: 'delete-cache' },
    { kind: 'delete-cache', cacheId: 4, key: 'x' },
    { kind: 'delete-cache', key: 'x', ref: 'main' },
    { kind: 'runner-labels', runnerId: 3, labels: ['has space'] },
    { kind: 'rerun', runId: 900, failedOnly: 'yes' },
  ];
  for (const params of refused) assert.equal((await edits.edit(DIR, params)).code, 'bad-request', JSON.stringify(params).slice(0, 80));
  assert.equal(calls.length, 0);
});

test('GitHub\'s refusals come in plainer words', async () => {
  setup(() => ({ code: 1, stderr: 'gh: Cannot cancel a workflow run that is completed. (HTTP 409)', stdout: '' }));
  assert.deepEqual(await edits.edit(DIR, { kind: 'cancel', runId: 900 }), { error: 'The run has already finished.', code: 'conflict' });
  setup(() => ({ code: 1, stderr: 'gh: Must have admin rights to Repository. (HTTP 403)', stdout: '' }));
  const forbidden = await edits.edit(DIR, { kind: 'runner-remove', runnerId: 3 });
  assert.equal(forbidden.code, 'forbidden');
  assert.match(forbidden.error, /may not do this.*Must have admin rights/);
  setup(() => ({ code: 1, stderr: 'gh: Not Found (HTTP 404)', stdout: '' }));
  assert.match((await edits.edit(DIR, { kind: 'enable', workflowId: 11 })).error, /does not know this workflow any more/);
  assert.match((await edits.edit(DIR, { kind: 'delete-run', runId: 900 })).error, /no longer has it/);
  setup(() => ({ code: 1, stderr: "gh: Workflow does not have 'workflow_dispatch' trigger (HTTP 422)", stdout: '' }));
  assert.match((await edits.edit(DIR, { kind: 'dispatch', workflowId: 11, ref: 'main' })).error, /workflow_dispatch/);
});

test('an artifact downloads into a folder named after it, a job\'s log and a run\'s archive into the file chosen', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'actions-edits-'));
  try {
    let calls = setup();
    const done = await edits.downloadArtifact(DIR, { runId: 900, name: 'coverage report', destDir: tmp });
    assert.deepEqual(calls[0].args, ['run', 'download', '900', '-R', 'acme/widgets', '--name=coverage report', '--dir', path.join(tmp, 'coverage report')]);
    assert.equal(done.path, path.join(tmp, 'coverage report'));
    fs.mkdirSync(path.join(tmp, 'coverage report'));
    assert.equal((await edits.downloadArtifact(DIR, { runId: 900, name: 'coverage report', destDir: tmp })).code, 'exists');
    assert.equal(edits.folderName('a/b:c'), 'a-b-c');
    assert.equal(edits.folderName('..'), 'artifact');
    for (const bad of [{ runId: 900, name: '', destDir: tmp }, { runId: 900, name: 'x', destDir: 'relative' }, { runId: 'x', name: 'x', destDir: tmp }]) {
      assert.equal((await edits.downloadArtifact(DIR, bad)).code, 'bad-request');
    }

    setup(() => ({ code: 0, stderr: '', stdout: '2026-01-01T10:00:00.0000000Z hello\n' }));
    const jobFile = path.join(tmp, 'job.txt');
    assert.equal((await edits.saveLog(DIR, { jobId: 31, filePath: jobFile })).ok, true);
    assert.equal(fs.readFileSync(jobFile, 'utf8'), '2026-01-01T10:00:00.0000000Z hello\n');

    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    calls = setup(() => ({ code: 0, stderr: '', stdout: zip }));
    const zipFile = path.join(tmp, 'logs.zip');
    assert.equal((await edits.saveLog(DIR, { runId: 900, attempt: 2, filePath: zipFile })).ok, true);
    assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.com', 'repos/acme/widgets/actions/runs/900/attempts/2/logs']);
    assert.equal(calls[0].opts.binary, true);
    assert.deepEqual(fs.readFileSync(zipFile), zip);

    setup(() => ({ code: 1, stderr: 'gh: Not Found (HTTP 404)', stdout: Buffer.from('') }));
    assert.match((await edits.saveLog(DIR, { runId: 900, filePath: zipFile })).error, /no logs of this run/);
    assert.equal((await edits.saveLog(DIR, { runId: 900, filePath: 'logs.zip' })).code, 'bad-request');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
