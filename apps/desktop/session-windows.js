// session-windows.js — a session shown in a window of its own.
//
// The window is index.html?sessionWindow=<id> (public/session-window.js),
// opened from the main window. Each live session has an owner, the window
// whose xterm shows it: `session.owner` is null for the main window, or the
// webContents id of a session window. It is kept on the session object, so it
// follows a re-key (Codex's real id, a fork) by itself. A window that is gone
// counts as the main window.
//
// - A session's terminal output and its IDE events go only to its owner; the
//   main window's sink (main.js) skips them when that is not the main window.
// - A session window gets a few other events (SESSION_WINDOW_EVENTS); never
//   schedule-due (the schedule would run twice), the updater or remote-*.
// - Whichever window reattaches a session (open-terminal) takes it, and the
//   replay goes to that window in the same step, so no output comes in
//   between. A remote call (no window) leaves the owner as it is. The replay
//   ends with `terminal-replayed (sessionId)`, on the same path as its chunks:
//   open-terminal's answer can come before them, and the window holds its
//   terminal's replies to the queries in the replay until it has read them all
//   (public/session-window.js).
// - Only the owner resizes or detaches the PTY; a remote call still may.
// - A closed session window leaves its sessions RETURNING: their output goes
//   to nobody until the main window reattaches them, and that replay brings it.
// - `session-owner-changed (sessionId, ownerKind, mine)` tells each window
//   where a session is now: ownerKind 'main', 'window' or 'returning', and
//   whether the window that receives it is the owner.

const path = require('path');

const RETURNING = 'returning';

/** Channels that belong to one session (args[0] is its id): only its owner gets them. */
const ROUTED_CHANNELS = ['terminal-data', 'mcp-open-diff', 'mcp-open-file', 'mcp-close-tab', 'mcp-close-all-diffs', 'mcp-diff-resolved'];

/** The other events a session window lives on. */
const SESSION_WINDOW_EVENTS = [
  'projects-changed', 'harnesses-changed', 'global-settings-changed', 'session-detected', 'session-forked',
  'process-exited', 'cli-busy-state', 'cli-subagent-state', 'terminal-notification', 'command-catalog-updated',
  'file-changed', 'session-owner-changed',
];

/** What a session window asks the main window to start for it (a split in the window). */
const SESSION_WINDOW_RUN = new Set(['launchNewSession', 'openRawTerminalSession']);

const SESSION_WINDOW_SPEC = { title: 'Session', width: 1000, height: 700, minWidth: 420, minHeight: 280, onTop: false };
const INDEX_PAGE = path.join(__dirname, 'public', 'index.html');
const OFFSET = 24;

const routed = new Set(ROUTED_CHANNELS);
const windowEvents = new Set(SESSION_WINDOW_EVENTS);

/**
 * deps, all required:
 *   createPageWindow(kind, spec, { bounds }) → a BrowserWindow (main.js)
 *   getMainWindow()                          the main window, or null
 *   activeSessions                           main's Map of live sessions
 *   sessionNotices                           session-notices.js: what a window shows counts as seen
 *   emit(channel, ...args)                   broadcast.js
 *   bringForward(win)                        shows a window again (main.js)
 *   log                                      { error }
 */
