const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../remote-git-graph');
const { createRemoteApi } = require('../remote-api');

const CHANNELS = ['get-project-git-graph', 'get-git-graph-commit-detail', 'get-git-graph-file-diff-between', 'get-git-graph-remotes',
  'get-git-graph-global-preferences', 'run-git-graph-action', 'cancel-git-graph-action', 'save-git-graph-archive',
  'trust-git-graph-repo-config', 'set-git-graph-global-preferences', 'export-git-graph-repo-config', 'set-git-graph-repo-config',
  'get-git-graph-avatar-url', 'clear-git-graph-avatar-cache'];

function setup() {
  const calls = [];
  const registry = new Map(CHANNELS.map((channel) => [channel, { fn: (_e, ...args) => { calls.push([channel, ...args]); return { ok: true }; } }]));
  return { api: createRemoteApi({ getHandler: (channel) => registry.get(channel) || null }), calls };
}

test('a phone reads the graph, a commit and a file between revisions, in an attached folder', async () => {
  const { api, calls } = setup();
  assert.deepEqual(await api.call('get-project-git-graph', ['p1', '/code/app', { limit: 300, order: 'date', branches: 'all', showRemote: true, showStashes: true }]), { result: { ok: true } });
  assert.deepEqual(await api.call('get-git-graph-commit-detail', ['p1', '/code/app', 'abc1234']), { result: { ok: true } });
  assert.deepEqual(await api.call('get-git-graph-file-diff-between', ['p1', '/code/app', 'abc1234', null, 'src/app.ts']), { result: { ok: true } });
  assert.match((await api.call('get-project-git-graph', ['p1', '/code/app', { limit: 9999 }])).error, /Wrong parameter 3/);
  assert.match((await api.call('get-project-git-graph', ['p1', '/code/app', { branches: ['--output=/tmp/x'] }])).error, /Wrong parameter 3/);
  assert.match((await api.call('get-git-graph-file-diff-between', ['p1', '/code/app', 'abc', null, '/etc/passwd'])).error, /Wrong parameter 5/);
  assert.equal(calls.length, 3);
});

test('a phone may run every Git Graph action but the archive', async () => {
  const { api, calls } = setup();
  // Allowed ids get past the whitelist to the phone's own check (checkPhoneAction, tested below).
  for (const actionId of ['checkoutBranchImmediate', 'merge', 'pushBranch', 'stashPop', 'resetToCommit', 'fetchAllRemotes',
    'addRemote', 'editRemote', 'deleteRemote', 'setUserDetails', 'resetFileToRevision', 'rebaseInteractive']) {
    assert.doesNotMatch(String((await api.call('run-git-graph-action', ['p1', '/code/app', actionId, {}])).error), /Wrong parameter|Not available/, actionId);
  }
  // createArchive picks no path of its own for a phone: create-git-graph-archive does.
  for (const actionId of ['createArchive', 'nonsense']) {
    assert.match((await api.call('run-git-graph-action', ['p1', '/code/app', actionId, {}])).error, /Wrong parameter 3/, actionId);
  }
  // The native Save dialog stays on the desktop.
  assert.match((await api.call('save-git-graph-archive', ['p1', '/code/app'])).error, /Not available remotely/);
  assert.match((await api.call('confirm-git-graph-avatars-gitlab-host', ['p1', '/code/app', 'gitlab.example.com'])).error, /Not available remotely/);
  assert.deepEqual(await api.call('cancel-git-graph-action', ['p1', '/code/app', 'pushBranch']), { result: { ok: true } });
  assert.equal(calls.length, 1);
});

test('a phone changes the repository\'s settings, the global preferences, trust and export', async () => {
  const { api, calls } = setup();
  const cases = [
    ['set-git-graph-repo-config', ['p1', '/code/app', { commitOrdering: 'topo' }]],
    ['set-git-graph-global-preferences', [{ showTags: false }]],
    ['trust-git-graph-repo-config', ['p1', '/code/app', true]],
    ['export-git-graph-repo-config', ['p1', '/code/app']],
    ['get-git-graph-avatar-url', ['p1', '/code/app', 'ada@example.com']],
    ['clear-git-graph-avatar-cache', []],
  ];
  for (const [method, params] of cases) {
    assert.deepEqual(await api.call(method, params), { result: { ok: true } }, method);
    assert.deepEqual(calls.at(-1), [method, ...params], method);
  }
  assert.match((await api.call('trust-git-graph-repo-config', ['p1', '/code/app', 'yes'])).error, /Wrong parameter 3/);
  assert.match((await api.call('set-git-graph-repo-config', ['p1', '/code/app', ['x']])).error, /Wrong parameter 3/);
  assert.match((await api.call('set-git-graph-global-preferences', [['x']])).error, /Wrong parameter 1/);
  assert.match((await api.call('get-git-graph-avatar-url', ['p1', '/code/app', 'x'.repeat(321)])).error, /Wrong parameter 3/);
  assert.equal(calls.length, cases.length);
});

