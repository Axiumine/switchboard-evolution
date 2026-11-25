const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Go to Symbol (public/editor/symbols.mjs) on the languages' real parsers.
const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

async function symbols(filename, doc) {
  const { EditorState } = await import('@codemirror/state');
  const { getLanguageExt, languageNameField, languageName } = await editorModule('languages');
  const { documentSymbols } = await editorModule('symbols');
  const state = EditorState.create({ doc, extensions: [getLanguageExt(filename), languageNameField.init(() => languageName(filename))] });
  return documentSymbols(state).map(s => [s.name, s.kind, s.depth, s.container]);
}

test('TypeScript: classes and their methods, functions, arrow functions, interfaces, types, enums', async () => {
  const doc = 'export class Cart { add(item) {} static s = () => 1 }\nfunction checkout() {}\nconst format = () => 1\nlet plain = 3\ninterface Item {}\ntype T = string\nenum E { A }';
  assert.deepEqual(await symbols('shop.ts', doc), [
    ['Cart', 'class', 0, ''], ['add', 'method', 1, 'Cart'], ['s', 'function', 1, 'Cart'],
    ['checkout', 'function', 0, ''], ['format', 'function', 0, ''], ['Item', 'interface', 0, ''], ['T', 'type', 0, ''], ['E', 'enum', 0, ''],
  ]);
});

test('Python, Rust and Go', async () => {
  assert.deepEqual(await symbols('a.py', 'class A:\n    def m(self):\n        pass\ndef f():\n    pass\n'),
    [['A', 'class', 0, ''], ['m', 'function', 1, 'A'], ['f', 'function', 0, '']]);
  assert.deepEqual((await symbols('a.rs', 'struct S {}\nimpl S { fn new() -> S { S {} } }\nfn main() {}\n')).map(s => s[0]), ['S', 'S', 'new', 'main']);
  assert.deepEqual((await symbols('a.go', 'package main\ntype T struct {}\nfunc (t T) M() {}\nfunc main() {}\n')).map(s => s[0]), ['T', 'M', 'main']);
});

test('Markdown headings by level, top-level keys of JSON and YAML', async () => {
  assert.deepEqual(await symbols('notes.md', '# Title\n\ntext\n\n## Sub ##\n\nSetext\n===\n'),
    [['Title', 'heading', 0, ''], ['Sub', 'heading', 1, ''], ['Setext', 'heading', 0, '']]);
  assert.deepEqual((await symbols('a.json', '{ "a": 1, "b": { "c": 2 } }')).map(s => s[0]), ['a', 'b']);
  assert.deepEqual((await symbols('a.yaml', 'a: 1\nb:\n  c: 2\n')).map(s => s[0]), ['a', 'b']);
});

test('languages without a syntax tree: shell functions, TOML tables, Dockerfile stages', async () => {
  assert.deepEqual((await symbols('run.sh', 'foo() {\n}\nfunction bar {\n}\n')).map(s => s[0]), ['foo', 'bar']);
  assert.deepEqual((await symbols('Cargo.toml', '[package]\nname = "x"\n[[bin]]\n')).map(s => s[0]), ['package', 'bin']);
  assert.deepEqual((await symbols('Dockerfile', 'FROM node:22 AS build\nRUN x\nFROM alpine\n')).map(s => s[0]), ['build', 'FROM alpine']);
});

test('the list is filtered as you type: the start of a name first, then a part, then its letters in order', async () => {
  const { filterSymbols } = await editorModule('symbols');
  const list = [{ name: 'getUser' }, { name: 'setUser' }, { name: 'user' }, { name: 'checkout' }];
  assert.deepEqual(filterSymbols(list, 'user').map(s => s.name), ['user', 'getUser', 'setUser']);
  assert.deepEqual(filterSymbols(list, 'chk').map(s => s.name), ['checkout']);
  assert.equal(filterSymbols(list, '').length, 4);
});
