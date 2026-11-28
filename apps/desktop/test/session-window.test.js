// A session in a window of its own: the window's side (public/session-window.js)
// and the main window's (public/session-window-host.js), run in a vm around
// fake terminals and a stubbed page. Main's side is test/session-windows.test.js.
//
// The traps the spike found (task 0): a terminal that reattaches a live session
// gets the session's buffer replayed, and xterm answers again every terminal
// query in it (cursor position, device attributes), typing stale replies into
// the program; and the window that lost a session must answer nothing more.
// The replay's chunks can come after open-terminal's answer (in the app, a
// session window got 1 of 229 before it): the end of the replay is main's own
// event, terminal-replayed, sent after the chunks on the same path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
// Objects made inside the vm have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

const APP = '/Users/demo/app';
const leaf = id => ({ session: id });
const split = (kind, a, b) => ({ split: kind, ratio: 0.5, a, b });

/** A console whose warnings are kept, to check that a failure says why. */
function warningConsole() {
  const warnings = [];
  return { warnings, console: { ...console, warn: (...args) => warnings.push(args.map(String).join(' ')) } };
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
}

function classes() {
  const set = new Set();
  return {
    add: (...names) => names.forEach(n => set.add(n)),
    remove: (...names) => names.forEach(n => set.delete(n)),
    toggle: (name, on = !set.has(name)) => (on ? set.add(name) : set.delete(name), on),
    contains: name => set.has(name),
  };
}

/** An element with what these files touch: classes, children, listeners and text. */
function element(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), className: '', textContent: '', type: '', title: '', id: '',
    classList: classes(), children: [], parentNode: null, listeners: {}, focused: 0,
    rect: { width: 800, height: 600 },
    getBoundingClientRect() { return el.rect; },
    appendChild(child) {
      child.remove?.();
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    append(...kids) { kids.forEach(kid => el.appendChild(kid)); },
    remove() {
      if (!el.parentNode) return;
      el.parentNode.children = el.parentNode.children.filter(child => child !== el);
      el.parentNode = null;
    },
    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
    dispatch(type) {
      let stopped = false;
      for (const fn of el.listeners[type] || []) fn({ stopPropagation: () => { stopped = true; }, preventDefault() {} });
      return stopped;
    },
    click() { el.dispatch('click'); },
    focus() { el.focused++; },
    contains: () => false,
    setAttribute(name, value) { el[name] = value; },
    find(className) {
      for (const child of el.children) {
        if (child.className.split(' ').includes(className)) return child;
        const found = child.find(className);
        if (found) return found;
      }
      return null;
    },
  };
  return el;
}

/**
 * An xterm with what the files use; its writes wait until parse() is called,
 * as xterm parses later. As xterm 6's, resize does nothing for an unchanged
 * size, and only a change reaches onResize.
 */
function fakeTerminal(log, { cols = 120, rows = 40 } = {}) {
  const pending = [];
  const resized = [];
  const terminal = {
    options: { disableStdin: false },
    cols,
    rows,
    textarea: element('textarea'),
    reset: () => log.push(['reset']),
    write: (data, done) => pending.push({ data, done }),
    focus() {},
    resize(newCols, newRows) {
      if (newCols === terminal.cols && newRows === terminal.rows) return;
      terminal.cols = newCols;
      terminal.rows = newRows;
      [...resized].forEach(fn => fn({ cols: newCols, rows: newRows }));
    },
    onResize(fn) {
      resized.push(fn);
      return { dispose: () => resized.splice(resized.indexOf(fn), 1) };
    },
    parse() {
      while (pending.length) pending.shift().done?.();
    },
    pending,
  };
  return terminal;
}

function terminalEntry(id, log, extra = {}, size) {
  return {
    session: { sessionId: id, projectPath: APP, runtime: 'claude', ...extra },
    element: element(),
    terminal: fakeTerminal(log, size),
    closed: false,
  };
}

// ---- Every window: the replies a reattach would type again ----

function replayWindow({ live = [] } = {}) {
  const log = [];
  const timers = [];
  const listeners = {};
  const { warnings, console } = warningConsole();
  const context = vm.createContext({
    console, Map, Set, JSON, Promise, URLSearchParams,
    location: { search: '' },
    document: { body: element('body'), addEventListener() {} },
    localStorage: memoryStorage(),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    activePtyIds: new Set(live),
    openSessions: new Map(),
    flushTerminalBuffer: id => log.push(['flush', id]),
  });
  context.window = context;
  context.api = { onTerminalReplayed: fn => { listeners.replayed = fn; } };
  vm.runInContext(read('session-window.js'), context);
  return { context, log, timers, listeners, warnings };
}

