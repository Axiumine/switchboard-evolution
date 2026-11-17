const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { manageProjectEntry, revealFile, shareFile } = require('../file-management');

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-file-actions-'));
  const root = path.join(temp, 'project');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const calls = [];
  const dependencies = {
    shell: {
      showItemInFolder: file => calls.push(['reveal', file]),
      openPath: async file => { calls.push(['open', file]); return ''; },
      trashItem: async file => { calls.push(['trash', file]); fs.renameSync(file, path.join(temp, 'trashed')); },
    },
    confirmTrash: async () => true,
  };
  const run = (rel, action, name) => manageProjectEntry(root, rel, action, name, dependencies);
  return { temp, root, calls, dependencies, run };
}

test('rename preserves file bytes and directory contents and never overwrites an existing entry', async t => {
  const { root, run } = fixture(t);
  fs.mkdirSync(path.join(root, 'source'));
  fs.writeFileSync(path.join(root, 'source', 'notes.md'), 'keep my work');
  const renamed = await run('source', 'rename', 'renamed');
  assert.equal(renamed.newRelativePath, 'renamed');
  assert.equal(fs.readFileSync(path.join(root, 'renamed', 'notes.md'), 'utf8'), 'keep my work');
  await run(path.join('renamed', 'notes.md'), 'rename', 'draft.md');
  fs.writeFileSync(path.join(root, 'renamed', 'taken.md'), 'other work');
  await assert.rejects(run(path.join('renamed', 'draft.md'), 'rename', 'taken.md'), /already exists/);
  assert.equal(fs.readFileSync(path.join(root, 'renamed', 'taken.md'), 'utf8'), 'other work');
  assert.equal(fs.readFileSync(path.join(root, 'renamed', 'draft.md'), 'utf8'), 'keep my work');
});

test('file actions reject project roots, traversal, invalid names and unknown operations', async t => {
  const { root, run } = fixture(t);
  fs.writeFileSync(path.join(root, 'notes.md'), 'keep');
  for (const rel of ['', '.', 'folder/..', '../project', '../outside', path.join(root, 'notes.md')]) {
    await assert.rejects(run(rel, 'trash'));
  }
  for (const name of ['', '.', '..', '../outside', 'nested/name', 'nested\\name', 'bad\0name']) {
    await assert.rejects(run('notes.md', 'rename', name));
  }
  await assert.rejects(run('notes.md', 'erase'), /Unknown/);
  assert.equal(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), 'keep');
});

test('cancelled deletion leaves files intact; confirmed deletion uses the OS trash', async t => {
  const { root, temp, calls, dependencies, run } = fixture(t);
  fs.writeFileSync(path.join(root, 'notes.md'), 'recoverable');
  dependencies.confirmTrash = async () => false;
  assert.equal((await run('notes.md', 'trash')).cancelled, true);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(root, 'notes.md')), true);
  dependencies.confirmTrash = async () => true;
  await run('notes.md', 'trash');
  assert.equal(calls[0][0], 'trash');
  assert.equal(fs.readFileSync(path.join(temp, 'trashed'), 'utf8'), 'recoverable');
});

test('trash errors propagate without falling back to permanent deletion', async t => {
  const { root, dependencies, run } = fixture(t);
  fs.writeFileSync(path.join(root, 'notes.md'), 'keep');
  dependencies.shell.trashItem = async () => { throw new Error('Trash unavailable'); };
  await assert.rejects(run('notes.md', 'trash'), /Trash unavailable/);
  assert.equal(fs.existsSync(path.join(root, 'notes.md')), true);
});

test('reveal selects the item; opening is limited to folders', async t => {
  const { root, calls, run } = fixture(t);
  fs.mkdirSync(path.join(root, 'folder'));
  fs.writeFileSync(path.join(root, 'notes.md'), 'keep');
  await run('notes.md', 'reveal');
  await run('folder', 'open-folder');
  assert.deepEqual(calls.map(call => call[0]), ['reveal', 'open']);
  await assert.rejects(run('notes.md', 'open-folder'), /Not a folder/);
});

