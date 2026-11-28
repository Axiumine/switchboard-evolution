// --- Split panes in the Session tab, like tmux ---
// A session the Session tab shows can share it with others: a layout of panes
// (tile-layout-model.js), kept in tileLayouts.v1 (createTileStore). Showing any
// session of a layout shows the whole layout, with that pane in focus.
//
// The layout is a .tile-root inside #terminals, so the file panel stays at the
// right and follows the pane in focus. Each pane is a .tile-pane with a header
// (dot, name, Split, Maximize, Remove from split, ⋯) and the session's own
// terminal container, moved into it with the class tile-mode. #terminal-header
// stays the header of the pane in focus; Split and Open in new window are
// added to it here. The root is on screen while a terminal in it is .visible,
// so every path that hides the terminals today hides the layout too.
//
// Reached through one-line hooks guarded with typeof: showSession
// (terminal-manager.js) calls syncTileLayout in its single view, launchNewSession
// (app.js) remembers launch options (session-split.js), and sessionMenuItems
// (projects-view.js) adds the split items. A click in a pane gives it the focus
// without showSession, so the project page is not drawn again for each click.
//
// While the Session Overview is open its cards hold the terminals: nothing here
// moves them then, and the next showSession takes them back into their panes.
//
// mountTileTree draws any tree, the overview's dock (with its cards leaf) too,
// and createTilePane, paintTilePaneHeader and disposeTilePane make, paint and
// end its panes.
//
// Depends on: splitTile, removeTile, replaceTileId, setTileRatio, tileNeighbor,
// tileIds, tileIsSplit, tileIsCards, pruneTiles, createTileStore
// (tile-layout-model.js); safeFit, isAtBottom, fitAndScroll, isMac
// (terminal-manager.js); openSessions, sessionMap, activeSessionId,
// activePtyIds, sessionBusyState, terminalsEl, terminalArea, setActiveSession,
// clearNotifications, showTerminalHeader, openSession (app.js); splitSession,
// rekeyLaunchSpec (session-split.js); sessionTitle, sessionMenuItems,
// showContextMenu, projectForSession, rememberProjectSession, saveProjectsUi,
// refreshProjectDrawers (projects-view.js); isSessionOverviewOpen
// (session-overview.js); popOutSession (a later task); ICONS (icons.js).
// All are looked up when called.

const TILE_GAP = 3; // px between a pane and the divider beside it
const TILE_DOTS_MS = 2000; // the panes' dots and names follow the sessions at this pace
const TILE_EDGE = 1e-6;

