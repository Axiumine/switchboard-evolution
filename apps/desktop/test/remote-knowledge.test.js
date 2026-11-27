// remote-knowledge.js: the Node Knowledge channels a paired phone may call,
// their parameter checks, and what stays on the desktop.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { READ_TOOLS } = require('../remote-knowledge');
const { createRemoteApi } = require('../remote-api');
const knowledge = require('../knowledge');

const API = '/code/api';
const WEB = '/code/web';

// method → valid parameters
const VALID = {
  'get-knowledge-status': ['p1'],
  'get-knowledge-settings': ['p1'],
  'set-knowledge-settings': ['p1', { enabled: true, mode: 'fast', toolProfile: 'scout', crossRepo: false, autoRefresh: true, share: { [API]: true }, savedQueries: [{ name: 'calls', query: 'MATCH (n) RETURN n' }] }],
  'knowledge-query': ['p1', API, 'trace_path', { function_name: 'main', depth: 2 }],
  'knowledge-compare': ['p1', API, WEB, { limit: 100 }],
  'knowledge-prompt': ['p1', API, 'review_change_impact', { change: 'login()', base_branch: 'main' }],
  'knowledge-index': ['p1', API, { mode: 'moderate' }],
  'knowledge-index-all': ['p1', { mode: 'full' }],
  'knowledge-link-cross-repo': ['p1'],
  'knowledge-delete-index': ['p1', API],
  // The project folder is a folder like any other here: knowledge.js checks it belongs to the project.
  'knowledge-modules': ['p1', '/code/projects/p1'],
  'knowledge-delete-inner-graph': ['p1', API, 'code-api-backend'],
  'knowledge-adr': ['p1', API, { mode: 'set_sections', section_updates: { Context: 'Why' } }],
  'knowledge-ingest-traces': ['p1', API, { traces: [{ path: ['a.main', 'a.run'], count: 2 }], label: 'phone' }],
};
const CHANNELS = Object.keys(VALID);

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('every Node Knowledge channel a phone may use is callable', async () => {
  const { api, calls } = setup();
  for (const [method, params] of Object.entries(VALID)) {
    assert.deepEqual(await api.call(method, params), { result: { ok: true } }, method);
    assert.deepEqual(calls.at(-1), [method, ...params], method);
  }
  const capabilities = api.capabilities();
  for (const method of CHANNELS) assert.ok(capabilities.includes(method), method);
});

test('the phone asks the same read-only tools the desktop does', () => {
  assert.deepEqual([...READ_TOOLS].sort(), [...knowledge.READ_TOOLS].sort());
});

test('wrong parameters are refused before the handler runs', async () => {
  const { api, calls } = setup();
  const refused = [
    ['knowledge-query', ['p1', API, 'index_repository', {}]],
    ['knowledge-query', ['p1', API, 'delete_project', {}]],
    ['knowledge-query', ['p1', 'code/api', 'search_graph', {}]],
    ['knowledge-query', ['p1', API, 'search_graph', { query: 'x'.repeat(70 * 1024) }]],
    ['knowledge-query', ['p1', API, 'search_graph', ['not', 'an', 'object']]],
    ['set-knowledge-settings', ['p1', { names: { [API]: 'other' } }]],
    ['set-knowledge-settings', ['p1', { mode: 'turbo' }]],
    ['set-knowledge-settings', ['p1', { share: { 'relative/path': true } }]],
    ['knowledge-index', ['p1', API, { mode: 'full', repo_path: '/etc' }]],
    ['knowledge-adr', ['p1', API, { mode: 'delete' }]],
    ['knowledge-prompt', ['p1', API, 'other_prompt', {}]],
    ['knowledge-ingest-traces', ['p1', API, { traces: 'from a file' }]],
    ['knowledge-ingest-traces', ['p1', API, { filePath: '/etc/passwd' }]],
    ['knowledge-compare', ['p1', API]],
    ['knowledge-modules', ['p1', 'code/api']],
    ['knowledge-delete-inner-graph', ['p1', API, { name: 'x' }]],
    ['knowledge-delete-inner-graph', ['p1', API, 'x'.repeat(201)]],
  ];
  for (const [method, params] of refused) {
    const reply = await api.call(method, params);
    assert.ok(reply.error, `${method} ${JSON.stringify(params).slice(0, 80)}`);
  }
  assert.equal(calls.length, 0);
});

test('the program, the Lens and the dialogs stay off the phone', () => {
  const { api } = setup();
  const capabilities = api.capabilities();
  for (const method of ['set-knowledge-global', 'get-knowledge-global', 'knowledge-pick-binary', 'knowledge-download-binary', 'knowledge-install-agents', 'knowledge-lens', 'knowledge-import-traces-file', 'knowledge-restart']) {
    assert.equal(capabilities.includes(method), false, method);
  }
});

test('phones hear knowledge-changed, so their queries refresh after a job, an ADR or traces', () => {
  const { api } = setup();
  assert.equal(api.forwardsEvent('knowledge-changed'), true);
});
