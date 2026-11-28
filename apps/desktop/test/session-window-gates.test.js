// A session in a window of its own (public/session-window.js) runs the main
// window's page. In it, app.js and the other files shared with upstream skip
// what only the main window does: restoring the terminals, the active session
// and the task log at start, saving the session marks, the project windows'
// runs, the status bar and the What's new announcement. A session window opens
// its own session and nothing else, since opening one takes its output.
//
// The files shared with upstream carry one-line hooks: SESSION_WINDOW beside
// PROJECT_WINDOW, the boot branch, and the hooks that keep a terminal quiet
// while a reattach replays its buffer (session-window.js) or while it stands
// for a session shown in another window (session-window-host.js). These are
// source checks of those hooks; test/session-window.test.js runs the logic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
}

test('the session window is gated like a project window', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  const at = name => scripts.indexOf(name);
  // Read before the other scripts, as PROJECT_WINDOW is.
  assert.equal(scripts[at('project-window.js') + 1], 'session-window.js');
  // The main window's side comes after the overview, whose cards and docked panes it fills.
  assert.ok(at('session-window-host.js') > at('session-overview.js'), scripts.join(' '));
  assert.ok(at('session-window-host.js') < at('app.js'), scripts.join(' '));

  const app = read('app.js');
  // Beside every PROJECT_WINDOW of app.js: the active session to restore, the
  // session marks and their publishing, the project windows' runs and the
  // status bar. Two lines are the project window's alone: its boot branch, and
  // setActiveSession's return (a session window still switches its file panel
  // and buttons there, and only leaves the saved active session alone).
  const lines = app.split('\n').filter(line => line.includes('PROJECT_WINDOW'));
  const own = [
    '  if (PROJECT_WINDOW) { showProjectWindow(); return; }',
    '  if (PROJECT_WINDOW) return;',
  ];
  const shared = lines.filter(line => !own.includes(line));
  assert.equal(lines.length - shared.length, 2, lines.join('\n'));
  assert.equal(shared.length, 6, shared.join('\n'));
  for (const line of shared) assert.ok(line.includes('SESSION_WINDOW'), line);
  assert.ok(app.includes('let activeSessionId = (PROJECT_WINDOW || SESSION_WINDOW) ? null : '));
  assert.ok(body(app, 'function saveSessionNotices()').includes('  if (PROJECT_WINDOW || SESSION_WINDOW) return;\n'));
  assert.ok(app.includes('if (!PROJECT_WINDOW && !SESSION_WINDOW) window.api.publishSessionNotices(sessionNotices());'));
  assert.ok(app.includes('if (!PROJECT_WINDOW && !SESSION_WINDOW) {\n  window.api.onProjectWindowRun('));
  assert.ok(app.includes('const showStatus = !!statusBarResources && !PROJECT_WINDOW && !SESSION_WINDOW;'));
  assert.ok(app.includes('if (statusBarResources && !PROJECT_WINDOW && !SESSION_WINDOW) {'));

  // At start, before anything is reopened: no task log, no terminal, no active session.
  const start = app.indexOf('loadProjects().then(async () => {');
  const boot = app.slice(start, app.indexOf('\n});\n', start));
  const branch = boot.indexOf('  if (SESSION_WINDOW) { startSessionWindow(); return; }\n');
  assert.ok(branch > boot.indexOf('if (PROJECT_WINDOW) { showProjectWindow(); return; }'), boot);
  assert.ok(branch < boot.indexOf('rememberedTab()'), boot);
  assert.ok(branch < boot.indexOf('await restoreActiveTaskView();'), boot);
  assert.ok(branch < boot.indexOf('await restorePersistedTerminalProcesses();'), boot);
  assert.ok(branch < boot.indexOf('if (activeSessionId) {'), boot);

  // No announcement over a session's window.
  const whatsNew = read('whats-new.js');
  const from = whatsNew.indexOf('  function maybeShowProjectViewAnnouncement()');
  const announce = whatsNew.slice(from, whatsNew.indexOf('\n  }\n', from));
  assert.ok(from !== -1, 'maybeShowProjectViewAnnouncement not found');
  const gate = announce.indexOf("    if (typeof SESSION_WINDOW !== 'undefined' && SESSION_WINDOW) return;\n");
  assert.ok(gate !== -1 && gate < announce.indexOf('shouldShowAnnouncement('), announce);
  // Nor the Session Overview, nor the usage time the main window counts.
  assert.ok(body(read('session-overview.js'), 'function sessionOverviewUnavailable()').includes("typeof SESSION_WINDOW !== 'undefined' && !!SESSION_WINDOW"));
  assert.ok(read('donate-box.js').includes("&& (typeof SESSION_WINDOW === 'undefined' || !SESSION_WINDOW);"));

  // The terminal area alone, at the window's full size.
  const style = read('style.css');
  const block = style.slice(style.indexOf('body.session-window #sidebar,'));
  assert.ok(block.startsWith([
    'body.session-window #sidebar,',
    'body.session-window #sidebar-resize-handle,',
    'body.session-window #project-viewer,',
    'body.session-window #status-bar,',
    'body.session-window #update-toast { display: none !important; }',
    'body.session-window #main.project-working #terminal-area { top: 0; }',
  ].join('\n')), block.slice(0, 400));
});