const tileSvg = (size, paths) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const TILE_ICONS = {
  split: (s = 12) => tileSvg(s, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><path d="M12 12h9"/>'),
  splitRight: (s = 12) => tileSvg(s, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  splitDown: (s = 12) => tileSvg(s, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>'),
  maximize: (s = 12) => tileSvg(s, '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>'),
  remove: (s = 12) => tileSvg(s, '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  more: (s = 12) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
};

const tileState = {
  scope: 'main', // the store's scope this window's Session tab shows (a session's window: 'window:<id>')
  mount: null, // mountTileTree's handle for the layout in #terminals
  layoutId: null,
  tree: null, // the tree drawn
  focusedId: null,
  zoomedId: null, // the pane that fills the layout (Maximize)
  panes: new Map(), // session id -> its .tile-pane
  rekeys: new Map(), // an id that was re-keyed -> its new id, for launches that end after it
  dotsTimer: 0,
  headerSplit: null,
  headerPopOut: null,
};

let tileStoreInstance = null;
function tileStore() {
  if (!tileStoreInstance) tileStoreInstance = createTileStore(localStorage);
  return tileStoreInstance;
}

const isTileId = id => typeof id === 'string' && id !== '';

/** The id a session has now: a launch that ends after its re-key still finds it. */
function tileCurrentId(id) {
  for (let hops = 0; hops < 8 && tileState.rekeys.has(id); hops++) id = tileState.rekeys.get(id);
  return id;
}

// ---- Drawing a tree ----

/**
 * Draws `tree` in `container`: a .tile-root holding, for each leaf, the element
 * renderLeaf(key) gives (key: the session id, or 'cards'), placed by its share
 * of the root, and a .tile-divider for each split. Dragging a divider resizes
 * live and calls onRatio(path, ratio) when it is let go. The leaf `focusedId`
 * has .focused; with `zoomedId`, that leaf alone fills the root (tmux's zoom).
 *
 * update(tree, { focusedId, zoomedId }) draws another tree in the same root:
 * leaves already in it stay where they are in the DOM (a terminal keeps its
 * focus), new ones are asked of renderLeaf, and those that left are taken out.
 * destroy() removes the root with whatever is still in it.
 */
function mountTileTree(container, tree, { renderLeaf, onRatio, focusedId = null, zoomedId = null } = {}) {
  const root = document.createElement('div');
  root.className = 'tile-root';
  const leaves = new Map(); // key -> element
  const dividers = new Map(); // path ('', 'a', 'ab'…) -> { el, path, rect, row }
  let current = tree;
  let focused = focusedId;
  let zoomed = zoomedId;
  let drag = null;

  const pct = value => `${Math.round(value * 1000) / 1000}%`;
  // A side on the root's edge touches it; an inner side leaves room for its divider.
  const inner = from => (from > TILE_EDGE && from < 100 - TILE_EDGE ? `calc(${pct(from)} + ${TILE_GAP}px)` : '0px');
  const place = (el, r) => {
    el.style.left = inner(r.x);
    el.style.top = inner(r.y);
    el.style.right = inner(100 - r.x - r.width);
    el.style.bottom = inner(100 - r.y - r.height);
  };

  function draw() {
    const keys = new Set();
    const paths = new Set();
    const zoomOn = zoomed != null && tileHasLeaf(current, zoomed);
    root.classList.toggle('tile-zoomed', zoomOn);
    const walk = (node, r, path) => {
      if (!node) return;
      if (tileIsSplit(node)) {
        const row = node.split === 'row';
        const share = (row ? r.width : r.height) * node.ratio;
        const a = row ? { x: r.x, y: r.y, width: share, height: r.height } : { x: r.x, y: r.y, width: r.width, height: share };
        const b = row
          ? { x: r.x + share, y: r.y, width: r.width - share, height: r.height }
          : { x: r.x, y: r.y + share, width: r.width, height: r.height - share };
        drawDivider(path, r, row, row ? r.x + share : r.y + share, zoomOn);
        paths.add(path.join(''));
        walk(node.a, a, [...path, 'a']);
        walk(node.b, b, [...path, 'b']);
        return;
      }
      const key = tileIsCards(node) ? 'cards' : node.session;
      keys.add(key);
      let el = leaves.get(key);
      if (!el) {
        el = renderLeaf(key);
        leaves.set(key, el);
      }
      if (el.parentNode !== root) root.appendChild(el);
      el.classList.add('tile-leaf');
      el.classList.toggle('focused', key === focused);
      el.hidden = zoomOn && key !== zoomed;
      place(el, zoomOn && key === zoomed ? { x: 0, y: 0, width: 100, height: 100 } : r);
    };
    walk(current, { x: 0, y: 0, width: 100, height: 100 }, []);
    for (const [key, el] of leaves) {
      if (keys.has(key)) continue;
      leaves.delete(key);
      // The same element may stand for a new key now (a re-keyed session).
      if (![...leaves.values()].includes(el) && el.parentNode === root) el.remove();
    }
    for (const [key, divider] of dividers) {
      if (paths.has(key)) continue;
      divider.el.remove();
      dividers.delete(key);
    }
  }

  function drawDivider(path, rect, row, at, hidden) {
    const key = path.join('');
    let divider = dividers.get(key);
    if (!divider) {
      const el = document.createElement('div');
      el.className = 'tile-divider';
      el.addEventListener('pointerdown', e => startDrag(e, key));
      root.appendChild(el);
      divider = { el };
      dividers.set(key, divider);
    }
    Object.assign(divider, { path, rect, row });
    const { el } = divider;
    el.classList.toggle('tile-divider-row', row);
    el.classList.toggle('tile-divider-col', !row);
    el.hidden = hidden;
    el.style.left = row ? `calc(${pct(at)} - ${TILE_GAP}px)` : pct(rect.x);
    el.style.top = row ? pct(rect.y) : `calc(${pct(at)} - ${TILE_GAP}px)`;
    el.style.width = row ? `${TILE_GAP * 2}px` : pct(rect.width);
    el.style.height = row ? pct(rect.height) : `${TILE_GAP * 2}px`;
  }

  function startDrag(e, key) {
    const divider = dividers.get(key);
    if (e.button !== 0 || !divider || drag) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { divider, pointerId: e.pointerId, box: root.getBoundingClientRect(), ratio: null };
    try { divider.el.setPointerCapture(e.pointerId); } catch {}
    divider.el.addEventListener('pointermove', moveDrag);
    divider.el.addEventListener('pointerup', endDrag);
    divider.el.addEventListener('pointercancel', endDrag);
    root.classList.add('tile-dragging', divider.row ? 'tile-dragging-row' : 'tile-dragging-col');
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { divider, box } = drag;
    const { rect, row } = divider;
    const along = row ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height;
    const ratio = (along * 100 - (row ? rect.x : rect.y)) / (row ? rect.width : rect.height);
    if (!Number.isFinite(ratio)) return;
    current = setTileRatio(current, divider.path, ratio);
    drag.ratio = ratio;
    draw();
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const { divider, ratio, pointerId } = drag;
    drag = null;
    divider.el.removeEventListener('pointermove', moveDrag);
    divider.el.removeEventListener('pointerup', endDrag);
    divider.el.removeEventListener('pointercancel', endDrag);
    try { divider.el.releasePointerCapture(pointerId); } catch {}
    root.classList.remove('tile-dragging', 'tile-dragging-row', 'tile-dragging-col');
    if (ratio !== null && typeof onRatio === 'function') onRatio(divider.path, ratio);
  }

  draw();
  container.appendChild(root);
  return {
    root,
    update(next, { focusedId: nextFocus = focused, zoomedId: nextZoom = zoomed } = {}) {
      current = next;
      focused = nextFocus;
      zoomed = nextZoom;
      draw();
    },
    destroy() {
      if (drag) endDrag();
      root.remove();
      leaves.clear();
      dividers.clear();
    },
  };
}

/** Whether `key` is a leaf of the tree (a session id, or 'cards'). */
function tileHasLeaf(node, key) {
  if (!node) return false;
  if (tileIsSplit(node)) return tileHasLeaf(node.a, key) || tileHasLeaf(node.b, key);
  return tileIsCards(node) ? key === 'cards' : node.session === key;
}

// ---- The Session tab's panes ----

function tileViewBlocked() {
  return (typeof PROJECT_WINDOW !== 'undefined' && !!PROJECT_WINDOW)
    || (typeof gridViewActive !== 'undefined' && gridViewActive)
    || (typeof isSessionOverviewOpen === 'function' && isSessionOverviewOpen());
}

/** The layout is what the terminal area shows. */
function tileViewOnScreen() {
  const root = tileState.mount?.root;
  return !!root?.isConnected && !tileViewBlocked() && terminalArea.style.display !== 'none'
    && !!root.querySelector('.terminal-container.visible');
}

function tileSessionOf(id) {
  return sessionMap.get(id) || openSessions.get(id)?.session || null;
}

function tileSessionName(session) {
  if (typeof sessionTitle === 'function') return sessionTitle(session);
  return cleanDisplayName(session.name || session.aiTitle || session.summary) || session.sessionId;
}

function tileButton(className, title, icon, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tile-btn ${className}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = icon;
  button.addEventListener('click', e => { e.stopPropagation(); onClick(button); });
  return button;
}

function runTileAction(label, action) {
  Promise.resolve().then(action).catch(err => console.warn(`[tiles] ${label} failed:`, err));
}

/** A pane's menu (⋯ and right click on its header): Maximize, Remove from split, then the session's own. */
function tilePaneMenuItems(id) {
  const session = tileSessionOf(id);
  return [
    { label: 'Maximize', icon: TILE_ICONS.maximize(13), onClick: () => toggleTileZoom(id) },
    { label: 'Remove from split', icon: TILE_ICONS.remove(13), onClick: () => removeFromSplit(id) },
    { sep: true },
    ...(session && typeof sessionMenuItems === 'function' ? sessionMenuItems(session) : []),
  ];
}

/** The pane of session `id`, made once: renderLeaf of the Session tab's layout. */
function tilePaneFor(id) {
  const existing = tileState.panes.get(id);
  if (existing) return existing;
  const pane = createTilePane(id, {
    split: paneId => runTileAction('Split', () => splitSession(paneId)),
    maximize: toggleTileZoom,
    remove: removeFromSplit,
    menu: tilePaneMenuItems,
    focus: focusTilePane,
    focused: paneId => tileState.focusedId === paneId,
  });
  tileState.panes.set(id, pane);
  return pane;
}

/**
 * A pane for session `id`: its header (dot, name, Split, Maximize, Remove from
 * split, ⋯) over a body that takes the session's terminal container and fits
 * it once per frame, whatever resized it. `actions` says what the header and
 * the presses do: split, maximize and remove (id), menu (id: the items of ⋯
 * and of the right click), focus (id, { focusTerminal }) and focused (id:
 * whether it has the focus already). Each gets the pane's id as it is then (a
 * re-keyed pane keeps its element). The Session tab's panes, and the Session
 * Overview's docked ones (session-overview-dock.js).
 */
function createTilePane(id, actions) {
  const pane = document.createElement('div');
  pane.className = 'tile-pane';
  pane.dataset.sessionId = id;
  const paneId = () => pane.dataset.sessionId;
  const span = className => Object.assign(document.createElement('span'), { className });

  const header = document.createElement('div');
  header.className = 'tile-pane-header';
  header.append(
    span('tile-pane-dot grid-card-dot stopped'), span('tile-pane-name'), span('tile-pane-spacer'),
    tileButton('tile-btn-split', 'Split', TILE_ICONS.split(12), () => actions.split(paneId())),
    tileButton('tile-btn-max', 'Maximize', TILE_ICONS.maximize(12), () => actions.maximize(paneId())),
    tileButton('tile-btn-remove', 'Remove from split', TILE_ICONS.remove(12), () => actions.remove(paneId())),
    tileButton('tile-btn-more', 'More', TILE_ICONS.more(12), button => showContextMenu(actions.menu(paneId()), { anchor: button })),
  );
  const body = document.createElement('div');
  body.className = 'tile-pane-body';
  pane.append(header, body);

  // A press in a pane gives it the focus; on the header the terminal keeps the keys.
  pane.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const onHeader = !!e.target.closest('.tile-pane-header');
    if (onHeader) e.preventDefault();
    actions.focus(paneId(), { focusTerminal: onHeader });
  }, true);
  // Typing into a pane's terminal (Tab, a click xterm took first) makes it the one in focus.
  pane.addEventListener('focusin', e => {
    if (e.target.classList?.contains('xterm-helper-textarea') && !actions.focused(paneId())) {
      actions.focus(paneId(), { focusTerminal: false });
    }
  });
  header.addEventListener('dblclick', e => {
    if (!e.target.closest('button')) actions.maximize(paneId());
  });
  header.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(actions.menu(paneId()), { x: e.clientX, y: e.clientY });
  });

  // One fit per frame for the pane's terminal, whatever resized it.
  let frame = 0;
  pane.tileResize = new ResizeObserver(records => {
    const box = records[records.length - 1]?.contentRect;
    if (!box || box.width <= 0 || box.height <= 0 || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const entry = openSessions.get(paneId());
      if (!entry?.element?.isConnected || entry.element.parentNode !== body) return;
      try {
        const atBottom = isAtBottom(entry.terminal);
        safeFit(entry);
        if (atBottom) entry.terminal.scrollToBottom();
      } catch {}
    });
  });
  pane.tileResize.observe(body);
  return pane;
}