test('a reattach answers nothing until xterm has read the whole replay', () => {
  const { context, log, listeners } = replayWindow({ live: ['S1'] });
  const entry = terminalEntry('S1', log);
  context.openSessions.set('S1', entry);
  // createTerminalEntry's hook: the session is live, so a replay is coming.
  context.beginTerminalReplay(entry);
  assert.equal(entry.terminal.options.disableStdin, true);
  // open-terminal answered before the replay's chunks came in: still waiting for them.
  context.endTerminalReplay(entry, { ok: true, reattached: true });
  assert.deepEqual(log, []);
  assert.equal(entry.terminal.options.disableStdin, true);
  // The end of the replay: what is buffered is written now, and read before the terminal answers again.
  listeners.replayed('S1');
  assert.deepEqual(log, [['flush', 'S1']]);
  assert.equal(entry.terminal.options.disableStdin, true, 'still reading the replay');
  entry.terminal.parse();
  assert.equal(entry.terminal.options.disableStdin, false, 'live output is answered again');
  assert.equal(entry.replaying, false);
});

test('a replay that ends before open-terminal answers is read the same way', () => {
  const { context, log, listeners } = replayWindow({ live: ['S1'] });
  const entry = terminalEntry('S1', log);
  context.openSessions.set('S1', entry);
  context.beginTerminalReplay(entry);
  listeners.replayed('S1');
  entry.terminal.parse();
  assert.equal(entry.terminal.options.disableStdin, false);
  context.endTerminalReplay(entry, { ok: true, reattached: true });
  assert.deepEqual(log, [['flush', 'S1']], 'the answer changes nothing more');
  assert.equal(entry.terminal.options.disableStdin, false);
  // A replay this window did not wait for (a phone's reattach) holds nothing.
  const other = terminalEntry('S2', log);
  context.openSessions.set('S2', other);
  listeners.replayed('S2');
  assert.deepEqual(log, [['flush', 'S1']]);
  assert.equal(other.terminal.pending.length, 0);
});

test('a new session, or one that started instead of reattaching, answers at once', () => {
  const { context, log } = replayWindow({ live: ['S1'] });
  // A new session: nothing is replayed, its CLI's first queries are answered.
  const fresh = terminalEntry('N1', log);
  context.beginTerminalReplay(fresh);
  assert.equal(fresh.terminal.options.disableStdin, false);
  context.endTerminalReplay(fresh, { ok: true });
  assert.deepEqual(log, []);
  // It had ended meanwhile: main started it again, with no replay.
  const ended = terminalEntry('S1', log);
  context.beginTerminalReplay(ended);
  context.endTerminalReplay(ended, { ok: true, reattached: false });
  assert.equal(ended.terminal.options.disableStdin, false);
  assert.deepEqual(log, []);
});

test('a window adopting a session it does not know is live yet holds its replies too', () => {
  const { context, log, timers } = replayWindow();
  const entry = terminalEntry('M1', log);
  vm.runInContext("replayExpected.add('M1')", context);
  context.beginTerminalReplay(entry);
  assert.equal(entry.terminal.options.disableStdin, true);
  // A reattach that never answers does not keep the terminal mute for good.
  const limit = timers.at(-1);
  assert.equal(limit.ms, vm.runInContext('REPLAY_HOLD_MS', context));
  limit.fn();
  assert.equal(entry.terminal.options.disableStdin, false);
});

test('a shadow answers nothing, before a replay or after it', () => {
  const { context, log, listeners } = replayWindow({ live: ['S1'] });
  const entry = terminalEntry('S1', log);
  context.openSessions.set('S1', entry);
  entry.shadow = true;
  context.muteTerminalInput(entry);
  assert.equal(entry.terminal.options.disableStdin, true);
  context.beginTerminalReplay(entry);
  context.endTerminalReplay(entry, { ok: true, reattached: true });
  listeners.replayed('S1');
  entry.terminal.parse();
  assert.equal(entry.terminal.options.disableStdin, true, 'the replay ended, the session is still elsewhere');
  entry.shadow = false;
  context.muteTerminalInput(entry);
  assert.equal(entry.terminal.options.disableStdin, false);
});

test('a terminal whose replies cannot be held says so', () => {
  const { context, log, warnings } = replayWindow({ live: ['S1'] });
  const entry = terminalEntry('S1', log);
  Object.defineProperty(entry.terminal, 'options', { get() { throw new Error('terminal disposed'); } });
  context.beginTerminalReplay(entry);
  assert.match(warnings.join('\n'), /terminal disposed/);
});

// ---- The main window ----

