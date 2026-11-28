// --- Sessions in windows of their own, seen from the main window ---
// A session window (session-window.js) owns the terminals of its sessions:
// their output goes there only (session-windows.js). The main window keeps its
// own terminal of each as a shadow: it stays in openSessions, so re-keys, exits
// and the lists work as before, but it gets nothing and answers nothing
// (entry.shadow, muteTerminalInput). Its container gets .popped-out and holds
// the placeholder "In its own window · Bring back · Show window", so the
// placeholder is wherever the terminal would be: the single view, a pane, a
// card of the Session Overview or a pane docked beside them.
//
// - Open in new window (popOutSession): #terminal-header's button
//   (tile-view.js), the overview card's (session-overview.js), and an item of
//   the session menus (splitMenuItems and overviewCardMenuItems take
//   sessionWindowMenuItems). For a session in a window: Show window and Bring
//   back.
// - Bring back closes the window. Its sessions come back (ownerKind
//   'returning') and are reattached here: reset, reattach with the replay,
//   then a resize to the size of the terminal here. The window's panes come
//   back too, in place of the placeholder (graftTile).
// - A session window's splits are started here, without being shown, and
//   handed over (session-window-run, move-session-to-window).
// - What a window shows counts as seen here through main, as a phone's does
//   (remote-viewing, app.js remoteViewing): nothing to do for it here.
//
// Only the main window does any of it: a project window has no terminals, and
// a session window does not send its sessions on to another one.
//
// Depends on: muteTerminalInput, holdTerminalReplies, endTerminalReplay,
// rememberSessionRekey (session-window.js); openSessions, sessionMap,
// activePtyIds, activeSessionId, launchNewSession, loadProjects (app.js);
// openRawTerminalSession (dialogs.js); createTerminalEntry,
// terminalWriteBuffers (terminal-manager.js); setSessionMcpActive
// (file-panel.js); tileStore, tileState, tileCurrentId, newTileLayoutId,
// refreshTileView, syncTileLayout, refreshTileHeaderButtons
// (tile-view.js); graftTile, tileIds (tile-layout-model.js); overviewDock,
// saveOverviewDock (session-overview-dock.js); isSessionOverviewOpen,
// refreshSessionOverview (session-overview.js); ICONS (icons.js). All are
// looked up when called.

function sessionWindowsHere() {
  return typeof window !== 'undefined' && !!window.api?.openSessionWindow
    && !(typeof PROJECT_WINDOW !== 'undefined' && PROJECT_WINDOW)
    && !(typeof SESSION_WINDOW !== 'undefined' && SESSION_WINDOW);
}

function runSessionWindowAction(label, action) {
  return Promise.resolve().then(action).catch(err => console.warn(`[session window] ${label} failed:`, err));
}

/** Open in new window: the session moves to a window of its own; the window it is in already comes forward. */
function popOutSession(id) {
  const session = sessionMap.get(id) || openSessions.get(id)?.session;
  if (!sessionWindowsHere() || !session || session.archived) return false;
  runSessionWindowAction('Open in new window', () => window.api.openSessionWindow(id));
  return true;
}

function showSessionWindow(id) {
  return runSessionWindowAction('Show window', () => window.api.focusSessionWindow(id));
}

/** Bring back: its window closes, and its sessions come back here. With no window left, it is reattached at once. */
function bringBackSession(id) {
  return runSessionWindowAction('Bring back', async () => {
    if (await window.api.closeSessionWindow(id)) return;
    if (activePtyIds.has(id)) await reattachHere(id);
  });
}

/** The session menus' items: Open in new window, or for a session in a window Show window and Bring back. */
function sessionWindowMenuItems(session) {
  const id = session?.sessionId;
  if (!id || session.archived || !sessionWindowsHere()) return [];
  const icon = typeof ICONS !== 'undefined' ? ICONS.popOut(14) : '';
  if (openSessions.get(id)?.shadow) {
    return [
      { label: 'Show window', icon, onClick: () => showSessionWindow(id) },
      { label: 'Bring back', onClick: () => bringBackSession(id) },
    ];
  }
  return [{ label: 'Open in new window', icon, onClick: () => popOutSession(id) }];
}

