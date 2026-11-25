const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The find bar's logic (public/editor/find.mjs) with the ES modules of
// CodeMirror, the same instances the editor's modules import.
const find = () => import(pathToFileURL(path.join(__dirname, '../public/editor/find.mjs')).href);
const codemirror = async () => ({ ...(await import('@codemirror/state')), ...(await import('@codemirror/view')) });

test('the matches of a query, inside the selection when it is given, without empty ones', async () => {
  const { findMatches, editorRegExp } = await find();
  const text = 'cart Cart\ncart\nCARTS';
  const all = findMatches(text, editorRegExp({ query: 'cart' }));
  assert.deepEqual(all, [{ from: 0, to: 4 }, { from: 5, to: 9 }, { from: 10, to: 14 }, { from: 15, to: 19 }]);
  assert.equal(findMatches(text, editorRegExp({ query: 'cart', matchCase: true })).length, 2);
  assert.equal(findMatches(text, editorRegExp({ query: 'cart', wholeWord: true })).length, 3);
  // Find in Selection: only what lies wholly inside a range.
  assert.deepEqual(findMatches(text, editorRegExp({ query: 'cart' }), [{ from: 3, to: 14 }]), [{ from: 5, to: 9 }, { from: 10, to: 14 }]);
  assert.deepEqual(findMatches('aaa', editorRegExp({ query: 'x*', isRegex: true })), []);
  assert.equal(findMatches('a'.repeat(50), editorRegExp({ query: 'a' }), null, 10).length, 10);
});

test('^ and $ work at every line, and a query can span lines', async () => {
  const { findMatches, editorRegExp } = await find();
  const text = 'export a\nconst b\nexport c';
  assert.equal(findMatches(text, editorRegExp({ query: '^export', isRegex: true })).length, 2);
  assert.equal(findMatches(text, editorRegExp({ query: 'b$', isRegex: true })).length, 1);
  assert.deepEqual(findMatches(text, editorRegExp({ query: 'a\nconst' })), [{ from: 7, to: 14 }]);
});

test('next and previous go round the document from the selection', async () => {
  const { nextMatchIndex } = await find();
  const matches = [{ from: 0, to: 2 }, { from: 5, to: 7 }, { from: 10, to: 12 }];
  assert.equal(nextMatchIndex(matches, 0, 2, 1), 1);
  assert.equal(nextMatchIndex(matches, 3, 3, 1), 1);
  assert.equal(nextMatchIndex(matches, 10, 12, 1), 0);
  assert.equal(nextMatchIndex(matches, 5, 7, -1), 0);
  assert.equal(nextMatchIndex(matches, 0, 2, -1), 2);
  assert.equal(nextMatchIndex([], 0, 0, 1), -1);
});

test('go to line takes "line", "line:column" and "line,column"', async () => {
  const { parseLineTarget } = await find();
  assert.deepEqual(parseLineTarget('12'), { line: 12, column: 1 });
  assert.deepEqual(parseLineTarget(' 12:5 '), { line: 12, column: 5 });
  assert.deepEqual(parseLineTarget(':3,7'), { line: 3, column: 7 });
  assert.equal(parseLineTarget('x'), null);
  assert.equal(parseLineTarget(''), null);
});

test('the matches live in the editor state, follow edits, and the scope follows them too', async () => {
  const { searchState, setSearchQuery, editorRegExp } = await find();
  const { EditorState } = await codemirror();
  let state = EditorState.create({ doc: 'cart cart\ncart', extensions: searchState });
  state = state.update({ effects: setSearchQuery.of({ regex: editorRegExp({ query: 'cart' }), scope: [{ from: 0, to: 9 }] }) }).state;
  assert.deepEqual(state.field(searchState).matches, [{ from: 0, to: 4 }, { from: 5, to: 9 }]);
  // Replacing the first match with a longer word keeps both inside the scope.
  state = state.update({ changes: { from: 0, to: 4, insert: 'basket' } }).state;
  assert.deepEqual(state.field(searchState).scope, [{ from: 0, to: 11 }]);
  assert.deepEqual(state.field(searchState).matches, [{ from: 7, to: 11 }]);
  state = state.update({ effects: setSearchQuery.of(null) }).state;
  assert.equal(state.field(searchState), null);
});

test('what was searched is remembered, once, the latest last, at most 50', async () => {
  const stored = new Map();
  globalThis.localStorage = { getItem: k => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)) };
  try {
    const { pushHistory, readHistory } = await find();
    pushHistory('find-test', 'cart');
    pushHistory('find-test', 'total');
    pushHistory('find-test', 'cart');
    assert.deepEqual(readHistory('find-test'), ['total', 'cart']);
    for (let i = 0; i < 60; i++) pushHistory('find-test', `q${i}`);
    assert.equal(readHistory('find-test').length, 50);
    assert.equal(readHistory('find-test').at(-1), 'q59');
    assert.deepEqual(JSON.parse(stored.get('editorFindHistory:find-test')).at(-1), 'q59');
  } finally {
    delete globalThis.localStorage;
  }
});

test('the keys are VS Code\'s: Cmd/Ctrl+F, replace, F3, Cmd+G on macOS, Ctrl+G go to line', async () => {
  const { findKeymap, KEY_SCOPE } = await find();
  const { EditorState, keymap } = await codemirror();
  const bindings = EditorState.create({ extensions: findKeymap() }).facet(keymap).flat();
  const has = (props) => bindings.some(b => Object.entries(props).every(([k, v]) => b[k] === v));
  assert.ok(has({ key: 'Mod-f' }));
  assert.ok(has({ mac: 'Mod-Alt-f', win: 'Ctrl-h', linux: 'Ctrl-h' }));
  assert.ok(has({ key: 'F3' }) && bindings.find(b => b.key === 'F3').shift);
  assert.ok(has({ mac: 'Mod-g' }) && !bindings.find(b => b.mac === 'Mod-g').key, 'Cmd+G finds the next match on macOS only');
  assert.ok(has({ key: 'Ctrl-g' }), 'Ctrl+G goes to a line everywhere');
  assert.ok(has({ mac: 'Mod-e' }));
  assert.ok(has({ key: 'Mod-s' }));
  // The panels around an editor run these from their toolbars.
  for (const b of bindings.filter(b => b.key !== 'Escape')) assert.match(b.scope, new RegExp(KEY_SCOPE), JSON.stringify(b));
});
