// A snapshot of every live PTY, for a client that connects after the
// busy / attention transitions it would otherwise have heard about.

/** One entry per live session, under the id the rest of the app uses for it. */
function sessionStates(activeSessions) {
  const seen = new Set();
  const states = [];
  for (const [key, session] of activeSessions) {
    if (seen.has(session)) continue;
    seen.add(session);
    states.push({
      sessionId: session.realSessionId || key,
      type: session.isPlainTerminal ? 'terminal' : 'cli',
      runtime: session.isPlainTerminal ? null : session.runtime || null,
      projectPath: session.projectPath || null,
      projectId: session.projectId || null,
      trackId: session.trackId || null,
      busy: !!session._cliBusy,
      // A subagent is working while the main agent waits (main.js sweepSubagents).
      subagents: !session.exited && !!session._subagentsBusy,
      // Waiting for the user: a permission or a question, from the title (codex)
      // or a notification (Claude). Cleared when the CLI starts working again.
      attention: !!(session._titleAttention || session._needsAttention),
      exited: !!session.exited,
      // Launched, but the CLI has not written the transcript that gives it its real id yet.
      starting: !!(session.pendingLaunch && !session.realSessionId),
      startedAt: session._openedAt || null,
    });
  }
  return states;
}

module.exports = { sessionStates };
