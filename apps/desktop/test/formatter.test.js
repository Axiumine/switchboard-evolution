const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFormatter, ignoreMatcher, editorconfigOptions, dataConfig, resolveOptions, appParserFor } = require('../formatter');

/** A project folder with `files` ({ relative path: text }), removed after `fn`. */
async function withFolder(files, fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-format-')));
  try {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const formatterIn = dir => createFormatter({ folderOf: f => (f.startsWith(dir) ? { projectId: 'p', folder: dir } : null), log: { warn() {} } });

test('the project\'s own Prettier wins, with what it resolves', async () => {
  await withFolder({
    'node_modules/prettier/package.json': JSON.stringify({ name: 'prettier', main: 'index.js' }),
    'node_modules/prettier/index.js': `module.exports = {
      getFileInfo: async (file, opts) => ({ ignored: false, inferredParser: 'babel', ignorePath: opts.ignorePath }),
      resolveConfig: async () => ({ semi: false }),
      format: async (text, opts) => 'PROJECT:' + JSON.stringify({ semi: opts.semi, filepath: opts.filepath.endsWith('a.js') }),
    };`,
    'src/a.js': 'let a = 1',
  }, async (dir) => {
    const result = await formatterIn(dir).format({ filePath: path.join(dir, 'src/a.js'), text: 'let a = 1' });
    assert.deepEqual(result, { formatted: 'PROJECT:{"semi":false,"filepath":true}', by: 'project' });
  });
});

test('without one, the app\'s Prettier formats with the file\'s own indentation', async () => {
  await withFolder({ 'a.ts': '' }, async (dir) => {
    const result = await formatterIn(dir).format({
      filePath: path.join(dir, 'a.ts'), text: 'function f(){return {a:1}}', indentation: { insertSpaces: false, size: 4 },
    });
    assert.equal(result.by, 'app');
    assert.equal(result.formatted, 'function f() {\n\treturn { a: 1 };\n}\n');
  });
});

test('the app\'s Prettier reads .prettierrc in YAML, its overrides, and .editorconfig', async () => {
  await withFolder({
    '.prettierrc': 'singleQuote: true\noverrides:\n  - files: "*.md"\n    options:\n      proseWrap: always\n      printWidth: 20\n',
    '.editorconfig': 'root = true\n[*]\nindent_style = space\nindent_size = 4\n',
    'b.js': '',
  }, async (dir) => {
    const f = formatterIn(dir);
    const js = await f.format({ filePath: path.join(dir, 'b.js'), text: 'if (x) {y("z")}' });
    assert.equal(js.formatted, "if (x) {\n    y('z');\n}\n");
    const md = await f.format({ filePath: path.join(dir, 'c.md'), text: 'one two three four five six seven eight\n' });
    assert.equal(md.formatted, 'one two three four\nfive six seven eight\n');
  });
});

test('a configuration that is code is not run: the file stays, with a message', async () => {
  await withFolder({ 'prettier.config.js': 'module.exports = { semi: false };', 'a.js': '' }, async (dir) => {
    const result = await formatterIn(dir).format({ filePath: path.join(dir, 'a.js'), text: 'let a = 1' });
    assert.equal(result.error, 'code-config');
    assert.match(result.message, /prettier\.config\.js/);
  });
});

test('.prettierignore keeps a file as it is; a language Prettier does not know is for the language server', async () => {
  await withFolder({ '.prettierignore': 'dist/\n*.min.js\n!keep.min.js\n', 'dist/x.js': '', 'a.go': '' }, async (dir) => {
    const f = formatterIn(dir);
    assert.equal((await f.format({ filePath: path.join(dir, 'dist/x.js'), text: 'a' })).ignored, true);
    assert.equal((await f.format({ filePath: path.join(dir, 'a.go'), text: 'package main' })).unsupported, true);
  });
  const ignored = ignoreMatcher(['dist/', '*.min.js', '!keep.min.js', '/root-only.md', 'docs/**/*.txt']);
  assert.equal(ignored('dist/a.js'), true);
  assert.equal(ignored('src/x.min.js'), true);
  assert.equal(ignored('src/keep.min.js'), false);
  assert.equal(ignored('root-only.md'), true);
  assert.equal(ignored('sub/root-only.md'), false);
  assert.equal(ignored('docs/a/b/c.txt'), true);
  assert.equal(ignored('src/a.js'), false);
});

test('a selection is formatted on its own (rangeStart, rangeEnd)', async () => {
  await withFolder({ 'a.js': '' }, async (dir) => {
    const text = 'let a  =  1\nlet b  =  2\n';
    const result = await formatterIn(dir).format({ filePath: path.join(dir, 'a.js'), text, range: { from: 12, to: 23 } });
    assert.equal(result.formatted, 'let a  =  1\nlet b = 2;\n');
  });
});

test('the pieces: parsers by extension, editorconfig sections, package.json\'s prettier key', () => {
  assert.equal(appParserFor('/x/a.tsx').parser, 'typescript');
  assert.equal(appParserFor('/x/a.rs'), null);
  const files = new Map([
    ['/w/.editorconfig', 'root = true\n[*.{js,ts}]\nindent_style = tab\ntab_width = 8\nend_of_line = crlf\n[*.md]\nmax_line_length = 72\n'],
  ]);
  const readFile = (f) => { if (!files.has(f)) throw new Error('none'); return files.get(f); };
  assert.deepEqual(editorconfigOptions('/w/src/a.js', '/w', { readFile }), { useTabs: true, tabWidth: 8, endOfLine: 'crlf' });
  assert.deepEqual(editorconfigOptions('/w/README.md', '/w', { readFile }), { printWidth: 72 });
  const pkg = dataConfig('/w/a.js', '/w', { exists: f => f === '/w/package.json', readFile: () => JSON.stringify({ prettier: { semi: false } }) });
  assert.deepEqual(pkg.options, { semi: false });
  const shared = dataConfig('/w/a.js', '/w', { exists: f => f === '/w/package.json', readFile: () => JSON.stringify({ prettier: '@company/prettier-config' }) });
  assert.ok(shared.code, 'a shared configuration is a package: code');
  assert.deepEqual(resolveOptions({ options: { semi: true, overrides: [{ files: ['*.test.js'], options: { semi: false } }] }, dir: '/w' }, '/w/a.test.js'), { semi: false });
});
