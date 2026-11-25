const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const stored = new Map();
globalThis.window = globalThis.window || new EventTarget();
globalThis.localStorage = {
  getItem: key => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => { stored.set(key, String(value)); },
};

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

test('file URIs as Node writes them, and back', async () => {
  const { fileUri, uriPath } = await editorModule('addons/lsp');
  for (const p of ['/Users/me/My Project/src/a@b.ts', '/w/c++/x [1].h', '/w/100%/é#?.md', '/w/a|b^c,d;e=f&g+h$i.go', '/w/~x/{y}`z\'(1)!*.rs']) {
    assert.equal(fileUri(p), pathToFileURL(p).href, p);
  }
  const p = '/Users/me/My Project/src/a@b.ts';
  assert.equal(uriPath(fileUri(p)), p);
  assert.equal(uriPath('file:///C:/work/x.cs'), 'C:\\work\\x.cs');
  assert.equal(fileUri('C:\\work\\x.cs'), 'file:///C:/work/x.cs');
});

test('a definition answer becomes places, whatever its shape', async () => {
  const { locations } = await editorModule('addons/lsp');
  const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } };
  assert.deepEqual(locations({ uri: 'file:///a.c', range }), [{ file: '/a.c', line: 4, character: 2 }]);
  assert.deepEqual(locations([{ targetUri: 'file:///b.c', targetRange: range, targetSelectionRange: { start: { line: 6, character: 0 }, end: range.end } }]), [{ file: '/b.c', line: 6, character: 0 }]);
  assert.deepEqual(locations(null), []);
});

test('a rename\'s edits by URI, from changes and documentChanges', async () => {
  const { editsByUri } = await editorModule('addons/lsp');
  const edit = { range: {}, newText: 'x' };
  const byUri = editsByUri({ changes: { 'file:///a': [edit] }, documentChanges: [{ textDocument: { uri: 'file:///b', version: 2 }, edits: [edit, edit] }] });
  assert.deepEqual([...byUri.keys()], ['file:///a', 'file:///b']);
  assert.equal(byUri.get('file:///b').length, 2);
});

test('an editor of a file on disk has F12, F2 and Go Back; the menu offers Go to Definition there only', async () => {
  const { editorExtensions } = await editorModule('core');
  const { menuItems } = await editorModule('context-menu');
  const { EditorState } = await import('@codemirror/state');
  const { keymap, EditorView } = await import('@codemirror/view');
  const state = EditorState.create({ extensions: editorExtensions({ filename: '/p/a.c', file: '/p/a.c' }).extensions });
  const keys = state.facet(keymap).flat().map(b => b.key || b.mac);
  for (const key of ['F12', 'F2', 'Ctrl--', 'Ctrl-Shift--']) assert.ok(keys.includes(key), key);
  const fakeView = s => ({ state: s, dispatch() {}, focus() {} });
  assert.ok(menuItems(fakeView(state)).some(i => i && i.label === 'Go to Definition'));
  const plain = EditorState.create({ extensions: editorExtensions({ filename: 'notes.md' }).extensions });
  assert.ok(!menuItems(fakeView(plain)).some(i => i && i.label === 'Go to Definition'));
  assert.ok(EditorView);
});

test('the status bar names the server by its first language and says its state', async () => {
  const { lspLabel, lspTitle } = await editorModule('status-bar');
  assert.equal(lspLabel({ label: 'C, C++ and Objective-C', state: 'ready' }), '{ } C');
  assert.equal(lspLabel({ label: 'TypeScript and JavaScript', state: 'not-installed' }), '{ } TypeScript (not installed)');
  assert.equal(lspLabel(null), '');
  assert.match(lspTitle({ label: 'Go', state: 'not-installed', install: 'go install x' }), /not installed: go install x/);
  assert.match(lspTitle({ label: 'Rust', state: 'indexing', message: 'Loading packages' }), /Loading packages/);
});
