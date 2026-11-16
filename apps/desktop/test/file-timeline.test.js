const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getFileTimeline, getFileTimelineDiff, getFileAtCommit } = require('../file-timeline');

function repo(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-timeline-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dir = fs.realpathSync(temp);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  return { dir, git };
}

test('the timeline lists the commits of a file newest first and follows a rename', async t => {
  const { dir, git } = repo(t);
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app', 'old.txt'), 'one\n');
  git('add', '.'); git('commit', '-q', '-m', 'Add the file');
  fs.writeFileSync(path.join(dir, 'app', 'old.txt'), 'one\ntwo\n');
  git('commit', '-q', '-am', 'Change it');
  git('mv', 'app/old.txt', 'app/new.txt'); git('commit', '-q', '-m', 'Rename it');
  fs.writeFileSync(path.join(dir, 'app', 'new.txt'), 'one\ntwo\nthree\n');

  // Shown from the attached folder "app", a folder below the repository.
  const timeline = await getFileTimeline(path.join(dir, 'app'), 'new.txt');
  assert.equal(timeline.repoRoot, dir);
  assert.equal(timeline.repoPath, 'app/new.txt');
  assert.equal(timeline.uncommitted, true);
  assert.deepEqual(timeline.entries.map(e => e.subject), ['Rename it', 'Change it', 'Add the file']);
  assert.deepEqual(timeline.entries.map(e => e.status), ['R', 'M', 'A']);
  assert.equal(timeline.entries[0].oldPath, 'app/old.txt');
  assert.equal(timeline.entries[1].path, 'app/old.txt');
  assert.equal(timeline.entries[0].authorName, 'Ada');

  const [rename, change, add] = timeline.entries;
  const changed = await getFileTimelineDiff(path.join(dir, 'app'), 'new.txt', change.hash, change.path, change.oldPath);
  assert.deepEqual([changed.oldContent, changed.newContent], ['one\n', 'one\ntwo\n']);
  const renamed = await getFileTimelineDiff(path.join(dir, 'app'), 'new.txt', rename.hash, rename.path, rename.oldPath);
  assert.deepEqual([renamed.oldContent, renamed.newContent], ['one\ntwo\n', 'one\ntwo\n']);
  const first = await getFileTimelineDiff(path.join(dir, 'app'), 'new.txt', add.hash, add.path, add.oldPath);
  assert.deepEqual([first.oldContent, first.newContent], ['', 'one\n']);
  const working = await getFileTimelineDiff(path.join(dir, 'app'), 'new.txt', null);
  assert.deepEqual([working.oldContent, working.newContent], ['one\ntwo\n', 'one\ntwo\nthree\n']);
  assert.equal((await getFileAtCommit(path.join(dir, 'app'), 'new.txt', add.hash, add.path)).content, 'one\n');

  await assert.rejects(getFileTimelineDiff(path.join(dir, 'app'), 'new.txt', '--output=x', 'app/new.txt'), /Invalid commit/);
  await assert.rejects(getFileTimelineDiff(path.join(dir, 'app'), 'new.txt', add.hash, '../outside'), /outside/);
  await assert.rejects(getFileTimeline(path.join(dir, 'app'), '../outside.txt'));
});

test('a folder has a timeline too, and a file outside any repository has none', async t => {
  const { dir, git } = repo(t);
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), 'a');
  git('add', '.'); git('commit', '-q', '-m', 'Docs');
  const folder = await getFileTimeline(dir, 'docs');
  assert.equal(folder.isDirectory, true);
  assert.deepEqual(folder.entries.map(e => [e.subject, e.path]), [['Docs', 'docs']]);
  assert.equal(folder.uncommitted, false);

  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-plain-')));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  fs.writeFileSync(path.join(plain, 'notes.md'), 'x');
  assert.deepEqual(await getFileTimeline(plain, 'notes.md'), { ok: true, repoRoot: null, entries: [] });
});
