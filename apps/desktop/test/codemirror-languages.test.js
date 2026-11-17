const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LanguageDescription } = require('@codemirror/language');

const setup = fs.readFileSync(path.join(__dirname, '../public/codemirror-setup.js'), 'utf8');
const slice = (from, to) => setup.slice(setup.indexOf(from), setup.indexOf(to));

/**
 * The language table and file detection of codemirror-setup.js. Each
 * language's support is a stand-in that carries the language's name in
 * .language.name, as a LanguageSupport carries its Language.
 */
function languages() {
  class LanguageSupport { constructor(language) { this.language = language; } }
  const support = (name) => () => new LanguageSupport({ name });
  const context = vm.createContext({
    LanguageDescription,
    LanguageSupport,
    StreamLanguage: { define: (mode) => ({ name: mode }) },
    javascript: (o = {}) => new LanguageSupport({ name: o.typescript ? (o.jsx ? 'tsx' : 'typescript') : (o.jsx ? 'jsx' : 'javascript') }),
    python: support('python'), json: support('json'), html: support('html'), css: support('css'), rust: support('rust'),
    go: support('go'), java: support('java'), xml: support('xml'), yaml: support('yaml'), sql: support('sql'), cpp: support('cpp'),
    shell: 'shell', diff: 'diff', toml: 'toml', dockerFile: 'dockerfile',
    markdown: ({ codeLanguages }) => Object.assign(new LanguageSupport({ name: 'markdown' }), { codeLanguages }),
    markdownLanguage: {},
  });
  vm.runInContext(slice('// A LanguageSupport, not the bare Language', '// ── Read-Only File Viewer'), context);
  vm.runInContext('this.getLanguageExt = getLanguageExt; this.CODE_BLOCK_LANGUAGES = CODE_BLOCK_LANGUAGES;', context);
  const lang = (filename) => context.getLanguageExt(filename).language.name;
  return { lang, getLanguageExt: context.getLanguageExt, CODE_BLOCK_LANGUAGES: context.CODE_BLOCK_LANGUAGES };
}

test('a file gets its language by extension, in any case', () => {
  const { lang } = languages();
  assert.equal(lang('src/app.ts'), 'typescript');
  assert.equal(lang('View.TSX'), 'tsx');
  assert.equal(lang('main.mjs'), 'javascript');
  assert.equal(lang('a.jsx'), 'jsx');
  assert.equal(lang('script.py'), 'python');
  assert.equal(lang('include/x.h'), 'cpp');
  assert.equal(lang('icon.svg'), 'xml');
  assert.equal(lang('deploy.sh'), 'shell');
  assert.equal(lang('fix.patch'), 'diff');
  assert.equal(lang('Cargo.toml'), 'toml');
});

test('a Dockerfile is known by its name, wherever it is', () => {
  const { lang } = languages();
  assert.equal(lang('Dockerfile'), 'dockerfile');
  assert.equal(lang('docker/web.v2/Dockerfile'), 'dockerfile');
});

test('Markdown, an unknown file and no name open as Markdown with code blocks', () => {
  const { getLanguageExt, CODE_BLOCK_LANGUAGES } = languages();
  for (const name of ['plan.md', 'page.mdx', 'Gemfile.rb', 'Makefile', '', undefined]) {
    const ext = getLanguageExt(name);
    assert.equal(ext.language.name, 'markdown', String(name));
    assert.equal(ext.codeLanguages, CODE_BLOCK_LANGUAGES);
  }
});

test('a Markdown code block finds its language by name or alias', () => {
  const { CODE_BLOCK_LANGUAGES } = languages();
  const cases = {
    ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', js: 'JavaScript', py: 'Python', json: 'JSON',
    jsonc: 'JSON', bash: 'Shell', sh: 'Shell', zsh: 'Shell', console: 'Shell', diff: 'Diff', yml: 'YAML',
    toml: 'TOML', dockerfile: 'Dockerfile', rust: 'Rust', golang: 'Go', 'c++': 'C++', c: 'C++', sql: 'SQL', md: 'Markdown',
  };
  for (const [info, name] of Object.entries(cases)) {
    assert.equal(LanguageDescription.matchLanguageName(CODE_BLOCK_LANGUAGES, info, true)?.name, name, info);
  }
  assert.equal(LanguageDescription.matchLanguageName(CODE_BLOCK_LANGUAGES, 'cobol', true), null);
});

test('every code block language loads a support with its language (Markdown reads .language.parser)', async () => {
  const { CODE_BLOCK_LANGUAGES } = languages();
  for (const desc of CODE_BLOCK_LANGUAGES) {
    const loaded = await desc.load();
    assert.ok(loaded.language && loaded.language.name, desc.name);
  }
  assert.equal((await CODE_BLOCK_LANGUAGES.find(l => l.name === 'Shell').load()).language.name, 'shell');
});
