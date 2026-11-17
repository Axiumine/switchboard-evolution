// The Compare of 2 to 4 commits ticked in the Git History
// (public/git-graph-compare.js): the order, the steps, the table of files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

global.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
global.escapeAttr = (s) => global.escapeHtml(s).replace(/"/g, '&quot;');

const compare = require(path.join(__dirname, '../public/git-graph-compare.js'));

// The History's rows, newest first: Uncommitted Changes on top.
const rows = [
  { hash: '#uncommitted', kind: 'uncommitted' },
  { hash: 'c3', shortHash: 'c3c3c3c', kind: 'commit' },
  { hash: 's0', shortHash: 's0s0s0s', kind: 'stash', stashIndex: 0 },
  { hash: 'b2', shortHash: 'b2b2b2b', kind: 'commit' },
  { hash: 'a1', shortHash: 'a1a1a1a', kind: 'commit' },
];

test('the ticked commits go from the oldest to the newest, Uncommitted Changes last, the ones no longer loaded left out', () => {
  assert.deepEqual(compare.gitGraphCompareOrder(rows, ['c3', '#uncommitted', 'a1', 'gone', 'b2']), ['a1', 'b2', 'c3', '#uncommitted']);
  assert.deepEqual(compare.gitGraphCompareOrder(rows, new Set(['b2'])), ['b2']);
  assert.deepEqual(compare.gitGraphCompareOrder([], ['a1']), []);
});

test('the steps are each commit with the next one, and the working tree is asked for as null', () => {
  const steps = compare.gitGraphCompareSteps(['a1', 'b2', 'c3', '#uncommitted']);
  assert.deepEqual(steps, [{ from: 'a1', to: 'b2' }, { from: 'b2', to: 'c3' }, { from: 'c3', to: '#uncommitted' }]);
  assert.deepEqual(compare.gitGraphCompareStepArgs(steps[2]), ['c3', null]);
  assert.deepEqual(compare.gitGraphCompareStepArgs(steps[0]), ['a1', 'b2']);
  assert.deepEqual(compare.gitGraphCompareSteps(['a1']), []);
});

test('the table has every file changed in some step, by path, empty where a step left it alone', () => {
  const matrix = compare.gitGraphCompareMatrix([
    [{ path: 'src/b.js', status: 'modified' }, { path: 'README.md', status: 'added' }],
    [{ path: 'src/b.js', status: 'modified' }, { path: 'src/new.js', oldPath: 'src/old.js', status: 'renamed' }],
  ]);
  assert.deepEqual(matrix.map(row => row.path), ['README.md', 'src/b.js', 'src/new.js']);
  assert.equal(matrix[0].cells[0].status, 'added');
  assert.equal(matrix[0].cells[1], null);
  assert.deepEqual(matrix[1].cells.map(cell => cell.status), ['modified', 'modified']);
  assert.equal(matrix[2].cells[0], null);
  assert.equal(matrix[2].cells[1].oldPath, 'src/old.js');
});

test('Select all ticks the commits found while the search is open, otherwise every loaded one', () => {
  assert.deepEqual(compare.gitGraphSelectAllHashes({ rows, findOpen: false, findQuery: 'x', findMatches: [1] }), rows.map(r => r.hash));
  assert.deepEqual(compare.gitGraphSelectAllHashes({ rows, findOpen: true, findQuery: 'fix', findMatches: [1, 3] }), ['c3', 'b2']);
  // A search that finds nothing does not stop Select all.
  assert.deepEqual(compare.gitGraphSelectAllHashes({ rows, findOpen: true, findQuery: 'zzz', findMatches: [] }).length, rows.length);
});

test('a commit is named by its short hash, a stash by its index, the working tree as Uncommitted', () => {
  assert.equal(compare.gitGraphCompareLabel(rows, 'a1'), 'a1a1a1a');
  assert.equal(compare.gitGraphCompareLabel(rows, 's0'), 'stash@{0}');
  assert.equal(compare.gitGraphCompareLabel(rows, '#uncommitted'), 'Uncommitted');
  assert.equal(compare.gitGraphCompareLabel(rows, '0123456789abcdef'), '01234567');
});

test('Compare shows from two ticked commits, and is disabled past four with the reason', () => {
  assert.equal(compare.gitGraphCompareButtonsHtml(0), '');
  assert.equal(compare.gitGraphCompareButtonsHtml(1), '');
  const two = compare.gitGraphCompareButtonsHtml(2);
  assert.match(two, /id="gg-compare-btn"/);
  assert.match(two, /Compare 2/);
  assert.match(two, /id="gg-compare-window-btn"/);
  assert.doesNotMatch(two, /disabled/);
  assert.doesNotMatch(compare.gitGraphCompareButtonsHtml(compare.GG_COMPARE_MAX), /disabled/);
  const five = compare.gitGraphCompareButtonsHtml(5);
  assert.match(five, /disabled/);
  assert.match(five, /Compare up to 4 commits: 5 are selected/);
});

test('the table names each step and shows each file\'s status in it, escaped', () => {
  const spec = { hashes: ['a1', 'b2', 'c3'], labels: ['a1a1a1a', 'b2b2b2b', 'c3c3c3c'] };
  const steps = compare.gitGraphCompareSteps(spec.hashes);
  const matrix = compare.gitGraphCompareMatrix([
    [{ path: 'src/<x>.js', status: 'added', insertions: 3, deletions: 0 }],
    [],
  ]);
  const html = compare.gitGraphCompareTableHtml(spec, steps, matrix, 'src/<x>.js');
  assert.match(html, /a1a1a1a → b2b2b2b/);
  assert.match(html, /b2b2b2b → c3c3c3c/);
  assert.match(html, /gg-cmp-row-selected/);
  assert.match(html, /src\/&lt;x&gt;\.js/);
  assert.doesNotMatch(html, /<x>/);
  assert.match(html, /gg-file-status-added/);
  assert.match(html, /No change in this step/);
});

test('a file renamed in a step is read under its old path on the old side', async () => {
  const calls = [];
  global.window = { api: {
    getGitGraphFileDiffBetween: (...args) => { calls.push(['diff', ...args]); return Promise.resolve({ ok: true, oldContent: '', newContent: 'new\n' }); },
    getGitGraphFileAtRevision: (...args) => { calls.push(['at', ...args]); return Promise.resolve({ ok: true, content: 'old\n' }); },
  } };
  const spec = { projectId: 'p', repoPath: '/repo' };
  const renamed = await compare.gitGraphCompareFileDiff(spec, 'a1', 'b2', 'b.txt', 'a.txt');
  assert.deepEqual(renamed, { ok: true, oldContent: 'old\n', newContent: 'new\n' });
  assert.deepEqual(calls, [['diff', 'p', '/repo', 'a1', 'b2', 'b.txt'], ['at', 'p', '/repo', 'a1', 'a.txt']]);

  calls.length = 0;
  await compare.gitGraphCompareFileDiff(spec, 'a1', null, 'c.txt', null);
  assert.deepEqual(calls, [['diff', 'p', '/repo', 'a1', null, 'c.txt']]);
});
