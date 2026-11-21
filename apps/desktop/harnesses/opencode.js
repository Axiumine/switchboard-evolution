// OpenCode harness (OpenCode 2.x).
//
// OpenCode keeps no file per session. Everything is in one SQLite database
// (~/.local/share/opencode/opencode.db), so this harness reads that database,
// read-only, instead of transcripts:
//
//   - a folder is an OpenCode project ('opencode/<project_id>'), and a project
//     can span directories, so every session carries its own (groupsByProject
//     is false, as for Codex);
//   - there are no files to stat, so the indexer asks this module for stamps
//     (folderExists, folderStamp, listSessionStamps, sessionStamp) and hands
//     readSessionFile a session id where other CLIs get a path;
//   - the viewer follows a session through readEntriesSince, with the message
//     sequence number as its cursor instead of a byte offset.
//
// The tables are OpenCode 2.x's: session_v2, session_message (one row per
// message, its parts inline in `data.content`) and session_part (parts stored
// as rows, an experimental option). A 1.x database has none of them and lists
// nothing.

const fs = require('fs');
const os = require('os');
const path = require('path');

const id = 'opencode';
const label = 'OpenCode';
const binary = 'opencode';
const folderPrefix = 'opencode/';
const groupsByProject = false;

// --- Layout ---

function dataDir() {
  const base = process.env.XDG_DATA_HOME
    ? path.resolve(process.env.XDG_DATA_HOME)
    : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode');
}

/**
 * Where OpenCode keeps its database. OPENCODE_DB names it, relative to the
 * data folder unless absolute; ':memory:' leaves nothing on disk to read.
 */
function dbPath() {
  const override = process.env.OPENCODE_DB;
  if (override && override !== ':memory:') {
    return path.isAbsolute(override) ? override : path.join(dataDir(), override);
  }
  return path.join(dataDir(), 'opencode.db');
}

/** Whether there is anything to read. See codex.available() for why the binary is not probed. */
function available() {
  return fs.existsSync(dbPath());
}

function sessionsRoot() {
  return path.dirname(dbPath());
}

/**
 * What a watcher has to follow: OpenCode writes to the write-ahead log, and to
 * the database itself when it checkpoints or is created.
 */
function watchPaths() {
  const file = dbPath();
  return [file, file + '-wal'];
}

// --- Database access ---
//
// node:sqlite rather than better-sqlite3: the app's better-sqlite3 is built
// for Electron's ABI, which plain `node --test` cannot load, while node:sqlite
// ships with both. One read-only connection per thread (the indexing worker
// opens its own), reopened when the file is replaced.

let conn = null; // { file, ino, db, hasTables }

function openDatabase(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(file, { readOnly: true });
  } catch (err) {
    if (err?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && err?.code !== 'MODULE_NOT_FOUND') throw err;
    const Database = require('better-sqlite3');
    return new Database(file, { readonly: true, fileMustExist: true });
  }
}

function closeDb() {
  if (conn) { try { conn.db.close(); } catch {} }
  conn = null;
}

/** The open database, or null when there is none (or it is not a 2.x one). */
function getDb() {
  const file = dbPath();
  let stat;
  try { stat = fs.statSync(file); } catch { closeDb(); return null; }
  if (conn && (conn.file !== file || conn.ino !== stat.ino)) closeDb();
  if (!conn) {
    let db;
    try { db = openDatabase(file); } catch { return null; }
    let hasTables = false;
    try {
      const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
      hasTables = names.has('session_v2') && names.has('session_message');
      conn = { file, ino: stat.ino, db, hasTables, hasParts: names.has('session_part'), stmts: new Map() };
    } catch {
      try { db.close(); } catch {}
      return null;
    }
  }
  return conn.hasTables ? conn : null;
}

/** A cached prepared statement, or null when there is no database to run it on. */
function stmt(sql) {
  const c = getDb();
  if (!c) return null;
  let s = c.stmts.get(sql);
  if (!s) { s = c.db.prepare(sql); c.stmts.set(sql, s); }
  return s;
}

function all(sql, ...params) {
  try { return stmt(sql)?.all(...params) || []; } catch { return []; }
}

function get(sql, ...params) {
  try { return stmt(sql)?.get(...params) || null; } catch { return null; }
}

/** Accepts a folder key with or without the prefix, like folderPath gets it. */
function projectIdOf(folder) {
  const key = String(folder);
  return key.startsWith(folderPrefix) ? key.slice(folderPrefix.length) : key;
}

function iso(ms) {
  return Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null;
}

// --- Folders ---

function listFolders() {
  return all('SELECT DISTINCT project_id FROM session_v2 WHERE parent_id IS NULL')
    .map(r => folderPrefix + r.project_id);
}

