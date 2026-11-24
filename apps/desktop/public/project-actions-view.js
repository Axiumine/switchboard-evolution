// The Git tab's Actions view for a project: GitHub Actions as the Actions tab
// of a repository on github.com shows it, one tab per repository as in
// History and Pull Requests.
//
// The view has GitHub's own pages, inside the app: the runs of every workflow
// or of one (with the search box's qualifiers and the Event, Status, Branch
// and Actor menus), a workflow (Run workflow, Disable/Enable, its status
// badge), a run (actions-run-view.js: summary, graph, annotations, artifacts,
// deployments waiting for a review, usage, workflow file), a job and its logs
// (actions-run-view.js), and Management (actions-manage-view.js: caches,
// deployments, runners; attestations and metrics open GitHub's own page in
// the app). A sidebar lists the workflows and Management, or a run's jobs on
// a run's pages; "←" goes back.
//
// Lists read again every 30 s while the view is on screen (GitHub's
// "Auto-refresh: 30s"), a running run or job every 5 s; main asks GitHub with
// the ETag of the last answer, so an unchanged page costs nothing.
// gh runs in main (actions.js, actions-edits.js); this file paints and asks.

const projectActionsTabState = new Map();

const ACT_LIST_POLL_MS = 30_000;
const ACT_RUN_POLL_MS = 5_000;
const ACT_BACKGROUND_POLL_MS = 60_000;
const ACT_STALE_MS = 60_000;
const ACT_LOW_BUDGET = 200;
const ACT_SIDE_SHOWN = 50; // workflows the sidebar lists before "Show more"

let actSeq = 0;

function actModel() {
  return typeof ActionsModel !== 'undefined' ? ActionsModel : (typeof window !== 'undefined' ? window.ActionsModel : null);
}

