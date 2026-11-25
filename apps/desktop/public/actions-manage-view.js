// Management in the Actions view (project-actions-view.js), as GitHub's
// Actions tab lists it: Caches (what they take together, filtered by branch
// and key, sorted, deleted one by one), Deployments (each environment with its
// active deployment, the deployments newest first, a log on GitHub Actions
// opening in the view) and Runners (the repository's self-hosted runners, for
// its admins: Idle, Active or Offline, their labels, Remove). GitHub-hosted
// runners, Attestations and the metrics are pages of GitHub, opened in the app.

// --- Reading ---

function actLoadManagePage(project, state, page, { quiet = false } = {}) {
  if (page.kind === 'caches') actLoadCaches(project, state, { quiet });
  else if (page.kind === 'runners') actLoadRunners(project, state, { quiet });
  else if (page.kind === 'deployments') actLoadDeployments(project, state, { quiet });
}

async function actLoadInto(project, state, entry, method, opts, { quiet = false, kind } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo) return null;
  const data = actRepoState(project.id, state, repo.path);
  const request = ++actSeq;
  entry.request = request;
  entry.loading = true;
  if (!quiet && !entry.data) actPaintMain(project, state);
  const result = await actApi(method, project.id, repo.path, actRemoteOpts(data, opts));
  if (entry.request !== request) return null;
  entry.loading = false;
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
  if (data.page.kind === kind) actPaintMain(project, state);
  actSchedule(project, state);
  return result;
}

function actLoadCaches(project, state, opts) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const o = data.caches.opts;
  return actLoadInto(project, state, data.caches.entry, 'getActionsCaches', {
    ref: o.ref ? `refs/heads/${o.ref}` : null, key: o.key || null, sort: o.sort, direction: o.direction, page: o.page,
  }, { ...opts, kind: 'caches' });
}

function actLoadRunners(project, state, opts) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  return actLoadInto(project, state, data.runners, 'getActionsRunners', {}, { ...opts, kind: 'runners' });
}

async function actLoadDeployments(project, state, opts = {}) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  data.deployments.more = [];
  return actLoadInto(project, state, data.deployments.entry, 'getActionsDeployments', { environment: data.deployments.environment || null }, { ...opts, kind: 'deployments' });
}

async function actLoadMoreDeployments(project, state) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const d = data.deployments;
  const last = d.more.length ? d.more[d.more.length - 1] : d.entry.data;
  if (!last || !last.hasNextPage) return;
  const result = await actApi('getActionsDeployments', project.id, repo.path, actRemoteOpts(data, { environment: d.environment || null, after: last.endCursor }));
  if (result?.ok) d.more.push(result);
  else actSetNotice(project, state, { kind: 'error', text: result?.error || 'More deployments could not be read.' });
  actPaintMain(project, state);
}

// --- Caches ---

