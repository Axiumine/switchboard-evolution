// --- Plans viewer, and hiding the main area's viewers ---
// The Files tab (agent files, opened and pinned files) is files-view.js.
// Depends on globals: cachedPlans, plansContent, planPanel, planViewer,
// memoryViewer, placeholder, terminalArea, statsViewer, settingsViewer,
// processViewer, jsonlViewer (app.js)
// Depends on: formatDate (utils.js); PLAN_* choices, loadPlanListPrefs,
// savePlanListPrefs, validPlanListChoice, filterPlans, sortPlans, groupPlans,
// planFilterChoices, prunePlanFilters, activePlanFilterCount, planPlaceLabel
// (plans-list.js); showContextMenu, closeContextMenu, PICONS (projects-view.js)

let currentPlanContent = "";
let currentPlanFilename = "";
let currentPlanFilePath = "";

// The Group, Filter and Sort choices (plans-list.js), kept across restarts.
let planListPrefs = loadPlanListPrefs(localStorage);
// The plan files the search in the field found, or null without a search.
let plansSearchMatch = null;
// Group headers closed by hand, by `<grouping>:<key>`; open by default.
const plansCollapsed = new Map();
const plansGroupSelect = document.getElementById('plans-group-select');
const plansSortSelect = document.getElementById('plans-sort-select');
const plansFilterBtn = document.getElementById('plans-filter-btn');
let plansFilterMenuClosedAt = 0;

// --- Plans ---
/** Load the plans and draw the tab. A new visit starts without a search. */
async function loadPlans() {
  plansSearchMatch = null;
  cachedPlans = await window.api.getPlans();
  // A project or folder filter that names none of the plans any more goes.
  const pruned = prunePlanFilters(planListPrefs, planFilterChoices(cachedPlans));
  if (pruned.changed) {
    planListPrefs = pruned.prefs;
    savePlanListPrefs(localStorage, planListPrefs);
  }
  syncPlanListControls();
  renderPlans();
}

/** Narrow the list to the plan files a search found (a Set), or show them all again (null). */
function setPlansSearchMatch(matchIds) {
  plansSearchMatch = matchIds || null;
  renderPlans();
}

function setPlanListPref(kind, value) {
  planListPrefs = { ...planListPrefs, [kind]: validPlanListChoice(kind, value) };
  savePlanListPrefs(localStorage, planListPrefs);
  syncPlanListControls();
  renderPlans();
}

function clearPlanFilters() {
  planListPrefs = { ...planListPrefs, project: 'all', folder: 'all', date: 'all', session: 'all' };
  savePlanListPrefs(localStorage, planListPrefs);
  syncPlanListControls();
  renderPlans();
}