// ---- The shadow and its placeholder ----

function popOutButton(className, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className} tile-resume-btn`;
  button.textContent = label;
  button.addEventListener('click', e => {
    e.stopPropagation();
    onClick();
  });
  return button;
}

/** "In its own window · Bring back · Show window", over the terminal it stands for. */
function buildPopOutPlaceholder(entry) {
  const id = () => entry.session.sessionId;
  const placeholder = document.createElement('div');
  placeholder.className = 'session-popout-placeholder';
  const text = document.createElement('span');
  text.className = 'session-popout-text';
  text.textContent = 'In its own window';
  const actions = document.createElement('div');
  actions.className = 'session-popout-actions';
  actions.append(
    popOutButton('session-popout-back', 'Bring back', () => bringBackSession(id())),
    popOutButton('session-popout-show', 'Show window', () => showSessionWindow(id())),
  );
  placeholder.append(text, actions);
  // A file dropped on it would be typed into the session, which is elsewhere.
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    placeholder.addEventListener(type, e => e.stopPropagation());
  }
  return placeholder;
}

/** Another window shows the session now: the terminal here is a shadow under the placeholder. */
function markPoppedOut(entry) {
  entry.shadow = true;
  muteTerminalInput(entry);
  const container = entry.element;
  container.classList.add('popped-out');
  if (!entry.popOutPlaceholder) {
    entry.popOutPlaceholder = buildPopOutPlaceholder(entry);
    container.appendChild(entry.popOutPlaceholder);
  }
  if (!entry.popOutFocusGuard) {
    // The keys go to the placeholder, not to the terminal under it (showSession focuses the terminal).
    entry.popOutFocusGuard = () => { if (entry.shadow) entry.popOutPlaceholder?.querySelector('button')?.focus(); };
    entry.terminal.textarea?.addEventListener('focus', entry.popOutFocusGuard);
  }
  if (container.contains(document.activeElement)) entry.popOutFocusGuard();
}

function clearPoppedOut(entry) {
  if (!entry.shadow) return;
  entry.shadow = false;
  muteTerminalInput(entry);
  entry.element.classList.remove('popped-out');
  entry.popOutPlaceholder?.remove();
  entry.popOutPlaceholder = null;
}

/** The terminal here of a session the main window has none of yet (it was never opened here), made hidden. */
function terminalHere(id) {
  const entry = openSessions.get(id);
  if (entry) return entry;
  const session = sessionMap.get(id);
  return session && typeof createTerminalEntry === 'function' ? createTerminalEntry(session) : null;
}

/**
 * The session is the main window's again: what its shadow holds goes
 * (reset), it is reattached with the replay, read without answering
 * (holdTerminalReplies), and sized to the terminal here, which main otherwise
 * learns only at the next fit.
 */
async function reattachHere(id) {
  const entry = terminalHere(id);
  if (!entry || entry.reattaching) return null;
  entry.reattaching = true;
  try {
    const pending = terminalWriteBuffers.get(id);
    if (pending) {
      clearTimeout(pending.timerId);
      cancelAnimationFrame(pending.rafId);
      terminalWriteBuffers.delete(id);
    }
    entry.terminal.reset();
    holdTerminalReplies(entry);
    const s = entry.session;
    const plain = s.type === 'terminal';
    const result = await window.api.openTerminal(s.sessionId, s.projectPath, plain,
      plain ? { type: 'terminal', projectId: s.projectId || null, trackId: s.trackId || null } : null);
    endTerminalReplay(entry, result);
    if (!result?.ok) return result;
    entry.closed = false;
    clearPoppedOut(entry);
    if (typeof setSessionMcpActive === 'function') setSessionMcpActive(s.sessionId, !!result.mcpActive);
    window.api.resizeTerminal(s.sessionId, entry.terminal.cols, entry.terminal.rows);
    return result;
  } finally {
    entry.reattaching = false;
  }
}

// ---- A closed window's panes ----

/**
 * The panes of the window session `id` was in come back into this window's
 * layouts: in place of the placeholder (where one of its sessions is in a
 * layout here, or docked beside the overview's cards), or as a layout of their
 * own. Once per window: its layout goes. The ids it held, or null.
 */
function graftSessionWindowLayout(id) {
  if (typeof tileStore !== 'function' || typeof graftTile !== 'function') return null;
  const store = tileStore();
  const layouts = store.all();
  const away = layouts.find(l => l.scope.startsWith('window:') && tileIds(l.tree).includes(id));
  if (!away) return null;
  const ids = tileIds(away.tree);
  store.drop(away.id);
  const anchorIn = tree => ids.find(sid => tileIds(tree).includes(sid));
  const home = layouts.find(l => l.scope === 'main' && anchorIn(l.tree));
  const dock = typeof overviewDock === 'function' ? overviewDock() : null;
  if (home) store.set(home.id, graftTile(home.tree, anchorIn(home.tree), away.tree), 'main');
  else if (dock && anchorIn(dock)) saveOverviewDock(graftTile(dock, anchorIn(dock), away.tree));
  else store.set(newTileLayoutId(), away.tree, 'main');
  return ids;
}

/** What is on screen takes the panes that came back: the overview, the layout drawn, or the session shown alone. */
function showReturnedPanes(ids) {
  if (typeof isSessionOverviewOpen === 'function' && isSessionOverviewOpen()) {
    refreshSessionOverview();
  } else if (tileState.tree && ids.some(id => tileIds(tileState.tree).includes(id))) {
    refreshTileView();
  } else if (ids.includes(activeSessionId) && openSessions.get(activeSessionId)?.element.classList.contains('visible')) {
    syncTileLayout(activeSessionId);
  }
}

/** Its window closed: the session comes back here, with the window's panes. */
async function onSessionReturning(id) {
  const ids = graftSessionWindowLayout(id);
  if (ids) showReturnedPanes(ids);
  await reattachHere(id);
}

/** session-owner-changed, in the main window. */
function onSessionOwnerChangedHere(id, ownerKind) {
  if (ownerKind === 'returning') return onSessionReturning(id);
  const entry = ownerKind === 'window' ? terminalHere(id) : openSessions.get(id);
  if (!entry) return null;
  if (ownerKind === 'window') markPoppedOut(entry);
  else clearPoppedOut(entry);
  if (typeof refreshTileHeaderButtons === 'function') refreshTileHeaderButtons();
  return null;
}

/**
 * A session window's start (session-window-run): the session starts here,
 * not shown, and moves to the window, which adopts it. A new terminal joins
 * the lists as one started here would.
 */
async function runForSessionWindow(name, args, windowId) {
  if (!Array.isArray(args)) return;
  let id = null;
  if (name === 'launchNewSession') {
    const [project, sessionOptions, opts] = args;
    id = await launchNewSession(project, sessionOptions, { ...(opts || {}), focus: false });
  } else if (name === 'openRawTerminalSession') {
    const [session] = args;
    const result = session?.sessionId ? await openRawTerminalSession(session, { show: false }) : null;
    if (result?.ok) {
      id = session.sessionId;
      loadProjects();
    }
  }
  if (typeof id !== 'string' || !id) return;
  await window.api.moveSessionToWindow(typeof tileCurrentId === 'function' ? tileCurrentId(id) : id, windowId);
}

if (sessionWindowsHere()) {
  window.api.onSessionOwnerChanged((id, ownerKind) => Promise.resolve(onSessionOwnerChangedHere(id, ownerKind))
    .catch(err => console.warn('[session window] Could not follow the session', id, err)));
  window.api.onSessionWindowRun((name, args, windowId) => runForSessionWindow(name, args, windowId)
    .catch(err => console.warn(`[session window] ${name} for a session window failed:`, err)));
  // A session that ended is in no window: its terminal here shows how it ended.
  window.api.onProcessExited(id => {
    const entry = openSessions.get(id);
    if (entry?.shadow) clearPoppedOut(entry);
  });
  // For a window that opens while its session changes id (session-window.js currentSessionId).
  window.api.onSessionDetected((oldId, newId) => rememberSessionRekey(oldId, newId));
  window.api.onSessionForked((oldId, newId) => rememberSessionRekey(oldId, newId));
}