/**
 * The end of a pane createTilePane made: its observer stops, its terminal (if
 * still in it) goes back to #terminals as it is (still running, still .visible
 * and fitted again if it was), and the pane leaves the page.
 */
function disposeTilePane(pane) {
  pane.tileResize?.disconnect();
  const container = pane.querySelector('.tile-pane-body > .terminal-container');
  if (container) {
    container.classList.remove('tile-mode');
    terminalsEl.appendChild(container);
    const entry = openSessions.get(pane.dataset.sessionId);
    if (entry && entry.element === container && container.classList.contains('visible')) fitAndScroll(entry);
  }
  pane.remove();
}

/** A pane takes its session's terminal (back), or says it is stopped with Resume. */
function fillTilePane(id) {
  const pane = tileState.panes.get(id);
  if (!pane) return false;
  const session = tileSessionOf(id);
  const entry = openSessions.get(id);
  const body = pane.querySelector('.tile-pane-body');
  pane.querySelector('.tile-pane-name').textContent = session ? tileSessionName(session) : id;
  let moved = false;
  let stopped = body.querySelector('.tile-pane-stopped');
  if (entry) {
    stopped?.remove();
    const container = entry.element;
    if (container.parentNode !== body && !container.classList.contains('ov-mode')) {
      body.appendChild(container);
      moved = true;
    }
    container.classList.add('tile-mode');
  } else {
    // A terminal that left (destroySession took it out) leaves the pane to its state.
    if (!stopped) {
      stopped = document.createElement('div');
      stopped.className = 'tile-pane-stopped';
      stopped.innerHTML = '<span class="tile-pane-state"></span><span aria-hidden="true">·</span><button type="button" class="tile-resume-btn">Resume</button>';
      stopped.querySelector('.tile-resume-btn').addEventListener('click', e => {
        e.stopPropagation();
        resumeTilePane(pane.dataset.sessionId, e.currentTarget);
      });
      body.appendChild(stopped);
    }
  }
  pane.classList.toggle('tile-pane-closed', !entry);
  paintTilePane(id);
  return moved;
}