/** Every folder is in the one database file. */
function folderPath() {
  return dbPath();
}

function folderForProject() { return null; }
function deriveProjectPath() { return null; }
function listTranscripts() { return []; }
function sessionIdFromPath() { return null; }
function transcriptPath() { return null; }

function folderExists(folder) {
  return !!get('SELECT 1 AS found FROM session_v2 WHERE project_id = ? LIMIT 1', projectIdOf(folder));
}

/**
 * A number that changes whenever a session of the project is written to,
 * renamed, archived, added or deleted: the newest update time plus the number
 * of sessions. Compared for equality, not order (see session-cache.js).
 */
function folderStamp(folder) {
  const r = get('SELECT MAX(time_updated) AS last, COUNT(*) AS n FROM session_v2 WHERE project_id = ?', projectIdOf(folder));
  if (!r || !r.n) return 0;
  return Number(r.last) + Number(r.n);
}

/** The sessions of a folder worth listing, with the stamp that says when each changed. */
function listSessionStamps(folder) {
  return all(`SELECT id, time_updated FROM session_v2
    WHERE project_id = ? AND parent_id IS NULL AND time_archived IS NULL`, projectIdOf(folder))
    .map(r => ({ sessionId: r.id, locator: r.id, stamp: iso(r.time_updated) }));
}

/** The stamp a cached row was read at: matches fileMtime while the session is unchanged. */
function sessionStamp(row) {
  const r = get('SELECT time_updated FROM session_v2 WHERE id = ?', row?.sessionId);
  return r ? iso(r.time_updated) : null;
}

// --- Messages ---

function parseData(data) {
  if (typeof data !== 'string') return data || {};
  try { return JSON.parse(data); } catch { return {}; }
}

/** The parts stored as rows for these messages, by message id. Empty unless OpenCode's part_rows option is on. */
function partRowsFor(sessionId) {
  const byMessage = new Map();
  if (!getDb()?.hasParts) return byMessage;
  for (const r of all('SELECT message_id, data FROM session_part WHERE session_id = ? ORDER BY message_id, ordinal', sessionId)) {
    if (!byMessage.has(r.message_id)) byMessage.set(r.message_id, []);
    byMessage.get(r.message_id).push(parseData(r.data));
  }
  return byMessage;
}

/** Message rows as toViewerEntries takes them: parts stored as rows first, then the inline content. */
function withParts(rows, parts) {
  return rows.map(r => {
    const data = parseData(r.data);
    const extra = parts.get(r.id);
    if (extra?.length) data.content = [...extra, ...(Array.isArray(data.content) ? data.content : [])];
    return { id: r.id, type: r.type, seq: r.seq, time_created: r.time_created, data };
  });
}

function partsOf(data) {
  return Array.isArray(data?.content) ? data.content : [];
}

function assistantText(data) {
  return partsOf(data)
    .filter(p => p && p.type === 'text' && typeof p.text === 'string' && p.text)
    .map(p => p.text).join('\n');
}

// OpenCode's stand-in title for a session it has not named yet. Newer versions
// leave the column empty; older rows and imports still carry the string.
const PLACEHOLDER_TITLE_RE = /^(New|Child) session - \d{4}-\d{2}-\d{2}T/;

function realTitle(title) {
  const text = typeof title === 'string' ? title.trim() : '';
  return text && !PLACEHOLDER_TITLE_RE.test(text) ? text : null;
}

function projectPathOf(directory) {
  // OpenCode stores paths with forward slashes on every platform.
  return process.platform === 'win32' ? path.normalize(directory) : directory;
}

/**
 * One session as a cached row, the same shape the other CLIs return. `locator`
 * is the session id. Subagents (a parent_id), archived sessions and sessions
 * without a user message are not listed.
 */
function readSessionFile(locator, folder) {
  const s = get('SELECT * FROM session_v2 WHERE id = ?', locator);
  if (!s || s.parent_id || s.time_archived != null || !s.directory) return null;

  const rows = all(`SELECT id, type, seq, time_created, data FROM session_message
    WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq`, s.id);
  const messages = withParts(rows, partRowsFor(s.id));

  let summary = '';
  let messageCount = 0;
  let lastAt = null;
  const textParts = [];
  for (const m of messages) {
    const text = m.type === 'user'
      ? (typeof m.data.text === 'string' ? m.data.text.trim() : '')
      : assistantText(m.data);
    if (!text) continue;
    messageCount++;
    lastAt = m.time_created;
    if (!summary && m.type === 'user') summary = text.slice(0, 120);
    textParts.push(text);
  }
  if (!summary) return null;

  return {
    sessionId: s.id, folder, projectPath: projectPathOf(s.directory),
    runtime: id,
    sessionFile: null,
    summary, firstPrompt: summary,
    created: iso(s.time_created),
    modified: iso(lastAt ?? s.time_updated),
    // The invalidation key: session-cache compares it to listSessionStamps.
    fileMtime: iso(s.time_updated),
    messageCount, textContent: textParts.join('\n'),
    slug: null, customTitle: null, aiTitle: realTitle(s.title),
  };
}

