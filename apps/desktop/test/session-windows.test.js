const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  createSessionWindows, RETURNING, ROUTED_CHANNELS, SESSION_WINDOW_EVENTS,
} = require('../session-windows');
const { createSessionNotices } = require('../session-notices');

// A session shown in a window of its own (session-windows.js): its terminal
// output goes to the window that owns it, against fake windows and the main
// window's sink as main.js has it.

/** A webContents as main sees one: what it was sent, and whether it is gone. */
function contents(id) {
  const handlers = {};
  return {
    id, destroyed: false, sent: [],
    isDestroyed() { return this.destroyed; },
    send(channel, ...args) { this.sent.push([channel, ...args]); },
    once(event, fn) { (handlers[event] ||= []).push(fn); },
    /** Its page goes, as Electron destroys it: 'destroyed', once. */
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const fn of handlers.destroyed || []) fn();
    },
  };
}

/** `load` stands for loadFile's promise: a page that loads, or one that fails. */
function fakeWindow(webContents, bounds, load) {
  const handlers = {};
  return {
    webContents, bounds, loaded: null, closed: false,
    on(event, fn) { (handlers[event] ||= []).push(fn); },
    isDestroyed() { return this.closed; },
    loadFile(file, options) { this.loaded = { file, options }; return load(this); },
    close() {
      if (this.closed) return;
      this.closed = true;
      webContents.destroy();
      for (const fn of handlers.closed || []) fn();
    },
  };
}

function setup() {
  const main = contents(1);
  const mainWindow = { webContents: main, isDestroyed: () => false, getBounds: () => ({ x: 100, y: 50, width: 1200, height: 800 }) };
  const activeSessions = new Map();
  const created = [];
  const forward = [];
  const logged = [];
  // Whether the next window's page loads: windows.open() awaits it.
  let load = () => Promise.resolve();
  let nextId = 2;
  // The broadcast: the main window's sink, as main.js adds it, then the session windows'.
  const sinks = [];
  const emit = (channel, ...args) => { for (const sink of sinks) sink(channel, args); };
  const sessionNotices = createSessionNotices({ emit });
  const windows = createSessionWindows({
    createPageWindow: (kind, spec, options) => {
      const win = fakeWindow(contents(nextId++), options.bounds, (w) => load(w));
      created.push({ kind, spec, options, win });
      return win;
    },
    getMainWindow: () => mainWindow,
    activeSessions,
    sessionNotices,
    emit,
    bringForward: (win) => forward.push(win),
    log: { error: (...args) => logged.push(args.join(' ')) },
  });
  sinks.push((channel, args) => { if (!windows.routesAway(channel, args)) main.send(channel, ...args); });
  sinks.push(windows.windowSink);

  function session(id, extra = {}) {
    const s = { outputBuffer: [], outputBufferSize: 0, altScreen: false, isPlainTerminal: false, exited: false, ...extra };
    activeSessions.set(id, s);
    return s;
  }
  /** PTY output, as wireSessionPty buffers and emits it. */
  function output(id, s, data) {
    s.outputBuffer.push(data);
    emit('terminal-data', id, data);
  }
  /** A session window opened for `id`, its page loaded. */
  async function popOut(id) {
    await windows.open(id);
    return created[created.length - 1].win;
  }
  const take = (wc) => wc.sent.splice(0);
  const data = (wc) => wc.sent.filter(([channel]) => channel === 'terminal-data');
  const loadWith = (fn) => { load = fn; };
  return { windows, main, mainWindow, activeSessions, sessionNotices, created, forward, logged, loadWith, emit, session, output, popOut, take, data };
}

