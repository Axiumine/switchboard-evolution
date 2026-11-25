const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A window and its localStorage, as the editor's modules find them in the app.
const stored = new Map();
globalThis.window = globalThis.window || new EventTarget();
globalThis.localStorage = {
  getItem: key => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => { stored.set(key, String(value)); },
  removeItem: key => { stored.delete(key); },
};

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);
const codemirror = async () => ({ ...(await import('@codemirror/state')), ...(await import('@codemirror/view')) });

beforeEach(() => stored.clear());

test('a preference reads its default until it is set, then what was set', async () => {
  const { readPref, setPref } = await editorModule('prefs');
  assert.equal(readPref('whitespace'), false);
  setPref('whitespace', true);
  assert.equal(stored.get('editorShowWhitespace'), 'true', 'the key whitespace always had');
  assert.equal(readPref('whitespace'), true);
});

test('a change is heard here (the event) and from another window (storage)', async () => {
  const { setPref, onPrefChange } = await editorModule('prefs');
  const heard = [];
  const off = onPrefChange(name => heard.push(name));
  setPref('whitespace', true);
  const other = new Event('storage');
  other.key = 'editorShowWhitespace';
  window.dispatchEvent(other);
  off();
  setPref('whitespace', false);
  assert.deepEqual(heard, ['whitespace', 'whitespace']);
});

test('an editor gets the stored choice in its compartment, and its context', async () => {
  const { prefExtensions, prefActive, editorContext, setPref } = await editorModule('prefs');
  const { EditorState } = await codemirror();
  const make = () => EditorState.create({ extensions: prefExtensions({ compact: true, readOnly: false }) });
  assert.equal(prefActive(make(), 'whitespace'), false);
  setPref('whitespace', true);
  const state = make();
  assert.equal(prefActive(state, 'whitespace'), true);
  assert.deepEqual(state.facet(editorContext), { compact: true, readOnly: false });
});

test('the one editor has the preferences; a box without a status bar is compact', async () => {
  const { editorExtensions } = await editorModule('core');
  const { editorContext } = await editorModule('prefs');
  const { EditorState } = await codemirror();
  const context = options => EditorState.create({ extensions: editorExtensions(options).extensions }).facet(editorContext);
  assert.equal(context({ filename: 'a.js' }).compact, false);
  assert.equal(context({ filename: 'q.cypher', statusBar: false }).compact, true);
  assert.equal(context({ filename: 'a.js', merge: true, statusBar: false, readOnly: true }).compact, true);
});

test('the right-click menu ticks the preferences', async () => {
  const { menuItems } = await editorModule('context-menu');
  const { setPref } = await editorModule('prefs');
  const { EditorState, EditorView } = await codemirror();
  setPref('whitespace', true);
  const view = { state: EditorState.create({ extensions: EditorView.editable.of(false) }), dispatch() {}, focus() {} };
  const item = menuItems(view).find(i => i && i.label === 'Show Whitespace');
  assert.equal(item.checked, true);
});

test('the language servers\' switch goes to the main process, not back when the change comes from there', async () => {
  const { setPref, readPref } = await editorModule('prefs');
  const told = [];
  window.api = { setLanguageServers: on => told.push(on) };
  setPref('languageServers', false);
  assert.deepEqual(told, [false]);
  assert.equal(readPref('languageServers'), false);
  setPref('languageServers', true, { fromApp: true });
  assert.deepEqual(told, [false], 'from the main process: not sent back');
  assert.equal(readPref('languageServers'), true);
  delete window.api;
});
