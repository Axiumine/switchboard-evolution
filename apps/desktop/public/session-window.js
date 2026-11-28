// --- A session in a window of its own ---
// index.html?sessionWindow=<id> (main.js, session-windows.js open): the same
// page as the main window, with the terminal area alone (style.css
// body.session-window). It shows a session as the Session tab does: its
// header, its terminal and its split panes, whose layouts are kept under the
// scope 'window:<id>' (tile-view.js tileState.scope). Reattaching a session is
// what takes its output (open-terminal makes the window that asks its owner),
// so at start the window opens its own session and nothing else: app.js's
// boot branch calls startSessionWindow and returns, and the gates beside each
// PROJECT_WINDOW skip what only the main window does. Loaded right after
// project-window.js, before the other scripts, so they can read SESSION_WINDOW.
//
// The main window has the lists and starts the sessions: launchNewSession, and
// openRawTerminalSession for a terminal that is not running yet, are relayed to
// it (session-window-run). It starts the session without showing it, then
// hands it over (move-session-to-window), and this window adopts it by
// reattaching it. Only then does the relayed call resolve, so a split here
// (splitSession) places its new pane as it does in the main window. A session
// another window takes leaves this one, and the window closes once its last
// session has ended. The window's title is the session's name, its pin keeps
// it above the others (tool-window.js), and the session on its screen counts
// as seen in the main window (setSessionWindowViewing, session-notices.js).
//
// Every window, the main one too: a terminal that reattaches a live session
// gets the session's buffer replayed, and xterm would answer again every
// terminal query in it (cursor position, device attributes), typing stale
// replies into the program: a shell shows them at its prompt. Its replies are
// held from the moment the terminal is made (createTerminalEntry's hook) until
// xterm has read the whole replay, which main ends with terminal-replayed
// (session-windows.js): open-terminal's answer can come before the replay's
// chunks, so it only says whether a replay comes at all (endTerminalReplay,
// after open-terminal in openSession and openRawTerminalSession). The main
// window's terminal of a session shown in a window answers nothing either
// (entry.shadow, session-window-host.js). Both through xterm's disableStdin.
//
// Depends on: activePtyIds, openSessions, sessionMap, activeSessionId,
// openSession, showSession, launchNewSession (app.js); openRawTerminalSession
// (dialogs.js); flushTerminalBuffer, destroySession, persistedTerminalSessions
// (terminal-manager.js); tileState, tileCurrentId, removeFromSplit,
// placeTileSplit (tile-view.js); setupWindowPin (tool-window.js);
// navigateSession (grid-view.js). All are looked up when called.

const SESSION_WINDOW = (() => {
  try {
    const sessionId = new URLSearchParams(location.search).get('sessionWindow');
    return sessionId ? { sessionId } : null;
  } catch { return null; }
})();

if (SESSION_WINDOW) document.body.classList.add('session-window');

// ---- Terminal replies while a reattach replays (every window) ----

// A reattach that never answers does not leave its terminal mute for good.
const REPLAY_HOLD_MS = 15000;
// Ids this window is about to reattach though activePtyIds may not know them yet.
const replayExpected = new Set();

/** The terminal answers and takes input, unless it is reading a replay or stands for a session shown in another window. */
function muteTerminalInput(entry) {
  try { entry.terminal.options.disableStdin = !!(entry.replaying || entry.shadow); } catch {}
}

function holdTerminalReplies(entry) {
  entry.replaying = true;
  clearTimeout(entry.replayTimer);
  entry.replayTimer = setTimeout(() => releaseTerminalReplies(entry), REPLAY_HOLD_MS);
  muteTerminalInput(entry);
}

function releaseTerminalReplies(entry) {
  clearTimeout(entry.replayTimer);
  entry.replayTimer = 0;
  entry.replaying = false;
  muteTerminalInput(entry);
}

/** createTerminalEntry's hook: a terminal made for a live session is about to get its replay. */
function beginTerminalReplay(entry) {
  const id = entry?.session?.sessionId;
  if (!id) return;
  const live = replayExpected.has(id) || (typeof activePtyIds !== 'undefined' && activePtyIds.has(id));
  if (live) holdTerminalReplies(entry);
}

/**
 * After open-terminal answered (openSession, openRawTerminalSession, Bring
 * back): a session that was started instead of reattached (it had ended
 * meanwhile) has no replay, and answers at once. A reattached one waits for
 * the end of its replay (onTerminalReplayed below).
 */