function paintTilePane(id) {
  const pane = tileState.panes.get(id);
  if (pane) paintTilePaneState(pane, id, tileState.zoomedId === id);
}

/** A pane's dot (busy, running, stopped), its stopped text and its Maximize's state (`zoomed`). */
function paintTilePaneState(pane, id, zoomed) {
  const running = typeof activePtyIds !== 'undefined' && activePtyIds.has(id);
  const busy = running && typeof sessionBusyState !== 'undefined' && sessionBusyState.get(id) === true;
  pane.querySelector('.tile-pane-dot').className = `tile-pane-dot grid-card-dot ${busy ? 'busy' : running ? 'running' : 'stopped'}`;
  const state = pane.querySelector('.tile-pane-state');
  if (state) state.textContent = running ? 'Running' : 'Stopped';
  pane.querySelector('.tile-btn-max').classList.toggle('active', zoomed);
}

function paintTilePanes() {
  for (const [id, pane] of tileState.panes) paintTilePaneHeader(pane, id, tileState.zoomedId === id);
}

/** A pane's header as its session is now: its name (once the session is known), then paintTilePaneState. */
function paintTilePaneHeader(pane, id, zoomed) {
  const session = tileSessionOf(id);
  if (session) pane.querySelector('.tile-pane-name').textContent = tileSessionName(session);
  paintTilePaneState(pane, id, zoomed);
}

