const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MESSAGE_WINDOW, MESSAGE_TEXT_MAX,
  pushMessageWindow, parseMessageWindows, matchesMessageWindow, sessionsMatchingMessages, lastMessageText,
  indexQueryFor, searchMessageWindows,
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

/** A db.js stand-in: the index finds the indexed sessions whose texts hold the lookup; every read of windows is kept. */
function fakeDb(sessions, { refuse = false } = {}) {
  const calls = { lookups: [], reads: [] };
  const rowOf = s => {
    const windows = windowsOf(s.texts);
    return { sessionId: s.id, headTexts: JSON.stringify(windows.head), tailTexts: JSON.stringify(windows.tail) };
  };
  return {
    calls,
    matchSessionBodyIds(lookup) {
      calls.lookups.push(lookup);
      if (refuse) return null;
      return sessions.filter(s => s.indexed !== false && s.texts.join('\n').toLowerCase().includes(lookup.toLowerCase())).map(s => s.id);
    },
    getUnindexedSessionIds: () => sessions.filter(s => s.indexed === false).map(s => s.id),
    getMessageWindows(ids = null) {
      calls.reads.push(ids);
      return sessions.filter(s => ids === null || ids.includes(s.id)).map(rowOf);
    },
    allRows: () => sessions.map(rowOf),
  };
}

test('first and last read only the sessions the full-text index finds', () => {
  const sessions = [
    { id: 'opens', texts: ['The alpha question', ...numbered(23, 'middle'), 'The omega answer'] },
    { id: 'closes', texts: ['A plain question', ...numbered(23, 'middle'), 'Back to alpha'] },
    { id: 'quiet', texts: ['Nothing here', 'Nothing there'] },
    { id: 'unindexed', indexed: false, texts: ['An alpha nobody indexed'] },
  ];
  const cases = [['alpha', 'first', 1], ['alpha', 'last', 1], ['ALPHA', 'last', 3], ['omega', 'first', 20],
    ['middle 2', 'first', 3], ['nothing', 'last', 1], ['zzz', 'first', 1]];
  for (const [query, which, n] of cases) {
    const db = fakeDb(sessions);
    const before = sessionsMatchingMessages(db.allRows(), query, { which, n }).sort();
    assert.deepEqual(searchMessageWindows(query, { which, n }, db).sort(), before, `${query} ${which} ${n}`);
    assert.ok(db.calls.reads.every(ids => Array.isArray(ids)), 'never every row');
  }

  // Only what the index found, and the sessions it has no document for.
  let db = fakeDb(sessions);
  assert.deepEqual(searchMessageWindows('alpha', { which: 'first', n: 1 }, db).sort(), ['opens', 'unindexed']);
  assert.deepEqual(db.calls.lookups, ['alpha']);
  assert.deepEqual(db.calls.reads, [['opens', 'closes', 'unindexed']]);
  db = fakeDb(sessions);
  assert.deepEqual(searchMessageWindows('zzz', { which: 'last', n: 1 }, db), []);
  assert.deepEqual(db.calls.reads, [['unindexed']]);

  // A long list is read a batch at a time.
  const many = Array.from({ length: 1200 }, (_, i) => ({ id: 'many-' + i, texts: ['common words ' + i] }));
  db = fakeDb(many);
  assert.equal(searchMessageWindows('common', { which: 'first', n: 1 }, db).length, 1200);
  assert.deepEqual(db.calls.reads.map(ids => ids.length), [500, 500, 200]);

  // When the index cannot be trusted or refuses the query, every row is read, as before.
  db = fakeDb(sessions, { refuse: true });
  assert.deepEqual(searchMessageWindows('alpha', { which: 'first', n: 1 }, db).sort(), ['opens', 'unindexed']);
  assert.deepEqual(db.calls.reads, [null]);
  db = fakeDb([{ id: 'georgian', texts: ['ᲐᲑᲒ upper case'] }]);
  assert.deepEqual(searchMessageWindows('აბგ', { which: 'first', n: 1 }, db), ['georgian']);
  assert.deepEqual(db.calls.lookups, []);
  assert.deepEqual(db.calls.reads, [null]);
  db = fakeDb([]);
  assert.deepEqual(searchMessageWindows('al', { which: 'first', n: 1 }, db), []);
  assert.deepEqual(db.calls, { lookups: [], reads: [] });
});

