const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const crypto = require('node:crypto');
const { listFolders, createFolder, saveProjectFile, readProjectFileForPhone, readProjectFileChunk, createPhoneFiles } = require('../remote-files');
const { createRemoteApi } = require('../remote-api');

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-folders-')));
for (const dir of ['beta', 'Alpha', '.hidden', 'alpha-2/inner']) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, 'notes.txt'), 'not a folder');
fs.symlinkSync(path.join(root, 'beta'), path.join(root, 'link-to-beta'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a folder lists its subfolders, sorted, without files or hidden ones', () => {
  const listing = listFolders(root);
  assert.equal(listing.path, root);
  assert.equal(listing.parent, path.dirname(root));
  assert.deepEqual(listing.folders.map(f => f.name), ['Alpha', 'alpha-2', 'beta', 'link-to-beta']);
  assert.deepEqual(listing.folders[1], { name: 'alpha-2', path: path.join(root, 'alpha-2') });
});

test('hidden folders on request, the home folder by default, the root has no parent', () => {
  assert.ok(listFolders(root, { hidden: true }).folders.some(f => f.name === '.hidden'));
  assert.equal(listFolders().path, os.homedir());
  assert.equal(listFolders('/').parent, null);
});

test('a path that is not a folder is an error, not an exception', () => {
  assert.match(listFolders(path.join(root, 'notes.txt')).error, /not a folder/i);
  assert.match(listFolders(path.join(root, 'missing')).error, /not found/i);
  assert.match(listFolders('relative/path').error, /absolute/i);
});

test('New Folder makes one empty folder inside the folder shown, and replaces nothing', () => {
  const made = createFolder(root, '  Fresh ');
  assert.deepEqual(made, { ok: true, path: path.join(root, 'Fresh') });
  assert.ok(fs.statSync(made.path).isDirectory());
  assert.deepEqual(fs.readdirSync(made.path), []);
  assert.ok(listFolders(root).folders.some(f => f.name === 'Fresh'));
  for (const [dir, name, error] of [
    [root, 'Fresh', /already exists/],
    [root, 'notes.txt', /already exists/],
    [root, 'a/b', /without slashes/],
    [root, 'a\\b', /without slashes/],
    [root, '..', /without slashes/],
    [root, '   ', /without slashes/],
    [path.join(root, 'notes.txt'), 'x', /not a folder/i],
    [path.join(root, 'missing'), 'x', /not found/i],
    ['relative/path', 'x', /absolute/i],
  ]) {
    const result = createFolder(dir, name);
    assert.equal(result.ok, false, `${dir} ${name}`);
    assert.match(result.error, error, `${dir} ${name}`);
  }
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'not a folder');
  assert.equal(fs.existsSync(path.join(root, 'missing')), false);
});

