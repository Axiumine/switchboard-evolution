// Alerts: a session that needs you, or finishes a turn, while nobody looks at it.
//
// Main follows what the CLIs report (the same events the window and the phones
// get) and decides here, once, whether to say it: a system notification on this
// computer (desktop-notifications.js), and a `session-alert` event that paired
// phones turn into notifications of their own. An alert stands until its
// session is looked at, answered or gone; `session-alert-cleared` then takes
// the notifications back.

// A turn's end waits a moment: a blocked CLI goes idle just before it says what
// it asks, and a CLI between two steps goes idle and busy again.
const FINISHED_DELAY_MS = 1500;
// A question can be said twice at once (the title, then a notification): the
// words of the last one count.
const ATTENTION_DELAY_MS = 500;

const FINISHED_BODY = 'Finished and is waiting for you';
const ATTENTION_BODY = 'Needs your input';

const baseName = (filePath) => String(filePath || '').split(/[\\/]/).pop();

/**
 * deps, all required but the clock and the timers:
 *   emit(channel, ...args)  broadcast.js
 *   titleOf(sessionId)      the session's name, or '' when it has none
 *   isLooking(sessionId)    someone has it in front on this computer
 *   onPhone(sessionId)      a paired phone has it on screen
 *   show(alert)             the computer's notification
 *   close(sessionId)        takes that notification back
 */
function createSessionAlerts({ emit, titleOf, isLooking, onPhone, show, close, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  // session id → { busy, said, pending: { alert, timer } | null, alert | null }
  // `said`: this turn's end or question is spoken for, until the CLI works again.
  const sessions = new Map();
  // The sessions the window marks as unread or needing you.
  let marked = new Set();

  function stateOf(id) {
    let state = sessions.get(id);
    if (!state) sessions.set(id, state = { busy: false, said: false, pending: null, alert: null });
    return state;
  }

  const latest = (state) => state.pending?.alert || state.alert;

  function dropPending(state) {
    if (!state.pending) return;
    clearTimer(state.pending.timer);
    state.pending = null;
  }

  /** The session was looked at, answered or is gone: nothing more to say about it. */
  function read(id) {
    const state = sessions.get(id);
    if (!state) return;
    dropPending(state);
    if (!state.alert) return;
    state.alert = null;
    close(id);
    emit('session-alert-cleared', id);
  }

  function publish(state, alert) {
    state.alert = alert;
    emit('session-alert', alert);
    show(alert);
  }

  function announce(state, alert) {
    const id = alert.sessionId;
    if (onPhone(id) || isLooking(id)) return;
    publish(state, { ...alert, title: titleOf(id) || 'A session', at: now() });
  }

  function schedule(state, alert, delay) {
    dropPending(state);
    const pending = { alert, timer: null };
    pending.timer = setTimer(() => {
      state.pending = null;
      announce(state, pending.alert);
    }, delay);
    pending.timer?.unref?.();
    state.pending = pending;
  }

  function attention(id, body, diffId) {
    const state = stateOf(id);
    // One question, one alert; and a change to review says more than the words around it.
    if (!diffId && (state.alert?.kind === 'attention' || latest(state)?.diffId)) return;
    state.said = true;
    schedule(state, { sessionId: id, kind: 'attention', body, ...(diffId ? { diffId } : {}) }, ATTENTION_DELAY_MS);
  }

  function finished(id) {
    const state = stateOf(id);
    state.busy = false;
    if (state.said || latest(state)?.kind === 'attention') return;
    state.said = true;
    schedule(state, { sessionId: id, kind: 'finished', body: FINISHED_BODY }, FINISHED_DELAY_MS);
  }

  function busyChanged(id, busy) {
    if (!busy) {
      // Only a session that was working can finish.
      if (sessions.get(id)?.busy) finished(id);
      return;
    }
    const state = stateOf(id);
    state.busy = true;
    state.said = false;
    // A question was answered, or a new turn began.
    read(id);
  }

  function diffGone(id, diffId) {
    const state = sessions.get(id);
    const current = state && latest(state);
    if (current?.diffId && (!diffId || current.diffId === diffId)) read(id);
  }

  function exited(id) {
    const state = sessions.get(id);
    if (!state) return;
    // A question nobody can answer any more goes; "finished" stays true.
    if (latest(state)?.kind === 'attention') read(id);
    state.busy = false;
    state.said = false;
  }

  function rekey(oldId, newId) {
    const state = sessions.get(oldId);
    if (!state || typeof newId !== 'string' || !newId || oldId === newId) return;
    sessions.delete(oldId);
    sessions.set(newId, state);
    if (state.pending) state.pending.alert.sessionId = newId;
    if (!state.alert) return;
    close(oldId);
    emit('session-alert-cleared', oldId);
    publish(state, { ...state.alert, sessionId: newId });
  }

  /** A broadcast.js destination. */
  function eventSink(channel, args) {
    const [id] = args;
    if (typeof id !== 'string' || !id) return;
    switch (channel) {
      case 'cli-busy-state': busyChanged(id, !!args[1]); break;
      case 'terminal-notification':
        if (args[2] === 'attention') attention(id, args[1] || ATTENTION_BODY);
        else if (args[2] === 'idle') finished(id);
        break;
      case 'mcp-open-diff': attention(id, `Wants to change ${baseName(args[2]?.oldFilePath) || 'a file'}`, args[1]); break;
      case 'mcp-close-tab':
      case 'mcp-diff-resolved': diffGone(id, args[1]); break;
      case 'mcp-close-all-diffs': diffGone(id); break;
      case 'process-exited': exited(id); break;
      case 'session-detected':
      case 'session-forked': rekey(id, args[1]); break;
    }
  }

  /** The window's marks changed (session-notices.js): a mark that went was read. */
  function noticesChanged(notices) {
    const next = new Set([...(notices?.ready || []), ...(notices?.attention || [])]);
    for (const id of marked) if (!next.has(id)) read(id);
    marked = next;
  }

  /** What is in front changed: the alerts of what is looked at now are read. */
  function refresh() {
    for (const [id, state] of sessions) if (state.alert && isLooking(id)) read(id);
  }

  /** The alerts that stand, for a phone that connects. */
  function snapshot() {
    return [...sessions.values()].map(state => state.alert).filter(Boolean);
  }

  return { eventSink, read, noticesChanged, refresh, snapshot };
}

module.exports = { createSessionAlerts, FINISHED_DELAY_MS, ATTENTION_DELAY_MS };
