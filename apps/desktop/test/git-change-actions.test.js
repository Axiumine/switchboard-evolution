const test = require('node:test');
const assert = require('node:assert/strict');

const actions = require('../public/git-change-actions');

const change = (path, code, extra) => {
  const status = code === '??' ? 'untracked' : code === 'UU' ? 'conflicted' : 'modified';
  return { path, code, indexStatus: code[0], worktreeStatus: code[1], status, staged: code[0] !== ' ' && code[0] !== '?', ...extra };
};

test('ignorePattern anchors a file and a folder at the root of the repository', () => {
  assert.equal(actions.ignorePattern('a/b.txt', false), '/a/b.txt');
  assert.equal(actions.ignorePattern('build', true), '/build/');
  assert.equal(actions.ignorePattern('build/', true), '/build/');
  assert.equal(actions.ignorePattern('a\\b.txt', false), '/a/b.txt');
});

test('ignorePattern escapes what gitignore would read as a pattern', () => {
  // The leading "/" keeps "#" and "!" from being read as a comment or a negation.
  assert.equal(actions.ignorePattern('#notes', false), '/#notes');
  assert.equal(actions.ignorePattern('!keep', false), '/!keep');
  assert.equal(actions.ignorePattern('a/*[x]?.log', false), '/a/\\*\\[x]\\?.log');
  assert.equal(actions.ignorePattern('tail  ', false), '/tail \\ ');
  assert.equal(actions.ignorePattern('dir/x#y!', false), '/dir/x#y!');
});

test('discardTargets takes the working-tree changes of a file, a folder, or all of them', () => {
  const changes = [
    change('src/a.js', ' M'),
    change('src/b.js', 'M '),
    change('src/c.js', 'MM'),
    change('src/new.txt', '??'),
    change('srcx/d.js', ' D'),
    change('top.txt', 'UU'),
  ];
  const paths = (list) => list.map(item => item.path);
  assert.deepEqual(paths(actions.discardTargets(changes, { path: 'src/a.js', dir: false })), ['src/a.js']);
  assert.deepEqual(paths(actions.discardTargets(changes, { path: 'src/b.js', dir: false })), []);
  assert.deepEqual(paths(actions.discardTargets(changes, { path: 'src', dir: true })), ['src/a.js', 'src/c.js', 'src/new.txt']);
  assert.deepEqual(paths(actions.discardTargets(changes, null)), ['src/a.js', 'src/c.js', 'src/new.txt', 'srcx/d.js']);
});

test('ignoreOptions: an untracked file is ignored, a tracked one untracked, a folder both when it holds tracked files', () => {
  const changes = [change('src/a.js', ' M'), change('src/new.txt', '??'), change('tmp/x.log', '??'), change('c.txt', 'UU')];
  assert.deepEqual({ ...actions.ignoreOptions(changes, { path: 'src/new.txt', dir: false }) }, { ignore: true, untrack: false });
  assert.deepEqual({ ...actions.ignoreOptions(changes, { path: 'src/a.js', dir: false }) }, { ignore: false, untrack: true });
  assert.deepEqual({ ...actions.ignoreOptions(changes, { path: 'src', dir: true }) }, { ignore: true, untrack: true });
  assert.deepEqual({ ...actions.ignoreOptions(changes, { path: 'tmp', dir: true }) }, { ignore: true, untrack: false });
  assert.deepEqual({ ...actions.ignoreOptions(changes, { path: 'c.txt', dir: false }) }, { ignore: false, untrack: false });
  assert.deepEqual({ ...actions.ignoreOptions(changes, { path: '.gitignore', dir: false }) }, { ignore: false, untrack: false });
});

test('discardQuestion names one file, says untracked ones go to the Trash, and counts many', () => {
  const one = actions.discardQuestion([change('src/a.js', ' M')]);
  assert.equal(one.title, 'Discard the changes in “a.js”?');
  assert.match(one.detail, /cannot be undone/);
  assert.equal(one.confirm, 'Discard Changes');

  const fresh = actions.discardQuestion([change('src/new.txt', '??')]);
  assert.equal(fresh.title, 'Move “new.txt” to the Trash?');
  assert.match(fresh.detail, /not tracked by Git/);
  assert.equal(fresh.confirm, 'Move to Trash');

  const many = actions.discardQuestion([change('src/a.js', ' M'), change('src/c.js', 'MM'), change('src/new.txt', '??')], 'src');
  assert.equal(many.title, 'Discard the changes in 3 files in “src”?');
  assert.match(many.detail, /2 files go back/);
  assert.match(many.detail, /1 untracked file goes to the Trash/);
  assert.equal(many.confirm, 'Discard 3 Files');

  const all = actions.discardQuestion([change('a', ' M'), change('b', ' M')]);
  assert.equal(all.title, 'Discard the changes in 2 files?');
});

test('untrackQuestion says the file stays on disk and the removal is staged', () => {
  const file = actions.untrackQuestion('secrets.env', false);
  assert.equal(file.title, 'Add “secrets.env” to .gitignore and remove it from Git?');
  assert.match(file.detail, /stays on disk/);
  assert.match(file.detail, /next commit/);
  assert.equal(file.confirm, 'Add and Remove from Git');
  const folder = actions.untrackQuestion('dist', true);
  assert.match(folder.title, /“dist”/);
  assert.match(folder.detail, /files in it stay on disk/);
});