test('phones hear a repository change and the progress of a push or a fetch', () => {
  const { api } = setup();
  assert.equal(api.forwardsEvent('git-graph-repo-changed'), true);
  assert.equal(api.forwardsEvent('git-graph-action-progress'), true);
});

const { checkPhoneAction } = require('../remote-git-graph');

function checker({ remotes = ['origin', 'fork'], stashes = { 'stash@{0}': 'aaa111', 'stash@{1}': 'bbb222' } } = {}) {
  return checkPhoneAction({ remotesOf: async () => remotes, revParse: async (ref) => stashes[ref] || null });
}

test('a phone names only configured remotes: a path is not a remote', async () => {
  const check = checker();
  assert.equal(await check('pushBranch', { branch: 'main', remotes: ['fork'] }), null);
  assert.equal(await check('pushBranch', { branch: 'main', remotes: [] }), null);
  assert.equal(await check('fetchRemote', { remote: 'origin' }), null);
  for (const [actionId, params] of [
    ['pushBranch', { branch: 'main', remotes: ['..'], force: 'force' }],
    ['pushTag', { tagName: 'v1', remotes: ['origin', 'sub/repo'] }],
    ['addTag', { name: 'v2', commit: 'abc1234', pushToRemotes: ['.'] }],
    ['deleteBranch', { name: 'old', deleteOnRemotes: ['../other'] }],
    ['deleteRemoteBranch', { remote: '..', shortName: 'keep' }],
    ['merge', { ref: 'x', refType: 'remote-branch', remote: 'nowhere' }],
  ]) {
    assert.match(await check(actionId, params), /not a remote of this repository/, `${actionId} ${JSON.stringify(params)}`);
  }
});

test('a stash action names the stash the phone saw, by its hash', async () => {
  const check = checker();
  assert.equal(await check('stashDrop', { stashRef: 'stash@{1}', stashHash: 'bbb222' }), null);
  assert.match(await check('stashDrop', { stashRef: 'stash@{1}', stashHash: 'aaa111' }), /stashes changed/);
  assert.match(await check('stashPop', { stashRef: 'stash@{0}' }), /stashes changed/);
});

test('remotes a phone edits or deletes must exist, one it adds must not', async () => {
  const check = checker();
  assert.equal(await check('editRemote', { oldName: 'fork', newName: 'mine' }), null);
  assert.match(await check('editRemote', { oldName: 'nope', url: 'https://x' }), /"nope" is not a remote of this repository/);
  assert.equal(await check('deleteRemote', { name: 'origin' }), null);
  assert.match(await check('deleteRemote', { name: 'nope' }), /"nope" is not a remote of this repository/);
  assert.match(await check('addRemote', { name: 'origin', url: 'https://x' }), /A remote named "origin" already exists/);
  assert.equal(await check('addRemote', { name: 'up', url: 'https://x' }), null);
});

