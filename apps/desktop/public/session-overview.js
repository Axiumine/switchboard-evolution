// --- Session Overview ---
// A page of its own in the main area, never under a project's header: every
// open session as a card holding its live terminal, laid out, filtered, sorted
// and grouped as overview.prefs.v1 says (session-overview-model.js decides,
// this file draws). The terminal containers move into the cards while the page
// is open and go back to #terminals when it closes.
//
// The files shared with upstream reach it through one-line hooks guarded with
// typeof: hideViewerPanels (plans-memory-view.js), hideProjectChrome
// (projects-view.js) and showStatsPage (app.js) close it, toggleGridView
// (grid-view.js) toggles it, and app.js calls onAppRestored once the terminals
// are back after a start. showSession is replaced on DOMContentLoaded, as
// project-window.js does: while the page is open, a session shown from
// elsewhere opens "normally", in its project's Session tab.
//
// Never in a project window or a session window: there the page does not open,
// showSession stays as it is and onAppRestored does nothing.
//
// Depends on: buildOverview, layoutGeometry, pageSlice, createOverviewLifecycle,
// loadOverviewPrefs, saveOverviewPrefs, normalizeOverviewPrefs, OVERVIEW_*
// (session-overview-model.js); SESSION_STATUS_FILTERS, SESSION_PIN_FILTERS,
// sessionFolderLabel (session-list.js); openSessions, sessionMap,
// cachedAllProjects, cachedProjectTreeAll, activePtyIds, attentionSessions,
// responseReadySessions, sessionBusyState, sessionEventTime, activeSessionId,
// activeTab, visibleSessionCount, sessionMaxAgeDays, pendingSessions,
// terminalsEl, terminalArea, placeholder, setActiveSession, clearNotifications,
// confirmAndStopSession, updateRunningIndicators (app.js); gridCards,
// isTextEditingTarget (grid-view.js); fitAndScroll, isMac (terminal-manager.js);
// isSessionRunning (sidebar.js); projectForSession, projectRootLabel,
// sessionTitle, sessionMenuItems, showContextMenu, showProjectHome, PICONS
// (projects-view.js); hideAllViewers (plans-memory-view.js); ICONS (icons.js).

const OV_GAP = 14; // the cards' gap, as in session-overview.css and layoutGeometry
const OV_GROUP_GAP = 8; // between a group's header and its cards, as in session-overview.css
const OV_REFRESH_MS = 30000; // the cards' times move on
const OV_MIN_CARD_HEIGHT = 120;

const OV_ICONS = {
  split: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
  maximize: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
  stop: '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>',
  openInProject: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
};

// The page's choices: layout, filters, sort and groups (the Sessions tab sets
// them). The model's script comes after this one, so they are read on
// DOMContentLoaded, or at first use.
let overviewPrefs = null;
// Set by onAppRestored: until then the Sessions tab does not open the page, so a
// start does not draw cards before the terminals are back.
let sessionOverviewReady = false;

const ovState = {
  root: null, // #session-overview while open
  cardsEl: null, // .ov-cards
  cards: new Map(), // terminal entry -> its card (an entry outlives a re-keyed id)
  groupEls: new Map(), // group key -> .ov-group
  entryByContainer: new Map(), // terminal container -> entry, for the resize observer
  page: 0,
  pages: 1,
  pageOf: new Map(), // card id -> its page, from the last render
  order: [], // the drawn cards' ids, in order, every page
  previousOrder: null, // group key -> card ids of the last render (the model keeps places)
  previousGroups: undefined, // the group keys of the last render
  maximized: null, // the entry whose card fills the page
  adopted: new Set(), // ids whose next showSession focuses them here (overviewAdopt)
  bornHere: new WeakSet(), // entries whose terminal was made while the page was open
  layout: null, // what the last render drew, for the layout pass
  originalShowSession: null,
  terminalsObserver: null,
  cardsObserver: null,
  resizeObserver: null,
  timer: null,
  frame: 0,
};

function sessionOverviewUnavailable() {
  return (typeof PROJECT_WINDOW !== 'undefined' && !!PROJECT_WINDOW)
    || (typeof SESSION_WINDOW !== 'undefined' && !!SESSION_WINDOW);
}

function ensureOverviewPrefs() {
  if (!overviewPrefs) overviewPrefs = loadOverviewPrefs(localStorage);
  return overviewPrefs;
}

// Made at the first open, like the prefs (the model comes after this file).
let overviewLifecycle = null;

function isSessionOverviewOpen() {
  return !!overviewLifecycle && overviewLifecycle.isOpen();
}

/** Show the page. Opening it hides every other page, which asks it to close: the lifecycle ignores that. */
function openSessionOverview() {
  if (sessionOverviewUnavailable() || isSessionOverviewOpen()) return;
  overviewLifecycle ||= createOverviewLifecycle({ mount: mountSessionOverview, unmount: unmountSessionOverview });
  overviewLifecycle.open();
}

/** `reason`: 'page' (another page took the main area), 'session' (a session opens normally). */
function closeSessionOverview(reason) {
  overviewLifecycle?.close(reason);
}

