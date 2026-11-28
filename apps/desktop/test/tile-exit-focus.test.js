// A pane that leaves its layout on its own (a plain terminal whose shell
// ended, a session that never started) in public/tile-view.js: the pane beside
// it, or the session in front, takes the keys only when they were in the
// layout, or nowhere. Typing in the file panel's editor, a search field or a
// dialog over the layout goes on there: an Enter must not reach an agent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const leaf = id => ({ session: id });
const split = (kind, a, b) => ({ split: kind, ratio: 0.5, a, b });

function memoryStorage() {
  const data = new Map();
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}

function layout({ tree, focusedId, live, known }) {
  const listeners = {};
  const timers = [];
  const log = [];
  const field = (name, inLayout) => ({ name, inLayout, focus() { log.push(['focus', name]); document.activeElement = this; } });
  const document = { addEventListener() {}, body: field('body', false), activeElement: null };
  const terminals = new Map(live.map(id => [id, field(`terminal ${id}`, true)]));
  const context = vm.createContext({
    console, Map, Set, JSON, Object, Array,
    document,
    localStorage: memoryStorage(),
    setTimeout: fn => timers.push(fn),
    addEventListener() {},
    api: {
      onSessionDetected() {}, onSessionForked() {}, onCliBusyState() {},
      onProcessExited: fn => { listeners.exited = fn; },
    },
    openSessions: new Map(live.map(id => [id, { session: { sessionId: id }, terminal: { focus: () => terminals.get(id).focus() } }])),
    sessionMap: new Map(known.map(id => [id, { sessionId: id }])),
    activeSessionId: focusedId,
  });
  context.window = context;
  vm.runInContext(read('tile-layout-model.js'), context);
  vm.runInContext(read('tile-view.js'), context);
  vm.runInContext('tileStore()', context).set('L', tree, 'main');
  Object.assign(vm.runInContext('tileState', context), {
    layoutId: 'L', tree, focusedId,
    mount: { root: { isConnected: true, contains: el => !!el?.inLayout } },
  });
  // What draws the layout is the page's: here only what is on screen and who is shown.
  Object.assign(context, {
    tileViewOnScreen: () => true,
    tileViewBlocked: () => false,
    releaseTilePane() {},
    refreshTileView() {},
    showSession: id => { log.push(['show', id]); context.activeSessionId = id; terminals.get(id).focus(); },
  });
  // app.js's own listener runs between the two: the terminal goes, and so
  // does the session unless it is a CLI that died (it keeps its pane).
  const exit = (id, { died = false } = {}) => {
    listeners.exited(id, died ? 1 : 0, null, false);
    context.openSessions.delete(id);
    if (!died) context.sessionMap.delete(id);
    while (timers.length) timers.shift()();
  };
  return { context, document, field, log, exit };
}

test('a pane beside the one in focus that ends leaves the keys where they are', () => {
  for (const [label, active, focused] of [
    ['typing in the file panel', 'editor', false],
    ['keys in the layout', 'pane', true],
    ['keys nowhere', 'body', true],
  ]) {
    const { document, field, log, exit } = layout({
      tree: split('row', leaf('A'), split('col', leaf('B'), leaf('C'))), focusedId: 'A', live: ['A', 'B', 'C'], known: ['A'],
    });
    document.activeElement = { editor: field('editor', false), pane: field('terminal B', true), body: document.body }[active];
    const before = document.activeElement;
    log.length = 0;
    exit('B');
    if (focused) assert.deepEqual(log, [['focus', 'terminal A']], label);
    else assert.deepEqual(log, [], label);
    if (!focused) assert.equal(document.activeElement, before, label);
  }
});

test('the pane in focus that ends hands the layout to its neighbour, and the keys stay outside it', () => {
  const { document, field, log, exit } = layout({
    tree: split('row', leaf('A'), leaf('B')), focusedId: 'B', live: ['A', 'B'], known: ['A'],
  });
  const editor = field('editor', false);
  document.activeElement = editor;
  log.length = 0;
  exit('B');
  // A is shown in front (its header, the session in focus), and the keys go back to the editor.
  assert.deepEqual(log, [['show', 'A'], ['focus', 'terminal A'], ['focus', 'editor']]);
  assert.equal(document.activeElement, editor);
});

test('a session in focus that died keeps its pane, and its neighbour takes the keys only from the layout', () => {
  for (const inLayout of [false, true]) {
    const { document, field, log, exit } = layout({
      tree: split('row', leaf('A'), leaf('B')), focusedId: 'B', live: ['A', 'B'], known: ['A', 'B'],
    });
    const before = inLayout ? field('terminal B', true) : field('search', false);
    document.activeElement = before;
    log.length = 0;
    exit('B', { died: true });
    if (inLayout) assert.deepEqual(log, [['show', 'A'], ['focus', 'terminal A']]);
    else {
      assert.deepEqual(log, [['show', 'A'], ['focus', 'terminal A'], ['focus', 'search']]);
      assert.equal(document.activeElement, before);
    }
  }
});
