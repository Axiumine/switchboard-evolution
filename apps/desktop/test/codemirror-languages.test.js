const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { LanguageDescription } = require('@codemirror/language');

// The editor's language table (public/editor/languages.mjs), as the bundle has it.
const languages = () => import(pathToFileURL(path.join(__dirname, '../public/editor/languages.mjs')).href);

test('a file gets its language by extension, in any case', async () => {
  const { getLanguageExt, languageName } = await languages();
  const cases = {
    'src/app.ts': 'TypeScript', 'View.TSX': 'TSX', 'main.mjs': 'JavaScript', 'a.jsx': 'JSX', 'script.py': 'Python',
    'include/x.h': 'C++', 'icon.svg': 'XML', 'deploy.sh': 'Shell', 'fix.patch': 'Diff', 'Cargo.toml': 'TOML', 'calls.cypher': 'Cypher',
  };
  for (const [file, name] of Object.entries(cases)) assert.equal(languageName(file), name, file);
  // And the parser that comes with it.
  assert.equal(getLanguageExt('src/app.ts').language.name, 'typescript');
  assert.equal(getLanguageExt('script.py').language.name, 'python');
  assert.equal(getLanguageExt('deploy.sh').language.name, 'shell');
  assert.equal(getLanguageExt('icon.svg').language.name, 'xml');
});

test('a Dockerfile is known by its name, wherever it is', async () => {
  const { languageName } = await languages();
  assert.equal(languageName('Dockerfile'), 'Dockerfile');
  assert.equal(languageName('docker/web.v2/Dockerfile'), 'Dockerfile');
  assert.equal(languageName('Dockerfile.md'), 'Markdown');
});

test('Markdown, an unknown file and no name open as Markdown', async () => {
  const { getLanguageExt, languageName } = await languages();
  for (const name of ['plan.md', 'page.mdx', 'Gemfile.rb', 'Makefile', '', undefined]) {
    assert.equal(getLanguageExt(name).language.name, 'markdown', String(name));
    assert.equal(languageName(name), 'Markdown', String(name));
  }
});

test('a language can be chosen by its name (the status bar), Markdown for an unknown one', async () => {
  const { LANGUAGE_NAMES, languageByName } = await languages();
  assert.ok(LANGUAGE_NAMES.includes('TypeScript') && LANGUAGE_NAMES.includes('Shell'));
  assert.equal(languageByName('Python').language.name, 'python');
  assert.equal(languageByName('Shell').language.name, 'shell');
  assert.equal(languageByName('COBOL').language.name, 'markdown');
});

test('a Markdown code block finds its language by name or alias', async () => {
  const { CODE_BLOCK_LANGUAGES } = await languages();
  const cases = {
    ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', js: 'JavaScript', py: 'Python', json: 'JSON',
    jsonc: 'JSON', bash: 'Shell', sh: 'Shell', zsh: 'Shell', console: 'Shell', diff: 'Diff', yml: 'YAML',
    toml: 'TOML', dockerfile: 'Dockerfile', rust: 'Rust', golang: 'Go', 'c++': 'C++', c: 'C++', sql: 'SQL', md: 'Markdown', cypher: 'Cypher',
  };
  for (const [info, name] of Object.entries(cases)) {
    assert.equal(LanguageDescription.matchLanguageName(CODE_BLOCK_LANGUAGES, info, true)?.name, name, info);
  }
  assert.equal(LanguageDescription.matchLanguageName(CODE_BLOCK_LANGUAGES, 'cobol', true), null);
});

test('every code block language loads a support with its language (Markdown reads .language.parser)', async () => {
  const { CODE_BLOCK_LANGUAGES } = await languages();
  for (const desc of CODE_BLOCK_LANGUAGES) {
    const loaded = await desc.load();
    assert.ok(loaded.language && loaded.language.parser, desc.name);
  }
  assert.equal((await CODE_BLOCK_LANGUAGES.find(l => l.name === 'Shell').load()).language.name, 'shell');
});
