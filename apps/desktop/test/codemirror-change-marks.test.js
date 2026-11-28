const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const git = require('../git');

// The change marks beside the line numbers (public/editor/change-marks.mjs),
// on real editor states, and the staged copy they are measured from (git.js).
const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

/** An editor state comparing `text` with `base`. */
async function editing(base, text = base) {
  const { EditorState } = await import('@codemirror/state');
  const { changeMarks, setChangeBase } = await editorModule('change-marks');
  return EditorState.create({ doc: text, extensions: changeMarks() }).update({ effects: setChangeBase.of(base) }).state;
}

/** The marks as { line: 'added' | 'changed' | '^' (removed above) | '_' (below) }. */
async function shown(state) {
  const { changeField } = await editorModule('change-marks');
  const out = {};
  for (const [line, mark] of [...state.field(changeField).marks].sort((a, b) => a[0] - b[0])) {
    out[line] = [mark.kind, mark.deletedAbove && '^', mark.deletedBelow && '_'].filter(Boolean).join(' ');
  }
  return out;
}

const marksOf = async (base, text) => shown(await editing(base, text));

test('the same text has no marks', async () => {
  assert.deepEqual(await marksOf('a\nb\nc', 'a\nb\nc'), {});
  assert.deepEqual(await marksOf('a\r\nb\r\n', 'a\nb\n'), {}, 'line breaks do not count');
});

test('a new line is added, wherever it goes', async () => {
  assert.deepEqual(await marksOf('a\nb\nc', 'a\nb\nnew\nc'), { 3: 'added' });
  assert.deepEqual(await marksOf('a\nb\nc', 'new\na\nb\nc'), { 1: 'added' });
  assert.deepEqual(await marksOf('a\nb', 'a\nb\nc'), { 3: 'added' });
  assert.deepEqual(await marksOf('a\nb\n', 'a\nb\nc\n'), { 3: 'added' });
  assert.deepEqual(await marksOf('a\nb\nc', 'a\nb\n\nc'), { 3: 'added' }, 'Enter at the end of a line');
});

test('an edited line is changed, and a new one next to it stays new', async () => {
  assert.deepEqual(await marksOf('a\nb\nc', 'a\nbX\nc'), { 2: 'changed' });
  assert.deepEqual(await marksOf('a\nfoo bar\nc', 'a\nsomething\nfoo baz\nc'), { 2: 'added', 3: 'changed' });
  assert.deepEqual(await marksOf('a\nfoo bar\nc', 'a\nfoo baz\nsomething\nc'), { 2: 'changed', 3: 'added' });
});

test('removed lines are a mark on the boundary where they were', async () => {
  assert.deepEqual(await marksOf('a\nb\nc', 'a\nc'), { 2: '^' });
  assert.deepEqual(await marksOf('a\nb\nc', 'b\nc'), { 1: '^' });
  assert.deepEqual(await marksOf('a\nb\nc', 'a\nb'), { 2: '_' });
  assert.deepEqual(await marksOf('a\n\nb', 'a\nb'), { 2: '^' });
  assert.deepEqual(await marksOf('a\nfoo one\nfoo two\nz', 'a\nfoo two!\nz'), { 2: 'changed ^' });
});

test('an empty base: every line is new; an empty text against it has no marks', async () => {
  assert.deepEqual(await marksOf('', 'a\nb'), { 1: 'added', 2: 'added' });
  assert.deepEqual(await marksOf('', ''), {});
});

test('the marks follow the typing, and go when the text is as the base again', async () => {
  let state = await editing('a\nb\nc');
  state = state.update({ changes: { from: 3, insert: '!' } }).state;
  assert.deepEqual(await shown(state), { 2: 'changed' });
  state = state.update({ changes: { from: state.doc.length, insert: '\nd' } }).state;
  assert.deepEqual(await shown(state), { 2: 'changed', 4: 'added' });
  state = state.update({ changes: [{ from: 3, to: 4 }, { from: state.doc.length - 2, to: state.doc.length }] }).state;
  assert.deepEqual(await shown(state), {});
});

test('with no base there are no marks', async () => {
  const { setChangeBase } = await editorModule('change-marks');
  const state = await editing('a', 'b');
  assert.deepEqual(await shown(state.update({ effects: setChangeBase.of(null) }).state), {});
});

test('a run of lines of one kind has rounded ends only where it begins and ends', async () => {
  const { markerFor, changeField } = await editorModule('change-marks');
  const { marks } = (await editing('a\nd', 'a\nb\nc\nd')).field(changeField);
  assert.equal(markerFor(marks, 1, 1), null);
  const [second, third] = [markerFor(marks, 2, 2), markerFor(marks, 3, 3)];
  assert.deepEqual([second.kind, second.start, second.end], ['added', true, false]);
  assert.deepEqual([third.kind, third.start, third.end], ['added', false, true]);
  // A folded block shows what it hides.
  assert.equal(markerFor(marks, 1, 4).kind, 'added');
});

test('only a file editor that can be typed in has the gutter', async () => {
  const { EditorState } = await import('@codemirror/state');
  const { editorExtensions } = await editorModule('core');
  const { changeField } = await editorModule('change-marks');
  const has = options => EditorState.create({ extensions: editorExtensions(options).extensions }).field(changeField, false) !== undefined;
  assert.equal(has({ changeMarks: true }), true);
  assert.equal(has({}), false);
  assert.equal(has({ changeMarks: true, readOnly: true }), false);
  assert.equal(has({ changeMarks: true, merge: true }), false);
});

test('the staged copy is the base of a tracked file; git has none for the others', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-marks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  run('init', '-q');
  run('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(dir, 'sub folder'));
  const file = path.join(dir, 'sub folder', 'a file.txt');
  fs.writeFileSync(file, 'staged\n');
  assert.equal(await git.stagedVersion(file), null, 'untracked');
  run('add', '.');
  fs.writeFileSync(file, 'edited\n');
  assert.equal(await git.stagedVersion(file), 'staged\n');
  assert.equal(await git.stagedVersion(path.join(dir, 'gone.txt')), null);
  assert.equal(await git.stagedVersion('a file.txt'), null, 'not an absolute path');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-marks-out-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'b.txt'), 'b');
  assert.equal(await git.stagedVersion(path.join(outside, 'b.txt')), null, 'not in a repository');
});
