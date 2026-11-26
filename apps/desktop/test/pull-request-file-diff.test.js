const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../pull-requests');
const fileDiff = require('../pull-request-file-diff');

const DIR = '/code/widgets';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const MERGE_BASE = 'c'.repeat(40);
const PARENT = 'd'.repeat(40);
const REPO = 'repos/acme/widgets';

const fakeGit = {
  remoteList: async () => [{ name: 'origin', url: 'git@github.com:acme/widgets.git' }],
  configListIncludes: async () => [],
};

const ok = value => ({ code: 0, stderr: '', stdout: JSON.stringify(value) });
const blob = (text, extra = {}) => {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return ok({ type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64').replace(/(.{60})/g, '$1\n'), ...extra });
};

/** gh stand-in: `answers` maps an endpoint (the argument after --hostname's value) to an answer. */
function setup(answers) {
  const calls = [];
  pr.init({
    git: fakeGit,
    runGh: async (args) => {
      const endpoint = args[3];
      calls.push(endpoint);
      const answer = answers[endpoint];
      if (!answer) return { code: 1, stdout: '', stderr: `gh: Not Found (HTTP 404) ${endpoint}` };
      return answer;
    },
  });
  return calls;
}

const OLD = 'Prompt\n\0{name}\0\nline two\nline three\n';
const NEW = 'Prompt\n\0{name}\0\nline 2\nline three\n';

test('a pull request\'s file GitHub took for binary: git compares the merge base with the head, NULs shown as ␀', async () => {
  const file = 'prompts/system message.txt';
  const calls = setup({
    [`${REPO}/pulls/7`]: ok({ base: BASE, head: HEAD }),
    [`${REPO}/compare/${BASE}...${HEAD}?per_page=1&page=2`]: ok({ base: MERGE_BASE }),
    [`${REPO}/contents/prompts/system%20message.txt?ref=${MERGE_BASE}`]: blob(OLD),
    [`${REPO}/contents/prompts/system%20message.txt?ref=${HEAD}`]: blob(NEW),
  });
  const result = await fileDiff.textDiff(DIR, { number: 7, path: file, status: 'modified' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.patch, '@@ -1,4 +1,4 @@\n Prompt\n ␀{name}␀\n-line two\n+line 2\n line three');
  assert.equal(calls.length, 4);
});

test('a commit\'s file: its first parent against itself; an added file reads only the new version', async () => {
  const calls = setup({
    [`${REPO}/git/commits/${HEAD}`]: ok({ parent: PARENT }),
    [`${REPO}/contents/new.txt?ref=${HEAD}`]: blob('first line, a NUL here: \0\nsecond line\n'),
    [`${REPO}/contents/old/name.txt?ref=${PARENT}`]: blob(OLD),
    [`${REPO}/contents/new/name.txt?ref=${HEAD}`]: blob(NEW),
  });
  const added = await fileDiff.textDiff(DIR, { sha: HEAD, path: 'new.txt', status: 'added' });
  assert.equal(added.patch, '@@ -0,0 +1,2 @@\n+first line, a NUL here: ␀\n+second line');
  assert.deepEqual(calls, [`${REPO}/git/commits/${HEAD}`, `${REPO}/contents/new.txt?ref=${HEAD}`]);

  // A renamed file reads its old version under its old name.
  const renamed = await fileDiff.textDiff(DIR, { sha: HEAD, path: 'new/name.txt', oldPath: 'old/name.txt', status: 'renamed' });
  assert.match(renamed.patch, /\n-line two\n\+line 2\n/);
});

test('binary content, a known binary extension, a file over 1 MB and a submodule show no diff', async () => {
  const calls = setup({
    [`${REPO}/pulls/7`]: ok({ base: BASE, head: HEAD }),
    [`${REPO}/compare/${BASE}...${HEAD}?per_page=1&page=2`]: ok({ base: MERGE_BASE }),
    [`${REPO}/contents/data.bin2?ref=${MERGE_BASE}`]: blob(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00])),
    [`${REPO}/contents/data.bin2?ref=${HEAD}`]: blob(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])),
    [`${REPO}/contents/utf16.txt?ref=${MERGE_BASE}`]: blob(Buffer.from('hello there\n', 'utf16le')),
    [`${REPO}/contents/utf16.txt?ref=${HEAD}`]: blob(Buffer.from('hello world\n', 'utf16le')),
    [`${REPO}/contents/huge.txt?ref=${MERGE_BASE}`]: blob('x'),
    [`${REPO}/contents/huge.txt?ref=${HEAD}`]: ok({ type: 'file', encoding: 'none', size: 5 * 1024 * 1024, content: '' }),
    [`${REPO}/contents/vendor/lib?ref=${MERGE_BASE}`]: ok({ type: 'submodule', size: 0 }),
    [`${REPO}/contents/vendor/lib?ref=${HEAD}`]: ok({ type: 'submodule', size: 0 }),
  });
  assert.deepEqual({ ...await fileDiff.textDiff(DIR, { number: 7, path: 'data.bin2' }) }, { ok: true, binary: true });
  assert.deepEqual({ ...await fileDiff.textDiff(DIR, { number: 7, path: 'utf16.txt' }) }, { ok: true, binary: true });
  assert.deepEqual({ ...await fileDiff.textDiff(DIR, { number: 7, path: 'huge.txt' }) }, { ok: true, tooLarge: true });
  assert.deepEqual({ ...await fileDiff.textDiff(DIR, { number: 7, path: 'vendor/lib' }) }, { ok: true, binary: true });
  const before = calls.length;
  assert.deepEqual({ ...await fileDiff.textDiff(DIR, { number: 7, path: 'img/Logo.PNG', status: 'added' }) }, { ok: true, binary: true });
  assert.equal(calls.length, before, 'a .png is not read');
});

