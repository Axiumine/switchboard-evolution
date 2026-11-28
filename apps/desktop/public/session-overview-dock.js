// --- The Session Overview's dock: sessions beside the cards ---
// A card's Split docks its session beside the cards: the page's body is a tile
// layout (tile-layout-model.js, drawn by mountTileTree) whose last leaf is the
// cards area, and each docked session is a pane like the Session tab's
// (createTilePane, tile-view.js). The first one takes half the page, each next
// one half of what is left to the cards. A docked pane's Split starts a new
// session beside it, in the dock (splitSession with a place of its own: the
// Session tab's layouts are never touched), and its Remove from split puts the
// session back among the cards. Closed cards cannot be docked.
//
// The dock is overview.prefs.v1's `dock`, read through parseTileDock: anything
// else is no dock. Each render first takes out of it the sessions that are no
// longer open (a stopped or exited one comes back as a card, as the model
// decides; one resuming for the page stays), then tells the model which are
// docked (excludeIds), so they are no cards. Maximize works on a pane as on a
// card: the pane, or the cards area around a maximized card, fills the body.
// When the page closes, the docked terminals go back to #terminals like the
// cards' do.
//
// Reached from session-overview.js through typeof guards: mountOverviewDock,
// unmountOverviewDock, pruneOverviewDock, drawOverviewDock, paintOverviewDock,
// overviewDockPaneOf, overviewDockZoomedId, toggleOverviewDockZoom, the menu
// items overviewDockMenuItems and overviewSplitMenuItems, and the card's
// Split (dockInOverview).
//
// Depends on: parseTileDock, dockBesideCards, splitTile, removeTile,
// rekeyTileTree, setTileRatio, tileIds, tileNeighbor, TILE_CARDS
// (tile-layout-model.js); mountTileTree, createTilePane, paintTilePaneHeader,
// disposeTilePane, tileRectOf, tileSessionOf, runTileAction, isTileFocusKey,
// TILE_KEY_DIRECTIONS, TILE_ICONS, TILE_DOTS_MS (tile-view.js); splitSession,
// splitSessionWithConfiguration (session-split.js); ovState,
// ensureOverviewPrefs, isSessionOverviewOpen, sessionOverviewUnavailable,
// refreshSessionOverview, scheduleOverviewRefresh, selectOverviewCard,
// overviewFocus, toggleOverviewMaximize, overviewCardMenuItems
// (session-overview.js); saveOverviewPrefs (session-overview-model.js);
// openSessions, activeSessionId (app.js); fitAndScroll (terminal-manager.js);
// ICONS (icons.js). All are looked up when called.

const ovDock = {
  mount: null, // mountTileTree's handle over .ov-body, while the page is open
  cardsLeaf: null, // the cards area's leaf: .ov-cards in a box of its own
  tree: null, // the tree drawn
  panes: new Map(), // docked session id -> its pane
  zoomedId: null, // the docked pane that fills the body (Maximize)
  observer: null, // a terminal taken out of a pane (destroySession) draws the page again
  timer: 0, // the panes' dots and names follow their sessions
};

const isOverviewDockId = id => typeof id === 'string' && id !== '';

/** The saved dock as it can be drawn; null when nothing is docked. */
function overviewDock() {
  return parseTileDock(ensureOverviewPrefs().dock);
}

function isOverviewDocked(id) {
  return isOverviewDockId(id) && tileIds(overviewDock()).includes(id);
}

/** Keeps `tree` as the dock, with the page's other choices: none when no session is left in it. */
function saveOverviewDock(tree) {
  const prefs = ensureOverviewPrefs();
  const dock = parseTileDock(tree);
  if (JSON.stringify(dock) !== JSON.stringify(prefs.dock ?? null)) {
    prefs.dock = dock;
    saveOverviewPrefs(localStorage, prefs);
  }
  return dock;
}

// ---- Dock, undock, split ----

