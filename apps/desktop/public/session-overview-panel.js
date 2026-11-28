// --- Session Overview controls: the Sessions tab ---
// The Sessions tab lists no sessions any more. Selecting it opens the Session
// Overview (session-overview.js), and its sidebar holds the page's controls in
// #overview-panel, top to bottom: the buttons, the search, which sessions, the
// filters, the sort, the groups and the layout. Every choice goes through
// setOverviewPrefs, which normalizes it, saves it in overview.prefs.v1 and
// draws the page. The Projects tab keeps its list.
//
// The search finds sessions by title and folder name from the first character,
// and with "Search in messages" by what their messages say, from 3 characters
// (window.api.searchSessions). The page shows what it found (overviewSearch),
// minus what was left out of this search (overviewLeftOut, which the card menu
// fills).
//
// The files shared with upstream reach it through one-line hooks guarded with
// typeof: the tab handler (app.js) calls showOverviewTab for the Sessions tab
// and hides #overview-panel for the others, refreshSidebar (app.js) ends with
// refreshOverviewTab, and showAddProjectDialog (dialogs.js) takes { onAdded }.
// Never in a project window or a session window.
//
// Depends on: ensureOverviewPrefs, setOverviewPrefs, refreshSessionOverview,
// openSessionOverview, isSessionOverviewOpen, sessionOverviewReady,
// sessionOverviewUnavailable, overviewSessions, overviewLastResults,
// overviewFolderOf, overviewFolderLabel, overviewProjectOf
// (session-overview.js); overviewDefaults, overviewFiltersActive,
// OVERVIEW_* (session-overview-model.js); SESSION_STATUS_FILTERS,
// SESSION_PIN_FILTERS (session-list.js); sessionTitleMatches
// (search-results.js); activeTab, sessionFilters, searchBar, sidebarContent,
// restoreTerminalArea, refreshSidebar, sessionMap, openSessions,
// sessionBusyState, cachedProjects, cachedAllProjects, cachedProjectTree,
// cachedProjectTreeAll, sessionEventTime (app.js); showAddProjectDialog,
// showNewSessionPopover (dialogs.js); newSessionItems, showContextMenu,
// projectListGroups, isProjectSnoozed, projectSortTime, confirmStopWork,
// stopRunningWork, PICONS (projects-view.js); encodeProjectPath (utils.js).
// Most of these come from scripts loaded after this one, and overviewPrefs is
// null until DOMContentLoaded: nothing here runs before then.

const OVP_SEARCH_DEBOUNCE_MS = 200;
// As the message index (a trigram): shorter queries find nothing in messages.
const OVP_MESSAGE_SEARCH_MIN = 3;
// The "+ New session" menu: the projects and the recent folders it lists.
const OVP_MENU_PROJECTS = 12;
const OVP_MENU_FOLDERS = 6;

// The search on the page: { query, ids: Set of session ids }, or null.
let overviewSearch = null;
// Sessions left out of this search; a new query starts with none.
const overviewLeftOut = new Set();

const ovPanel = {
  el: null, // #overview-panel once built
  timer: 0, // the search field's debounce
  seq: 0, // the latest search: one finishing after it is dropped
  clis: null, // the switched-on CLIs' ids, once main has said (getHarnesses)
  cliKey: '', // the CLI boxes drawn, to draw them again only when they change
  placeKey: '', // the same for the Place options
  frame: 0, // slider moves, drawn once a frame
  sliders: {},
};

// ---- The tab ----

/** The Sessions tab: the controls in the sidebar, and the page, once the app is restored after a start. */
function showOverviewTab() {
  if (sessionOverviewUnavailable()) return;
  showOverviewSidebar();
  // During a start the tab shows what it always did: onAppRestored opens the
  // page once the terminals are back.
  if (sessionOverviewReady) openSessionOverview();
  else restoreTerminalArea();
}