function resumeTilePane(id, button) {
  const session = tileSessionOf(id);
  if (!session || typeof openSession !== 'function') return;
  if (button) button.disabled = true;
  // openSession ends with showSession, which brings the layout back with this pane in focus.
  Promise.resolve()
    .then(() => openSession(session))
    .catch(err => console.warn(`[tiles] Could not resume the session ${id}:`, err))
    .finally(() => { if (button) button.disabled = false; });
}

/** A pane of the Session tab leaves; its terminal keeps running (disposeTilePane). */
function releaseTilePane(id) {
  const pane = tileState.panes.get(id);
  if (!pane) return;
  tileState.panes.delete(id);
  disposeTilePane(pane);
}

function unmountTileView() {
  for (const id of [...tileState.panes.keys()]) releaseTilePane(id);
  tileState.mount?.destroy();
  tileState.mount = null;
  tileState.layoutId = null;
  tileState.tree = null;
  tileState.focusedId = null;
  tileState.zoomedId = null;
  clearInterval(tileState.dotsTimer);
  tileState.dotsTimer = 0;
}

/** Archived or unknown sessions leave a layout when it mounts; it may not survive that. */
function tileLayoutFor(id) {
  if (!isTileId(id)) return null;
  const store = tileStore();
  const layout = store.layoutOf(id, tileState.scope);
  if (!layout) return null;
  const known = sid => {
    const session = tileSessionOf(sid);
    return !!session && !session.archived;
  };
  const tree = pruneTiles(layout.tree, known);
  if (tileIds(tree).length === tileIds(layout.tree).length) return layout;
  store.set(layout.id, tree, tileState.scope);
  return store.layoutOf(id, tileState.scope);
}

/** Draws a layout in #terminals (made the first time, updated after), `focusId` in focus. */
function drawTileLayout(layout, focusId) {
  const ids = tileIds(layout.tree);
  if (tileState.zoomedId && !ids.includes(tileState.zoomedId)) tileState.zoomedId = null;
  for (const id of [...tileState.panes.keys()]) if (!ids.includes(id)) releaseTilePane(id);
  const options = { focusedId: focusId, zoomedId: tileState.zoomedId };
  if (tileState.mount?.root.isConnected) {
    tileState.mount.update(layout.tree, options);
  } else {
    tileState.mount?.destroy();
    tileState.mount = mountTileTree(terminalsEl, layout.tree, { ...options, renderLeaf: tilePaneFor, onRatio: saveTileRatio });
  }
  tileState.layoutId = layout.id;
  tileState.tree = layout.tree;
  tileState.focusedId = focusId;
  let moved = false;
  for (const id of ids) moved = fillTilePane(id) || moved;
  if (!tileState.dotsTimer) tileState.dotsTimer = setInterval(paintTilePanes, TILE_DOTS_MS);
  return moved;
}

function saveTileRatio(path, ratio) {
  const store = tileStore();
  const layout = store.all().find(l => l.id === tileState.layoutId);
  if (!layout) return;
  const tree = setTileRatio(layout.tree, path, ratio);
  store.set(layout.id, tree, layout.scope);
  tileState.tree = tree;
}

