// The one patch of the settings the main process runs (settings-patch.js):
// the checks of the shared model, the "one CLI stays on" rule, the side
// effects of a few settings and the event the other windows and phones follow.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSettingsPatcher, keepOneHarnessOn } = require('../settings-patch');

function setup(initial = { global: { sidebarWidth: 340 } }, over = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const writes = [];
  const events = [];
  const calls = { harnesses: 0, languageServers: [] };
  const patcher = createSettingsPatcher({
    getSetting: key => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
    setSetting: (key, value) => { writes.push([key, value]); store[key] = JSON.parse(JSON.stringify(value)); },
    harnessIds: () => ['claude', 'codex'],
    launchableHarnessIds: () => ['claude', 'codex'],
    shellProfileIds: () => ['zsh'],
    onHarnessesChanged: () => { calls.harnesses++; },
    onLanguageServers: on => { calls.languageServers.push(on); },
    emit: (...args) => events.push(args),
    ...over,
  });
  return { patcher, store, writes, events, calls };
}

test('a valid global patch is merged into the stored object and announced', async () => {
  const { patcher, store, events } = setup();
  const result = await patcher.patch('global', { visibleSessionCount: 8 });
  assert.deepEqual(result, { ok: true, settings: { sidebarWidth: 340, visibleSessionCount: 8 } });
  assert.deepEqual(store.global, { sidebarWidth: 340, visibleSessionCount: 8 });
  assert.deepEqual(events, [['global-settings-changed', { settings: { sidebarWidth: 340, visibleSessionCount: 8 }, changed: ['visibleSessionCount'] }]]);
});

test('an invalid patch writes nothing and announces nothing', async () => {
  const { patcher, writes, events } = setup();
  const result = await patcher.patch('global', { visibleSessionCount: 0 });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.deepEqual(writes, []);
  assert.deepEqual(events, []);
});

test('the last CLI switched off stays on, and the change is reported once', async () => {
  const { patcher, store, calls } = setup();
  const result = await patcher.patch('global', { disabledHarnesses: ['claude', 'codex'] });
  assert.equal(result.ok, true);
  assert.deepEqual(store.global.disabledHarnesses, ['codex']);
  assert.deepEqual(result.settings.disabledHarnesses, ['codex']);
  assert.equal(calls.harnesses, 1);
});

test('a patch that leaves the set of CLIs as it was does not report a change', async () => {
  const { patcher, calls } = setup({ global: { disabledHarnesses: ['codex'] } });
  await patcher.patch('global', { disabledHarnesses: ['codex'] });
  await patcher.patch('global', { visibleSessionCount: 4 });
  assert.equal(calls.harnesses, 0);
});

test('keepOneHarnessOn keeps the one just switched off, else the first launchable', () => {
  const launchable = ['claude', 'codex', 'opencode'];
  assert.deepEqual(keepOneHarnessOn(['claude', 'codex', 'opencode'], new Set(['claude', 'opencode']), launchable), ['claude', 'opencode']);
  assert.deepEqual(keepOneHarnessOn(['claude', 'codex', 'opencode'], new Set(launchable), launchable), ['codex', 'opencode']);
  assert.deepEqual(keepOneHarnessOn(['claude'], new Set(), launchable), ['claude']);
  assert.deepEqual(keepOneHarnessOn(['claude'], new Set(), []), ['claude']);
});

test('languageServers calls the switch of the language servers', async () => {
  const { patcher, calls, store } = setup();
  const result = await patcher.patch('global', { languageServers: false });
  assert.equal(result.ok, true);
  assert.equal(store.global.languageServers, false);
  assert.deepEqual(calls.languageServers, [false]);
});

test('a patch of editorPrefs is merged into the stored ones', async () => {
  const { patcher, store, events } = setup({ global: { editorPrefs: { minimap: false } } });
  const result = await patcher.patch('global', { editorPrefs: { vim: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(store.global.editorPrefs, { minimap: false, vim: true });
  assert.deepEqual(events[0][1].changed, ['editorPrefs']);
});

test('a folder patch merges, null removes the key, and nothing is announced', async () => {
  const { patcher, store, events } = setup({ global: {}, 'project:/Users/demo/app': { chrome: true } });
  const key = 'project:/Users/demo/app';
  const set = await patcher.patch(key, { worktree: true });
  assert.deepEqual(set, { ok: true, settings: { chrome: true, worktree: true } });
  const cleared = await patcher.patch(key, { worktree: null });
  assert.equal(cleared.ok, true);
  assert.deepEqual(store[key], { chrome: true });
  assert.equal('worktree' in store[key], false);
  assert.deepEqual(events, []);
});

test('a folder patch only takes the fields a folder can override', async () => {
  const { patcher, writes } = setup();
  const result = await patcher.patch('project:/Users/demo/app', { visibleSessionCount: 3 });
  assert.equal(result.ok, false);
  assert.deepEqual(writes, []);
});

test('any other key is refused', async () => {
  const { patcher, writes } = setup();
  for (const key of ['windowBounds', 'project:', 'project:relative/path']) {
    const result = await patcher.patch(key, key === 'windowBounds' ? {} : { worktree: true });
    assert.equal(result.ok, false, key);
  }
  assert.deepEqual(writes, []);
});

test('a shell profile the computer does not have is refused', async () => {
  const { patcher } = setup();
  assert.equal((await patcher.patch('global', { shellProfile: 'zsh' })).ok, true);
  assert.equal((await patcher.patch('global', { shellProfile: 'fish' })).ok, false);
});