const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-files-project-')));
after(() => fs.rmSync(project, { recursive: true, force: true }));
fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
fs.writeFileSync(path.join(project, 'docs', 'notes.md'), '# Notes\n');
fs.writeFileSync(path.join(project, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
fs.writeFileSync(path.join(root, 'outside.md'), 'not in the project');
fs.symlinkSync(path.join(root, 'outside.md'), path.join(project, 'escape.md'));

test('a phone saves a text file that exists inside the project, and nothing else', () => {
  assert.deepEqual(saveProjectFile(project, 'docs/notes.md', '# Notes\n\nMore.\n'), { ok: true, version: sha1('# Notes\n\nMore.\n') });
  assert.equal(fs.readFileSync(path.join(project, 'docs', 'notes.md'), 'utf8'), '# Notes\n\nMore.\n');
  for (const [relative, error] of [
    ['../outside.md', /outside the project/],
    ['escape.md', /outside the project/],
    ['docs/new.md', /does not exist/],
    ['docs', /not a file/],
    ['logo.png', /not a text file/],
  ]) {
    const result = saveProjectFile(project, relative, 'x');
    assert.equal(result.ok, false, relative);
    assert.match(result.error, error, relative);
  }
  assert.equal(fs.readFileSync(path.join(root, 'outside.md'), 'utf8'), 'not in the project');
});

test('reading for a phone drops the desktop-only URLs and refuses media too large to send', () => {
  const text = readProjectFileForPhone(project, 'docs/notes.md');
  assert.equal(text.ok, true);
  assert.equal(text.previewType, 'text');
  assert.equal(text.content, '# Notes\n\nMore.\n');
  assert.equal(text.fileUrl, undefined);
  const image = readProjectFileForPhone(project, 'logo.png', { maxMediaBytes: 4 });
  assert.deepEqual(image, { ok: false, error: 'File is too large to send to the phone', code: 'PREVIEW_UNAVAILABLE' });
  assert.equal(readProjectFileForPhone(project, 'logo.png').mimeType, 'image/png');
  assert.match(readProjectFileForPhone(project, '../outside.md').error, /outside the project/);
});

test('a phone reaches only the folders of a project, not any folder it names', () => {
  const files = createPhoneFiles({ roots: () => [project] });
  assert.equal(files.list(project, 'docs').ok, true);
  assert.deepEqual(files.list(project, 'docs').entries.map(e => e.name), ['notes.md']);
  assert.equal(files.read(project, 'docs/notes.md').ok, true);
  assert.deepEqual(files.save(project, 'docs/notes.md', '# Notes\n'), { ok: true, version: sha1('# Notes\n') });
  const elsewhere = path.dirname(project);
  for (const result of [files.list(elsewhere, ''), files.read(elsewhere, path.basename(project) + '/docs/notes.md'), files.save('/', project.slice(1) + '/docs/notes.md', 'x')]) {
    assert.deepEqual(result, { ok: false, error: 'Not a folder of a project' });
  }
  assert.equal(fs.readFileSync(path.join(project, 'docs', 'notes.md'), 'utf8'), '# Notes\n');
});

test('reading gives the version of the bytes on disk, for text and media alike', () => {
  const text = readProjectFileForPhone(project, 'docs/notes.md');
  assert.equal(text.version, sha1(fs.readFileSync(path.join(project, 'docs', 'notes.md'))));
  assert.equal(readProjectFileForPhone(project, 'logo.png').version, sha1(fs.readFileSync(path.join(project, 'logo.png'))));
  // Bytes that are not valid UTF-8 still give the version of the file, so a later save can be checked.
  fs.writeFileSync(path.join(project, 'odd.txt'), Buffer.from([0x61, 0xff, 0x62]));
  assert.equal(readProjectFileForPhone(project, 'odd.txt').version, sha1(Buffer.from([0x61, 0xff, 0x62])));
});

test('a checked save writes only while the file is the version the phone read', () => {
  const file = path.join(project, 'docs', 'checked.md');
  fs.writeFileSync(file, 'one\n');
  const files = createPhoneFiles({ roots: () => [project] });
  const seen = files.read(project, 'docs/checked.md').version;

  const saved = files.save(project, 'docs/checked.md', 'two\n', seen);
  assert.deepEqual(saved, { ok: true, version: sha1('two\n') });
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');

  // The file changes on the computer; the phone still holds the old version.
  fs.writeFileSync(file, 'changed on the Mac\n');
  const stale = files.save(project, 'docs/checked.md', 'three\n', saved.version);
  assert.deepEqual(stale, { ok: false, code: 'CHANGED', error: 'The file changed on the computer', version: sha1('changed on the Mac\n') });
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed on the Mac\n');

  // Without a version, the save is as before.
  assert.deepEqual(files.save(project, 'docs/checked.md', 'four\n'), { ok: true, version: sha1('four\n') });
  // Other refusals keep their own answers.
  assert.match(files.save(project, 'docs/missing.md', 'x', sha1('x')).error, /does not exist/);
});

test('rename and Trash work inside a known folder and nowhere else', async () => {
  const trashed = [];
  const shell = { trashItem: async (p) => { trashed.push(p); }, showItemInFolder() { throw new Error('reveal'); }, openPath() { throw new Error('open'); } };
  const files = createPhoneFiles({ roots: () => [project], shell });
  fs.writeFileSync(path.join(project, 'docs', 'old.md'), 'x');
  fs.writeFileSync(path.join(project, 'docs', 'gone.md'), 'x');

  const renamed = await files.manage(project, 'docs/old.md', 'rename', 'new.md');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.newRelativePath, path.join('docs', 'new.md'));
  assert.ok(fs.existsSync(path.join(project, 'docs', 'new.md')));
  assert.ok(!fs.existsSync(path.join(project, 'docs', 'old.md')));

  for (const bad of ['../x', 'a/b', 'a\\b', '..', '', '   ']) {
    const result = await files.manage(project, 'docs/new.md', 'rename', bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.ok(fs.existsSync(path.join(project, 'docs', 'new.md')), JSON.stringify(bad));
  }
  assert.match((await files.manage(project, 'docs/new.md', 'rename', 'notes.md')).error, /already exists/);

  // Trash asks nobody: the phone asked its user already.
  const result = await files.manage(project, 'docs/gone.md', 'trash');
  assert.equal(result.ok, true);
  assert.deepEqual(trashed, [path.join(project, 'docs', 'gone.md')]);

  // Only rename and trash, never what acts on the Mac's screen.
  for (const action of ['reveal', 'open-folder']) {
    assert.equal((await files.manage(project, 'docs/new.md', action)).ok, false, action);
  }

  const elsewhere = path.dirname(project);
  for (const action of ['rename', 'trash']) {
    assert.deepEqual(await files.manage(elsewhere, path.basename(project) + '/docs/new.md', action, 'x'), { ok: false, error: 'Not a folder of a project' });
  }
  assert.equal(trashed.length, 1);
  assert.ok(fs.existsSync(path.join(project, 'docs', 'new.md')));
});

test('several entries go to the Trash in one call, inside a known folder only', async () => {
  const trashed = [];
  const shell = { trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); } };
  const files = createPhoneFiles({ roots: () => [project], shell });
  fs.mkdirSync(path.join(project, 'batch', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(project, 'batch', 'sub', 'one.md'), '1');
  fs.writeFileSync(path.join(project, 'batch', 'two.md'), '2');

  const result = await files.trashMany(project, ['batch/sub/one.md', 'batch/sub', 'batch/two.md']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed, ['batch/sub', 'batch/two.md']);
  assert.deepEqual(trashed, [path.join(project, 'batch', 'sub'), path.join(project, 'batch', 'two.md')]);

  const elsewhere = path.dirname(project);
  assert.deepEqual(await files.trashMany(elsewhere, [path.basename(project) + '/docs']), { ok: false, error: 'Not a folder of a project' });
  assert.equal((await files.trashMany(project, [])).ok, false);
  assert.equal(trashed.length, 2);
});

test('the remote parameters of the new file methods are checked', async () => {
  const calls = [];
  const local = (name) => (_client, ...args) => { calls.push([name, ...args]); return { ok: true }; };
  const api = createRemoteApi({
    getHandler: () => null,
    localMethods: { 'save-project-file': local('save'), 'manage-project-entry': local('manage'), 'trash-project-entries': local('trash-many') },
  });
  const hex = sha1('x');
  assert.deepEqual(await api.call('save-project-file', [project, 'a.md', 'text', hex]), { result: { ok: true } });
  assert.deepEqual(await api.call('save-project-file', [project, 'a.md', 'text']), { result: { ok: true } });
  for (const bad of ['xyz', hex.toUpperCase(), hex.slice(1), 5]) {
    assert.match((await api.call('save-project-file', [project, 'a.md', 'text', bad])).error, /Wrong parameter 4/);
  }
  assert.deepEqual(await api.call('manage-project-entry', [project, 'a.md', 'rename', 'b.md']), { result: { ok: true } });
  assert.deepEqual(await api.call('manage-project-entry', [project, 'a.md', 'trash']), { result: { ok: true } });
  assert.match((await api.call('manage-project-entry', [project, 'a.md', 'reveal'])).error, /Wrong parameter 3/);
  assert.match((await api.call('manage-project-entry', [project, 'a.md', 'open-folder'])).error, /Wrong parameter 3/);
  assert.match((await api.call('manage-project-entry', [project, '/abs', 'trash'])).error, /Wrong parameter 2/);
  assert.match((await api.call('manage-project-entry', [project, 'a.md', 'rename', 'x'.repeat(256)])).error, /Wrong parameter 4/);
  assert.equal(calls.length, 4);
  assert.deepEqual(await api.call('trash-project-entries', [project, ['a.md', 'docs/b']]), { result: { ok: true } });
  assert.match((await api.call('trash-project-entries', [project, ['/abs']])).error, /Wrong parameter 2/);
  assert.match((await api.call('trash-project-entries', [project, 'a.md'])).error, /Wrong parameter 2/);
  assert.match((await api.call('trash-project-entries', ['relative', ['a.md']])).error, /Wrong parameter 1/);
  assert.equal(calls.length, 5);
});

test('a phone downloads any file of the project piece by piece, and nothing outside it', () => {
  const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff]);
  fs.writeFileSync(path.join(project, 'data.bin'), bytes);
  const modified = fs.statSync(path.join(project, 'data.bin')).mtimeMs;
  const pieces = [];
  for (let offset = 0; ;) {
    const piece = readProjectFileChunk(project, 'data.bin', offset, { chunkBytes: 4 });
    assert.equal(piece.ok, true);
    assert.equal(piece.size, bytes.length);
    assert.equal(piece.modified, modified);
    const got = Buffer.from(piece.base64, 'base64');
    if (!got.length) break;
    pieces.push(got);
    offset += got.length;
  }
  assert.deepEqual(pieces.map(p => p.length), [4, 4, 3]);
  assert.deepEqual(Buffer.concat(pieces), bytes);
  // Binary or too large to preview does not matter: read-project-file refuses it, a download does not.
  assert.equal(readProjectFileForPhone(project, 'data.bin').ok, false);
  // An empty file is one empty piece.
  fs.writeFileSync(path.join(project, 'empty.txt'), '');
  assert.deepEqual(readProjectFileChunk(project, 'empty.txt', 0), { ok: true, size: 0, modified: fs.statSync(path.join(project, 'empty.txt')).mtimeMs, base64: '' });
  // Past the end: the file got shorter since the last piece.
  assert.match(readProjectFileChunk(project, 'data.bin', bytes.length + 1).error, /changed/);
  for (const [relative, error] of [['../outside.md', /outside the project/], ['escape.md', /outside the project/], ['docs', /not a file/], ['missing.bin', /does not exist/]]) {
    const result = readProjectFileChunk(project, relative, 0);
    assert.equal(result.ok, false, relative);
    assert.match(result.error, error, relative);
  }
  const files = createPhoneFiles({ roots: () => [project] });
  assert.equal(files.chunk(project, 'data.bin', 0).base64, bytes.toString('base64'));
  assert.deepEqual(files.chunk(path.dirname(project), path.basename(project) + '/data.bin', 0), { ok: false, error: 'Not a folder of a project' });
});