function actSvg(paths, { fill = 'none', spin = false } = {}) {
  return (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${spin ? ' class="act-spin"' : ''}>${paths}</svg>`;
}

// Lucide's glyphs for a run's state, the way GitHub's octicons draw them.
const ACT_ICONS = {
  success: actSvg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  failure: actSvg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
  cancelled: actSvg('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  skipped: actSvg('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  neutral: actSvg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8"/>'),
  running: actSvg('<path d="M21 12a9 9 0 1 1-6.22-8.56"/>', { spin: true }),
  queued: actSvg('<circle cx="12" cy="12" r="4" fill="currentColor"/>'),
  waiting: actSvg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  info: actSvg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  action: actSvg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  workflow: actSvg('<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>'),
  play: actSvg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  stop: actSvg('<rect x="6" y="6" width="12" height="12" rx="1"/>'),
  calendar: actSvg('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
  timer: actSvg('<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>'),
  external: actSvg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  database: actSvg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>'),
  rocket: actSvg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  server: actSvg('<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>'),
  shield: actSvg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'),
  chart: actSvg('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
  gauge: actSvg('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
  lock: actSvg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  menu: actSvg('<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>'),
  download: actSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  badge: actSvg('<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>'),
  file: actSvg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
};

/** A state's icon, coloured by its bucket, with its words for a screen reader. */
function actStateIcon(state, size = 14) {
  const s = state || { bucket: 'queued', label: '', a11y: '' };
  const icon = ACT_ICONS[s.bucket] || ACT_ICONS.queued;
  return `<span class="act-state act-state--${actAttr(s.bucket)}" title="${actAttr(s.label)}" role="img" aria-label="${actAttr(s.a11y || s.label)}">${icon(size)}</span>`;
}

function actAttr(value) {
  if (typeof prAttr === 'function') return prAttr(value);
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function actPlural(n, word, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}

function actRelative(iso, now = new Date()) {
  if (typeof prRelative === 'function') return prRelative(iso, now);
  return iso ? String(iso).slice(0, 10) : '';
}

/** Call a preload method; a missing one or a throw comes back as { error }. */
async function actApi(name, ...args) {
  const fn = typeof window !== 'undefined' ? window.api?.[name] : null;
  if (typeof fn !== 'function') return { error: 'This version of Switchboard cannot do that.' };
  try {
    return (await fn(...args)) || { error: 'No answer from Switchboard.' };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

// --- State ---

function actTabState(projectId) {
  if (!projectActionsTabState.has(projectId)) {
    projectActionsTabState.set(projectId, {
      repositories: null,
      selectedRepo: null,
      repos: new Map(), // repository path → actRepoData
      notice: null,
      dialogOpen: false,
      sideOpen: false, // the sidebar, shown over the page when the view is narrow
      timer: null,
    });
  }
  return projectActionsTabState.get(projectId);
}

function actEntry() {
  return { data: null, error: null, errorCode: null, loading: false, loadedAt: 0, request: 0 };
}

function actRepoData(remote = null) {
  return {
    remote,
    remotes: [],
    repo: null, // { nameWithOwner, url, host, owner, repo, permission, canWrite, isAdmin, defaultBranch }
    workflows: actEntry(), // data: { workflows, lockfile }
    page: { kind: 'runs', workflowId: null },
    stack: [], // the pages "←" goes back to
    query: '', // the search box, as typed
    pageNo: 1,
    runs: new Map(), // `${workflowId}|${query}|${pageNo}` → entry (data: { total, runs, text, notice })
    run: new Map(), // `${runId}@${attempt || ''}` → entry
    job: new Map(), // jobId → entry
    stepLogs: new Map(), // `${jobId}/${step}` → { loading } | { text, truncated } | { error, pending }
    openSteps: new Map(), // jobId → Set of step numbers shown open
    foldedGroups: new Map(), // `${jobId}/${step}` → Set of the log's group lines shown open
    timestamps: false,
    logSearch: '',
    logHit: 0,
    graphOpen: new Set(), // the matrix nodes shown with all their jobs
    zoom: 1,
    dispatch: new Map(), // `${workflowId}@${ref}` → entry
    files: new Map(), // `${path}@${ref}` → entry
    caches: { opts: { ref: '', key: '', sort: 'last_accessed_at', direction: 'desc', page: 1 }, entry: actEntry() },
    runners: actEntry(),
    deployments: { environment: null, entry: actEntry(), more: [] },
    rate: null,
    sideAll: false, // "Show more workflows"
  };
}

function actRepoState(projectId, state, path) {
  if (!state.repos.has(path)) {
    const saved = typeof prSavedRemote === 'function' ? prSavedRemote(projectId, path) : null;
    state.repos.set(path, actRepoData(saved));
  }
  return state.repos.get(path);
}

function actSelectedRepo(state) {
  const repos = state.repositories || [];
  return repos.find(r => r.path === state.selectedRepo) || repos[0] || null;
}

function actRemoteOpts(data, extra = {}) {
  return data.remote ? { remote: data.remote, ...extra } : { ...extra };
}

function actRunsKey(data) {
  return `${data.page.workflowId || ''}|${data.query.trim()}|${data.pageNo}`;
}

function actRunKey(runId, attempt) {
  return `${runId}@${attempt || ''}`;
}

function actWorkflow(data, id) {
  const list = data.workflows.data?.workflows || [];
  return list.find(w => String(w.id) === String(id)) || null;
}

function actCanWrite(data) {
  return !!data.repo?.canWrite;
}

// --- The pages ---

/** Go to a page; `replace` keeps "←" where it was. */
/**
 * Going to another page drops what the last one said, as GitHub's notices go
 * when the page changes; one set just now (the run "Run workflow" opens) stays.
 */
function actDropOldNotice(project, state) {
  if (state.notice && Date.now() - (state.noticeAt || 0) > 1500) actSetNotice(project, state, null);
}

function actGo(project, state, page, { replace = false } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  actDropOldNotice(project, state);
  const data = actRepoState(project.id, state, repo.path);
  if (!replace) data.stack.push(data.page);
  if (data.stack.length > 30) data.stack.shift();
  data.page = page;
  if (page.kind === 'runs') data.pageNo = page.pageNo || 1;
  state.sideOpen = false;
  actRepaint(project, state);
  actLoadPage(project, state);
}

function actBack(project, state) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  actDropOldNotice(project, state);
  const data = actRepoState(project.id, state, repo.path);
  const previous = data.stack.pop() || { kind: 'runs', workflowId: null };
  data.page = previous;
  if (previous.kind === 'runs') data.pageNo = previous.pageNo || 1;
  actRepaint(project, state);
  actLoadPage(project, state);
}

// --- Painting ---

/** The view's body when it is the one on screen for this project (Git → Actions), else null. */
function actActiveBody(project) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  const body = document.getElementById('git-workspace-view');
  if (!body || !body.isConnected) return null;
  if (selectedProject()?.id !== project.id || projectTab(project) !== 'git' || projectGitView(project) !== 'actions') return null;
  return body;
}

function actSummaryText(data) {
  const repo = data.repo;
  if (!repo) return data.workflows.loading ? 'Reading workflows…' : '';
  const n = (data.workflows.data?.workflows || []).length;
  return `${repo.nameWithOwner} · ${actPlural(n, 'workflow')}`;
}

function actRemoteSelectHtml(data) {
  const remotes = data.remotes || [];
  if (remotes.length < 2) return '';
  const current = data.remote || remotes[0].name;
  return `<select class="ws-select pr-remote" id="act-remote" title="Whose workflows are shown" aria-label="Remote">${remotes.map(r => `<option value="${actAttr(r.name)}"${r.name === current ? ' selected' : ''}>${escapeHtml(`${r.name} · ${r.slug}`)}</option>`).join('')}</select>`;
}

function actErrorHtml(entry, what = 'GitHub Actions') {
  const titles = {
    'gh-missing': 'The GitHub CLI is needed',
    'gh-auth': 'Sign in to GitHub',
    'no-github-remote': 'No GitHub remote',
    'not-found': 'Not found on GitHub',
    'rate-limited': 'GitHub needs a pause',
  };
  const title = titles[entry.errorCode] || `${what} could not be read`;
  const text = entry.errorCode === 'no-github-remote'
    ? 'GitHub Actions is shown for repositories on GitHub, and this one has no GitHub remote.'
    : entry.error;
  return `<div class="git-empty-state act-empty"><div class="git-empty-title">${escapeHtml(title)}</div><div>${escapeHtml(text || '')}</div><button type="button" class="ws-btn ws-btn--sm" data-act="retry">Try again</button></div>`;
}

function actLoadingHtml(text) {
  return `<div class="git-loading act-loading"><span class="git-loading-dot"></span>${escapeHtml(text)}</div>`;
}

/** The sidebar of the workflows' pages: All workflows, each workflow, Management. */
function actSideHtml(data, { showAll = false } = {}) {
  const page = data.page;
  const list = data.workflows.data?.workflows || [];
  const AM = actModel();
  const item = (attrs, label, on, extra = '', icon = '') => `<button type="button" class="act-nav-item${on ? ' is-on' : ''}" ${attrs}${on ? ' aria-current="page"' : ''}>${icon}<span class="act-nav-label">${label}</span>${extra}</button>`;
  const shown = showAll ? list : list.slice(0, ACT_SIDE_SHOWN);
  const workflows = shown.map((w) => {
    const off = AM ? AM.workflowStateText(w.state) : '';
    return item(`data-act="nav-workflow" data-id="${actAttr(w.id)}" title="${actAttr(w.dynamic ? `${w.name} (run by GitHub)` : w.path)}"`, escapeHtml(w.name),
      page.kind === 'runs' && String(page.workflowId) === String(w.id), off ? `<span class="act-nav-tag">${escapeHtml(off.startsWith('Disabled') ? 'Disabled' : off)}</span>` : '');
  }).join('');
  const more = list.length > shown.length ? `<button type="button" class="act-nav-more" data-act="nav-more">Show more workflows…</button>` : '';
  const external = ACT_ICONS.external(11);
  const manage = [
    item('data-act="nav-caches"', 'Caches', page.kind === 'caches', '', ACT_ICONS.database(13)),
    item('data-act="nav-deployments"', 'Deployments', page.kind === 'deployments', '', ACT_ICONS.rocket(13)),
    item('data-act="nav-runners"', 'Runners', page.kind === 'runners', '', ACT_ICONS.server(13)),
    item('data-act="nav-github" data-page="attestations" title="Opens GitHub\'s page in the app"', 'Attestations', false, `<span class="act-nav-ext">${external}</span>`, ACT_ICONS.shield(13)),
    item('data-act="nav-github" data-page="usageMetrics" title="Opens GitHub\'s page in the app"', 'Usage metrics', false, `<span class="act-nav-ext">${external}</span>`, ACT_ICONS.chart(13)),
    item('data-act="nav-github" data-page="performanceMetrics" title="Opens GitHub\'s page in the app"', 'Performance metrics', false, `<span class="act-nav-ext">${external}</span>`, ACT_ICONS.gauge(13)),
    data.workflows.data?.lockfile ? item('data-act="nav-lockfile" title="Opens .github/workflows/actions.lock"', 'Lockfile', false, `<span class="act-nav-ext">${external}</span>`, ACT_ICONS.lock(13)) : '',
  ].join('');
  return `
    <div class="act-side-section">
      ${item('data-act="nav-all"', 'All workflows', page.kind === 'runs' && !page.workflowId, '', ACT_ICONS.workflow(13))}
    </div>
    <div class="act-side-section">
      <div class="act-side-head">Workflows</div>
      ${workflows || (data.workflows.loading ? '<div class="act-side-note">Reading…</div>' : '<div class="act-side-note">No workflows</div>')}
      ${more}
    </div>
    <div class="act-side-section">
      <div class="act-side-head">Management</div>
      ${manage}
    </div>`;
}

/** The sidebar of a run's pages: back, Summary, the jobs, Run details. */
function actRunSideHtml(data, entry, page) {
  const run = entry?.data?.run;
  const jobs = entry?.data?.jobs || [];
  const AM = actModel();
  const item = (attrs, label, on, icon = '') => `<button type="button" class="act-nav-item${on ? ' is-on' : ''}" ${attrs}${on ? ' aria-current="page"' : ''}>${icon}<span class="act-nav-label">${label}</span></button>`;
  const tab = page.kind === 'run' ? (page.tab || 'summary') : null;
  return `
    <div class="act-side-section">
      <button type="button" class="act-back" data-act="back">${PICONS.back(12)}<span>${escapeHtml(run ? run.workflow : 'Back')}</span></button>
      ${item('data-act="run-tab" data-tab="summary"', 'Summary', tab === 'summary', ACT_ICONS.workflow(13))}
    </div>
    <div class="act-side-section">
      <div class="act-side-head">Jobs</div>
      ${jobs.map(job => item(`data-act="open-job" data-id="${actAttr(job.id)}" title="${actAttr(job.name)}"`, escapeHtml(job.name), page.kind === 'job' && String(page.jobId) === String(job.id), actStateIcon(AM.runState(job.status, job.conclusion), 13))).join('') || `<div class="act-side-note">${entry?.loading ? 'Reading…' : 'No jobs'}</div>`}
    </div>
    <div class="act-side-section">
      <div class="act-side-head">Run details</div>
      ${item('data-act="run-tab" data-tab="usage"', 'Usage', tab === 'usage', ACT_ICONS.timer(13))}
      ${item('data-act="run-tab" data-tab="workflow"', 'Workflow file', tab === 'workflow', ACT_ICONS.file(13))}
    </div>`;
}

function actPaint(project, state, body) {
  const repos = state.repositories || [];
  if (!repos.length) {
    body.innerHTML = '<div class="git-empty-state"><div class="git-empty-title">No folders attached</div><div>Attach a repository to this project to see its GitHub Actions here.</div></div>';
    return;
  }
  const repo = actSelectedRepo(state);
  state.selectedRepo = repo.path;
  const picker = typeof gitGraphRepoPickerHtml === 'function' ? gitGraphRepoPickerHtml(repos, repo) : '';
  if (repo.git === false) {
    body.innerHTML = `<div class="git-tab-shell act-shell">${picker}<div class="git-empty-state"><div class="git-empty-title">Not a Git repository</div><div>${escapeHtml(repo.path)}</div></div></div>`;
    actWireRepoPicker(project, state, body);
    return;
  }
  const data = actRepoState(project.id, state, repo.path);
  body.innerHTML = `
    <div class="git-tab-shell act-shell">
      ${picker}
      <div class="git-tab-top">
        <div class="pr-heading"><div class="git-tab-title">Actions</div><div class="git-tab-path" id="act-summary" title="${actAttr(repo.path)}">${escapeHtml(actSummaryText(data))}</div></div>
        <div class="pr-top-actions">
          <span id="act-remote-slot">${actRemoteSelectHtml(data)}</span>
          <button type="button" class="ws-btn ws-btn--sm act-side-toggle" id="act-side-toggle" aria-expanded="${state.sideOpen}" title="Workflows and Management">${ACT_ICONS.menu(13)}<span>Menu</span></button>
          <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" id="act-refresh" title="Refresh">${PICONS.refresh(13)}</button>
        </div>
      </div>
      <div id="act-notice">${typeof prNoticeHtml === 'function' ? prNoticeHtml(state.notice) : ''}</div>
      <div class="act-layout${state.sideOpen ? ' is-side-open' : ''}" id="act-layout">
        <nav class="act-side" id="act-side" aria-label="Actions"></nav>
        <section class="act-main" id="act-main"></section>
      </div>
    </div>`;
  actWireRepoPicker(project, state, body);
  actBindNotice(project, state, body);
  body.querySelector('#act-refresh').onclick = () => actRefresh(project, state, { notice: true });
  body.querySelector('#act-side-toggle').onclick = () => {
    state.sideOpen = !state.sideOpen;
    body.querySelector('#act-layout')?.classList.toggle('is-side-open', state.sideOpen);
    body.querySelector('#act-side-toggle')?.setAttribute('aria-expanded', String(state.sideOpen));
  };
  const remote = body.querySelector('#act-remote');
  if (remote) remote.onchange = () => {
    const fresh = actRepoData(remote.value);
    fresh.remotes = data.remotes;
    state.repos.set(repo.path, fresh);
    if (typeof prSaveRemote === 'function') prSaveRemote(project.id, repo.path, remote.value);
    actRepaint(project, state);
    actLoadWorkflows(project, state, repo.path);
    actLoadPage(project, state);
  };
  const side = body.querySelector('#act-side');
  const main = body.querySelector('#act-main');
  side.onclick = (e) => actOnClick(project, state, e);
  main.onclick = (e) => actOnClick(project, state, e);
  actPaintSide(project, state);
  actPaintMain(project, state);
}

function actWireRepoPicker(project, state, body) {
  body.querySelectorAll('.gg-repo-option').forEach((button) => {
    const repo = (state.repositories || [])[Number(button.dataset.index)];
    if (!repo) return;
    button.onclick = () => {
      if (state.selectedRepo === repo.path) return;
      state.selectedRepo = repo.path;
      state.notice = null;
      actPaint(project, state, body);
      actEnsureLoaded(project, state);
    };
  });
}

function actBindNotice(project, state, body) {
  const close = body.querySelector('#act-notice .wt-notice-close');
  if (close) close.onclick = () => actSetNotice(project, state, null);
}

function actSetNotice(project, state, notice) {
  state.notice = notice;
  state.noticeAt = Date.now();
  const body = actActiveBody(project);
  const slot = body?.querySelector('#act-notice');
  if (!slot) return;
  slot.innerHTML = typeof prNoticeHtml === 'function' ? prNoticeHtml(notice) : '';
  actBindNotice(project, state, body);
}

function actPaintSide(project, state) {
  const body = actActiveBody(project);
  const side = body?.querySelector('#act-side');
  const repo = actSelectedRepo(state);
  if (!side || !repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const page = data.page;
  if (page.kind === 'run' || page.kind === 'job') {
    side.innerHTML = actRunSideHtml(data, data.run.get(actRunKey(page.runId, page.attempt)), page);
  } else {
    side.innerHTML = actSideHtml(data, { showAll: data.sideAll });
  }
}

/** The page on screen. Held back while a field of it has the focus (a search being typed), as Pull Requests does. */
function actPaintMain(project, state, { force = false } = {}) {
  const body = actActiveBody(project);
  const main = body?.querySelector('#act-main');
  const repo = actSelectedRepo(state);
  if (!main || !repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const summary = body.querySelector('#act-summary');
  if (summary) summary.textContent = actSummaryText(data);
  const remoteSlot = body.querySelector('#act-remote-slot');
  if (remoteSlot && !remoteSlot.querySelector('select:focus') && !remoteSlot.innerHTML.trim() && (data.remotes || []).length > 1) {
    remoteSlot.innerHTML = actRemoteSelectHtml(data);
  }
  const page = data.page;
  if (page.kind === 'runs') { actPaintRunsPage(project, state, main, data, { force }); return; }
  if (page.kind === 'run' && typeof actPaintRunPage === 'function') actPaintRunPage(project, state, main, data);
  else if (page.kind === 'job' && typeof actPaintJobPage === 'function') actPaintJobPage(project, state, main, data);
  else if (page.kind === 'file') actPaintFilePage(project, state, main, data);
  else if (page.kind === 'caches' && typeof actPaintCachesPage === 'function') actPaintCachesPage(project, state, main, data);
  else if (page.kind === 'runners' && typeof actPaintRunnersPage === 'function') actPaintRunnersPage(project, state, main, data);
  else if (page.kind === 'deployments' && typeof actPaintDeploymentsPage === 'function') actPaintDeploymentsPage(project, state, main, data);
}

function actRepaint(project, state) {
  actPaintSide(project, state);
  actPaintMain(project, state, { force: true });
  actSchedule(project, state);
}

// --- The runs' page ---

/** What the list says under the filters: "123 workflow runs", or "4 workflow run results" with a filter. */
function actCountText(data, entry) {
  const total = entry?.data?.total || 0;
  const AM = actModel();
  const parsed = AM.parseQuery(data.query);
  const filtered = Object.keys(parsed).some(k => k !== 'text' && parsed[k]) || !!parsed.text;
  const count = total > 2500 ? '2,500+' : total.toLocaleString('en-US');
  if (parsed.text) {
    const shown = (entry?.data?.runs || []).filter(run => AM.matchesText(run, parsed.text)).length;
    return `${shown} of this page's ${actPlural((entry?.data?.runs || []).length, 'run')} match "${parsed.text}"`;
  }
  return filtered ? `${count} workflow run result${total === 1 ? '' : 's'}` : `${count} workflow run${total === 1 ? '' : 's'}`;
}

