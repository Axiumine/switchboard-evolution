// Split = a new session beside this one (public/session-split.js): what the
// new session is launched with, the launch options remembered for that
// (sessionLaunchSpecs.v1), and the hooks the files shared with upstream carry.
// The app's launchers are stubbed; the pane the new session goes to is the
// caller's `place`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
// Objects made inside the vm have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
}

const APP = '/Users/demo/app';
const DEFAULTS = { model: 'sonnet', permissionMode: 'plan', worktree: true };

/** session-split.js against stubs; `sessions` are what sessionMap knows. */
function load({ sessions = [], storage = memoryStorage() } = {}) {
  const calls = { defaults: [], launched: [], terminals: [], placed: [] };
  let clock = 1000;
  const context = vm.createContext({
    console,
    localStorage: storage,
    Date: { now: () => ++clock },
    sessionMap: new Map(sessions.map(s => [s.sessionId, s])),
    openSessions: new Map(),
    resolveDefaultSessionOptions: async project => { calls.defaults.push(plain(project)); return { ...DEFAULTS }; },
    launchNewSession: async (project, options, opts) => {
      calls.launched.push(plain({ project, options, opts }));
      return 'NEW';
    },
    launchTerminalSession: async (project, opts) => {
      calls.terminals.push(plain({ project, opts }));
      return 'T2';
    },
  });
  vm.runInContext(read('session-split.js'), context);
  const run = code => vm.runInContext(code, context);
  const place = id => calls.placed.push(id);
  return { context, calls, run, place, storage };
}

test('a split keeps CLI, folder, project and track and drops worktree, fork and resume', async () => {
  const session = { sessionId: 'S1', projectPath: APP, projectId: 'p', trackId: 't', runtime: 'codex' };
  const { context, calls, place } = load({ sessions: [session] });
  const launched = {
    runtime: 'codex', codexModel: 'gpt-demo', codexSandbox: 'workspace-write', projectId: 'p', trackId: 't',
    worktree: true, worktreeName: 'wt-1', forkFrom: 'S0', resumeExisting: true,
    scheduleId: 'sch-1', unattended: true, initialPrompt: 'Work on the todo', planItem: { line: 3 },
  };
  // The project a session is launched with can be a whole sidebar folder: only where it goes is kept.
  context.rememberLaunchSpec('S1', { projectPath: APP, projectId: 'p', trackId: 't', projectName: 'Demo', sessions: [{}] }, launched);

  const cleaned = context.cleanLaunchSpec(launched);
  assert.deepEqual(plain(cleaned), { runtime: 'codex', codexModel: 'gpt-demo', codexSandbox: 'workspace-write', projectId: 'p', trackId: 't' });
  assert.equal(launched.worktree, true, 'the options given are not changed');

  const spec = await context.splitSpecFor(session);
  assert.deepEqual(plain(spec), {
    project: { projectPath: APP, projectId: 'p', trackId: 't' },
    options: { runtime: 'codex', codexModel: 'gpt-demo', codexSandbox: 'workspace-write' },
  });
  assert.equal(calls.defaults.length, 0, 'the remembered options are used as they are');

  // Where the session is now wins over where it was launched (it was moved to another track).
  const moved = await context.splitSpecFor({ ...session, trackId: 't2' });
  assert.equal(moved.project.trackId, 't2');

  // Split starts the new session without taking the screen, then places it.
  const newId = await context.splitSession('S1', { place });
  assert.equal(newId, 'NEW');
  assert.deepEqual(calls.launched, [{
    project: { projectPath: APP, projectId: 'p', trackId: 't' },
    options: { runtime: 'codex', codexModel: 'gpt-demo', codexSandbox: 'workspace-write' },
    opts: { focus: false },
  }]);
  assert.deepEqual(calls.placed, ['NEW']);
  assert.equal(calls.terminals.length, 0);
});