/** The panel in place of the list, its combos and the search field the other tabs share. */
function showOverviewSidebar() {
  const el = document.getElementById('overview-panel');
  if (!el) return;
  sessionFilters.style.display = 'none';
  searchBar.style.display = 'none';
  sidebarContent.style.display = 'none';
  el.hidden = false;
  renderOverviewPanel();
  loadOverviewClis();
}

function overviewPanelShown() {
  const el = document.getElementById('overview-panel');
  return !!el && !el.hidden;
}

/** refreshSidebar's last step: the sessions or their state moved, so the page and the panel are drawn again. */
function refreshOverviewTab() {
  refreshSessionOverview();
  refreshOverviewPanel();
}

/** The panel drawn again when it is in sight (setOverviewPrefs calls it too: a choice made on the page). */
function refreshOverviewPanel() {
  if (overviewPanelShown()) renderOverviewPanel();
}

function loadOverviewClis() {
  const api = typeof window !== 'undefined' ? window.api : null;
  if (typeof api?.getHarnesses !== 'function') return;
  api.getHarnesses().then(list => {
    ovPanel.clis = (list || []).filter(h => h.enabled).map(h => h.id);
    refreshOverviewPanel();
  }).catch(() => {});
}

// ---- Search ----

/**
 * The sessions a query finds: by title or folder name always, and with
 * "Search in messages" by what their messages say, from 3 characters.
 * `searchMessages(query, { which, n })` resolves to ids.
 */
async function overviewSearchIds(query, { sessions, folderOf, search, searchMessages }) {
  const q = String(query || '').trim();
  const ids = new Set();
  if (!q) return ids;
  const lower = q.toLowerCase();
  for (const session of sessions) {
    const folder = String(folderOf(session)?.label || '').toLowerCase();
    if (sessionTitleMatches(session, q) || folder.includes(lower)) ids.add(session.sessionId);
  }
  if (search.inMessages && q.length >= OVP_MESSAGE_SEARCH_MIN && typeof searchMessages === 'function') {
    let hits = [];
    try { hits = await searchMessages(q, { which: search.which, n: search.n }); } catch {}
    for (const id of hits || []) ids.add(id);
  }
  return ids;
}

/** Search the page for `query`; an empty one ends the search. A search that ends after a later one is dropped. */
async function runOverviewSearch(query) {
  const q = String(query || '').trim();
  const seq = ++ovPanel.seq;
  if (!q) { setOverviewSearch(null); return; }
  const api = typeof window !== 'undefined' ? window.api : null;
  const ids = await overviewSearchIds(q, {
    sessions: overviewSessions(),
    folderOf: overviewFolderOf,
    search: ensureOverviewPrefs().search,
    searchMessages: typeof api?.searchSessions === 'function' ? (text, options) => api.searchSessions(text, options) : null,
  });
  if (seq !== ovPanel.seq) return;
  setOverviewSearch({ query: q, ids });
}

function setOverviewSearch(next) {
  // A new query starts with nothing left out; the same query keeps what was.
  if ((next?.query ?? null) !== (overviewSearch?.query ?? null)) overviewLeftOut.clear();
  overviewSearch = next;
  refreshOverviewTab();
}

/** The search again, now: "Search in messages", First / Last / All or N changed. */
function rerunOverviewSearch() {
  clearTimeout(ovPanel.timer);
  const input = ovPanel.el?.querySelector('.ovp-search-input');
  if (input && input.value.trim()) runOverviewSearch(input.value);
}

/**
 * "N results" and "Stop N running", from what the page's last render counted
 * (overviewLastResults): its total, as the page's header says, and its running
 * cards once each. Null without a render (the page closed).
 */
function overviewSearchSummary(results) {
  if (!results) return null;
  return { count: results.total, running: new Set(results.runningIds).size };
}