/** session-window.js and session-window-host.js in the main window, with `ids` open here. */
function mainWindow({ ids = ['S1'], live = ids, closes = true, storage = memoryStorage(), tabStorage = memoryStorage(), setup } = {}) {
  const log = [];
  const listeners = {};
  const { warnings, console } = warningConsole();
  const on = name => fn => { listeners[name] = fn; };
  const entries = new Map(ids.map(id => [id, terminalEntry(id, log)]));
  const api = {
    openTerminal: async (...args) => {
      log.push(['openTerminal', ...plain(args)]);
      return { ok: true, reattached: true, mcpActive: true };
    },
    resizeTerminal: (...args) => log.push(['resize', ...args]),
    openSessionWindow: async id => log.push(['open', id]),
    focusSessionWindow: async id => { log.push(['focus', id]); return true; },
    closeSessionWindow: async id => { log.push(['close', id]); return closes; },
    moveSessionToWindow: async (...args) => { log.push(['move', ...args]); return true; },
    onSessionOwnerChanged: on('owner'),
    onSessionWindowRun: on('run'),
    onProcessExited: on('exited'),
    onSessionDetected: on('detected'),
    onSessionForked: on('forked'),
    onTerminalReplayed: on('replayed'),
  };
  const context = vm.createContext({
    console, Map, Set, JSON, Promise, URLSearchParams, Object, Array,
    location: { search: '' },
    document: { body: element('body'), activeElement: null, createElement: element, addEventListener() {} },
    localStorage: storage,
    sessionStorage: tabStorage,
    setTimeout: () => 0,
    clearTimeout: () => {},
    cancelAnimationFrame: () => {},
    activePtyIds: new Set(live),
    activeSessionId: ids[0],
    openSessions: entries,
    sessionMap: new Map([...entries].map(([id, entry]) => [id, entry.session])),
    terminalWriteBuffers: new Map(),
    flushTerminalBuffer: id => log.push(['flush', id]),
    setSessionMcpActive: (id, on) => log.push(['mcp', id, on]),
    safeFit: () => log.push(['fit']),
    refreshTileHeaderButtons: () => {},
    ICONS: { popOut: () => '<svg></svg>' },
  });
  context.window = context;
  context.api = api;
  setup?.(context);
  vm.runInContext(read('session-window.js'), context);
  vm.runInContext(read('session-window-host.js'), context);
  return { context, log, listeners, entries, warnings };
}

const texts = el => [el.textContent, ...el.children.flatMap(texts)].filter(Boolean);

test('a session that moves to a window leaves a quiet shadow here under its placeholder', async () => {
  const { listeners, entries, log } = mainWindow();
  const entry = entries.get('S1');
  listeners.owner('S1', 'window', false);
  assert.equal(entry.shadow, true);
  assert.equal(entry.terminal.options.disableStdin, true, 'the shadow answers nothing');
  assert.ok(entry.element.classList.contains('popped-out'));
  const placeholder = entry.element.find('session-popout-placeholder');
  assert.ok(placeholder, 'the placeholder is in the container, wherever the container is');
  assert.deepEqual(texts(placeholder), ['In its own window', 'Bring back', 'Show window']);
  // Nothing dropped on it reaches the session.
  assert.equal(placeholder.dispatch('drop'), true);
  // Shown again by a second move, it is still one placeholder.
  listeners.owner('S1', 'window', false);
  assert.equal(entry.element.children.filter(el => el.className === 'session-popout-placeholder').length, 1);
  placeholder.find('session-popout-show').click();
  await settle();
  assert.deepEqual(log, [['focus', 'S1']]);
});

test('a session that comes back is reset, reattached quietly and sized to its terminal here', async () => {
  const { listeners, entries, log } = mainWindow();
  const entry = entries.get('S1');
  listeners.owner('S1', 'window', false);
  log.length = 0;
  // Its window closed.
  listeners.owner('S1', 'returning', false);
  await settle();
  assert.deepEqual(log, [
    ['reset'],
    ['openTerminal', 'S1', APP, false, null],
    ['mcp', 'S1', true],
    ['fit'],
    ['resize', 'S1', 120, 40],
  ]);
  listeners.replayed('S1');
  assert.deepEqual(log.at(-1), ['flush', 'S1']);
  assert.equal(entry.shadow, false);
  assert.ok(!entry.element.classList.contains('popped-out'));
  assert.equal(entry.element.find('session-popout-placeholder'), null);
  assert.equal(entry.terminal.options.disableStdin, true, 'reading the replay');
  entry.terminal.parse();
  assert.equal(entry.terminal.options.disableStdin, false);
});

test('a plain terminal comes back with its folder, project and track', async () => {
  const { listeners, entries, log } = mainWindow();
  Object.assign(entries.get('S1').session, { type: 'terminal', projectId: 'p', trackId: 't' });
  listeners.owner('S1', 'returning', false);
  await settle();
  assert.deepEqual(log[1], ['openTerminal', 'S1', APP, true, { type: 'terminal', projectId: 'p', trackId: 't' }]);
});

test('Bring back closes the window; with no window left it reattaches here', async () => {
  const closing = mainWindow();
  closing.listeners.owner('S1', 'window', false);
  closing.entries.get('S1').element.find('session-popout-back').click();
  await settle();
  assert.deepEqual(closing.log, [['close', 'S1']], 'the window closing brings it back (returning)');

  const gone = mainWindow({ closes: false });
  gone.listeners.owner('S1', 'window', false);
  // It had ended here once (its exit banner) before its window resumed it.
  gone.entries.get('S1').closed = true;
  await gone.context.bringBackSession('S1');
  assert.deepEqual(gone.log.map(call => call[0]), ['close', 'reset', 'openTerminal', 'mcp', 'fit', 'resize']);
  assert.equal(gone.entries.get('S1').closed, false, 'its terminal here is the live one again');
});