test('the remote parameters of a download are checked', async () => {
  const calls = [];
  const api = createRemoteApi({ getHandler: () => null, localMethods: { 'read-project-file-chunk': (_client, ...args) => { calls.push(args); return { ok: true }; } } });
  assert.deepEqual(await api.call('read-project-file-chunk', [project, 'a.bin', 0]), { result: { ok: true } });
  assert.deepEqual(await api.call('read-project-file-chunk', [project, 'a.bin', 4194304]), { result: { ok: true } });
  assert.match((await api.call('read-project-file-chunk', [project, '/etc/passwd', 0])).error, /Wrong parameter 2/);
  for (const bad of [-1, 1.5, '0', undefined]) {
    assert.match((await api.call('read-project-file-chunk', [project, 'a.bin', bad])).error, /Wrong parameter 3/, String(bad));
  }
  assert.equal(calls.length, 2);
});

test('a path a session mentions is found in the folders a phone reaches, and nowhere else', () => {
  const plans = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-files-plans-')));
  after(() => fs.rmSync(plans, { recursive: true, force: true }));
  fs.writeFileSync(path.join(plans, 'brave-otter.md'), '# Plan\n');
  fs.mkdirSync(path.join(project, 'src', 'remote'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'remote', 'client.ts'), 'export {};\n');
  const files = createPhoneFiles({ roots: () => [project], readRoots: () => [plans] });

  // Absolute, relative to the session's folder, or relative to a project folder.
  assert.deepEqual(files.locate(path.join(project, 'docs', 'notes.md')), { ok: true, root: project, relativePath: path.join('docs', 'notes.md'), type: 'file' });
  assert.deepEqual(files.locate('remote/client.ts', path.join(project, 'src')), { ok: true, root: project, relativePath: path.join('src', 'remote', 'client.ts'), type: 'file' });
  assert.deepEqual(files.locate('src/remote/client.ts', '/somewhere/else'), { ok: true, root: project, relativePath: path.join('src', 'remote', 'client.ts'), type: 'file' });
  assert.deepEqual(files.locate('src/remote'), { ok: true, root: project, relativePath: path.join('src', 'remote'), type: 'directory' });
  // Claude's plan, in the plans folder.
  assert.deepEqual(files.locate(path.join(plans, 'brave-otter.md')), { ok: true, root: plans, relativePath: 'brave-otter.md', type: 'file' });

  assert.match(files.locate(path.join(root, 'outside.md')).error, /outside the folders/);
  // A link out of the project counts where it leads.
  assert.match(files.locate('escape.md', project).error, /outside the folders/);
  assert.match(files.locate(path.relative(project, path.join(root, 'outside.md')), project).error, /outside the folders/);
  assert.match(files.locate('missing.ts', project).error, /missing\.ts was not found/);
  assert.equal(files.locate('').ok, false);
});