/** Stop every running session the search shows on the page, after one confirmation. */
async function stopOverviewResults() {
  const results = overviewLastResults();
  if (!overviewSearch || !results) return;
  const sessions = [...new Set(results.runningIds)]
    .map(id => sessionMap.get(id) || openSessions.get(id)?.session).filter(Boolean);
  if (!sessions.length) return;
  const busy = sessions.filter(s => sessionBusyState.get(s.sessionId) === true);
  const running = { sessions, tasks: [], busy };
  if (!await confirmStopWork(null, running, { where: `matching "${overviewSearch.query}"` })) return;
  await stopRunningWork(running);
  refreshSidebar();
}

// ---- Choices the controls offer ----

/** The CLIs the filter offers: the switched-on ones (all of them until main says), Terminal, and any already chosen. */
function overviewCliChoices(enabled, chosen) {
  return OVERVIEW_CLIS.filter(cli => cli === 'terminal' || !enabled || enabled.includes(cli) || chosen.includes(cli));
}

/** The Place options: the projects and folders that hold sessions, by name, and the place chosen even when it holds none now. */
function overviewPlaceChoices(place) {
  const projects = new Map();
  const folders = new Map();
  for (const session of overviewSessions()) {
    const folder = overviewFolderOf(session);
    if (folder.key && !folders.has(folder.key)) folders.set(folder.key, folder.label);
    const project = overviewProjectOf(session);
    if (project && !projects.has(project.id)) projects.set(project.id, project.name);
  }
  if (place?.kind === 'folder' && !folders.has(place.path)) folders.set(place.path, overviewFolderLabel(place.path));
  if (place?.kind === 'project' && !projects.has(place.id)) {
    projects.set(place.id, (cachedProjectTreeAll?.projects || []).find(p => p.id === place.id)?.name || 'Project');
  }
  const byLabel = (a, b) => a[1].localeCompare(b[1]);
  return {
    projects: [...projects].sort(byLabel).map(([id, label]) => [`project:${id}`, label]),
    folders: [...folders].sort(byLabel).map(([path, label]) => [`folder:${path}`, label]),
  };
}

function overviewPlaceValue(place) {
  if (place?.kind === 'folder') return `folder:${place.path}`;
  if (place?.kind === 'project') return `project:${place.id}`;
  return 'all';
}

function overviewPlaceFromValue(value) {
  if (value.startsWith('folder:')) return { kind: 'folder', path: value.slice(7) };
  if (value.startsWith('project:')) return { kind: 'project', id: value.slice(8) };
  return null;
}

// ---- The panel ----

