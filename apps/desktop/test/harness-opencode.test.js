const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const opencode = require('../harnesses/opencode');

// The tables OpenCode 2.x keeps its conversations in, cut down to the columns
// the harness reads. Column names and types are the ones `opencode` 2.3.2
// creates (session_v2 / session_message / session_part).
const SCHEMA = `
  CREATE TABLE session_v2 (
    id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text,
    fork_session_id text, slug text NOT NULL, directory text NOT NULL, path text, title text,
    version text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL,
    time_busy integer, time_idle integer, idle_outcome text, time_archived integer
  );
  CREATE TABLE session_message (
    id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
    time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
  );
  CREATE TABLE session_part (
    message_id text NOT NULL, session_id text NOT NULL, ordinal integer NOT NULL, type text NOT NULL,
    call_id text, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL,
    PRIMARY KEY (message_id, ordinal)
  );
`;

const T0 = Date.parse('2026-11-21T10:00:00.000Z');

let dir, dbFile, db;
const savedEnv = {};

function setEnv(key, value) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-fixture-'));
  dbFile = path.join(dir, 'opencode.db');
  db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  setEnv('OPENCODE_DB', dbFile);
});

afterEach(() => {
  opencode.closeDb();
  try { db.close(); } catch {}
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function addSession({ id, project = 'p1', directory = '/work/app', title = null, parent = null,
  archived = null, created = T0, updated = T0 }) {
  db.prepare(`INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version,
    time_created, time_updated, time_archived) VALUES (?, ?, ?, 'calm-otter', ?, ?, '2.3.2', ?, ?, ?)`)
    .run(id, project, parent, directory, title, created, updated, archived);
}

let msgCounter = 0;
function addMessage(sessionId, type, seq, data, created = T0 + seq * 1000) {
  const id = `msg_${String(++msgCounter).padStart(4, '0')}`;
  db.prepare(`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, sessionId, type, seq, created, created, JSON.stringify(data));
  return id;
}

const user = text => ({ time: { created: T0 }, text, files: [] });
const assistant = (content, completed = true) => ({
  time: completed ? { created: T0, completed: T0 + 1 } : { created: T0 },
  agent: 'build', model: { id: 'm', providerID: 'p' }, content,
});

// --- identity and layout ---

test('identity: OpenCode, namespaced folders, one session per directory', () => {
  assert.equal(opencode.id, 'opencode');
  assert.equal(opencode.label, 'OpenCode');
  assert.equal(opencode.binary, 'opencode');
  assert.equal(opencode.folderPrefix, 'opencode/');
  assert.equal(opencode.groupsByProject, false);
});

test('the database is OPENCODE_DB when it is absolute', () => {
  assert.equal(opencode.dbPath(), dbFile);
  assert.equal(opencode.sessionsRoot(), dir);
});

test('a relative OPENCODE_DB is a file name in the data folder', () => {
  setEnv('XDG_DATA_HOME', '/data');
  setEnv('OPENCODE_DB', 'other.db');
  assert.equal(opencode.dbPath(), path.join('/data', 'opencode', 'other.db'));
});

test('without OPENCODE_DB the database follows XDG_DATA_HOME, then ~/.local/share', () => {
  setEnv('OPENCODE_DB', undefined);
  setEnv('XDG_DATA_HOME', '/data');
  assert.equal(opencode.dbPath(), path.join('/data', 'opencode', 'opencode.db'));
  setEnv('XDG_DATA_HOME', undefined);
  assert.equal(opencode.dbPath(), path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'));
});

test('available() is whether the database file exists', () => {
  assert.equal(opencode.available(), true);
  setEnv('OPENCODE_DB', path.join(dir, 'missing.db'));
  assert.equal(opencode.available(), false);
});

test('one folder per OpenCode project that has a top-level session', () => {
  addSession({ id: 'ses_a', project: 'p1' });
  addSession({ id: 'ses_b', project: 'p2' });
  addSession({ id: 'ses_child', project: 'p3', parent: 'ses_a' });
  assert.deepEqual(opencode.listFolders().sort(), ['opencode/p1', 'opencode/p2']);
});

test('a 1.x database without session_v2 lists nothing instead of failing', () => {
  const old = path.join(dir, 'old.db');
  const legacy = new DatabaseSync(old);
  legacy.exec('CREATE TABLE session (id text PRIMARY KEY)');
  legacy.close();
  setEnv('OPENCODE_DB', old);
  assert.deepEqual(opencode.listFolders(), []);
  assert.deepEqual(opencode.listSessionStamps('opencode/p1'), []);
  assert.equal(opencode.readSessionFile('ses_a', 'opencode/p1'), null);
});

test('the file-based parts of the contract have nothing to do', () => {
  assert.deepEqual(opencode.listTranscripts('/anywhere'), []);
  assert.equal(opencode.sessionIdFromPath('/anywhere/x.jsonl'), null);
  assert.equal(opencode.transcriptPath({ sessionId: 'ses_a' }), null);
  assert.equal(opencode.deriveProjectPath(), null);
  assert.equal(opencode.folderForProject(), null);
});

// --- change detection ---

test('listSessionStamps skips subagents and archived sessions', () => {
  addSession({ id: 'ses_a', updated: T0 + 5 });
  addSession({ id: 'ses_child', parent: 'ses_a' });
  addSession({ id: 'ses_old', archived: T0 });
  addSession({ id: 'ses_other', project: 'p2' });
  assert.deepEqual(opencode.listSessionStamps('opencode/p1'), [
    { sessionId: 'ses_a', locator: 'ses_a', stamp: new Date(T0 + 5).toISOString() },
  ]);
});

test('the folder stamp moves when a session is written to or deleted', () => {
  addSession({ id: 'ses_a', updated: T0 });
  addSession({ id: 'ses_b', updated: T0 + 10 });
  const first = opencode.folderStamp('opencode/p1');
  assert.ok(first > 0);

  db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(T0 + 20, 'ses_a');
  const second = opencode.folderStamp('opencode/p1');
  assert.notEqual(second, first);

  db.prepare('DELETE FROM session_v2 WHERE id = ?').run('ses_a');
  assert.notEqual(opencode.folderStamp('opencode/p1'), second);
});

test('a folder exists while its project has sessions', () => {
  addSession({ id: 'ses_a' });
  assert.equal(opencode.folderExists('opencode/p1'), true);
  assert.equal(opencode.folderExists('opencode/p9'), false);
  assert.equal(opencode.folderStamp('opencode/p9'), 0);
});

test('sessionStamp is the session row\'s update time, null once it is gone', () => {
  addSession({ id: 'ses_a', updated: T0 + 7 });
  assert.equal(opencode.sessionStamp({ sessionId: 'ses_a' }), new Date(T0 + 7).toISOString());
  assert.equal(opencode.sessionStamp({ sessionId: 'ses_missing' }), null);
});

test('a database replaced on disk is opened again', () => {
  addSession({ id: 'ses_a' });
  assert.deepEqual(opencode.listFolders(), ['opencode/p1']);
  db.close();
  fs.rmSync(dbFile);
  db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  addSession({ id: 'ses_b', project: 'p2' });
  assert.deepEqual(opencode.listFolders(), ['opencode/p2']);
});

// --- session rows ---

test('readSessionFile turns a session into a row like the other CLIs\'', () => {
  addSession({ id: 'ses_a', directory: '/work/app', title: 'Fix the login', created: T0, updated: T0 + 9000 });
  addMessage('ses_a', 'user', 4, user('Why does login fail?'));
  addMessage('ses_a', 'assistant', 5, assistant([
    { type: 'reasoning', text: 'thinking about it' },
    { type: 'tool', id: 'call_1', name: 'shell', state: { status: 'completed', input: { command: 'ls' }, content: [{ type: 'text', text: 'a.js' }] } },
  ]));
  addMessage('ses_a', 'assistant', 6, assistant([{ type: 'text', text: 'The token expired.' }]));
  addMessage('ses_a', 'idle', 7, { time: { created: T0 }, outcome: 'succeeded' });

  const row = opencode.readSessionFile('ses_a', 'opencode/p1', null);
  assert.equal(row.sessionId, 'ses_a');
  assert.equal(row.folder, 'opencode/p1');
  assert.equal(row.projectPath, '/work/app');
  assert.equal(row.runtime, 'opencode');
  assert.equal(row.sessionFile, null);
  assert.equal(row.summary, 'Why does login fail?');
  assert.equal(row.firstPrompt, 'Why does login fail?');
  assert.equal(row.aiTitle, 'Fix the login');
  assert.equal(row.customTitle, null);
  assert.equal(row.messageCount, 2);
  assert.equal(row.created, new Date(T0).toISOString());
  assert.equal(row.fileMtime, new Date(T0 + 9000).toISOString());
  assert.equal(row.modified, new Date(T0 + 6000).toISOString());
  assert.match(row.textContent, /Why does login fail\?/);
  assert.match(row.textContent, /The token expired\./);
  assert.doesNotMatch(row.textContent, /thinking about it/);
});

test('the summary is cut like the other CLIs\'', () => {
  addSession({ id: 'ses_a' });
  addMessage('ses_a', 'user', 1, user('x'.repeat(300)));
  assert.equal(opencode.readSessionFile('ses_a', 'opencode/p1').summary.length, 120);
});

test('the fallback "New session - <date>" title is not a title', () => {
  addSession({ id: 'ses_a', title: 'New session - 2026-11-21T09:06:53.228Z' });
  addMessage('ses_a', 'user', 1, user('hello'));
  assert.equal(opencode.readSessionFile('ses_a', 'opencode/p1').aiTitle, null);
});

test('a session nobody wrote to, a subagent and an archived session are not listed', () => {
  addSession({ id: 'ses_empty' });
  addSession({ id: 'ses_child', parent: 'ses_empty' });
  addMessage('ses_child', 'user', 1, user('do the subtask'));
  addSession({ id: 'ses_archived', archived: T0 });
  addMessage('ses_archived', 'user', 1, user('old'));
  assert.equal(opencode.readSessionFile('ses_empty', 'opencode/p1'), null);
  assert.equal(opencode.readSessionFile('ses_child', 'opencode/p1'), null);
  assert.equal(opencode.readSessionFile('ses_archived', 'opencode/p1'), null);
  assert.equal(opencode.readSessionFile('ses_missing', 'opencode/p1'), null);
});

// --- viewer ---

test('text and reasoning become Claude text and thinking blocks', () => {
  const entries = opencode.toViewerEntries([
    { type: 'user', seq: 1, time_created: T0, data: user('hi') },
    { type: 'assistant', seq: 2, time_created: T0 + 1, data: assistant([
      { type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'hello' }]) },
  ]);
  assert.deepEqual(entries.map(e => [e.type, e.message.content[0]]), [
    ['user', { type: 'text', text: 'hi' }],
    ['assistant', { type: 'thinking', thinking: 'hmm' }],
    ['assistant', { type: 'text', text: 'hello' }],
  ]);
  assert.equal(entries[0].timestamp, new Date(T0).toISOString());
});

test('a tool call becomes a tool_use and its output a tool_result with the same id', () => {
  const entries = opencode.toViewerEntries([{ type: 'assistant', seq: 1, time_created: T0, data: assistant([
    { type: 'tool', id: 'call_1', name: 'shell', state: { status: 'completed', input: { command: 'ls', workdir: '/w' },
      content: [{ type: 'text', text: 'a.js\n' }, { type: 'text', text: 'b.js\n' }] } },
  ]) }]);
  assert.deepEqual(entries[0].message.content[0], { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls', workdir: '/w' } });
  assert.equal(entries[1].type, 'user');
  assert.deepEqual(entries[1].message.content[0], { type: 'tool_result', tool_use_id: 'call_1', content: 'a.js\nb.js\n', is_error: false });
});

test('a failed tool reports its error', () => {
  const entries = opencode.toViewerEntries([{ type: 'assistant', seq: 1, time_created: T0, data: assistant([
    { type: 'tool', id: 'call_1', name: 'read', state: { status: 'error', input: { path: '/x' }, error: { type: 'x', message: 'not found' } } },
  ]) }]);
  assert.deepEqual(entries[1].message.content[0], { type: 'tool_result', tool_use_id: 'call_1', content: 'not found', is_error: true });
});

test('a tool still running has no result yet', () => {
  const entries = opencode.toViewerEntries([{ type: 'assistant', seq: 1, time_created: T0, data: assistant([
    { type: 'tool', id: 'call_1', name: 'shell', state: { status: 'running', input: { command: 'sleep 9' }, metadata: {} } },
  ]) }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message.content[0].type, 'tool_use');
});

test('tool names and inputs are mapped onto Claude\'s, so tool details render', () => {
  const call = (name, input) => opencode.toViewerEntries([{ type: 'assistant', seq: 1, time_created: T0, data: assistant([
    { type: 'tool', id: 'c', name, state: { status: 'running', input } }]) }])[0].message.content[0];

  assert.deepEqual(call('edit', { path: '/a.js', oldString: 'x', newString: 'y', replaceAll: true }),
    { type: 'tool_use', id: 'c', name: 'Edit', input: { file_path: '/a.js', old_string: 'x', new_string: 'y', replace_all: true } });
  assert.deepEqual(call('write', { path: '/a.js', content: 'z' }).input, { file_path: '/a.js', content: 'z' });
  assert.equal(call('write', { path: '/a.js', content: 'z' }).name, 'Write');
  assert.deepEqual(call('read', { path: '/a.js', offset: 3, limit: 9 }).input, { file_path: '/a.js', offset: 3, limit: 9 });
  assert.equal(call('glob', { pattern: '*.js', path: '/w' }).name, 'Glob');
  assert.deepEqual(call('grep', { pattern: 'x', path: '/w', include: '*.ts' }).input, { pattern: 'x', path: '/w', glob: '*.ts' });
  assert.deepEqual(call('patch', { patchText: '*** Begin Patch' }), { type: 'tool_use', id: 'c', name: 'apply_patch', input: '*** Begin Patch' });
  assert.deepEqual(call('webfetch', { url: 'https://x', format: 'markdown' }).input, { url: 'https://x', prompt: 'markdown' });
  assert.equal(call('websearch', { query: 'q' }).name, 'WebSearch');
  assert.deepEqual(call('subagent', { agent: 'explore', description: 'look', prompt: 'find it' }),
    { type: 'tool_use', id: 'c', name: 'Task', input: { subagent_type: 'explore', description: 'look', prompt: 'find it' } });
  assert.equal(call('todowrite', { todos: [] }).name, 'TodoWrite');
  assert.deepEqual(call('question', { questions: [{ question: 'q', header: 'h', options: [], multiple: true }] }).input,
    { questions: [{ question: 'q', header: 'h', options: [], multiSelect: true }] });
  // Sessions imported from 1.x keep their old names and camelCase paths.
  assert.deepEqual(call('bash', { command: 'ls' }), { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'ls' } });
  assert.deepEqual(call('edit', { filePath: '/b.js', oldString: 'a', newString: 'b' }).input,
    { file_path: '/b.js', old_string: 'a', new_string: 'b' });
  assert.deepEqual(call('list', { path: '/w' }), { type: 'tool_use', id: 'c', name: 'LS', input: { path: '/w' } });
  // Anything else passes through untouched.
  assert.deepEqual(call('mcp_server_tool', { a: 1 }), { type: 'tool_use', id: 'c', name: 'mcp_server_tool', input: { a: 1 } });
});

test('a turn that failed shows its error as an API error, like Claude\'s', () => {
  const failed = { ...assistant([]), finish: 'error', error: { type: 'provider.free-limit', message: 'Free usage limit reached.' } };
  const entries = opencode.toViewerEntries([{ type: 'assistant', seq: 1, time_created: T0, data: failed }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].isApiErrorMessage, true);
  assert.deepEqual(entries[0].message.content, [{ type: 'text', text: 'Free usage limit reached.' }]);
});

test('a shell command the user ran shows as a Bash call with its output', () => {
  const entries = opencode.toViewerEntries([{ type: 'shell', seq: 1, time_created: T0,
    data: { shellID: 's1', command: 'git status', status: 'completed', exit: 0, output: 'clean', time: { created: T0 } } }]);
  assert.deepEqual(entries.map(e => e.message.content[0].type), ['tool_use', 'tool_result']);
  assert.deepEqual(entries[0].message.content[0].input, { command: 'git status' });
  assert.equal(entries[1].message.content[0].content, 'clean');
});

test('scaffolding the CLI adds for the model is not shown', () => {
  const entries = opencode.toViewerEntries([
    { type: 'synthetic', seq: 1, time_created: T0, data: { text: 'context' } },
    { type: 'system', seq: 2, time_created: T0, data: { text: 'reminder' } },
    { type: 'idle', seq: 3, time_created: T0, data: { outcome: 'succeeded' } },
    { type: 'model-switched', seq: 4, time_created: T0, data: {} },
  ]);
  assert.deepEqual(entries, []);
});

test('rows given as stored JSON text are read too', () => {
  const entries = opencode.toViewerEntries([{ type: 'user', seq: 1, time_created: T0, data: JSON.stringify(user('raw')) }]);
  assert.equal(entries[0].message.content[0].text, 'raw');
});

test('readEntriesSince follows a session a message at a time', () => {
  addSession({ id: 'ses_a' });
  addMessage('ses_a', 'user', 4, user('one'));
  addMessage('ses_a', 'assistant', 5, assistant([{ type: 'text', text: 'two' }]));
  const row = { sessionId: 'ses_a', runtime: 'opencode' };

  const first = opencode.readEntriesSince(row, 0);
  assert.deepEqual(first.entries.map(e => e.message.content[0].text), ['one', 'two']);
  assert.equal(first.cursor, 5);
  assert.equal(first.reset, false);

  addMessage('ses_a', 'idle', 6, { outcome: 'succeeded' });
  addMessage('ses_a', 'user', 7, user('three'));
  const next = opencode.readEntriesSince(row, first.cursor);
  assert.deepEqual(next.entries.map(e => e.message.content[0].text), ['three']);
  assert.equal(next.cursor, 7);

  assert.deepEqual(opencode.readEntriesSince(row, next.cursor).entries, []);
  assert.equal(opencode.readEntriesSince(row, next.cursor).cursor, 7);
});

test('an assistant message still being written is left for the next read', () => {
  addSession({ id: 'ses_a' });
  addMessage('ses_a', 'user', 1, user('go'));
  addMessage('ses_a', 'assistant', 2, assistant([{ type: 'text', text: 'partial' }], false));
  const read = opencode.readEntriesSince({ sessionId: 'ses_a' }, 0);
  assert.deepEqual(read.entries.map(e => e.message.content[0].text), ['go']);
  assert.equal(read.cursor, 1);
});

test('an unfinished assistant message followed by more conversation is not waited for', () => {
  // OpenCode records no end for a step cut short by a shutdown. Once the
  // conversation has moved on, that message will never complete.
  addSession({ id: 'ses_a' });
  addMessage('ses_a', 'assistant', 1, assistant([{ type: 'text', text: 'cut short' }], false));
  addMessage('ses_a', 'user', 2, user('again'));
  const read = opencode.readEntriesSince({ sessionId: 'ses_a' }, 0);
  assert.deepEqual(read.entries.map(e => e.message.content[0].text), ['cut short', 'again']);
  assert.equal(read.cursor, 2);
});

test('a cursor past the end starts over', () => {
  addSession({ id: 'ses_a' });
  addMessage('ses_a', 'user', 1, user('only'));
  const read = opencode.readEntriesSince({ sessionId: 'ses_a' }, 50);
  assert.equal(read.reset, true);
  assert.equal(read.entries.length, 1);
  assert.equal(read.cursor, 1);
});

test('parts stored as rows come before the message\'s inline content', () => {
  addSession({ id: 'ses_a' });
  const msgId = addMessage('ses_a', 'assistant', 1, assistant([{ type: 'text', text: 'inline' }]));
  db.prepare(`INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data)
    VALUES (?, 'ses_a', 0, 'text', NULL, ?, ?, ?)`).run(msgId, T0, T0, JSON.stringify({ type: 'text', text: 'from row' }));
  const texts = opencode.readEntriesSince({ sessionId: 'ses_a' }, 0).entries.map(e => e.message.content[0].text);
  assert.deepEqual(texts, ['from row', 'inline']);
});

// --- activity ---
//
// OpenCode's title says nothing about activity ("OpenCode", or "OC | <title>").
// Its state comes as OSC 7501 records: state=idle|working|blocked|clear, an
// optional session id, and base64 title and message fields.

const b64 = text => Buffer.from(text, 'utf8').toString('base64');

test('the title is never read as a state', () => {
  assert.equal(opencode.parseTitleState('OpenCode'), null);
  assert.equal(opencode.parseTitleState('OC | Fix the login'), null);
  assert.equal(opencode.parseTitleState(''), null);
});

test('the session title is taken from "OC | <title>"', () => {
  assert.equal(opencode.titleFromTerminal('OC | Fix the login'), 'Fix the login');
  assert.equal(opencode.titleFromTerminal('OpenCode'), null);
  assert.equal(opencode.titleFromTerminal(''), null);
  assert.equal(opencode.titleFromTerminal('OC | '), null);
});

test('a notification asking for input is attention, any other one is idle', () => {
  assert.equal(opencode.classifyNotification('Permission needs input'), 'attention');
  assert.equal(opencode.classifyNotification('Input needs response'), 'attention');
  assert.equal(opencode.classifyNotification('Session done'), 'idle');
  assert.equal(opencode.classifyNotification(''), null);
});

test('OSC 7501 records map onto busy, attention and idle', () => {
  assert.deepEqual(opencode.parseStatusReport(`state=working:app=opencode:title=${b64('Fix the login')}`),
    { state: 'busy', id: null, kind: null, title: 'Fix the login', message: null });
  assert.deepEqual(opencode.parseStatusReport('state=working:id=ses_abc:app=opencode'),
    { state: 'busy', id: 'ses_abc', kind: null, title: null, message: null });
  assert.deepEqual(
    opencode.parseStatusReport(`state=blocked:id=ses_abc:kind=permission:app=opencode:title=${b64('T')}:msg=${b64('Permission needs input')}`),
    { state: 'attention', id: 'ses_abc', kind: 'permission', title: 'T', message: 'Permission needs input' });
  assert.equal(opencode.parseStatusReport('state=idle:app=opencode').state, 'idle');
  // A session that is no longer pending, or the TUI quitting.
  assert.equal(opencode.parseStatusReport('state=clear:id=ses_abc').state, 'idle');
  assert.equal(opencode.parseStatusReport('state=clear').state, 'idle');
});

test('OSC 7501 queries, other programs\' records and junk are ignored', () => {
  assert.equal(opencode.parseStatusReport('?'), null);
  assert.equal(opencode.parseStatusReport('state=working:app=someone-else'), null);
  assert.equal(opencode.parseStatusReport('state=dancing:app=opencode'), null);
  assert.equal(opencode.parseStatusReport(''), null);
});

test('a title cut off mid-record is dropped, not garbled', () => {
  // main.js keeps the first 120 characters of an OSC payload.
  const report = opencode.parseStatusReport(`state=working:app=opencode:title=${b64('x'.repeat(200)).slice(0, 61)}`);
  assert.equal(report.state, 'busy');
  assert.equal(report.title, null);
});

// --- launch ---

test('a new session is started on the id Switchboard chose, with its first prompt', () => {
  assert.deepEqual(opencode.buildLaunchArgs({ sessionId: 'ses_x', isNew: true, options: { initialPrompt: 'Fix the login' } }),
    ['--session', 'ses_x', '--prompt', 'Fix the login']);
  assert.deepEqual(opencode.buildLaunchArgs({ sessionId: 'ses_x', isNew: true, options: null }), ['--session', 'ses_x']);
});

test('a resumed session is opened by id, and a first prompt is not sent again', () => {
  assert.deepEqual(opencode.buildLaunchArgs({ sessionId: 'ses_x', isNew: false, options: { initialPrompt: 'again' } }),
    ['--session', 'ses_x']);
});

test('skipping permissions is OpenCode\'s --auto; Claude-only options are ignored', () => {
  assert.deepEqual(opencode.buildLaunchArgs({ sessionId: 'ses_x', isNew: false, options: {
    dangerouslySkipPermissions: true, permissionMode: 'plan', addDirs: '/a,/b', model: 'opus', worktree: true, chrome: true,
  } }), ['--session', 'ses_x', '--auto']);
});

test('new ids have OpenCode\'s shape and sort newest first, like its own', () => {
  const ids = Array.from({ length: 50 }, () => opencode.newSessionId());
  for (const sid of ids) assert.match(sid, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.equal(new Set(ids).size, ids.length);
  // Descending: an id made later sorts before one made earlier.
  const sorted = [...ids].sort();
  assert.deepEqual(sorted, [...ids].reverse());
});

test('the time part matches OpenCode\'s generator for a given moment', () => {
  // ~(ms * 0x1000 + counter), low 48 bits, as packages/schema/src/identifier.ts.
  const ms = Date.parse('2026-11-21T09:06:53.228Z');
  const expected = ((~(BigInt(ms) * 0x1000n + 1n)) & 0xffffffffffffn).toString(16).padStart(12, '0');
  assert.equal(opencode.newSessionId(ms).slice(4, 16), expected);
});

test('a new session is matched once OpenCode has created it under the chosen id', () => {
  assert.equal(opencode.needsIdDetection({ isNew: true }), true);
  assert.equal(opencode.needsIdDetection({ isNew: false }), false);
  assert.equal(opencode.readLaunchSignals('ses_new'), null, 'nothing until the first prompt creates the row');
  addSession({ id: 'ses_new' });
  const signals = opencode.readLaunchSignals('ses_new');
  assert.deepEqual(signals, { sessionId: 'ses_new' });
  assert.equal(opencode.matchesLaunch(signals, { tag: 'ses_new' }), true);
  assert.equal(opencode.matchesLaunch(signals, { tag: 'ses_other' }), false);
  assert.equal(opencode.matchesLaunch(null, { tag: 'ses_new' }), false);
});

test('fork waits for OpenCode\'s service: not offered yet', () => {
  assert.equal(opencode.canFork, false);
});

test('a blocked record without its message still says what it waits for', () => {
  // The message comes last in the record and can be cut off with it.
  assert.equal(opencode.parseStatusReport('state=blocked:kind=permission:app=opencode').message, 'Permission needs input');
  assert.equal(opencode.parseStatusReport('state=blocked:kind=question:app=opencode').message, 'Input needs response');
  assert.equal(opencode.parseStatusReport('state=working:app=opencode').message, null);
});

// --- review fixes ---

test('a 1.x database upgraded to 2.x in place is read without reopening it', () => {
  // OpenCode 2.x migrates the same opencode.db file, so its inode stays put
  // while the app that read it as a 1.x database keeps running.
  const file = path.join(dir, 'upgraded.db');
  const live = new DatabaseSync(file);
  live.exec('CREATE TABLE session (id text PRIMARY KEY)');
  setEnv('OPENCODE_DB', file);
  assert.deepEqual(opencode.listFolders(), []);

  live.exec(SCHEMA);
  live.prepare(`INSERT INTO session_v2 (id, project_id, slug, directory, version, time_created, time_updated)
    VALUES ('ses_up', 'p1', 's', '/w', '2.3.2', 1, 1)`).run();
  assert.deepEqual(opencode.listFolders(), ['opencode/p1']);
  live.close();
});

test('an unreadable database is an error, not an empty one', () => {
  // Reading "nothing" would tell the indexer the sessions were deleted.
  const broken = path.join(dir, 'broken.db');
  fs.writeFileSync(broken, 'this is not a database, just bytes '.repeat(200));
  setEnv('OPENCODE_DB', broken);
  assert.equal(opencode.available(), true);
  assert.throws(() => opencode.folderExists('opencode/p1'));
  assert.throws(() => opencode.folderStamp('opencode/p1'));
  assert.throws(() => opencode.listSessionStamps('opencode/p1'));
  assert.throws(() => opencode.readEntriesSince({ sessionId: 'ses_a' }, 3));
  // Where "not yet" or "changed" is the safe answer, it is still given.
  assert.equal(opencode.readLaunchSignals('ses_a'), null);
  assert.equal(opencode.sessionStamp({ sessionId: 'ses_a' }), null);
  assert.equal(opencode.readSessionFile('ses_a', 'opencode/p1'), null);
});
