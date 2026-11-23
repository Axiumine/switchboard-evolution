// What the Pull Requests view's search reads from GitHub (pull-request-search.js
// in main) and how it matches, marks and names what it finds
// (public/pull-request-search.js), with the People filter's pure parts.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../pull-requests');
const search = require('../pull-request-search');
const {
  prGlobRegExp, prParseSearch, prGlobMatches, prSearchMatch, prTextsStale, prSearchWhereText, prSearchRanges, prMarkHtml, prFileHit,
  prPeopleChoices, prPeopleLabel, prTogglePerson, prByPeople,
} = require('../public/pull-request-search');

const DIR = '/code/widgets';

function setup(answer) {
  const calls = [];
  pr.init({
    git: { remoteList: async () => [{ name: 'origin', url: 'git@github.com:acme/widgets.git' }], configListIncludes: async () => [] },
    runGh: async (args, opts = {}) => {
      calls.push({ args, opts, input: opts.input ? JSON.parse(opts.input) : null });
      return answer(args, opts, calls.length);
    },
  });
  return calls;
}

const json = data => ({ code: 0, stderr: '', stdout: JSON.stringify({ data }) });

function textsNode(number, extra = {}) {
  return {
    number,
    updatedAt: '2026-03-01T10:00:00Z',
    body: `Body of ${number}`,
    comments: { totalCount: 1, nodes: [{ body: 'A comment' }, { body: '  ' }] },
    reviews: { totalCount: 1, nodes: [{ body: 'Looks fine' }] },
    reviewThreads: { totalCount: 1, nodes: [{ comments: { totalCount: 1, nodes: [{ body: 'On line 3' }] } }] },
    files: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: 'db/001.sql' }, { path: 'src/app.js' }] },
    ...extra,
  };
}

// --- Main: reading the texts ---

test('texts: one request for several pull requests, one alias each, with their messages and file paths', async () => {
  const calls = setup(() => json({ repository: { p0: textsNode(12), p1: textsNode(7) } }));
  const result = await search.texts(DIR, { numbers: [12, 7, 12] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
  assert.deepEqual(calls[0].input.variables, { owner: 'acme', repo: 'widgets', n0: 12, n1: 7 });
  assert.match(calls[0].input.query, /p0: pullRequest\(number: \$n0\) \{ \.\.\.Texts \}/);
  assert.match(calls[0].input.query, /p1: pullRequest\(number: \$n1\)/);
  // Never the code: the files' paths only, no patch, no diff.
  assert.doesNotMatch(calls[0].input.query, /patch|diff/i);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items[0], {
    number: 12, updatedAt: '2026-03-01T10:00:00Z', body: 'Body of 12',
    comments: ['A comment', 'Looks fine', 'On line 3'], files: ['db/001.sql', 'src/app.js'], truncated: false,
  });
  assert.equal(result.items[1].number, 7);
});

test('texts: a pull request with more than 100 files reads the rest of their paths', async () => {
  const many = textsNode(3, { files: { totalCount: 201, pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [{ path: 'a.sql' }] } });
  const calls = setup((args, opts, n) => {
    if (n === 1) return json({ repository: { p0: many } });
    if (n === 2) return json({ repository: { pullRequest: { files: { pageInfo: { hasNextPage: true, endCursor: 'c2' }, nodes: [{ path: 'b.sql' }] } } } });
    return json({ repository: { pullRequest: { files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: 'c.sql' }] } } } });
  });
  const result = await search.texts(DIR, { numbers: [3] });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].input.variables, { owner: 'acme', repo: 'widgets', number: 3, after: 'c1' });
  assert.equal(calls[2].input.variables.after, 'c2');
  assert.deepEqual(result.items[0].files, ['a.sql', 'b.sql', 'c.sql']);
  assert.equal(result.items[0].truncated, false);
});

test('texts: more messages than were read say so', async () => {
  setup(() => json({ repository: { p0: textsNode(5, { comments: { totalCount: 140, nodes: [{ body: 'x' }] } }) } }));
  const result = await search.texts(DIR, { numbers: [5] });
  assert.equal(result.items[0].truncated, true);
});

