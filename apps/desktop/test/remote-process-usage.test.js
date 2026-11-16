const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isOwner } = require('../remote-process-usage');
const { createRemoteApi } = require('../remote-api');

const SESSION = { kind: 'session', id: 'abc-123' };
const TASK = { kind: 'task', projectPath: '/code/app', label: 'dev' };

// method → valid parameters
const VALID = {
  'get-process-usage': [],
  'stop-owner': [SESSION],
  'kill-owned-process': [TASK, 4242, true],
  'force-stop-owner': [TASK],
};

function setup() {
  const calls = [];
  const registry = new Map(Object.keys(VALID).map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('every Task Manager channel is callable by a phone', async () => {
  const { api, calls } = setup();
  for (const [method, params] of Object.entries(VALID)) {
    assert.deepEqual(await api.call(method, params), { result: { ok: true } }, method);
    assert.deepEqual(calls.at(-1), [method, ...params], method);
  }
  assert.deepEqual(await api.call('kill-owned-process', [SESSION, 7]), { result: { ok: true } }, 'force is optional');
  for (const method of Object.keys(VALID)) assert.ok(api.capabilities().includes(method), method);
});

test('an owner names a session or a task, and carries nothing else', () => {
  assert.equal(isOwner(SESSION), true);
  assert.equal(isOwner(TASK), true);
  assert.equal(isOwner({ ...SESSION, pid: 1 }), false, 'a root pid never comes from the phone');
  assert.equal(isOwner({ ...TASK, rssBytes: 5 }), false);
  assert.equal(isOwner({ kind: 'session', id: '' }), false);
  assert.equal(isOwner({ kind: 'task', projectPath: '/code/app' }), false);
  assert.equal(isOwner({ kind: 'process', id: 'x' }), false);
  assert.equal(isOwner(null), false);
  assert.equal(isOwner(['session']), false);
});

test('wrong parameters are refused before the handler runs', async () => {
  const { api, calls } = setup();
  const refused = [
    ['stop-owner', [{ kind: 'session', id: 'x', pid: 1 }]],
    ['stop-owner', []],
    ['kill-owned-process', [SESSION, '42']],
    ['kill-owned-process', [SESSION, -1]],
    ['kill-owned-process', [SESSION, 1.5]],
    ['kill-owned-process', [SESSION, 42, 'yes']],
    ['force-stop-owner', [SESSION, 'extra']],
    ['get-process-usage', ['extra']],
  ];
  for (const [method, params] of refused) {
    const answer = await api.call(method, params);
    assert.ok(answer.error, `${method} ${JSON.stringify(params)}`);
  }
  assert.equal(calls.length, 0);
});
