const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const jsonc = require('jsonc-parser');

const stored = new Map();
globalThis.window = globalThis.window || new EventTarget();
globalThis.localStorage = { getItem: k => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)) };

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

test('JSON is formatted with the file\'s indentation, its comments kept', async () => {
  const { formatJson } = await editorModule('format');
  const text = '{"a":1, // one\n"b":[1,2]}\n';
  assert.equal(formatJson(text, { insertSpaces: true, size: 4 }, jsonc), '{\n    "a": 1, // one\n    "b": [\n        1,\n        2\n    ]\n}\n');
  assert.equal(formatJson('{"a":{"b":1}}', { insertSpaces: false, size: 4 }, jsonc), '{\n\t"a": {\n\t\t"b": 1\n\t}\n}');
  assert.equal(formatJson('{}', {}, null), null, 'without jsonc-parser there is nothing to do here');
});

test('Format Selection formats only the selected part', async () => {
  const { formatJson } = await editorModule('format');
  const text = '{"keep":   1,\n"fix":{"x":2}}';
  const from = text.indexOf('"fix"');
  const out = formatJson(text, { range: { from, to: text.length - 1 } }, jsonc);
  assert.ok(out.startsWith('{"keep":   1,'), out);
  assert.match(out, /"fix": \{\n\s+"x": 2\n\s*\}/);
});

test('the change is the smallest one: the part that differs', async () => {
  const { minimalChange } = await editorModule('format');
  assert.deepEqual(minimalChange('let a=1;\nlet b=2;\n', 'let a=1;\nlet b = 2;\n'), { from: 14, to: 15, insert: ' = ' });
  assert.equal(minimalChange('same', 'same'), null);
});

test('the keys and the menu: in an editable editor only', async () => {
  const { editorExtensions } = await editorModule('core');
  const { menuItems } = await editorModule('context-menu');
  const { EditorState } = await import('@codemirror/state');
  const { keymap } = await import('@codemirror/view');
  const make = readOnly => EditorState.create({ extensions: editorExtensions({ filename: '/p/a.js', file: '/p/a.js', readOnly }).extensions });
  const keys = s => s.facet(keymap).flat().map(b => b.key);
  assert.ok(keys(make(false)).includes('Shift-Alt-f') && keys(make(false)).includes('Mod-k Mod-f'));
  assert.ok(!keys(make(true)).includes('Shift-Alt-f'));
  const labels = s => menuItems({ state: s, dispatch() {}, focus() {} }).filter(Boolean).map(i => i.label);
  assert.ok(labels(make(false)).includes('Format Document') && labels(make(false)).includes('Format Selection'));
  assert.ok(!labels(make(true)).includes('Format Document'));
});
