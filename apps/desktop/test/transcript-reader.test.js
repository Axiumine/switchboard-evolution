const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readTranscriptSince } = require('../transcript-reader');

function tempTranscript(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-reader-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, content);
  return file;
}

test('reads everything, then only what was appended', () => {
  const file = tempTranscript('{"n":1}\n{"n":2}\n');
  const first = readTranscriptSince(file, 0);
  assert.deepEqual(first.entries, [{ n: 1 }, { n: 2 }]);
  assert.equal(first.cursor, fs.statSync(file).size);
  assert.deepEqual(readTranscriptSince(file, first.cursor).entries, []);
  fs.appendFileSync(file, '{"n":3,"text":"città"}\n');
  const next = readTranscriptSince(file, first.cursor);
  assert.deepEqual(next.entries, [{ n: 3, text: 'città' }]);
  assert.equal(next.reset, false);
});

test('a line still being written waits for the next read', () => {
  const file = tempTranscript('{"n":1}\n{"n":2,"te');
  const first = readTranscriptSince(file, 0);
  assert.deepEqual(first.entries, [{ n: 1 }]);
  fs.appendFileSync(file, 'xt":"done"}\n');
  assert.deepEqual(readTranscriptSince(file, first.cursor).entries, [{ n: 2, text: 'done' }]);
});

test('blank and broken lines are skipped', () => {
  const file = tempTranscript('{"n":1}\n\nnot json\n{"n":2}\n');
  assert.deepEqual(readTranscriptSince(file, 0).entries, [{ n: 1 }, { n: 2 }]);
});

test('a rewritten, shorter file is read again from the top', () => {
  const file = tempTranscript('{"n":1}\n{"n":2}\n{"n":3}\n');
  const { cursor } = readTranscriptSince(file, 0);
  fs.writeFileSync(file, '{"n":9}\n');
  assert.deepEqual(readTranscriptSince(file, cursor), { entries: [{ n: 9 }], cursor: 8, reset: true });
});

test('a bad cursor counts as the start', () => {
  const file = tempTranscript('{"n":1}\n');
  assert.deepEqual(readTranscriptSince(file, -5).entries, [{ n: 1 }]);
  assert.deepEqual(readTranscriptSince(file, 1.5).entries, [{ n: 1 }]);
});