function createSessionWindows({ createPageWindow, getMainWindow, activeSessions, sessionNotices, emit, bringForward, log }) {
  const windows = new Map(); // webContents id → { win, sessionId (opened for), adopted }

  const live = (win) => !!win && !win.isDestroyed() && !win.webContents.isDestroyed();
  const mainContents = () => {
    const main = getMainWindow();
    return main && !main.isDestroyed() ? main.webContents : null;
  };
  // sessionNotices keeps what each client has on screen; a window is one.
  const client = (wcId) => `session-window:${wcId}`;

  /** The live session behind an id, also under the real id a re-key gave it. */
  function sessionFor(id) {
    if (typeof id !== 'string' || !id) return null;
    const session = activeSessions.get(id);
    if (session) return session;
    for (const s of activeSessions.values()) if (s.realSessionId === id) return s;
    return null;
  }

  /** The id the windows know a session by. */
  function idOf(session) {
    if (session.realSessionId) return session.realSessionId;
    for (const [key, s] of activeSessions) if (s === session) return key;
    return null;
  }

  /** The session window this webContents belongs to, or null. */
  function entryOf(webContents) {
    if (!webContents) return null;
    const entry = windows.get(webContents.id);
    return entry && live(entry.win) && entry.win.webContents === webContents ? entry : null;
  }

  const isSessionWindow = (webContents) => !!entryOf(webContents);

  /** The owner's webContents, null for the main window (or a window that is gone), or RETURNING. */
  function ownerOf(session) {
    if (!session || session.owner == null) return null;
    if (session.owner === RETURNING) return RETURNING;
    const entry = windows.get(session.owner);
    return entry && live(entry.win) ? entry.win.webContents : null;
  }

  /** The session window that owns a session, or null. */
  function ownerWindow(sessionId) {
    const owner = ownerOf(sessionFor(sessionId));
    return owner && owner !== RETURNING ? windows.get(owner.id).win : null;
  }

  /** The window that shows a session: its owner, or one opened for it that has not taken it yet. */
  function windowFor(sessionId) {
    const owner = ownerWindow(sessionId);
    if (owner) return owner;
    for (const entry of windows.values()) {
      if (!entry.adopted && entry.sessionId === sessionId && live(entry.win)) return entry.win;
    }
    return null;
  }

  function ownerChanged(session, kind) {
    const id = idOf(session);
    if (id) emit('session-owner-changed', id, kind, kind === 'main');
  }

  /** A session window that no longer owns anything closes. */
  function closeIfEmpty(wcId) {
    const entry = windows.get(wcId);
    if (!entry || !live(entry.win)) return;
    for (const s of activeSessions.values()) if (s.owner === wcId) return;
    entry.win.close();
  }

  /**
   * The window `sender` takes the session: a session window, or else the main
   * window. A null sender (a remote call) changes nothing. Returns whether the
   * owner changed.
   */
  function takeOwnership(session, sender) {
    if (!session || !sender || sender.isDestroyed()) return false;
    const entry = entryOf(sender);
    const next = entry ? sender.id : null;
    const previous = session.owner ?? null;
    if (previous === next) return false;
    session.owner = next;
    if (entry) entry.adopted = true;
    ownerChanged(session, entry ? 'window' : 'main');
    if (typeof previous === 'number') closeIfEmpty(previous);
    return true;
  }

  /**
   * open-terminal on a live session: `sender` takes it, then the replay of its
   * buffer goes to the owner (the main window when that is the owner), in the
   * same synchronous step. Nothing while it is RETURNING. Returns the
   * webContents the replay went to, or null.
   */
  function reattach(sessionId, session, sender) {
    takeOwnership(session, sender);
    const owner = ownerOf(session);
    if (owner === RETURNING) return null;
    const target = owner || mainContents();
    if (!target) return null;
    // If TUI is in alternate screen mode, send escape to switch into it
    if (session.altScreen && !session.isPlainTerminal) target.send('terminal-data', sessionId, '\x1b[?1049h');
    // Send buffered output for reattach
    for (const chunk of session.outputBuffer) target.send('terminal-data', sessionId, chunk);
    // Hide cursor after buffer replay — the live PTY stream or resize nudge
    // will re-show it at the correct position, avoiding a stale cursor artifact
    if (!session.isPlainTerminal) target.send('terminal-data', sessionId, '\x1b[?25l');
    target.send('terminal-replayed', sessionId);
    return target;
  }

  /** Whether a resize or close from `sender` may act on the session: its owner's, or a remote one. */
  function mayControl(session, sender) {
    if (!sender) return true;
    const owner = ownerOf(session);
    if (owner === RETURNING) return false;
    if (owner) return sender === owner;
    return !isSessionWindow(sender);
  }

  /** The main window's sink skips what belongs to a session another window owns, or one on its way back. */
  function routesAway(channel, args) {
    if (!routed.has(channel)) return false;
    return ownerOf(sessionFor(args[0])) !== null;
  }

  /** broadcast.js destination for the session windows. */
  function windowSink(channel, args) {
    if (!windows.size) return;
    if (routed.has(channel)) {
      const owner = ownerOf(sessionFor(args[0]));
      if (owner && owner !== RETURNING) owner.send(channel, ...args);
      return;
    }
    if (!windowEvents.has(channel)) return;
    const owner = channel === 'session-owner-changed' ? ownerOf(sessionFor(args[0])) : null;
    for (const { win } of windows.values()) {
      if (!live(win)) continue;
      if (channel === 'session-owner-changed') {
        win.webContents.send(channel, args[0], args[1], args[1] === 'window' && owner === win.webContents);
      } else {
        win.webContents.send(channel, ...args);
      }
    }
  }

  /** A window for the session at the main window's size, a little down and right; or the one it has. */
  async function open(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return;
    const existing = windowFor(sessionId);
    if (existing) {
      bringForward(existing);
      return;
    }
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return;
    const b = main.getBounds();
    // A second one does not hide the first.
    const offset = OFFSET * ([...windows.values()].filter(e => live(e.win)).length + 1);
    const win = createPageWindow('session', SESSION_WINDOW_SPEC, {
      bounds: { x: b.x + offset, y: b.y + offset, width: b.width, height: b.height },
    });
    const wcId = win.webContents.id;
    windows.set(wcId, { win, sessionId, adopted: false });
    // Its sessions are on their way back as soon as its page is gone, not only
    // at the window's closed event: no output streams to the main window in
    // between. onClosed acts once.
    win.webContents.once('destroyed', () => onClosed(wcId));
    win.on('closed', () => onClosed(wcId));
    const session = sessionFor(sessionId);
    const query = { sessionWindow: sessionId };
    if (session) {
      if (session.projectPath) query.projectPath = session.projectPath;
      query.kind = session.isPlainTerminal ? 'terminal' : 'cli';
      if (session.runtime && !session.isPlainTerminal) query.runtime = session.runtime;
    }
    try {
      await win.loadFile(INDEX_PAGE, { query });
    } catch (err) {
      // Closed before its page loaded: nothing to do.
      if (win.isDestroyed()) return;
      // Any other failure would leave a blank window that open() and focus()
      // keep bringing forward: it goes.
      log.error(`[session-windows] could not load the window of ${sessionId}: ${err?.message || err}`);
      win.close();
    }
  }

  function focus(sessionId) {
    const win = windowFor(sessionId);
    if (!win) return false;
    bringForward(win);
    return true;
  }

  function close(sessionId) {
    const win = windowFor(sessionId);
    if (!win) return false;
    win.close();
    return true;
  }

  /** With the main window. */
  function closeAll() {
    for (const { win } of [...windows.values()]) if (!win.isDestroyed()) win.close();
  }

  /** A session window closed: its sessions are on their way back to the main window. */
  function onClosed(wcId) {
    if (!windows.delete(wcId)) return;
    for (const session of new Set(activeSessions.values())) {
      if (session.owner !== wcId) continue;
      session.owner = RETURNING;
      ownerChanged(session, RETURNING);
    }
    sessionNotices.clientClosed(client(wcId));
  }

  /** A session window asks the main window to start a session for it (session-window-run). */
  function run(sender, name, args) {
    const entry = entryOf(sender);
    if (!entry || !SESSION_WINDOW_RUN.has(name) || !Array.isArray(args)) return false;
    const main = mainContents();
    if (!main) return false;
    main.send('session-window-run', name, args, sender.id);
    return true;
  }

  /** The main window hands a session to a session window, which adopts it by reattaching it (move-session-to-window). */
  function move(sender, sessionId, windowId) {
    if (!sender || sender !== mainContents()) return false;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return false;
    const entry = windows.get(windowId);
    if (!entry || !live(entry.win)) return false;
    entry.win.webContents.send('move-session-to-window', sessionId);
    return true;
  }

  /** The session on a session window's screen, or null (session-window-viewing). */
  function viewing(sender, sessionId) {
    if (!entryOf(sender)) return false;
    const id = typeof sessionId === 'string' && sessionId && sessionId.length <= 200 ? sessionId : null;
    return sessionNotices.setViewing(client(sender.id), id);
  }

  return {
    ownerOf, ownerWindow, windowFor, isSessionWindow, takeOwnership, reattach, mayControl, routesAway, windowSink,
    open, focus, close, closeAll, onClosed, run, move, viewing,
  };
}

module.exports = { createSessionWindows, RETURNING, ROUTED_CHANNELS, SESSION_WINDOW_EVENTS, SESSION_WINDOW_SPEC };