test('Claude\'s plans can be read and saved, but not managed like a project\'s files', async () => {
  const plans = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-files-plans-')));
  after(() => fs.rmSync(plans, { recursive: true, force: true }));
  fs.writeFileSync(path.join(plans, 'brave-otter.md'), '# Plan\n');
  const files = createPhoneFiles({ roots: () => [project], readRoots: () => [plans], shell: { trashItem: async () => { throw new Error('trash'); } } });
  const read = files.read(plans, 'brave-otter.md');
  assert.equal(read.ok, true);
  assert.equal(read.content, '# Plan\n');
  assert.equal(files.save(plans, 'brave-otter.md', '# Plan\n\nEdited.\n', read.version).ok, true);
  assert.equal(fs.readFileSync(path.join(plans, 'brave-otter.md'), 'utf8'), '# Plan\n\nEdited.\n');
  assert.equal(files.list(plans, '').ok, false);
  assert.equal((await files.manage(plans, 'brave-otter.md', 'trash')).ok, false);
  assert.equal((await files.duplicate(plans, 'brave-otter.md')).ok, false);
  assert.ok(fs.existsSync(path.join(plans, 'brave-otter.md')));
});

test('the remote parameters of locate-file are checked', async () => {
  const calls = [];
  const api = createRemoteApi({ getHandler: () => null, localMethods: { 'locate-file': (_client, ...args) => { calls.push(args); return { ok: true }; } } });
  assert.deepEqual(await api.call('locate-file', ['src/a.ts', '/code/web']), { result: { ok: true } });
  assert.deepEqual(await api.call('locate-file', ['~/.claude/plans/x.md']), { result: { ok: true } });
  assert.match((await api.call('locate-file', ['a.ts', 'relative/cwd'])).error, /Wrong parameter 2/);
  assert.match((await api.call('locate-file', [5])).error, /Wrong parameter 1/);
  assert.equal(calls.length, 2);
});