test('the index lookup is trusted only where it folds case as the windows do', () => {
  assert.equal(indexQueryFor('alpha'), 'alpha');
  assert.equal(indexQueryFor('  ALPHA  '), 'ALPHA');
  assert.equal(indexQueryFor('perché così'), 'perché così');
  assert.equal(indexQueryFor('Привет'), 'Привет');
  assert.equal(indexQueryFor('“100%” a_b'), '“100%” a_b');
  assert.equal(indexQueryFor('日本語'), '日本語');
  // 'İ' lowers to 'i' and a combining dot the index does not see: a final 'i' is not looked up.
  assert.equal(indexQueryFor('tutti'), 'tutt');
  assert.equal(indexQueryFor('TUTTI'), 'TUTT');
  assert.equal(indexQueryFor('abi'), null);
  assert.equal(indexQueryFor('ab i'), null);
  assert.equal(indexQueryFor('abc i'), 'abc');
  assert.equal(indexQueryFor('İstanbul'), null);
  // Case pairs the index does not fold: Georgian, Cherokee, newer Latin.
  assert.equal(indexQueryFor('აბგ'), null);
  assert.equal(indexQueryFor('ꭰꭱꭲ'), null);
  assert.equal(indexQueryFor('aƛb'), null);
  assert.equal(indexQueryFor('😀a'), null);
  assert.equal(indexQueryFor('ab'), null);
});

test('first and last find through the index what a scan of every row finds', () => {
  const sessions = {
    long: ['The alpha question', ...numbered(23, 'middle'), 'The omega answer'],
    percent: ['progress at 100% now'], digits: ['progress at 1000 now'], underscore: ['name a_b here'],
    quoted: ['say "quoted" here'], plain: ['say quoted here'], accents: ['Perché TUTTI così?'],
  };
  const cases = [['alpha', 'first', 1], ['omega', 'first', 1], ['omega', 'last', 1], ['alpha', 'last', 3],
    ['middle 2', 'first', 3], ['100%', 'first', 1], ['a_b', 'last', 1], ['"quoted"', 'first', 1],
    ['ALPHA', 'first', 1], ['perché tutti', 'first', 1], ['così', 'last', 1], ['tutti', 'first', 1], ['al', 'first', 1]];
  const result = runInElectronNode(`
    const fs = require('fs');
    const path = require('path');
    const db = require('./db');
    const cache = require('./session-cache');
    const { sessionsMatchingMessages, searchMessageWindows } = require('./message-windows');
    const projectsDir = path.join(process.env.SWITCHBOARD_DATA_DIR, 'projects');
    const folderPath = path.join(projectsDir, ${JSON.stringify(FOLDER)});
    fs.mkdirSync(folderPath, { recursive: true });
    const sessions = ${JSON.stringify(sessions)};
    const transcript = ${transcript.toString()};
    const line = ${line.toString()};
    const PROJECT = ${JSON.stringify(PROJECT)};
    for (const [id, texts] of Object.entries(sessions)) fs.writeFileSync(path.join(folderPath, id + '.jsonl'), transcript(texts));
    cache.init({ PROJECTS_DIR: projectsDir, activeSessions: new Map(), getMainWindow: () => null, log: console, db });
    cache.refreshFolder(${JSON.stringify(FOLDER)});
    let rowsRead = 0;
    const counted = { ...db, getMessageWindows: ids => { const rows = db.getMessageWindows(ids); rowsRead += rows.length; return rows; } };
    const out = { cached: db.getMessageWindows().length, cases: [] };
    for (const [q, which, n] of ${JSON.stringify(cases)}) {
      const before = sessionsMatchingMessages(db.getMessageWindows(), q, { which, n }).sort();
      rowsRead = 0;
      const after = searchMessageWindows(q, { which, n }, counted).sort();
      out.cases.push({ q, which, n, before, after, rowsRead, candidates: (db.matchSessionBodyIds(q) || []).length });
    }
    db.closeDb();
    console.log(JSON.stringify(out));
  `);
  assert.equal(result.cached, Object.keys(sessions).length);
  const expected = {
    'alpha first 1': ['long'], 'omega first 1': [], 'omega last 1': ['long'], 'alpha last 3': [],
    'middle 2 first 3': ['long'], '100% first 1': ['percent'], 'a_b last 1': ['underscore'],
    '"quoted" first 1': ['quoted'], 'ALPHA first 1': ['long'], 'perché tutti first 1': ['accents'],
    'così last 1': ['accents'], 'tutti first 1': ['accents'], 'al first 1': [],
  };
  for (const c of result.cases) {
    const key = `${c.q} ${c.which} ${c.n}`;
    assert.deepEqual(c.after, c.before, `${key}: the same sessions as a scan of every row`);
    assert.deepEqual(c.after, expected[key], key);
    assert.ok(c.rowsRead <= Math.max(c.candidates, 1) && c.rowsRead < result.cached, `${key}: read ${c.rowsRead} rows`);
  }
});