test('a shadow under its placeholder holds no WebGL context here', () => {
  const { context, listeners, entries, log } = mainWindow({ ids: ['S1', 'S2'] });
  context.terminalGpu = { hold: (id, held, terminal) => log.push(['gpu', id, held, terminal === entries.get(id).terminal]) };
  listeners.owner('S1', 'window', false);
  assert.deepEqual(log, [['gpu', 'S1', true, true]]);
  listeners.owner('S1', 'main', true);
  assert.deepEqual(log.at(-1), ['gpu', 'S1', false, true]);
  // Ended in its window: the terminal here shows how, so it draws again.
  listeners.owner('S2', 'window', false);
  log.length = 0;
  listeners.exited('S2', 1, null, false);
  assert.deepEqual(log, [['gpu', 'S2', false, true]]);
});

test('the main window takes a session back, or loses it to its end, and the placeholder goes', () => {
  const { listeners, entries } = mainWindow({ ids: ['S1', 'S2'] });
  listeners.owner('S1', 'window', false);
  listeners.owner('S2', 'window', false);
  listeners.owner('S1', 'main', true);
  assert.equal(entries.get('S1').shadow, false);
  assert.ok(!entries.get('S1').element.classList.contains('popped-out'));
  listeners.exited('S2', 1, null, false);
  assert.equal(entries.get('S2').shadow, false, 'a session that ended is in no window');
  assert.equal(entries.get('S2').element.find('session-popout-placeholder'), null);
});

test('the menus offer Open in new window, or Show window and Bring back', async () => {
  const { context, listeners, log } = mainWindow();
  const labels = session => plain(context.sessionWindowMenuItems(session)).map(item => item.label);
  const session = context.sessionMap.get('S1');
  assert.deepEqual(labels(session), ['Open in new window']);
  context.sessionWindowMenuItems(session)[0].onClick();
  await settle();
  assert.deepEqual(log, [['open', 'S1']]);
  listeners.owner('S1', 'window', false);
  assert.deepEqual(labels(session), ['Show window', 'Bring back']);
  assert.deepEqual(labels({ ...session, archived: 1 }), []);
  assert.deepEqual(labels(null), []);
});

test('a session window\'s split starts here, unseen, and moves to the window', async () => {
  const { context, listeners, log } = mainWindow();
  context.launchNewSession = async (project, options, opts) => {
    log.push(['launch', plain(project), plain(options), plain(opts)]);
    return 'N1';
  };
  await listeners.run('launchNewSession', [{ projectPath: APP, projectId: 'p' }, { runtime: 'codex' }, { focus: true }], 7);
  assert.deepEqual(log, [
    ['launch', { projectPath: APP, projectId: 'p' }, { runtime: 'codex' }, { focus: false }],
    ['move', 'N1', 7],
  ]);

  log.length = 0;
  context.openRawTerminalSession = async (session, opts) => {
    log.push(['terminal', session.sessionId, plain(opts)]);
    return { ok: session.sessionId === 'T2' };
  };
  context.loadProjects = () => log.push(['lists']);
  await listeners.run('openRawTerminalSession', [{ sessionId: 'T2', type: 'terminal', projectPath: APP }, { show: true }], 7);
  await listeners.run('openRawTerminalSession', [{ sessionId: 'T3', type: 'terminal', projectPath: APP }, { show: false }], 7);
  await listeners.run('openSession', [{ sessionId: 'S9' }], 7);
  assert.deepEqual(log, [
    ['terminal', 'T2', { show: false }], ['lists'], ['move', 'T2', 7],
    ['terminal', 'T3', { show: false }],
  ]);
});

test('a terminal started here for a session window waits for its first fit when it comes back hidden', async () => {
  const { context, listeners, log } = mainWindow({ ids: ['T2'] });
  const laidOut = context.openSessions.get('T2');
  context.launchNewSession = async () => {
    const entry = terminalEntry('N1', log, {}, { cols: 80, rows: 24 });
    entry.element.rect = { width: 0, height: 0 };
    context.openSessions.set('N1', entry);
    context.sessionMap.set('N1', entry.session);
    context.activePtyIds.add('N1');
    return 'N1';
  };
  context.openRawTerminalSession = async () => ({ ok: true });
  context.loadProjects = () => {};
  await listeners.run('launchNewSession', [{ projectPath: APP }, {}, {}], 7);
  await listeners.run('openRawTerminalSession', [{ sessionId: 'T2', type: 'terminal', projectPath: APP }, {}], 7);
  assert.equal(context.openSessions.get('N1').unfitted, true);
  assert.equal(laidOut.unfitted, undefined, 'a terminal it already had keeps counting as laid out');
  log.length = 0;
  listeners.owner('N1', 'window', false);
  listeners.owner('N1', 'returning', false);
  await settle();
  assert.ok(!log.some(call => call[0] === 'resize'));
});

