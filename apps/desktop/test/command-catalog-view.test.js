// The terminal's Commands palette (public/command-catalog-view.js) in a vm,
// with a stand-in for the few DOM calls it makes: which sessions get the
// button, what a pick sends to the session, when Run asks first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');

/** An element that takes whatever the view does to it. */
function stubElement() {
  const el = {
    innerHTML: '', value: '', style: {}, dataset: {}, className: '', title: '',
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, remove() { el.removed = true; },
    focus() {}, setSelectionRange() {}, scrollIntoView() {}, contains: () => false,
    getBoundingClientRect: () => ({ right: 800, bottom: 40 }),
    querySelector: () => stubElement(), querySelectorAll: () => [],
    insertBefore() {}, appendChild() {},
  };
  return el;
}

function setup({ sessions = {}, attention = [], busy = [], active = 's1' } = {}) {
  const calls = [];
  const timers = [];
  const openSessions = new Map(Object.entries(sessions).map(([id, s]) => [id, { session: s, terminal: { focus: () => calls.push(['focus', id]) } }]));
  const context = vm.createContext({
    window: {
      innerWidth: 1200,
      addEventListener() {},
      removeEventListener() {},
      api: {
        platform: 'darwin',
        sendInput: (id, text) => calls.push(['input', id, text]),
        writeClipboard: async (text) => calls.push(['copy', text]),
        openExternal: (url) => calls.push(['open', url]),
        getCommandCatalogClis: async () => ['claude'],
        getCommandCatalog: async () => null,
      },
    },
    document: {
      createElement: () => stubElement(),
      getElementById: () => null,
      body: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    setTimeout: (fn, ms) => { timers.push(ms); fn(); },
    isMac: true,
    ICONS: new Proxy({}, { get: () => () => '' }),
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openSessions,
    sessionMap: new Map(),
    attentionSessions: new Set(attention),
    sessionBusyState: new Map(busy.map((id) => [id, true])),
    activeSessionId: active,
  });
  vm.runInContext(read('command-catalog-model.js'), context);
  vm.runInContext(read('command-catalog-view.js'), context);
  vm.runInContext("commandCatalogClis = ['claude'];", context);
  return { context, calls, timers };
}

const ENTRIES = [
  { id: 'claude:slash:compact', cli: 'claude', kind: 'slash', command: '/compact', name: 'compact', inputArgs: '[instructions]', description: 'Summarize', source: 'official-docs', docUrl: 'https://code.claude.com/docs/en/commands#all-commands' },
  { id: 'claude:slash:exit', cli: 'claude', kind: 'slash', command: '/exit', name: 'exit', description: 'Exit the CLI', source: 'official-docs', flags: ['endsSession'] },
  { id: 'claude:slash:add-dir', cli: 'claude', kind: 'slash', command: '/add-dir', name: 'add-dir', inputArgs: '<path>', argsRequired: true, description: 'Add a directory', source: 'official-docs' },
  { id: 'claude:flag:model', cli: 'claude', kind: 'flag', command: '--model', name: '--model', description: 'Sets the model', source: 'official-docs', example: 'claude --model opus' },
];

/** Open the palette on the session in front with these entries, `selected` picked. */
function open(context, { selected = 0, target = 'agent', sessionId = 's1', tab = 'commands' } = {}) {
  context.__catalog = { cli: 'claude', target, version: { session: '2.1.331' }, docs: { origin: 'bundled' }, entries: ENTRIES };
  vm.runInContext(`commandPalette = { el: document.createElement('div'), sessionId: ${JSON.stringify(sessionId)}, catalog: __catalog, tab: ${JSON.stringify(tab)}, query: '', selected: ${selected}, cli: 'claude', confirm: null };`, context);
}
const palette = (context) => vm.runInContext('commandPalette', context);

test('the button shows for sessions of a CLI with a catalog, and for plain shells', () => {
  const { context } = setup();
  const has = (s) => context.sessionHasCommandCatalog(s);
  assert.equal(has({ runtime: 'claude' }), true);
  assert.equal(has({}), true);
  assert.equal(has({ runtime: 'codex' }), false);
  assert.equal(has({ type: 'terminal' }), true);
  assert.equal(has(null), false);
});

test('the session state the rules use', () => {
  const { context } = setup({ attention: ['a'], busy: ['b', 'a'] });
  assert.equal(context.commandCatalogState('a'), 'attention');
  assert.equal(context.commandCatalogState('b'), 'busy');
  assert.equal(context.commandCatalogState('c'), 'idle');
});

test('the target is the session in front, by its id now', () => {
  const { context } = setup({ sessions: { s1: { sessionId: 'real-1', runtime: 'claude' } } });
  const target = context.commandCatalogTarget();
  assert.equal(target.sessionId, 'real-1');
  vm.runInContext('activeSessionId = null', context);
  assert.equal(context.commandCatalogTarget(), null);
});

test('Insert types the command and a space, no Enter, and goes back to the terminal', async () => {
  const { context, calls } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(context);
  await context.commandPaletteAct('primary');
  assert.deepEqual(calls, [['input', 's1', '/compact '], ['focus', 's1']]);
  assert.equal(palette(context), null);
});

test('Run types the command, then Enter 80 ms later', async () => {
  const { context, calls, timers } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(context);
  await context.commandPaletteAct('run');
  assert.deepEqual(calls, [['input', 's1', '/compact '], ['input', 's1', '\r'], ['focus', 's1']]);
  assert.deepEqual(timers, [80]);
});

test('Run asks first for a command that ends the session, and runs after the answer', async () => {
  const { context, calls } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(context, { selected: 1 });
  await context.commandPaletteAct('run');
  assert.deepEqual(calls, []);
  assert.match(palette(context).confirm.question, /^Run \/exit\? It ends the session/);
  await context.commandPaletteAct('confirm');
  assert.deepEqual(calls, [['input', 's1', '/exit '], ['input', 's1', '\r'], ['focus', 's1']]);
});

test('Run does nothing for a command that needs an argument, or while the session works', async () => {
  const one = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(one.context, { selected: 2 });
  await one.context.commandPaletteAct('run');
  assert.deepEqual(one.calls, []);
  const two = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } }, busy: ['s1'] });
  open(two.context);
  await two.context.commandPaletteAct('run');
  assert.deepEqual(two.calls, []);
  // Insert still works while it works: the command waits for the turn.
  await two.context.commandPaletteAct('insert');
  assert.deepEqual(two.calls[0], ['input', 's1', '/compact ']);
});

