const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MESSAGE_WINDOW, MESSAGE_TEXT_MAX,
  pushMessageWindow, parseMessageWindows, matchesMessageWindow, sessionsMatchingMessages, lastMessageText,
} = require('../message-windows');
const { readSessionFile } = require('../harnesses/claude');

const APP_DIR = path.join(__dirname, '..');
const FOLDER = '-Users-demo-project';
const PROJECT = '/Users/demo/project';

function line(obj) {
  return JSON.stringify(obj) + '\n';
}

/** A transcript of `texts`, user and assistant in turn, padded with records that are not messages. */
function transcript(texts) {
  return texts.map((text, i) => line({ type: i % 2 ? 'assistant' : 'user', cwd: PROJECT,
    message: { role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text }] } })
    + line({ type: 'system', content: 'x'.repeat(500) })).join('');
}

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-message-windows-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function windowsOf(texts) {
  const windows = { head: [], tail: [] };
  for (const text of texts) pushMessageWindow(windows, text);
  return windows;
}

const numbered = (count, word = 'message') => Array.from({ length: count }, (_, i) => `${word} ${i + 1}`);

// better-sqlite3 is compiled for Electron's ABI, so the database runs under
// Electron-as-Node, in a data folder of its own.
function runInElectronNode(code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-message-search-'));
  try {
    const r = spawnSync(require('electron'), ['-e', code], {
      cwd: APP_DIR,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SWITCHBOARD_DATA_DIR: dir },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Each query's ids from `all` (the full-text index), with one cached session per text. */
function searchAll(texts, queries) {
  return runInElectronNode(`
    const db = require('./db');
    const texts = ${JSON.stringify(texts)};
    db.upsertCachedSessions(texts.map((body, i) => ({ sessionId: 'session-' + i, folder: ${JSON.stringify(FOLDER)},
      projectPath: ${JSON.stringify(PROJECT)}, summary: 'Title ' + i, textContent: body })));
    db.upsertSearchEntries(texts.map((body, i) => ({ id: 'session-' + i, type: 'session',
      folder: ${JSON.stringify(FOLDER)}, title: 'Title ' + i, body })));
    // A search document whose session left the cache is not a result.
    db.upsertSearchEntries([{ id: 'gone', type: 'session', folder: ${JSON.stringify(FOLDER)}, title: 'Gone', body: texts.join(' ') }]);
    const out = {};
    for (const q of ${JSON.stringify(queries)}) out[q] = db.searchSessionBodyIds(q).sort();
    db.closeDb();
    console.log(JSON.stringify(out));
  `);
}

test('the first and last 20 texts are kept, each cut at 8000 characters', () => {
  assert.equal(MESSAGE_WINDOW, 20);
  assert.equal(MESSAGE_TEXT_MAX, 8000);
  const texts = numbered(30);
  texts[0] = 'a'.repeat(9000);
  texts[29] = 'z'.repeat(8001);
  const windows = windowsOf(texts);

  assert.equal(windows.head.length, 20);
  assert.equal(windows.head[0], 'a'.repeat(8000));
  assert.deepEqual(windows.head.slice(1), texts.slice(1, 20));
  assert.equal(windows.tail.length, 20);
  assert.deepEqual(windows.tail.slice(0, -1), texts.slice(10, 29));
  assert.equal(windows.tail[19], 'z'.repeat(8000));

  // A short conversation is all head and all tail.
  const short = windowsOf(['only question', 'only answer']);
  assert.deepEqual(short, { head: ['only question', 'only answer'], tail: ['only question', 'only answer'] });

  // What is stored comes back; what does not parse is empty.
  const stored = { headTexts: JSON.stringify(windows.head), tailTexts: JSON.stringify(windows.tail) };
  assert.deepEqual(parseMessageWindows(stored), windows);
  assert.deepEqual(parseMessageWindows({ headTexts: '["cut', tailTexts: null }), { head: [], tail: [] });
  assert.deepEqual(parseMessageWindows({ headTexts: '{"not":"a list"}', tailTexts: '[1, "kept"]' }),
    { head: [], tail: ['kept'] });
  assert.deepEqual(parseMessageWindows({}), { head: [], tail: [] });

  assert.equal(lastMessageText(windows), 'z'.repeat(300));
  assert.equal(lastMessageText(short, 4), 'only');
  assert.equal(lastMessageText({ head: [], tail: [] }), '');
});

test('a resumed transcript keeps its head and moves its tail', () => {
  withTmp((dir) => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, transcript(numbered(25)), 'utf8');
    const sizeBefore = fs.statSync(file).size;

    const first = readSessionFile(file, FOLDER, PROJECT);
    assert.ok(first, 'the first read returns a session');
    const before = parseMessageWindows(first);
    assert.deepEqual(before.head, numbered(25).slice(0, 20));
    assert.deepEqual(before.tail, numbered(25).slice(5));

    fs.appendFileSync(file, transcript(['the appended answer']), 'utf8');
    const resumed = readSessionFile(file, FOLDER, PROJECT, first);
    assert.ok(resumed.bytesRead < sizeBefore / 2, 'the second read resumes instead of reading again from the start');

    const after = parseMessageWindows(resumed);
    assert.deepEqual(after.head, before.head, 'the head stays as it was');
    assert.equal(after.tail.length, 20);
    assert.equal(after.tail[19], 'the appended answer');
    assert.deepEqual(after.tail.slice(0, 19), before.tail.slice(1));

    const full = readSessionFile(file, FOLDER, PROJECT);
    assert.equal(resumed.headTexts, full.headTexts);
    assert.equal(resumed.tailTexts, full.tailTexts);
  });
});

test('a cached row without windows is read again from the start', () => {
  withTmp((dir) => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, transcript(numbered(25)), 'utf8');
    const first = readSessionFile(file, FOLDER, PROJECT);
    const legacy = { ...first };
    delete legacy.headTexts;
    delete legacy.tailTexts;

    fs.appendFileSync(file, transcript(['the appended answer']), 'utf8');
    const reread = readSessionFile(file, FOLDER, PROJECT, legacy);
    assert.ok(reread.bytesRead >= fs.statSync(file).size, `read ${reread.bytesRead} bytes, not the whole file`);
    assert.equal(reread.messageCount, 26, 'nothing is counted twice');
    const windows = parseMessageWindows(reread);
    assert.deepEqual(windows.head, numbered(25).slice(0, 20));
    assert.equal(windows.tail[19], 'the appended answer');
  });
});