test('a session whose id changes is found under its new id by a window opening for the old one', () => {
  const { context, listeners } = mainWindow();
  listeners.detected('N1', 'R1');
  listeners.forked('R1', 'F1');
  assert.equal(context.currentSessionId('N1'), 'F1');
  assert.equal(context.currentSessionId('S1'), 'S1');
});

test('a session that cannot come back says why, in its terminal here', async () => {
  const { context, listeners, entries, log, warnings } = mainWindow();
  context.api.openTerminal = async () => ({ ok: false, error: 'project directory no longer exists' });
  const entry = entries.get('S1');
  listeners.owner('S1', 'window', false);
  listeners.owner('S1', 'returning', false);
  await settle();
  assert.ok(entry.terminal.pending.some(write => write.data.includes('Error: project directory no longer exists')));
  assert.equal(entry.closed, true);
  assert.equal(entry.shadow, false, 'the error is in sight, not under the placeholder');
  assert.equal(entry.element.find('session-popout-placeholder'), null);
  assert.equal(entry.terminal.options.disableStdin, false);
  assert.ok(!log.some(call => call[0] === 'resize'), 'no size for a session that is not here');
  assert.match(warnings.join('\n'), /Bring back.*S1.*project directory no longer exists/);
});

// A session brought back while it is not on screen here: the PTY still has its
// window's size (wider: that window has no sidebar). The terminal here keeps
// the size its layout last gave it, and the fit that shows it again, to that
// same size, does nothing in xterm: the PTY must take that size at once.
test('Bring back sizes the PTY from the terminal here, also while it is hidden', async () => {
  const { context, listeners, entries, log } = mainWindow();
  const entry = entries.get('S1');
  entry.element.rect = { width: 0, height: 0 };
  listeners.owner('S1', 'window', false);
  listeners.owner('S1', 'returning', false);
  await settle();
  assert.deepEqual(log.map(call => call[0]), ['reset', 'openTerminal', 'mcp', 'resize']);
  assert.deepEqual(log.at(-1), ['resize', 'S1', 120, 40]);
  // Shown later: its fit finds the size it has, and xterm does nothing more.
  context.safeFit = target => target.terminal.resize(120, 40);
  context.safeFit(entry);
  assert.deepEqual(log.at(-1), ['resize', 'S1', 120, 40]);
});

test('a terminal made here for a session that comes back hidden waits for its first fit', async () => {
  const { context, listeners, log } = mainWindow({ ids: [] });
  // Opened in its window from a list: the main window never had a terminal of it.
  const session = { sessionId: 'W1', projectPath: APP, runtime: 'claude' };
  context.sessionMap.set('W1', session);
  context.activePtyIds.add('W1');
  context.createTerminalEntry = made => {
    const entry = terminalEntry(made.sessionId, log, {}, { cols: 80, rows: 24 });
    entry.element.rect = { width: 0, height: 0 };
    // terminal-manager.js sizes the PTY on a change of size, unless it is a shadow.
    entry.terminal.onResize(({ cols, rows }) => { if (!entry.shadow) context.api.resizeTerminal(made.sessionId, cols, rows); });
    context.openSessions.set(made.sessionId, entry);
    return entry;
  };
  listeners.owner('W1', 'window', false);
  listeners.owner('W1', 'returning', false);
  await settle();
  assert.ok(!log.some(call => call[0] === 'resize'), "xterm's starting size is no layout's");
  // Its first fit changes that size, and the PTY follows.
  context.openSessions.get('W1').terminal.resize(150, 45);
  assert.deepEqual(log.at(-1), ['resize', 'W1', 150, 45]);
  // Fitted once, it counts as laid out: another hidden return sizes the PTY from it.
  log.length = 0;
  listeners.owner('W1', 'window', false);
  listeners.owner('W1', 'returning', false);
  await settle();
  assert.deepEqual(log.at(-1), ['resize', 'W1', 150, 45]);
});

test('a session resumed in a window is live there: its ended terminal here is not reopened over it', () => {
  const { listeners, entries } = mainWindow();
  // It had died here (its exit banner), and its window resumed it.
  entries.get('S1').closed = true;
  listeners.owner('S1', 'window', false);
  assert.equal(entries.get('S1').closed, false);
});

test('the window layouts an earlier run left go when the main window first loads; its reload keeps them', () => {
  const storage = memoryStorage();
  const tabStorage = memoryStorage();
  let store;
  const setup = context => {
    vm.runInContext(read('tile-layout-model.js'), context);
    store = vm.runInContext('createTileStore(localStorage)', context);
    context.tileStore = () => store;
  };
  const before = context => {
    setup(context);
    store.set('home', split('row', leaf('A'), leaf('B')), 'main');
    store.set('old', split('row', leaf('X'), leaf('Y')), 'window:X');
  };
  mainWindow({ storage, tabStorage, setup: before });
  assert.deepEqual(plain(store.all().map(l => [l.id, l.scope])), [['home', 'main']]);
  // A reload of the same window: the session windows it has are still open.
  store.set('live', split('row', leaf('X'), leaf('Z')), 'window:X');
  mainWindow({ storage, tabStorage, setup });
  assert.deepEqual(plain(store.all().map(l => [l.id, l.scope])), [['home', 'main'], ['live', 'window:X']]);
});

