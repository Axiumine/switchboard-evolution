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

module.exports = { markBusy, markIdle, applyStatusReport };