test('first N, last N and all match the right messages', () => {
  const texts = numbered(25, 'middle');
  texts[0] = 'The alpha question';
  texts[24] = 'The omega answer';
  const windows = windowsOf(texts);

  assert.equal(matchesMessageWindow(windows, 'alpha', { which: 'first', n: 1 }), true);
  assert.equal(matchesMessageWindow(windows, 'omega', { which: 'first', n: 1 }), false);
  assert.equal(matchesMessageWindow(windows, 'omega', { which: 'last', n: 1 }), true);
  assert.equal(matchesMessageWindow(windows, 'alpha', { which: 'last', n: 1 }), false);
  assert.equal(matchesMessageWindow(windows, 'alpha', { which: 'last', n: 3 }), false);
  assert.equal(matchesMessageWindow(windows, 'middle 23', { which: 'last', n: 3 }), true);
  assert.equal(matchesMessageWindow(windows, 'middle 22', { which: 'last', n: 3 }), false);
  assert.equal(matchesMessageWindow(windows, 'middle 2', { which: 'first', n: 2 }), true);
  // N stays within the 20 texts kept.
  assert.equal(matchesMessageWindow(windows, 'middle 20', { which: 'first', n: 50 }), true);
  assert.equal(matchesMessageWindow(windows, 'middle 21', { which: 'first', n: 50 }), false);

  // What search-sessions does with First and Last: every cached row, by its stored windows.
  const rows = [
    { sessionId: 'long', headTexts: JSON.stringify(windows.head), tailTexts: JSON.stringify(windows.tail) },
    { sessionId: 'short', headTexts: '["an alpha and an omega"]', tailTexts: '["an alpha and an omega"]' },
    { sessionId: 'legacy', headTexts: null, tailTexts: null },
  ];
  assert.deepEqual(sessionsMatchingMessages(rows, 'alpha', { which: 'first', n: 1 }), ['long', 'short']);
  assert.deepEqual(sessionsMatchingMessages(rows, 'omega', { which: 'first', n: 1 }), ['short']);
  assert.deepEqual(sessionsMatchingMessages(rows, 'OMEGA', { which: 'last', n: 1 }), ['long', 'short']);
  assert.deepEqual(sessionsMatchingMessages(rows, 'alpha', { which: 'last', n: 3 }), ['short']);
  assert.deepEqual(sessionsMatchingMessages(rows, 'al', { which: 'first', n: 1 }), []);

  const hits = searchAll([texts.join('\n'), 'nothing to see'], ['alpha', 'omega', 'middle 13']);
  assert.deepEqual(hits, { alpha: ['session-0'], omega: ['session-0'], 'middle 13': ['session-0'] });
});