function fillPlanSelect(select, choices) {
  if (!select || select.options.length) return;
  for (const [value, label] of choices) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

/** What each active filter shows, for the Filter button's tooltip. */
function planFilterSummary() {
  // app.js, which declares cachedPlans, runs after this file.
  const choices = planFilterChoices(typeof cachedPlans !== 'undefined' ? cachedPlans : []);
  const listed = (list, value) => (list.find(c => c.value === value) || {}).label || value;
  const fixed = (list, value) => (list.find(([v]) => v === value) || [])[1] || value;
  const parts = [];
  if (planListPrefs.project !== 'all') parts.push(`Project: ${listed(choices.projects, planListPrefs.project)}`);
  if (planListPrefs.folder !== 'all') parts.push(`Folder: ${listed(choices.folders, planListPrefs.folder)}`);
  if (planListPrefs.date !== 'all') parts.push(fixed(PLAN_DATE_FILTERS, planListPrefs.date));
  if (planListPrefs.session !== 'all') parts.push(fixed(PLAN_SESSION_FILTERS, planListPrefs.session));
  return parts.join(' · ');
}

function syncPlanListControls() {
  fillPlanSelect(plansGroupSelect, PLAN_GROUPS);
  fillPlanSelect(plansSortSelect, PLAN_SORTS);
  if (plansGroupSelect) plansGroupSelect.value = planListPrefs.group;
  if (plansSortSelect) plansSortSelect.value = planListPrefs.sort;
  if (!plansFilterBtn) return;
  const active = activePlanFilterCount(planListPrefs);
  plansFilterBtn.textContent = active ? `Filters · ${active}` : 'All plans';
  plansFilterBtn.classList.toggle('is-on', active > 0);
  plansFilterBtn.title = active ? `Filtered by ${planFilterSummary()}` : 'Filter the plans';
}

/** The Filter menu: one submenu per filter, the current choice ticked, counts at the right. */
function planFilterMenuItems() {
  const choices = planFilterChoices(cachedPlans);
  const tick = on => (on ? PICONS.check(13) : '');
  const current = (list, value) => (value === 'all' ? '' : (list.find(c => c.value === value) || {}).label || '');
  const fixed = (kind, list) => list.map(([value, label]) => ({
    label, icon: tick(planListPrefs[kind] === value), onClick: () => setPlanListPref(kind, value),
  }));
  const listed = (kind, allLabel, list) => [
    { label: allLabel, icon: tick(planListPrefs[kind] === 'all'), onClick: () => setPlanListPref(kind, 'all') },
    { sep: true },
    ...list.map(c => ({
      label: c.label, hint: String(c.count), icon: tick(planListPrefs[kind] === c.value),
      onClick: () => setPlanListPref(kind, c.value),
    })),
  ];
  const fixedHint = (kind, list) => (planListPrefs[kind] === 'all' ? '' : (list.find(([v]) => v === planListPrefs[kind]) || [])[1] || '');
  return [
    { label: 'Project', hint: current(choices.projects, planListPrefs.project), submenu: listed('project', 'All projects', choices.projects) },
    { label: 'Folder', hint: current(choices.folders, planListPrefs.folder), submenu: listed('folder', 'All folders', choices.folders) },
    { label: 'Date', hint: fixedHint('date', PLAN_DATE_FILTERS), submenu: fixed('date', PLAN_DATE_FILTERS) },
    { label: 'Session', hint: fixedHint('session', PLAN_SESSION_FILTERS), submenu: fixed('session', PLAN_SESSION_FILTERS) },
    { sep: true },
    { label: 'Clear filters', disabled: activePlanFilterCount(planListPrefs) === 0, onClick: clearPlanFilters },
  ];
}

function showPlanFilterMenu() {
  if (typeof showContextMenu !== 'function' || !plansFilterBtn) return;
  const menu = showContextMenu(planFilterMenuItems(), { anchor: plansFilterBtn });
  plansFilterBtn.setAttribute('aria-expanded', 'true');
  const remove = menu.remove;
  menu.remove = () => {
    plansFilterBtn.setAttribute('aria-expanded', 'false');
    plansFilterMenuClosedAt = Date.now();
    remove();
  };
}

if (plansGroupSelect) plansGroupSelect.addEventListener('change', () => setPlanListPref('group', plansGroupSelect.value));
if (plansSortSelect) plansSortSelect.addEventListener('change', () => setPlanListPref('sort', plansSortSelect.value));
if (plansFilterBtn) {
  plansFilterBtn.setAttribute('aria-expanded', 'false');
  plansFilterBtn.addEventListener('click', () => {
    // A click on the button while its menu is open closes the menu (on
    // pointerdown, outside it) and must not open it again.
    if (Date.now() - plansFilterMenuClosedAt < 300) return;
    showPlanFilterMenu();
  });
}
syncPlanListControls();

function plansEmpty(text, { clearFilters = false } = {}) {
  const empty = document.createElement('div');
  empty.className = 'plans-empty';
  empty.textContent = text;
  if (clearFilters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plans-clear-filters';
    btn.textContent = 'Clear filters';
    btn.addEventListener('click', clearPlanFilters);
    empty.appendChild(btn);
  }
  plansContent.appendChild(empty);
}

/** Draw the tab: the search's plans, through the filters, sorted, in groups. */
function renderPlans() {
  const all = cachedPlans || [];
  plansContent.innerHTML = '';
  if (all.length === 0) {
    plansEmpty('No plans found in ~/.claude/plans/');
    return;
  }
  const now = Date.now();
  const searched = plansSearchMatch ? all.filter(p => plansSearchMatch.has(p.filename)) : all;
  const shown = sortPlans(filterPlans(searched, planListPrefs, now), planListPrefs.sort);
  if (shown.length === 0) {
    const filtered = activePlanFilterCount(planListPrefs) > 0;
    if (filtered) plansEmpty(plansSearchMatch ? 'No plan matches the search and these filters.' : 'No plan matches these filters.', { clearFilters: true });
    else plansEmpty('No plans match the search.');
    return;
  }
  const mode = planListPrefs.group;
  for (const group of groupPlans(shown, mode, planListPrefs.sort, now)) {
    const rows = group.plans.map(plan => buildPlanItem(plan, mode));
    if (mode === 'none') rows.forEach(row => plansContent.appendChild(row));
    else plansContent.appendChild(buildPlanGroup(`${mode}:${group.key}`, group, rows));
  }
  if (currentPlanFilename) markActivePlan(currentPlanFilename);
}

/** A group's header (arrow, name, count) over its rows; a click opens or closes it. */
function buildPlanGroup(stateKey, group, rows) {
  const el = document.createElement('div');
  el.className = 'project-group plan-group';
  if (plansCollapsed.get(stateKey) === true) el.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'project-header';
  if (group.hint) header.title = group.hint;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.innerHTML = '&#9660;';
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = group.title;
  const count = document.createElement('span');
  count.className = 'memory-file-count';
  count.textContent = rows.length;
  header.append(arrow, name, count);
  header.addEventListener('click', () => {
    const collapsed = !el.classList.contains('collapsed');
    el.classList.toggle('collapsed', collapsed);
    plansCollapsed.set(stateKey, collapsed);
  });

  const list = document.createElement('div');
  list.className = 'project-sessions';
  for (const row of rows) list.appendChild(row);
  el.append(header, list);
  return el;
}

function markActivePlan(filename) {
  plansContent.querySelectorAll('.plan-item.active').forEach(el => el.classList.remove('active'));
  for (const el of plansContent.querySelectorAll('.plan-item')) {
    if (el.dataset.filename === filename) el.classList.add('active');
  }
}

function buildPlanItem(plan, group = planListPrefs.group) {
  const item = document.createElement('div');
  item.className = 'session-item plan-item';
  item.dataset.filename = plan.filename;

  const row = document.createElement('div');
  row.className = 'session-row';

  const info = document.createElement('div');
  info.className = 'session-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'session-summary';
  titleEl.textContent = plan.title;

  const filenameEl = document.createElement('div');
  filenameEl.className = 'session-id';
  filenameEl.textContent = plan.filename;

  // When it was edited (or created, when sorting by that), and where it belongs.
  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  const when = planListPrefs.sort === 'created' && plan.created
    ? `created ${formatDate(new Date(plan.created))}`
    : formatDate(new Date(plan.modified));
  const place = planPlaceLabel(plan, group);
  metaEl.textContent = place ? `${when} · ${place}` : when;
  if (plan.projectPath) metaEl.title = plan.projectPath;

  info.appendChild(titleEl);
  info.appendChild(filenameEl);
  info.appendChild(metaEl);
  row.appendChild(info);

  // A plan-mode plan can become a project's plan.md. The tracker is left for
  // a session to derive; the project page says so.
  const projects = (typeof cachedProjectTreeAll !== 'undefined' ? cachedProjectTreeAll?.projects : []) || [];
  const active = projects.filter(p => p.status === 'active');
  if (active.length && typeof showContextMenu === 'function') {
    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const adoptBtn = document.createElement('button');
    adoptBtn.className = 'session-move-btn';
    adoptBtn.title = 'Adopt into a project as plan.md';
    adoptBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M9 13h6"/><path d="m12 10 3 3-3 3"/></svg>';
    adoptBtn.onclick = (e) => {
      e.stopPropagation();
      showContextMenu([{ head: 'Adopt into project' }, ...active.map(p => ({
        label: p.name, onClick: () => adoptPlanInto(p, plan),
      }))], { anchor: adoptBtn });
    };
    actions.appendChild(adoptBtn);
    row.appendChild(actions);
  }
  item.appendChild(row);

  item.addEventListener('click', () => openPlan(plan));
  return item;
}

async function adoptPlanInto(project, plan) {
  let result = await window.api.adoptPlan(project.id, plan.filename);
  if (result?.exists && confirm(`${project.name} already has a plan.md with content.\n\nReplace it with "${plan.title}"?`)) {
    result = await window.api.adoptPlan(project.id, plan.filename, { replace: true });
  }
  if (result?.error) { if (!result.exists) alert(result.error); return; }
  if (confirm(`Adopted into ${project.name} as plan.md.\n\nOpen the project?`)) {
    const tab = document.querySelector('.sidebar-tab[data-tab="projects"]');
    if (tab && activeTab !== 'projects') tab.click();
    if (typeof selectProject === 'function') selectProject(project.id, { tab: 'plan' });
  }
}

async function openPlan(plan) {
  // Unsaved changes in the plan shown: Save, Don't Save or stay on it.
  if (planPanel.filePath && currentPlanFilename !== plan.filename && !(await planPanel.confirmLeave())) return;
  // Mark active in sidebar
  markActivePlan(plan.filename);

  const result = await window.api.readPlan(plan.filename);
  currentPlanContent = result.content;
  currentPlanFilePath = result.filePath;
  currentPlanFilename = plan.filename;

  // Hide terminal area and placeholder, show plan viewer
  if (typeof hideProjectChrome === 'function') hideProjectChrome();
  placeholder.style.display = 'none';
  terminalArea.style.display = 'none';
  statsViewer.style.display = 'none';
  memoryViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  processViewer.style.display = 'none';
  // The message history sits over this viewer when it stays shown (and takes its Cmd+F).
  jsonlViewer.style.display = 'none';
  planViewer.style.display = 'flex';

  planPanel.open(plan.title, currentPlanFilePath, currentPlanContent);
}

/** Hide the full-page viewers and bring the terminal area back, leaving any project chrome alone. */
function hideViewerPanels() {
  if (typeof jsonlSearch !== 'undefined') jsonlSearch?.close(false);
  planViewer.style.display = 'none';
  statsViewer.style.display = 'none';
  memoryViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  processViewer.style.display = 'none';
  jsonlViewer.style.display = 'none';
  terminalArea.style.display = '';
}

function hideAllViewers() {
  hideViewerPanels();
  if (typeof hideProjectChrome === 'function') hideProjectChrome();
}

function hidePlanViewer() {
  hideAllViewers();
}