/** The line under a run's title: "CI #42: Commit abc1234 pushed by octocat". */
function actRunMetaText(run) {
  const AM = actModel();
  return `${run.workflow} #${run.number}: ${AM.triggerText(run)}`;
}

function actDurationText(run, now = Date.now()) {
  const AM = actModel();
  const state = AM.runState(run.status, run.conclusion);
  if (state.bucket === 'queued' || state.bucket === 'waiting') return state.label;
  const text = AM.formatDuration(AM.runDuration(run, now));
  return state.bucket === 'running' ? (text ? `${text}…` : 'In progress') : text;
}

function actRunRowHtml(run, { now = new Date() } = {}) {
  const AM = actModel();
  const state = AM.runState(run.status, run.conclusion);
  const branch = run.branch && run.event !== 'merge_group'
    ? `<span class="act-branch" title="${actAttr(run.headRepository && run.fromFork ? `${run.headRepository}:${run.branch}` : run.branch)}">${escapeHtml(run.fromFork && run.headRepository ? `${run.headRepository.split('/')[0]}:${run.branch}` : run.branch)}</span>`
    : '';
  return `
    <div class="act-run" role="listitem" data-act="open-run" data-id="${actAttr(run.id)}" tabindex="0" aria-label="${actAttr(`${state.a11y}: ${run.title}`)}">
      ${actStateIcon(state, 15)}
      <div class="act-run-text">
        <div class="act-run-title">${escapeHtml(run.title || run.workflow)}</div>
        <div class="act-run-meta">${escapeHtml(actRunMetaText(run))}</div>
      </div>
      <div class="act-run-branch">${branch}</div>
      <div class="act-run-when">
        <span title="${actAttr(run.createdAt || '')}">${ACT_ICONS.calendar(11)}${escapeHtml(actRelative(run.createdAt, now))}</span>
        <span>${ACT_ICONS.timer(11)}${escapeHtml(actDurationText(run, now.getTime()))}</span>
      </div>
      <button type="button" class="ws-btn ws-btn--sm ws-btn--icon act-run-more" data-act="run-menu" data-id="${actAttr(run.id)}" title="More actions for workflow run ${actAttr(run.number)}" aria-label="More actions for workflow run ${actAttr(run.number)}">${PICONS.dots(13)}</button>
    </div>`;
}

/** The "…" of a run in the list, as far as the account may: { label, icon, danger, onClick key }. */
function actRunMenuItems(run, { canWrite = false } = {}) {
  const AM = actModel();
  const active = AM.isActive(run.status);
  const items = [{ key: 'view-file', label: 'View workflow file' }];
  if (canWrite) {
    if (active) items.push({ key: 'cancel', label: 'Cancel run' });
    if (!active) items.push({ key: 'rerun', label: 'Re-run all jobs' });
    if (!active && ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(run.conclusion)) items.push({ key: 'rerun-failed', label: 'Re-run failed jobs' });
    if (run.conclusion === 'action_required') items.push({ key: 'approve', label: 'Approve and run' });
  }
  items.push({ sep: true }, { key: 'web', label: 'Open on GitHub here' }, { key: 'browser', label: 'Open in the browser' });
  if (canWrite && !active) items.push({ sep: true }, { key: 'delete', label: 'Delete workflow run', danger: true });
  return items;
}