const OVP_TEMPLATE = `
  <div class="ovp-actions">
    <button type="button" class="ovp-btn ovp-open" aria-pressed="false" title="Show the Session Overview">Session Overview</button>
    <div class="ovp-row">
      <button type="button" class="ovp-btn ovp-new" title="Start a session">+ New session</button>
      <button type="button" class="ovp-btn ovp-add" title="Add a folder, then start a session in it">Add folder</button>
      <button type="button" class="ovp-btn ovp-resort" title="Put the cards in the chosen order">Re-sort</button>
    </div>
  </div>
  <section class="ovp-section">
    <div class="ovp-title">Search</div>
    <div class="ovp-search-field">
      <input type="text" class="ovp-search-input" placeholder="Search sessions..." aria-label="Search sessions" spellcheck="false" autocomplete="off">
      <button type="button" class="ovp-search-clear" aria-label="Clear search" title="Clear search" hidden>&times;</button>
    </div>
    <div class="ovp-row ovp-messages-row">
      <label class="ovp-check"><input type="checkbox" class="ovp-in-messages"><span>Search in messages</span></label>
      <select class="session-filter-select ovp-which" aria-label="Which messages" title="Which messages to search"></select>
      <input type="number" class="ovp-number ovp-n" aria-label="How many messages" title="How many messages">
    </div>
    <div class="ovp-results" hidden>
      <span class="ovp-results-count"></span>
      <button type="button" class="ovp-small-btn ovp-restore" title="Bring back what was left out of this search" hidden></button>
      <button type="button" class="ovp-small-btn ovp-stop" title="Stop the running sessions the search shows" hidden></button>
    </div>
  </section>
  <section class="ovp-section">
    <div class="ovp-title">Sessions</div>
    <label class="ovp-check"><input type="checkbox" class="ovp-include-closed"><span>Include closed</span></label>
    <label class="ovp-check ovp-archived-check"><input type="checkbox" class="ovp-show-archived"><span>Show archived</span></label>
  </section>
  <section class="ovp-section">
    <div class="ovp-title">Filter</div>
    <label class="ovp-field"><span>Status</span><select class="session-filter-select ovp-status"></select></label>
    <label class="ovp-field"><span>Pinned</span><select class="session-filter-select ovp-pinned"></select></label>
    <div class="ovp-field"><span>CLI</span><div class="ovp-clis" role="group" aria-label="CLI"></div></div>
    <label class="ovp-field"><span>Period</span><select class="session-filter-select ovp-period"></select></label>
    <label class="ovp-field"><span>Place</span><select class="session-filter-select ovp-place"></select></label>
    <button type="button" class="ovp-link ovp-reset-filters">Reset filters</button>
  </section>
  <section class="ovp-section">
    <div class="ovp-title">Sort</div>
    <div class="ovp-row">
      <select class="session-filter-select ovp-sort" aria-label="Sort by"></select>
      <button type="button" class="ovp-icon-btn ovp-dir" title="Reverse order" aria-label="Reverse order" aria-pressed="false">&uarr;&darr;</button>
    </div>
  </section>
  <section class="ovp-section">
    <div class="ovp-title">Group</div>
    <select class="session-filter-select ovp-group" aria-label="Group by"></select>
    <div class="ovp-seg" data-pref="display" role="group" aria-label="Groups as">
      <button type="button" data-value="sections">Sections</button><button type="button" data-value="carousels">Carousels</button>
    </div>
    <div class="ovp-seg" data-pref="axis" role="group" aria-label="Carousels go">
      <button type="button" data-value="across">Across</button><button type="button" data-value="down">Down</button>
    </div>
    <div class="ovp-seg" data-pref="fit" role="group" aria-label="Cards in a carousel">
      <button type="button" data-value="fit">Fit</button><button type="button" data-value="scroll">Scroll</button>
    </div>
  </section>
  <section class="ovp-section">
    <div class="ovp-title">Layout</div>
    <select class="session-filter-select ovp-layout" aria-label="Layout"></select>
    <label class="ovp-field ovp-cols-field"><span>Columns</span><input type="number" class="ovp-number ovp-cols"></label>
    <label class="ovp-field ovp-rows-field"><span>Rows</span><input type="number" class="ovp-number ovp-rows"></label>
    <label class="ovp-field"><span>Card width</span><span class="ovp-slider"><input type="range" class="ovp-card-width" step="10"><output class="ovp-card-width-value"></output></span></label>
    <label class="ovp-field"><span>Card height</span><span class="ovp-slider"><input type="range" class="ovp-card-height" step="10"><output class="ovp-card-height-value"></output></span></label>
    <button type="button" class="ovp-link ovp-reset-view">Reset view</button>
  </section>`;

/** Draw the panel: built the first time, then each control set from the prefs, the CLIs and places known, and the results bar. */
function renderOverviewPanel() {
  const el = document.getElementById('overview-panel');
  if (!el) return;
  if (ovPanel.el !== el) buildOverviewPanel(el);
  syncOverviewPanel();
}

function fillOverviewSelect(select, list) {
  select.replaceChildren(...list.map(([value, label]) => new Option(label, value)));
}

