// What of the prompt improver a paired phone may call (remote-prompt-improver.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../remote-prompt-improver');
const { createRemoteApi } = require('../remote-api');

const CHANNELS = ['improve-prompt', 'cancel-prompt-improvement', 'get-prompt-improver-settings', 'set-prompt-improver-settings', 'set-setting'];

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('a phone improves a session\'s prompt and can stop it', async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.call('improve-prompt', ['s1', 'fix the login bug']), { result: { ok: true } });
  assert.deepEqual(await api.call('improve-prompt', ['s1', 'fix it', { mode: 'none', runtime: 'codex' }]), { result: { ok: true } });
  assert.deepEqual(await api.call('cancel-prompt-improvement', ['s1']), { result: { ok: true } });
  assert.match((await api.call('improve-prompt', ['s1', ''])).error, /Wrong parameter 2/);
  assert.match((await api.call('improve-prompt', ['s1', 'x'.repeat(40000)])).error, /Wrong parameter 2/);
  assert.match((await api.call('improve-prompt', ['s1', 'x', { mode: 'fork' }])).error, /Wrong parameter 3/, 'the fork mode is not built');
  assert.match((await api.call('improve-prompt', ['s1', 'x', { cwd: '/etc' }])).error, /Wrong parameter 3/);
  assert.match((await api.call('improve-prompt', [{ id: 's1' }, 'x'])).error, /Wrong parameter 1/);
  assert.equal(calls.length, 3);
});

test('a phone reads and changes the improver settings, and only those', async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.call('get-prompt-improver-settings', []), { result: { ok: true } });
  const change = { engine: 'claude', context: 'recent', recentTurns: 4, models: { claude: 'sonnet' }, template: 'Mine {{prompt}}', confirm: false };
  assert.deepEqual(await api.call('set-prompt-improver-settings', [change]), { result: { ok: true } });
  assert.deepEqual(await api.call('set-prompt-improver-settings', [{ template: null }]), { result: { ok: true } });
  assert.match((await api.call('set-prompt-improver-settings', [{ engine: 'gpt' }])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-prompt-improver-settings', [{ shellProfile: 'bash' }])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-prompt-improver-settings', [{ models: { gemini: 'x' } }])).error, /Wrong parameter 1/);
  assert.match((await api.call('set-setting', ['global', {}])).error, /Not available remotely/);
  assert.equal(calls.length, 3);
  assert.equal(api.forwardsEvent('prompt-improver-settings-changed'), true);
});
