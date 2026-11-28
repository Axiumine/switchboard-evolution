// The pin of a window of its own (public/tool-window.js) against main.js:
// 'set-window-on-top' must recognise every kind of window that shows one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const between = (from, to) => {
  const start = mainSource.indexOf(from);
  const end = mainSource.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `markers ${from} … ${to}`);
  return mainSource.slice(start, end + to.length);
};

function fakeWindow() {
  const win = {
    onTop: true,
    webContents: {},
    isDestroyed: () => false,
    setAlwaysOnTop(value) { win.onTop = value; },
  };
  return win;
}

/** main.js's lookup and pin handler, with one open window in each collection. */
function setup() {
  const windows = {
    'task-manager': fakeWindow(),
    'project-git': fakeWindow(),
    'git-compare': fakeWindow(),
    'git-file': fakeWindow(),
    file: fakeWindow(),
    'web-page': fakeWindow(),
    commands: fakeWindow(),
  };
  // A session's window (session-windows.js) keeps its pin to itself.
  const sessionWindow = fakeWindow();
  const handlers = {};
  const saved = [];
  const context = {
    toolWindows: new Map([['task-manager', windows['task-manager']]]),
    projectWindows: new Map([['project-id\ngit', windows['project-git']]]),
    compareWindows: new Set([windows['git-compare']]),
    fileWindows: new Set([windows['git-file']]),
    viewerFileWindows: new Set([windows.file]),
    webWindows: new Map([[windows['web-page'], 'https://github.com/']]),
    commandsWindows: new Map([['session-id', windows.commands]]),
    sessionWindows: { isSessionWindow: (webContents) => webContents === sessionWindow.webContents },
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    BrowserWindow: { fromWebContents: (sender) => [...Object.values(windows), sessionWindow].find(w => w.webContents === sender) || null },
    saveToolWindowSettings: (kind, patch) => saved.push([kind, { ...patch }]),
  };
  vm.createContext(context);
  vm.runInContext(between('function toolWindowKindOf', '\n}\n'), context);
  vm.runInContext(between("ipcMain.handle('set-window-on-top'", '\n});\n'), context);
  const setOnTop = (win, value) => handlers['set-window-on-top']({ sender: win.webContents }, value);
  return { windows, sessionWindow, saved, setOnTop };
}

test('the pin lets every kind of window go behind the others and keeps the choice', () => {
  const { windows, saved, setOnTop } = setup();
  for (const [kind, win] of Object.entries(windows)) {
    assert.equal(setOnTop(win, false), false, kind);
    assert.equal(win.onTop, false, `${kind} is no longer kept on top`);
    assert.deepEqual(saved.at(-1), [kind, { onTop: false }]);
    assert.equal(setOnTop(win, true), true, kind);
    assert.equal(win.onTop, true, `${kind} is kept on top again`);
    assert.deepEqual(saved.at(-1), [kind, { onTop: true }]);
  }
});

test('a session\'s window is pinned and unpinned without keeping the choice', () => {
  const { sessionWindow, saved, setOnTop } = setup();
  assert.equal(setOnTop(sessionWindow, false), false);
  assert.equal(sessionWindow.onTop, false);
  assert.equal(setOnTop(sessionWindow, true), true);
  assert.equal(sessionWindow.onTop, true);
  assert.deepEqual(saved, []);
});

test('the Commands window reads its saved choice under the kind the pin writes', () => {
  assert.match(mainSource, /createPageWindow\('commands', /);
});

test('a page that is no window of its own changes nothing', () => {
  const { saved, setOnTop } = setup();
  assert.equal(setOnTop({ webContents: {} }, true), false);
  assert.deepEqual(saved, []);
});