test('symlink operations affect the link and reject escapes through parent directories', { skip: process.platform === 'win32' }, async t => {
  const { root, temp, run } = fixture(t);
  fs.writeFileSync(path.join(temp, 'outside.txt'), 'outside work');
  fs.symlinkSync(path.join(temp, 'outside.txt'), path.join(root, 'link'));
  await run('link', 'rename', 'renamed-link');
  assert.equal(fs.lstatSync(path.join(root, 'renamed-link')).isSymbolicLink(), true);
  await run('renamed-link', 'trash');
  assert.equal(fs.readFileSync(path.join(temp, 'outside.txt'), 'utf8'), 'outside work');
  fs.symlinkSync(temp, path.join(root, 'escape'));
  await assert.rejects(run('escape/outside.txt', 'trash'), /outside/);
  fs.symlinkSync(path.join(temp, 'missing'), path.join(root, 'dangling'));
  fs.writeFileSync(path.join(root, 'notes.md'), 'keep');
  await assert.rejects(run('notes.md', 'rename', 'dangling'), /already exists/);
});

test('replacing an item during confirmation cannot trash its replacement', async t => {
  const { root, calls, dependencies, run } = fixture(t);
  const file = path.join(root, 'notes.md');
  fs.writeFileSync(file, 'original');
  dependencies.confirmTrash = async () => {
    fs.renameSync(file, path.join(root, 'original.md'));
    fs.writeFileSync(file, 'replacement');
    return true;
  };
  await assert.rejects(run('notes.md', 'trash'), /item changed/);
  assert.deepEqual(calls, []);
  assert.equal(fs.readFileSync(file, 'utf8'), 'replacement');
});

test('revealFile shows any existing absolute file and never opens it', t => {
  const { temp, calls, dependencies } = fixture(t);
  const outside = path.join(temp, 'elsewhere', 'plan.md');
  fs.mkdirSync(path.dirname(outside));
  fs.writeFileSync(outside, '# plan');
  assert.deepEqual(revealFile(path.join(temp, 'elsewhere', '..', 'elsewhere', 'plan.md'), dependencies), { filePath: outside });
  assert.deepEqual(calls, [['reveal', outside]]);
  assert.throws(() => revealFile('elsewhere/plan.md', dependencies), /Invalid file path/);
  assert.throws(() => revealFile(path.join(temp, 'missing.md'), dependencies), /does not exist/);
  assert.throws(() => revealFile(undefined, dependencies), /Invalid file path/);
  assert.equal(calls.length, 1);
});

test('new files and folders are created inside the folder, with the folders on the way, never over an entry', t => {
  const { root } = fixture(t);
  const { createProjectEntry } = require('../file-management');
  fs.mkdirSync(path.join(root, 'src'));
  const file = createProjectEntry(root, 'src', 'notes.md', 'file');
  assert.equal(file.relativePath, path.join('src', 'notes.md'));
  assert.equal(fs.readFileSync(path.join(root, 'src', 'notes.md'), 'utf8'), '');
  const nested = createProjectEntry(root, '', 'docs/guides/intro.md', 'file');
  assert.equal(nested.relativePath, path.join('docs', 'guides', 'intro.md'));
  const folder = createProjectEntry(root, 'src', 'lib', 'folder');
  assert.equal(fs.statSync(folder.filePath).isDirectory(), true);
  fs.writeFileSync(path.join(root, 'src', 'notes.md'), 'kept');
  assert.throws(() => createProjectEntry(root, 'src', 'notes.md', 'file'), /already exists/);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'notes.md'), 'utf8'), 'kept');
  for (const name of ['', '/', '..', '../outside.md', 'a/../../b', 'bad\0name']) {
    assert.throws(() => createProjectEntry(root, '', name, 'file'));
  }
  assert.throws(() => createProjectEntry(root, '../', 'x.md', 'file'));
  assert.throws(() => createProjectEntry(root, 'src/notes.md', 'x.md', 'file'), /Not a folder/);
  assert.throws(() => createProjectEntry(root, '', 'x', 'link'), /Unknown kind/);
});