// ---- A closed window's panes come back into the main window's layouts ----

function withLayouts(setup) {
  const harness = mainWindow({ ids: ['A', 'X', 'Y'] });
  const { context, log } = harness;
  vm.runInContext(read('tile-layout-model.js'), context);
  const store = vm.runInContext('createTileStore(localStorage)', context);
  Object.assign(context, {
    tileStore: () => store,
    newTileLayoutId: () => 'layout-new',
    tileState: { layoutId: null, tree: null },
    refreshTileView: () => log.push(['refresh']),
    syncTileLayout: id => log.push(['sync', id]),
  });
  setup(store, context);
  return { ...harness, store };
}


test('closing the window puts its panes in place of the placeholder', async () => {
  const { store, listeners, log } = withLayouts((store, context) => {
    store.set('home', split('row', leaf('A'), leaf('X')), 'main');
    store.set('away', split('col', leaf('X'), leaf('Y')), 'window:X');
    Object.assign(context.tileState, { layoutId: 'home', tree: split('row', leaf('A'), leaf('X')) });
  });
  listeners.owner('X', 'returning', false);
  listeners.owner('Y', 'returning', false);
  await settle();
  assert.deepEqual(plain(store.all().map(l => [l.id, l.scope, l.tree])), [
    ['home', 'main', split('row', leaf('A'), split('col', leaf('X'), leaf('Y')))],
  ]);
  assert.equal(log.filter(call => call[0] === 'refresh').length, 1, 'the layout on screen is drawn again, once');
  assert.equal(log.filter(call => call[0] === 'openTerminal').length, 2, 'both come back');
});

test('a session shown alone gets the window\'s layout as its own', async () => {
  const { store, listeners, log } = withLayouts((store, context) => {
    store.set('away', split('row', leaf('X'), leaf('Y')), 'window:X');
    context.activeSessionId = 'X';
    context.openSessions.get('X').element.classList.add('visible');
  });
  listeners.owner('X', 'returning', false);
  await settle();
  assert.deepEqual(plain(store.all().map(l => [l.id, l.scope, l.tree])), [
    ['layout-new', 'main', split('row', leaf('X'), leaf('Y'))],
  ]);
  assert.deepEqual(log.filter(call => call[0] === 'sync'), [['sync', 'X']]);
});

// ---- The session window ----

/** session-window.js in a window opened for `own`, with stubs for app.js and the page. */
function sessionWindow({ own = 'S1', live = [own], sessions = [own], states = [], storage = memoryStorage(), tabStorage = memoryStorage(), setup } = {}) {
  const log = [];
  const listeners = {};
  const timers = [];
  const { warnings, console } = warningConsole();
  let ready = null;
  const on = name => fn => { listeners[name] = fn; };
  const api = {
    sessionWindowRun: async (name, args) => { log.push(['relay', name, plain(args)]); return name !== 'refused'; },
    getSessionStates: async () => states,
    setSessionWindowViewing: () => {},
    onMoveSessionToWindow: on('moved'),
    onSessionOwnerChanged: on('owner'),
    onProcessExited: on('exited'),
    onTerminalReplayed: on('replayed'),
  };
  const context = vm.createContext({
    console, Map, Set, JSON, Promise, URLSearchParams, Object, Array, Date,
    location: { search: `?sessionWindow=${own}` },
    document: {
      body: element('body'), hidden: false, getElementById: () => null,
      addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') ready = fn; },
    },
    localStorage: storage,
    sessionStorage: tabStorage,
    setTimeout: (fn, ms = 0) => timers.push({ fn, ms }),
    clearTimeout: () => {},
    activePtyIds: new Set(live),
    activeSessionId: null,
    openSessions: new Map(),
    sessionMap: new Map(sessions.map(id => [id, { sessionId: id, projectPath: APP, runtime: 'claude' }])),
    tileState: { scope: 'main' },
    persistedTerminalSessions: () => [],
    openSession: async session => {
      log.push(['open', session.sessionId]);
      context.openSessions.set(session.sessionId, { session, closed: false });
      // openSession ends with showSession, as app.js's does.
      context.window.showSession(session.sessionId);
    },
    showSession: id => log.push(['show', id]),
    launchNewSession: async () => { throw new Error('a session window never starts a session itself'); },
    openRawTerminalSession: async (session, opts) => {
      log.push(['reattach', session.sessionId, plain(opts)]);
      return { ok: true, reattached: true };
    },
    navigateSession: () => log.push(['navigate']),
    removeFromSplit: id => log.push(['unsplit', id]),
    destroySession: (id, opts) => { log.push(['destroy', id, plain(opts)]); context.openSessions.delete(id); },
    placeTileSplit: (...args) => log.push(['place', ...plain(args)]),
    close: () => log.push(['close window']),
  });
  context.window = context;
  context.api = api;
  setup?.(context);
  vm.runInContext(read('session-window.js'), context);
  ready();
  // What waits for the other listeners of an event (app.js's) to run first.
  const later = () => timers.splice(0).filter(timer => !timer.ms).forEach(timer => timer.fn());
  return { context, log, listeners, later, timers, warnings };
}

