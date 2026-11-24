// The Actions view's channels for a paired phone (remote-actions.js): each
// takes exactly the shapes the desktop takes, and the changes a phone may ask
// for are actions-edits.js's own kinds.
const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../remote-actions');
const { createRemoteApi } = require('../remote-api');
const edits = require('../actions-edits');

const REPO = '/code/widgets';

// method → valid parameters
const VALID = {
  'get-actions-workflows': ['p1', REPO, { remote: 'origin' }],
  'get-actions-runs': ['p1', REPO, { remote: 'origin', workflowId: 'ci.yml', page: 2, perPage: 25, query: 'is:failure branch:main' }],
  'get-actions-run': ['p1', REPO, { runId: 45311767835, attempt: 2 }],
  'get-actions-job': ['p1', REPO, { jobId: 138110667226 }],
  'get-actions-step-log': ['p1', REPO, { jobId: 138110667226, step: 3 }],
  'get-actions-job-log': ['p1', REPO, { jobId: 138110667226 }],
  'get-actions-workflow-file': ['p1', REPO, { path: '.github/workflows/ci.yml', ref: 'c'.repeat(40) }],
  'get-actions-dispatch-form': ['p1', REPO, { workflowId: 11, ref: 'release/1.x' }],
  'get-actions-refs': ['p1', REPO, { query: 'rel' }],
  'get-actions-caches': ['p1', REPO, { ref: 'refs/heads/main', key: 'npm-', sort: 'size_in_bytes', direction: 'asc', page: 1 }],
  'get-actions-runners': ['p1', REPO, {}],
  'get-actions-deployments': ['p1', REPO, { environment: 'production', after: 'Y3Vyc29yOjEw' }],
  'edit-actions': ['p1', REPO, { remote: 'origin', kind: 'dispatch', workflowId: 'deploy.yml', ref: 'main', inputs: { target: 'staging' } }],
};
const CHANNELS = Object.keys(VALID);

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map(channel => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: channel => registry.get(channel) || null }), calls };
}

test('every Actions channel is callable by a phone, and the downloads are not', async () => {
  const { api, calls } = setup();
  for (const [method, params] of Object.entries(VALID)) {
    assert.deepEqual(await api.call(method, params), { result: { ok: true } }, method);
    assert.deepEqual(calls.at(-1), [method, ...params], method);
  }
  assert.ok(!api.capabilities().includes('save-actions-artifact'));
  assert.ok(!api.capabilities().includes('save-actions-log'));
});

test('a shape the desktop would not take never reaches it', async () => {
  const { api, calls } = setup();
  const refused = [
    ['get-actions-runs', ['p1', REPO, { remote: '--upload-pack=x' }]],
    ['get-actions-runs', ['p1', REPO, { workflowId: '../secrets.yml' }]],
    ['get-actions-runs', ['p1', REPO, { page: 0 }]],
    ['get-actions-runs', ['p1', REPO, { extra: true }]],
    ['get-actions-run', ['p1', REPO, { runId: '900' }]],
    ['get-actions-run', ['p1', REPO, { runId: 900, attempt: 101 }]],
    ['get-actions-step-log', ['p1', REPO, { jobId: 31 }]],
    ['get-actions-workflow-file', ['p1', REPO, { path: '../../.env', ref: 'main' }]],
    ['get-actions-workflow-file', ['p1', REPO, { path: '.github/workflows/ci.yml', ref: '-x' }]],
    ['get-actions-caches', ['p1', REPO, { sort: 'name' }]],
    ['get-actions-caches', ['p1', REPO, { ref: 'main' }]],
    ['get-actions-run', ['p1', 'relative/path', { runId: 900 }]],
    ['edit-actions', ['p1', REPO, { kind: 'nope' }]],
    ['edit-actions', ['p1', REPO, { kind: 'cancel', runId: 900, extra: 1 }]],
    ['edit-actions', ['p1', REPO, { kind: 'dispatch', workflowId: 11, ref: 'main', inputs: { n: 3 } }]],
  ];
  for (const [method, params] of refused) {
    assert.match((await api.call(method, params)).error, /Wrong parameter|Wrong parameters/, `${method} ${JSON.stringify(params)}`);
  }
  assert.equal(calls.length, 0);
});

test('every kind of change the desktop makes, a phone may ask for', async () => {
  const { api } = setup();
  const samples = {
    dispatch: { workflowId: 11, ref: 'main' }, rerun: { runId: 900, failedOnly: true, debug: true }, 'rerun-job': { jobId: 31 },
    cancel: { runId: 900 }, 'force-cancel': { runId: 900 }, 'delete-run': { runId: 900 }, 'delete-logs': { runId: 900 },
    enable: { workflowId: 'ci.yml' }, disable: { workflowId: 11 }, 'approve-fork': { runId: 900 },
    'review-deployments': { runId: 900, environmentIds: [5], state: 'rejected', comment: 'Not now' },
    'delete-artifact': { artifactId: 7 }, 'delete-cache': { cacheId: 44 }, 'runner-remove': { runnerId: 3 }, 'runner-labels': { runnerId: 3, labels: ['gpu'] },
  };
  assert.deepEqual(Object.keys(samples).sort(), Object.keys(edits.KINDS).sort());
  for (const [kind, params] of Object.entries(samples)) {
    assert.deepEqual(await api.call('edit-actions', ['p1', REPO, { kind, ...params }]), { result: { ok: true } }, kind);
  }
});