test('a phone uploads a file into a folder piece by piece, and it shows up only once whole', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-files-uploads-'));
  after(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));
  const trashed = [];
  const shell = { trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); } };
  const files = createPhoneFiles({ roots: () => [project], shell, uploadsDir });
  fs.mkdirSync(path.join(project, 'up'), { recursive: true });
  const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff]);
  const piece = (offset, end, extra = {}) => ({ upload: 'aaaaaaaaaaaaaaaa1', offset, base64: bytes.subarray(offset, end).toString('base64'), ...extra });

  assert.deepEqual(await files.upload(project, 'up', 'data.bin', piece(0, 4)), { ok: true, received: 4 });
  assert.equal(fs.existsSync(path.join(project, 'up', 'data.bin')), false);
  assert.deepEqual(await files.upload(project, 'up', 'data.bin', piece(4, 8)), { ok: true, received: 8 });
  // The same piece again (its answer got lost) is written again, not added.
  assert.deepEqual(await files.upload(project, 'up', 'data.bin', piece(4, 8)), { ok: true, received: 8 });
  const done = await files.upload(project, 'up', 'data.bin', piece(8, 11, { last: true }));
  assert.deepEqual(done, { ok: true, received: 11, relativePath: path.join('up', 'data.bin'), name: 'data.bin', size: 11 });
  assert.deepEqual(fs.readFileSync(path.join(project, 'up', 'data.bin')), bytes);
  assert.deepEqual(fs.readdirSync(uploadsDir), []);
  // The last piece sent again gets the same answer, and writes nothing more.
  assert.deepEqual(await files.upload(project, 'up', 'data.bin', piece(8, 11, { last: true })), done);
  assert.deepEqual(fs.readdirSync(path.join(project, 'up')), ['data.bin']);

  // A name already there: kept beside it, or replaced with the old one in the Trash.
  const one = (upload, extra) => files.upload(project, 'up', 'data.bin', { upload, offset: 0, base64: Buffer.from('new').toString('base64'), last: true, ...extra });
  assert.equal((await one('bbbbbbbbbbbbbbbb1')).name, 'data (1).bin');
  assert.equal((await one('bbbbbbbbbbbbbbbb2', { conflict: 'keep-both' })).name, 'data (2).bin');
  assert.equal((await one('bbbbbbbbbbbbbbbb3', { conflict: 'replace' })).name, 'data.bin');
  assert.equal(fs.readFileSync(path.join(project, 'up', 'data.bin'), 'utf8'), 'new');
  assert.deepEqual(trashed, [path.join(project, 'up', 'data.bin')]);
  // A folder is never replaced by a file.
  fs.mkdirSync(path.join(project, 'up', 'sub'));
  const folder = await files.upload(project, 'up', 'sub', { upload: 'cccccccccccccccc1', offset: 0, base64: '', last: true, conflict: 'replace' });
  assert.match(folder.error, /folder called "sub"/);
  assert.ok(fs.statSync(path.join(project, 'up', 'sub')).isDirectory());

  // An empty file, into the root of the folder.
  assert.equal((await files.upload(project, '', 'blank.txt', { upload: 'dddddddddddddddd1', offset: 0, base64: '', last: true })).relativePath, 'blank.txt');
  assert.equal(fs.readFileSync(path.join(project, 'blank.txt'), 'utf8'), '');
});