function buildOverviewPanel(el) {
  ovPanel.el = el;
  el.innerHTML = OVP_TEMPLATE;
  const q = selector => el.querySelector(selector);
  const prefs = () => ensureOverviewPrefs();
  // setOverviewPrefs draws the page, then the panel (refreshOverviewPanel).
  const change = patch => setOverviewPrefs(patch);

  fillOverviewSelect(q('.ovp-which'), [['first', 'First'], ['last', 'Last'], ['all', 'All']]);
  fillOverviewSelect(q('.ovp-status'), SESSION_STATUS_FILTERS);
  fillOverviewSelect(q('.ovp-pinned'), SESSION_PIN_FILTERS);
  fillOverviewSelect(q('.ovp-period'), OVERVIEW_PERIODS);
  fillOverviewSelect(q('.ovp-sort'), OVERVIEW_SORTS);
  fillOverviewSelect(q('.ovp-group'), OVERVIEW_GROUPS);
  fillOverviewSelect(q('.ovp-layout'), OVERVIEW_LAYOUTS);
  const limits = { '.ovp-n': 'n', '.ovp-cols': 'cols', '.ovp-rows': 'rows', '.ovp-card-width': 'cardWidth', '.ovp-card-height': 'cardHeight' };
  for (const [selector, key] of Object.entries(limits)) {
    q(selector).min = String(OVERVIEW_LIMITS[key][0]);
    q(selector).max = String(OVERVIEW_LIMITS[key][1]);
  }

  // Buttons.
  q('.ovp-open').addEventListener('click', () => { if (sessionOverviewReady) openSessionOverview(); });
  q('.ovp-new').addEventListener('click', e => showOverviewNewSession(e.currentTarget));
  const addButton = q('.ovp-add');
  addButton.addEventListener('click', () => showAddProjectDialog({
    // A folder with no session would not show on the page: go on to start one.
    onAdded: projectPath => showNewSessionPopover(overviewFolderFor(projectPath), addButton),
  }));
  q('.ovp-resort').addEventListener('click', () => refreshSessionOverview({ resort: true }));

  // Search.
  const input = q('.ovp-search-input');
  const clear = q('.ovp-search-clear');
  const searchNow = () => { clearTimeout(ovPanel.timer); runOverviewSearch(input.value); };
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(ovPanel.timer);
    ovPanel.timer = setTimeout(() => runOverviewSearch(input.value), OVP_SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchNow();
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      clear.hidden = true;
      searchNow();
    }
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    searchNow();
    input.focus();
  });
  q('.ovp-in-messages').addEventListener('change', e => { change({ search: { inMessages: e.target.checked } }); rerunOverviewSearch(); });
  q('.ovp-which').addEventListener('change', e => { change({ search: { which: e.target.value } }); rerunOverviewSearch(); });
  onOverviewNumber(q('.ovp-n'), () => prefs().search.n, n => { change({ search: { n } }); rerunOverviewSearch(); });
  q('.ovp-restore').addEventListener('click', () => { overviewLeftOut.clear(); refreshOverviewTab(); });
  q('.ovp-stop').addEventListener('click', () => stopOverviewResults());

  // Sessions.
  q('.ovp-include-closed').addEventListener('change', e => change({ includeClosed: e.target.checked }));
  q('.ovp-show-archived').addEventListener('change', e => change({ showArchived: e.target.checked }));

  // Filter.
  q('.ovp-status').addEventListener('change', e => change({ filters: { status: e.target.value } }));
  q('.ovp-pinned').addEventListener('change', e => change({ filters: { pinned: e.target.value } }));
  q('.ovp-clis').addEventListener('change', () => {
    const clis = [...el.querySelectorAll('.ovp-clis input:checked')].map(box => box.value);
    change({ filters: { clis } });
  });
  q('.ovp-period').addEventListener('change', e => change({ filters: { period: e.target.value } }));
  q('.ovp-place').addEventListener('change', e => change({ filters: { place: overviewPlaceFromValue(e.target.value) } }));
  q('.ovp-reset-filters').addEventListener('click', () => change({ filters: overviewDefaults().filters }));

  // Sort: desc is each sort's own order (newest first, A to Z), asc reverses it.
  q('.ovp-sort').addEventListener('change', e => change({ sort: { by: e.target.value } }));
  q('.ovp-dir').addEventListener('click', () => change({ sort: { dir: prefs().sort.dir === 'asc' ? 'desc' : 'asc' } }));

  // Group.
  q('.ovp-group').addEventListener('change', e => change({ group: { by: e.target.value } }));
  for (const seg of el.querySelectorAll('.ovp-seg')) {
    seg.addEventListener('click', e => {
      const value = e.target.closest('button')?.dataset.value;
      if (!value) return;
      const key = seg.dataset.pref;
      change({ group: { [key]: key === 'fit' ? value === 'fit' : value } });
    });
  }

  // Layout.
  q('.ovp-layout').addEventListener('change', e => change({ layout: { mode: e.target.value } }));
  onOverviewNumber(q('.ovp-cols'), () => prefs().layout.cols, cols => change({ layout: { cols } }));
  onOverviewNumber(q('.ovp-rows'), () => prefs().layout.rows, rows => change({ layout: { rows } }));
  onOverviewSlider(q('.ovp-card-width'), 'cardWidth');
  onOverviewSlider(q('.ovp-card-height'), 'cardHeight');
  q('.ovp-reset-view').addEventListener('click', () => change({ layout: overviewDefaults().layout }));
}