// --- Viewer ---

// OpenCode's tool names and arguments, mapped onto Claude's so the viewer (and
// the phone's tool details) show them without knowing which CLI ran them.
// Sessions imported from 1.x keep their old names (bash, task, list) and
// camelCase paths, so both are accepted.
function pathOf(input) {
  return input.path ?? input.filePath;
}

function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const TOOL_MAP = {
  shell: input => ['Bash', input],
  bash: input => ['Bash', input],
  edit: input => ['Edit', defined({
    file_path: pathOf(input), old_string: input.oldString, new_string: input.newString, replace_all: input.replaceAll,
  })],
  write: input => ['Write', defined({ file_path: pathOf(input), content: input.content })],
  read: input => ['Read', defined({ file_path: pathOf(input), offset: input.offset, limit: input.limit })],
  glob: input => ['Glob', defined({ pattern: input.pattern, path: input.path })],
  grep: input => ['Grep', defined({ pattern: input.pattern, path: input.path, glob: input.include })],
  list: input => ['LS', defined({ path: input.path })],
  patch: input => ['apply_patch', input.patchText ?? ''],
  apply_patch: input => ['apply_patch', input.patchText ?? ''],
  webfetch: input => ['WebFetch', defined({ url: input.url, prompt: input.format })],
  websearch: input => ['WebSearch', defined({ query: input.query })],
  subagent: input => ['Task', defined({ subagent_type: input.agent, description: input.description, prompt: input.prompt })],
  task: input => ['Task', defined({ subagent_type: input.agent ?? input.subagent_type, description: input.description, prompt: input.prompt })],
  todowrite: input => ['TodoWrite', input],
  question: input => ['AskUserQuestion', {
    ...input,
    questions: Array.isArray(input.questions)
      ? input.questions.map(({ multiple, ...q }) => defined({ ...q, multiSelect: multiple }))
      : input.questions,
  }],
  skill: input => ['Skill', defined({ skill: input.id ?? input.name })],
};

function toolCall(part) {
  const raw = part.state?.input;
  const map = TOOL_MAP[part.name];
  if (!map || !raw || typeof raw !== 'object') return { name: part.name || 'tool', input: raw ?? '' };
  const [name, input] = map(raw);
  return { name, input };
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(c => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('');
}

function entry(type, timestamp, content, extra) {
  return { type, timestamp, message: { role: type, content: [content] }, ...extra };
}

/**
 * Message rows ({ type, seq, time_created, data }) rewritten as the records the
 * viewer renders, the same way codex.toViewerEntries maps rollouts: one entry
 * per part, a tool call as a tool_use and its outcome as a tool_result keyed by
 * the same call id. What the CLI adds for the model (synthetic and system
 * messages, skills, compaction notes, turn ends) is left out.
 */
function toViewerEntries(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const data = parseData(row.data);
    const timestamp = iso(data.time?.created ?? row.time_created);

    if (row.type === 'user') {
      const text = typeof data.text === 'string' ? data.text : '';
      if (text) out.push(entry('user', timestamp, { type: 'text', text }));
      continue;
    }

    if (row.type === 'shell') {
      const callId = data.shellID || `shell-${row.seq}`;
      out.push(entry('assistant', timestamp, { type: 'tool_use', id: callId, name: 'Bash', input: { command: data.command || '' } }));
      if (data.status && data.status !== 'running') {
        out.push(entry('user', timestamp, {
          type: 'tool_result', tool_use_id: callId, content: typeof data.output === 'string' ? data.output : '',
          is_error: data.status === 'error' || (Number.isFinite(data.exit) && data.exit !== 0),
        }));
      }
      continue;
    }

    if (row.type !== 'assistant') continue;
    for (const part of partsOf(data)) {
      if (!part) continue;
      if (part.type === 'text' && part.text) {
        out.push(entry('assistant', timestamp, { type: 'text', text: part.text }));
      } else if (part.type === 'reasoning' && part.text) {
        out.push(entry('assistant', timestamp, { type: 'thinking', thinking: part.text }));
      } else if (part.type === 'tool') {
        const callId = part.id || null;
        const { name, input } = toolCall(part);
        out.push(entry('assistant', timestamp, { type: 'tool_use', id: callId, name, input }));
        const status = part.state?.status;
        if (status === 'completed' || status === 'error') {
          const failed = status === 'error';
          const text = failed ? (part.state.error?.message || resultText(part.state.content)) : resultText(part.state.content);
          out.push(entry('user', timestamp, { type: 'tool_result', tool_use_id: callId, content: text || '', is_error: failed }));
        }
      }
    }
    // A turn the provider refused (limit, auth, outage) ends with an error and
    // often no content: show why, as Claude's transcripts do.
    if (data.error?.message) {
      out.push(entry('assistant', timestamp, { type: 'text', text: String(data.error.message) }, { isApiErrorMessage: true }));
    }
  }
  return out;
}