test('output of a popped-out session goes only to its window', async () => {
  const { windows, main, session, output, popOut, emit, take, data } = setup();
  const s1 = session('s1');
  const s2 = session('s2');
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  take(main);
  take(win.webContents);

  output('s1', s1, 'one');
  output('s2', s2, 'two');
  assert.deepEqual(data(main), [['terminal-data', 's2', 'two']]);
  assert.deepEqual(data(win.webContents), [['terminal-data', 's1', 'one']]);
  assert.equal(windows.routesAway('terminal-data', ['s1', 'one']), true);
  assert.equal(windows.routesAway('terminal-data', ['s2', 'two']), false);

  // The IDE events of a session follow its output: only to its window.
  take(main);
  take(win.webContents);
  emit('mcp-open-diff', 's1', 'd1', { file: 'a.js' });
  emit('mcp-open-file', 's1', { file: 'a.js' });
  emit('mcp-close-tab', 's1', 'd1');
  emit('mcp-close-all-diffs', 's1');
  emit('mcp-diff-resolved', 's1', 'd1', 'accept');
  emit('mcp-close-all-diffs', 's2');
  assert.deepEqual(ROUTED_CHANNELS, ['terminal-data', 'mcp-open-diff', 'mcp-open-file', 'mcp-close-tab', 'mcp-close-all-diffs', 'mcp-diff-resolved']);
  assert.deepEqual(take(main), [['mcp-close-all-diffs', 's2']]);
  assert.deepEqual(take(win.webContents).map(([channel]) => channel), ROUTED_CHANNELS.slice(1));

  // Other events still reach the main window, and the session window too when it lives on them.
  emit('cli-busy-state', 's1', true);
  assert.deepEqual(take(main), [['cli-busy-state', 's1', true]]);
  assert.deepEqual(take(win.webContents), [['cli-busy-state', 's1', true]]);
});

test('a reattach from the window takes ownership and replays to it once', async () => {
  const { windows, main, session, popOut, take, data } = setup();
  const s1 = session('s1', { altScreen: true, outputBuffer: ['a', 'b'] });
  const win = await popOut('s1');
  take(main);

  assert.equal(windows.ownerOf(s1), null);
  windows.reattach('s1', s1, win.webContents);
  assert.equal(windows.ownerOf(s1), win.webContents);
  assert.equal(windows.windowFor('s1'), win);
  assert.deepEqual(data(win.webContents), [
    ['terminal-data', 's1', '\x1b[?1049h'],
    ['terminal-data', 's1', 'a'],
    ['terminal-data', 's1', 'b'],
    ['terminal-data', 's1', '\x1b[?25l'],
  ]);
  assert.deepEqual(data(main), [], 'the main window gets no replay');
  // Each window hears whether the session is its own now.
  assert.deepEqual(take(main), [['session-owner-changed', 's1', 'window', false]]);
  assert.deepEqual(take(win.webContents).filter(([channel]) => channel === 'session-owner-changed'), [['session-owner-changed', 's1', 'window', true]]);
  // Taking it again changes nothing.
  assert.equal(windows.takeOwnership(s1, win.webContents), false);
  assert.deepEqual(take(main), []);

  // A remote reattach (the phone, a schedule: no window) replays to the
  // window that owns it, and the owner stays.
  assert.equal(windows.reattach('s1', s1, null), win.webContents);
  assert.equal(windows.ownerOf(s1), win.webContents);
  assert.deepEqual(take(win.webContents), [
    ['terminal-data', 's1', '\x1b[?1049h'],
    ['terminal-data', 's1', 'a'],
    ['terminal-data', 's1', 'b'],
    ['terminal-data', 's1', '\x1b[?25l'],
  ], 'one replay, and no session-owner-changed');
  assert.deepEqual(take(main), []);

  // The main window takes it back: the replay is its own, and the window,
  // left with no session, closes.
  windows.reattach('s1', s1, main);
  assert.equal(windows.ownerOf(s1), null);
  assert.deepEqual(take(main), [
    ['session-owner-changed', 's1', 'main', true],
    ['terminal-data', 's1', '\x1b[?1049h'],
    ['terminal-data', 's1', 'a'],
    ['terminal-data', 's1', 'b'],
    ['terminal-data', 's1', '\x1b[?25l'],
  ]);
  assert.deepEqual(take(win.webContents), [['session-owner-changed', 's1', 'main', false]]);
  assert.equal(win.closed, true);
});