/** A number field: kept in its limits (normalizeOverviewPrefs clamps it), and what was saved shown; anything but a number puts the saved one back. */
function onOverviewNumber(input, saved, apply) {
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(value)) apply(value);
    input.value = String(saved());
  });
}

/** A card size slider: its number follows the thumb, and the page follows once a frame. */
function onOverviewSlider(input, key) {
  input.addEventListener('input', () => {
    ovPanel.sliders[key] = Number(input.value);
    input.parentElement.querySelector('output').textContent = `${input.value} px`;
    if (ovPanel.frame) return;
    ovPanel.frame = requestAnimationFrame(() => {
      ovPanel.frame = 0;
      const layout = ovPanel.sliders;
      ovPanel.sliders = {};
      setOverviewPrefs({ layout });
    });
  });
}

/** Each control as the prefs say, the ones that do nothing now hidden or switched off. */
function syncOverviewPanel() {
  const el = ovPanel.el;
  if (!el) return;
  const prefs = ensureOverviewPrefs();
  const q = selector => el.querySelector(selector);
  const setValue = (input, value) => { if (document.activeElement !== input) input.value = String(value); };
  const setPressed = (button, on) => { button.setAttribute('aria-pressed', String(on)); button.classList.toggle('active', on); };

  syncOverviewOpenButton();

  // Search.
  const { inMessages, which, n } = prefs.search;
  q('.ovp-in-messages').checked = inMessages;
  q('.ovp-which').value = which;
  q('.ovp-which').hidden = !inMessages;
  setValue(q('.ovp-n'), n);
  q('.ovp-n').hidden = !inMessages || which === 'all';

  // Sessions: archived ones are closed ones, so Show archived waits for Include closed.
  q('.ovp-include-closed').checked = prefs.includeClosed;
  q('.ovp-show-archived').checked = prefs.showArchived;
  q('.ovp-show-archived').disabled = !prefs.includeClosed;
  q('.ovp-archived-check').classList.toggle('disabled', !prefs.includeClosed);

  // Filter.
  const f = prefs.filters;
  const setChoice = (select, value, on) => { select.value = value; select.classList.toggle('is-on', on); };
  setChoice(q('.ovp-status'), f.status, f.status !== 'all');
  setChoice(q('.ovp-pinned'), f.pinned, f.pinned !== 'all');
  setChoice(q('.ovp-period'), f.period, f.period !== 'any');
  syncOverviewClis(f.clis);
  syncOverviewPlaces(f.place);
  q('.ovp-reset-filters').disabled = !overviewFiltersActive(prefs);

  // Sort.
  q('.ovp-sort').value = prefs.sort.by;
  setPressed(q('.ovp-dir'), prefs.sort.dir === 'asc');

  // Group: how groups look only matters with groups; axis and fit only for carousels.
  const g = prefs.group;
  const grouped = g.by !== 'none';
  const carousels = grouped && g.display === 'carousels';
  q('.ovp-group').value = g.by;
  const segValue = { display: g.display, axis: g.axis, fit: g.fit ? 'fit' : 'scroll' };
  for (const seg of el.querySelectorAll('.ovp-seg')) {
    const key = seg.dataset.pref;
    seg.hidden = key === 'display' ? !grouped : !carousels;
    for (const button of seg.querySelectorAll('button')) setPressed(button, button.dataset.value === segValue[key]);
  }

  // Layout: the numbers each layout uses; a card size the layout sets itself is switched off.
  const l = prefs.layout;
  q('.ovp-layout').value = l.mode;
  setValue(q('.ovp-cols'), l.cols);
  setValue(q('.ovp-rows'), l.rows);
  q('.ovp-cols-field').hidden = !['grid-fit', 'grid-down'].includes(l.mode);
  q('.ovp-rows-field').hidden = !['grid-fit', 'grid-across'].includes(l.mode);
  const sizes = {
    '.ovp-card-width': [l.cardWidth, carousels || ['grid-across', 'columns'].includes(l.mode)],
    '.ovp-card-height': [l.cardHeight, carousels || ['grid-down', 'rows'].includes(l.mode)],
  };
  for (const [selector, [value, used]] of Object.entries(sizes)) {
    const slider = q(selector);
    if (document.activeElement !== slider) {
      slider.value = String(value);
      slider.parentElement.querySelector('output').textContent = `${value} px`;
    }
    slider.disabled = !used;
    slider.closest('.ovp-field').classList.toggle('disabled', !used);
    slider.title = used ? '' : 'This layout sizes the cards to the page';
  }

  syncOverviewResults();
}