test('an upload stops cleanly: aborted, interrupted, or aimed outside the project', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-files-uploads-'));
  after(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));
  const files = createPhoneFiles({ roots: () => [project], shell: { trashItem: async () => {} }, uploadsDir });
  const data = Buffer.from('abcd').toString('base64');

  assert.equal((await files.upload(project, 'docs', 'gone.txt', { upload: 'eeeeeeeeeeeeeeee1', offset: 0, base64: data })).ok, true);
  assert.deepEqual(await files.upload(project, 'docs', 'gone.txt', { upload: 'eeeeeeeeeeeeeeee1', offset: 0, abort: true }), { ok: true, aborted: true });
  assert.deepEqual(fs.readdirSync(uploadsDir), []);
  // What came after an abort, or a piece past what arrived, is an interrupted upload.
  assert.match((await files.upload(project, 'docs', 'gone.txt', { upload: 'eeeeeeeeeeeeeeee1', offset: 4, base64: data, last: true })).error, /interrupted/);
  assert.equal((await files.upload(project, 'docs', 'gone.txt', { upload: 'eeeeeeeeeeeeeeee2', offset: 0, base64: data })).ok, true);
  assert.match((await files.upload(project, 'docs', 'gone.txt', { upload: 'eeeeeeeeeeeeeeee2', offset: 8, base64: data })).error, /interrupted/);
  assert.equal(fs.existsSync(path.join(project, 'docs', 'gone.txt')), false);

  for (const [folder, name, error] of [
    ['../', 'x.txt', /outside the project/],
    ['docs/notes.md', 'x.txt', /Not a folder/],
    ['missing', 'x.txt', /ENOENT|no such file/],
    ['docs', '../x.txt', /without path separators/],
    ['docs', '..', /without path separators/],
  ]) {
    const result = await files.upload(project, folder, name, { upload: 'ffffffffffffffff1', offset: 0, base64: data, last: true });
    assert.equal(result.ok, false, `${folder} ${name}`);
    assert.match(result.error, error, `${folder} ${name}`);
  }
  assert.equal((await files.upload(project, 'docs', 'x.txt', { upload: '../../escape', offset: 0, base64: data })).error, 'Invalid upload');
  assert.deepEqual(await files.upload(path.dirname(project), path.basename(project), 'x.txt', { upload: 'ffffffffffffffff2', offset: 0, base64: data, last: true }), { ok: false, error: 'Not a folder of a project' });
  assert.equal((await createPhoneFiles({ roots: () => [project] }).upload(project, '', 'x.txt', { upload: 'ffffffffffffffff3', offset: 0 })).ok, false);
  assert.equal(fs.existsSync(path.join(project, 'x.txt')), false);
});

