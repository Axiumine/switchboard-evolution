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

// ── Column selection from the keyboard (Shift+Alt+Cmd+Arrows) ──────

/** An editor state with the cursors' extensions, and a target the commands can run on. */
async function columnEditor(doc, ranges, { tabSize = 4 } = {}) {
  const { multipleCursors } = await editorModule('cursors');
  const { EditorState, EditorSelection } = await codemirror();
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([from, to = from]) => EditorSelection.range(from, to))),
    extensions: [multipleCursors(), EditorState.tabSize.of(tabSize)],
  });
  const target = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  const run = async (...names) => {
    const commands = await editorModule('cursors');
    for (const name of names) assert.equal(commands[name](target), true, name);
  };
  const ranges_ = () => state.selection.ranges.map(r => [r.anchor, r.head]);
  return { target, run, ranges: ranges_, main: () => state.selection.mainIndex, move: (pos) => { state = state.update({ selection: { anchor: pos } }).state; } };
}

test('Shift+Alt+Cmd+Down adds a cursor below in the same column, line by line; a short line gets one at its end', async () => {
  // Lines start at 0, 5, 10 and 13; "ij" is shorter than the column.
  const ed = await columnEditor('abcd\nefgh\nij\nklmn', [[3]]);
  await ed.run('columnSelectDown');
  assert.deepEqual(ed.ranges(), [[3, 3], [8, 8]]);
  await ed.run('columnSelectDown', 'columnSelectDown');
  assert.deepEqual(ed.ranges(), [[3, 3], [8, 8], [12, 12], [16, 16]]);
  assert.equal(ed.main(), 3, 'the newest cursor is the main one, so the editor follows it');
});

test('Up shrinks the box back, and goes on above where it started', async () => {
  const ed = await columnEditor('abcd\nefgh\nijkl', [[6]]);
  await ed.run('columnSelectDown', 'columnSelectUp');
  assert.deepEqual(ed.ranges(), [[6, 6]]);
  await ed.run('columnSelectUp');
  assert.deepEqual(ed.ranges(), [[1, 1], [6, 6]]);
  assert.equal(ed.main(), 0);
});

test('Left and Right widen the box into a selection on every line', async () => {
  const ed = await columnEditor('abcd\nefgh\nij', [[1]]);
  await ed.run('columnSelectDown', 'columnSelectDown', 'columnSelectRight', 'columnSelectRight');
  assert.deepEqual(ed.ranges(), [[1, 3], [6, 8], [11, 12]]);
  await ed.run('columnSelectLeft', 'columnSelectLeft', 'columnSelectLeft');
  assert.deepEqual(ed.ranges(), [[1, 0], [6, 5], [11, 10]]);
});

test('the box keeps visual columns across tabs', async () => {
  // "\tx": the x is at column 4; the line below has four spaces before its y.
  const ed = await columnEditor('\tx\n    y', [[1]]);
  await ed.run('columnSelectDown');
  assert.deepEqual(ed.ranges(), [[1, 1], [7, 7]]);
});

test('moving the cursor another way starts a new box', async () => {
  const ed = await columnEditor('abcd\nefgh\nijkl\nmnop', [[0]]);
  await ed.run('columnSelectDown');
  ed.move(12);
  await ed.run('columnSelectDown');
  assert.deepEqual(ed.ranges(), [[12, 12], [17, 17]]);
});

test('PageDown takes a page of lines at once, and stops at the last line', async () => {
  const doc = Array.from({ length: 5 }, (_, i) => `line${i}`).join('\n');
  const ed = await columnEditor(doc, [[2]]);
  await ed.run('columnSelectPageDown');
  assert.equal(ed.ranges().length, 5);
});

test('the column keys are VS Code\'s, in every editor, read-only or not', async () => {
  const { multiCursorKeymap } = await editorModule('cursors');
  const { editorExtensions } = await editorModule('core');
  const { EditorState, keymap } = await codemirror();
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].map(k => `Mod-Shift-Alt-${k}`);
  for (const key of keys) assert.ok(multiCursorKeymap.some(b => b.key === key), key);
  for (const readOnly of [false, true]) {
    const bindings = EditorState.create({ extensions: editorExtensions({ filename: 'a.md', readOnly }).extensions }).facet(keymap).flat();
    for (const key of keys) assert.ok(bindings.some(b => b.key === key), `${key}, readOnly ${readOnly}`);
  }
});
