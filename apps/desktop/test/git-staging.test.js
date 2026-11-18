const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const git = require('../git');
const model = require('../public/git-diff-model');

const haveGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = !haveGit && 'git not installed';

const lines = (n, f = i => String(i)) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

async function makeRepo(files = { 'f.txt': lines(30) }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-stage-'));
  await git.run(['init', '-q', '-b', 'main'], repo);
  await git.run(['config', 'user.email', 'test@example.com'], repo);
  await git.run(['config', 'user.name', 'Test'], repo);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  if (Object.keys(files).length) {
    await git.run(['add', '-A'], repo);
    await git.run(['commit', '-q', '-m', 'init'], repo);
  }
  return repo;
}

const indexed = (repo, name) => git.runRaw(['show', `:${name}`], repo);
const pickWhere = (diff, kinds, re) => {
  const parsed = model.parseUnifiedDiff(diff);
  return parsed.hunks.flatMap(h => h.lines).filter(l => kinds.includes(l.kind) && re.test(l.text)).map(l => l.index);
};

test('parseUnifiedDiff numbers the lines and tells what can be picked', () => {
  const diff = [
    'diff --git a/f.txt b/f.txt', 'index 1..2 100644', '--- a/f.txt', '+++ b/f.txt',
    '@@ -1,3 +1,3 @@ section', ' a', '-b', '+B', ' c', '',
  ].join('\n');
  const parsed = model.parseUnifiedDiff(diff);
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].section, 'section');
  assert.deepEqual(parsed.hunks[0].lines.map(l => [l.kind, l.text, l.oldLine, l.newLine]),
    [['context', 'a', 1, 1], ['remove', 'b', 2, null], ['add', 'B', null, 2], ['context', 'c', 3, 3]]);
  assert.deepEqual(model.changedLineIndices(parsed), [6, 7]);
  assert.equal(model.canPickLines(parsed), true);
  assert.equal(model.canPickLines(model.parseUnifiedDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n')), false);
  assert.equal(model.canPickLines(model.parseUnifiedDiff('diff --git a/x b/y\nsimilarity index 90%\nrename from x\nrename to y\n')), false);
});

test('parseUnifiedDiff reads the "no newline" note and an empty context line', () => {
  const diff = ['--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', '', '-x', '\\ No newline at end of file', '+y', '\\ No newline at end of file', ''].join('\n');
  const kinds = model.parseUnifiedDiff(diff).hunks[0].lines.map(l => l.kind);
  assert.deepEqual(kinds, ['context', 'remove', 'eof', 'add', 'eof']);
});