test('with nothing remembered the folder defaults and the session CLI are used', async () => {
  const opencode = { sessionId: 'S2', projectPath: APP, projectId: 'p', trackId: null, runtime: 'opencode' };
  const loose = { sessionId: 'S3', projectPath: '/Users/demo/loose' };
  const { context, calls } = load({ sessions: [opencode, loose] });
  const spec = await context.splitSpecFor(opencode);
  assert.deepEqual(calls.defaults, [{ projectPath: APP, projectId: 'p', trackId: null }]);
  // The folder defaults lose their worktree too: the split runs where the session runs.
  assert.deepEqual(plain(spec), {
    project: { projectPath: APP, projectId: 'p', trackId: null },
    options: { model: 'sonnet', permissionMode: 'plan', runtime: 'opencode' },
  });
  // A session outside every project, from before the CLI was recorded: Claude.
  const old = await context.splitSpecFor(loose);
  assert.deepEqual(plain(old), {
    project: { projectPath: '/Users/demo/loose', projectId: null, trackId: null },
    options: { model: 'sonnet', permissionMode: 'plan', runtime: 'claude' },
  });
});

test('launch specs follow a re-key and keep at most 200', async () => {
  const { context, run, storage } = load();
  assert.equal(run('SESSION_LAUNCH_SPECS_KEY'), 'sessionLaunchSpecs.v1');
  for (let i = 0; i <= 200; i++) context.rememberLaunchSpec(`S${i}`, { projectPath: APP }, { runtime: 'claude', model: `m${i}` });
  let saved = JSON.parse(storage.getItem('sessionLaunchSpecs.v1'));
  assert.equal(saved.v, 1);
  assert.equal(Object.keys(saved.specs).length, 200);
  assert.ok(!('S0' in saved.specs), 'the oldest goes');
  assert.deepEqual(saved.specs.S200.options, { runtime: 'claude', model: 'm200' });

  // Codex's real id (or a fork's) takes the spec of the temporary one.
  context.rekeyLaunchSpec('S200', 'REAL');
  saved = JSON.parse(storage.getItem('sessionLaunchSpecs.v1'));
  assert.ok(!('S200' in saved.specs));
  const spec = await context.splitSpecFor({ sessionId: 'REAL', projectPath: APP });
  assert.equal(spec.options.model, 'm200');

  // Unreadable or invalid saved specs read as none.
  for (const raw of ['{nope', 'null', '[]', '{"v":1,"specs":[]}']) {
    const other = load({ storage: memoryStorage({ 'sessionLaunchSpecs.v1': raw }), sessions: [{ sessionId: 'X', projectPath: APP, runtime: 'codex' }] });
    const fallback = await other.context.splitSpecFor({ sessionId: 'X', projectPath: APP, runtime: 'codex' });
    assert.equal(fallback.options.runtime, 'codex', raw);
    assert.equal(other.calls.defaults.length, 1, raw);
    other.context.rememberLaunchSpec('Y', { projectPath: APP }, { runtime: 'claude' });
    assert.deepEqual(Object.keys(JSON.parse(other.storage.getItem('sessionLaunchSpecs.v1')).specs), ['Y'], raw);
  }
});

test('a plain terminal splits into a new terminal in the same folder', async () => {
  const terminal = { sessionId: 'T1', type: 'terminal', projectPath: '/Users/demo/app/api', projectId: 'p', trackId: 't' };
  const { context, calls, place } = load({ sessions: [terminal] });
  const newId = await context.splitSession('T1', { direction: 'down', place });
  assert.equal(newId, 'T2');
  assert.deepEqual(calls.terminals, [{ project: { projectPath: '/Users/demo/app/api', projectId: 'p', trackId: 't' }, opts: { show: false } }]);
  assert.equal(calls.launched.length, 0);
  assert.deepEqual(calls.placed, ['T2']);
  // An unknown session, or a launch that fails, places nothing.
  assert.equal(await context.splitSession('nope', { place }), null);
  context.launchTerminalSession = async () => undefined;
  assert.equal(await context.splitSession('T1', { place }), null);
  assert.deepEqual(calls.placed, ['T2']);
});

