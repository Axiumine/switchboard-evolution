// How what a CLI reports moves a live session's busy and attention flags.
//
// One place for every source: the terminal title (OSC 0/2), progress reports
// (OSC 9;4) and status records (OpenCode's OSC 7501). Each returns whether
// something changed, or the events to send, and main.js sends them.

/** The CLI started working. Clears a pending attention: the user answered. */
function markBusy(session) {
  if (session._cliBusy) return false;
  session._cliBusy = true;
  session._oscIdle = false;
  session._needsAttention = false;
  return true;
}

/** The CLI stopped working. Only a busy session can go idle. */
function markIdle(session) {
  if (!session._cliBusy) return false;
  session._cliBusy = false;
  session._oscIdle = true;
  return true;
}

/**
 * A status record ({ state: 'busy' | 'attention' | 'idle', message }) applied
 * to a session, as [channel, ...args] events still to be addressed to it.
 * A record is repeated whenever anything else in the CLI changes, so the
 * attention it raises is latched: one notification per block. A blocked CLI
 * is not working, so attention also ends the busy state, as a blocked title does.
 */
function applyStatusReport(session, report) {
  const events = [];
  if (report.state === 'attention') {
    if (!session._statusAttention) {
      session._statusAttention = true;
      session._needsAttention = true;
      events.push(['terminal-notification', report.message || 'Needs your input', 'attention']);
    }
  } else {
    session._statusAttention = false;
  }
  if (report.state === 'busy') {
    if (markBusy(session)) events.push(['cli-busy-state', true]);
  } else if (markIdle(session)) {
    events.push(['cli-busy-state', false]);
  }
  return events;
}

const STATUS_OPEN = '\x1b]7501;';
const STATUS_RECORD_RE = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
// A record is at most a few hundred bytes (title 192, message 2048): an
// unterminated start longer than this is not one, and is dropped.
const MAX_STATUS_CARRY = 4096;

/**
 * The complete OSC 7501 payloads in some terminal output, and what to keep
 * for the next chunk: an unterminated record, or the start of one ("\x1b]75").
 */
function takeStatusRecords(text) {
  const reports = [];
  let end = 0;
  for (const m of text.matchAll(STATUS_RECORD_RE)) {
    reports.push(m[1]);
    end = m.index + m[0].length;
  }
  const tail = text.slice(end);
  let rest = '';
  const open = tail.lastIndexOf(STATUS_OPEN);
  if (open !== -1) {
    rest = tail.slice(open);
  } else {
    // The chunk may end inside the opening bytes themselves.
    for (let n = Math.min(STATUS_OPEN.length - 1, tail.length); n > 0; n--) {
      if (STATUS_OPEN.startsWith(tail.slice(-n))) { rest = tail.slice(-n); break; }
    }
  }
  return { reports, rest: rest.length > MAX_STATUS_CARRY ? '' : rest };
}

module.exports = { markBusy, markIdle, applyStatusReport, takeStatusRecords };