/** Cmd/Ctrl+Shift+G and the old grid's button: open the focused session normally, or come to the page. */
function toggleSessionOverview() {
  if (sessionOverviewUnavailable()) return;
  if (isSessionOverviewOpen()) {
    openSessionNormally(activeSessionId && openSessions.has(activeSessionId) ? activeSessionId : null);
    return;
  }
  document.querySelector('.sidebar-tab[data-tab="sessions"]')?.click();
  openSessionOverview();
}

/**
 * Leave the page the way every session opens from outside it: the Projects
 * tab, on the session's project and its Session tab. A session with no project
 * opens on its own, as it always did.
 */
function openSessionNormally(id) {
  closeSessionOverview('session');
  document.querySelector('.sidebar-tab[data-tab="projects"]')?.click();
  if (id) (ovState.originalShowSession || showSession)(id);
  else if (typeof showProjectHome === 'function') showProjectHome();
}

/** The next showSession of this id focuses its card here instead of leaving (a session resumed from the page). */
function overviewAdopt(id) {
  if (id) ovState.adopted.add(id);
}

function refreshSessionOverview({ resort = false } = {}) {
  if (!isSessionOverviewOpen()) return;
  renderSessionOverview({ resort });
}

/** Change some choices: they are normalized, saved and drawn. A new sort or grouping puts the cards in its order. */
function setOverviewPrefs(patch) {
  const before = ensureOverviewPrefs();
  overviewPrefs = normalizeOverviewPrefs(mergeOverviewPrefs(overviewPrefs, patch));
  saveOverviewPrefs(localStorage, overviewPrefs);
  if (overviewPrefs.layout.mode !== before.layout.mode) ovState.page = 0;
  const resort = !!patch && ('sort' in patch || overviewPrefs.group.by !== before.group.by);
  refreshSessionOverview({ resort });
}

/** Prefs with a patch over them, one level deep (`dock` is a tree and is replaced whole). */
function mergeOverviewPrefs(prefs, patch) {
  const merged = { ...prefs };
  for (const [key, value] of Object.entries(patch || {})) {
    const nested = key !== 'dock' && value && typeof value === 'object' && !Array.isArray(value)
      && prefs[key] && typeof prefs[key] === 'object';
    merged[key] = nested ? { ...prefs[key], ...value } : value;
  }
  return merged;
}

// ---- Mount and unmount ----

function mountSessionOverview() {
  if (typeof leaveTaskLogView === 'function') leaveTaskLogView();
  // Reaches closeSessionOverview('page') through hideViewerPanels: ignored while mounting.
  hideAllViewers();
  terminalArea.style.display = 'none';
  placeholder.style.display = 'none';

  const root = document.createElement('div');
  root.id = 'session-overview';
  root.innerHTML = `
    <div class="ov-header">
      <span class="ov-title">Session Overview</span>
      <span class="ov-count"></span>
      <div class="ov-chips"></div>
      <div class="ov-pager" hidden>
        <button type="button" class="ov-pager-prev" title="Previous page" aria-label="Previous page">&lsaquo;</button>
        <span class="ov-pager-label"></span>
        <button type="button" class="ov-pager-next" title="Next page" aria-label="Next page">&rsaquo;</button>
      </div>
      <button type="button" class="ov-new-btn" hidden>+ New session</button>
    </div>
    <div class="ov-body"><div class="ov-cards"></div></div>`;
  document.getElementById('main').appendChild(root);
  ovState.root = root;
  ovState.cardsEl = root.querySelector('.ov-cards');
  root.querySelector('.ov-pager-prev').addEventListener('click', () => turnOverviewPage(-1));
  root.querySelector('.ov-pager-next').addEventListener('click', () => turnOverviewPage(1));
  const newBtn = root.querySelector('.ov-new-btn');
  newBtn.addEventListener('click', () => {
    if (typeof showOverviewNewSession === 'function') showOverviewNewSession(newBtn);
  });

  // New terminals get a card; a card whose session closed (destroySession) leaves its place.
  ovState.terminalsObserver = new MutationObserver(records => {
    if (noteNewTerminals(records)) refreshSessionOverview();
  });
  ovState.terminalsObserver.observe(terminalsEl, { childList: true });
  ovState.cardsObserver = new MutationObserver(records => {
    if (records.some(r => [...r.removedNodes].some(n => n.classList?.contains('ov-card')))) scheduleOverviewRefresh();
  });
  // The page's size sets the cards' size; a card's size sets its terminal's.
  ovState.resizeObserver = new ResizeObserver(records => {
    for (const record of records) {
      if (record.target === ovState.cardsEl) { layoutSessionOverview(); continue; }
      const entry = ovState.entryByContainer.get(record.target);
      if (entry && record.contentRect.width > 0 && record.contentRect.height > 0) fitAndScroll(entry);
    }
  });
  ovState.resizeObserver.observe(ovState.cardsEl);
  ovState.timer = setInterval(() => refreshSessionOverview(), OV_REFRESH_MS);
  window.addEventListener('keydown', onOverviewKeydown, true);
  document.getElementById('grid-toggle-btn')?.classList.add('active');

  renderSessionOverview();
  // The page that holds the session in focus.
  const page = ovState.pageOf.get(activeSessionId);
  if (page !== undefined && page !== ovState.page) {
    ovState.page = page;
    renderSessionOverview();
  }
  const focusId = activeSessionId;
  if (focusId && gridCards.get(focusId)?.isConnected) {
    requestAnimationFrame(() => {
      if (isSessionOverviewOpen() && activeSessionId === focusId) selectOverviewCard(focusId);
    });
  }
}