/** Draws the layout on screen again from the store (a pane left, a session stopped). */
function refreshTileView() {
  if (!tileState.mount || tileViewBlocked()) return;
  const layout = tileStore().all().find(l => l.id === tileState.layoutId);
  if (!layout) { unmountTileView(); return; }
  const ids = tileIds(layout.tree);
  const focus = ids.includes(tileState.focusedId) ? tileState.focusedId : ids.find(id => openSessions.has(id)) || ids[0];
  drawTileLayout(layout, focus);
}

/**
 * showSession's hook, in its single view, once the session's terminal is
 * .visible: shows the session's layout with its pane in focus, or the session
 * alone (the layout that was there goes, its terminals back to #terminals).
 */
function syncTileLayout(id) {
  if (tileViewBlocked()) return;
  id = tileCurrentId(id);
  const layout = tileLayoutFor(id);
  const entry = openSessions.get(id);
  let moved = false;
  if (layout) {
    moved = drawTileLayout(layout, id);
  } else if (tileState.mount) {
    moved = tileState.panes.has(id);
    unmountTileView();
  }
  // Moving the terminal into its pane, or out of it, took the keys away from it.
  if (entry && moved && !entry.element.contains(document.activeElement)) entry.terminal.focus();
  if (layout) window.terminalGpu?.touch(id);
  refreshTileHeaderButtons();
}

/**
 * The pane of `id` takes the focus without showSession: #terminal-header, the
 * file panel (setActiveSession switches it), the sidebar's row and the
 * project's remembered session follow it; the project page is not drawn again.
 * A pane with no live terminal cannot take it. True when it did.
 */
function focusTilePane(id, { focusTerminal = true } = {}) {
  id = tileCurrentId(id);
  const entry = openSessions.get(id);
  if (!entry || !tileState.panes.has(id) || tileViewBlocked()) return false;
  if (activeSessionId !== id) {
    // The layout stays on screen: the .visible terminal is the one in focus.
    const shown = [...tileState.panes.values()]
      .map(pane => pane.querySelector('.tile-pane-body > .terminal-container.visible')).find(Boolean);
    if (shown) {
      shown.classList.remove('visible');
      entry.element.classList.add('visible');
    }
    setActiveSession(id);
    clearNotifications(id);
    document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
    document.querySelector(`.session-item[data-session-id="${CSS.escape(id)}"]`)?.classList.add('active');
    const session = tileSessionOf(id) || entry.session;
    showTerminalHeader(session);
    const info = typeof projectForSession === 'function' ? projectForSession(session) : null;
    if (info && typeof rememberProjectSession === 'function') {
      rememberProjectSession(info.project, id);
      if (typeof saveProjectsUi === 'function') saveProjectsUi();
    }
    if (typeof refreshProjectDrawers === 'function') refreshProjectDrawers();
  }
  tileState.focusedId = id;
  tileState.mount?.update(tileState.tree, { focusedId: id, zoomedId: tileState.zoomedId });
  window.terminalGpu?.touch(id);
  refreshTileHeaderButtons();
  if (focusTerminal) entry.terminal.focus();
  return true;
}

/** Maximize: the pane fills the layout (tmux's zoom), again to put it back. */
function toggleTileZoom(id) {
  id = tileCurrentId(id);
  if (!tileState.mount || !tileState.panes.has(id) || tileViewBlocked()) return false;
  tileState.zoomedId = tileState.zoomedId === id ? null : id;
  tileState.mount.update(tileState.tree, { focusedId: tileState.focusedId, zoomedId: tileState.zoomedId });
  for (const paneId of tileState.panes.keys()) paintTilePane(paneId);
  if (tileState.zoomedId) focusTilePane(id);
  return true;
}

/** The ids of the subtree beside session `id` (the one that takes its place when it leaves). */
function tileSiblingIds(node, id) {
  if (!tileIsSplit(node)) return [];
  if (!tileIsSplit(node.a) && !tileIsCards(node.a) && node.a.session === id) return tileIds(node.b);
  if (!tileIsSplit(node.b) && !tileIsCards(node.b) && node.b.session === id) return tileIds(node.a);
  return [...tileSiblingIds(node.a, id), ...tileSiblingIds(node.b, id)];
}

/** The live pane that takes the focus when `id` leaves or stops: beside it first. */
function tileFocusAfter(tree, id) {
  const live = sid => sid !== id && openSessions.has(sid);
  return tileSiblingIds(tree, id).find(live) || tileIds(tree).find(live) || null;
}

/**
 * Takes session `id` out of its layout; the session keeps running. A layout
 * left with one session goes, and that session shows alone. `seen` is what was
 * on screen before (an exit is handled once the terminal is already gone).
 */