test('short or odd queries match literally or not at all', () => {
  const texts = ['alpha', 'progress at 100% now', 'progress at 1000 now', 'name a_b here', 'name axb here',
    'say "quoted" here', 'say quoted here', 'a\\b and a.b'];
  const one = text => windowsOf([text]);
  const found = query => texts.filter(text => matchesMessageWindow(one(text), query, { which: 'first', n: 1 }));

  assert.deepEqual(found('al'), []);
  assert.deepEqual(found('  al  '), []);
  assert.deepEqual(found('100%'), ['progress at 100% now']);
  assert.deepEqual(found('a_b'), ['name a_b here']);
  assert.deepEqual(found('"quoted"'), ['say "quoted" here']);
  assert.deepEqual(found('ALPHA'), ['alpha']);
  assert.deepEqual(found(' alpha '), ['alpha']);
  assert.deepEqual(found('a.b'), ['a\\b and a.b']);
  assert.deepEqual(found('a\\b'), ['a\\b and a.b']);
  assert.deepEqual(found('.*'), []);
  assert.deepEqual(found(''), []);
  assert.equal(matchesMessageWindow(one('alpha'), null, { which: 'first', n: 1 }), false);

  // `all` asks the full-text index, literally too, and never throws.
  const queries = ['al', '100%', 'a_b', '"quoted"', 'ALPHA', ' alpha ', '" OR alpha', 'alpha*', 'NEAR(a b)', '.*', ''];
  const hits = searchAll(texts, queries);
  const ids = (...indexes) => indexes.map(i => 'session-' + i).sort();
  assert.deepEqual(hits.al, []);
  assert.deepEqual(hits['100%'], ids(1));
  assert.deepEqual(hits.a_b, ids(3));
  assert.deepEqual(hits['"quoted"'], ids(5));
  assert.deepEqual(hits.ALPHA, ids(0));
  assert.deepEqual(hits[' alpha '], ids(0));
  assert.deepEqual(hits['" OR alpha'], []);
  assert.deepEqual(hits['alpha*'], []);
  assert.deepEqual(hits['NEAR(a b)'], []);
  assert.deepEqual(hits['.*'], []);
  assert.deepEqual(hits[''], []);
});

test('Codex and OpenCode keep their first and last texts the same way', () => {
  const texts = numbered(25);
  const expected = { headTexts: JSON.stringify(texts.slice(0, 20)), tailTexts: JSON.stringify(texts.slice(5)) };

  const codex = withTmp((dir) => {
    const file = path.join(dir, 'rollout-2026-09-08T10-00-00-41a185fe-81fa-459a-9f48-cab9e5ab1e65.jsonl');
    fs.writeFileSync(file, line({ type: 'session_meta', payload: { cwd: PROJECT } }) + texts.map((text, i) => {
      const role = i % 2 ? 'assistant' : 'user';
      return line({ type: 'response_item', payload: { type: 'message', role,
        content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    }).join(''));
    return require('../harnesses/codex').readSessionFile(file, 'codex/2026/09/08');
  });
  assert.equal(codex.headTexts, expected.headTexts);
  assert.equal(codex.tailTexts, expected.tailTexts);

  const { DatabaseSync } = require('node:sqlite');
  const opencode = require('../harnesses/opencode');
  const previous = process.env.OPENCODE_DB;
  const row = withTmp((dir) => {
    const file = path.join(dir, 'opencode.db');
    const db = new DatabaseSync(file);
    try {
      db.exec(`CREATE TABLE session_v2 (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL,
          directory text NOT NULL, title text, version text NOT NULL, time_created integer NOT NULL,
          time_updated integer NOT NULL, time_archived integer);
        CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL,
          seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`);
      db.prepare("INSERT INTO session_v2 VALUES ('ses_1', 'p', NULL, 's', ?, NULL, '2.3.2', 1, 1, NULL)").run(PROJECT);
      texts.forEach((text, i) => db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, 1, 1, ?)').run(
        `msg_${i}`, 'ses_1', i % 2 ? 'assistant' : 'user', i + 1,
        JSON.stringify(i % 2 ? { time: { created: 1, completed: 2 }, content: [{ type: 'text', text }] } : { text })));
      process.env.OPENCODE_DB = file;
      return opencode.readSessionFile('ses_1', 'opencode/p');
    } finally {
      opencode.closeDb();
      db.close();
      if (previous === undefined) delete process.env.OPENCODE_DB; else process.env.OPENCODE_DB = previous;
    }
  });
  assert.equal(row.headTexts, expected.headTexts);
  assert.equal(row.tailTexts, expected.tailTexts);
});