test('a session window opens its own session and nothing else, in its own layouts', async () => {
  const { context, log } = sessionWindow();
  assert.equal(vm.runInContext('SESSION_WINDOW.sessionId', context), 'S1');
  assert.ok(context.document.body.classList.contains('session-window'));
  await context.startSessionWindow();
  assert.deepEqual(log, [['open', 'S1'], ['show', 'S1']]);
  assert.equal(context.tileState.scope, 'window:S1');
  // Cmd+Shift+[ / ] and Cmd+Arrows would open the sidebar's other sessions here.
  context.navigateSession(1);
  assert.deepEqual(log, [['open', 'S1'], ['show', 'S1']]);
});

test('a session window drops a layout an earlier window of its session left; its reload keeps it', async () => {
  const storage = memoryStorage();
  const tabStorage = memoryStorage();
  let store;
  const setup = context => {
    vm.runInContext(read('tile-layout-model.js'), context);
    store = vm.runInContext('createTileStore(localStorage)', context);
    context.tileStore = () => store;
  };
  const first = sessionWindow({ storage, tabStorage, setup });
  store.set('old', split('row', leaf('S1'), leaf('S7')), 'window:S1');
  store.set('other', split('row', leaf('S2'), leaf('S3')), 'window:S2');
  await first.context.startSessionWindow();
  assert.deepEqual(store.all().map(l => l.id), ['other'], 'only its own scope goes');
  // The same window reloaded (its sessionStorage stays): its layout is its own.
  store.set('mine', split('row', leaf('S1'), leaf('S8')), 'window:S1');
  const reloaded = sessionWindow({ storage, tabStorage, setup });
  await reloaded.context.startSessionWindow();
  assert.deepEqual(store.all().map(l => l.id).sort(), ['mine', 'other']);
});

test('a session window opens its session under the id it has now, or closes when it is gone', async () => {
  const storage = memoryStorage({ 'sessionRekeys.v1': JSON.stringify([['N1', 'R1']]) });
  const states = [{ sessionId: 'R1', type: 'cli', runtime: 'codex', projectPath: APP, projectId: 'p', trackId: null, exited: false }];
  const rekeyed = sessionWindow({ own: 'N1', live: ['R1'], sessions: [], states, storage });
  await rekeyed.context.startSessionWindow();
  assert.deepEqual(rekeyed.log[0], ['open', 'R1'], 'not a new session under the old id');
  assert.equal(rekeyed.context.sessionMap.get('R1').runtime, 'codex');

  const gone = sessionWindow({ own: 'N2', live: [], sessions: [] });
  await gone.context.startSessionWindow();
  assert.deepEqual(gone.log, [['close window']]);
});

test('a split in a session window is started by the main window and adopted here before it is placed', async () => {
  const states = [{ sessionId: 'N1', type: 'cli', runtime: 'codex', projectPath: APP, projectId: 'p', trackId: null, exited: false }];
  const { context, log, listeners } = sessionWindow({ states });
  const started = context.launchNewSession({ projectPath: APP, projectId: 'p' }, { runtime: 'codex' }, { focus: false });
  await settle();
  assert.deepEqual(log, [['relay', 'launchNewSession', [{ projectPath: APP, projectId: 'p' }, { runtime: 'codex' }, { focus: false }]]]);
  await listeners.moved('N1');
  assert.equal(await started, 'N1');
  // Adopted without being shown: splitSession places it, and showing it is placeTileSplit's.
  assert.deepEqual(log.slice(1), [['open', 'N1']]);
  assert.equal(context.sessionMap.get('N1').runtime, 'codex');

  // A launch that asks for the focus shows the session once it is here.
  const shown = context.launchNewSession({ projectPath: APP }, { runtime: 'claude' });
  await settle();
  states.push({ sessionId: 'N2', type: 'cli', runtime: 'claude', projectPath: APP, exited: false });
  await listeners.moved('N2');
  assert.equal(await shown, 'N2');
  assert.deepEqual(log.slice(-2), [['open', 'N2'], ['show', 'N2']]);
});

test('a new terminal in a session window is started by the main window; its own reattach here', async () => {
  const { context, log, listeners } = sessionWindow({ sessions: ['S1', 'T2'] });
  const own = await context.openRawTerminalSession({ sessionId: 'S1', type: 'terminal', projectPath: APP });
  assert.deepEqual(plain(own), { ok: true, reattached: true });
  assert.deepEqual(log, [['reattach', 'S1', {}]]);
  const split = context.openRawTerminalSession({ sessionId: 'T2', type: 'terminal', projectPath: APP }, { show: false });
  await settle();
  assert.deepEqual(log[1], ['relay', 'openRawTerminalSession', [{ sessionId: 'T2', type: 'terminal', projectPath: APP }, { show: false }]]);
  await listeners.moved('T2');
  assert.deepEqual(plain(await split), { ok: true, reattached: true });
  assert.deepEqual(log.slice(2), [['open', 'T2']]);
});