/** A card's Split: its session takes half of the cards' area, beside them, and the focus. */
function dockInOverview(id) {
  if (!isOverviewDockId(id) || !openSessions.has(id) || isOverviewDocked(id)) return false;
  ovDock.zoomedId = null;
  saveOverviewDock(dockBesideCards(overviewDock() || TILE_CARDS, id, tileRectOf(ovDock.cardsLeaf)));
  refreshSessionOverview();
  selectOverviewCard(id);
  return true;
}

/** Remove from split: the session goes back among the cards (it keeps running), in focus. */
function undockFromOverview(id) {
  const dock = overviewDock();
  if (!isOverviewDocked(id)) return false;
  if (ovDock.zoomedId === id) ovDock.zoomedId = null;
  saveOverviewDock(removeTile(dock, id));
  // Drawn again on the way: its card is not on the page yet.
  overviewFocus(id);
  return true;
}

/** Where a docked pane's split puts the new session: beside it, in the dock, in focus. */
function placeInOverviewDock(targetId, direction = 'auto') {
  return newId => {
    const dock = overviewDock();
    // The pane it came from left meanwhile: the new session docks beside the cards.
    if (!tileIds(dock).includes(targetId)) { dockInOverview(newId); return; }
    if (!isOverviewDockId(newId) || tileIds(dock).includes(newId)) return;
    ovDock.zoomedId = null;
    saveOverviewDock(splitTile(dock, targetId, newId, { rect: tileRectOf(ovDock.panes.get(targetId)), direction }));
    refreshSessionOverview();
    selectOverviewCard(newId);
  };
}

/** A docked pane's Split, Split right and Split down: a new session beside it. */
function splitOverviewDockPane(id, direction = 'auto') {
  runTileAction('Split', () => splitSession(id, { direction, scope: 'overview', place: placeInOverviewDock(id, direction) }));
}

// ---- Menus (overviewCardMenuItems, session-overview.js) ----

/** A docked session's own item: Remove from split. */
function overviewDockMenuItems(session) {
  const id = session?.sessionId;
  if (!isOverviewDocked(id)) return [];
  return [{ label: 'Remove from split', icon: TILE_ICONS.remove(13), onClick: () => undockFromOverview(id) }];
}

/**
 * The page's splits, in place of the Session tab's (splitMenuItems): a card's
 * Split docks it, and a session started from it with "New split session with
 * configuration…" is docked beside the cards; a docked pane's splits start a
 * new session beside it, in the dock. A closed card has none.
 */
function overviewSplitMenuItems(session) {
  const id = session?.sessionId;
  if (!isOverviewDockId(id) || session.archived) return [];
  const docked = isOverviewDocked(id);
  if (!docked && !openSessions.has(id)) return [];
  const icon = name => TILE_ICONS[name](14);
  const items = docked
    ? [
      { label: 'Split', icon: icon('split'), onClick: () => splitOverviewDockPane(id) },
      { label: 'Split right', icon: icon('splitRight'), onClick: () => splitOverviewDockPane(id, 'right') },
      { label: 'Split down', icon: icon('splitDown'), onClick: () => splitOverviewDockPane(id, 'down') },
    ]
    : [{ label: 'Split', icon: icon('split'), onClick: () => dockInOverview(id) }];
  if (session.type !== 'terminal') {
    const place = docked ? placeInOverviewDock(id) : newId => dockInOverview(newId);
    items.push({
      label: 'New split session with configuration…',
      icon: typeof ICONS !== 'undefined' ? ICONS.launchConfig(14) : '',
      onClick: () => runTileAction('Split with configuration', () => splitSessionWithConfiguration(id, { scope: 'overview', place })),
    });
  }
  return [...items, { sep: true }];
}

// ---- Drawing ----

