const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAttachments } = require('../remote-attachments');
const { createRemoteApi } = require('../remote-api');

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-attach-')));
}

const at = (iso) => () => new Date(iso).getTime();
const NOW = '2026-03-04T05:06:07';

test('saves the bytes under the session folder with a timestamp and answers the absolute path', () => {
  const root = tempDir();
  const dir = path.join(root, 'attachments');
  const attachments = createAttachments({ dir, now: at(NOW) });
  const bytes = Buffer.from([1, 2, 3, 255, 0, 9]);
  const result = attachments.save('sess_1-a', 'photo.jpg', bytes);
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 6);
  assert.equal(result.path, path.join(dir, 'sess_1-a', '20260304-050607-photo.jpg'));
  assert.ok(path.isAbsolute(result.path));
  assert.deepEqual(fs.readFileSync(result.path), bytes);
  assert.equal(fs.statSync(path.join(dir, 'sess_1-a')).mode & 0o777, 0o700);
});

test('a second save of the same name in the same second never overwrites', () => {
  const dir = path.join(tempDir(), 'attachments');
  const attachments = createAttachments({ dir, now: at(NOW) });
  const first = attachments.save('s1', 'photo.jpg', Buffer.from('one'));
  const second = attachments.save('s1', 'photo.jpg', Buffer.from('two'));
  const third = attachments.save('s1', 'photo.jpg', Buffer.from('three'));
  assert.equal(path.basename(second.path), '20260304-050607-photo-2.jpg');
  assert.equal(path.basename(third.path), '20260304-050607-photo-3.jpg');
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'one');
  assert.equal(fs.readFileSync(second.path, 'utf8'), 'two');
  assert.equal(fs.readFileSync(third.path, 'utf8'), 'three');
});