test('duplicate makes a "copy" next to the entry and counts up when that name is taken', t => {
  const { root } = fixture(t);
  const { duplicateProjectEntry, copyName } = require('../file-management');
  fs.writeFileSync(path.join(root, 'report.md'), 'original');
  assert.equal(duplicateProjectEntry(root, 'report.md').newRelativePath, 'report copy.md');
  assert.equal(duplicateProjectEntry(root, 'report.md').newRelativePath, 'report copy 2.md');
  assert.equal(fs.readFileSync(path.join(root, 'report copy 2.md'), 'utf8'), 'original');
  fs.mkdirSync(path.join(root, 'src.v1'));
  fs.writeFileSync(path.join(root, 'src.v1', 'a.js'), 'a');
  const folder = duplicateProjectEntry(root, 'src.v1');
  assert.equal(folder.newRelativePath, 'src.v1 copy');
  assert.equal(fs.readFileSync(path.join(root, 'src.v1 copy', 'a.js'), 'utf8'), 'a');
  assert.equal(copyName(root, '.env', false), '.env copy');
  assert.throws(() => duplicateProjectEntry(root, ''));
});

test('paste copies or moves between roots, never into itself and never over an entry', t => {
  const { temp, root } = fixture(t);
  const { pasteProjectEntry } = require('../file-management');
  const other = path.join(temp, 'attached');
  fs.mkdirSync(path.join(other, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a');

  const copy = pasteProjectEntry(root, path.join('src', 'a.js'), other, 'docs', 'copy');
  assert.equal(copy.newRelativePath, path.join('docs', 'a.js'));
  assert.equal(copy.newProjectPath, other);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'a.js'), 'utf8'), 'a');
  // Pasting a copy where the name is taken gives it a copy name.
  assert.equal(pasteProjectEntry(root, path.join('src', 'a.js'), root, 'src', 'copy').newRelativePath, path.join('src', 'a copy.js'));

  assert.throws(() => pasteProjectEntry(root, 'src', root, path.join('src', 'deep'), 'move'), /inside itself/);
  assert.throws(() => pasteProjectEntry(root, 'src', root, 'src', 'copy'), /inside itself/);
  assert.throws(() => pasteProjectEntry(root, path.join('src', 'a.js'), other, 'docs', 'move'), /already exists/);
  assert.equal(pasteProjectEntry(root, path.join('src', 'a.js'), root, 'src', 'move').cancelled, true);

  const move = pasteProjectEntry(root, 'src', other, '', 'move');
  assert.equal(move.action, 'move');
  assert.equal(move.newRelativePath, 'src');
  assert.equal(fs.existsSync(path.join(root, 'src')), false);
  assert.equal(fs.readFileSync(path.join(other, 'src', 'a.js'), 'utf8'), 'a');
  assert.throws(() => pasteProjectEntry(other, 'src', root, '..', 'move'));
  assert.throws(() => pasteProjectEntry(other, 'src', root, '', 'link'), /Unknown paste mode/);
});

test('shareFile shares any existing absolute file, resolved, and nothing else', t => {
  const { temp } = fixture(t);
  const shared = [];
  const share = file => shared.push(file);
  const outside = path.join(fs.realpathSync(temp), 'elsewhere', 'plan.md');
  fs.mkdirSync(path.dirname(outside));
  fs.writeFileSync(outside, '# plan');
  assert.deepEqual(shareFile(path.join(temp, 'elsewhere', '..', 'elsewhere', 'plan.md'), { share }), { filePath: outside });
  assert.deepEqual(shared, [outside]);
  assert.throws(() => shareFile('elsewhere/plan.md', { share }), /Invalid file path/);
  assert.throws(() => shareFile(undefined, { share }), /Invalid file path/);
  assert.throws(() => shareFile(path.join(temp, 'missing.md'), { share }), /does not exist/);
  assert.throws(() => shareFile(path.dirname(outside), { share }), /Not a file/);
  assert.equal(shared.length, 1);
});