test('the remote parameters of an upload are checked', async () => {
  const calls = [];
  const api = createRemoteApi({ getHandler: () => null, localMethods: { 'upload-project-file-chunk': (_client, ...args) => { calls.push(args); return { ok: true }; } } });
  const ok = { upload: 'abcdefABCDEF0123-_', offset: 0, base64: 'AAEC', last: true, conflict: 'replace' };
  assert.deepEqual(await api.call('upload-project-file-chunk', [project, 'docs', 'a.bin', ok]), { result: { ok: true } });
  assert.deepEqual(await api.call('upload-project-file-chunk', [project, '', 'a.bin', { upload: ok.upload, offset: 0, abort: true }]), { result: { ok: true } });
  assert.match((await api.call('upload-project-file-chunk', [project, '/abs', 'a.bin', ok])).error, /Wrong parameter 2/);
  assert.match((await api.call('upload-project-file-chunk', [project, 'docs', 'x'.repeat(256), ok])).error, /Wrong parameter 3/);
  for (const bad of [
    { ...ok, upload: 'short' }, { ...ok, upload: '../../../../etc/x' }, { ...ok, offset: -1 }, { ...ok, base64: 'not base64!' },
    { ...ok, conflict: 'overwrite' }, { ...ok, extra: 1 }, { upload: ok.upload }, 'piece',
  ]) {
    assert.match((await api.call('upload-project-file-chunk', [project, 'docs', 'a.bin', bad])).error, /Wrong parameter 4/, JSON.stringify(bad));
  }
  assert.equal(calls.length, 2);
});
