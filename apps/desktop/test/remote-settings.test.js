// What of the global settings and CBM's settings a paired phone may call (remote-settings.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../remote-settings');
const { createRemoteApi } = require('../remote-api');
const { KNOWLEDGE_CONFIG_FIELDS } = require('../public/settings-model');

const CHANNELS = [
  'get-global-settings', 'set-global-settings',
  'get-knowledge-binary', 'get-knowledge-config', 'set-knowledge-config',
  'set-setting', 'get-setting', 'set-knowledge-global', 'knowledge-pick-binary',
  'knowledge-download-binary', 'knowledge-install-agents', 'knowledge-lens',
];

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('a phone reads the global settings and saves a change', async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.call('get-global-settings', []), { result: { ok: true } });
  assert.deepEqual(await api.call('set-global-settings', [{ visibleSessionCount: 8 }]), { result: { ok: true } });
  assert.deepEqual(calls, [['get-global-settings'], ['set-global-settings', { visibleSessionCount: 8 }]]);
});

test('a patch must be a plain object of a reasonable size; the values are checked by the patch', async () => {
  const { api, calls } = setup();
  assert.match((await api.call('set-global-settings', [['x']])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-global-settings', ['x'])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-global-settings', [null])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-global-settings', [{ preLaunchCmd: 'x'.repeat(200000) }])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-global-settings', [])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-global-settings', [{}, {}])).error, /parameter/i);
  assert.equal(calls.length, 0);
});

test('a phone reads CBM\'s settings and changes the ones the catalog lists', async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.call('get-knowledge-binary', []), { result: { ok: true } });
  assert.deepEqual(await api.call('get-knowledge-config', []), { result: { ok: true } });
  assert.deepEqual(await api.call('set-knowledge-config', ['auto_index', 'true']), { result: { ok: true } });
  assert.deepEqual(await api.call('set-knowledge-config', ['auto_index', '']), { result: { ok: true } }, 'an empty value passes the shape check; knowledge.js judges it');
  for (const field of KNOWLEDGE_CONFIG_FIELDS) {
    assert.deepEqual(await api.call('set-knowledge-config', [field.key, 'x']), { result: { ok: true } }, field.key);
  }
  const before = calls.length;
  assert.match((await api.call('set-knowledge-config', ['ui_enabled', 'true'])).error, /Wrong parameter 1/, 'the Lens stays on the desktop');
  assert.match((await api.call('set-knowledge-config', ['ui_port', '9749'])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-knowledge-config', ['nope', 'x'])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-knowledge-config', ['auto_index', 'x'.repeat(65)])).error, /Wrong parameter 2/);
  assert.match((await api.call('set-knowledge-config', ['auto_index', true])).error, /Wrong parameter 2/);
  assert.match((await api.call('set-knowledge-config', ['auto_index'])).error, /Wrong parameter 2/);
  assert.equal(calls.length, before);
});

test('the generic settings, the program, the installer and the Lens stay off the phone', async () => {
  const { api, calls } = setup();
  const before = calls.length;
  for (const method of ['set-setting', 'get-setting', 'set-knowledge-global', 'knowledge-pick-binary', 'knowledge-download-binary', 'knowledge-install-agents', 'knowledge-lens']) {
    assert.match((await api.call(method, [])).error, /Not available remotely/, method);
    assert.equal(api.capabilities().includes(method), false, method);
  }
  assert.equal(calls.length, before);
});

test('phones hear global-settings-changed', () => {
  const { api } = setup();
  assert.equal(api.forwardsEvent('global-settings-changed'), true);
});