test('texts: refuses what is not a short list of pull request numbers, and passes GitHub\'s refusal on', async () => {
  const calls = setup(() => ({ code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' }));
  for (const numbers of [undefined, [], ['1; rm'], [0], [1.5], Array.from({ length: 21 }, (_, i) => i + 1)]) {
    assert.equal((await search.texts(DIR, { numbers })).code, 'bad-request');
  }
  assert.equal(calls.length, 0);
  const failed = await search.texts(DIR, { numbers: [1] });
  assert.equal(failed.ok, undefined);
  assert.match(failed.error, /502/);
});

// --- The search's words ---

test('a search is words, quoted phrases and file patterns', () => {
  const parsed = prParseSearch('  login "two words" *.sql #12 Login migrations/*.sql ');
  assert.equal(parsed.raw, 'login "two words" *.sql #12 Login migrations/*.sql');
  assert.deepEqual(parsed.terms.map(t => [t.kind, t.text]), [
    ['text', 'login'], ['text', 'two words'], ['glob', '*.sql'], ['text', '#12'], ['glob', 'migrations/*.sql'],
  ]);
  assert.equal(parsed.terms[3].number, 12);
  assert.equal(parsed.terms[2].path, false);
  assert.equal(parsed.terms[4].path, true);
  assert.deepEqual(prParseSearch('').terms, []);
  // A quote left open runs to the end.
  assert.deepEqual(prParseSearch('"half open').terms.map(t => t.text), ['half open']);
});

test('a pattern finds files by name, or by the end of their path, case aside', () => {
  const name = prParseSearch('*.sql').terms[0];
  assert.equal(prGlobMatches(name, 'db/migrations/001_init.sql'), true);
  assert.equal(prGlobMatches(name, 'SCHEMA.SQL'), true);
  assert.equal(prGlobMatches(name, 'db/notes.sql.md'), false);
  const sub = prParseSearch('migrations/*.sql').terms[0];
  assert.equal(prGlobMatches(sub, 'db/migrations/001.sql'), true);
  assert.equal(prGlobMatches(sub, 'migrations/001.sql'), true);
  assert.equal(prGlobMatches(sub, 'migrations/old/001.sql'), false);
  const anchored = prParseSearch('/migrations/*.sql').terms[0];
  assert.equal(prGlobMatches(anchored, 'migrations/001.sql'), true);
  assert.equal(prGlobMatches(anchored, 'db/migrations/001.sql'), false);
  const deep = prParseSearch('src/**/*.test.js').terms[0];
  assert.equal(prGlobMatches(deep, 'src/a/b/c.test.js'), true);
  assert.equal(prGlobMatches(deep, 'src/c.test.js'), true);
  assert.equal(prGlobRegExp('file?.txt').test('file1.txt'), true);
  assert.equal(prGlobRegExp('a+b(*).txt').test('a+b(1).txt'), true);
});

const PR = { number: 12, title: 'Add the login page', updatedAt: '2026-03-01T10:00:00Z' };
const TEXTS = {
  number: 12, updatedAt: '2026-03-01T10:00:00Z', body: 'Uses the session table.',
  comments: ['Please rename the TABLE', 'ok'], files: ['db/001_sessions.sql', 'src/login.js'],
};

test('every word must be found: in the title, the number, the description, the comments or the files', () => {
  assert.deepEqual(prSearchMatch(PR, TEXTS, prParseSearch('login')), {
    match: true, where: { title: true, body: false, comments: 0, files: ['src/login.js'] },
  });
  assert.deepEqual(prSearchMatch(PR, TEXTS, prParseSearch('table')).where, { title: false, body: true, comments: 1, files: [] });
  assert.deepEqual(prSearchMatch(PR, TEXTS, prParseSearch('*.sql')).where.files, ['db/001_sessions.sql']);
  assert.equal(prSearchMatch(PR, TEXTS, prParseSearch('#12')).match, true);
  assert.equal(prSearchMatch(PR, TEXTS, prParseSearch('#13')).match, false);
  assert.equal(prSearchMatch(PR, TEXTS, prParseSearch('login *.sql')).match, true);
  assert.equal(prSearchMatch(PR, TEXTS, prParseSearch('login *.py')).match, false);
  // The code is not looked through: a word only in a diff is not found.
  assert.equal(prSearchMatch(PR, TEXTS, prParseSearch('SELECT')).match, false);
  assert.equal(prSearchMatch(PR, TEXTS, prParseSearch('')).match, true);
});

test('before its texts come, a pull request answers by its title alone, or waits', () => {
  assert.equal(prSearchMatch(PR, null, prParseSearch('login')).match, true);
  assert.equal(prSearchMatch(PR, null, prParseSearch('table')).match, null);
  assert.equal(prSearchMatch(PR, null, prParseSearch('*.sql')).match, null);
});

test('texts are read again once GitHub has changed the pull request since', () => {
  assert.equal(prTextsStale(null, PR), true);
  assert.equal(prTextsStale(TEXTS, PR), false);
  assert.equal(prTextsStale(TEXTS, { ...PR, updatedAt: '2026-03-02T00:00:00Z' }), true);
  // Read after the list was: newer than the row, not behind it.
  assert.equal(prTextsStale({ ...TEXTS, updatedAt: '2026-03-05T00:00:00Z' }, PR), false);
});

test('where the words were found, in words', () => {
  assert.equal(prSearchWhereText({ title: true, body: false, comments: 0, files: [] }), '');
  assert.equal(prSearchWhereText({ body: true, comments: 0, files: [] }), 'description');
  assert.equal(prSearchWhereText({ body: true, comments: 1, files: ['a'] }), 'description, 1 comment and 1 file');
  assert.equal(prSearchWhereText({ body: false, comments: 2, files: ['a', 'b'] }), '2 comments and 2 files');
});

test('the words are marked in text, escaped, overlapping pieces merged; a pattern marks a name whole', () => {
  const s = prParseSearch('log login');
  assert.deepEqual(prSearchRanges('Login and logout', s), [[0, 5], [10, 13]]);
  assert.equal(prMarkHtml('<b>Login</b> & more', s), '&lt;b&gt;<mark class="pr-hit">Login</mark>&lt;/b&gt; &amp; more');
  assert.equal(prMarkHtml('plain', s), 'plain');
  assert.equal(prMarkHtml('001.sql', prParseSearch('*.sql'), { whole: true }), '<mark class="pr-hit">001.sql</mark>');
  // A pattern marks no piece of text.
  assert.equal(prMarkHtml('001.sql', prParseSearch('*.sql')), '001.sql');
  assert.equal(prFileHit('db/001.sql', prParseSearch('*.sql')), true);
  assert.equal(prFileHit('src/login.js', prParseSearch('LOGIN')), true);
  assert.equal(prFileHit('src/app.js', prParseSearch('login')), false);
});

// --- People ---

test('People lists the authors, the account first, then by how many they wrote; a chosen one stays', () => {
  const items = [
    { author: 'bob', authorAvatar: null }, { author: 'carol' }, { author: 'bob', authorAvatar: 'https://a/bob' },
    { author: 'me', viewerDidAuthor: true }, { author: 'alice' },
  ];
  assert.deepEqual(prPeopleChoices(items, ['dave']).map(c => [c.login, c.count, c.you, c.avatar]), [
    ['me', 1, true, null], ['bob', 2, false, 'https://a/bob'], ['alice', 1, false, null], ['carol', 1, false, null], ['dave', 0, false, null],
  ]);
  assert.equal(prPeopleLabel([]), 'Everyone');
  assert.equal(prPeopleLabel(['bob']), 'bob');
  assert.equal(prPeopleLabel(['bob', 'alice']), 'bob, alice');
  assert.equal(prPeopleLabel(['bob', 'alice', 'me']), '3 people');
  assert.deepEqual(prTogglePerson(['bob'], 'alice'), ['bob', 'alice']);
  assert.deepEqual(prTogglePerson(['bob', 'alice'], 'bob'), ['alice']);
  assert.equal(prByPeople({ author: 'bob' }, []), true);
  assert.equal(prByPeople({ author: 'bob' }, ['alice']), false);
  assert.equal(prByPeople({ author: 'bob' }, ['alice', 'bob']), true);
});