test('resize and close from a window that is not the owner are ignored and a remote call is allowed', async () => {
  const { windows, main, session, popOut } = setup();
  const s1 = session('s1', { isPlainTerminal: true });
  const s2 = session('s2', { isPlainTerminal: true });
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  const other = await popOut('s2');
  windows.reattach('s2', s2, other.webContents);
  const s3 = session('s3', { isPlainTerminal: true });

  assert.equal(windows.mayControl(s1, win.webContents), true);
  assert.equal(windows.mayControl(s1, main), false);
  assert.equal(windows.mayControl(s1, other.webContents), false);
  assert.equal(windows.mayControl(s1, null), true, 'a remote call has no window');
  assert.equal(windows.mayControl(s3, main), true);
  assert.equal(windows.mayControl(s3, win.webContents), false);

  // main.js's terminal-resize and close-terminal handlers, run against these windows.
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const code = source.slice(source.indexOf('// --- IPC: terminal-resize'), source.indexOf('// --- Plain-terminal activity'));
  const handlers = {};
  const resized = [];
  const fanned = [];
  for (const s of [s1, s3]) s.pty = { resize: (cols, rows) => resized.push([s === s1 ? 's1' : 's3', cols, rows]) };
  vm.runInContext(code, vm.createContext({
    ipcMain: { on: (channel, fn) => { handlers[channel] = fn; } },
    activeSessions: new Map([['s1', s1], ['s3', s3]]),
    sessionWindows: windows,
    terminalFanout: { resized: (s, cols, rows) => fanned.push([cols, rows]) },
    setTimeout: () => 0,
  }));
  handlers['terminal-resize']({ sender: main }, 's1', 80, 24);
  handlers['terminal-resize']({ sender: other.webContents }, 's1', 81, 24);
  assert.deepEqual(resized, [], 'only the owner sizes the PTY');
  assert.equal(s1.desktopSize, undefined);
  handlers['terminal-resize']({ sender: win.webContents }, 's1', 120, 40);
  handlers['terminal-resize'](null, 's1', 100, 30);
  handlers['terminal-resize']({ sender: main }, 's3', 90, 20);
  assert.deepEqual(resized, [['s1', 120, 40], ['s1', 100, 30], ['s3', 90, 20]]);
  assert.deepEqual(fanned, [[120, 40], [100, 30], [90, 20]]);

  s1.rendererAttached = true;
  handlers['close-terminal']({ sender: main }, 's1');
  assert.equal(s1.rendererAttached, true, 'the main window does not detach a session it does not show');
  handlers['close-terminal'](null, 's1');
  assert.equal(s1.rendererAttached, false);
});

test('closing the window holds output until the main window reattaches', async () => {
  const { windows, main, session, output, popOut, take, data, sessionNotices } = setup();
  const s1 = session('s1', { outputBuffer: ['before'] });
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  windows.viewing(win.webContents, 's1');
  assert.deepEqual(sessionNotices.viewingIds(), ['s1']);
  take(main);

  win.close();
  assert.equal(windows.ownerOf(s1), RETURNING);
  assert.deepEqual(take(main), [
    ['session-owner-changed', 's1', 'returning', false],
    ['remote-viewing', []],
  ]);
  assert.deepEqual(sessionNotices.viewingIds(), [], 'what the window had on screen is no longer seen');

  // Nothing is sent while it is on its way back, not even to a remote reattach.
  const sentToWindow = win.webContents.sent.length;
  output('s1', s1, 'during');
  windows.reattach('s1', s1, null);
  assert.deepEqual(take(main), []);
  assert.equal(win.webContents.sent.length, sentToWindow);
  assert.equal(windows.ownerOf(s1), RETURNING);
  assert.equal(windows.mayControl(s1, main), false, 'not before the main window has it again');

  // The main window reattaches: one replay, with what came meanwhile.
  windows.reattach('s1', s1, main);
  assert.equal(windows.ownerOf(s1), null);
  assert.deepEqual(take(main), [
    ['session-owner-changed', 's1', 'main', true],
    ['terminal-data', 's1', 'before'],
    ['terminal-data', 's1', 'during'],
    ['terminal-data', 's1', '\x1b[?25l'],
  ]);
  output('s1', s1, 'after');
  assert.deepEqual(data(main), [['terminal-data', 's1', 'after']]);
  assert.equal(windows.mayControl(s1, main), true);
});

