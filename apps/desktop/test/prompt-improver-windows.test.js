// The Improve prompt window in a window of its own (prompt-improver-windows.js):
// one window per session, its state handed over once, and Insert or Replace
// asked of the main window, which answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptImproverWindows, cleanState } = require('../prompt-improver-windows');

function fakeWindow() {
  const handlers = {};
  return {
    destroyed: false,
    on: (event, fn) => { handlers[event] = fn; },
    close() { this.destroyed = true; handlers.closed && handlers.closed(); },
    isDestroyed() { return this.destroyed; },
  };
}

function setup({ main = true, timeoutMs = 1000 } = {}) {
  let n = 0;
  const opened = [];
  const forward = [];
  const sent = [];
  const mainWin = main ? { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push([channel, payload]) } } : null;
  const windows = createPromptImproverWindows({
    openWindow: (info) => { const w = fakeWindow(); opened.push({ info, w }); return w; },
    bringForward: (w) => forward.push(w),
    mainWindow: () => mainWin,
    randomId: () => `id${++n}`,
    timeoutMs,
  });
  return { windows, opened, forward, sent };
}

const STATE = {
  sessionId: 's1', cli: 'codex', title: 'Login work', folder: 'work/demo',
  read: { text: 'fix it', confident: true }, original: 'fix it', improved: 'Fix the login.', mode: 'none', engine: 'codex', ms: 1200,
};

test('a window per session, its state handed over once', () => {
  const { windows, opened, forward } = setup();
  assert.deepEqual(windows.open(STATE), { ok: true });
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].info, { token: 'id1', title: 'Login work', sessionId: 's1' });
  // The same session again: the window already open comes forward.
  assert.deepEqual(windows.open({ ...STATE, original: 'other' }), { ok: true, existing: true });
  assert.equal(opened.length, 1);
  assert.equal(forward.length, 1);
  const taken = windows.take('id1');
  assert.equal(taken.sessionId, 's1');
  assert.equal(taken.improved, 'Fix the login.');
  assert.equal(taken.mode, 'none');
  assert.equal(windows.take('id1'), null, 'only once');
  assert.equal(windows.take(42), null);
  // Closed, the session can have a new one.
  opened[0].w.close();
  assert.equal(windows.isOpen('s1'), false);
  windows.open(STATE);
  assert.equal(opened.length, 2);
  assert.deepEqual(windows.open({}), { ok: false, error: 'No session.' });
});

test('the state keeps known fields only, of the right kind', () => {
  const s = cleanState({ sessionId: ' s1 ', cli: 'gemini', read: { text: 3, confident: 'yes' }, improved: 5, mode: 'fork', extra: true });
  assert.equal(s.sessionId, 's1');
  assert.equal(s.cli, 'claude');
  assert.deepEqual(s.read, { text: '', confident: false, reason: null });
  assert.equal(s.improved, null);
  assert.equal(s.mode, 'recent');
  assert.equal('extra' in s, false);
});

test('Insert and Replace go to the main window, for the session the window was opened for', async () => {
  const { windows, sent } = setup();
  const pending = windows.apply({ how: 'insert', sessionId: 's1', cli: 'codex', text: 'Fix the login.', readText: 'fix it', readConfident: true });
  assert.equal(sent.length, 1);
  const [channel, payload] = sent[0];
  assert.equal(channel, 'prompt-improver-apply-request');
  assert.deepEqual(payload, { id: 'id1', how: 'insert', sessionId: 's1', cli: 'codex', readText: 'fix it', readConfident: true, text: 'Fix the login.' });
  assert.equal(windows.applied('id1', { ok: true }), true);
  assert.deepEqual(await pending, { ok: true });
  assert.equal(windows.applied('id1', { ok: true }), false, 'answered once');

  const refused = windows.apply({ how: 'replace', sessionId: 's1', text: 'x' });
  windows.applied('id2', { ok: false, error: 'The CLI is working: wait for the turn to end, or insert it.' });
  assert.deepEqual(await refused, { ok: false, error: 'The CLI is working: wait for the turn to end, or insert it.' });

  assert.match((await windows.apply({ how: 'send', sessionId: 's1', text: 'x' })).error, /Nothing to put/);
  assert.match((await windows.apply({ how: 'insert', sessionId: 's1', text: '  ' })).error, /Nothing to put/);
});

test('no main window, or no answer in time, is an error', async () => {
  assert.match((await setup({ main: false }).windows.apply({ how: 'insert', sessionId: 's1', text: 'x' })).error, /main window is not open/);
  const { windows } = setup({ timeoutMs: 20 });
  assert.match((await windows.apply({ how: 'insert', sessionId: 's1', text: 'x' })).error, /did not answer/);
});

test('Insert goes to the window that has the session\'s terminal, its own window when it is in one', async () => {
  const toMain = [];
  const toOwn = [];
  const asked = [];
  const mainWin = { isDestroyed: () => false, webContents: { send: (channel, payload) => toMain.push(payload) } };
  const ownWin = { isDestroyed: () => false, webContents: { send: (channel, payload) => toOwn.push(payload) } };
  const windows = createPromptImproverWindows({
    openWindow: () => fakeWindow(),
    mainWindow: (sessionId) => { asked.push(sessionId); return sessionId === 'popped' ? ownWin : mainWin; },
    randomId: () => 'r1',
    timeoutMs: 1000,
  });
  const pending = windows.apply({ how: 'insert', sessionId: 'popped', text: 'Fix the login.' });
  assert.deepEqual(asked, ['popped']);
  assert.deepEqual(toOwn.map(p => p.sessionId), ['popped']);
  assert.deepEqual(toMain, []);
  windows.applied('r1', { ok: true });
  assert.deepEqual(await pending, { ok: true });
});
