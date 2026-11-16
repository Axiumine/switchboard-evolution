const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sessionStates } = require('../session-states');

test('each live session is listed once, under its real id', () => {
  const claude = { runtime: 'claude', projectPath: '/p', projectId: 'p1', trackId: null, _cliBusy: true, _openedAt: 10 };
  const forked = { runtime: 'claude', projectPath: '/p', realSessionId: 'real-id', _needsAttention: true, _openedAt: 20 };
  const codexStarting = { runtime: 'codex', projectPath: '/q', pendingLaunch: { tag: 'x' }, _openedAt: 30 };
  const shell = { isPlainTerminal: true, runtime: 'claude', projectPath: '/tmp', exited: true, _openedAt: 40 };
  const active = new Map([['c1', claude], ['temp-id', forked], ['real-id', forked], ['t-codex', codexStarting], ['sh1', shell]]);

  assert.deepEqual(sessionStates(active), [
    { sessionId: 'c1', type: 'cli', runtime: 'claude', projectPath: '/p', projectId: 'p1', trackId: null, busy: true, attention: false, exited: false, starting: false, startedAt: 10 },
    { sessionId: 'real-id', type: 'cli', runtime: 'claude', projectPath: '/p', projectId: null, trackId: null, busy: false, attention: true, exited: false, starting: false, startedAt: 20 },
    { sessionId: 't-codex', type: 'cli', runtime: 'codex', projectPath: '/q', projectId: null, trackId: null, busy: false, attention: false, exited: false, starting: true, startedAt: 30 },
    { sessionId: 'sh1', type: 'terminal', runtime: null, projectPath: '/tmp', projectId: null, trackId: null, busy: false, attention: false, exited: true, starting: false, startedAt: 40 },
  ]);
});

test('attention from the title counts too', () => {
  const [state] = sessionStates(new Map([['x', { runtime: 'codex', _titleAttention: true }]]));
  assert.equal(state.attention, true);
});
