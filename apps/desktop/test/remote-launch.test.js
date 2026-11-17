const { test } = require('node:test');
const assert = require('node:assert/strict');

const sessionConfig = require('../public/session-config');
const { createSessionLauncher } = require('../remote-launch');

/** A launcher over a recorded openTerminal and a small session cache. */
function setup({ active = new Map(), openResult = { ok: true } } = {}) {
  const opened = [];
  const launched = [];
  const launcher = createSessionLauncher({
    openTerminal: async (...args) => { opened.push(args); return openResult; },
    effectiveSettings: () => ({ permissionMode: 'acceptEdits', model: 'opus', mcpEmulation: true, unrelated: 'x' }),
    sessionConfig,
    getCachedSession: (id) => ({
      'claude-1': { sessionId: 'claude-1', projectPath: '/p/app', runtime: 'claude' },
      'codex-1': { sessionId: 'codex-1', projectPath: '/p/api', runtime: 'codex' },
    })[id] || null,
    activeSessions: active,
    onLaunched: (id) => launched.push(id),
  });
  return { launcher, opened, launched };
}

test('a new session gets a fresh id, the folder defaults and its project', async () => {
  const { launcher, opened, launched } = setup();
  const result = await launcher.launch({ mode: 'new', projectPath: '/p/app', projectId: 'proj', trackId: 'track', runtime: 'claude', initialPrompt: 'Fix the login' });
  assert.match(result.sessionId, /^[0-9a-f-]{36}$/);
  const [id, path, isNew, options] = opened[0];
  assert.equal(id, result.sessionId);
  assert.equal(path, '/p/app');
  assert.equal(isNew, true);
  assert.equal(options.runtime, 'claude');
  assert.equal(options.permissionMode, 'acceptEdits');
  assert.equal(options.model, 'opus');
  assert.equal(options.unrelated, undefined, 'only options a CLI reads');
  assert.equal(options.initialPrompt, 'Fix the login');
  assert.deepEqual([options.projectId, options.trackId], ['proj', 'track']);
  assert.equal(options.mcpEmulation, false, 'no IDE diff waiting on the desktop');
  assert.equal(options.unattended, true, 'no question about trusting folders waiting on the desktop');
  assert.deepEqual(launched, [result.sessionId]);
});

test('a plain terminal can be started too', async () => {
  const { launcher, opened } = setup();
  await launcher.launch({ mode: 'new', projectPath: '/p/app', runtime: 'terminal' });
  assert.deepEqual(opened[0][3], { type: 'terminal' });
});

test('resume keeps the id and the CLI that wrote the session', async () => {
  const { launcher, opened } = setup();
  assert.deepEqual(await launcher.launch({ mode: 'resume', sessionId: 'codex-1' }), { sessionId: 'codex-1' });
  const [id, path, isNew, options] = opened[0];
  assert.deepEqual([id, path, isNew, options.runtime], ['codex-1', '/p/api', false, 'codex']);
});

test('resuming a session that is already running only says so', async () => {
  const active = new Map([['temp', { realSessionId: 'claude-1', exited: false }]]);
  const { launcher, opened } = setup({ active });
  assert.deepEqual(await launcher.launch({ mode: 'resume', sessionId: 'claude-1' }), { sessionId: 'claude-1', alreadyRunning: true });
  assert.equal(opened.length, 0);
});

test('fork starts a new id from the source, on the source CLI', async () => {
  const { launcher, opened } = setup();
  const result = await launcher.launch({ mode: 'fork', sessionId: 'codex-1' });
  const [id, path, isNew, options] = opened[0];
  assert.notEqual(id, 'codex-1');
  assert.equal(id, result.sessionId);
  assert.deepEqual([path, isNew, options.forkFrom, options.runtime], ['/p/api', true, 'codex-1', 'codex']);
});

test('errors come back as errors', async () => {
  const { launcher } = setup({ openResult: { ok: false, error: 'Session is archived. Unarchive it before resuming.' } });
  assert.deepEqual(await launcher.launch({ mode: 'resume', sessionId: 'claude-1' }), { error: 'Session is archived. Unarchive it before resuming.' });
  assert.deepEqual(await launcher.launch({ mode: 'resume', sessionId: 'missing' }), { error: 'Session not found' });
  assert.deepEqual(await launcher.launch({ mode: 'new' }), { error: 'A new session needs a folder' });
  assert.deepEqual(await launcher.launch({ mode: 'other' }), { error: 'Unknown launch mode: other' });
});

test('a session started on a plan item or by a schedule says so, as from the window', async () => {
  const { launcher, opened } = setup();
  await launcher.launch({ mode: 'new', projectPath: '/p/app', projectId: 'proj', initialPrompt: 'Work on Phase 2', planItem: { file: 'plan', itemText: 'Phase 2: API' } });
  assert.deepEqual(opened[0][3].planItem, { file: 'plan', itemText: 'Phase 2: API' });
  await launcher.launch({ mode: 'new', projectPath: '/p/app', initialPrompt: 'Nightly check', scheduleId: 'sched-1' });
  assert.equal(opened[1][3].scheduleId, 'sched-1');
  await launcher.launch({ mode: 'new', projectPath: '/p/app', planItem: { file: 'plan', itemText: 'x' } });
  assert.equal(opened[2][3].planItem, undefined, 'a plan item belongs to a project');
});

test('running a schedule now starts it as the window does, with its own options', async () => {
  const opened = [];
  const launcher = createSessionLauncher({
    openTerminal: async (...args) => { opened.push(args); return { ok: true }; },
    effectiveSettings: () => ({ permissionMode: 'acceptEdits', model: 'opus' }),
    sessionConfig,
    getCachedSession: () => null,
    activeSessions: new Map(),
    onLaunched: () => {},
    resolveScheduleLaunch: (id) => (id === 'nightly'
      ? { schedule: { id: 'nightly', prompt: 'Check the build', sessionConfig: { claude: { model: 'sonnet' } } }, target: { projectPath: '/p/app', projectId: 'proj', trackId: 't1' }, runtime: 'claude' }
      : { error: 'Schedule not found' }),
  });
  const result = await launcher.runSchedule('nightly');
  assert.match(result.sessionId, /^[0-9a-f-]{36}$/);
  const [, path, isNew, options] = opened[0];
  assert.deepEqual([path, isNew], ['/p/app', true]);
  assert.equal(options.model, 'sonnet', "the schedule's own choice wins");
  assert.equal(options.permissionMode, 'acceptEdits');
  assert.deepEqual([options.initialPrompt, options.scheduleId, options.projectId, options.trackId], ['Check the build', 'nightly', 'proj', 't1']);
  assert.deepEqual(await launcher.runSchedule('missing'), { error: 'Schedule not found' });
});
