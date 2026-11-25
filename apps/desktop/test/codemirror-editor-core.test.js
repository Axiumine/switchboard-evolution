const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The one editor (public/editor/core.mjs) and how it reads a file
// (indentation.mjs), on real editor states.
const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);
const coreSource = fs.readFileSync(path.join(__dirname, '../public/editor/core.mjs'), 'utf8');

async function stateFor(options) {
  const { EditorState } = await import('@codemirror/state');
  const { editorExtensions } = await editorModule('core');
  return EditorState.create({ doc: options.doc || '', extensions: editorExtensions(options).extensions });
}

test('every editor the app makes is the one editor', () => {
  for (const factory of ['createPlanEditor', 'createReadOnlyViewer', 'createEditableViewer', 'createMergeViewer', 'createUnifiedMergeViewer']) {
    const body = coreSource.slice(coreSource.indexOf(`function ${factory}(`), coreSource.indexOf('\n}\n', coreSource.indexOf(`function ${factory}(`)));
    assert.match(body, /return createCodeEditor\(/, factory);
  }
  // createCodeEditor builds both sides of a diff from editorExtensions too.
  const create = coreSource.slice(coreSource.indexOf('function createCodeEditor('), coreSource.indexOf('\n}\n', coreSource.indexOf('function createCodeEditor(')));
  assert.equal((create.match(/editorExtensions\(/g) || []).length, 3);
});

test('a read-only editor has the same view and keys, and nothing that edits', async () => {
  const { EditorView } = await import('@codemirror/view');
  const { EditorState } = await import('@codemirror/state');
  const { undo } = await import('@codemirror/commands');
  const readOnly = await stateFor({ doc: 'a', filename: 'a.ts', readOnly: true });
  const editable = await stateFor({ doc: 'a', filename: 'a.ts' });
  assert.equal(readOnly.readOnly, true);
  assert.equal(readOnly.facet(EditorView.editable), false);
  assert.equal(editable.readOnly, false);
  // Undo exists only where there is history.
  let edited = editable.update({ changes: { from: 1, insert: 'b' } }).state;
  assert.equal(undo({ state: edited, dispatch: (tr) => { edited = tr.state; } }), true);
  assert.equal(edited.doc.toString(), 'a');
  assert.equal(undo({ state: readOnly, dispatch() {} }), false);
  for (const state of [readOnly, editable]) assert.equal(state.facet(EditorState.allowMultipleSelections), true);
});

test('the language comes from the name (Markdown when asked or unknown), shown in the status bar', async () => {
  const { languageNameField } = await editorModule('languages');
  assert.equal((await stateFor({ filename: 'src/app.ts' })).field(languageNameField), 'TypeScript');
  assert.equal((await stateFor({ filename: 'plan.txt', language: 'markdown' })).field(languageNameField), 'Markdown');
  assert.equal((await stateFor({ filename: 'Makefile' })).field(languageNameField), 'Markdown');
});

test('the indentation and line breaks are the file\'s: found in its text', async () => {
  const { currentIndentation, eolField, textOf } = await editorModule('indentation');
  const four = await stateFor({ doc: 'a {\n    b {\n        c\n    }\n}\n', filename: 'a.js' });
  assert.deepEqual(currentIndentation(four), { insertSpaces: true, size: 4 });
  const tabs = await stateFor({ doc: 'a {\n\tb\n\tc\n}\n', filename: 'a.go' });
  assert.deepEqual(currentIndentation(tabs), { insertSpaces: false, size: 4 });
  const crlf = await stateFor({ doc: 'one\r\ntwo\r\n', filename: 'a.txt' });
  assert.equal(crlf.field(eolField), '\r\n');
  assert.equal(textOf(crlf), 'one\r\ntwo\r\n');
  assert.equal(textOf(await stateFor({ doc: 'one\ntwo\n' })), 'one\ntwo\n');
});

test('detectIndentation and detectEol, as VS Code guesses them', async () => {
  const { detectIndentation, detectEol, normalizeEol } = await editorModule('indentation');
  assert.deepEqual(detectIndentation('a\n  b\n    c\n  d\n'), { insertSpaces: true, size: 2, detected: true });
  assert.deepEqual(detectIndentation('a\n    b\n        c\n    d\n'), { insertSpaces: true, size: 4, detected: true });
  assert.deepEqual(detectIndentation('a\n\tb\n\t\tc\n  d\n'), { insertSpaces: false, size: 4, detected: true });
  assert.deepEqual(detectIndentation('no indentation\nat all\n'), { insertSpaces: true, size: 2, detected: false });
  assert.equal(detectEol('a\r\nb\r\nc\n'), '\r\n');
  assert.equal(detectEol('a\nb\nc\r\n'), '\n');
  assert.equal(detectEol('one line'), '\n');
  assert.equal(normalizeEol('a\r\nb\nc\rd', '\r\n'), 'a\r\nb\r\nc\r\nd');
});

test('convert indentation rewrites only the leading spaces and tabs', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { convertIndentationChanges } = await editorModule('indentation');
  const state = EditorState.create({ doc: 'a\n    b  c\n\tx\n', extensions: EditorState.tabSize.of(4) });
  const toTabs = state.update({ changes: convertIndentationChanges(state, { insertSpaces: false, size: 4 }) }).state.doc.toString();
  assert.equal(toTabs, 'a\n\tb  c\n\tx\n');
  const toSpaces = state.update({ changes: convertIndentationChanges(state, { insertSpaces: true, size: 2 }) }).state.doc.toString();
  assert.equal(toSpaces, 'a\n    b  c\n    x\n');
});

test('a file read again changes only what differs: the cursor stays on its text, the line breaks follow', async () => {
  const { EditorState, EditorSelection } = await import('@codemirror/state');
  const { setEditorText, editorText } = await editorModule('core');
  const { eolField } = await editorModule('indentation');
  let state = EditorState.create({ doc: 'one\ntwo\nthree', selection: EditorSelection.cursor(9), extensions: eolField });
  const view = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; } };
  assert.equal(setEditorText(view, 'zero\none\ntwo\nthree'), true);
  assert.equal(state.doc.toString(), 'zero\none\ntwo\nthree');
  assert.equal(state.selection.main.head, 14, 'still before "hree"');
  assert.equal(setEditorText(view, 'zero\r\none\r\ntwo\r\nthree'), true, 'only the line breaks');
  assert.equal(state.field(eolField), '\r\n');
  assert.equal(editorText(view), 'zero\r\none\r\ntwo\r\nthree');
  assert.equal(setEditorText(view, 'zero\r\none\r\ntwo\r\nthree'), false, 'the same text: nothing to do');
  // The edited side of a split diff.
  assert.equal(editorText({ a: view, b: view }), 'zero\r\none\r\ntwo\r\nthree');
});
