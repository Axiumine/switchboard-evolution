const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const search = require('../project-search');
const textSearch = require('../public/text-search');

const haveGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

function makeFolder(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-search-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8');

test('buildSearchRegExp: match case, whole word, regex, and a readable error', () => {
  const plain = textSearch.buildSearchRegExp({ query: 'a.b' });
  assert.equal(plain.test('xA.Bx'), true);
  assert.equal(plain.test('axb'), false);
  assert.equal(textSearch.buildSearchRegExp({ query: 'a.b', matchCase: true }).test('A.B'), false);
  const word = textSearch.buildSearchRegExp({ query: 'cat', wholeWord: true });
  assert.deepEqual(textSearch.matchesInLine(word, 'cat concat cat_ (cat) città').map(m => m.column), [0, 17]);
  assert.equal(textSearch.buildSearchRegExp({ query: 'a.b', isRegex: true }).test('axb'), true);
  assert.throws(() => textSearch.buildSearchRegExp({ query: '(', isRegex: true }), /Invalid regular expression/);
  assert.throws(() => textSearch.buildSearchRegExp({ query: '' }), /Type something/);
});

test('a regex replacement takes \\n, \\t, \\\\ and the case of a group (\\u \\l \\U \\L), as VS Code', () => {
  const m = /(\w+)-(\w+)/.exec('foo-BAR');
  assert.equal(textSearch.expandReplacement('$1\\n$2\\t\\\\', m), 'foo\nBAR\t\\');
  assert.equal(textSearch.expandReplacement('\\U$1 \\L$2', m), 'FOO bar');
  assert.equal(textSearch.expandReplacement('\\u$1 \\l$2', m), 'Foo bAR');
  assert.equal(textSearch.expandReplacement('\\u\\u$1', m), 'FOo');
  // A case op waits for the next group; an unknown escape stays as typed.
  assert.equal(textSearch.expandReplacement('\\Ux-$1 \\q', m), 'x-FOO \\q');
  const named = /(?<k>\w+)/.exec('key');
  assert.equal(textSearch.expandReplacement('\\U$<k>', named), 'KEY');
  assert.equal(textSearch.replacementFor({ query: '(\\w+)', isRegex: true }, 'abc', '\\U$1'), 'ABC');
  // Not a regular expression: the replace text as typed.
  assert.equal(textSearch.replacementFor({ query: 'abc' }, 'abc', '\\U$1\\n'), '\\U$1\\n');
});

test('preserveCase writes the replacement in the case of the match, as VS Code\'s Preserve Case', () => {
  assert.equal(textSearch.preserveCase('cart', 'Basket'), 'basket');
  assert.equal(textSearch.preserveCase('CART', 'basket'), 'BASKET');
  assert.equal(textSearch.preserveCase('Cart', 'basket'), 'Basket');
  assert.equal(textSearch.preserveCase('cART', 'Basket'), 'basket');
  assert.equal(textSearch.preserveCase('Foo-Bar', 'baz-qux'), 'Baz-Qux');
  assert.equal(textSearch.preserveCase('foo_BAR', 'baz_qux'), 'baz_QUX');
  assert.equal(textSearch.preserveCase('123', 'abc'), 'abc');
  assert.equal(textSearch.preserveCase('', 'abc'), 'abc');
});

test('matchesInLine skips empty matches and replacementFor expands groups only for a regex', () => {
  const re = textSearch.buildSearchRegExp({ query: 'x*', isRegex: true });
  assert.deepEqual(textSearch.matchesInLine(re, 'axxbx').map(m => [m.column, m.text]), [[1, 'xx'], [4, 'x']]);
  const opts = { query: '(\\w+)@(\\w+)', isRegex: true };
  assert.equal(textSearch.replacementFor(opts, 'me@host', '$2 at $1 ($&) $$'), 'host at me (me@host) $');
  assert.equal(textSearch.replacementFor({ query: 'me' }, 'me', '$1 $&'), '$1 $&');
  const named = { query: '(?<k>\\w+)=', isRegex: true };
  assert.equal(textSearch.replacementFor(named, 'key=', '$<k>:'), 'key:');
  // A lookbehind sees the whole line when the context is given.
  const behind = { query: '(?<=a)b', isRegex: true };
  assert.equal(textSearch.replacementFor(behind, 'b', '[$&]', { line: 'ab', column: 1 }), '[b]');
});

test('globListMatcher: names at any depth, anchored paths, folders and braces', () => {
  const m = textSearch.globListMatcher('*.ts, docs, src/**/*.{js,mjs}');
  assert.equal(m('a/b/c.ts'), true);
  assert.equal(m('docs/x.md'), true);
  assert.equal(m('a/docs/x.md'), true);
  assert.equal(m('src/x/y.mjs'), true);
  assert.equal(m('src/y.js'), true);
  assert.equal(m('lib/src/y.js'), false);
  assert.equal(m('README.md'), false);
  assert.equal(textSearch.globListMatcher('  '), null);
});

test('searchRoot finds matches by line with context, honours include/exclude and the limit', () => {
  const root = makeFolder({
    'a.txt': 'one Foo\nfoo foo\n',
    'src/b.js': 'const foo = 1; // foo\n',
    'node_modules/dep/c.js': 'foo\n',
    'bin.dat': Buffer.from([0x66, 0x6f, 0x6f, 0, 1, 2]),
  });
  try {
    const all = search.searchRoot(root, { query: 'foo' });
    assert.equal(all.ok, true);
    assert.deepEqual(all.files.map(f => f.path), ['a.txt', 'src/b.js']);
    assert.equal(all.matchCount, 5);
    assert.deepEqual(all.files[0].matches[0], { line: 1, column: 4, length: 3, text: 'Foo', before: 'one ', after: '' });
    assert.equal(all.files[1].matches[1].before, 'const foo = 1; // ');
    assert.deepEqual(search.searchRoot(root, { query: 'foo', matchCase: true }).matchCount, 4);
    assert.deepEqual(search.searchRoot(root, { query: 'foo', include: 'src' }).files.map(f => f.path), ['src/b.js']);
    assert.deepEqual(search.searchRoot(root, { query: 'foo', exclude: '*.js' }).files.map(f => f.path), ['a.txt']);
    const limited = search.searchRoot(root, { query: 'foo', maxResults: 2 });
    assert.equal(limited.matchCount, 2);
    assert.equal(limited.limitHit, true);
    assert.match(search.searchRoot(root, { query: '[', isRegex: true }).error, /Invalid regular expression/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('in a Git checkout the search leaves out what .gitignore ignores', { skip: !haveGit && 'git not installed' }, () => {
  const root = makeFolder({ '.gitignore': 'out/\n', 'out/x.txt': 'needle\n', 'in.txt': 'needle\n', 'new.txt': 'needle\n' });
  try {
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', 'in.txt', '.gitignore'], { cwd: root });
    assert.deepEqual(search.searchRoot(root, { query: 'needle' }).files.map(f => f.path), ['in.txt', 'new.txt']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replaceInRoot replaces every match, or only the given ones, and keeps line endings', () => {
  const root = makeFolder({ 'a.txt': 'foo bar\r\nfoo foo\r\n', 'b.txt': 'x foo\n', 'c.txt': 'foo\n' });
  try {
    const one = search.searchRoot(root, { query: 'foo' });
    const a = one.files.find(f => f.path === 'a.txt');
    // Only the second match of line 2 in a.txt, and every match of b.txt.
    const result = search.replaceInRoot(root, {
      query: 'foo', replace: 'baz',
      files: [{ path: 'a.txt', matches: [a.matches[2]] }, { path: 'b.txt' }],
    });
    assert.deepEqual(result, { ok: true, replaced: 2, files: 2, skipped: [] });
    assert.equal(read(root, 'a.txt'), 'foo bar\r\nfoo baz\r\n');
    assert.equal(read(root, 'b.txt'), 'x baz\n');
    assert.equal(read(root, 'c.txt'), 'foo\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replaceInRoot expands regex groups, skips changed matches and files outside the folder', () => {
  const root = makeFolder({ 'a.txt': 'name=one\nname=two\n' });
  try {
    const found = search.searchRoot(root, { query: '(\\w+)=(\\w+)', isRegex: true });
    fs.writeFileSync(path.join(root, 'a.txt'), 'name=one\nname=TWO\n');
    const result = search.replaceInRoot(root, {
      query: '(\\w+)=(\\w+)', isRegex: true, replace: '$2: $1',
      files: [{ path: 'a.txt', matches: found.files[0].matches }, { path: '../escape.txt' }],
    });
    assert.equal(read(root, 'a.txt'), 'one: name\nname=TWO\n');
    assert.equal(result.replaced, 1);
    assert.deepEqual(result.skipped.map(s => s.path).sort(), ['../escape.txt', 'a.txt']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replaceInRoot keeps the case of each match with Preserve Case, whole files and chosen matches alike', () => {
  const root = makeFolder({ 'a.txt': 'color Color COLOR\n', 'b.txt': 'Color\n' });
  try {
    const found = search.searchRoot(root, { query: 'color' });
    const b = found.files.find(f => f.path === 'b.txt');
    const result = search.replaceInRoot(root, {
      query: 'color', replace: 'shade', preserveCase: true,
      files: [{ path: 'a.txt' }, { path: 'b.txt', matches: b.matches }],
    });
    assert.equal(result.replaced, 4);
    assert.equal(read(root, 'a.txt'), 'shade Shade SHADE\n');
    assert.equal(read(root, 'b.txt'), 'Shade\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('search and replace run in a worker thread', async () => {
  const root = makeFolder({ 'a.txt': 'hello world\n' });
  try {
    const found = await search.search(root, { query: 'world' });
    assert.equal(found.matchCount, 1);
    const done = await search.replace(root, { query: 'world', replace: 'there', files: [{ path: 'a.txt' }] });
    assert.equal(done.replaced, 1);
    assert.equal(read(root, 'a.txt'), 'hello there\n');
    assert.match((await search.search(path.join(root, 'missing'), { query: 'x' })).error, /not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── A whole document: the editors' find bars (desktop and phone) ────

test('a document\'s matches: ^ at every line, inside a scope, empty ones skipped', () => {
  const regex = textSearch.documentRegExp({ query: '^a', isRegex: true });
  assert.ok(regex.flags.includes('m') && regex.flags.includes('g'));
  assert.deepEqual(textSearch.findAllMatches('ab\nab\nxa', regex), [{ from: 0, to: 1 }, { from: 3, to: 4 }]);
  assert.deepEqual(textSearch.findAllMatches('ab\nab\nab', regex, [{ from: 3, to: 9 }]), [{ from: 3, to: 4 }, { from: 6, to: 7 }]);
  assert.deepEqual(textSearch.findAllMatches('abc', textSearch.documentRegExp({ query: 'x*', isRegex: true })), []);
  assert.equal(textSearch.findAllMatches('aaaa', textSearch.documentRegExp({ query: 'a' }), null, 2).length, 2);
});

test('next and previous go round the end of the document', () => {
  const matches = [{ from: 0, to: 1 }, { from: 5, to: 6 }, { from: 9, to: 10 }];
  assert.equal(textSearch.nextMatchIndex(matches, 5, 6, 1), 2);
  assert.equal(textSearch.nextMatchIndex(matches, 9, 10, 1), 0);
  assert.equal(textSearch.nextMatchIndex(matches, 0, 1, -1), 2);
  assert.equal(textSearch.nextMatchIndex([], 0, 0, 1), -1);
  assert.equal(textSearch.firstMatchAfter(matches, 5), 1);
});

test('a replacement in a document: groups, case changes and Preserve Case', () => {
  const text = 'let fooBar = FOO_BAR;';
  const regex = textSearch.documentRegExp({ query: '(foo)(bar)', isRegex: true });
  const match = { from: 4, to: 10 };
  assert.equal(textSearch.documentReplacement(regex, { isRegex: true }, text, match, '\\u$2$1'), 'Barfoo');
  const plain = textSearch.documentRegExp({ query: 'foobar' });
  assert.equal(textSearch.documentReplacement(plain, { preserveCase: true }, text, match, 'bazQux'), 'bazQux');
  assert.equal(textSearch.documentReplacement(plain, { preserveCase: true }, 'FOOBAR', { from: 0, to: 6 }, 'bazqux'), 'BAZQUX');
});

test('replacementFor keeps the match\'s case with preserveCase (the Files tab\'s Search & Replace)', () => {
  assert.equal(textSearch.replacementFor({ query: 'color', preserveCase: true }, 'Color', 'shade'), 'Shade');
  assert.equal(textSearch.replacementFor({ query: 'color', preserveCase: true }, 'COLOR', 'shade'), 'SHADE');
  assert.equal(textSearch.replacementFor({ query: 'color' }, 'COLOR', 'shade'), 'shade', 'off: as typed');
  assert.equal(textSearch.replacementFor({ query: '(c)olor', isRegex: true, preserveCase: true }, 'Color', '$1ool'), 'Cool');
});