function unmountSessionOverview() {
  window.removeEventListener('keydown', onOverviewKeydown, true);
  clearInterval(ovState.timer);
  ovState.timer = null;
  cancelAnimationFrame(ovState.frame);
  ovState.frame = 0;
  ovState.terminalsObserver?.disconnect();
  ovState.cardsObserver?.disconnect();
  ovState.resizeObserver?.disconnect();
  ovState.terminalsObserver = ovState.cardsObserver = ovState.resizeObserver = null;
  // Every terminal goes back where the single view and the project pages look for it.
  for (const [entry, card] of ovState.cards) releaseOverviewCard(entry, card);
  ovState.cards.clear();
  ovState.groupEls.clear();
  ovState.entryByContainer.clear();
  ovState.root?.remove();
  ovState.root = ovState.cardsEl = null;
  ovState.maximized = null;
  ovState.adopted.clear();
  ovState.bornHere = new WeakSet();
  ovState.layout = null;
  document.getElementById('grid-toggle-btn')?.classList.remove('active');
}

/** Terminals made while the page is open (createTerminalEntry adds them to #terminals); true when there are some. */
function noteNewTerminals(records) {
  const added = records.flatMap(r => [...r.addedNodes]).filter(n => n.classList?.contains('terminal-container'));
  for (const entry of openSessions.values()) if (added.includes(entry.element)) ovState.bornHere.add(entry);
  return added.length > 0;
}

function scheduleOverviewRefresh() {
  if (ovState.frame) return;
  ovState.frame = requestAnimationFrame(() => {
    ovState.frame = 0;
    refreshSessionOverview();
  });
}

// ---- What the model is given ----

const OV_WORKTREE_PATH = /^(.+?)\/\.claude\/worktrees\/([^/]+)\/?$/;

function overviewFolderLabel(projectPath) {
  if (!projectPath) return 'No folder';
  const rootLabel = typeof projectRootLabel === 'function' ? projectRootLabel(projectPath) : null;
  return sessionFolderLabel(projectPath, rootLabel) || projectPath;
}

/** A session's folder for grouping: a worktree is a group of its own, "folder · worktree name". */
function overviewFolderOf(session) {
  const projectPath = session.projectPath || '';
  const worktree = projectPath.match(OV_WORKTREE_PATH);
  if (worktree) return { key: projectPath, label: `${overviewFolderLabel(worktree[1])} · worktree ${worktree[2]}` };
  return { key: projectPath, label: overviewFolderLabel(projectPath) };
}

function overviewProjectOf(session) {
  const info = typeof projectForSession === 'function' ? projectForSession(session) : null;
  return info ? { id: info.project.id, name: info.project.name } : null;
}

/** Every session known, once: the folders' lists, and any open terminal they do not hold yet. */
function overviewSessions() {
  const seen = new Set();
  const sessions = [];
  const add = session => {
    if (!session?.sessionId || seen.has(session.sessionId)) return;
    seen.add(session.sessionId);
    sessions.push(session);
  };
  for (const folder of cachedAllProjects || []) for (const session of folder.sessions || []) add(session);
  for (const [id, entry] of openSessions) add(sessionMap.get(id) || entry.session);
  return sessions;
}

function overviewContext({ resort }) {
  return {
    // A terminal still mounted is open, also behind its exit banner: the app keeps
    // a session that died (or failed to start) on screen so its error can be read.
    // It is not running, though.
    isOpen: id => openSessions.has(id),
    isRunning: id => isSessionRunning(id) && !openSessions.get(id)?.closed,
    needsInput: id => attentionSessions.has(id),
    isBusy: id => sessionBusyState.get(id) === true,
    isResponseReady: id => responseReadySessions.has(id),
    timeOf: session => sessionEventTime(session),
    folderOf: overviewFolderOf,
    projectOf: overviewProjectOf,
    searchIds: null,
    leftOut: new Set(),
    excludeIds: new Set(),
    previousOrder: resort ? null : ovState.previousOrder,
    previousGroups: resort ? undefined : ovState.previousGroups,
    resort,
    expanded: new Set(),
    visibleCount: visibleSessionCount,
    maxAgeDays: sessionMaxAgeDays,
    now: Date.now(),
  };
}

// ---- Render ----