test('the session menu offers the splits, the configured one only for a CLI', () => {
  const { context } = load();
  const labels = session => plain(context.splitMenuItems(session)).map(item => item.label || (item.sep ? '—' : ''));
  assert.deepEqual(labels({ sessionId: 'S1', projectPath: APP, runtime: 'claude' }),
    ['Split', 'Split right', 'Split down', 'New split session with configuration…', '—']);
  assert.deepEqual(labels({ sessionId: 'T1', projectPath: APP, type: 'terminal' }), ['Split', 'Split right', 'Split down', '—']);
  // Nothing for an archived session (its pane would be pruned) or no session.
  assert.deepEqual(labels({ sessionId: 'S4', projectPath: APP, archived: 1 }), []);
  assert.deepEqual(labels(null), []);
});

test('a plain terminal can start without being shown and gives its id', async () => {
  const opened = [];
  const context = vm.createContext({
    crypto: { randomUUID: () => 'T9' },
    pendingSessions: new Map(), sessionMap: new Map(), cachedProjects: [], cachedAllProjects: [],
    encodeProjectPath: p => p, refreshSidebar() {}, pollActiveSessions() {},
    openRawTerminalSession: async (session, opts) => { opened.push({ id: session.sessionId, opts }); return { ok: true }; },
  });
  vm.runInContext(body(read('dialogs.js'), 'async function launchTerminalSession('), context);
  assert.equal(await context.launchTerminalSession({ projectPath: APP }, { show: false }), 'T9');
  assert.equal(await context.launchTerminalSession({ projectPath: APP }), 'T9');
  assert.deepEqual(plain(opened), [{ id: 'T9', opts: { show: false } }, { id: 'T9', opts: { show: true } }]);
  context.openRawTerminalSession = async () => ({ ok: false, error: 'no shell' });
  assert.equal(await context.launchTerminalSession({ projectPath: APP }), undefined);
});

test('the split hooks are in place', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  const at = name => scripts.indexOf(name);
  assert.ok(at('tile-layout-model.js') !== -1 && at('tile-layout-model.js') < at('tile-view.js'));
  assert.equal(scripts[at('terminal-manager.js') + 1], 'tile-view.js');
  assert.equal(scripts[at('tile-view.js') + 1], 'session-split.js');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<link rel="stylesheet" href="tiles.css">'));

  // showSession, in the single view, once the terminal is visible and fitted.
  const show = body(read('terminal-manager.js'), 'function showSession(');
  assert.ok(show.includes(
    "      fitAndScroll(entry);\n      if (typeof syncTileLayout === 'function') syncTileLayout(sessionId);\n",
  ), show);
  // launchNewSession remembers what each session was launched with.
  const launch = body(read('app.js'), 'async function launchNewSession(');
  const hook = launch.indexOf("if (typeof rememberLaunchSpec === 'function') rememberLaunchSpec(sessionId, project, options);");
  assert.ok(hook > launch.indexOf('const options = '), launch);
  assert.ok(hook < launch.indexOf('window.api.openTerminal('), launch);
  // The session menu, before Star.
  const menu = body(read('projects-view.js'), 'function sessionMenuItems(');
  const spread = menu.indexOf("...(typeof splitMenuItems === 'function' ? splitMenuItems(session) : []),");
  assert.ok(spread !== -1 && spread < menu.indexOf("session.starred ? 'Unstar session'"), menu);
  // The new session dialog takes a filled form and a start of the caller's.
  const dialogs = read('dialogs.js');
  assert.ok(dialogs.includes("async function showNewSessionDialog(project, runtime = 'claude', { overrides, onStart } = {}) {"));
  assert.ok(dialogs.includes('async function launchTerminalSession(project, { show = true } = {}) {'));
});
