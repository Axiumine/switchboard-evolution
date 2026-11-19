const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../remote-worktrees');
const { envFilesForPhone } = require('../remote-worktrees');
const { createRemoteApi, allow } = require('../remote-api');

const REPO = '/code/app';
const TREE = '/code/app-feature';

// method → valid parameters
const VALID = {
  'get-project-worktrees': ['p1'],
  'get-worktree-settings': ['p1'],
  'set-worktree-settings': ['p1', { pathTemplate: '{repo}-{branch}', copyPatterns: ['.env'], copyIgnores: ['node_modules'], postCreateCmd: 'npm ci', preRemoveCmd: '', startAfterCreate: 'claude', sortOrder: 'nameAsc', collapsedGroups: ['a'] }],
  'list-worktree-branches': ['p1', REPO],
  'suggest-worktree-path': ['p1', REPO, 'feature/x'],
  'worktree-create': ['p1', { repoPath: REPO, mode: 'new', branch: 'feature/x', startPoint: 'main', remoteBranch: 'origin/x', path: '../app-x', attach: true, copyEnv: ['.env'] }],
  'worktree-run-post-create': ['p1', TREE],
  'worktree-remove': ['p1', TREE, { force: true, unlock: false, deleteBranch: true, forceDeleteBranch: false, skipPreRemove: false }],
  'worktree-delete-branch': ['p1', REPO, 'feature/x', { force: true }],
  'worktree-merged': ['p1', REPO, 'main'],
  'worktree-lock': ['p1', TREE, 'on a trip'],
  'worktree-unlock': ['p1', TREE],
  'worktree-move': ['p1', TREE, '~/trees/app-feature'],
  'worktree-repair': ['p1', REPO, [TREE]],
  'worktree-prune-preview': ['p1', REPO],
  'worktree-prune': ['p1', REPO, { detachStale: true }],
  'worktree-attach': ['p1', TREE],
  'worktree-detach': ['p1', TREE],
  'worktree-changes': ['p1', TREE],
  'worktree-file-diff': ['p1', TREE, 'src/a.js'],
};
const CHANNELS = Object.keys(VALID);

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('every worktree channel is callable by a phone', async () => {
  const { api, calls } = setup();
  for (const [method, params] of Object.entries(VALID)) {
    assert.deepEqual(await api.call(method, params), { result: { ok: true } }, method);
    assert.deepEqual(calls.at(-1), [method, ...params], method);
  }
  assert.equal(calls.length, CHANNELS.length);
  const capabilities = api.capabilities();
  for (const method of [...CHANNELS, 'list-env-files']) assert.ok(capabilities.includes(method), method);
  assert.equal(CHANNELS.length + 1, 21);
});

test('wrong parameters are refused before the handler runs', async () => {
  const { api, calls } = setup();
  const create = (patch) => ['p1', { repoPath: REPO, mode: 'new', branch: 'x', ...patch }];
  const refused = [
    ['list-worktree-branches', ['p1', 'code/app']],
    ['worktree-create', ['p1', { repoPath: 'code/app', mode: 'new' }]],
    ['worktree-create', create({ startPoint: '--upload-pack=x' })],
    ['worktree-create', create({ mode: 'weird' })],
    ['worktree-create', create({ surprise: 1 })],
    ['worktree-create', ['p1', { mode: 'new' }]],
    ['set-worktree-settings', ['p1', { postCreateCmd: 'x', surprise: true }]],
    ['set-worktree-settings', ['p1', { sortOrder: 'random' }]],
    ['set-worktree-settings', ['p1', { startAfterCreate: 'shell' }]],
    ['worktree-merged', ['p1', REPO, '--all']],
    ['worktree-move', ['p1', TREE, '--force']],
    ['worktree-remove', ['p1', TREE, { force: 'yes' }]],
    ['worktree-remove', ['p1', TREE, { force: true, surprise: true }]],
    ['worktree-unlock', ['p1', TREE, 'extra']],
    ['worktree-changes', ['p1', 'relative/tree']],
    ['worktree-file-diff', ['p1', TREE, '']],
  ];
  for (const [method, params] of refused) {
    assert.match((await api.call(method, params)).error, /Wrong parameter|Wrong parameters/, `${method} ${JSON.stringify(params)}`);
  }
  assert.equal(calls.length, 0);
});

test('worktree settings from a phone may change the commands', async () => {
  const { api, calls } = setup();
  const patch = { postCreateCmd: 'npm ci', preRemoveCmd: 'echo bye' };
  assert.deepEqual(await api.call('set-worktree-settings', ['p1', patch]), { result: { ok: true } });
  assert.deepEqual(calls, [['set-worktree-settings', 'p1', patch]]);
});

test('env files only for a repository of the project', async () => {
  const asked = [];
  const run = envFilesForPhone({
    requireRepository: async (projectId, repoPath) => {
      asked.push(['require', projectId, repoPath]);
      if (repoPath === '/elsewhere') throw new Error('Not a repository of this project');
      return { mainPath: repoPath };
    },
    listEnvFiles: (dir) => { asked.push(['list', dir]); return ['.env', '.env.example']; },
    defaultEnvSelection: () => ['.env'],
  });
  // The same call a phone makes, with the fakes in place of the real service.
  allow('test-env-files', [(v) => typeof v === 'string', (v) => typeof v === 'string'], { run });
  const { api } = setup();
  assert.deepEqual(await api.call('test-env-files', ['p1', '/code/app']), { result: { ok: true, files: ['.env', '.env.example'], defaults: ['.env'] } });
  assert.deepEqual(asked, [['require', 'p1', '/code/app'], ['list', '/code/app']]);

  asked.length = 0;
  assert.deepEqual(await api.call('test-env-files', ['p1', '/elsewhere']), { error: 'Not a repository of this project' });
  assert.deepEqual(asked, [['require', 'p1', '/elsewhere']]);
});

test('list-env-files from a phone needs a project and an absolute folder', async () => {
  const { api } = setup();
  assert.match((await api.call('list-env-files', ['/code/app'])).error, /Wrong parameter/);
  assert.match((await api.call('list-env-files', ['p1', 'code/app'])).error, /Wrong parameter 2/);
});

test('a phone may choose every order the desktop knows', async () => {
  // worktrees.js needs the database to load; its list is read from the source.
  const source = require('fs').readFileSync(require('path').join(__dirname, '../worktrees.js'), 'utf8');
  const orders = [...source.match(/const SORT_ORDERS = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(orders.includes('modifiedDesc'));
  const { api, calls } = setup();
  for (const sortOrder of orders) {
    assert.deepEqual(await api.call('set-worktree-settings', ['p1', { sortOrder }]), { result: { ok: true } }, sortOrder);
  }
  assert.equal(calls.length, orders.length);
});