function actFiltersHtml(data) {
  const AM = actModel();
  const parsed = AM.parseQuery(data.query);
  const chip = (key, label) => `<button type="button" class="ws-btn ws-btn--sm pr-filter-btn${parsed[key] ? ' is-on' : ''}" data-act="filter-menu" data-key="${key}" aria-haspopup="true">${escapeHtml(parsed[key] ? `${label}: ${parsed[key]}` : label)}${PICONS.chevronDown(10)}</button>`;
  return `
    <div class="act-filters">
      <label class="pr-search act-search" title="GitHub's qualifiers: workflow:, event:, is:, branch:, actor:, created:. Other words look through the runs of the page shown.">${PICONS.search(12)}<input type="search" id="act-query" placeholder="Filter workflow runs" autocomplete="off" spellcheck="false" aria-label="Filter workflow runs" value="${actAttr(data.query)}"></label>
      <div class="act-filter-menus">
        ${data.page.workflowId ? '' : chip('workflow', 'Workflow')}
        ${chip('event', 'Event')}
        ${chip('is', 'Status')}
        ${chip('branch', 'Branch')}
        ${chip('actor', 'Actor')}
      </div>
    </div>`;
}

function actWorkflowHeadHtml(data, workflow, form) {
  const AM = actModel();
  const canWrite = actCanWrite(data);
  const off = AM.workflowStateText(workflow.state);
  // GitHub offers it while the workflow is enabled, to those who may run it.
  const runnable = form?.data?.available && canWrite && workflow.state === 'active';
  const run = runnable
    ? `<button type="button" class="ws-btn ws-btn--sm ws-btn--primary" data-act="dispatch" title="Run this workflow by hand (workflow_dispatch)">${ACT_ICONS.play(11)}<span>Run workflow</span>${PICONS.chevronDown(10)}</button>`
    : '';
  const banners = [];
  if (off && workflow.state !== 'active') {
    const words = workflow.state === 'disabled_inactivity'
      ? 'This scheduled workflow is disabled because there hasn\'t been activity in this repository for at least 60 days.'
      : workflow.state === 'disabled_fork' ? 'Workflows are disabled in this fork.' : 'This workflow was disabled manually.';
    banners.push(`<div class="act-banner act-banner--warn"><span>${escapeHtml(words)}</span>${canWrite ? '<button type="button" class="ws-btn ws-btn--sm" data-act="enable">Enable workflow</button>' : ''}</div>`);
  }
  if (runnable) {
    banners.push(`<div class="act-banner"><span>This workflow has a <code>workflow_dispatch</code> event trigger.</span>${run}</div>`);
  }
  const schedule = form?.data?.schedule || [];
  if (schedule.length) {
    banners.push(`<div class="act-banner act-banner--quiet"><span>Runs on a schedule: ${schedule.map(s => `<code>${escapeHtml(s.cron)}</code>${s.timezone ? ` (${escapeHtml(s.timezone)})` : ''}`).join(', ')}</span></div>`);
  }
  return `
    <div class="act-page-head">
      <div class="act-page-title">
        <h2>${escapeHtml(workflow.name)}</h2>
        ${workflow.dynamic ? '<span class="act-subtle">Run by GitHub</span>' : `<button type="button" class="act-link" data-act="view-workflow-file" title="${actAttr(workflow.path)}">${escapeHtml(workflow.file)}</button>`}
      </div>
      <div class="act-page-actions">
        <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="workflow-menu" title="Workflow options" aria-label="Workflow options">${PICONS.dots(13)}</button>
      </div>
    </div>
    ${banners.join('')}`;
}

function actRunsListHtml(data, entry, now = new Date()) {
  const AM = actModel();
  if (!entry || (!entry.data && entry.loading)) return actLoadingHtml('Reading workflow runs…');
  if (!entry.data && entry.error) return actErrorHtml(entry, 'The workflow runs');
  const answer = entry.data || { runs: [], total: 0 };
  const parsed = AM.parseQuery(data.query);
  const runs = (answer.runs || []).filter(run => AM.matchesText(run, parsed.text));
  const pages = Math.max(1, Math.ceil(Math.min(answer.total || 0, 1000 * 25) / 25));
  const filtered = data.query.trim();
  const head = `<div class="act-count"><span>${escapeHtml(actCountText(data, entry))}</span>${filtered ? '<button type="button" class="act-link" data-act="clear-filter">Clear filter</button>' : ''}<span class="act-auto" title="The list reads GitHub again every 30 seconds while it is on screen">Auto-refresh: 30s</span></div>`;
  if (answer.notice) return `${head}<div class="act-empty-list">${escapeHtml(answer.notice)}</div>`;
  if (!runs.length) {
    return `${head}<div class="act-empty-list">${filtered ? 'No results matched your search.' : 'There are no workflow runs yet.'}</div>`;
  }
  const pager = pages > 1
    ? `<div class="act-pager"><button type="button" class="ws-btn ws-btn--sm" data-act="page-prev"${data.pageNo <= 1 ? ' disabled' : ''}>Previous</button><span>Page ${data.pageNo} of ${pages > 999 ? '1000+' : pages}</span><button type="button" class="ws-btn ws-btn--sm" data-act="page-next"${data.pageNo >= pages ? ' disabled' : ''}>Next</button></div>`
    : '';
  return `${head}<div class="act-runs" role="list">${runs.map(run => actRunRowHtml(run, { now })).join('')}</div>${pager}`;
}

function actPaintRunsPage(project, state, main, data, { force = false } = {}) {
  const page = data.page;
  const entry = data.runs.get(actRunsKey(data));
  const workflow = page.workflowId ? actWorkflow(data, page.workflowId) : null;
  const typing = main.contains(document.activeElement) && document.activeElement.id === 'act-query';
  if (!force && typing && main.querySelector('#act-runs-list')) {
    main.querySelector('#act-runs-list').innerHTML = actRunsListHtml(data, entry);
    return;
  }
  const head = workflow
    ? actWorkflowHeadHtml(data, workflow, data.dispatch.get(`${workflow.id}@`))
    : '<div class="act-page-head"><div class="act-page-title"><h2>All workflows</h2><span class="act-subtle">Showing runs from all workflows</span></div></div>';
  main.innerHTML = `${head}${actFiltersHtml(data)}<div id="act-runs-list">${actRunsListHtml(data, entry)}</div>`;
  actWireQuery(project, state, main, data);
}

function actWireQuery(project, state, main, data) {
  const input = main.querySelector('#act-query');
  if (!input) return;
  const apply = () => {
    if (data.query === input.value) return;
    data.query = input.value;
    data.pageNo = 1;
    actLoadRuns(project, state);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; apply(); }
  };
  input.addEventListener('search', apply);
  input.onblur = apply;
}

