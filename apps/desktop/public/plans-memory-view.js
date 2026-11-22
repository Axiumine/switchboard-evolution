// --- Plans viewer, and hiding the main area's viewers ---
// The Files tab (agent files, opened and pinned files) is files-view.js.
// Depends on globals: cachedPlans, plansContent, planPanel, planViewer,
// memoryViewer, placeholder, terminalArea, statsViewer, settingsViewer,
// processViewer, jsonlViewer (app.js)
// Depends on: formatDate (utils.js)

let currentPlanContent = "";
let currentPlanFilePath = "";
let currentPlanFilename = "";

// --- Plans ---
async function loadPlans() {
  cachedPlans = await window.api.getPlans();
  renderPlans();
}

function renderPlans(plans) {
  plans = plans || cachedPlans;
  plansContent.innerHTML = '';
  if (plans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'plans-empty';
    empty.textContent = 'No plans found in ~/.claude/plans/';
    plansContent.appendChild(empty);
    return;
  }
  for (const plan of plans) {
    plansContent.appendChild(buildPlanItem(plan));
  }
}

function buildPlanItem(plan) {
  const item = document.createElement('div');
  item.className = 'session-item plan-item';

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

  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  metaEl.textContent = formatDate(new Date(plan.modified));

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
  // Mark active in sidebar
  plansContent.querySelectorAll('.plan-item.active').forEach(el => el.classList.remove('active'));
  const items = plansContent.querySelectorAll('.plan-item');
  items.forEach(el => {
    if (el.querySelector('.session-id')?.textContent === plan.filename) {
      el.classList.add('active');
    }
  });

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