test('while the CLI waits for an answer, Insert asks first', async () => {
  const { context, calls } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } }, attention: ['s1'] });
  open(context);
  await context.commandPaletteAct('primary');
  assert.deepEqual(calls, []);
  assert.match(palette(context).confirm.question, /waiting for your answer/);
  await context.commandPaletteAct('confirm');
  assert.deepEqual(calls[0], ['input', 's1', '/compact ']);
});

test('a flag in a CLI session is copied; Docs opens the page', async () => {
  const { context, calls } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(context, { selected: 0, tab: 'cli' });
  await context.commandPaletteAct('primary');
  assert.deepEqual(calls, [['copy', 'claude --model opus']]);
  assert.notEqual(palette(context), null);
  open(context, { selected: 0 });
  await context.commandPaletteAct('docs');
  assert.deepEqual(calls[1], ['open', 'https://code.claude.com/docs/en/commands#all-commands']);
});

test('the details offer Run only when it can run, and say why not', () => {
  const { context } = setup();
  const catalog = { cli: 'claude', target: 'agent', version: {}, entries: ENTRIES };
  const ok = context.commandDetailsHtml(ENTRIES[0], catalog, 'idle');
  assert.match(ok, /data-act="insert">Insert</);
  assert.match(ok, /data-act="run" title=/);
  assert.doesNotMatch(ok, /data-act="run" disabled/);
  const needs = context.commandDetailsHtml(ENTRIES[2], catalog, 'idle');
  assert.match(needs, /data-act="run" disabled title="Needs &lt;path&gt;/);
  const shell = context.commandDetailsHtml(ENTRIES[3], { ...catalog, target: 'terminal' }, 'idle');
  assert.match(shell, /data-act="insert">Insert</);
  assert.doesNotMatch(shell, /data-act="run"/);
  assert.match(context.commandDetailsHtml(undefined, catalog, 'idle'), /Nothing matches/);
});

test('Mod+Shift+K is the palette key', () => {
  const { context } = setup();
  const key = (over) => context.isCommandPaletteKey({ code: 'KeyK', shiftKey: true, altKey: false, metaKey: true, ctrlKey: false, ...over });
  assert.equal(key({}), true);
  assert.equal(key({ shiftKey: false }), false);
  assert.equal(key({ metaKey: false, ctrlKey: true }), false);
  assert.equal(key({ code: 'KeyJ' }), false);
});

test('pinned, the palette stays open after a pick and when the click is outside it', async () => {
  const { context, calls } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(context);
  vm.runInContext('commandPalette.pinned = true', context);
  await context.commandPaletteAct('primary');
  assert.deepEqual(calls, [['input', 's1', '/compact '], ['focus', 's1']]);
  assert.notEqual(palette(context), null);
  context.commandPaletteOutside({ target: {} });
  assert.notEqual(palette(context), null);
  vm.runInContext('commandPalette.pinned = false', context);
  context.commandPaletteOutside({ target: {} });
  assert.equal(palette(context), null);
});

test('in a window of its own, the palette is the window: a pick, Escape or the key never close it', async () => {
  const { context, calls } = setup({ sessions: { s1: { sessionId: 's1', runtime: 'claude' } } });
  open(context);
  vm.runInContext('commandPalette.window = true', context);
  await context.commandPaletteAct('run');
  assert.deepEqual(calls.slice(0, 2), [['input', 's1', '/compact '], ['input', 's1', '\r']]);
  context.commandPaletteKey({ key: 'Escape', preventDefault() {} });
  context.commandPaletteOutside({ target: {} });
  assert.notEqual(palette(context), null);
  vm.runInContext('var COMMANDS_WINDOW = { sessionId: "s1" }', context);
  context.toggleCommandPalette();
  assert.notEqual(palette(context), null);
});