test('a destroyed owner counts as the main window', async () => {
  const { windows, main, session, output, popOut, take, data } = setup();
  const s1 = session('s1', { outputBuffer: ['x'] });
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  take(main);

  // Gone before any of its events came (they would make it RETURNING: the next test).
  win.webContents.destroyed = true;
  assert.equal(windows.ownerOf(s1), null);
  assert.equal(windows.windowFor('s1'), null);
  assert.equal(windows.routesAway('terminal-data', ['s1', 'y']), false);
  output('s1', s1, 'y');
  assert.deepEqual(data(main), [['terminal-data', 's1', 'y']]);
  assert.equal(windows.mayControl(s1, main), true);
  take(main);
  // A remote reattach replays to the main window, as it always did.
  windows.reattach('s1', s1, null);
  assert.deepEqual(data(main), [['terminal-data', 's1', 'x'], ['terminal-data', 's1', 'y'], ['terminal-data', 's1', '\x1b[?25l']]);
});

test('ownership follows a re-key', async () => {
  const { windows, main, activeSessions, session, popOut, emit, take, data } = setup();
  const s = session('tmp-1');
  const win = await popOut('tmp-1');
  windows.reattach('tmp-1', s, win.webContents);
  take(main);
  take(win.webContents);

  // Codex's transcript appears: the same session object, under its real id.
  activeSessions.delete('tmp-1');
  s.realSessionId = 'real-1';
  activeSessions.set('real-1', s);
  emit('terminal-data', 'real-1', 'out');
  assert.deepEqual(data(main), []);
  assert.deepEqual(data(win.webContents), [['terminal-data', 'real-1', 'out']]);
  assert.equal(windows.windowFor('real-1'), win);

  // Closed, it is on its way back under the id it has now.
  take(main);
  win.close();
  assert.deepEqual(take(main).filter(([channel]) => channel === 'session-owner-changed'), [['session-owner-changed', 'real-1', 'returning', false]]);
});

test('schedule-due and remote events never reach a session window', async () => {
  const { windows, main, session, popOut, emit, take } = setup();
  const s1 = session('s1');
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  take(main);
  take(win.webContents);

  const kept = ['schedule-due', 'updater-event', 'remote-viewing', 'remote-mark-read', 'remote-access-status', 'session-notices-changed', 'window-visibility', 'project-plan-changed'];
  for (const channel of kept) emit(channel, 'x');
  assert.deepEqual(take(win.webContents), []);
  assert.deepEqual(take(main).map(([channel]) => channel), kept);

  // What a session window lives on reaches it.
  for (const channel of SESSION_WINDOW_EVENTS) emit(channel, 's1', true);
  assert.deepEqual(take(win.webContents).map(([channel]) => channel), SESSION_WINDOW_EVENTS);
  assert.deepEqual(SESSION_WINDOW_EVENTS, [
    'projects-changed', 'harnesses-changed', 'global-settings-changed', 'session-detected', 'session-forked',
    'process-exited', 'cli-busy-state', 'cli-subagent-state', 'terminal-notification', 'command-catalog-updated',
    'file-changed', 'session-owner-changed',
  ]);
});