function takeOutOfSplit(id, { onScreen, focused }) {
  id = tileCurrentId(id);
  const store = tileStore();
  const layout = store.layoutOf(id, tileState.scope);
  if (!layout) return false;
  const next = focused ? tileFocusAfter(layout.tree, id) : null;
  store.set(layout.id, removeTile(layout.tree, id), tileState.scope);
  if (tileState.layoutId !== layout.id || tileViewBlocked()) return true;
  if (tileState.zoomedId === id) tileState.zoomedId = null;
  releaseTilePane(id);
  // The pane beside it takes the focus; with none live, the session itself stays in sight, alone.
  if (onScreen && next) { showSession(next); return true; }
  refreshTileView();
  if (onScreen) openSessions.get(activeSessionId)?.terminal.focus();
  return true;
}

/** "Remove from split": the session leaves the layout and keeps running. */
function removeFromSplit(id) {
  return takeOutOfSplit(id, { onScreen: tileViewOnScreen(), focused: tileState.focusedId === tileCurrentId(id) });
}

function newTileLayoutId() {
  return 'layout-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
}

/** The rect a split of `id` halves: its pane's, or its terminal's when it is shown alone. */
function tileTargetRect(id) {
  return tileRectOf(tileState.panes.get(id) || openSessions.get(id)?.element);
}

/** An element's rect on screen, as the model takes it; undefined while it is not laid out. */
function tileRectOf(el) {
  const box = el?.isConnected ? el.getBoundingClientRect() : null;
  return box && box.width > 0 && box.height > 0 ? { x: box.left, y: box.top, width: box.width, height: box.height } : undefined;
}

/**
 * splitSession's default place: the new session goes beside `targetId` in its
 * layout of `scope` (one is made for a session shown alone), then takes the
 * focus, as any session started from here does.
 */
function placeTileSplit(targetId, newId, { direction = 'auto', scope = tileState.scope } = {}) {
  targetId = tileCurrentId(targetId);
  newId = tileCurrentId(newId);
  if (!isTileId(targetId) || !isTileId(newId) || targetId === newId) return false;
  const store = tileStore();
  const layout = store.layoutOf(targetId, scope);
  const tree = splitTile(layout ? layout.tree : { session: targetId }, targetId, newId, { rect: tileTargetRect(targetId), direction });
  store.set(layout ? layout.id : newTileLayoutId(), tree, scope);
  if (scope !== tileState.scope) return true;
  if (layout && layout.id === tileState.layoutId) tileState.zoomedId = null;
  showSession(newId);
  return true;
}

// ---- Keys: Cmd/Ctrl+Alt+Arrows move the focus between panes ----

const TILE_KEY_DIRECTIONS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function isTileFocusKey(e) {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && e.altKey && !e.shiftKey && !!TILE_KEY_DIRECTIONS[e.key];
}

/** The next live pane that way; stopped panes are passed over. */
function moveTileFocus(dir) {
  if (!tileState.tree || !tileState.focusedId) return false;
  if (tileState.zoomedId) toggleTileZoom(tileState.zoomedId);
  const whole = { x: 0, y: 0, width: 100, height: 100 };
  let from = tileState.focusedId;
  for (let step = 0; step < tileState.panes.size; step++) {
    const next = tileNeighbor(tileState.tree, whole, from, dir);
    if (!next) return false;
    if (openSessions.has(next)) return focusTilePane(next);
    from = next;
  }
  return false;
}

