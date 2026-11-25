const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const stored = new Map();
globalThis.window = globalThis.window || new EventTarget();
globalThis.localStorage = {
  getItem: key => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => { stored.set(key, String(value)); },
};

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

/** A real editor state for `filename`, fully parsed, and the sticky lines for the line holding `marker`. */
async function sticky(filename, doc, marker, options = {}) {
  const { editorExtensions } = await editorModule('core');
  const { stickyScopeLines } = await editorModule('sticky-scroll');
  const { EditorState } = await import('@codemirror/state');
  const { ensureSyntaxTree } = await import('@codemirror/language');
  const state = EditorState.create({ doc, extensions: editorExtensions({ filename, doc, ...options }).extensions });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const top = state.doc.lineAt(doc.indexOf(marker)).number;
  return stickyScopeLines(state, top).map(n => state.doc.line(n).text.trim());
}

test('JavaScript: the class, then the method, around a line in the method', async () => {
  const doc = [
    'const x = 1;',
    'class Shop {',
    '  constructor() {}',
    '  checkout(cart) {',
    '    for (const item of cart) {',
    '      pay(item); // here',
    '    }',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(await sticky('shop.js', doc, 'pay(item)'), ['class Shop {', 'checkout(cart) {', 'for (const item of cart) {']);
  assert.deepEqual(await sticky('shop.js', doc, 'const x'), [], 'nothing above the first block');
});

test('Python: the class and the def', async () => {
  const doc = ['class Shop:', '    def checkout(self):', '        total = 0', '        return total  # here', ''].join('\n');
  assert.deepEqual(await sticky('shop.py', doc, 'return total'), ['class Shop:', 'def checkout(self):']);
});

test('Markdown: the headings above, one per level', async () => {
  const doc = ['# Guide', '', '## Setup', '', 'text', '', '### Linux', '', 'apt install', '', '## Use', '', '```sh', '# not a heading', '```', '', 'run it  here'].join('\n');
  assert.deepEqual(await sticky('guide.md', doc, 'apt install'), ['# Guide', '## Setup', '### Linux']);
  assert.deepEqual(await sticky('guide.md', doc, 'run it'), ['# Guide', '## Use'], 'a later heading of the same level replaces the earlier one; "#" in code is not one');
});

test('YAML and JSON: the keys that open the nested blocks', async () => {
  const yaml = ['jobs:', '  build:', '    steps:', '      - run: make', '      - run: test  # here'].join('\n');
  const lines = await sticky('ci.yml', yaml, 'run: test');
  assert.ok(lines.includes('jobs:') && lines.includes('build:'), lines.join(' | '));
  const json = ['{', '  "a": {', '    "b": [', '      1,', '      2', '    ]', '  }', '}'].join('\n');
  assert.deepEqual(await sticky('x.json', json, '2\n'), ['{', '"a": {', '"b": [']);
});

test('without a syntax tree (shell, TOML: legacy modes) the indentation decides', async () => {
  const sh = ['deploy() {', '  if true; then', '    echo here', '  fi', '}'].join('\n');
  assert.deepEqual(await sticky('deploy.sh', sh, 'echo here'), ['deploy() {', 'if true; then']);
  const toml = ['[tool]', '  name = "a"', '  [tool.inner]', '    key = 1 # here'].join('\n');
  assert.deepEqual(await sticky('conf.toml', toml, 'key = 1'), ['[tool]', '[tool.inner]']);
});

test('at most five lines, the outermost', async () => {
  const doc = Array.from({ length: 7 }, (_, i) => `${'  '.repeat(i)}function f${i}() {`).join('\n')
    + `\n${'  '.repeat(7)}deep();\n${Array.from({ length: 7 }, (_, i) => `${'  '.repeat(6 - i)}}`).join('\n')}`;
  const lines = await sticky('deep.js', doc, 'deep()');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], 'function f0() {');
});

test('sticky scroll is on by default, never in a compact editor', async () => {
  const { editorExtensions } = await editorModule('core');
  const { prefActive } = await editorModule('prefs');
  const { EditorState } = await import('@codemirror/state');
  const make = options => EditorState.create({ extensions: editorExtensions(options).extensions });
  assert.equal(prefActive(make({ filename: 'a.js' }), 'stickyScroll'), true);
  assert.equal(prefActive(make({ filename: 'q.cypher', statusBar: false }), 'stickyScroll'), false);
});