/** The menus that set one qualifier of the search: Workflow, Event, Status, Branch, Actor. */
async function actOpenFilterMenu(project, state, button, key) {
  const AM = actModel();
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const current = AM.parseQuery(data.query)[key] || '';
  const choose = (value) => {
    data.query = AM.setQualifier(data.query, key, value);
    data.pageNo = 1;
    if (typeof prCloseFilterMenu === 'function') prCloseFilterMenu();
    actPaintMain(project, state, { force: true });
    actLoadRuns(project, state);
  };
  let options = [];
  if (key === 'workflow') options = (data.workflows.data?.workflows || []).map(w => ({ value: w.name, label: w.name }));
  else if (key === 'event') options = AM.EVENTS.map(e => ({ value: e, label: e }));
  else if (key === 'is') options = AM.STATUS_FILTERS.map(s => ({ value: s.value, label: s.label }));
  else if (key === 'actor') {
    const seen = new Set();
    for (const entry of data.runs.values()) for (const run of entry.data?.runs || []) for (const who of [run.actor, run.triggeringActor]) if (who) seen.add(who);
    options = [...seen].sort((a, b) => a.localeCompare(b)).map(a => ({ value: a, label: a }));
  }
  const paint = (menu, list, filter = '') => {
    const shown = list.filter(o => !filter || o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
    const typed = filter && (key === 'branch' || key === 'actor') && !shown.some(o => o.value === filter) ? [{ value: filter, label: `${filter}` }] : [];
    menu.querySelector('.act-menu-options').innerHTML = [...typed, ...shown].map(o => `<button type="button" class="pr-filter-option act-menu-option${o.value === current ? ' is-on' : ''}" data-value="${actAttr(o.value)}">${o.value === current ? PICONS.check(11) : '<span class="act-menu-tick"></span>'}<span>${escapeHtml(o.label)}</span></button>`).join('') || '<div class="pr-filter-empty">Nothing matches</div>';
    menu.querySelectorAll('[data-value]').forEach(b => { b.onclick = () => choose(b.dataset.value); });
  };
  const title = { workflow: 'Filter by workflow', event: 'Filter by event', is: 'Filter by status', branch: 'Filter by branch', actor: 'Filter by actor' }[key];
  const menu = prOpenCheckMenu(button, 'act-filter-menu', (m) => {
    m.innerHTML = `<div class="act-menu-head">${escapeHtml(title)}</div><input type="search" class="act-menu-filter" placeholder="Filter" aria-label="${actAttr(title)}">${current ? '<button type="button" class="pr-filter-reset" data-act="clear">Clear this filter</button>' : ''}<div class="act-menu-options"></div>`;
  });
  if (!menu) return;
  const field = menu.querySelector('.act-menu-filter');
  const clear = menu.querySelector('[data-act="clear"]');
  if (clear) clear.onclick = () => choose('');
  paint(menu, options);
  field.focus();
  let timer = null;
  field.oninput = () => {
    if (key !== 'branch') { paint(menu, options, field.value); return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const refs = await actApi('getActionsRefs', project.id, repo.path, actRemoteOpts(data, { query: field.value || null }));
      if (refs?.ok && menu.isConnected) paint(menu, (refs.branches || []).map(b => ({ value: b, label: b })), field.value);
    }, 250);
  };
  field.onkeydown = (e) => { if (e.key === 'Enter' && field.value && (key === 'branch' || key === 'actor')) { e.preventDefault(); choose(field.value); } };
  if (key === 'branch') {
    const refs = await actApi('getActionsRefs', project.id, repo.path, actRemoteOpts(data, { query: null }));
    if (refs?.ok && menu.isConnected) { options = (refs.branches || []).map(b => ({ value: b, label: b })); paint(menu, options, field.value); }
  }
}

// --- A workflow file at a branch (the workflow's "View workflow file") ---

function actPaintFilePage(project, state, main, data) {
  const page = data.page;
  const entry = data.files.get(`${page.path}@${page.ref}`);
  const head = `<div class="act-page-head"><div class="act-page-title"><button type="button" class="act-back act-back--inline" data-act="back">${PICONS.back(12)}</button><h2>${escapeHtml(page.path)}</h2><span class="act-subtle">at ${escapeHtml(page.ref)}</span></div></div>`;
  if (!entry || (!entry.data && entry.loading)) { main.innerHTML = head + actLoadingHtml('Reading the workflow file…'); return; }
  if (entry.error && !entry.data) { main.innerHTML = head + actErrorHtml(entry, 'The workflow file'); return; }
  actPaintYaml(main, head, entry.data, page.path);
}

/** A workflow file in a read-only editor (codemirror-setup.js), or as plain text without one. */
function actPaintYaml(main, headHtml, file, filePath) {
  main.innerHTML = `${headHtml}${file.error ? `<div class="act-banner act-banner--warn"><span>${escapeHtml(file.error)}</span></div>` : ''}<div class="act-yaml" id="act-yaml"></div>`;
  const slot = main.querySelector('#act-yaml');
  if (typeof createReadOnlyViewer === 'function') createReadOnlyViewer(slot, file.text || '', filePath.split('/').pop() || 'workflow.yml');
  else slot.innerHTML = `<pre>${escapeHtml(file.text || '')}</pre>`;
}

// --- Clicks ---

function actRunById(data, id) {
  for (const entry of data.runs.values()) {
    const run = (entry.data?.runs || []).find(r => String(r.id) === String(id));
    if (run) return run;
  }
  for (const entry of data.run.values()) if (entry.data?.run && String(entry.data.run.id) === String(id)) return entry.data.run;
  return null;
}

function actOnClick(project, state, e) {
  const target = e.target.closest('[data-act]');
  if (!target || target.disabled) return;
  const repo = actSelectedRepo(state);
  if (!repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const act = target.dataset.act;
  const id = target.dataset.id;
  switch (act) {
    case 'nav-all': data.query = ''; actGo(project, state, { kind: 'runs', workflowId: null }); return;
    case 'nav-workflow': data.query = ''; actGo(project, state, { kind: 'runs', workflowId: Number(id) }); return;
    case 'nav-more': data.sideAll = true; actPaintSide(project, state); return;
    case 'nav-caches': actGo(project, state, { kind: 'caches' }); return;
    case 'nav-runners': actGo(project, state, { kind: 'runners' }); return;
    case 'nav-deployments': actGo(project, state, { kind: 'deployments' }); return;
    case 'nav-github': actOpenGitHubPage(data, target.dataset.page); return;
    case 'nav-lockfile': if (data.repo) actOpenWeb(`https://${data.repo.host}/${data.repo.owner}/${data.repo.repo}/blob/${encodeURIComponent(data.repo.defaultBranch || 'HEAD')}/.github/workflows/actions.lock`, 'actions.lock'); return;
    case 'back': actBack(project, state); return;
    case 'retry': actRefresh(project, state); return;
    case 'open-run': if (e.target.closest('[data-act="run-menu"]')) return; actGo(project, state, { kind: 'run', runId: Number(id), attempt: null, tab: 'summary' }); return;
    case 'run-menu': e.stopPropagation(); actRunMenu(project, state, target, actRunById(data, id)); return;
    case 'clear-filter': data.query = ''; data.pageNo = 1; actPaintMain(project, state, { force: true }); actLoadRuns(project, state); return;
    case 'page-prev': data.pageNo = Math.max(1, data.pageNo - 1); data.page = { ...data.page, pageNo: data.pageNo }; actLoadRuns(project, state); return;
    case 'page-next': data.pageNo += 1; data.page = { ...data.page, pageNo: data.pageNo }; actLoadRuns(project, state); return;
    case 'filter-menu': actOpenFilterMenu(project, state, target, target.dataset.key); return;
    case 'dispatch': actDispatchDialog(project, state, actWorkflow(data, data.page.workflowId)); return;
    case 'workflow-menu': actWorkflowMenu(project, state, target, actWorkflow(data, data.page.workflowId)); return;
    case 'enable': actEditNow(project, state, { kind: 'enable', workflowId: Number(data.page.workflowId) }, () => actWorkflowChanged(project, state, repo.path, data.page.workflowId)); return;
    case 'view-workflow-file': {
      const workflow = actWorkflow(data, data.page.workflowId);
      if (workflow && !workflow.dynamic) actOpenFile(project, state, workflow.path, data.repo?.defaultBranch || 'HEAD');
      return;
    }
    default:
      if (typeof actOnRunClick === 'function' && actOnRunClick(project, state, data, target, e)) return;
      if (typeof actOnManageClick === 'function') actOnManageClick(project, state, data, target, e);
  }
}

function actOpenWeb(url, title) {
  if (!url) return;
  if (typeof openWebPagePanel === 'function') openWebPagePanel({ url, title });
  else window.api?.openExternal?.(url);
}

function actOpenGitHubPage(data, page) {
  const AM = actModel();
  if (!data.repo) return;
  const spec = AM.GITHUB_PAGES[page];
  actOpenWeb(AM.githubPage(data.repo, page), spec ? spec.label : 'GitHub');
}

function actOpenFile(project, state, filePath, ref) {
  actGo(project, state, { kind: 'file', path: filePath, ref });
}

function actRunMenu(project, state, button, run) {
  if (!run) return;
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const run2 = { ...run };
  const handlers = {
    'view-file': () => actGo(project, state, { kind: 'run', runId: run.id, attempt: null, tab: 'workflow' }),
    cancel: () => actConfirm(project, state, { title: `Cancel workflow run #${run.number}?`, bodyHtml: `<p>${escapeHtml(run.title)}</p>`, primaryLabel: 'Cancel run', danger: true, cancelLabel: 'Keep running', params: { kind: 'cancel', runId: run.id } }),
    rerun: () => actRerunDialog(project, state, run2, { failedOnly: false }),
    'rerun-failed': () => actRerunDialog(project, state, run2, { failedOnly: true }),
    approve: () => actConfirm(project, state, { title: 'Approve and run', bodyHtml: '<p>This pull request comes from a fork. Approving runs its workflows with this repository\'s settings: read its changes first.</p>', primaryLabel: 'Approve and run', params: { kind: 'approve-fork', runId: run.id } }),
    web: () => actOpenWeb(run.url, `${run.workflow} #${run.number}`),
    browser: () => window.api?.openExternal?.(run.url),
    delete: () => actConfirm(project, state, { title: 'Delete workflow run?', bodyHtml: `<p>Are you sure you want to permanently delete this workflow run? This cannot be undone.</p><p class="act-subtle">${escapeHtml(actRunMetaText(run))}</p>`, primaryLabel: 'Yes, permanently delete this workflow run', danger: true, params: { kind: 'delete-run', runId: run.id }, after: () => { if (data.page.kind === 'run' && String(data.page.runId) === String(run.id)) actBack(project, state); } }),
  };
  showContextMenu(actRunMenuItems(run, { canWrite: actCanWrite(data) }).map(item => (item.sep ? { sep: true } : {
    label: item.label, danger: !!item.danger, onClick: handlers[item.key],
  })), { anchor: button });
}

function actWorkflowMenu(project, state, button, workflow) {
  if (!workflow) return;
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const canWrite = actCanWrite(data);
  const items = [];
  if (!workflow.dynamic) items.push({ label: 'View workflow file', onClick: () => actOpenFile(project, state, workflow.path, data.repo?.defaultBranch || 'HEAD') });
  items.push({ label: 'Create status badge', onClick: () => actBadgeDialog(project, state, workflow) });
  if (canWrite && !workflow.dynamic) {
    items.push({ sep: true });
    if (workflow.state === 'active') items.push({ label: 'Disable workflow', danger: true, onClick: () => actConfirm(project, state, { title: 'Disable workflow?', bodyHtml: `<p>${escapeHtml(workflow.name)} stops running on its triggers until it is enabled again. Runs already going go on; re-runs are refused while it is disabled.</p>`, primaryLabel: 'Disable workflow', danger: true, params: { kind: 'disable', workflowId: workflow.id }, after: () => actWorkflowChanged(project, state, repo.path, workflow.id) }) });
    else items.push({ label: 'Enable workflow', onClick: () => actEditNow(project, state, { kind: 'enable', workflowId: workflow.id }, () => actWorkflowChanged(project, state, repo.path, workflow.id)) });
  }
  items.push({ sep: true }, { label: 'Open on GitHub here', onClick: () => actOpenWeb(workflow.url && data.repo ? `https://${data.repo.host}/${data.repo.owner}/${data.repo.repo}/actions/workflows/${encodeURIComponent(workflow.file)}` : workflow.url, workflow.name) });
  showContextMenu(items, { anchor: button });
}

// --- Dialogs ---

/**
 * A confirmation that runs one change (actions-edits.js): its error stays in
 * the dialog, success closes it, shows GitHub's words and reads again.
 */
function actConfirm(project, state, { title, bodyHtml, primaryLabel, danger = false, cancelLabel = 'Cancel', params, focusSelector = '.gg-dialog-cancel', after = null }) {
  const repo = actSelectedRepo(state);
  if (!repo) return null;
  const data = actRepoState(project.id, state, repo.path);
  state.dialogOpen = true;
  const handle = gitGraphOpenDialog({
    title,
    bodyHtml,
    primaryLabel,
    cancelLabel,
    primaryDanger: danger,
    focusSelector,
    onCancel: () => { state.dialogOpen = false; },
    onSubmit: async () => {
      const values = typeof params === 'function' ? params(handle.dialog) : params;
      const result = await actApi('editActions', project.id, repo.path, actRemoteOpts(data, values));
      if (!result?.ok) throw new Error(result?.error || 'GitHub did not do it.');
      handle.close();
      state.dialogOpen = false;
      actSetNotice(project, state, { kind: 'ok', text: result.message || 'Done.' });
      if (after) after(result);
      // GitHub takes a moment to show a new run, a cancelled one or a re-run.
      actRefreshSoon(project, state);
    },
  });
  handle.dialog.classList.add('pr-dialog', 'act-dialog');
  return handle;
}

/** A workflow enabled or disabled: its state and whether it can run are read again. */
function actWorkflowChanged(project, state, repoPath, workflowId) {
  actRepoState(project.id, state, repoPath).dispatch.delete(`${workflowId}@`);
  actLoadWorkflows(project, state, repoPath);
}

/** A change that needs no confirming (as GitHub's Enable workflow): done, then a notice either way. */
async function actEditNow(project, state, params, after = null) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const result = await actApi('editActions', project.id, repo.path, actRemoteOpts(data, params));
  actSetNotice(project, state, result?.ok ? { kind: 'ok', text: result.message || 'Done.' } : { kind: 'error', text: result?.error || 'GitHub did not do it.' });
  if (result?.ok && after) after(result);
  actRefreshSoon(project, state);
}