// --- Several entries to the Trash (the Files tab's Delete N Selected) ---

function batchFixture(t) {
  const { temp, root } = fixture(t);
  const trashed = [];
  const questions = [];
  const shell = {
    trashItem: async (file) => {
      trashed.push(path.relative(fs.realpathSync(root), file));
      fs.renameSync(file, path.join(temp, `trashed-${trashed.length}`));
    },
  };
  const run = (rels, answer = true) => require('../file-management').trashProjectEntries(root, rels, {
    shell,
    confirm: async (entries) => { questions.push(entries); return answer; },
  });
  return { temp, root, trashed, questions, run };
}

test('trashProjectEntries asks once, then trashes every entry, a folder with its contents', async t => {
  const { root, trashed, questions, run } = batchFixture(t);
  fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'lib', 'a.js'), 'a');
  fs.writeFileSync(path.join(root, 'notes.md'), 'n');
  fs.writeFileSync(path.join(root, 'keep.md'), 'k');

  const result = await run(['src/lib/a.js', 'notes.md', 'src', 'notes.md']);
  assert.equal(questions.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(questions[0])), [{ rel: 'notes.md', isDir: false }, { rel: 'src', isDir: true }]);
  assert.deepEqual(trashed, ['notes.md', 'src']);
  assert.equal(result.action, 'trash-many');
  assert.deepEqual(result.removed, ['notes.md', 'src']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.changes.map(c => [c.action, c.relativePath]), [['trash', 'notes.md'], ['trash', 'src']]);
  assert.ok(fs.existsSync(path.join(root, 'keep.md')));
});

test('trashProjectEntries cancelled trashes nothing', async t => {
  const { root, trashed, run } = batchFixture(t);
  fs.writeFileSync(path.join(root, 'a.md'), 'a');
  const result = await run(['a.md'], false);
  assert.equal(result.cancelled, true);
  assert.deepEqual(trashed, []);
  assert.ok(fs.existsSync(path.join(root, 'a.md')));
});

test('trashProjectEntries reports what cannot go and moves the rest', async t => {
  const { root, trashed, questions, run } = batchFixture(t);
  fs.writeFileSync(path.join(root, 'a.md'), 'a');
  const result = await run(['a.md', 'missing.md', '../outside.md', '/abs.md', '']);
  assert.deepEqual(trashed, ['a.md']);
  assert.deepEqual(JSON.parse(JSON.stringify(questions[0])), [{ rel: 'a.md', isDir: false }], 'only what can go is asked about');
  assert.deepEqual(result.removed, ['a.md']);
  assert.deepEqual(result.failed.map(f => f.rel).sort(), ['../outside.md', '/abs.md', 'missing.md'].sort());
  assert.equal(result.failed.find(f => f.rel === 'missing.md').error, 'No longer exists');
});

test('trashProjectEntries refuses an item replaced while the question was open', async t => {
  const { root, trashed, temp } = batchFixture(t);
  fs.writeFileSync(path.join(root, 'a.md'), 'a');
  fs.writeFileSync(path.join(root, 'b.md'), 'b');
  const result = await require('../file-management').trashProjectEntries(root, ['a.md', 'b.md'], {
    shell: { trashItem: async (file) => { trashed.push(path.basename(file)); fs.renameSync(file, path.join(temp, path.basename(file))); } },
    confirm: async () => {
      fs.rmSync(path.join(root, 'a.md'));
      fs.writeFileSync(path.join(root, 'a.md'), 'replaced');
      return true;
    },
  });
  assert.deepEqual(trashed, ['b.md']);
  assert.deepEqual(result.failed, [{ rel: 'a.md', error: 'Changed while confirming' }]);
  assert.equal(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), 'replaced');
});

test('trashProjectEntries needs something to trash and never the folder itself', async t => {
  const { run, trashed } = batchFixture(t);
  await assert.rejects(run([]), /Nothing to move/);
  const result = await run(['.']);
  assert.deepEqual(trashed, []);
  assert.match(result.failed[0].error, /project folder itself/);
});