test('a session window keeps its active session to itself, and its panel and buttons follow it', () => {
  const calls = [];
  const storage = name => ({
    setItem: (key, value) => calls.push([name, 'set', key, value]),
    removeItem: key => calls.push([name, 'remove', key]),
  });
  const run = windowKind => {
    calls.length = 0;
    const context = vm.createContext({
      PROJECT_WINDOW: windowKind === 'project' ? { projectId: 'p' } : null,
      SESSION_WINDOW: windowKind === 'session' ? { sessionId: 'S1' } : null,
      ACTIVE_SESSION_KEY: 'activeSessionId',
      activeSessionId: null,
      sessionStorage: storage('session'),
      localStorage: storage('local'),
      switchPanel: id => calls.push(['panel', id]),
      updateCommandCatalogButton: () => calls.push(['commands']),
      updatePromptImproverButton: () => calls.push(['improve']),
    });
    vm.runInContext(body(read('app.js'), 'function setActiveSession('), context);
    context.setActiveSession('S1');
    context.setActiveSession(null);
    return calls.slice();
  };
  const follows = [['panel', 'S1'], ['commands'], ['improve'], ['panel', null], ['commands'], ['improve']];
  assert.deepEqual(run('session'), follows);
  assert.deepEqual(run('project'), []);
  assert.deepEqual(run('main'), [
    ['session', 'set', 'activeSessionId', 'S1'], ['local', 'set', 'activeSessionId', 'S1'], ...follows.slice(0, 3),
    ['session', 'remove', 'activeSessionId'], ['local', 'remove', 'activeSessionId'], ...follows.slice(3),
  ]);
});

test('a reattach and a shadow terminal stay quiet through one-line hooks', () => {
  // A terminal made for a live session holds its replies from the start…
  const entry = body(read('terminal-manager.js'), 'function createTerminalEntry(');
  const begin = entry.indexOf("  if (typeof beginTerminalReplay === 'function') beginTerminalReplay(entry);\n");
  assert.ok(begin !== -1, entry);
  assert.ok(begin < entry.indexOf('  openSessions.set(sessionId, entry);'), entry);
  // …and a shadow (a session shown in another window) does not size the PTY.
  assert.ok(entry.includes([
    '  terminal.onResize(({ cols, rows }) => {',
    '    if (entry.shadow) return;',
    '    window.api.resizeTerminal(entry.session.sessionId, cols, rows);',
  ].join('\n')), entry);

  // Each reattach lets the terminal answer again once xterm has read the replay.
  const hook = "if (typeof endTerminalReplay === 'function') endTerminalReplay(entry, result);";
  const open = body(read('app.js'), 'async function openSession(');
  assert.ok(open.includes(`  const result = await window.api.openTerminal(sessionId, projectPath, false, resumeOptions);\n  ${hook}\n`), open);
  const raw = body(read('dialogs.js'), 'async function openRawTerminalSession(');
  const call = raw.indexOf('  const result = await window.api.openTerminal(');
  const after = raw.indexOf('  });\n', call) + '  });\n'.length;
  assert.ok(call !== -1 && raw.slice(after).startsWith(`  ${hook}\n`), raw);
});

test("a session window's pin is its own, while a tool window's is remembered for the next", () => {
  // main.js's set-window-on-top, run against a stubbed window.
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('set-window-on-top', ");
  assert.ok(start !== -1, 'set-window-on-top not found');
  const code = source.slice(start, source.indexOf('\n});\n', start) + 5);
  const saved = [];
  const pinned = [];
  let kind = null;
  const handlers = {};
  vm.runInNewContext(code, {
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    toolWindowKindOf: () => kind,
    BrowserWindow: { fromWebContents: () => ({ setAlwaysOnTop: (on) => pinned.push(on) }) },
    saveToolWindowSettings: (name, settings) => saved.push([name, settings.onTop]),
  });
  const pin = (windowKind, on) => { kind = windowKind; return handlers['set-window-on-top']({ sender: {} }, on); };
  assert.equal(pin('session', true), true);
  assert.equal(pin('stats', true), true);
  assert.equal(pin(null, true), false, 'the main window has no pin');
  assert.deepEqual(pinned, [true, true]);
  assert.deepEqual(saved, [['stats', true]]);
});