/** mountSessionOverview's hook: the page's body as a tile layout, the cards area its leaf. */
function mountOverviewDock(body, cardsEl) {
  const leaf = document.createElement('div');
  leaf.className = 'ov-cards-leaf';
  leaf.appendChild(cardsEl);
  ovDock.cardsLeaf = leaf;
  ovDock.tree = TILE_CARDS;
  ovDock.observer = new MutationObserver(records => {
    if (records.some(r => [...r.removedNodes].some(n => n.classList?.contains('terminal-container')))) scheduleOverviewRefresh();
  });
  ovDock.mount = mountTileTree(body, TILE_CARDS, { renderLeaf: overviewDockLeaf, onRatio: saveOverviewDockRatio });
  window.addEventListener('keydown', onOverviewDockKeydown, true);
}

/** unmountSessionOverview's hook: the docked terminals go back to #terminals. */
function unmountOverviewDock() {
  window.removeEventListener('keydown', onOverviewDockKeydown, true);
  clearInterval(ovDock.timer);
  ovDock.timer = 0;
  ovDock.observer?.disconnect();
  ovDock.observer = null;
  for (const id of [...ovDock.panes.keys()]) releaseOverviewDockPane(id);
  ovDock.mount?.destroy();
  ovDock.mount = ovDock.cardsLeaf = ovDock.tree = ovDock.zoomedId = null;
}

/**
 * A render's first step: the sessions no longer open leave the dock (one
 * resuming for the page stays: its terminal is on its way), and the ids of
 * those still docked, which the model leaves out of the cards.
 */
function pruneOverviewDock() {
  const keep = id => openSessions.has(id) || ovState.adopted.has(id);
  return tileIds(saveOverviewDock(parseTileDock(ensureOverviewPrefs().dock, keep)));
}

/** A render's last step: the dock's tree on the body, each docked terminal in its pane. */
function drawOverviewDock() {
  if (!ovDock.mount) return;
  const tree = overviewDock() || TILE_CARDS;
  const ids = tileIds(tree);
  for (const id of [...ovDock.panes.keys()]) if (!ids.includes(id)) releaseOverviewDockPane(id);
  ovDock.tree = tree;
  paintOverviewDock();
  for (const id of ids) fillOverviewDockPane(id);
  // Those moves are the page's own.
  ovDock.observer?.takeRecords();
  if (ids.length && !ovDock.timer) ovDock.timer = setInterval(paintOverviewDockPanes, TILE_DOTS_MS);
  if (!ids.length && ovDock.timer) { clearInterval(ovDock.timer); ovDock.timer = 0; }
}

/** The pane in focus (the session in focus, when docked) and Maximize: a pane, or the cards area around a maximized card. */
function paintOverviewDock() {
  if (!ovDock.mount) return;
  if (ovState.maximized || !ovDock.panes.has(ovDock.zoomedId)) ovDock.zoomedId = null;
  ovDock.mount.update(ovDock.tree, {
    focusedId: ovDock.panes.has(activeSessionId) ? activeSessionId : null,
    zoomedId: ovState.maximized ? 'cards' : ovDock.zoomedId,
  });
  paintOverviewDockPanes();
}

function paintOverviewDockPanes() {
  for (const [id, pane] of ovDock.panes) paintTilePaneHeader(pane, id, ovDock.zoomedId === id);
}

/** mountTileTree's renderLeaf: the cards area, or a docked session's pane (made once). */
function overviewDockLeaf(key) {
  if (key === 'cards') return ovDock.cardsLeaf;
  const existing = ovDock.panes.get(key);
  if (existing) return existing;
  const pane = createTilePane(key, {
    split: id => splitOverviewDockPane(id),
    maximize: toggleOverviewDockZoom,
    remove: undockFromOverview,
    menu: id => overviewCardMenuItems(tileSessionOf(id)),
    focus: (id, { focusTerminal }) => selectOverviewCard(id, { focusTerminal }),
    focused: id => activeSessionId === id,
  });
  pane.classList.add('ov-dock-pane');
  ovDock.observer?.observe(pane.querySelector('.tile-pane-body'), { childList: true });
  ovDock.panes.set(key, pane);
  return pane;
}