function actRerunDialog(project, state, run, { failedOnly = false, jobId = null, jobName = '' } = {}) {
  const body = `
    <p>${jobId ? `This re-runs ${escapeHtml(jobName)} and the jobs that depend on it.` : failedOnly ? 'This re-runs the failed jobs and the jobs that depend on them.' : 'This re-runs every job of the run.'}</p>
    <label class="act-check"><input type="checkbox" id="act-debug"> <span>Enable debug logging</span></label>
    <p class="act-subtle">Re-runs use the run's commit, ref and actor. GitHub allows them for 30 days after the run, 50 at most.</p>`;
  return actConfirm(project, state, {
    title: jobId ? `Re-run ${jobName}` : (failedOnly ? 'Re-run failed jobs' : 'Re-run all jobs'),
    bodyHtml: body,
    primaryLabel: 'Re-run jobs',
    focusSelector: '.gg-dialog-primary',
    params: (dialog) => {
      const debug = !!dialog.querySelector('#act-debug')?.checked;
      if (jobId) return { kind: 'rerun-job', jobId: Number(jobId), debug };
      return { kind: 'rerun', runId: Number(run.id), failedOnly, debug };
    },
  });
}

function actBadgeDialog(project, state, workflow) {
  const AM = actModel();
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  if (!data.repo) return;
  const form = data.dispatch.get(`${workflow.id}@`)?.data;
  const events = (form?.events || []).length ? form.events : ['push', 'pull_request', 'schedule', 'workflow_dispatch'];
  const base = { name: workflow.name, host: data.repo.host, owner: data.repo.owner, repo: data.repo.repo, file: workflow.file };
  const markdown = (branch, event) => AM.badgeMarkdown({ ...base, branch, event });
  const body = `
    <div class="act-form">
      <label class="act-field"><span>Branch</span><input type="text" id="act-badge-branch" placeholder="Default branch" value="" spellcheck="false"></label>
      <label class="act-field"><span>Event</span><select id="act-badge-event"><option value="">Default</option>${events.map(e => `<option value="${actAttr(e)}">${escapeHtml(e)}</option>`).join('')}</select></label>
      <label class="act-field"><span>Markdown</span><textarea id="act-badge-md" rows="3" readonly spellcheck="false">${escapeHtml(markdown('', ''))}</textarea></label>
    </div>`;
  state.dialogOpen = true;
  const handle = gitGraphOpenDialog({
    title: 'Create status badge',
    bodyHtml: body,
    primaryLabel: 'Copy status badge Markdown',
    focusSelector: '#act-badge-branch',
    onCancel: () => { state.dialogOpen = false; },
    onSubmit: async () => {
      window.api?.writeClipboard?.(handle.dialog.querySelector('#act-badge-md').value);
      handle.close();
      state.dialogOpen = false;
      actSetNotice(project, state, { kind: 'ok', text: 'The status badge\'s Markdown is copied.' });
    },
  });
  handle.dialog.classList.add('pr-dialog', 'act-dialog');
  const update = () => {
    handle.dialog.querySelector('#act-badge-md').value = markdown(handle.dialog.querySelector('#act-badge-branch').value.trim(), handle.dialog.querySelector('#act-badge-event').value);
  };
  handle.dialog.querySelector('#act-badge-branch').oninput = update;
  handle.dialog.querySelector('#act-badge-event').onchange = update;
}