function syncOverviewOpenButton() {
  const button = ovPanel.el?.querySelector('.ovp-open');
  if (!button) return;
  const open = isSessionOverviewOpen();
  button.setAttribute('aria-pressed', String(open));
  button.classList.toggle('active', open);
}

function syncOverviewClis(chosen) {
  const choices = overviewCliChoices(ovPanel.clis, chosen);
  const box = ovPanel.el.querySelector('.ovp-clis');
  const key = choices.join(',');
  if (key !== ovPanel.cliKey) {
    ovPanel.cliKey = key;
    box.replaceChildren(...choices.map(cli => {
      const label = document.createElement('label');
      label.className = 'ovp-check ovp-cli';
      const input = Object.assign(document.createElement('input'), { type: 'checkbox', value: cli });
      const text = Object.assign(document.createElement('span'), { textContent: OVERVIEW_CLI_LABELS[cli] || cli });
      label.append(input, text);
      return label;
    }));
  }
  for (const input of box.querySelectorAll('input')) input.checked = chosen.includes(input.value);
}

function syncOverviewPlaces(place) {
  const select = ovPanel.el.querySelector('.ovp-place');
  const { projects, folders } = overviewPlaceChoices(place);
  const key = JSON.stringify([projects, folders]);
  if (key !== ovPanel.placeKey) {
    ovPanel.placeKey = key;
    const group = (label, list) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = label;
      optgroup.append(...list.map(([value, text]) => new Option(text, value)));
      return optgroup;
    };
    select.replaceChildren(new Option('All places', 'all'),
      ...(projects.length ? [group('Projects', projects)] : []),
      ...(folders.length ? [group('Folders', folders)] : []));
  }
  select.value = overviewPlaceValue(place);
  select.classList.toggle('is-on', !!place);
}