function endTerminalReplay(entry, result) {
  if (entry?.replaying && !result?.reattached) releaseTerminalReplies(entry);
}

/** The whole replay came: what is still buffered is written now, and the terminal answers again once xterm has read it. */
function onTerminalReplayed(id) {
  const entry = openSessions.get(id);
  if (!entry?.replaying) return;
  flushTerminalBuffer(id);
  entry.terminal.write('', () => releaseTerminalReplies(entry));
}

window.api.onTerminalReplayed(onTerminalReplayed);

// ---- A session's id that changed while its window opened ----
// Codex's real id, or a fork's, can come between the moment a window opens for
// a session and the moment its page hears of it. The main window keeps the
// last changes (session-window-host.js), so the window opens the session under
// its new id instead of starting a new one under the old.

const SESSION_REKEYS_KEY = 'sessionRekeys.v1';
const SESSION_REKEYS_MAX = 20;

function readSessionRekeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_REKEYS_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(pair => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string');
  } catch { return []; }
}

function rememberSessionRekey(oldId, newId) {
  if (typeof oldId !== 'string' || typeof newId !== 'string' || !oldId || !newId || oldId === newId) return;
  const kept = readSessionRekeys().filter(([from]) => from !== oldId);
  kept.push([oldId, newId]);
  try { localStorage.setItem(SESSION_REKEYS_KEY, JSON.stringify(kept.slice(-SESSION_REKEYS_MAX))); } catch {}
}

/** The id a session has now: through the changes this page heard of, then those the main window kept. */
function currentSessionId(id) {
  if (typeof tileCurrentId === 'function') id = tileCurrentId(id);
  const rekeys = new Map(readSessionRekeys());
  for (let hops = 0; hops < 8 && rekeys.has(id); hops++) id = rekeys.get(id);
  return id;
}

// ---- The session window ----

// A start the main window was asked for and never handed over.
const SESSION_WINDOW_RELAY_MS = 20000;
// Starts relayed to the main window, oldest first: { id (a terminal's, known up front) or null, settle(id or null) }.
const sessionWindowRelays = [];
// Ids being adopted: their showSession is left to whoever asked for them.
const sessionWindowQuiet = new Set();

/**
 * A session as this window can open it: what the lists know, else main's own
 * description of a live session (one the main window has just started is in
 * no list here yet). Null for one that is neither.
 */
async function sessionToOpen(id) {
  const known = sessionMap.get(id) || persistedTerminalSessions().find(s => s.sessionId === id);
  if (known) return known;
  let state = null;
  try {
    state = (await window.api.getSessionStates() || []).find(s => s.sessionId === id && !s.exited) || null;
  } catch {}
  if (!state) return null;
  const terminal = state.type === 'terminal';
  const now = new Date().toISOString();
  const session = {
    sessionId: id,
    summary: terminal ? 'Terminal' : 'New session',
    firstPrompt: '',
    projectPath: state.projectPath,
    projectId: state.projectId || null,
    trackId: state.trackId || null,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: now,
    created: now,
    ...(terminal ? { type: 'terminal' } : { runtime: state.runtime || 'claude' }),
  };
  sessionMap.set(id, session);
  return session;
}

/** app.js's boot branch: the window opens its own session, which makes it its owner. */
async function startSessionWindow() {
  if (typeof tileState !== 'undefined') tileState.scope = `window:${SESSION_WINDOW.sessionId}`;
  installSessionWindowChrome();
  const session = await sessionToOpen(currentSessionId(SESSION_WINDOW.sessionId));
  // Gone before the window could open it (a terminal that ended, a start that failed).
  if (!session) {
    window.close();
    return;
  }
  await openSession(session);
}

/** The pin, the title, and what the window tells main it shows. */
function installSessionWindowChrome() {
  const controls = document.getElementById('terminal-header-controls');
  if (controls && typeof setupWindowPin === 'function') {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.id = 'session-window-pin';
    pin.className = 'tool-window-btn';
    controls.appendChild(pin);
    setupWindowPin(pin);
  }
  const name = document.getElementById('terminal-header-name');
  const idEl = document.getElementById('terminal-header-id');
  const follow = () => {
    document.title = name?.textContent.trim() || 'Session';
    // On screen, the session in focus counts as seen in the main window too.
    window.api.setSessionWindowViewing(document.hidden ? null : activeSessionId || null);
  };
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(follow);
    for (const el of [name, idEl]) if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
  }
  document.addEventListener('visibilitychange', follow);
  follow();
}