test('a start the main window refuses resolves as nothing started, and says so', async () => {
  const { context, log, warnings } = sessionWindow();
  context.api.sessionWindowRun = async () => false;
  assert.equal(await context.launchNewSession({ projectPath: APP }, {}, { focus: false }), undefined);
  const result = await context.openRawTerminalSession({ sessionId: 'T5', type: 'terminal', projectPath: APP }, { show: false });
  assert.equal(result.ok, false);
  assert.deepEqual(log, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /refused launchNewSession/);
  assert.match(warnings[1], /refused openRawTerminalSession/);
});

test('a session window says why it closes, or why a start came to nothing', async () => {
  // Main could not be asked which sessions run: the window closes, and the console says why.
  const broken = sessionWindow({ own: 'N2', live: [], sessions: [] });
  broken.context.api.getSessionStates = async () => { throw new Error('no answer from main'); };
  await broken.context.startSessionWindow();
  assert.deepEqual(broken.log, [['close window']]);
  assert.match(broken.warnings.join('\n'), /no answer from main/);
  assert.match(broken.warnings.join('\n'), /N2/);

  // The relay itself failed.
  const { context, warnings, timers } = sessionWindow();
  context.api.sessionWindowRun = async () => { throw new Error('no main window'); };
  assert.equal(await context.launchNewSession({ projectPath: APP }, {}, { focus: false }), undefined);
  assert.match(warnings.join('\n'), /launchNewSession.*no main window/);

  // Sent, but nothing was handed over in time.
  context.api.sessionWindowRun = async () => true;
  const waiting = context.launchNewSession({ projectPath: APP }, {}, { focus: false });
  await settle();
  const limit = vm.runInContext('SESSION_WINDOW_RELAY_MS', context);
  timers.filter(timer => timer.ms === limit).at(-1).fn();
  assert.equal(await waiting, undefined);
  assert.match(warnings.at(-1), /did not hand over/);
});

test('a session another window takes leaves this one; the last one to end closes it', async () => {
  const { context, log, listeners, later } = sessionWindow();
  await context.startSessionWindow();
  context.openSessions.set('S2', { session: { sessionId: 'S2' }, terminal: { options: {} }, closed: false });
  log.length = 0;
  listeners.owner('S2', 'main', false);
  assert.deepEqual(log, [['unsplit', 'S2'], ['destroy', 'S2', { forgetPersisted: false, preserveHistory: true }]]);
  // Events about sessions this window does not show change nothing.
  listeners.owner('S9', 'window', false);
  listeners.owner('S1', 'window', true);
  assert.equal(log.length, 2);
  // Another window's session ending, or one while this window is still opening, closes nothing.
  listeners.exited('S9', 0, null, true);
  later();
  assert.equal(log.length, 2);
  listeners.exited('S1', 0, null, true);
  context.openSessions.delete('S1');
  later();
  assert.deepEqual(log.slice(2), [['close window']]);
});

// ---- #terminal-header's button (tile-view.js) ----

test('for a session in its own window the header offers Show window, and none in a session window', () => {
  const log = [];
  const entry = { session: { sessionId: 'S1', projectPath: APP }, shadow: false };
  const context = vm.createContext({
    console, Map, Set, JSON,
    activeSessionId: 'S1',
    openSessions: new Map([['S1', entry]]),
    sessionMap: new Map([['S1', entry.session]]),
    popOutSession: id => log.push(['open', id]),
    showSessionWindow: id => log.push(['show', id]),
  });
  vm.runInContext(read('tile-view.js'), context);
  const button = () => ({ hidden: true, title: '', setAttribute(name, value) { this[name] = value; } });
  const state = vm.runInContext('tileState', context);
  state.headerSplit = button();
  state.headerPopOut = button();
  const header = () => ({ hidden: state.headerPopOut.hidden, title: state.headerPopOut.title, label: state.headerPopOut['aria-label'] });

  context.refreshTileHeaderButtons();
  assert.deepEqual(header(), { hidden: false, title: 'Open in new window', label: 'Open in new window' });
  context.popOutFromHeader();
  // Its window has it: the button brings that window forward, as the menus' Show window does.
  entry.shadow = true;
  context.refreshTileHeaderButtons();
  assert.deepEqual(header(), { hidden: false, title: 'Show window', label: 'Show window' });
  context.popOutFromHeader();
  assert.deepEqual(log, [['open', 'S1'], ['show', 'S1']]);

  // A session window shows its sessions in a window already.
  vm.runInContext('var SESSION_WINDOW = { sessionId: "S1" }', context);
  context.refreshTileHeaderButtons();
  assert.equal(state.headerPopOut.hidden, true);
});