test('a session window opens at the main window\'s size, 24 px down and right, once per session', async () => {
  const { windows, session, created, forward } = setup();
  const s1 = session('s1', { projectPath: '/Users/demo/app', runtime: 'claude' });
  session('t1', { projectPath: '/Users/demo/app', isPlainTerminal: true });
  await windows.open('s1');
  assert.equal(created.length, 1);
  const [{ kind, options, win }] = created;
  assert.equal(kind, 'session');
  assert.deepEqual(options.bounds, { x: 124, y: 74, width: 1200, height: 800 });
  assert.equal(path.basename(win.loaded.file), 'index.html');
  assert.deepEqual(win.loaded.options.query, { sessionWindow: 's1', projectPath: '/Users/demo/app', kind: 'cli', runtime: 'claude' });

  // Again, before and after its page took the session: the same window comes forward.
  await windows.open('s1');
  windows.reattach('s1', s1, win.webContents);
  await windows.open('s1');
  assert.equal(created.length, 1);
  assert.deepEqual(forward, [win, win]);
  assert.equal(windows.focus('s1'), true);
  assert.equal(windows.focus('nope'), false);

  await windows.open('t1');
  assert.deepEqual(created[1].options.bounds, { x: 148, y: 98, width: 1200, height: 800 }, 'a second one does not hide the first');
  assert.deepEqual(created[1].win.loaded.options.query, { sessionWindow: 't1', projectPath: '/Users/demo/app', kind: 'terminal' });
  assert.equal(windows.close('t1'), true);
  assert.equal(created[1].win.closed, true);
  assert.equal(windows.close('t1'), false);
  await windows.open('');
  await windows.open(42);
  assert.equal(created.length, 2);

  // They close with the main window.
  windows.closeAll();
  assert.equal(win.closed, true);
  assert.equal(windows.ownerOf(s1), RETURNING);
});

test('a session window relays its launches, the main window moves the new session to it, and what it shows counts as seen', async () => {
  const { windows, main, session, popOut, take, sessionNotices } = setup();
  const s1 = session('s1');
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  take(main);
  take(win.webContents);

  // A split in the window: the main window starts the session, then hands it over.
  assert.equal(windows.run(win.webContents, 'launchNewSession', [{ id: 'p1' }, { focus: false }]), true);
  assert.deepEqual(take(main), [['session-window-run', 'launchNewSession', [{ id: 'p1' }, { focus: false }], win.webContents.id]]);
  assert.equal(windows.run(win.webContents, 'openRawTerminalSession', ['/Users/demo/app']), true);
  assert.equal(take(main).length, 1);
  assert.equal(windows.run(win.webContents, 'deleteEverything', []), false);
  assert.equal(windows.run(win.webContents, 'launchNewSession', 'not a list'), false);
  assert.equal(windows.run(main, 'launchNewSession', []), false, 'only a session window relays');
  assert.equal(windows.run(null, 'launchNewSession', []), false);
  assert.deepEqual(take(main), []);

  const s2 = session('s2');
  assert.equal(windows.move(main, 's2', win.webContents.id), true);
  assert.deepEqual(take(win.webContents), [['move-session-to-window', 's2']]);
  assert.equal(windows.move(win.webContents, 's2', win.webContents.id), false, 'only the main window moves sessions');
  assert.equal(windows.move(main, 's2', 999), false);
  assert.equal(windows.move(main, '', win.webContents.id), false);
  // The window adopts it by reattaching it.
  windows.reattach('s2', s2, win.webContents);
  assert.equal(windows.ownerOf(s2), win.webContents);

  // The session on the window's screen is seen; the main window hears it as remote-viewing.
  take(main);
  windows.viewing(win.webContents, 's2');
  assert.deepEqual(sessionNotices.viewingIds(), ['s2']);
  assert.deepEqual(take(main), [['remote-viewing', ['s2']]]);
  windows.viewing(main, 's1');
  windows.viewing(null, 's1');
  assert.deepEqual(sessionNotices.viewingIds(), ['s2'], 'only a session window says what it shows');
  windows.viewing(win.webContents, null);
  assert.deepEqual(sessionNotices.viewingIds(), []);

  // The main window takes one back: the window keeps the other, and stays open.
  windows.reattach('s1', s1, main);
  assert.equal(win.closed, false);
  assert.equal(windows.ownerOf(s2), win.webContents);
  // A window that is not a session window is not one.
  assert.equal(windows.isSessionWindow(win.webContents), true);
  assert.equal(windows.isSessionWindow(main), false);
  assert.equal(windows.ownerWindow('s2'), win);
  assert.equal(windows.ownerWindow('s1'), null);
});