/** A start asked of the main window: the id of the session it hands over, once adopted here, or null. */
function relayToMainWindow(name, args, id = null) {
  return new Promise(resolve => {
    const relay = { id, timer: 0 };
    relay.settle = value => {
      const at = sessionWindowRelays.indexOf(relay);
      if (at === -1) return;
      sessionWindowRelays.splice(at, 1);
      clearTimeout(relay.timer);
      resolve(value);
    };
    sessionWindowRelays.push(relay);
    relay.timer = setTimeout(() => relay.settle(null), SESSION_WINDOW_RELAY_MS);
    Promise.resolve()
      .then(() => window.api.sessionWindowRun(name, args))
      .then(sent => { if (!sent) relay.settle(null); }, () => relay.settle(null));
  });
}

/** launchNewSession here: the main window starts it, then it is shown here unless `focus` is false. */
async function launchFromSessionWindow(project, sessionOptions, { focus = true, ...rest } = {}) {
  const id = await relayToMainWindow('launchNewSession', [project, sessionOptions || null, { ...rest, focus: false }]);
  if (id && focus) showSession(id);
  return id || undefined;
}

/**
 * openRawTerminalSession here, around the real one (`open`): a terminal that
 * runs, or one being adopted, is reattached here; a new one is started by the
 * main window and handed over.
 */
function terminalFromSessionWindow(open) {
  return async (session, options = {}) => {
    const id = session?.sessionId;
    if (!id || replayExpected.has(id) || activePtyIds.has(id)) return open(session, options);
    const adopted = await relayToMainWindow('openRawTerminalSession', [session, { show: false }], id);
    if (!adopted) return { ok: false, error: 'The main window did not start the terminal.' };
    if (options.show !== false) showSession(adopted);
    return { ok: true, reattached: true };
  };
}

/**
 * move-session-to-window: a session the main window started for this one
 * comes in. It is reattached here, which makes this window its owner, and
 * the start that asked for it resolves; one nobody here waits for any more
 * goes beside the session in focus.
 */
async function adoptMovedSession(movedId) {
  const id = currentSessionId(movedId);
  const relay = sessionWindowRelays.find(r => r.id === movedId || r.id === id)
    || sessionWindowRelays.find(r => !r.id);
  const session = await sessionToOpen(id);
  if (!session) {
    relay?.settle(null);
    return;
  }
  replayExpected.add(id);
  sessionWindowQuiet.add(id);
  try {
    await openSession(session);
  } finally {
    replayExpected.delete(id);
    sessionWindowQuiet.delete(id);
  }
  const adopted = !!openSessions.get(id) && !openSessions.get(id).closed;
  if (relay) relay.settle(adopted ? id : null);
  else if (adopted && activeSessionId && typeof placeTileSplit === 'function') placeTileSplit(activeSessionId, id);
}

/** Another window took a session shown here (the main window opened it): it leaves this window. */
function leaveSessionWindow(id) {
  const entry = openSessions.get(id);
  if (!entry) return;
  entry.shadow = true;
  muteTerminalInput(entry);
  if (typeof removeFromSplit === 'function') removeFromSplit(id);
  // Its history and its saved terminal are the other window's now.
  destroySession(id, { forgetPersisted: false, preserveHistory: true });
  const next = [...openSessions.keys()][0];
  if (activeSessionId === id && next) showSession(next);
}

if (SESSION_WINDOW) {
  // Every script has run by now: the functions are replaced where they are
  // looked up, as project-window.js does.
  document.addEventListener('DOMContentLoaded', () => {
    window.launchNewSession = launchFromSessionWindow;
    window.openRawTerminalSession = terminalFromSessionWindow(window.openRawTerminalSession);
    const show = window.showSession;
    window.showSession = id => (sessionWindowQuiet.has(id) ? undefined : show(id));
    // Cmd+Shift+[ / ] and Cmd+Arrows would open the sidebar's other sessions here.
    window.navigateSession = () => {};
  }, { once: true });
  window.api.onMoveSessionToWindow(id => adoptMovedSession(id)
    .catch(err => console.warn('[session window] Could not adopt the session', id, err)));
  window.api.onSessionOwnerChanged((id, _kind, mine) => { if (!mine) leaveSessionWindow(id); });
  // One of its sessions ended: once app.js has dealt with it, a window left with none closes.
  window.api.onProcessExited(id => {
    if (openSessions.has(id)) setTimeout(() => { if (!openSessions.size) window.close(); }, 0);
  });
}
