const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The commands on lines and case (public/editor/text-commands.mjs), on real editor states.
const commands = () => import(pathToFileURL(path.join(__dirname, '../public/editor/text-commands.mjs')).href);

async function run(name, doc, ranges, { readOnly = false } = {}) {
  const cmd = (await commands())[name];
  const { EditorState, EditorSelection } = await import('@codemirror/state');
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([from, to = from]) => EditorSelection.range(from, to))),
    extensions: [EditorState.allowMultipleSelections.of(true), EditorState.readOnly.of(readOnly)],
  });
  const done = cmd({ state, dispatch: (tr) => { state = tr.state; } });
  return { done, doc: state.doc.toString(), sel: state.selection.ranges.map(r => [r.from, r.to]) };
}

test('sort lines: the selected lines, or the whole document with only a cursor', async () => {
  assert.deepEqual(await run('sortLinesAscending', 'b\na\nc', [[1]]), { done: true, doc: 'a\nb\nc', sel: [[1, 1]] });
  // Lines 2-4 selected (from "b" to "c"): the first and last stay.
  assert.deepEqual(await run('sortLinesDescending', 'x\nb\na\nc\ny', [[2, 7]]), { done: true, doc: 'x\nc\nb\na\ny', sel: [[2, 7]] });
  assert.equal((await run('sortLinesAscending', 'a\nb', [[0]])).done, false, 'already in order');
});

test('delete duplicate lines and trim trailing whitespace', async () => {
  assert.equal((await run('deleteDuplicateLines', 'a\nb\na\nb\nc', [[0]])).doc, 'a\nb\nc');
  assert.equal((await run('trimTrailingWhitespace', 'a  \nb\t\nc', [[0]])).doc, 'a\nb\nc');
});

test('join lines: one space between them, the indentation of the joined one gone', async () => {
  assert.equal((await run('joinLines', 'foo  \n    bar\nbaz', [[1]])).doc, 'foo bar\nbaz');
  assert.equal((await run('joinLines', 'a\n b\n c\nd', [[0, 6]])).doc, 'a b c\nd');
  assert.equal((await run('joinLines', 'a\n\nb', [[0]])).doc, 'a\nb');
});

test('upper, lower and title case: the selection, or the word at a cursor, every cursor', async () => {
  assert.deepEqual(await run('upperCase', 'hello straße world', [[8]]), { done: true, doc: 'hello STRASSE world', sel: [[8, 8]] });
  assert.deepEqual(await run('lowerCase', 'ABC DEF', [[0, 3], [4, 7]]), { done: true, doc: 'abc def', sel: [[0, 3], [4, 7]] });
  assert.equal((await run('toTitleCase', "hello world it's", [[0, 16]])).doc, "Hello World It's");
  // The selection stays on the text when it grows (ß is SS).
  assert.deepEqual((await run('upperCase', 'ß x', [[0, 1]])).sel, [[0, 2]]);
});

test('nothing changes in a read-only editor', async () => {
  for (const name of ['sortLinesAscending', 'deleteDuplicateLines', 'trimTrailingWhitespace', 'joinLines', 'upperCase']) {
    const r = await run(name, 'b \na \na', [[0, 5]], { readOnly: true });
    assert.deepEqual([r.done, r.doc], [false, 'b \na \na'], name);
  }
});