function renderSessionOverview({ resort = false } = {}) {
  if (!ovState.root) return;
  // Terminals made since the observer last ran; the moves below are this page's own.
  if (ovState.terminalsObserver) noteNewTerminals(ovState.terminalsObserver.takeRecords());
  const prefs = ensureOverviewPrefs();
  const model = buildOverview(overviewSessions(), prefs, overviewContext({ resort }));
  // Places are kept for every card the model gave, drawn or not.
  ovState.previousOrder = new Map(model.groups.map(group => [group.key, group.cards.map(card => card.id)]));
  ovState.previousGroups = model.groups.map(group => group.key);

  const grouped = prefs.group.by !== 'none';
  const carousels = grouped && prefs.group.display === 'carousels';
  const paged = prefs.layout.mode === 'grid-fit' && !carousels;
  const collapsed = new Set(grouped ? prefs.group.collapsed : []);
  // Only live cards here: the cards of closed sessions are drawn by task 6.
  const groups = model.groups
    .map(group => ({ ...group, cards: group.cards.filter(card => card.live && openSessions.has(card.id)) }))
    .filter(group => group.cards.length > 0);

  // Pages: the cards of open groups, in order, perPage at a time. A collapsed
  // group shows its header on the page its place falls on.
  const flat = [];
  for (const group of groups) {
    if (!collapsed.has(group.key)) for (const card of group.cards) flat.push(card);
  }
  const perPage = prefs.layout.cols * prefs.layout.rows;
  ovState.pages = paged ? layoutGeometry(prefs.layout, { width: 1, height: 1, count: flat.length }).pages : 1;
  ovState.page = Math.min(Math.max(0, ovState.page), ovState.pages - 1);
  const onPage = new Set(paged ? pageSlice(flat, ovState.page, perPage) : flat);
  ovState.pageOf = new Map(flat.map((card, i) => [card.id, paged ? Math.floor(i / perPage) : 0]));
  ovState.order = flat.map(card => card.id);

  const shown = [];
  let index = 0;
  for (const group of groups) {
    if (collapsed.has(group.key)) {
      const groupPage = paged ? Math.min(Math.floor(index / perPage), ovState.pages - 1) : 0;
      if (groupPage === ovState.page) shown.push({ group, cards: [], collapsed: true });
      continue;
    }
    index += group.cards.length;
    const cards = group.cards.filter(card => onPage.has(card));
    if (cards.length) shown.push({ group, cards, collapsed: false });
  }

  drawOverviewHeader(model, paged);
  drawOverviewCards(shown, { grouped, carousels, prefs });
  ovState.layout = { shown, grouped, carousels, paged };
  layoutSessionOverview();
  // The moves above are this page's own, not news.
  ovState.terminalsObserver?.takeRecords();
  ovState.cardsObserver?.takeRecords();
  updateRunningIndicators();
}