function actCachesHtml(data, { now = new Date() } = {}) {
  const AM = actModel();
  const { opts, entry } = data.caches;
  const canWrite = actCanWrite(data);
  const sorts = [['last_accessed_at', 'Last used'], ['created_at', 'Created'], ['size_in_bytes', 'Size']];
  const head = `
    <div class="act-page-head"><div class="act-page-title"><h2>Caches</h2>${entry.data?.usage ? `<span class="act-subtle">${actPlural(entry.data.usage.count, 'cache')} · ${escapeHtml(AM.formatBytes(entry.data.usage.size))} in all</span>` : ''}</div>
      <div class="act-page-actions"><button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="nav-github" data-page="caches" title="Open GitHub's Caches page here">${ACT_ICONS.globe(12)}</button></div></div>
    <div class="act-filters">
      <label class="pr-search act-search" title="Caches whose key starts with this">${PICONS.search(12)}<input type="search" id="act-cache-key" placeholder="Filter caches by key" autocomplete="off" spellcheck="false" value="${actAttr(opts.key)}"></label>
      <label class="pr-search act-search act-search--small" title="Caches of one branch">${PICONS.branch(12)}<input type="search" id="act-cache-ref" placeholder="Branch" autocomplete="off" spellcheck="false" value="${actAttr(opts.ref)}"></label>
      <div class="act-filter-menus">
        <select class="ws-select" id="act-cache-sort" aria-label="Sort caches">${sorts.map(([v, l]) => `<option value="${v}"${opts.sort === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
        <button type="button" class="ws-btn ws-btn--sm" data-act="cache-direction" title="Order">${opts.direction === 'desc' ? 'Newest/largest first' : 'Oldest/smallest first'}</button>
      </div>
    </div>`;
  if (!entry.data && entry.loading) return head + actLoadingHtml('Reading caches…');
  if (!entry.data && entry.error) return head + actErrorHtml(entry, 'The caches');
  const caches = entry.data?.caches || [];
  if (!caches.length) return `${head}<div class="act-empty-list">${opts.key || opts.ref ? 'No caches match.' : 'This repository has no caches.'}</div>`;
  const pages = Math.max(1, Math.ceil((entry.data.total || 0) / (entry.data.perPage || 30)));
  return `${head}
    <div class="act-table act-caches" role="table">
      <div class="act-tr act-th" role="row"><span role="columnheader">Key</span><span role="columnheader">Size</span><span role="columnheader">Branch</span><span role="columnheader">Last used</span><span role="columnheader"></span></div>
      ${caches.map(c => `
        <div class="act-tr" role="row">
          <span role="cell" class="act-mono act-cache-key" title="${actAttr(`${c.key}\nversion ${c.version}\ncreated ${c.createdAt || ''}`)}">${escapeHtml(c.key)}</span>
          <span role="cell">${escapeHtml(AM.formatBytes(c.size))}</span>
          <span role="cell"><span class="act-branch">${escapeHtml(c.ref.replace(/^refs\/heads\//, ''))}</span></span>
          <span role="cell" title="${actAttr(c.lastAccessedAt || '')}">${escapeHtml(actRelative(c.lastAccessedAt, now))}</span>
          <span role="cell">${canWrite ? `<button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="cache-delete" data-id="${actAttr(c.id)}" data-key="${actAttr(c.key)}" title="Delete cache" aria-label="Delete cache ${actAttr(c.key)}">${PICONS.trash(12)}</button>` : ''}</span>
        </div>`).join('')}
    </div>
    ${pages > 1 ? `<div class="act-pager"><button type="button" class="ws-btn ws-btn--sm" data-act="cache-page" data-by="-1"${opts.page <= 1 ? ' disabled' : ''}>Previous</button><span>Page ${opts.page} of ${pages}</span><button type="button" class="ws-btn ws-btn--sm" data-act="cache-page" data-by="1"${opts.page >= pages ? ' disabled' : ''}>Next</button></div>` : ''}`;
}

function actPaintCachesPage(project, state, main, data) {
  const typing = main.contains(document.activeElement) && /^act-cache-/.test(document.activeElement.id || '');
  if (typing) return;
  main.innerHTML = actCachesHtml(data);
  const o = data.caches.opts;
  const apply = () => {
    const key = main.querySelector('#act-cache-key').value.trim();
    const ref = main.querySelector('#act-cache-ref').value.trim();
    if (key === o.key && ref === o.ref) return;
    o.key = key; o.ref = ref; o.page = 1;
    actLoadCaches(project, state);
  };
  for (const id of ['#act-cache-key', '#act-cache-ref']) {
    const input = main.querySelector(id);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
    input.onblur = apply;
    input.addEventListener('search', apply);
  }
  main.querySelector('#act-cache-sort').onchange = (e) => { o.sort = e.target.value; o.page = 1; actLoadCaches(project, state); };
}

// --- Runners ---

function actRunnersHtml(data) {
  const entry = data.runners;
  const canAdmin = !!entry.data?.admin;
  const head = `
    <div class="act-page-head"><div class="act-page-title"><h2>Runners</h2><span class="act-subtle">Self-hosted runners of this repository</span></div>
      <div class="act-page-actions">
        <button type="button" class="ws-btn ws-btn--sm" data-act="nav-github" data-page="runners" title="GitHub-hosted runners and the organization's runners, on GitHub">${ACT_ICONS.globe(11)}<span>GitHub-hosted runners</span></button>
        ${canAdmin ? `<button type="button" class="ws-btn ws-btn--sm ws-btn--primary" data-act="nav-github" data-page="newRunner" title="GitHub's page with the commands that add one">${ACT_ICONS.globe(11)}<span>New self-hosted runner</span></button>` : ''}
      </div></div>`;
  if (!entry.data && entry.loading) return head + actLoadingHtml('Reading runners…');
  if (!entry.data && entry.error) return head + actErrorHtml(entry, 'The runners');
  if (!entry.data) return head;
  if (!canAdmin) return `${head}<div class="act-empty-list">GitHub shows a repository's self-hosted runners to its admins only, and your account is not one of them here.</div>`;
  const runners = entry.data.runners || [];
  if (!runners.length) return `${head}<div class="act-empty-list">This repository has no self-hosted runners. Its jobs run on GitHub-hosted runners, or on the organization's.</div>`;
  const words = { idle: 'Idle', active: 'Active', offline: 'Offline' };
  return `${head}
    <div class="act-table act-runners" role="table">
      <div class="act-tr act-th" role="row"><span role="columnheader">Runner</span><span role="columnheader">Status</span><span role="columnheader">Labels</span><span role="columnheader"></span></div>
      ${runners.map(r => `
        <div class="act-tr" role="row">
          <span role="cell"><strong>${escapeHtml(r.name)}</strong> <span class="act-subtle">${escapeHtml(r.os)}${r.ephemeral ? ' · ephemeral' : ''}</span></span>
          <span role="cell"><span class="act-runner-status act-runner-status--${actAttr(r.status)}">● ${escapeHtml(words[r.status] || r.status)}</span></span>
          <span role="cell">${r.labels.map(l => `<span class="act-label${l.custom ? ' act-label--custom' : ''}">${escapeHtml(l.name)}</span>`).join(' ')}</span>
          <span role="cell"><button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="runner-menu" data-id="${actAttr(r.id)}" title="Runner options" aria-label="Options of ${actAttr(r.name)}">${PICONS.dots(13)}</button></span>
        </div>`).join('')}
    </div>`;
}

function actPaintRunnersPage(project, state, main, data) {
  main.innerHTML = actRunnersHtml(data);
}

// --- Deployments ---

const ACT_DEPLOY_BUCKETS = { active: 'success', success: 'success', inactive: 'neutral', destroyed: 'neutral', abandoned: 'cancelled', failure: 'failure', error: 'failure', in_progress: 'running', queued: 'queued', pending: 'queued', waiting: 'waiting' };

function actDeploymentState(d) {
  const key = d.state === 'active' ? 'active' : (d.status || d.state);
  const bucket = ACT_DEPLOY_BUCKETS[key] || 'neutral';
  const label = key ? `${key.charAt(0).toUpperCase()}${key.slice(1).replace(/_/g, ' ')}` : '';
  return { bucket, label, a11y: label };
}

function actDeploymentsHtml(data, { now = new Date() } = {}) {
  const AM = actModel();
  const d = data.deployments;
  const entry = d.entry;
  const head = `<div class="act-page-head"><div class="act-page-title"><h2>Deployments</h2>${entry.data ? `<span class="act-subtle">${actPlural(entry.data.totalCount || 0, 'deployment')}</span>` : ''}</div>
    <div class="act-page-actions"><button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="nav-github" data-page="deployments" title="Open GitHub's Deployments page here">${ACT_ICONS.globe(12)}</button></div></div>`;
  if (!entry.data && entry.loading) return head + actLoadingHtml('Reading deployments…');
  if (!entry.data && entry.error) return head + actErrorHtml(entry, 'The deployments');
  if (!entry.data) return head;
  const envs = entry.data.environments || [];
  const chips = `<div class="act-env-chips"><button type="button" class="act-chip${!d.environment ? ' is-on' : ''}" data-act="deploy-env" data-env="">All environments</button>${envs.map(e => `<button type="button" class="act-chip${d.environment === e.name ? ' is-on' : ''}" data-act="deploy-env" data-env="${actAttr(e.name)}">${escapeHtml(e.name)}</button>`).join('')}</div>`;
  const active = envs.filter(e => e.active).map(e => `
    <div class="act-env-card">
      <div class="act-env-name">${actStateIcon({ bucket: 'success', label: 'Active', a11y: 'active' }, 13)} ${escapeHtml(e.name)}</div>
      <div class="act-subtle">${escapeHtml(e.active.ref || AM.shortSha(e.active.sha))} · ${escapeHtml(actRelative(e.active.createdAt, now))}${e.active.creator ? ` · ${escapeHtml(e.active.creator)}` : ''}</div>
      ${e.active.environmentUrl ? `<button type="button" class="act-link" data-act="link-view" data-url="${actAttr(e.active.environmentUrl)}" data-title="${actAttr(e.name)}">${escapeHtml(e.active.environmentUrl)}</button>` : ''}
    </div>`).join('');
  const list = [...(entry.data.deployments || []), ...d.more.flatMap(p => p.deployments || [])];
  const last = d.more.length ? d.more[d.more.length - 1] : entry.data;
  const rows = list.map((dep) => {
    const state = actDeploymentState(dep);
    const log = dep.actions
      ? `<button type="button" class="act-link" data-act="deploy-log" data-run="${actAttr(dep.actions.runId)}" data-job="${actAttr(dep.actions.jobId || '')}">View logs</button>`
      : (dep.logUrl ? `<button type="button" class="act-link" data-act="link-view" data-url="${actAttr(dep.logUrl)}" data-title="${actAttr(dep.environment)}">View logs</button>` : '');
    return `
      <div class="act-tr" role="row">
        <span role="cell">${actStateIcon(state, 13)} <strong>${escapeHtml(dep.environment)}</strong> <span class="act-subtle">${escapeHtml(state.label)}</span></span>
        <span role="cell"><span class="act-branch">${escapeHtml(dep.ref || '')}</span> <button type="button" class="act-link act-mono" data-act="open-commit" data-sha="${actAttr(dep.sha)}">${escapeHtml(AM.shortSha(dep.sha))}</button></span>
        <span role="cell">${escapeHtml(dep.creator || '')} · ${escapeHtml(actRelative(dep.createdAt, now))}</span>
        <span role="cell">${log}${dep.environmentUrl ? ` <button type="button" class="act-link" data-act="link-browser" data-url="${actAttr(dep.environmentUrl)}">Open</button>` : ''}</span>
      </div>`;
  }).join('');
  return `${head}${chips}
    ${active ? `<div class="act-section"><div class="act-section-head"><h3>Active deployments</h3></div><div class="act-env-cards">${active}</div></div>` : ''}
    <div class="act-section"><div class="act-section-head"><h3>Deployment history</h3></div>
      ${rows ? `<div class="act-table act-deploys" role="table">${rows}</div>` : '<div class="act-empty-list">No deployments.</div>'}
      ${last?.hasNextPage ? '<div class="act-pager"><button type="button" class="ws-btn ws-btn--sm" data-act="deploy-more">Load more</button></div>' : ''}
    </div>`;
}

function actPaintDeploymentsPage(project, state, main, data) {
  main.innerHTML = actDeploymentsHtml(data);
}

// --- Clicks ---

function actOnManageClick(project, state, data, target) {
  const act = target.dataset.act;
  switch (act) {
    case 'cache-delete':
      actConfirm(project, state, { title: 'Delete cache?', bodyHtml: `<p class="act-mono act-break">${escapeHtml(target.dataset.key)}</p><p>The next run that needs it builds it again.</p>`, primaryLabel: 'Delete cache', danger: true, params: { kind: 'delete-cache', cacheId: Number(target.dataset.id) }, after: () => actLoadCaches(project, state, { quiet: true }) });
      return true;
    case 'cache-page':
      data.caches.opts.page = Math.max(1, data.caches.opts.page + Number(target.dataset.by));
      actLoadCaches(project, state);
      return true;
    case 'cache-direction':
      data.caches.opts.direction = data.caches.opts.direction === 'desc' ? 'asc' : 'desc';
      data.caches.opts.page = 1;
      actLoadCaches(project, state);
      return true;
    case 'runner-menu': {
      const runner = (data.runners.data?.runners || []).find(r => String(r.id) === String(target.dataset.id));
      if (!runner) return true;
      showContextMenu([
        { label: 'Copy label', onClick: () => window.api?.writeClipboard?.(runner.labels.map(l => l.name).join(', ')) },
        { label: 'Edit labels…', onClick: () => actRunnerLabelsDialog(project, state, runner) },
        { sep: true },
        { label: 'Remove runner', danger: true, onClick: () => actConfirm(project, state, { title: `Remove ${runner.name}?`, bodyHtml: '<p>GitHub forgets the runner; the machine keeps its files. To use it again, configure it again.</p>', primaryLabel: 'Remove runner', danger: true, params: { kind: 'runner-remove', runnerId: runner.id }, after: () => actLoadRunners(project, state, { quiet: true }) }) },
      ], { anchor: target });
      return true;
    }
    case 'deploy-env':
      data.deployments.environment = target.dataset.env || null;
      actLoadDeployments(project, state);
      return true;
    case 'deploy-more':
      actLoadMoreDeployments(project, state);
      return true;
    case 'deploy-log': {
      const runId = Number(target.dataset.run);
      const jobId = Number(target.dataset.job) || null;
      actGo(project, state, jobId ? { kind: 'job', runId, jobId, attempt: null } : { kind: 'run', runId, attempt: null, tab: 'summary' });
      return true;
    }
    default:
      // The link tools and commits of a deployment were a run page's clicks (actOnRunClick), tried first.
      return false;
  }
}

function actRunnerLabelsDialog(project, state, runner) {
  const custom = runner.labels.filter(l => l.custom).map(l => l.name);
  const fixed = runner.labels.filter(l => !l.custom).map(l => l.name);
  return actConfirm(project, state, {
    title: `Labels of ${runner.name}`,
    bodyHtml: `
      <div class="act-form">
        <p class="act-subtle">Set by GitHub: ${fixed.map(l => `<span class="act-label">${escapeHtml(l)}</span>`).join(' ') || 'none'}</p>
        <label class="act-field"><span>Custom labels, separated by commas</span><input type="text" id="act-runner-labels" value="${actAttr(custom.join(', '))}" spellcheck="false"></label>
      </div>`,
    primaryLabel: 'Save labels',
    focusSelector: '#act-runner-labels',
    params: (dialog) => ({
      kind: 'runner-labels',
      runnerId: runner.id,
      labels: dialog.querySelector('#act-runner-labels').value.split(',').map(s => s.trim()).filter(Boolean),
    }),
    after: () => actLoadRunners(project, state, { quiet: true }),
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { actCachesHtml, actRunnersHtml, actDeploymentsHtml, actDeploymentState };
}
