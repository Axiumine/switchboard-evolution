const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../remote-pull-requests');
const { createRemoteApi } = require('../remote-api');

const REPO = '/code/widgets';
const HEAD = 'b'.repeat(40);

// method → valid parameters
const VALID = {
  'get-pull-requests': ['p1', REPO, { remote: 'origin' }],
  'get-pull-requests-page': ['p1', REPO, { remote: 'upstream', states: ['CLOSED', 'MERGED'], first: 10, after: 'Y3Vyc29yOjEw' }],
  'get-pull-request-files': ['p1', REPO, { number: 7 }],
  'run-pull-request-action': ['p1', REPO, { remote: 'origin', number: 7, action: 'merge', method: 'squash', deleteBranch: true, headOid: HEAD }],
};
const CHANNELS = Object.keys(VALID);

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('every pull request channel is callable by a phone', async () => {
  const { api, calls } = setup();
  for (const [method, params] of Object.entries(VALID)) {
    assert.deepEqual(await api.call(method, params), { result: { ok: true } }, method);
    assert.deepEqual(calls.at(-1), [method, ...params], method);
  }
  // The list's options may be left out, and so may a page's cursor.
  assert.deepEqual(await api.call('get-pull-requests', ['p1', REPO]), { result: { ok: true } });
  assert.deepEqual(await api.call('get-pull-requests-page', ['p1', REPO, { states: ['MERGED'] }]), { result: { ok: true } });
  for (const action of ['draft', 'ready', 'close']) {
    assert.deepEqual(await api.call('run-pull-request-action', ['p1', REPO, { number: 7, action }]), { result: { ok: true } }, action);
  }
  const capabilities = api.capabilities();
  for (const method of CHANNELS) assert.ok(capabilities.includes(method), method);
});

test('wrong parameters are refused before the handler runs', async () => {
  const { api, calls } = setup();
  const act = (patch) => ['p1', REPO, { number: 7, action: 'merge', method: 'merge', ...patch }];
  const refused = [
    ['get-pull-requests', ['p1', 'code/widgets']],
    ['get-pull-requests', ['p1', REPO, { remote: '--upload-pack=x' }]],
    ['get-pull-requests', ['p1', REPO, { surprise: 1 }]],
    ['get-pull-requests-page', ['p1', REPO, { states: ['OPEN'] }]],
    ['get-pull-requests-page', ['p1', REPO, { states: [] }]],
    ['get-pull-requests-page', ['p1', REPO, {}]],
    ['get-pull-requests-page', ['p1', REPO, { states: ['CLOSED'], first: 500 }]],
    ['get-pull-request-files', ['p1', REPO, { number: '7' }]],
    ['get-pull-request-files', ['p1', REPO, { number: 0 }]],
    ['run-pull-request-action', act({ action: 'lock' })],
    ['run-pull-request-action', act({ method: 'octopus' })],
    ['run-pull-request-action', act({ headOid: 'main' })],
    ['run-pull-request-action', act({ deleteBranch: 'yes' })],
    ['run-pull-request-action', act({ admin: true })],
    ['run-pull-request-action', ['p1', REPO, { action: 'close' }]],
    ['run-pull-request-action', ['p1', REPO, { number: 7, action: 'close' }, 'extra']],
  ];
  for (const [method, params] of refused) {
    assert.match((await api.call(method, params)).error, /Wrong parameter|Wrong parameters/, `${method} ${JSON.stringify(params)}`);
  }
  assert.equal(calls.length, 0);
});

test('the phone\'s lists of actions and merge methods are the desktop\'s', () => {
  const pr = require('../pull-requests');
  const source = require('fs').readFileSync(require('path').join(__dirname, '../remote-pull-requests.js'), 'utf8');
  const listed = (name) => [...source.match(new RegExp(`${name}: (?:optional\\()?oneOf\\(([^)]*)\\)`))[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(listed('action'), pr.ACTIONS);
  assert.deepEqual(listed('method'), pr.MERGE_METHODS);
});