test('the staged and unstaged sides of a file, with an id of the diff text', { skip }, async () => {
  const repo = await makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'f.txt'), lines(30, i => (i === 3 ? 'three' : String(i))));
    fs.writeFileSync(path.join(repo, 'new file.txt'), 'n1\nn2\n');
    const unstaged = await git.sideDiff(repo, 'f.txt', 'unstaged');
    assert.match(unstaged.diff, /^-3$/m);
    assert.match(unstaged.diffId, /^[0-9a-f]{40}$/);
    assert.equal((await git.sideDiff(repo, 'f.txt', 'staged')).diff, '');
    const untracked = await git.sideDiff(repo, 'new file.txt', 'unstaged');
    assert.match(untracked.diff, /^\+\+\+ "?b\/new file\.txt"?\t?$/m);
    assert.match(untracked.diff, /^\+n2$/m);
    await assert.rejects(git.sideDiff(repo, 'README.md', 'unstaged'), /not currently changed/);
    await assert.rejects(git.sideDiff(repo, '../x', 'unstaged'), /outside the repository/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('picked lines are staged, then some of them unstaged, the rest untouched', { skip }, async () => {
  const repo = await makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'f.txt'), lines(30, i => (i === 3 ? 'three' : i === 20 ? 'twenty' : String(i))));
    let side = await git.sideDiff(repo, 'f.txt', 'unstaged');
    await git.stageLines(repo, 'f.txt', 'unstaged', side.diffId, pickWhere(side.diff, ['add', 'remove'], /^(20|twenty)$/));
    let index = await indexed(repo, 'f.txt');
    assert.match(index, /^twenty$/m);
    assert.match(index, /^3$/m, 'the other change stays out of the index');

    // Unstage only the removal of "20": the index has both lines then.
    side = await git.sideDiff(repo, 'f.txt', 'staged');
    await git.stageLines(repo, 'f.txt', 'staged', side.diffId, pickWhere(side.diff, ['remove'], /^20$/));
    index = await indexed(repo, 'f.txt');
    assert.match(index, /^20\ntwenty$/m);
    assert.equal(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8').includes('three'), true, 'the working tree is never touched');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a diff that changed since it was shown is refused as STALE', { skip }, async () => {
  const repo = await makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'f.txt'), lines(30, i => (i === 3 ? 'three' : String(i))));
    const side = await git.sideDiff(repo, 'f.txt', 'unstaged');
    fs.writeFileSync(path.join(repo, 'f.txt'), lines(30, i => (i === 3 ? 'THREE' : String(i))));
    await assert.rejects(git.stageLines(repo, 'f.txt', 'unstaged', side.diffId, model.changedLineIndices(model.parseUnifiedDiff(side.diff))),
      err => err.code === 'STALE');
    assert.equal(await indexed(repo, 'f.txt'), lines(30));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('part of an untracked file is staged as a new file with those lines', { skip }, async () => {
  const repo = await makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'n.txt'), 'keep\nskip\nkeep too\n');
    const side = await git.sideDiff(repo, 'n.txt', 'unstaged');
    await git.stageLines(repo, 'n.txt', 'unstaged', side.diffId, pickWhere(side.diff, ['add'], /^keep/));
    assert.equal(await indexed(repo, 'n.txt'), 'keep\nkeep too\n');
    // And part of it unstaged again: the file stays added, with the line left.
    const staged = await git.sideDiff(repo, 'n.txt', 'staged');
    await git.stageLines(repo, 'n.txt', 'staged', staged.diffId, pickWhere(staged.diff, ['add'], /^keep too$/));
    assert.equal(await indexed(repo, 'n.txt'), 'keep\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('part of a deleted file is staged as a change, not a deletion', { skip }, async () => {
  const repo = await makeRepo({ 'd.txt': 'a\nb\nc\n' });
  try {
    fs.rmSync(path.join(repo, 'd.txt'));
    const side = await git.sideDiff(repo, 'd.txt', 'unstaged');
    await git.stageLines(repo, 'd.txt', 'unstaged', side.diffId, pickWhere(side.diff, ['remove'], /^b$/));
    assert.equal(await indexed(repo, 'd.txt'), 'a\nc\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('whole files are staged and unstaged, also before the first commit', { skip }, async () => {
  const repo = await makeRepo();
  const empty = await makeRepo({});
  try {
    fs.writeFileSync(path.join(repo, 'f.txt'), 'changed\n');
    fs.writeFileSync(path.join(repo, 'u.txt'), 'u\n');
    await git.stageFiles(repo, ['f.txt'], true);
    let status = (await git.snapshot(repo)).changes;
    assert.equal(status.find(c => c.path === 'f.txt').indexStatus, 'M');
    assert.equal(status.find(c => c.path === 'u.txt').status, 'untracked');
    await git.stageFiles(repo, null, true);
    status = (await git.snapshot(repo)).changes;
    assert.ok(status.every(c => c.indexStatus !== ' ' && c.indexStatus !== '?'));
    await git.stageFiles(repo, null, false);
    status = (await git.snapshot(repo)).changes;
    assert.ok(status.every(c => c.indexStatus === ' ' || c.indexStatus === '?'));

    fs.writeFileSync(path.join(empty, 'first.txt'), '1\n');
    await git.stageFiles(empty, ['first.txt'], true);
    assert.equal((await git.snapshot(empty)).changes[0].indexStatus, 'A');
    await git.stageFiles(empty, ['first.txt'], false);
    assert.equal((await git.snapshot(empty)).changes[0].status, 'untracked');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('an attached folder below the top of the checkout stages by repository paths', { skip }, async () => {
  const repo = await makeRepo({ 'sub/f.txt': 'a\n', 'top.txt': 't\n' });
  try {
    fs.writeFileSync(path.join(repo, 'sub', 'f.txt'), 'b\n');
    const sub = path.join(repo, 'sub');
    const side = await git.sideDiff(sub, 'sub/f.txt', 'unstaged');
    assert.equal(side.path, 'sub/f.txt');
    await git.stageFiles(sub, ['sub/f.txt'], true);
    assert.equal(await indexed(repo, 'sub/f.txt'), 'b\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- Discard and .gitignore (the Changes list's row menu) ---

/** A stand-in for shell.trashItem that deletes and remembers what it was given. */
function fakeTrash() {
  const calls = [];
  const trash = async (abs) => { calls.push(abs); fs.rmSync(abs, { recursive: true, force: true }); };
  return { calls, trash };
}

const statusOf = async (repo) => Object.fromEntries((await git.snapshot(repo)).changes.map(c => [c.path, c.code]));

test('discardFiles puts tracked files back and keeps what is staged', { skip }, async () => {
  const repo = await makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    fs.rmSync(path.join(repo, 'b.txt'));
    fs.writeFileSync(path.join(repo, 'c.txt'), 'staged\n');
    await git.stageFiles(repo, ['c.txt'], true);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'staged then changed\n');
    const { trash, calls } = fakeTrash();
    const result = await git.discardFiles(repo, ['a.txt', 'b.txt', 'c.txt'], { trash });
    assert.deepEqual({ ...result, failed: [...result.failed] }, { restored: 3, trashed: 0, failed: [] });
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'a\n');
    assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'b\n');
    assert.equal(fs.readFileSync(path.join(repo, 'c.txt'), 'utf8'), 'staged\n');
    assert.deepEqual(await statusOf(repo), { 'c.txt': 'M ' });
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('discardFiles of a folder trashes its untracked files and the folders they leave empty', { skip }, async () => {
  const repo = await makeRepo({ 'src/a.txt': 'a\n', 'srcx/b.txt': 'b\n' });
  try {
    fs.writeFileSync(path.join(repo, 'src/a.txt'), 'changed\n');
    fs.mkdirSync(path.join(repo, 'src/new/deep'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/new/deep/n.txt'), 'n\n');
    fs.writeFileSync(path.join(repo, 'srcx/b.txt'), 'changed\n');
    const { trash, calls } = fakeTrash();
    const result = await git.discardFiles(repo, ['src'], { trash });
    assert.equal(result.restored, 1);
    assert.equal(result.trashed, 1);
    assert.deepEqual(calls, [path.join(fs.realpathSync(repo), 'src/new/deep/n.txt')]);
    assert.equal(fs.existsSync(path.join(repo, 'src/new')), false);
    assert.equal(fs.existsSync(path.join(repo, 'src')), true);
    assert.deepEqual(await statusOf(repo), { 'srcx/b.txt': ' M' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('discardFiles with no paths empties Changes and leaves Staged Changes alone', { skip }, async () => {
  const repo = await makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  try {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'staged\n');
    await git.stageFiles(repo, ['b.txt'], true);
    fs.writeFileSync(path.join(repo, 'new.txt'), 'n\n');
    const { trash } = fakeTrash();
    await git.discardFiles(repo, null, { trash });
    assert.deepEqual(await statusOf(repo), { 'b.txt': 'M ' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('discardFiles reads a name with "*" literally and refuses what it cannot reach', { skip: skip || (process.platform === 'win32' && 'no * in Windows names') }, async () => {
  const repo = await makeRepo({ 'a*.txt': 'star\n', 'ab.txt': 'ab\n', 'staged.txt': 's\n' });
  try {
    fs.writeFileSync(path.join(repo, 'a*.txt'), 'changed\n');
    fs.writeFileSync(path.join(repo, 'ab.txt'), 'changed\n');
    const { trash } = fakeTrash();
    await git.discardFiles(repo, ['a*.txt'], { trash });
    assert.deepEqual(await statusOf(repo), { 'ab.txt': ' M' });
    await assert.rejects(git.discardFiles(repo, ['../outside.txt'], { trash }), /outside the repository/);
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'only staged\n');
    await git.stageFiles(repo, ['staged.txt'], true);
    await assert.rejects(git.discardFiles(repo, ['staged.txt'], { trash }), /no changes to discard/i);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('ignorePaths writes anchored lines to the root .gitignore once, and creates it', { skip }, async () => {
  const repo = await makeRepo({ 'keep.txt': 'k\n' });
  try {
    fs.mkdirSync(path.join(repo, 'out'));
    fs.writeFileSync(path.join(repo, 'out/x.log'), 'x\n');
    fs.writeFileSync(path.join(repo, 'notes.md'), 'n\n');
    let result = await git.ignorePaths(repo, ['out', 'notes.md'], { untrack: false });
    assert.deepEqual([...result.patterns], ['/out/', '/notes.md']);
    assert.equal(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), '/out/\n/notes.md\n');
    assert.deepEqual(await statusOf(repo), { '.gitignore': '??' });

    fs.writeFileSync(path.join(repo, '.gitignore'), '/out/\nnode_modules');
    result = await git.ignorePaths(repo, ['out', 'notes.md'], { untrack: false });
    assert.deepEqual([...result.patterns], ['/notes.md']);
    assert.equal(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), '/out/\nnode_modules\n/notes.md\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('ignorePaths with untrack takes tracked files out of the index and leaves them on disk', { skip }, async () => {
  const repo = await makeRepo({ 'secret.env': 'k=v\n', 'dist/a.js': 'a\n', 'dist/b.js': 'b\n' });
  try {
    fs.writeFileSync(path.join(repo, 'secret.env'), 'k=changed\n');
    const result = await git.ignorePaths(repo, ['secret.env', 'dist'], { untrack: true });
    assert.equal(result.untracked, 3);
    assert.equal(fs.readFileSync(path.join(repo, 'secret.env'), 'utf8'), 'k=changed\n');
    assert.ok(fs.existsSync(path.join(repo, 'dist/a.js')));
    assert.deepEqual(await statusOf(repo), { '.gitignore': '??', 'secret.env': 'D ', 'dist/a.js': 'D ', 'dist/b.js': 'D ' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('readEditableFile gives the text on disk, its version and the staged copy as the base', { skip }, async () => {
  const repo = await makeRepo({ 'f.txt': 'one\ntwo\n', 'bin.dat': 'x' });
  fs.writeFileSync(path.join(repo, 'f.txt'), 'one\nTWO\n');
  await git.run(['add', 'f.txt'], repo);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'one\nTWO\nthree\n');
  const read = await git.readEditableFile(repo, 'f.txt');
  assert.equal(read.content, 'one\nTWO\nthree\n');
  assert.equal(read.base, 'one\nTWO\n');
  assert.match(read.version, /^[0-9a-f]{40}$/);

  fs.writeFileSync(path.join(repo, 'new.txt'), 'fresh\n');
  assert.equal((await git.readEditableFile(repo, 'new.txt')).base, '');

  fs.writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([1, 0, 2]));
  await assert.rejects(git.readEditableFile(repo, 'bin.dat'), (err) => err.code === 'BINARY');
  fs.rmSync(path.join(repo, 'f.txt'));
  await assert.rejects(git.readEditableFile(repo, 'f.txt'), (err) => err.code === 'MISSING');
  await assert.rejects(git.readEditableFile(repo, '../outside.txt'), /outside the repository/);
});

test('saveEditedFile writes the working tree only, and not over a newer file', { skip }, async () => {
  const repo = await makeRepo({ 'f.txt': 'one\n' });
  fs.writeFileSync(path.join(repo, 'f.txt'), 'one\nstaged\n');
  await git.run(['add', 'f.txt'], repo);
  const { version } = await git.readEditableFile(repo, 'f.txt');
  const saved = await git.saveEditedFile(repo, 'f.txt', 'one\nstaged\nedited\n', version);
  assert.equal(saved.ok, true);
  assert.equal(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8'), 'one\nstaged\nedited\n');
  // The staged part stays staged; the edit is left to stage.
  assert.equal(await indexed(repo, 'f.txt'), 'one\nstaged\n');
  assert.equal((await git.runRaw(['status', '--porcelain', 'f.txt'], repo)).slice(0, 2), 'MM');

  // Saved again from the old version: the file on disk is newer.
  const stale = await git.saveEditedFile(repo, 'f.txt', 'lost\n', version);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'CHANGED');
  assert.equal(stale.version, saved.version);
  assert.equal(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8'), 'one\nstaged\nedited\n');
  assert.equal((await git.saveEditedFile(repo, 'f.txt', 'two\n', saved.version)).ok, true);
});

test('saveEditedFile does not write through a link', { skip: skip || (process.platform === 'win32' && 'links need rights on Windows') }, async () => {
  const repo = await makeRepo({ 'f.txt': 'one\n' });
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-out-')), 'target.txt');
  fs.writeFileSync(outside, 'keep\n');
  fs.symlinkSync(outside, path.join(repo, 'link.txt'));
  await assert.rejects(git.saveEditedFile(repo, 'link.txt', 'changed\n'), (err) => err.code === 'LINK');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep\n');
});
