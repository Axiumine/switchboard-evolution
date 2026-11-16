// Terminal output for remote clients (the mobile companion).
//
// The window gets every chunk through broadcast.js and replays the PTY's
// output buffer when it reattaches. A phone needs more: it attaches and
// detaches often (iOS drops the socket in the background), so it must be able
// to pick up exactly where it left off, and it must not slow the PTY down
// when its network is slow.
//
// Every chunk advances the session's outputSeq by its length. Once a phone
// has attached, the session also keeps a ring of recent chunks with their
// positions, so a phone coming back with the position it last saw gets only
// what it missed. Otherwise it gets a reset: the same replay the window gets.
// Attaching takes the snapshot and subscribes in one synchronous step, so no
// chunk can fall between the two.

const RING_BYTES = 256 * 1024;
const BATCH_MS = 33;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

function createTerminalFanout({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  function idOf(session, fallback) {
    return session.realSessionId || fallback;
  }

  /** The replay a terminal starts from, as the window's reattach builds it. */
  function replayOf(session) {
    let text = '';
    if (session.altScreen && !session.isPlainTerminal) text += '\x1b[?1049h';
    text += (session.outputBuffer || []).join('');
    // Hide the cursor until the live stream puts it back in place.
    if (!session.isPlainTerminal) text += '\x1b[?25l';
    return text;
  }

  function trimRing(ring) {
    while (ring.bytes > RING_BYTES && ring.chunks.length > 1) {
      const dropped = ring.chunks.shift();
      ring.bytes -= dropped.data.length;
      ring.startSeq = dropped.start + dropped.data.length;
    }
  }

  function flush(session, sub) {
    sub.timer = null;
    if (!sub.pending.length) return;
    if (sub.client.bufferedAmount() > MAX_BUFFERED_BYTES) {
      // The phone cannot keep up. Drop what is queued and let it reattach,
      // which starts it from a fresh replay instead of a growing backlog.
      sub.pending = [];
      session.remoteSubscribers.delete(sub);
      sub.client.attached?.delete(session);
      sub.client.send({ event: 'terminal-overflow', args: [idOf(session, sub.sessionId)] });
      return;
    }
    const data = sub.pending.join('');
    sub.pending = [];
    sub.client.send({ event: 'terminal-data', args: [idOf(session, sub.sessionId), data, session.outputSeq] });
  }

  /** Call for every PTY chunk, right after it goes to the window. */
  function feed(session, data) {
    session.outputSeq = (session.outputSeq || 0) + data.length;
    const ring = session.remoteRing;
    if (!ring) return;
    ring.chunks.push({ start: session.outputSeq - data.length, data });
    ring.bytes += data.length;
    trimRing(ring);
    for (const sub of session.remoteSubscribers) {
      sub.pending.push(data);
      if (!sub.timer) sub.timer = setTimer(() => flush(session, sub), BATCH_MS);
    }
  }

  /**
   * Start sending a session's output to a client. With `sinceSeq` the client
   * gets what it missed since that position, if it is still in the ring;
   * otherwise a terminal-reset with the full replay. Returns the position the
   * client is at afterwards.
   */
  function attach(session, sessionId, client, sinceSeq = null) {
    if (!session.remoteRing) session.remoteRing = { chunks: [], bytes: 0, startSeq: session.outputSeq || 0 };
    if (!session.remoteSubscribers) session.remoteSubscribers = new Set();
    detach(session, client);
    const seq = session.outputSeq || 0;
    const ring = session.remoteRing;
    const id = idOf(session, sessionId);
    if (Number.isInteger(sinceSeq) && sinceSeq >= ring.startSeq && sinceSeq <= seq) {
      let missed = '';
      for (const chunk of ring.chunks) {
        const end = chunk.start + chunk.data.length;
        if (end <= sinceSeq) continue;
        missed += chunk.start >= sinceSeq ? chunk.data : chunk.data.slice(sinceSeq - chunk.start);
      }
      if (missed) client.send({ event: 'terminal-data', args: [id, missed, seq] });
    } else {
      client.send({ event: 'terminal-reset', args: [id, replayOf(session), seq, {
        altScreen: !!session.altScreen,
        plain: !!session.isPlainTerminal,
        cols: session.pty?.cols ?? null,
        rows: session.pty?.rows ?? null,
      }] });
    }
    session.remoteSubscribers.add({ client, sessionId, pending: [], timer: null });
    if (!client.attached) client.attached = new Set();
    client.attached.add(session);
    return { seq };
  }

  /** Stop sending a session's output to a client. */
  function detach(session, client) {
    if (!session.remoteSubscribers) return false;
    let found = false;
    for (const sub of session.remoteSubscribers) {
      if (sub.client !== client) continue;
      if (sub.timer) clearTimer(sub.timer);
      session.remoteSubscribers.delete(sub);
      found = true;
    }
    client.attached?.delete(session);
    return found;
  }

  /**
   * The PTY changed size. Attached clients get what was queued first, then
   * the new size, so they lay the output out at the width it was written for.
   */
  function resized(session, cols, rows) {
    for (const sub of session.remoteSubscribers || []) {
      if (sub.timer) { clearTimer(sub.timer); flush(session, sub); }
      sub.client.send({ event: 'terminal-size', args: [idOf(session, sub.sessionId), cols, rows] });
    }
  }

  /** A client went away: stop everything it was attached to. */
  function detachClient(client) {
    for (const session of [...(client.attached || [])]) detach(session, client);
  }

  return { feed, attach, detach, detachClient, resized };
}

module.exports = { createTerminalFanout, RING_BYTES, BATCH_MS, MAX_BUFFERED_BYTES };
