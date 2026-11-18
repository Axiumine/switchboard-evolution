const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EditorState, EditorSelection } = require('@codemirror/state');

const setup = fs.readFileSync(path.join(__dirname, '../public/codemirror-setup.js'), 'utf8');
const slice = (from, to) => setup.slice(setup.indexOf(from), setup.indexOf(to, setup.indexOf(from)));

/** addCursorsAtLineEnds from codemirror-setup.js, run on a real EditorState. */
function lineEnds(doc, ranges) {
  const context = vm.createContext({ EditorSelection });
  vm.runInContext(slice('/** Shift+Alt+I', 'const multiCursorKeymap'), context);
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to))),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  const done = context.addCursorsAtLineEnds({ state, dispatch: (tr) => { state = tr.state; } });
  // Array.from: the ranges' array was made in the vm's realm.
  return { done, cursors: Array.from(state.selection.ranges, (r) => [r.from, r.to]) };
}

test('Shift+Alt+I puts a cursor at the end of every selected line', () => {
  // The three lines end at 3, 7 and 11.
  const doc = 'one\ntwo\nsix';
  assert.deepEqual(lineEnds(doc, [[1, 9]]), { done: true, cursors: [[3, 3], [7, 7], [11, 11]] });
});

test('a selection that ends at the start of a line leaves that line out', () => {
  const doc = 'one\ntwo\nsix';
  assert.deepEqual(lineEnds(doc, [[0, 8]]).cursors, [[3, 3], [7, 7]]);
});

test('Cmd+Shift+L with only a cursor takes every occurrence of its word', () => {
  const { selectNextOccurrence, selectSelectionMatches } = require('@codemirror/search');
  const context = vm.createContext({ selectNextOccurrence, selectSelectionMatches });
  vm.runInContext(slice('/** Every occurrence of the selection', '/** Esc with several cursors'), context);
  let state = EditorState.create({ doc: 'foo = 1; bar = foo; foo()', selection: EditorSelection.cursor(1), extensions: EditorState.allowMultipleSelections.of(true) });
  const view = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  assert.equal(context.selectAllOccurrences(view), true);
  assert.deepEqual(Array.from(state.selection.ranges, (r) => [r.from, r.to]), [[0, 3], [15, 18], [20, 23]]);
});

test('with no selection Shift+Alt+I does nothing', () => {
  assert.equal(lineEnds('one\ntwo', [[2, 2]]).done, false);
});

test('every editor and viewer allows several cursors', () => {
  for (const factory of ['createPlanEditor', 'createReadOnlyViewer', 'createEditableViewer', 'createMergeViewer', 'createUnifiedMergeViewer']) {
    const body = slice(`function ${factory}(`, '\n}\n');
    assert.match(body, /multipleCursors\(\)/, factory);
  }
  const multiple = slice('function multipleCursors()', '\n}\n');
  assert.match(multiple, /EditorState\.allowMultipleSelections\.of\(true\)/);
  assert.match(multiple, /drawSelection\(\)/);
  assert.match(multiple, /clickAddsSelectionRange/);
  assert.match(multiple, /rectangularSelection/);
});

test('the keys are VS Code\'s', () => {
  const keys = slice('const multiCursorKeymap', '];');
  for (const key of ["'Mod-d'", "'Mod-Shift-l'", "'Mod-l'", "'Mod-Alt-ArrowUp'", "'Mod-Alt-ArrowDown'", "'Escape'"]) {
    assert.ok(keys.includes(key), key);
  }
  // Shift+Alt+I by its key code: on a Mac it types a character.
  assert.match(slice('const lineEndsKey', '});'), /event\.code !== 'KeyI'/);
});

test('a read-only viewer\'s text can take the focus, for those keys', () => {
  for (const factory of ['createReadOnlyViewer', 'createMergeViewer', 'createUnifiedMergeViewer']) {
    assert.match(slice(`function ${factory}(`, '\n}\n'), /focusableText/, factory);
  }
});