test('refuses a bad session id, a name that is not a base name, an empty payload and a symlinked folder', () => {
  const root = tempDir();
  const dir = path.join(root, 'attachments');
  const attachments = createAttachments({ dir, now: at(NOW) });
  const bytes = Buffer.from('x');
  assert.deepEqual(attachments.save('../x', 'a.png', bytes), { ok: false, error: 'Not a session id' });
  assert.deepEqual(attachments.save('', 'a.png', bytes), { ok: false, error: 'Not a session id' });
  assert.deepEqual(attachments.save('a/b', 'a.png', bytes), { ok: false, error: 'Not a session id' });
  for (const name of ['../x', 'a/b', '.', '..', '  ', '', 'a\\b', 'a\0b']) {
    assert.equal(attachments.save('s1', name, bytes).ok, false, JSON.stringify(name));
  }
  assert.deepEqual(attachments.save('s1', 'a.png', Buffer.alloc(0)), { ok: false, error: 'The file is empty' });
  assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((d) => fs.readdirSync(path.join(dir, d))).length : 0, 0);

  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const linked = path.join(root, 'linked');
  fs.symlinkSync(elsewhere, linked);
  const refused = createAttachments({ dir: linked, now: at(NOW) }).save('s1', 'a.png', bytes);
  assert.equal(refused.ok, false);
  assert.deepEqual(fs.readdirSync(elsewhere), []);

  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(elsewhere, path.join(dir, 's2'));
  assert.equal(attachments.save('s2', 'a.png', bytes).ok, false);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('files older than 7 days are pruned on the next save, newer ones stay', () => {
  const dir = path.join(tempDir(), 'attachments');
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(NOW).getTime();
  let clock = start;
  const attachments = createAttachments({ dir, now: () => clock });
  const old = attachments.save('s1', 'old.txt', Buffer.from('old')).path;
  const oldOther = attachments.save('s2', 'old.txt', Buffer.from('old')).path;
  clock = start + 5 * day;
  const recent = attachments.save('s1', 'recent.txt', Buffer.from('recent')).path;
  // Files get their age from the modification time, which the test sets to the fake clock.
  for (const [file, time] of [[old, start], [oldOther, start], [recent, clock]]) fs.utimesSync(file, time / 1000, time / 1000);
  clock = start + 8 * day;
  const fresh = attachments.save('s3', 'fresh.txt', Buffer.from('fresh')).path;
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(oldOther), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(fs.existsSync(fresh), true);
});

test('through the remote api the method is listed and its parameters are checked', async () => {
  const dir = path.join(tempDir(), 'attachments');
  const attachments = createAttachments({ dir });
  const api = createRemoteApi({
    getHandler: () => null,
    localMethods: { 'save-session-attachment': (_client, id, name, base64) => attachments.save(id, name, Buffer.from(base64, 'base64')) },
  });
  assert.ok(api.capabilities().includes('save-session-attachment'));
  assert.match((await api.call('save-session-attachment', ['s1', 'a.png', 'not base64!'])).error, /Wrong parameter 3/);
  assert.match((await api.call('save-session-attachment', ['s1', 'a.png', 'AAAA', 'extra'])).error, /Wrong parameters/);
  assert.match((await api.call('save-session-attachment', ['s1', 7, 'AAAA'])).error, /Wrong parameter 2/);
  const saved = (await api.call('save-session-attachment', ['s1', 'a.png', Buffer.from('hi').toString('base64')])).result;
  assert.equal(saved.ok, true);
  assert.equal(fs.readFileSync(saved.path, 'utf8'), 'hi');
});

test('refuses a name with a control character, which a terminal would misread in a pasted path', () => {
  const dir = path.join(tempDir(), 'attachments');
  const attachments = createAttachments({ dir, now: at(NOW) });
  for (const name of ['a\nb.png', 'a\rb.png', 'a\tb.png', 'a\x1bb.png', 'a\x7fb.png', 'a.png\n']) {
    assert.deepEqual(attachments.save('s1', name, Buffer.from('x')), { ok: false, error: 'Not a file name' }, JSON.stringify(name));
  }
  assert.equal(fs.existsSync(dir), false);
});

test('a long name is cut by bytes, keeping the extension, and a huge extension is refused', () => {
  const dir = path.join(tempDir(), 'attachments');
  const attachments = createAttachments({ dir, now: at(NOW) });
  for (const stem of ['a'.repeat(255 - 4), '\u{1F600}'.repeat(60), 'é'.repeat(120)]) {
    const result = attachments.save('s1', `${stem}.jpg`, Buffer.from('x'));
    assert.equal(result.ok, true, stem.slice(0, 8));
    const stored = path.basename(result.path);
    assert.ok(Buffer.byteLength(stored) <= 255, `${Buffer.byteLength(stored)} bytes`);
    assert.ok(stored.endsWith('.jpg'));
    assert.ok(!stored.includes('�'));
    assert.equal(fs.readFileSync(result.path, 'utf8'), 'x');
    // A second one still fits with its counter.
    const again = attachments.save('s1', `${stem}.jpg`, Buffer.from('y'));
    assert.equal(again.ok, true);
    assert.ok(Buffer.byteLength(path.basename(again.path)) <= 255);
    assert.notEqual(again.path, result.path);
  }
  assert.deepEqual(attachments.save('s1', `a.${'b'.repeat(17)}`, Buffer.from('x')), { ok: false, error: 'Not a file name' });
  assert.equal(attachments.save('s1', `a.${'b'.repeat(15)}`, Buffer.from('x')).ok, true);
});

test('an unexpected file system error is logged and answered without throwing', (t) => {
  const root = tempDir();
  const blocker = path.join(root, 'not-a-folder');
  fs.writeFileSync(blocker, 'x');
  const logged = t.mock.method(console, 'error', () => {});
  const result = createAttachments({ dir: path.join(blocker, 'attachments'), now: at(NOW) }).save('s1', 'a.png', Buffer.from('x'));
  assert.deepEqual(result, { ok: false, error: 'Could not save the file' });
  assert.equal(logged.mock.callCount(), 1);
});
