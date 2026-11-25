const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// The ES modules of @codemirror/state and view, the same instances the editor's modules import.
const codemirror = async () => ({ ...(await import('@codemirror/state')), ...(await import('@codemirror/view')) });

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);
const cursorsSource = fs.readFileSync(path.join(__dirname, '../public/editor/cursors.mjs'), 'utf8');
const slice = (from, to) => cursorsSource.slice(cursorsSource.indexOf(from), cursorsSource.indexOf(to, cursorsSource.indexOf(from)));

/** addCursorsAtLineEnds (editor/cursors.mjs), run on a real EditorState. */
async function lineEnds(doc, ranges) {
  const { addCursorsAtLineEnds } = await editorModule('cursors');
  const { EditorState, EditorSelection } = await codemirror();
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to))),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  const done = addCursorsAtLineEnds({ state, dispatch: (tr) => { state = tr.state; } });
  return { done, cursors: state.selection.ranges.map(r => [r.from, r.to]) };
}

test('Shift+Alt+I puts a cursor at the end of every selected line', async () => {
  // The three lines end at 3, 7 and 11.
  assert.deepEqual(await lineEnds('one\ntwo\nsix', [[1, 9]]), { done: true, cursors: [[3, 3], [7, 7], [11, 11]] });
});

test('a selection that ends at the start of a line leaves that line out', async () => {
  assert.deepEqual((await lineEnds('one\ntwo\nsix', [[0, 8]])).cursors, [[3, 3], [7, 7]]);
});

test('Cmd+Shift+L with only a cursor takes every occurrence of its word', async () => {
  const { selectAllOccurrences } = await editorModule('cursors');
  const { EditorState, EditorSelection } = await codemirror();
  let state = EditorState.create({ doc: 'foo = 1; bar = foo; foo()', selection: EditorSelection.cursor(1), extensions: EditorState.allowMultipleSelections.of(true) });
  const view = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  assert.equal(selectAllOccurrences(view), true);
  assert.deepEqual(state.selection.ranges.map(r => [r.from, r.to]), [[0, 3], [15, 18], [20, 23]]);
});

test('with no selection Shift+Alt+I does nothing', async () => {
  assert.equal((await lineEnds('one\ntwo', [[2, 2]])).done, false);
});

test('every editor and viewer allows several cursors: the one editor has them, read-only or not', async () => {
  const { editorExtensions } = await editorModule('core');
  const { EditorState } = await codemirror();
  for (const readOnly of [false, true]) {
    const state = EditorState.create({ extensions: editorExtensions({ filename: 'a.ts', readOnly }).extensions });
    assert.equal(state.facet(EditorState.allowMultipleSelections), true, `readOnly ${readOnly}`);
  }
  const multiple = slice('function multipleCursors()', '\n}\n');
  assert.match(multiple, /EditorState\.allowMultipleSelections\.of\(true\)/);
  assert.match(multiple, /drawSelection\(\)/);
  assert.match(multiple, /clickAddsSelectionRange/);
  assert.match(multiple, /rectangularSelection/);
});

test('the keys are VS Code\'s', async () => {
  const { multiCursorKeymap } = await editorModule('cursors');
  const keys = multiCursorKeymap.map(binding => binding.key);
  for (const key of ['Mod-d', 'Mod-Shift-l', 'Mod-l', 'Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown', 'Escape']) {
    assert.ok(keys.includes(key), key);
  }
  // Shift+Alt+I by its key code: on a Mac it types a character.
  assert.match(slice('const lineEndsKey', '});'), /event\.code !== 'KeyI'/);
});

test('a read-only viewer\'s text can take the focus, for those keys', async () => {
  const { editorExtensions } = await editorModule('core');
  const { EditorState, EditorView } = await codemirror();
  const attributes = readOnly => EditorState.create({ extensions: editorExtensions({ readOnly }).extensions })
    .facet(EditorView.contentAttributes).map(a => (typeof a === 'function' ? null : a)).filter(Boolean);
  assert.ok(attributes(true).some(a => a.tabindex === '0'));
  assert.ok(!attributes(false).some(a => a.tabindex === '0'));
});