/** One "Run workflow" field, as GitHub draws it for its type. */
function actDispatchFieldHtml(field, environments = []) {
  const id = `act-in-${field.name}`;
  const label = `${escapeHtml(field.description || field.name)}${field.required ? ' <span class="act-required" title="Required">*</span>' : ''}`;
  const name = `data-input="${actAttr(field.name)}"`;
  if (field.type === 'boolean') {
    return `<label class="act-check act-field--bool"><input type="checkbox" id="${actAttr(id)}" ${name}${field.default === 'true' ? ' checked' : ''}> <span>${label}</span></label>`;
  }
  let control;
  if (field.type === 'choice') {
    control = `<select id="${actAttr(id)}" ${name}>${field.options.map(o => `<option value="${actAttr(o)}"${o === field.default ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
  } else if (field.type === 'environment' && environments.length) {
    control = `<select id="${actAttr(id)}" ${name}>${field.required ? '' : '<option value=""></option>'}${environments.map(e => `<option value="${actAttr(e)}"${e === field.default ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select>`;
  } else {
    control = `<input type="${field.type === 'number' ? 'number' : 'text'}" id="${actAttr(id)}" ${name} value="${actAttr(field.default)}" spellcheck="false"${field.type === 'number' ? ' step="any"' : ''}>`;
  }
  return `<label class="act-field"><span>${label}</span>${control}<span class="act-field-error" data-error-for="${actAttr(field.name)}" hidden></span></label>`;
}

function actDispatchFieldsHtml(form) {
  if (!form) return actLoadingHtml('Reading the workflow\'s inputs…');
  if (form.error) return `<div class="act-field-error">${escapeHtml(form.error)}</div>`;
  if (!form.available) return `<div class="act-banner act-banner--warn"><span>${escapeHtml(form.reason || 'This workflow cannot be run from here.')}</span></div>`;
  if (!form.fields.length) return '<p class="act-subtle">This workflow takes no inputs.</p>';
  return form.fields.map(f => actDispatchFieldHtml(f, form.environments || [])).join('');
}

/** The form's values as GitHub takes them: strings, "true"/"false" for checkboxes. */
function actDispatchValues(dialog) {
  const values = {};
  dialog.querySelectorAll('[data-input]').forEach((el) => {
    values[el.dataset.input] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
  });
  return values;
}

/** "Run workflow": the ref ("Use workflow from"), the inputs of the file at that ref, then the run it started. */
function actDispatchDialog(project, state, workflow) {
  const AM = actModel();
  if (!workflow) return null;
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  let form = data.dispatch.get(`${workflow.id}@`)?.data || null;
  let ref = form?.ref || data.repo?.defaultBranch || '';
  const body = `
    <div class="act-form">
      <label class="act-field"><span>Use workflow from</span><input type="text" id="act-dispatch-ref" list="act-dispatch-refs" value="${actAttr(ref)}" spellcheck="false" autocomplete="off" title="A branch or a tag"><datalist id="act-dispatch-refs"></datalist></label>
      <div id="act-dispatch-fields">${actDispatchFieldsHtml(form)}</div>
    </div>`;
  state.dialogOpen = true;
  const handle = gitGraphOpenDialog({
    title: `Run ${workflow.name}`,
    bodyHtml: body,
    primaryLabel: 'Run workflow',
    focusSelector: '#act-dispatch-ref',
    onCancel: () => { state.dialogOpen = false; },
    onSubmit: async () => {
      if (!form || !form.available) throw new Error(form?.reason || 'This workflow cannot be run at that branch or tag.');
      const checked = AM.validateDispatch(form.fields, actDispatchValues(handle.dialog));
      handle.dialog.querySelectorAll('[data-error-for]').forEach((el) => {
        const message = checked.errors && checked.errors[el.dataset.errorFor];
        el.hidden = !message;
        el.textContent = message || '';
      });
      if (checked.error) throw new Error(checked.error);
      const result = await actApi('editActions', project.id, repo.path, actRemoteOpts(data, { kind: 'dispatch', workflowId: workflow.id, ref, inputs: checked.inputs }));
      if (!result?.ok) throw new Error(result?.error || 'GitHub did not run it.');
      handle.close();
      state.dialogOpen = false;
      actSetNotice(project, state, { kind: 'ok', text: result.message || 'Workflow run was successfully requested.' });
      if (result.runId) actGo(project, state, { kind: 'run', runId: result.runId, attempt: null, tab: 'summary' });
      else actRefreshSoon(project, state);
    },
  });
  handle.dialog.classList.add('pr-dialog', 'act-dialog', 'act-dispatch');
  const refInput = handle.dialog.querySelector('#act-dispatch-ref');
  const list = handle.dialog.querySelector('#act-dispatch-refs');
  const fieldsSlot = handle.dialog.querySelector('#act-dispatch-fields');
  const readForm = async (value) => {
    ref = value;
    fieldsSlot.innerHTML = actDispatchFieldsHtml(null);
    const answer = await actApi('getActionsDispatchForm', project.id, repo.path, actRemoteOpts(data, { workflowId: workflow.id, ref: value || null }));
    if (!handle.overlay.isConnected || ref !== value) return;
    form = answer?.ok ? answer : { error: answer?.error || 'The workflow\'s inputs could not be read.' };
    fieldsSlot.innerHTML = actDispatchFieldsHtml(form);
  };
  const fillRefs = async (query) => {
    const refs = await actApi('getActionsRefs', project.id, repo.path, actRemoteOpts(data, { query: query || null }));
    if (!refs?.ok || !handle.overlay.isConnected) return;
    list.innerHTML = [...(refs.branches || []), ...(refs.tags || [])].map(name => `<option value="${actAttr(name)}">`).join('');
  };
  let timer = null;
  refInput.oninput = () => { clearTimeout(timer); timer = setTimeout(() => fillRefs(refInput.value.trim()), 250); };
  refInput.onchange = () => { const value = refInput.value.trim(); if (value && value !== ref) readForm(value); };
  fillRefs('');
  if (!form) readForm(ref);
  return handle;
}

// --- Reading ---

async function actLoadWorkflows(project, state, repoPath, { quiet = false } = {}) {
  const data = actRepoState(project.id, state, repoPath);
  const entry = data.workflows;
  const request = ++actSeq;
  entry.request = request;
  entry.loading = true;
  if (!quiet) actPaintSide(project, state);
  const result = await actApi('getActionsWorkflows', project.id, repoPath, actRemoteOpts(data));
  if (entry.request !== request) return;
  entry.loading = false;
  if (Array.isArray(result.remotes)) data.remotes = result.remotes;
  if (result.ok) {
    entry.data = { workflows: result.workflows || [], lockfile: !!result.lockfile };
    entry.error = null;
    entry.errorCode = null;
    entry.loadedAt = Date.now();
    data.repo = result.repo || data.repo;
    if (result.rate) data.rate = result.rate;
  } else {
    entry.error = result.error;
    entry.errorCode = result.code || null;
  }
  const body = actActiveBody(project);
  if (body && state.selectedRepo === repoPath) {
    const slot = body.querySelector('#act-remote-slot');
    if (slot && !slot.querySelector('select:focus')) { slot.innerHTML = actRemoteSelectHtml(data); }
    actPaintSide(project, state);
    if (!result.ok && data.page.kind === 'runs') {
      const main = body.querySelector('#act-main');
      if (main) main.innerHTML = actErrorHtml(entry);
    } else if (data.page.kind === 'runs' && data.page.workflowId) {
      actPaintMain(project, state);
      actLoadDispatchInfo(project, state, repoPath, data.page.workflowId);
    } else {
      const summary = body.querySelector('#act-summary');
      if (summary) summary.textContent = actSummaryText(data);
    }
  }
}

async function actLoadRuns(project, state, { quiet = false } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const key = actRunsKey(data);
  if (!data.runs.has(key)) data.runs.set(key, actEntry());
  const entry = data.runs.get(key);
  const request = ++actSeq;
  entry.request = request;
  entry.loading = true;
  if (!quiet) actPaintMain(project, state);
  const result = await actApi('getActionsRuns', project.id, repo.path, actRemoteOpts(data, {
    workflowId: data.page.workflowId || null, page: data.pageNo, perPage: 25, query: data.query.trim(),
  }));
  if (entry.request !== request) return;
  entry.loading = false;
  if (Array.isArray(result.remotes)) data.remotes = result.remotes;
  if (result.ok) {
    entry.data = result;
    entry.error = null;
    entry.loadedAt = Date.now();
    if (result.rate) data.rate = result.rate;
  } else {
    entry.error = result.error;
    entry.errorCode = result.code || null;
    if (quiet && entry.data) actSetNotice(project, state, { kind: 'error', text: result.error });
  }
  // Keep the map small: the pages read last stay.
  while (data.runs.size > 40) data.runs.delete(data.runs.keys().next().value);
  if (state.selectedRepo === repo.path && data.page.kind === 'runs' && actRunsKey(data) === key) actPaintMain(project, state);
  actSchedule(project, state);
}

async function actLoadDispatchInfo(project, state, repoPath, workflowId) {
  const data = actRepoState(project.id, state, repoPath);
  const workflow = actWorkflow(data, workflowId);
  if (!workflow || workflow.dynamic) return;
  const key = `${workflow.id}@`;
  if (!data.dispatch.has(key)) data.dispatch.set(key, actEntry());
  const entry = data.dispatch.get(key);
  if (entry.loading || (entry.data && Date.now() - entry.loadedAt < ACT_STALE_MS)) return;
  entry.loading = true;
  const result = await actApi('getActionsDispatchForm', project.id, repoPath, actRemoteOpts(data, { workflowId: workflow.id }));
  entry.loading = false;
  if (result.ok) { entry.data = result; entry.loadedAt = Date.now(); } else { entry.error = result.error; }
  if (data.page.kind === 'runs' && String(data.page.workflowId) === String(workflow.id)) actPaintMain(project, state);
}

async function actLoadFile(project, state, filePath, ref) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const key = `${filePath}@${ref}`;
  if (!data.files.has(key)) data.files.set(key, actEntry());
  const entry = data.files.get(key);
  entry.loading = true;
  actPaintMain(project, state);
  const result = await actApi('getActionsWorkflowFile', project.id, repo.path, actRemoteOpts(data, { path: filePath, ref }));
  entry.loading = false;
  if (result.ok) { entry.data = result; entry.error = null; } else { entry.error = result.error; entry.errorCode = result.code || null; }
  if (data.page.kind === 'file' && data.page.path === filePath && data.page.ref === ref) actPaintMain(project, state);
}

/** What the page on screen needs, read now. */
function actLoadPage(project, state, { quiet = false } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo || repo.git === false) return;
  const data = actRepoState(project.id, state, repo.path);
  const page = data.page;
  if (page.kind === 'runs') {
    actLoadRuns(project, state, { quiet });
    if (page.workflowId) actLoadDispatchInfo(project, state, repo.path, page.workflowId);
  } else if (page.kind === 'file') {
    actLoadFile(project, state, page.path, page.ref);
  } else if ((page.kind === 'run' || page.kind === 'job') && typeof actLoadRun === 'function') {
    actLoadRun(project, state, page.runId, page.attempt, { quiet });
    if (page.kind === 'job') actLoadJob(project, state, page.jobId, { quiet });
  } else if (typeof actLoadManagePage === 'function') {
    actLoadManagePage(project, state, page, { quiet });
  }
}

/** Read the workflows (when never read, or long ago) and the page on screen. */
function actEnsureLoaded(project, state) {
  const repo = actSelectedRepo(state);
  if (!repo || repo.git === false) return;
  const data = actRepoState(project.id, state, repo.path);
  if (!data.workflows.loading && (!data.workflows.data || Date.now() - data.workflows.loadedAt > 5 * ACT_STALE_MS)) actLoadWorkflows(project, state, repo.path);
  actLoadPage(project, state, { quiet: true });
}

function actRefresh(project, state, { notice = false } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  if (notice) actSetNotice(project, state, null);
  actLoadWorkflows(project, state, repo.path, { quiet: true });
  actLoadPage(project, state, { quiet: true });
}

/**
 * After a change: GitHub shows a new or cancelled run a moment later, and its
 * copies catch up over a few seconds, so a first read can still give the old
 * state. Read twice; with ETags, the second costs nothing when nothing changed.
 */
const ACT_AFTER_CHANGE_MS = [2500, 8000];

function actRefreshSoon(project, state) {
  for (const ms of ACT_AFTER_CHANGE_MS) setTimeout(() => { if (actActiveBody(project)) actLoadPage(project, state, { quiet: true }); }, ms);
}

// --- Reading again by itself ---

/** How long until the page on screen is read again: 5 s while a run or job runs, 30 s for lists, slower in the background. */
function actPollDelay(data, { focused = true } = {}) {
  const AM = actModel();
  if (data.rate && data.rate.remaining < ACT_LOW_BUDGET) return null;
  const page = data.page;
  let delay = null;
  if (page.kind === 'runs') delay = ACT_LIST_POLL_MS;
  else if (page.kind === 'run' || page.kind === 'job') {
    const entry = data.run.get(actRunKey(page.runId, page.attempt));
    const run = entry?.data?.run;
    const job = page.kind === 'job' ? data.job.get(String(page.jobId))?.data?.job : null;
    if ((run && AM.runStillGoing(run, entry.data.jobs)) || (job && AM.isActive(job.status))) delay = ACT_RUN_POLL_MS;
  } else if (page.kind === 'deployments') delay = ACT_LIST_POLL_MS;
  if (delay !== null && !focused) delay = Math.max(delay, ACT_BACKGROUND_POLL_MS);
  return delay;
}

function actSchedule(project, state) {
  clearTimeout(state.timer);
  state.timer = null;
  const repo = actSelectedRepo(state);
  if (!repo || !actActiveBody(project)) return;
  const data = actRepoState(project.id, state, repo.path);
  const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  const delay = actPollDelay(data, { focused });
  if (data.rate && data.rate.remaining < ACT_LOW_BUDGET && !state.notice) {
    const at = data.rate.resetAt ? new Date(data.rate.resetAt).toTimeString().slice(0, 5) : 'within the hour';
    actSetNotice(project, state, { kind: 'error', text: `GitHub's hourly budget for this account is almost used up (${data.rate.remaining} requests left): the view stops reading by itself until ${at}. Refresh still works.` });
  }
  if (delay === null) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (!actActiveBody(project) || state.dialogOpen) { actSchedule(project, state); return; }
    actLoadPage(project, state, { quiet: true });
  }, delay);
}