const CONVERSATION = new Set(['user', 'assistant']);

/**
 * The viewer entries written after `cursor` (the seq of the last message
 * already sent), and the cursor for the next read. An assistant message still
 * being written is held back, like a half-written JSONL line, unless the
 * conversation has moved on past it (a step cut short records no end). A
 * cursor beyond the session's last message starts over, with `reset` set.
 */
function readEntriesSince(row, cursor = 0) {
  const sessionId = row?.sessionId;
  let start = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  let reset = false;
  const max = get('SELECT MAX(seq) AS last FROM session_message WHERE session_id = ?', sessionId)?.last ?? 0;
  if (start > max) { start = 0; reset = true; }

  const rows = all(`SELECT id, type, seq, time_created, data FROM session_message
    WHERE session_id = ? AND seq > ? ORDER BY seq`, sessionId, start);
  const messages = withParts(rows, rows.length ? partRowsFor(sessionId) : new Map());

  let lastConversation = -1;
  messages.forEach((m, i) => { if (CONVERSATION.has(m.type)) lastConversation = i; });

  const ready = [];
  let next = start;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.type === 'assistant' && !m.data.time?.completed && i === lastConversation) break;
    ready.push(m);
    next = m.seq;
  }
  return { entries: toViewerEntries(ready), cursor: next, reset };
}

// --- Activity signalling ---
//
// OpenCode's terminal title says nothing about activity: it is "OpenCode", or
// "OC | <session title>" (cut at 40 characters), and never animates. What it
// does send is OSC 7501, a "program status" record per pending session plus a
// root record summing them up:
//
//   ESC ] 7501 ; state=working:id=ses_…:app=opencode:title=<base64> ESC \
//
// state is idle | working | blocked | clear, kind (when blocked) permission or
// question, and title / msg are base64 UTF-8. `clear` drops a session's record
// when it stops being pending, and the root's when the TUI quits.

const TITLE_RE = /^OC \| (.+)$/;

/** The title never says busy or idle, so it never decides the state. */
function parseTitleState() {
  return null;
}

/** The session title from "OC | <title>", for the lists before the session is indexed. */
function titleFromTerminal(title) {
  const m = TITLE_RE.exec(String(title || '').trim());
  return m ? m[1].trim() || null : null;
}

/**
 * OpenCode's system notifications are off unless the user turns them on, and
 * then say "Permission needs input", "Input needs response", or that the
 * session is done (or why it failed).
 */
function classifyNotification(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  if (/needs (input|response)/i.test(text)) return 'attention';
  return 'idle';
}

const STATUS_STATES = { working: 'busy', blocked: 'attention', idle: 'idle', clear: 'idle' };
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 UTF-8, or null when it is not whole (main.js cuts long OSC payloads). */
function decodeField(value) {
  if (!value || value.length % 4 !== 0 || !BASE64_RE.test(value)) return null;
  const text = Buffer.from(value, 'base64').toString('utf8');
  return text && !text.includes('�') ? text : null;
}

/**
 * One OSC 7501 payload (what follows "7501;") as { state, id, kind, title,
 * message }, with state already in Switchboard's terms: 'busy', 'attention'
 * or 'idle'. Null for the TUI's capability query ('?'), for another program's
 * records and for anything unreadable. `id` is null on the root record.
 */
function parseStatusReport(payload) {
  const fields = {};
  for (const pair of String(payload || '').split(':')) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const state = STATUS_STATES[fields.state];
  if (!state) return null;
  if (fields.app && fields.app !== 'opencode') return null;
  return {
    state,
    id: fields.id || null,
    kind: fields.kind || null,
    title: decodeField(fields.title),
    message: decodeField(fields.msg),
  };
}

module.exports = {
  id, label, binary, folderPrefix, groupsByProject,
  parseTitleState, titleFromTerminal, classifyNotification, parseStatusReport,
  available, dataDir, dbPath, sessionsRoot, watchPaths, closeDb,
  listFolders, folderPath, folderForProject, deriveProjectPath,
  listTranscripts, sessionIdFromPath, transcriptPath,
  folderExists, folderStamp, listSessionStamps, sessionStamp,
  readSessionFile, toViewerEntries, readEntriesSince,
};
