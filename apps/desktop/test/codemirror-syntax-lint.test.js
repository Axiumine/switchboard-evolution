const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const jsonc = require('jsonc-parser');

globalThis.window = globalThis.window || new EventTarget();
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

test('JSON: a missing comma is found where it is, with a readable message', async () => {
  const { jsonDiagnostics } = await editorModule('syntax-lint');
  const text = '{\n  "a": 1\n  "b": 2\n}';
  const [d] = jsonDiagnostics(text, { parser: jsonc });
  assert.equal(d.severity, 'error');
  assert.equal(d.message, 'Comma expected');
  assert.equal(text.slice(d.from, d.to), '"b"');
});

test('a .json file is strict; JSON with comments allows comments and trailing commas', async () => {
  const { jsonDiagnostics, JSONC_FILE } = await editorModule('syntax-lint');
  const text = '{\n  // the port\n  "port": 80,\n}';
  assert.ok(jsonDiagnostics(text, { parser: jsonc }).length > 0);
  assert.deepEqual(jsonDiagnostics(text, { jsonc: true, parser: jsonc }), []);
  for (const f of ['/p/tsconfig.json', '/p/tsconfig.build.json', '/p/.vscode/settings.json', '/p/a.jsonc', '/p/.devcontainer.json']) assert.ok(JSONC_FILE.test(f), f);
  for (const f of ['/p/package.json', '/p/data.json']) assert.ok(!JSONC_FILE.test(f), f);
  assert.deepEqual(jsonDiagnostics('   ', { parser: jsonc }), [], 'an empty file is not an error');
});

test('YAML: what its parser could not read', async () => {
  const { yamlDiagnostics } = await editorModule('syntax-lint');
  const { EditorState } = await import('@codemirror/state');
  const { ensureSyntaxTree } = await import('@codemirror/language');
  const { yaml } = await import('@codemirror/lang-yaml');
  const state = doc => { const s = EditorState.create({ doc, extensions: yaml() }); ensureSyntaxTree(s, doc.length, 5000); return s; };
  assert.deepEqual(yamlDiagnostics(state('on:\n  push:\n    branches: [master]\nsteps:\n  - run: make # ok\n')), []);
  const bad = yamlDiagnostics(state('a: [1, 2\nb: c\n'));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].message, 'YAML syntax error');
  assert.deepEqual([bad[0].from, bad[0].to], [12, 13], 'the last character, not the line break: it is underlined');
});

test('every editor that is not a small box has the check', async () => {
  const fs = require('node:fs');
  const core = fs.readFileSync(path.join(__dirname, '../public/editor/core.mjs'), 'utf8');
  assert.match(core, /syntaxLintCompartment\.of\(compact \? \[\] : syntaxLint\(\)\)/);
  const hook = fs.readFileSync(path.join(__dirname, '../public/editor/lsp-hook.mjs'), 'utf8');
  assert.match(hook, /syntaxLintCompartment\.reconfigure\(\[\]\)/, 'off while a language server gives its own');
});