test('the same text on both sides gives an empty patch; GitHub\'s errors come back as the view\'s words', async () => {
  setup({
    [`${REPO}/pulls/7`]: ok({ base: BASE, head: HEAD }),
    [`${REPO}/compare/${BASE}...${HEAD}?per_page=1&page=2`]: ok({ base: MERGE_BASE }),
    [`${REPO}/contents/same.txt?ref=${MERGE_BASE}`]: blob(OLD),
    [`${REPO}/contents/same.txt?ref=${HEAD}`]: blob(OLD),
  });
  assert.deepEqual({ ...await fileDiff.textDiff(DIR, { number: 7, path: 'same.txt' }) }, { ok: true, patch: '' });
  const missing = await fileDiff.textDiff(DIR, { number: 7, path: 'gone.txt' });
  assert.equal(missing.code, 'not-found');
  assert.equal((await fileDiff.textDiff(DIR, { number: 8, path: 'same.txt' })).code, 'not-found');
});

test('only a pull request number or a commit hash, and a path as GitHub lists it, reach gh', async () => {
  const calls = setup({});
  for (const opts of [
    { path: 'a.txt' },
    { number: 7, sha: HEAD, path: 'a.txt' },
    { number: '7; rm', path: 'a.txt' },
    { sha: 'main', path: 'a.txt' },
    { number: 7, path: '../etc/passwd' },
    { number: 7, path: '/etc/passwd' },
    { number: 7, path: 'a//b.txt' },
    { number: 7, path: 'a/./b.txt' },
    { number: 7, path: 'a\0.txt' },
    { number: 7, path: 'a.txt', oldPath: '../b.txt' },
    { number: 7, path: 'a.txt', status: 'copied' },
    { number: 7 },
  ]) {
    assert.equal((await fileDiff.textDiff(DIR, opts)).code, 'bad-request', JSON.stringify(opts));
  }
  assert.equal(calls.length, 0);
});

test('helpers: the contents path is encoded part by part; the hunks start at the first @@', () => {
  assert.equal(fileDiff.contentsPath({ owner: 'acme', repo: 'widgets' }, 'docs/a #1?.txt', HEAD), `${REPO}/contents/docs/a%20%231%3F.txt?ref=${HEAD}`);
  assert.equal(fileDiff.hunksOf('diff --git a/a b/b\nindex 1..2 100644\n--- a/a\n+++ b/b\n@@ -1 +1 @@\n-x\0\n+y\n'), '@@ -1 +1 @@\n-x␀\n+y');
  assert.equal(fileDiff.hunksOf('diff --git a/a b/b\nold mode 100644\nnew mode 100755\n'), '');
  assert.equal(fileDiff.isText(Buffer.from('a\0b\nplain text, a few NULs\n')), true);
  assert.equal(fileDiff.isText(Buffer.from([0xc3, 0x28])), false);
});