test('a file is reset only by its literal name', async () => {
  const check = checker();
  for (const relPath of [':(glob)**', ':/', 'src/*.js', 'a?.txt', 'a[1].txt', 'a\\b.txt',
    // The action resolves these to a path that opens with ':' before git sees it.
    'x/../:(attr:text)', './:/', 'a/../:(top)b', './src/../:(glob)**', 'src/:(top)a']) {
    assert.match(await check('resetFileToRevision', { commit: 'abc1234', relPath }), /characters git reads as a pattern/, relPath);
  }
  for (const relPath of ['src/app.ts', './src/app.ts', 'src/../lib/a b.txt']) {
    assert.equal(await check('resetFileToRevision', { commit: 'abc1234', relPath }), null, relPath);
  }
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { archiveForPhone, wiring } = require('../remote-git-graph');

function archiver(downloads, { remotes = ['origin'] } = {}) {
  const forwarded = [];
  const getHandler = (channel) => (channel === 'run-git-graph-action'
    ? { fn: async (_e, ...args) => { forwarded.push(args); return { absPath: args[3].absPath, format: args[3].format }; } }
    : null);
  return { forwarded, run: archiveForPhone({ downloadsDir: () => downloads, getHandler, remotesOf: async () => remotes }) };
}

test('the archive goes to Downloads and never overwrites', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
  try {
    fs.writeFileSync(path.join(dir, 'main.zip'), 'old');
    const { forwarded, run } = archiver(dir);
    assert.deepEqual(await run(null, 'p1', '/code/app', { ref: 'main', refType: 'branch', format: 'zip' }),
      { absPath: path.join(dir, 'main (2).zip'), format: 'zip' });
    assert.deepEqual(forwarded[0].slice(0, 3), ['p1', '/code/app', 'createArchive']);
    assert.deepEqual(forwarded[0][3], { ref: 'main', refType: 'branch', remote: undefined, format: 'zip', absPath: path.join(dir, 'main (2).zip') });
    fs.writeFileSync(path.join(dir, 'main (2).zip'), 'old');
    assert.equal((await run(null, 'p1', '/code/app', { ref: 'main', refType: 'branch', format: 'zip', suggestedName: '' })).absPath, path.join(dir, 'main (3).zip'));
    assert.equal(fs.readFileSync(path.join(dir, 'main.zip'), 'utf8'), 'old');

    const evil = (await run(null, 'p1', '/code/app', { ref: 'main', refType: 'branch', format: 'tar', suggestedName: '../evil/x' })).absPath;
    assert.equal(path.dirname(evil), dir);
    assert.doesNotMatch(path.basename(evil), /\.\.|[\\/]/);
    assert.equal(path.extname(evil), '.tar');

    assert.match(String((await run(null, 'p1', '/code/app', { ref: 'main', refType: 'remote-branch', remote: 'nope', format: 'zip' })).error), /"nope" is not a remote/);
    assert.equal(forwarded.length, 3);
    const viaRemote = await run(null, 'p1', '/code/app', { ref: 'main', refType: 'remote-branch', remote: 'origin', format: 'zip' });
    assert.equal(path.dirname(viaRemote.absPath), dir);
    assert.equal(forwarded.at(-1)[3].remote, 'origin');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the archive method checks its parameters', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
  const was = wiring.downloadsDir;
  wiring.downloadsDir = () => dir;
  try {
    const { api } = setup();
    const params = (spec) => ['p1', '/code/app', { ref: 'main', refType: 'branch', format: 'zip', ...spec }];
    assert.doesNotMatch(String((await api.call('create-git-graph-archive', params({ suggestedName: '', remote: '' }))).error), /Wrong parameter/);
    for (const spec of [{ ref: '' }, { refType: 'file' }, { format: 'rar' }, { absPath: '/tmp/x' }, { remote: 5 }]) {
      assert.match((await api.call('create-git-graph-archive', params(spec))).error, /Wrong parameter 3/, JSON.stringify(spec));
    }
    assert.match((await api.call('create-git-graph-archive', ['p1', '/code/app', { ref: 'main', refType: 'branch' }])).error, /Wrong parameter 3/);
  } finally {
    wiring.downloadsDir = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the GitLab host for avatars is set only to a host name', async () => {
  const { api } = setup();
  const set = [];
  const was = wiring.setGitLabHost;
  wiring.setGitLabHost = async (...args) => { set.push(args); return { ok: true }; };
  try {
    for (const host of ['gitlab.example.com', 'gitlab.example.com:8443', null]) {
      assert.deepEqual(await api.call('set-git-graph-avatars-gitlab-host', ['p1', '/code/app', host]), { result: { ok: true } }, String(host));
    }
    assert.deepEqual(set, [['p1', '/code/app', 'gitlab.example.com'], ['p1', '/code/app', 'gitlab.example.com:8443'], ['p1', '/code/app', null]]);
    for (const host of ['http://x', 'a b', 'x/y', '', 5, undefined]) {
      assert.match((await api.call('set-git-graph-avatars-gitlab-host', ['p1', '/code/app', host])).error, /Wrong parameter 3/, String(host));
    }
    assert.equal(set.length, 3);
  } finally {
    wiring.setGitLabHost = was;
  }
});
