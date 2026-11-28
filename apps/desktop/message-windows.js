// The first and last texts of a conversation, for "Search in messages" in the
// session overview and for the last message a closed card shows.
//
// The harnesses push every conversation text (user and agent, in order, the
// same texts as the full-text index) into a pair of windows: the head fills
// once with the first MESSAGE_WINDOW texts, the tail slides over the last
// MESSAGE_WINDOW. session_cache keeps both as JSON (headTexts, tailTexts), so
// an appended transcript moves its tail without being read again from the
// start. Pure: no database, no files.

const MESSAGE_WINDOW = 20;
const MESSAGE_TEXT_MAX = 8000;
// Under this many characters a query finds no message, as with the trigram index.
const MESSAGE_SEARCH_MIN = 3;

/** `text` cut at `max` characters, never between the two halves of a surrogate pair. */
function cut(text, max) {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xD800 && code <= 0xDBFF ? max - 1 : max);
}

function emptyMessageWindows() {
  return { head: [], tail: [] };
}

/** Add one conversation text to `windows` ({ head, tail }), in place. */
function pushMessageWindow(windows, text) {
  if (typeof text !== 'string' || !text) return windows;
  const kept = cut(text, MESSAGE_TEXT_MAX);
  if (windows.head.length < MESSAGE_WINDOW) windows.head.push(kept);
  windows.tail.push(kept);
  if (windows.tail.length > MESSAGE_WINDOW) windows.tail.splice(0, windows.tail.length - MESSAGE_WINDOW);
  return windows;
}

/** The windows of every text of a conversation read whole (Codex, OpenCode). */
function messageWindowsOf(texts) {
  const windows = emptyMessageWindows();
  for (const text of texts) pushMessageWindow(windows, text);
  return windows;
}

/** The session_cache columns for `windows`. */
function messageWindowColumns(windows) {
  return { headTexts: JSON.stringify(windows.head), tailTexts: JSON.stringify(windows.tail) };
}

function parseTexts(json) {
  if (typeof json !== 'string') return [];
  try {
    const texts = JSON.parse(json);
    return Array.isArray(texts) ? texts.filter(text => typeof text === 'string') : [];
  } catch {
    return [];
  }
}

/** The windows a cached row stored; a column missing or not parsing counts as empty. */
function parseMessageWindows(row) {
  return { head: parseTexts(row?.headTexts), tail: parseTexts(row?.tailTexts) };
}

/**
 * Does `query` appear in the first (`which: 'first'`) or last (`'last'`) `n`
 * texts? Literal and case-insensitive; a query under MESSAGE_SEARCH_MIN
 * characters, once trimmed, matches nothing.
 */
function matchesMessageWindow(windows, query, { which, n } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < MESSAGE_SEARCH_MIN) return false;
  const count = Math.min(MESSAGE_WINDOW, Math.max(1, Math.floor(Number(n)) || 1));
  const texts = which === 'last' ? windows.tail.slice(-count) : windows.head.slice(0, count);
  return texts.some(text => text.toLowerCase().includes(q));
}

/** The ids of the cached rows ({ sessionId, headTexts, tailTexts }) whose first or last `n` texts hold `query`. */
function sessionsMatchingMessages(rows, query, options = {}) {
  const q = String(query ?? '').trim();
  if (q.length < MESSAGE_SEARCH_MIN) return [];
  // Only the window searched is parsed: every row is read on each search.
  const last = options.which === 'last';
  return rows.filter(row => matchesMessageWindow({
    head: last ? [] : parseTexts(row.headTexts),
    tail: last ? parseTexts(row.tailTexts) : [],
  }, q, options)).map(row => row.sessionId);
}

/** The last text of a conversation, trimmed and cut at `max` characters; '' without one. */
function lastMessageText(windows, max = 300) {
  const last = windows.tail[windows.tail.length - 1] ?? windows.head[windows.head.length - 1] ?? '';
  return cut(last.trim(), max);
}

module.exports = {
  MESSAGE_WINDOW, MESSAGE_TEXT_MAX, MESSAGE_SEARCH_MIN,
  emptyMessageWindows, pushMessageWindow, messageWindowsOf, messageWindowColumns,
  parseMessageWindows, matchesMessageWindow, sessionsMatchingMessages, lastMessageText,
};