/** A docked pane takes its session's terminal (none yet while it resumes). */
function fillOverviewDockPane(id) {
  const pane = ovDock.panes.get(id);
  const entry = openSessions.get(id);
  if (!pane || !entry) return;
  const body = pane.querySelector('.tile-pane-body');
  const container = entry.element;
  if (container.parentNode === body) return;
  container.classList.remove('visible', 'ov-mode');
  container.classList.add('tile-mode');
  body.appendChild(container);
  fitAndScroll(entry);
}

/** A pane leaves: its terminal, if still in it, goes back to #terminals. */
function releaseOverviewDockPane(id) {
  const pane = ovDock.panes.get(id);
  if (!pane) return;
  ovDock.panes.delete(id);
  disposeTilePane(pane);
}

function saveOverviewDockRatio(path, ratio) {
  const dock = overviewDock();
  if (dock) ovDock.tree = saveOverviewDock(setTileRatio(dock, path, ratio)) || TILE_CARDS;
}

// ---- Focus and Maximize ----

/** The pane of a docked session, for the page's focus (selectOverviewCard, overviewFocus). */
function overviewDockPaneOf(id) {
  return isOverviewDocked(id) ? ovDock.panes.get(id) || null : null;
}

function overviewDockZoomedId() {
  return ovDock.mount ? ovDock.zoomedId : null;
}

/** Maximize of a docked pane: it fills the page's body; again, or Esc, puts it back. False for a session not docked. */
function toggleOverviewDockZoom(id) {
  if (!ovDock.mount || !overviewDockPaneOf(id)) return false;
  // A maximized card goes back first.
  if (ovState.maximized) toggleOverviewMaximize(ovState.maximized.session.sessionId);
  ovDock.zoomedId = ovDock.zoomedId === id ? null : id;
  // The pane is the session in focus; the keys stay where they are, so Esc can put it back.
  selectOverviewCard(id, { focusTerminal: false });
  return true;
}

/** Cmd/Ctrl+Alt+Arrows from a docked pane: the pane next to it that way. The cards are Cmd/Ctrl+Arrows'. */
function onOverviewDockKeydown(e) {
  if (!ovDock.mount || !isTileFocusKey(e)) return;
  const from = e.target === document.body ? activeSessionId : e.target.closest?.('.ov-dock-pane')?.dataset.sessionId;
  if (!overviewDockPaneOf(from)) return;
  e.preventDefault();
  e.stopPropagation();
  if (ovDock.zoomedId) toggleOverviewDockZoom(ovDock.zoomedId);
  const next = tileNeighbor(ovDock.tree, { x: 0, y: 0, width: 100, height: 100 }, from, TILE_KEY_DIRECTIONS[e.key]);
  if (next && openSessions.has(next)) selectOverviewCard(next);
}

// ---- Events ----

/** Codex's real id, or a fork's: the dock and the pane follow the session. */
function rekeyOverviewDock(oldId, newId) {
  if (!isOverviewDockId(newId) || oldId === newId || !isOverviewDocked(oldId)) return;
  saveOverviewDock(rekeyTileTree(overviewDock(), oldId, newId));
  const pane = ovDock.panes.get(oldId);
  if (pane && !ovDock.panes.has(newId)) {
    ovDock.panes.delete(oldId);
    ovDock.panes.set(newId, pane);
    pane.dataset.sessionId = newId;
  }
  if (ovDock.zoomedId === oldId) ovDock.zoomedId = newId;
  // Drawn again once app.js has moved the session to its new id.
  if (isSessionOverviewOpen()) setTimeout(scheduleOverviewRefresh, 0);
}

if (typeof window !== 'undefined' && window.api && !sessionOverviewUnavailable()) {
  // Registered before app.js's own listeners: the dock is re-keyed at once,
  // and nothing is drawn until app.js has re-keyed the session too.
  window.api.onSessionDetected((tempId, realId) => rekeyOverviewDock(tempId, realId));
  window.api.onSessionForked((oldId, newId) => rekeyOverviewDock(oldId, newId));
  window.api.onCliBusyState(sessionId => {
    if (ovDock.panes.has(sessionId)) setTimeout(paintOverviewDockPanes, 0);
  });
}