function onTileKeydown(e) {
  if (!isTileFocusKey(e) || !tileViewOnScreen()) return;
  // Only from the layout itself (or nowhere in particular), not from an editor beside it.
  if (e.target !== document.body && !tileState.mount.root.contains(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  moveTileFocus(TILE_KEY_DIRECTIONS[e.key]);
}

// ---- #terminal-header: Split and Open in new window ----

function installTileHeaderButtons() {
  const controls = document.getElementById('terminal-header-controls');
  if (!controls || tileState.headerSplit) return;
  const button = (id, title, icon, onClick) => {
    const el = document.createElement('button');
    el.id = id;
    el.type = 'button';
    el.title = title;
    el.setAttribute('aria-label', title);
    el.innerHTML = icon;
    el.hidden = true;
    el.addEventListener('click', onClick);
    return el;
  };
  tileState.headerSplit = button('terminal-split-btn', 'Split', TILE_ICONS.split(15), () => {
    if (tileHeaderSession()) runTileAction('Split', () => splitSession(activeSessionId));
  });
  tileState.headerPopOut = button('terminal-popout-btn', 'Open in new window', typeof ICONS !== 'undefined' ? ICONS.popOut(15) : '', () => {
    if (tileHeaderSession() && typeof popOutSession === 'function') popOutSession(activeSessionId);
  });
  const stop = document.getElementById('terminal-stop-btn');
  controls.insertBefore(tileState.headerSplit, stop || null);
  controls.insertBefore(tileState.headerPopOut, stop || null);
  // A task log uses the same header: the buttons follow what it shows.
  const id = document.getElementById('terminal-header-id');
  if (id) new MutationObserver(refreshTileHeaderButtons).observe(id, { childList: true, characterData: true, subtree: true });
  refreshTileHeaderButtons();
}

/** The session #terminal-header stands for, or null (a task log, nothing). */
function tileHeaderSession() {
  if (typeof activeTaskView !== 'undefined' && activeTaskView) return null;
  return activeSessionId ? tileSessionOf(activeSessionId) : null;
}

function refreshTileHeaderButtons() {
  if (!tileState.headerSplit) return;
  const session = tileHeaderSession();
  tileState.headerSplit.hidden = !session || !!session.archived;
  tileState.headerPopOut.hidden = !session || typeof popOutSession !== 'function';
}

// ---- Events: re-keys, exits, busy ----

/** Codex's real id, or a fork's: the layouts, the launch spec and the pane follow it. */
function rekeyTile(oldId, newId) {
  if (!isTileId(oldId) || !isTileId(newId) || oldId === newId) return;
  tileState.rekeys.set(oldId, newId);
  while (tileState.rekeys.size > 50) tileState.rekeys.delete(tileState.rekeys.keys().next().value);
  tileStore().rekey(oldId, newId);
  if (typeof rekeyLaunchSpec === 'function') rekeyLaunchSpec(oldId, newId);
  const pane = tileState.panes.get(oldId);
  if (pane && !tileState.panes.has(newId)) {
    tileState.panes.delete(oldId);
    tileState.panes.set(newId, pane);
    pane.dataset.sessionId = newId;
  }
  if (tileState.focusedId === oldId) tileState.focusedId = newId;
  if (tileState.zoomedId === oldId) tileState.zoomedId = newId;
  if (tileState.tree && tileHasLeaf(tileState.tree, oldId)) refreshTileView();
  // app.js writes the new id into #terminal-header even when another pane has the focus.
  if (activeSessionId !== newId && tileState.panes.has(activeSessionId) && tileViewOnScreen()) {
    const active = tileSessionOf(activeSessionId);
    if (active) showTerminalHeader(active);
  }
  refreshTileHeaderButtons();
}

/**
 * After app.js has handled the exit: a plain terminal, or a session that never
 * started (both gone from sessionMap), leaves its pane and the pane beside it
 * takes the space. A stopped CLI keeps its pane as "Stopped · Resume"; one that
 * died keeps its terminal behind the exit banner. When the pane was the one in
 * focus on screen, the live pane beside it takes the focus.
 */
function onTileProcessExited(id, seen) {
  if (!isTileId(id)) return;
  if (!sessionMap.has(id)) {
    takeOutOfSplit(id, seen);
    // Gone for good: out of the layouts of every scope too (a session's window).
    tileStore().forget(id);
    return;
  }
  const layout = tileStore().layoutOf(id, tileState.scope);
  if (!layout || layout.id !== tileState.layoutId) return;
  refreshTileView();
  if (seen.onScreen && seen.focused && !openSessions.has(id)) {
    const next = tileFocusAfter(layout.tree, id);
    if (next) showSession(next);
  }
}

if (typeof window !== 'undefined' && window.api && !(typeof PROJECT_WINDOW !== 'undefined' && PROJECT_WINDOW)) {
  // Registered before app.js's own listeners: what was on screen is read now,
  // and the layout changes once app.js has dealt with the event.
  const later = fn => setTimeout(fn, 0);
  window.api.onSessionDetected((tempId, realId) => later(() => rekeyTile(tempId, realId)));
  window.api.onSessionForked((oldId, newId) => later(() => rekeyTile(oldId, newId)));
  window.api.onProcessExited(sessionId => {
    const seen = { onScreen: tileViewOnScreen(), focused: tileState.focusedId === sessionId };
    later(() => onTileProcessExited(sessionId, seen));
  });
  window.api.onCliBusyState(sessionId => {
    if (tileState.panes.has(sessionId)) later(() => paintTilePane(sessionId));
  });
  window.addEventListener('keydown', onTileKeydown, true);
  document.addEventListener('DOMContentLoaded', installTileHeaderButtons, { once: true });
}