/**
 * The bar under the search: "N results" and "Stop N running" as the page's
 * last render counted them (drawn after it: refreshOverviewTab and
 * setOverviewPrefs draw the page first), and "Restore N left out" when some are.
 */
function syncOverviewResults() {
  const bar = ovPanel.el.querySelector('.ovp-results');
  const summary = overviewSearch ? overviewSearchSummary(overviewLastResults()) : null;
  bar.hidden = !overviewSearch || (!summary && overviewLeftOut.size === 0);
  if (bar.hidden) return;
  const count = bar.querySelector('.ovp-results-count');
  count.hidden = !summary;
  count.textContent = summary ? `${summary.count} result${summary.count === 1 ? '' : 's'}` : '';
  const restore = bar.querySelector('.ovp-restore');
  restore.hidden = overviewLeftOut.size === 0;
  restore.textContent = `Restore ${overviewLeftOut.size} left out`;
  const stop = bar.querySelector('.ovp-stop');
  stop.hidden = !summary || summary.running === 0;
  stop.textContent = `Stop ${summary?.running || 0} running`;
}

// ---- + New session ----

/** A folder's entry in the Sessions lists, or one made up for a folder just added. */
function overviewFolderFor(projectPath) {
  return (cachedAllProjects || []).find(folder => folder.projectPath === projectPath)
    || { projectPath, folder: encodeProjectPath(projectPath), sessions: [] };
}

/** The projects of the menu: not done, starred first, then the busiest. */
function overviewMenuProjects() {
  const projects = cachedProjectTree?.projects || [];
  const groups = projectListGroups(projects, { isSnoozed: isProjectSnoozed, sortTime: projectSortTime });
  return [...groups.starred, ...groups.active, ...groups.snoozed].slice(0, OVP_MENU_PROJECTS);
}

/** The folders of the menu: the ones with the latest activity. */
function overviewMenuFolders() {
  const latest = folder => Math.max(0, ...(folder.sessions || []).map(session => sessionEventTime(session) || 0));
  return (cachedProjects || []).filter(folder => folder.projectPath)
    .map(folder => ({ folder, time: latest(folder) }))
    .sort((a, b) => b.time - a.time)
    .slice(0, OVP_MENU_FOLDERS)
    .map(({ folder }) => folder);
}

/**
 * "+ New session" (the panel and the page's header): a project's CLIs, a
 * recent folder's, or a folder chosen now. A session started while the page is
 * open shows on it, in focus.
 */
function showOverviewNewSession(anchor) {
  const items = [];
  const projects = overviewMenuProjects();
  if (projects.length) {
    items.push({ head: 'Projects' });
    for (const project of projects) items.push({ label: project.name, icon: PICONS.dashboard(13), submenu: newSessionItems(project) });
  }
  const folders = overviewMenuFolders();
  if (folders.length) {
    if (items.length) items.push({ sep: true });
    items.push({ head: 'Recent folders' });
    for (const folder of folders) {
      items.push({ label: overviewFolderLabel(folder.projectPath), icon: PICONS.folder(13), onClick: () => showNewSessionPopover(folder, anchor) });
    }
  }
  if (items.length) items.push({ sep: true });
  items.push({
    label: 'Choose folder…',
    icon: PICONS.plus(13),
    onClick: () => showAddProjectDialog({ onAdded: projectPath => showNewSessionPopover(overviewFolderFor(projectPath), anchor) }),
  });
  showContextMenu(items, { anchor });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (sessionOverviewUnavailable()) return;
    // The page mounts and unmounts as a child of #main: the first button says
    // whether it is on screen, and the results bar counts its first render, or
    // nothing once it is gone.
    const main = document.getElementById('main');
    if (main) new MutationObserver(() => refreshOverviewPanel()).observe(main, { childList: true });
    // A start opens on the Sessions tab until app.js clicks the remembered one.
    if (activeTab === 'sessions') showOverviewSidebar();
  }, { once: true });
}