function renderProjectActionsTab(project, body) {
  const state = actTabState(project.id);
  body.className = 'git-workspace-view git-tab-body act-tab-body';
  if (!state.selectedRepo) {
    // The repository chosen in another Git view, the first time.
    const pulls = typeof prTabState === 'function' ? prTabState(project.id).selectedRepo : null;
    const history = typeof gitGraphState === 'function' ? gitGraphState(project.id).selectedRepo : null;
    const changes = typeof gitTabState === 'function' ? gitTabState(project.id).selectedRepo : null;
    state.selectedRepo = pulls || history || changes || null;
  }
  const paths = typeof prRepoPaths === 'function' ? prRepoPaths(project) : [];
  const stale = !!state.repositories && typeof prSameSet === 'function' && !prSameSet((state.repositories || []).map(r => r.path), paths);
  if (state.repositories && !stale) {
    actPaint(project, state, body);
    actEnsureLoaded(project, state);
    actSchedule(project, state);
    return;
  }
  if (!state.repositories) body.innerHTML = '<div class="git-loading"><span class="git-loading-dot"></span>Reading repositories…</div>';
  const load = typeof prLoadRepositories === 'function' ? prLoadRepositories(project, state) : Promise.resolve();
  load.then(() => {
    const active = actActiveBody(project);
    if (!active) return;
    actPaint(project, state, active);
    actEnsureLoaded(project, state);
    actSchedule(project, state);
  });
}

/** Open a run (or one of its jobs) in the Actions view: from a pull request's checks, a deployment's log. */
function openActionsRun(project, { repoPath = null, runId, jobId = null, attempt = null } = {}) {
  if (!project || !runId) return;
  const state = actTabState(project.id);
  if (repoPath) state.selectedRepo = repoPath;
  const repo = repoPath || state.selectedRepo;
  if (repo) {
    const data = actRepoState(project.id, state, repo);
    data.stack.push(data.page);
    data.page = jobId ? { kind: 'job', runId: Number(runId), jobId: Number(jobId), attempt } : { kind: 'run', runId: Number(runId), attempt, tab: 'summary' };
  }
  if (typeof setProjectGitView === 'function') setProjectGitView(project, 'actions');
  const workspace = typeof document !== 'undefined' ? document.querySelector('.git-workspace-body') : null;
  if (workspace && typeof renderProjectGitWorkspace === 'function') renderProjectGitWorkspace(project, workspace);
}

// Back to the window: what changed on GitHub meanwhile shows up, and the polling speeds up again.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('focus', () => {
    const project = typeof selectedProject === 'function' ? selectedProject() : null;
    if (!project || !actActiveBody(project)) return;
    const state = actTabState(project.id);
    if (state.dialogOpen) return;
    actEnsureLoaded(project, state);
    actSchedule(project, state);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ACT_ICONS, actTabState, actRepoData, actRepoState, actRunsKey, actRunKey, actStateIcon, actSideHtml, actRunSideHtml,
    actRunRowHtml, actRunMetaText, actDurationText, actRunMenuItems, actFiltersHtml, actWorkflowHeadHtml, actRunsListHtml,
    actCountText, actErrorHtml, actPollDelay, actDispatchFieldHtml, actDispatchFieldsHtml, actSummaryText,
  };
}