function drawOverviewHeader(model, paged) {
  const root = ovState.root;
  root.querySelector('.ov-count').textContent =
    `${model.total} session${model.total === 1 ? '' : 's'} · ${model.running} running`;
  const chips = root.querySelector('.ov-chips');
  chips.replaceChildren(...overviewFilterChips().map(({ label, clear }) => {
    const chip = document.createElement('span');
    chip.className = 'ov-filter-chip';
    chip.textContent = label;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ov-filter-chip-clear';
    remove.title = `Remove the filter ${label}`;
    remove.setAttribute('aria-label', `Remove the filter ${label}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => setOverviewPrefs({ filters: clear }));
    chip.appendChild(remove);
    return chip;
  }));
  const pager = root.querySelector('.ov-pager');
  pager.hidden = !paged || ovState.pages <= 1;
  pager.querySelector('.ov-pager-label').textContent = `${ovState.page + 1} / ${ovState.pages}`;
  pager.querySelector('.ov-pager-prev').disabled = ovState.page === 0;
  pager.querySelector('.ov-pager-next').disabled = ovState.page >= ovState.pages - 1;
  root.querySelector('.ov-new-btn').hidden = typeof showOverviewNewSession !== 'function';
}

/** The filters that hide sessions, as chips: a label, and the filter values that take each one off. */
function overviewFilterChips() {
  const f = overviewPrefs.filters;
  const labelIn = (list, value) => (list.find(([key]) => key === value) || [])[1] || value;
  const chips = [];
  if (f.status !== 'all') chips.push({ label: labelIn(SESSION_STATUS_FILTERS, f.status), clear: { status: 'all' } });
  if (f.pinned !== 'all') chips.push({ label: labelIn(SESSION_PIN_FILTERS, f.pinned), clear: { pinned: 'all' } });
  for (const cli of f.clis) {
    chips.push({ label: OVERVIEW_CLI_LABELS[cli] || cli, clear: { clis: f.clis.filter(c => c !== cli) } });
  }
  if (f.period !== 'any') chips.push({ label: labelIn(OVERVIEW_PERIODS, f.period), clear: { period: 'any' } });
  if (f.place) {
    const label = f.place.kind === 'folder'
      ? overviewFolderLabel(f.place.path)
      : (cachedProjectTreeAll?.projects || []).find(p => p.id === f.place.id)?.name || 'Project';
    chips.push({ label, clear: { place: null } });
  }
  return chips;
}

function drawOverviewCards(shown, { grouped, carousels, prefs }) {
  const cardsEl = ovState.cardsEl;
  const mode = prefs.layout.mode;
  // Layouts that scroll across lay their groups side by side, as Down carousels do.
  const across = carousels ? prefs.group.axis === 'down' : (mode === 'grid-across' || mode === 'columns');
  cardsEl.className = [
    'ov-cards', `ov-layout-${mode}`,
    grouped ? 'ov-grouped' : '',
    carousels ? `ov-carousels ov-axis-${prefs.group.axis} ${prefs.group.fit ? 'ov-fit' : 'ov-scroll'}` : '',
    across ? 'ov-flow-across' : 'ov-flow-down',
  ].filter(Boolean).join(' ');

  const used = new Set();
  const groupEls = [];
  for (const { group, cards, collapsed } of shown) {
    const groupEl = ensureOverviewGroup(group, { grouped, collapsed });
    groupEls.push(groupEl);
    const list = groupEl.querySelector('.ov-group-cards');
    cards.forEach((card, i) => {
      const cardEl = ensureOverviewCard(card, prefs);
      used.add(cardEl);
      if (list.children[i] !== cardEl) list.insertBefore(cardEl, list.children[i] || null);
    });
    while (list.children.length > cards.length) list.lastElementChild.remove();
    ovState.cardsObserver?.observe(list, { childList: true });
  }
  // Groups in order, and the ones gone off the page removed.
  groupEls.forEach((groupEl, i) => {
    if (cardsEl.children[i] !== groupEl) cardsEl.insertBefore(groupEl, cardsEl.children[i] || null);
  });
  for (const child of [...cardsEl.children]) if (!groupEls.includes(child)) child.remove();
  for (const [key, groupEl] of ovState.groupEls) if (!groupEl.isConnected) ovState.groupEls.delete(key);
  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ov-empty';
    empty.textContent = overviewFiltersActive(prefs) ? 'No open session matches the filters.' : 'No open sessions.';
    cardsEl.appendChild(empty);
  }

  // Cards not drawn now give their terminal back to #terminals.
  for (const [entry, card] of [...ovState.cards]) {
    if (used.has(card)) continue;
    releaseOverviewCard(entry, card);
    ovState.cards.delete(entry);
  }
  if (ovState.maximized && !ovState.cards.has(ovState.maximized)) ovState.maximized = null;
  const focused = gridCards.get(activeSessionId);
  for (const card of ovState.cards.values()) card.classList.toggle('focused', card === focused);
}

function ensureOverviewGroup(group, { grouped, collapsed }) {
  let groupEl = ovState.groupEls.get(group.key);
  if (!groupEl) {
    groupEl = document.createElement('div');
    groupEl.className = 'ov-group';
    groupEl.dataset.groupKey = group.key;
    const header = document.createElement('div');
    header.className = 'ov-group-header';
    header.innerHTML = '<span class="ov-group-arrow">&#9660;</span><span class="ov-group-name"></span><span class="ov-group-count"></span>';
    header.addEventListener('click', () => toggleOverviewGroup(group.key));
    const list = document.createElement('div');
    list.className = 'ov-group-cards';
    groupEl.append(header, list);
    ovState.groupEls.set(group.key, groupEl);
  }
  const header = groupEl.querySelector('.ov-group-header');
  header.hidden = !grouped;
  header.title = group.path || group.label;
  groupEl.querySelector('.ov-group-name').textContent = group.label;
  groupEl.querySelector('.ov-group-count').textContent = String(group.cards.length);
  groupEl.classList.toggle('collapsed', collapsed);
  return groupEl;
}

function toggleOverviewGroup(key) {
  const collapsed = ensureOverviewPrefs().group.collapsed;
  setOverviewPrefs({ group: { collapsed: collapsed.includes(key) ? collapsed.filter(k => k !== key) : [...collapsed, key] } });
}

// ---- Cards ----

function ensureOverviewCard(card, prefs) {
  const entry = openSessions.get(card.id);
  let cardEl = ovState.cards.get(entry);
  if (!cardEl) {
    cardEl = buildOverviewCard(entry);
    ovState.cards.set(entry, cardEl);
  }
  // A re-keyed session (Codex, a fork) keeps its entry and card under its new id.
  if (cardEl.dataset.sessionId !== card.id) {
    if (gridCards.get(cardEl.dataset.sessionId) === cardEl) gridCards.delete(cardEl.dataset.sessionId);
    cardEl.dataset.sessionId = card.id;
    const improve = cardEl.querySelector('.grid-card-improve-btn');
    if (improve) improve.dataset.sessionId = card.id;
  }
  // In gridCards, the running dot, Stop, Improve and destroySession keep it up to date.
  gridCards.set(card.id, cardEl);
  const container = entry.element;
  if (container.parentNode !== cardEl) {
    container.classList.remove('visible');
    container.classList.add('ov-mode');
    cardEl.insertBefore(container, cardEl.querySelector('.grid-card-footer'));
    ovState.entryByContainer.set(container, entry);
    ovState.resizeObserver?.observe(container);
    fitAndScroll(entry);
  }

  const session = card.session;
  cardEl.querySelector('.grid-card-name').textContent = sessionTitle(session);
  const folder = cardEl.querySelector('.ov-chip-folder');
  folder.textContent = overviewFolderOf(session).label;
  folder.title = session.projectPath || '';
  const project = overviewProjectOf(session);
  const projectChip = cardEl.querySelector('.ov-chip-project');
  projectChip.textContent = project?.name || '';
  projectChip.hidden = !project || prefs.group.by === 'project' || project.name === folder.textContent;
  cardEl.querySelector('.grid-card-footer').children[1].textContent = formatDate(new Date(card.sortTime || session.modified));
  return cardEl;
}

/** Back to #terminals, out of view: no ov-mode, no visible. */
function releaseOverviewCard(entry, card) {
  const container = entry.element;
  ovState.resizeObserver?.unobserve(container);
  ovState.entryByContainer.delete(container);
  if (container.parentNode === card) {
    container.classList.remove('ov-mode', 'visible');
    terminalsEl.appendChild(container);
  }
  if (gridCards.get(card.dataset.sessionId) === card) gridCards.delete(card.dataset.sessionId);
  card.remove();
  if (ovState.maximized === entry) ovState.maximized = null;
}

function overviewHeaderButton(className, title, icon, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = icon;
  button.addEventListener('click', e => { e.stopPropagation(); onClick(button); });
  return button;
}

/**
 * A card with the grid view's classes and buttons (grid-view.js wrapInGridCard),
 * so the code that updates those finds it, and the overview's own: Open in new
 * window and Split (shown once their tasks provide them), Maximize and ⋯.
 */
function buildOverviewCard(entry) {
  const idOf = () => entry.session.sessionId;
  const sessionOf = () => sessionMap.get(idOf()) || entry.session;
  const session = sessionOf();

  const card = document.createElement('div');
  card.className = 'grid-card ov-card';
  card.dataset.sessionId = idOf();

  const span = className => Object.assign(document.createElement('span'), { className });
  const header = document.createElement('div');
  header.className = 'grid-card-header ov-card-header';
  header.append(span('grid-card-dot'), span('grid-card-name'), span('ov-chip ov-chip-folder'),
    span('ov-chip ov-chip-project'), span('ov-card-spacer'));

  // The session's Commands palette (command-catalog-view.js) and the prompt improver.
  if (typeof sessionHasCommandCatalog === 'function' && sessionHasCommandCatalog(session)) {
    header.appendChild(overviewHeaderButton('grid-card-commands-btn', 'Commands', ICONS.commands(12), button => {
      if (commandPalette && commandPalette.anchor === button) { closeCommandPalette(); return; }
      selectOverviewCard(idOf());
      openCommandPalette({ anchor: button });
    }));
  }
  if (typeof sessionCanImprove === 'function' && session.type !== 'terminal') {
    const improve = overviewHeaderButton('grid-card-improve-btn', 'Improve prompt', ICONS.sparkle(12), button => {
      selectOverviewCard(idOf());
      openPromptImprover({ anchor: button });
    });
    improve.dataset.sessionId = idOf();
    improve.style.display = sessionCanImprove(session) ? '' : 'none';
    header.appendChild(improve);
  }
  const popOut = overviewHeaderButton('ov-btn ov-btn-window', 'Open in new window', ICONS.popOut(12), () => {
    if (typeof popOutSession === 'function') popOutSession(idOf());
  });
  popOut.hidden = typeof popOutSession !== 'function';
  const split = overviewHeaderButton('ov-btn ov-btn-split', 'Split', OV_ICONS.split, () => {
    if (typeof dockInOverview === 'function') dockInOverview(idOf());
  });
  split.hidden = typeof dockInOverview !== 'function';
  const maximize = overviewHeaderButton('ov-btn ov-btn-max', 'Maximize', OV_ICONS.maximize, () => toggleOverviewMaximize(idOf()));
  const stop = overviewHeaderButton('grid-card-stop-btn', 'Stop session', OV_ICONS.stop, () => confirmAndStopSession(idOf()));
  stop.style.display = activePtyIds.has(idOf()) ? '' : 'none';
  const more = overviewHeaderButton('ov-btn ov-btn-more', 'More', PICONS.dots(12), button => {
    showContextMenu(overviewCardMenuItems(sessionOf()), { anchor: button });
  });
  header.append(popOut, split, maximize, stop, more);

  const footer = document.createElement('div');
  footer.className = 'grid-card-footer';
  footer.append(span(''), span(''));
  card.append(header, footer);

  // A click on the header or footer focuses the session; keep the terminal's focus over the click's.
  const focusOnPress = e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    selectOverviewCard(idOf());
  };
  header.addEventListener('mousedown', focusOnPress);
  footer.addEventListener('mousedown', focusOnPress);
  header.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    openSessionNormally(idOf());
  });
  header.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(overviewCardMenuItems(sessionOf()), { x: e.clientX, y: e.clientY });
  });
  // Typing into a card's terminal makes it the session in focus.
  card.addEventListener('focusin', e => {
    if (e.target.classList?.contains('xterm-helper-textarea') && activeSessionId !== idOf()) {
      selectOverviewCard(idOf(), { focusTerminal: false });
    }
  });
  return card;
}

/** The menu of a card (right click on its header, and ⋯). */
function overviewCardMenuItems(session) {
  const id = session?.sessionId;
  if (!id) return [];
  return [
    { label: 'Open in project', icon: OV_ICONS.openInProject, onClick: () => openSessionNormally(id) },
    { label: 'Maximize', icon: OV_ICONS.maximize, onClick: () => toggleOverviewMaximize(id) },
    { sep: true },
    ...(typeof sessionMenuItems === 'function' ? sessionMenuItems(session) : []),
  ];
}

// ---- Focus, Maximize, pages ----

/** Make a card the session in focus without leaving the page. */
function selectOverviewCard(id, { focusTerminal = true } = {}) {
  const card = gridCards.get(id);
  if (!id || !card || !ovState.root?.contains(card)) return;
  setActiveSession(id);
  clearNotifications(id);
  document.querySelectorAll('.session-item.active').forEach(el => el.classList.remove('active'));
  document.querySelector(`.session-item[data-session-id="${CSS.escape(id)}"]`)?.classList.add('active');
  for (const other of ovState.cards.values()) other.classList.toggle('focused', other === card);
  if (!ovState.maximized) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focusTerminal) openSessions.get(id)?.terminal.focus();
}

/** Focus a session's card, turning to its page; a session just started gets its card first. */
function overviewFocus(id) {
  if (!id || !isSessionOverviewOpen()) return;
  if (!ovState.root.contains(gridCards.get(id) || null)) {
    renderSessionOverview();
    const page = ovState.pageOf.get(id);
    if (page !== undefined && page !== ovState.page) {
      ovState.page = page;
      renderSessionOverview();
    }
  }
  if (ovState.root.contains(gridCards.get(id) || null)) {
    selectOverviewCard(id);
  } else {
    // Not on the page (filtered out): it is still the session in focus.
    setActiveSession(id);
    clearNotifications(id);
  }
}

/** The card fills the page's body; again, or Esc, puts it back. */
function toggleOverviewMaximize(id) {
  const card = gridCards.get(id);
  const entry = openSessions.get(id);
  if (!card || !entry || !ovState.root?.contains(card)) return;
  const wasMaximized = ovState.maximized === entry;
  for (const other of ovState.cards.values()) {
    other.classList.remove('ov-maximized');
    other.querySelector('.ov-btn-max')?.classList.remove('active');
  }
  ovState.maximized = wasMaximized ? null : entry;
  card.classList.toggle('ov-maximized', !wasMaximized);
  card.querySelector('.ov-btn-max').classList.toggle('active', !wasMaximized);
  // The card is the session in focus; the keys stay where they are, so Esc can put it back.
  selectOverviewCard(id, { focusTerminal: false });
}

function turnOverviewPage(step) {
  const page = Math.min(Math.max(0, ovState.page + step), ovState.pages - 1);
  if (page === ovState.page) return false;
  ovState.page = page;
  renderSessionOverview();
  return true;
}

// ---- Layout ----

/** The cards' size for the space the page has now (CSS variables on .ov-cards). */
function layoutSessionOverview() {
  const el = ovState.cardsEl;
  const drawn = ovState.layout;
  if (!el || !drawn) return;
  const prefs = overviewPrefs.layout;
  const style = getComputedStyle(el);
  const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (width <= 0 || height <= 0) return;
  // A group's header, and the gap under it when its cards show.
  const headerHeight = drawn.grouped ? el.querySelector('.ov-group-header')?.offsetHeight || 0 : 0;
  const header = drawn.grouped ? headerHeight + OV_GROUP_GAP : 0;
  const count = drawn.shown.reduce((n, item) => n + item.cards.length, 0);
  let cardWidth = prefs.cardWidth;
  let cardHeight = prefs.cardHeight;
  let cols = prefs.cols;
  let rows = prefs.rows;
  if (drawn.carousels) {
    // Carousels keep the card size; with Fit their cards share the carousel instead (CSS).
  } else if (prefs.mode === 'grid-fit') {
    // The page holds every card it has, headers included: its rows share what
    // the headers leave. The gaps between groups count as gaps between rows; a
    // collapsed group adds one, and no gap under its header.
    const rowsUsed = drawn.grouped
      ? Math.max(1, drawn.shown.reduce((n, item) => n + Math.ceil(item.cards.length / prefs.cols), 0))
      : prefs.rows;
    const space = drawn.shown.reduce(
      (left, item) => left - (item.collapsed ? headerHeight + OV_GAP : header), height);
    const geometry = layoutGeometry({ ...prefs, rows: rowsUsed }, { width, height: space, count, gap: OV_GAP });
    cardHeight = Math.max(OV_MIN_CARD_HEIGHT, geometry.cardHeight);
    cardWidth = geometry.cardWidth;
  } else {
    const across = prefs.mode === 'grid-across' || prefs.mode === 'columns';
    const geometry = layoutGeometry(prefs, { width, height: across ? height - header : height, count, gap: OV_GAP });
    cols = geometry.cols;
    rows = geometry.rows;
    cardWidth = geometry.cardWidth;
    cardHeight = Math.max(OV_MIN_CARD_HEIGHT, geometry.cardHeight);
  }
  el.style.setProperty('--ov-cols', String(Math.max(1, cols)));
  el.style.setProperty('--ov-rows', String(Math.max(1, rows)));
  el.style.setProperty('--ov-card-w', `${Math.max(1, cardWidth)}px`);
  el.style.setProperty('--ov-card-h', `${cardHeight}px`);
}

// ---- Keys ----

/** Cmd/Ctrl+Arrows move between cards, Cmd/Ctrl+Shift+[ ] go through them in order, Esc ends Maximize. */
function onOverviewKeydown(e) {
  if (!isSessionOverviewOpen()) return;
  const target = e.target;
  const inTerminal = !!target?.closest?.('.terminal-container');
  if (e.key === 'Escape') {
    // A terminal keeps its Esc: the CLIs use it to interrupt.
    if (!ovState.maximized || inTerminal || isTextEditingTarget(target)) return;
    if (typeof openCtxMenu !== 'undefined' && openCtxMenu) return;
    if (target !== document.body && !ovState.root.contains(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = ovState.maximized.session.sessionId;
    toggleOverviewMaximize(id);
    return;
  }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return;
  // Text fields keep Cmd+Arrows for their cursor; a terminal's own textarea does not.
  if (isTextEditingTarget(target) && !target.classList.contains('xterm-helper-textarea')) return;
  const arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (!e.shiftKey && arrows[e.key]) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!ovState.maximized) navigateOverview(arrows[e.key]);
    return;
  }
  if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!ovState.maximized) cycleOverview(e.code === 'BracketLeft' ? -1 : 1);
  }
}

/** grid-view.js navigateGrid, over the page's cards: the nearest card that way; past the edge, the next page. */
function navigateOverview(direction) {
  const cards = [...ovState.root.querySelectorAll('.ov-card')];
  if (cards.length === 0) return;
  const idOfCard = card => card.dataset.sessionId;
  const current = gridCards.get(activeSessionId);
  if (!current || !cards.includes(current)) { overviewFocus(idOfCard(cards[0])); return; }
  const cur = current.getBoundingClientRect();
  const curX = cur.left + cur.width / 2;
  const curY = cur.top + cur.height / 2;
  let best = null;
  let bestDist = Infinity;
  for (const card of cards) {
    if (card === current) continue;
    const r = card.getBoundingClientRect();
    const dx = r.left + r.width / 2 - curX;
    const dy = r.top + r.height / 2 - curY;
    const valid = { left: dx < -10, right: dx > 10, up: dy < -10, down: dy > 10 }[direction];
    if (!valid) continue;
    const dist = direction === 'left' || direction === 'right' ? Math.abs(dy) * 3 + Math.abs(dx) : Math.abs(dx) * 3 + Math.abs(dy);
    if (dist < bestDist) { bestDist = dist; best = card; }
  }
  if (best) { overviewFocus(idOfCard(best)); return; }
  const forward = direction === 'right' || direction === 'down';
  if (turnOverviewPage(forward ? 1 : -1)) {
    const onPage = [...ovState.root.querySelectorAll('.ov-card')];
    const next = forward ? onPage[0] : onPage[onPage.length - 1];
    if (next) overviewFocus(idOfCard(next));
  }
}

function cycleOverview(step) {
  const ids = ovState.order;
  if (ids.length === 0) return;
  const index = ids.indexOf(activeSessionId);
  overviewFocus(index === -1 ? ids[0] : ids[(index + step + ids.length) % ids.length]);
}

// ---- Start, and sessions shown from elsewhere ----

/** The end of the app's start (app.js): the terminals are back, so the Sessions tab may open the page. */
function onAppRestored() {
  if (sessionOverviewUnavailable()) return;
  sessionOverviewReady = true;
  if (activeTab !== 'sessions' || (typeof activeTaskView !== 'undefined' && activeTaskView)) return;
  // The active session may still be resuming: when it shows, it shows here.
  if (activeSessionId && !openSessions.has(activeSessionId)) overviewAdopt(activeSessionId);
  openSessionOverview();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureOverviewPrefs();
    if (sessionOverviewUnavailable()) return;
    // Every script has run: callers look showSession up when they call it.
    const original = window.showSession;
    ovState.originalShowSession = original;
    window.showSession = function showSessionOverOverview(sessionId, ...rest) {
      if (!isSessionOverviewOpen()) return original(sessionId, ...rest);
      // A session resumed from the page, or just started while it is open, stays
      // on it. (Plain terminals stay pending for good: only one made just now counts.)
      const entry = sessionId ? openSessions.get(sessionId) : null;
      const justStarted = pendingSessions.has(sessionId) && !!entry && ovState.bornHere.has(entry);
      if (sessionId && (ovState.adopted.has(sessionId) || justStarted)) {
        ovState.adopted.delete(sessionId);
        return overviewFocus(sessionId);
      }
      return openSessionNormally(sessionId);
    };
  }, { once: true });
}