test('the full-text index finds every message a trusted query matches', () => {
  // Every character JS lower-cases, in a text and in a query, each way round:
  // wherever indexQueryFor trusts the index, the index must find the text.
  const result = runInElectronNode(`
    const db = require('./db');
    const { indexQueryFor } = require('./message-windows');
    const pairs = [];
    for (let cp = 0; cp <= 0x10FFFF; cp++) {
      if (cp >= 0xD800 && cp <= 0xDFFF) continue;
      const c = String.fromCodePoint(cp);
      const lower = c.toLowerCase();
      if (lower === c) continue;
      pairs.push(['ab' + c + 'cd', 'b' + lower + 'c'], ['ab' + lower + 'cd', 'b' + c + 'c']);
    }
    pairs.push(['xabİcd', 'xabi'], ['xabİcd', 'XABI']);
    const ids = pairs.map((_, i) => 'pair-' + i);
    db.upsertCachedSessions(pairs.map(([text], i) => ({ sessionId: ids[i], folder: 'f', projectPath: '/Users/demo/p', summary: 's', textContent: text })));
    db.upsertSearchEntries(pairs.map(([text], i) => ({ id: ids[i], type: 'session', folder: 'f', title: 't', body: text })));
    // Latin-1, Greek and Cyrillic: the scripts whose case pairs should all be looked up.
    const common = cp => cp < 0x100 || (cp >= 0x370 && cp < 0x500);
    const missed = [];
    const untrustedCommon = new Set();
    pairs.forEach(([text, query], i) => {
      if (!text.toLowerCase().includes(query.toLowerCase())) return;
      const lookup = indexQueryFor(query);
      if (lookup === null) {
        const cps = [text.codePointAt(2), ...[...query].slice(1, -1).map(c => c.codePointAt(0))];
        if (i < pairs.length - 2 && cps.every(common)) untrustedCommon.add(cps[0].toString(16));
        return;
      }
      if (!(db.matchSessionBodyIds(lookup) || []).includes(ids[i])) missed.push(query);
    });
    db.closeDb();
    console.log(JSON.stringify({ missed, untrustedCommon: [...untrustedCommon].sort() }));
  `);
  assert.deepEqual(result.missed, []);
  // Only Greek yot, whose capital the index does not fold, is left to a scan of every row.
  assert.deepEqual(result.untrustedCommon, ['37f', '3f3']);
});