test('a session a session window starts is that window\'s; one the main window or a phone starts changes nothing', async () => {
  const { windows, main, session, popOut, take } = setup();
  const s1 = session('s1');
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  take(main);
  take(win.webContents);

  // open-terminal's spawn path: a fresh session object, then takeOwnership.
  const fromMain = session('new-main');
  assert.equal(windows.takeOwnership(fromMain, main), false);
  const fromPhone = session('new-phone');
  assert.equal(windows.takeOwnership(fromPhone, null), false);
  assert.equal(windows.ownerOf(fromMain), null);
  assert.equal(windows.ownerOf(fromPhone), null);
  assert.deepEqual(take(main), [], 'nothing is emitted');
  assert.deepEqual(take(win.webContents), []);

  const fromWindow = session('new-window');
  assert.equal(windows.takeOwnership(fromWindow, win.webContents), true);
  assert.equal(windows.ownerOf(fromWindow), win.webContents);
  assert.deepEqual(take(main), [['session-owner-changed', 'new-window', 'window', false]]);
  assert.deepEqual(take(win.webContents), [['session-owner-changed', 'new-window', 'window', true]]);
});

test('a window whose page is gone holds its sessions at once, before its closed event', async () => {
  const { windows, main, session, output, popOut, take, data } = setup();
  const s1 = session('s1');
  const win = await popOut('s1');
  windows.reattach('s1', s1, win.webContents);
  take(main);

  // Electron destroys the webContents; the window's closed event has not come yet.
  win.webContents.destroy();
  assert.equal(win.closed, false);
  assert.equal(windows.ownerOf(s1), RETURNING);
  assert.deepEqual(take(main), [['session-owner-changed', 's1', 'returning', false]]);
  output('s1', s1, 'meanwhile');
  assert.deepEqual(data(main), [], 'no output streams to the main window');
  assert.equal(windows.mayControl(s1, main), false);

  // The closed event that follows changes nothing more.
  win.close();
  assert.deepEqual(take(main), []);
  assert.equal(windows.ownerOf(s1), RETURNING);
});

test('a window whose page does not load is closed and logged, and the next open makes a new one', async () => {
  const { windows, session, created, forward, logged, loadWith } = setup();
  session('s1');
  loadWith(() => Promise.reject(new Error('ERR_FILE_NOT_FOUND')));
  await windows.open('s1');
  assert.equal(created.length, 1);
  assert.equal(created[0].win.closed, true);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /could not load the window of s1: ERR_FILE_NOT_FOUND/);
  assert.equal(windows.windowFor('s1'), null);
  assert.equal(windows.focus('s1'), false);

  // Closed while its page loaded: nothing to log, nothing left behind.
  loadWith((w) => { w.close(); return Promise.reject(new Error('ERR_ABORTED')); });
  await windows.open('s1');
  assert.equal(created.length, 2);
  assert.equal(logged.length, 1);
  assert.equal(windows.windowFor('s1'), null);

  loadWith(() => Promise.resolve());
  await windows.open('s1');
  assert.equal(created.length, 3);
  assert.equal(created[2].win.closed, false);
  assert.equal(windows.windowFor('s1'), created[2].win);
  assert.deepEqual(forward, []);
});
