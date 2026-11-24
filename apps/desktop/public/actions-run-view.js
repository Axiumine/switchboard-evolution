// A run's pages and a job's page in the Actions view (project-actions-view.js
// holds the view, its state and its sidebar), as GitHub shows them:
//
//   - the run's summary: its title and attempt, Re-run jobs (all or the failed
//     ones, with debug logging), Cancel workflow, what started it, its status
//     and duration, the deployments waiting for a review (Review
//     deployments), a fork's run waiting for approval, the concurrency group
//     it waits in, the graph of its jobs (from the workflow file at the run's
//     commit: columns follow `needs`, a matrix is a group), the annotations,
//     the artifacts (download, delete);
//   - Usage (each job's run time) and Workflow file (the YAML at the run's commit);
//   - a job: its steps, each opening on its log (read when the step has
//     finished, while the job still runs), the log's groups folded, the search
//     through the steps shown, the timestamps, the downloads, and "Follow live
//     on GitHub" for the step running now (GitHub gives no log of it until it ends).

const ACT_LOG_LINES_SHOWN = 4000; // of a long log: its end, as GitHub opens a running job's last lines

// --- Reading ---

async function actLoadRun(project, state, runId, attempt, { quiet = false } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const key = actRunKey(runId, attempt);
  if (!data.run.has(key)) data.run.set(key, actEntry());
  const entry = data.run.get(key);
  const request = ++actSeq;
  entry.request = request;
  entry.loading = true;
  if (!quiet && !entry.data) actRepaintRun(project, state, data);
  const result = await actApi('getActionsRun', project.id, repo.path, actRemoteOpts(data, { runId: Number(runId), attempt: attempt || null }));
  if (entry.request !== request) return;
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
  while (data.run.size > 30) data.run.delete(data.run.keys().next().value);
  actRepaintRun(project, state, data);
  // The run's Workflow file page reads the file at the run's commit.
  if (result.ok && data.page.kind === 'run' && data.page.tab === 'workflow' && !result.workflow?.dynamic) {
    actEnsureFile(project, state, result.run.path, result.run.sha);
  }
  actSchedule(project, state);
}

async function actLoadJob(project, state, jobId, { quiet = false } = {}) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const key = String(jobId);
  if (!data.job.has(key)) data.job.set(key, actEntry());
  const entry = data.job.get(key);
  const request = ++actSeq;
  entry.request = request;
  entry.loading = true;
  if (!quiet && !entry.data) actRepaintRun(project, state, data);
  const result = await actApi('getActionsJob', project.id, repo.path, actRemoteOpts(data, { jobId: Number(jobId) }));
  if (entry.request !== request) return;
  entry.loading = false;
  const before = entry.data?.job || null;
  if (result.ok) {
    entry.data = result;
    entry.error = null;
    entry.loadedAt = Date.now();
    if (result.rate) data.rate = result.rate;
  } else {
    entry.error = result.error;
    entry.errorCode = result.code || null;
  }
  while (data.job.size > 40) data.job.delete(data.job.keys().next().value);
  if (result.ok) actOpenStepsOf(project, state, data, result.job, before);
  actRepaintRun(project, state, data);
  actSchedule(project, state);
}

/**
 * The steps a job opens on, as GitHub does: the failed ones, and the one
 * running now. A step that has just finished while open reads its log.
 */
function actOpenStepsOf(project, state, data, job, before) {
  const key = String(job.id);
  const first = !data.openSteps.has(key);
  if (first) data.openSteps.set(key, new Set());
  const open = data.openSteps.get(key);
  const AM = actModel();
  for (const step of job.steps || []) {
    const was = before && (before.steps || []).find(s => s.number === step.number);
    if (first && (step.conclusion === 'failure' || step.status === 'in_progress')) open.add(step.number);
    // The running step moved on: the next one opens, as GitHub follows it.
    if (!first && step.status === 'in_progress' && was && was.status !== 'in_progress') open.add(step.number);
    if (open.has(step.number) && step.status === 'completed' && (!was || was.status !== 'completed' || !data.stepLogs.has(`${key}/${step.number}`))) {
      actLoadStepLog(project, state, job.id, step.number);
    }
  }
}

async function actLoadStepLog(project, state, jobId, step) {
  const repo = actSelectedRepo(state);
  if (!repo) return;
  const data = actRepoState(project.id, state, repo.path);
  const key = `${jobId}/${step}`;
  const kept = data.stepLogs.get(key);
  if (kept && (kept.loading || kept.text !== undefined)) return;
  data.stepLogs.set(key, { loading: true });
  actRepaintJobSteps(project, state, data);
  const result = await actApi('getActionsStepLog', project.id, repo.path, actRemoteOpts(data, { jobId: Number(jobId), step: Number(step) }));
  data.stepLogs.set(key, result.ok ? { text: result.text, truncated: !!result.truncated } : { error: result.error, pending: !!result.pending });
  while (data.stepLogs.size > 200) data.stepLogs.delete(data.stepLogs.keys().next().value);
  actRepaintJobSteps(project, state, data);
}

function actEnsureFile(project, state, filePath, ref) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const entry = data.files.get(`${filePath}@${ref}`);
  if (entry && (entry.loading || entry.data)) return;
  actLoadFile(project, state, filePath, ref);
}

// --- What a run's summary shows ---

function actLinkToolsHtml(url, label) {
  if (!url) return '';
  const tool = (act, title, icon) => `<button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="${act}" data-url="${actAttr(url)}" data-title="${actAttr(label)}" title="${actAttr(title)}" aria-label="${actAttr(title)}">${icon}</button>`;
  return `<span class="pr-link-tools" role="group" aria-label="${actAttr(label)} on GitHub">${[
    tool('link-copy', `Copy the address: ${url}`, PICONS.link(13)),
    tool('link-view', 'Open here', PICONS.panel(13)),
    tool('link-window', 'Open in a window of its own', PICONS.popOut(13)),
    tool('link-browser', 'Open in the browser', PICONS.globe(13)),
  ].join('')}</span>`;
}

function actRunHeadHtml(answer, { canWrite = false, now = new Date() } = {}) {
  const AM = actModel();
  const run = answer.run;
  const state = AM.runState(run.status, run.conclusion);
  const active = AM.isActive(run.status);
  const attempts = answer.attempts || run.attempt || 1;
  const attemptButton = attempts > 1
    ? `<button type="button" class="ws-btn ws-btn--sm" data-act="attempt-menu" aria-haspopup="menu" title="This run's attempts">${escapeHtml(answer.attempt === attempts ? `Latest #${attempts}` : `Attempt #${answer.attempt}`)}${PICONS.chevronDown(10)}</button>`
    : '';
  const rerun = canWrite && !active ? `<button type="button" class="ws-btn ws-btn--sm" data-act="rerun-menu" aria-haspopup="menu">${PICONS.refresh(11)}<span>Re-run jobs</span>${PICONS.chevronDown(10)}</button>` : '';
  const cancel = canWrite && active ? `<button type="button" class="ws-btn ws-btn--sm ws-btn--danger" data-act="cancel-run">${ACT_ICONS.stop(11)}<span>Cancel workflow</span></button>` : '';
  return `
    <div class="act-page-head">
      <div class="act-page-title">
        <button type="button" class="act-back act-back--inline" data-act="back" title="Back" aria-label="Back">${PICONS.back(12)}</button>
        ${actStateIcon(state, 18)}
        <h2>${escapeHtml(run.title || run.workflow)} <span class="act-number">#${escapeHtml(run.number)}</span></h2>
      </div>
      <div class="act-page-actions">
        ${attemptButton}${rerun}${cancel}
        <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="run-more" title="More" aria-label="More actions for this run">${PICONS.dots(13)}</button>
        ${actLinkToolsHtml(run.url, `${run.workflow} #${run.number}`)}
      </div>
    </div>`;
}

function actRunSummaryBoxHtml(answer, now = new Date()) {
  const AM = actModel();
  const run = answer.run;
  const state = AM.runState(run.status, run.conclusion);
  const who = run.triggeringActor || run.actor;
  const pr = (run.pullRequests || [])[0];
  let detail = '';
  if (run.event === 'push') detail = `${escapeHtml(who)} pushed <button type="button" class="act-link act-mono" data-act="open-commit" data-sha="${actAttr(run.sha)}">${escapeHtml(AM.shortSha(run.sha))}</button>`;
  else if (pr) detail = `${escapeHtml(who)} · <button type="button" class="act-link" data-act="open-pr" data-number="${actAttr(pr.number)}">#${escapeHtml(pr.number)}</button>`;
  else detail = escapeHtml(AM.triggerText(run));
  const branch = run.branch ? `<span class="act-branch">${escapeHtml(run.branch)}</span>` : '';
  const duration = AM.formatDuration(AM.runDuration(run, now.getTime(), answer.jobs));
  return `
    <div class="act-summary-box">
      <div class="act-summary-cell act-summary-cell--wide"><div class="act-k">Triggered via ${escapeHtml(AM.eventWords(run.event))} ${escapeHtml(actRelative(run.createdAt, now))}</div><div class="act-v">${detail} ${branch}</div></div>
      <div class="act-summary-cell"><div class="act-k">Status</div><div class="act-v">${escapeHtml(state.label)}</div></div>
      <div class="act-summary-cell"><div class="act-k">Total duration</div><div class="act-v">${escapeHtml(duration || '–')}</div></div>
      <div class="act-summary-cell"><div class="act-k">Artifacts</div><div class="act-v">${(answer.artifacts || []).length || '–'}</div></div>
    </div>`;
}

/** What a run waits for: a fork's approval, a review of its deployments, its concurrency group. */
function actRunWaitsHtml(answer, { canWrite = false, now = new Date() } = {}) {
  const run = answer.run;
  const parts = [];
  if (run.conclusion === 'action_required') {
    parts.push(`<div class="act-banner act-banner--action"><span>${ACT_ICONS.action(13)} This workflow run needs a maintainer's approval: it comes from a fork of a first-time contributor.</span>${canWrite ? '<button type="button" class="ws-btn ws-btn--sm ws-btn--primary" data-act="approve-fork">Approve and run</button>' : ''}</div>`);
  }
  const pending = answer.pendingDeployments || [];
  if (pending.length) {
    const canReview = pending.some(p => p.canApprove);
    const rows = pending.map((p) => {
      let timer = '';
      if (p.waitTimer && p.waitTimerStartedAt) {
        const ends = Date.parse(p.waitTimerStartedAt) + p.waitTimer * 60_000;
        timer = ends > now.getTime() ? ` · wait timer: deploys ${escapeHtml(actRelative(new Date(ends).toISOString(), now))}` : ' · wait timer done';
      }
      const reviewers = (p.reviewers || []).map(r => r.name).filter(Boolean);
      return `<li><strong>${escapeHtml(p.environment.name)}</strong>${reviewers.length ? ` · reviewers: ${escapeHtml(reviewers.join(', '))}` : ''}${timer}</li>`;
    }).join('');
    parts.push(`
      <div class="act-review">
        <div class="act-review-head">${ACT_ICONS.waiting(14)}<span>${pending.length === 1 ? `${escapeHtml(pending[0].environment.name)} needs approval to start deploying changes.` : `${pending.length} environments need approval to start deploying changes.`}</span>
        ${canReview ? '<button type="button" class="ws-btn ws-btn--sm ws-btn--primary" data-act="review-deployments">Review deployments</button>' : '<span class="act-subtle">You are not one of their reviewers.</span>'}</div>
        <ul class="act-review-list">${rows}</ul>
      </div>`);
  }
  const approvals = answer.approvals || [];
  if (approvals.length) {
    parts.push(`<div class="act-approvals">${approvals.map(a => `<div>${a.state === 'approved' ? ACT_ICONS.success(12) : ACT_ICONS.failure(12)} <strong>${escapeHtml(a.user)}</strong> ${escapeHtml(a.state)} ${escapeHtml(a.environments.join(', '))}${a.comment ? `: ${escapeHtml(a.comment)}` : ''}</div>`).join('')}</div>`);
  }
  for (const group of answer.concurrency || []) {
    const me = (group.members || []).find(m => String(m.runId) === String(run.id));
    const position = me && Number.isFinite(me.position) ? ` (position ${me.position + 1} of ${group.members.length})` : '';
    parts.push(`<div class="act-banner act-banner--quiet"><span>${ACT_ICONS.queued(12)} Waiting in the concurrency group <code>${escapeHtml(group.name)}</code>${escapeHtml(position)}.</span></div>`);
  }
  return parts.join('');
}

function actGraphNodeHtml(node, { open = false } = {}) {
  const AM = actModel();
  const time = node.durationMs !== null ? `<span class="act-node-time">${escapeHtml(AM.formatDuration(node.durationMs))}</span>` : '';
  if (!node.group) {
    const job = node.jobs[0];
    if (!job) return `<div class="act-node act-node--idle" data-node="${actAttr(node.key)}" title="Not started">${actStateIcon(node.state, 14)}<span class="act-node-name">${escapeHtml(node.name)}</span></div>`;
    return `<button type="button" class="act-node" data-node="${actAttr(node.key)}" data-act="open-job" data-id="${actAttr(job.id)}" title="${actAttr(job.name)}">${actStateIcon(node.state, 14)}<span class="act-node-name">${escapeHtml(node.name)}</span>${time}</button>`;
  }
  const title = node.kind === 'reusable' ? node.name : `Matrix: ${node.name}`;
  const jobs = node.jobs.length
    ? (open
      ? `<div class="act-node-jobs">${node.jobs.map(job => `<button type="button" class="act-node-job" data-act="open-job" data-id="${actAttr(job.id)}" title="${actAttr(job.name)}">${actStateIcon(AM.runState(job.status, job.conclusion), 12)}<span>${escapeHtml(job.name)}</span></button>`).join('')}</div><button type="button" class="act-link act-node-toggle" data-act="graph-toggle" data-key="${actAttr(node.key)}">Show less</button>`
      : `<button type="button" class="act-link act-node-toggle" data-act="graph-toggle" data-key="${actAttr(node.key)}">Show all jobs</button>`)
    : '';
  return `
    <div class="act-node act-node--group" data-node="${actAttr(node.key)}">
      <div class="act-node-head">${actStateIcon(node.state, 14)}<span class="act-node-name">${escapeHtml(title)}</span>${time}</div>
      <div class="act-node-sub">${node.jobs.length ? `${node.done} of ${actPlural(node.jobs.length, 'job')} completed` : 'Not started'}</div>
      ${jobs}
    </div>`;
}

/** The job graph: one column per depth of `needs`, the lines drawn once it is on screen (actDrawEdges). */
function actGraphHtml(graph, { open = new Set(), zoom = 1, workflow = null } = {}) {
  if (!graph.nodes.length) return '';
  const note = workflow && workflow.error ? `<div class="act-subtle act-graph-note">The graph follows the jobs GitHub lists: ${escapeHtml(workflow.error)}</div>` : '';
  return `
    <div class="act-section act-graph-wrap">
      <div class="act-graph-tools" role="group" aria-label="Zoom">
        <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="zoom" data-by="-1" title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" class="ws-btn ws-btn--sm" data-act="zoom" data-by="0" title="Fit to window">Fit</button>
        <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="zoom" data-by="1" title="Zoom in" aria-label="Zoom in">+</button>
      </div>
      <div class="act-graph-scroll">
        <div class="act-graph" style="zoom: ${Number(zoom) || 1}">
          <svg class="act-graph-edges" aria-hidden="true"></svg>
          ${graph.columns.map(col => `<div class="act-graph-col${col.some(n => n.other) ? ' act-graph-col--other' : ''}">${col.some(n => n.other) ? '<div class="act-graph-col-head">Other jobs</div>' : ''}${col.map(node => actGraphNodeHtml(node, { open: open.has(node.key) })).join('')}</div>`).join('')}
        </div>
      </div>
      ${note}
    </div>`;
}

/** The lines between the graph's boxes, from a job to the jobs that need it. */
function actDrawEdges(container, edges) {
  const graph = container.querySelector('.act-graph');
  const svg = graph?.querySelector('.act-graph-edges');
  if (!graph || !svg) return;
  const box = (key) => {
    const el = graph.querySelector(`[data-node="${CSS.escape(key)}"]`);
    if (!el) return null;
    let x = 0;
    let y = 0;
    for (let n = el; n && n !== graph; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
  svg.setAttribute('width', graph.scrollWidth);
  svg.setAttribute('height', graph.scrollHeight);
  svg.innerHTML = edges.map((edge) => {
    const a = box(edge.from);
    const b = box(edge.to);
    if (!a || !b) return '';
    const x1 = a.x + a.w;
    const y1 = a.y + Math.min(a.h / 2, 18);
    const x2 = b.x;
    const y2 = b.y + Math.min(b.h / 2, 18);
    const mid = (x1 + x2) / 2;
    return `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/>`;
  }).join('');
}

const ACT_LEVEL_WORDS = { failure: ['error', 'errors'], warning: ['warning', 'warnings'], notice: ['notice', 'notices'] };

function actAnnotationsHtml(byJob, jobs, { sha = '', title = 'Annotations' } = {}) {
  const groups = [];
  const counts = { failure: 0, warning: 0, notice: 0 };
  for (const job of jobs || []) {
    const entry = byJob && byJob[job.id];
    const items = Array.isArray(entry) ? entry : entry?.items;
    if (!items || !items.length) continue;
    for (const a of items) counts[a.level] = (counts[a.level] || 0) + 1;
    groups.push({ job, items, more: entry?.total && entry.total > items.length ? entry.total - items.length : 0 });
  }
  if (!groups.length) return '';
  const head = Object.entries(counts).filter(([, n]) => n).map(([level, n]) => `${n} ${ACT_LEVEL_WORDS[level][n === 1 ? 0 : 1]}`).join(' and ');
  const icon = { failure: ACT_ICONS.failure, warning: ACT_ICONS.action, notice: ACT_ICONS.info };
  return `
    <div class="act-section act-annotations">
      <div class="act-section-head"><h3>${escapeHtml(title)}</h3><span class="act-subtle">${escapeHtml(head)}</span></div>
      ${groups.map(g => `
        <div class="act-ann-group">
          ${g.items.map(a => `
            <div class="act-ann act-ann--${actAttr(a.level)}">
              <span class="act-ann-icon">${(icon[a.level] || icon.notice)(13)}</span>
              <div class="act-ann-body">
                <div class="act-ann-title"><button type="button" class="act-link" data-act="open-job" data-id="${actAttr(g.job.id)}">${escapeHtml(g.job.name)}</button>${a.title ? ` · ${escapeHtml(a.title)}` : ''}</div>
                <div class="act-ann-msg">${escapeHtml(a.message)}</div>
                ${a.path && a.path !== '.github' ? `<button type="button" class="act-link act-mono" data-act="open-annotation" data-path="${actAttr(a.path)}" data-line="${actAttr(a.startLine || '')}" data-sha="${actAttr(sha)}">${escapeHtml(a.path)}${a.startLine ? `#L${escapeHtml(a.startLine)}` : ''}</button>` : ''}
              </div>
            </div>`).join('')}
          ${g.more ? `<div class="act-subtle">${actPlural(g.more, 'more annotation')} on GitHub</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function actArtifactsHtml(artifacts, { canWrite = false, now = new Date() } = {}) {
  if (!artifacts || !artifacts.length) return '';
  const AM = actModel();
  return `
    <div class="act-section act-artifacts">
      <div class="act-section-head"><h3>Artifacts</h3><span class="act-subtle">Produced during runtime</span></div>
      <div class="act-table" role="table">
        <div class="act-tr act-th" role="row"><span role="columnheader">Name</span><span role="columnheader">Size</span><span role="columnheader">Digest</span><span role="columnheader"></span></div>
        ${artifacts.map(a => `
          <div class="act-tr" role="row">
            <span role="cell"><button type="button" class="act-link" data-act="artifact-download" data-name="${actAttr(a.name)}" title="Download ${actAttr(a.name)}">${ACT_ICONS.download(12)} ${escapeHtml(a.name)}</button>${a.expiresAt ? `<span class="act-subtle"> · expires ${escapeHtml(actRelative(a.expiresAt, now))}</span>` : ''}</span>
            <span role="cell">${escapeHtml(AM.formatBytes(a.size))}</span>
            <span role="cell" class="act-mono act-digest" title="${actAttr(a.digest || '')}">${escapeHtml(a.digest ? `${a.digest.slice(0, 19)}…` : '–')}</span>
            <span role="cell">${canWrite ? `<button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="artifact-delete" data-id="${actAttr(a.id)}" data-name="${actAttr(a.name)}" title="Delete ${actAttr(a.name)}" aria-label="Delete ${actAttr(a.name)}">${PICONS.trash(12)}</button>` : ''}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function actUsageHtml(answer, now = new Date()) {
  const AM = actModel();
  const usage = AM.usageRows(answer.jobs || [], now.getTime());
  return `
    <div class="act-section">
      <div class="act-section-head"><h3>Usage</h3></div>
      <div class="act-table act-usage" role="table">
        <div class="act-tr act-th" role="row"><span role="columnheader">Job</span><span role="columnheader">Run time</span></div>
        ${usage.rows.map(r => `<div class="act-tr" role="row"><span role="cell">${actStateIcon(r.state, 12)} ${escapeHtml(r.name)}</span><span role="cell">${escapeHtml(r.ms === null ? '–' : AM.formatDuration(r.ms))}</span></div>`).join('')}
        <div class="act-tr act-tfoot" role="row"><span role="cell"></span><span role="cell">${escapeHtml(AM.formatDuration(usage.total) || '0s')}</span></div>
      </div>
      <p class="act-subtle">GitHub no longer gives billable minutes through its API: this is each job's run time, from its start to its end.</p>
    </div>`;
}

function actRunPageHtml(answer, data, page, { canWrite = false, now = new Date() } = {}) {
  const AM = actModel();
  const head = actRunHeadHtml(answer, { canWrite, now });
  const tab = page.tab || 'summary';
  if (tab === 'usage') return head + actUsageHtml(answer, now);
  if (tab === 'workflow') return head; // the file is painted into the page (actPaintRunPage)
  const graph = AM.graphLayout(answer.workflow?.jobs || [], answer.jobs || [], now.getTime(), !AM.isActive(answer.run.status));
  return `${head}
    ${actRunSummaryBoxHtml(answer, now)}
    ${actRunWaitsHtml(answer, { canWrite, now })}
    ${actGraphHtml(graph, { open: data.graphOpen, zoom: data.zoom, workflow: answer.workflow })}
    ${actAnnotationsHtml(answer.annotations, answer.jobs, { sha: answer.run.sha })}
    ${actArtifactsHtml(answer.artifacts, { canWrite, now })}
    <div class="act-section act-summaries"><span class="act-subtle">Job summaries are not in GitHub's API.</span> <button type="button" class="act-link" data-act="link-view" data-url="${actAttr(answer.run.url)}" data-title="${actAttr(`${answer.run.workflow} #${answer.run.number}`)}">View job summaries on GitHub</button></div>`;
}

function actPaintRunPage(project, state, main, data) {
  const page = data.page;
  const entry = data.run.get(actRunKey(page.runId, page.attempt));
  const back = `<div class="act-page-head"><div class="act-page-title"><button type="button" class="act-back act-back--inline" data-act="back">${PICONS.back(12)}</button><h2>Workflow run</h2></div></div>`;
  if (!entry || (!entry.data && entry.loading)) { main.innerHTML = back + actLoadingHtml('Reading the workflow run…'); return; }
  if (!entry.data) { main.innerHTML = back + actErrorHtml(entry, 'The workflow run'); return; }
  const answer = entry.data;
  const scroll = main.scrollTop;
  main.innerHTML = actRunPageHtml(answer, data, page, { canWrite: actCanWrite(data) });
  if ((page.tab || 'summary') === 'summary') {
    const AM = actModel();
    const graph = AM.graphLayout(answer.workflow?.jobs || [], answer.jobs || [], Date.now(), !AM.isActive(answer.run.status));
    requestAnimationFrame(() => actDrawEdges(main, graph.edges));
  } else if (page.tab === 'workflow') {
    const run = answer.run;
    if (answer.workflow?.dynamic) {
      main.insertAdjacentHTML('beforeend', '<div class="act-empty-list">GitHub runs this workflow itself: it has no file in the repository.</div>');
    } else {
      const file = data.files.get(`${run.path}@${run.sha}`);
      const head = main.innerHTML + `<div class="act-section-head act-file-head"><h3>Workflow file</h3><span class="act-mono">${escapeHtml(run.path)}</span><button type="button" class="act-link act-mono" data-act="open-commit" data-sha="${actAttr(run.sha)}">${escapeHtml(actModel().shortSha(run.sha))}</button></div>`;
      if (!file || (!file.data && file.loading)) { main.innerHTML = head + actLoadingHtml('Reading the workflow file…'); actEnsureFile(project, state, run.path, run.sha); }
      else if (!file.data) main.innerHTML = head + actErrorHtml(file, 'The workflow file');
      else actPaintYaml(main, head, file.data, run.path);
    }
  }
  main.scrollTop = scroll;
}

// --- A job ---

function actJobHeadHtml(job, run, { canWrite = false, now = new Date() } = {}) {
  const AM = actModel();
  const state = AM.runState(job.status, job.conclusion);
  const active = AM.isActive(job.status);
  const when = job.completedAt || job.startedAt || job.createdAt;
  const took = AM.formatDuration(AM.durationMs(job.startedAt, job.completedAt, now.getTime()));
  const sub = active ? `${state.verb}${took ? ` for ${took}` : ''}` : `${state.verb} ${actRelative(when, now)}${took ? ` in ${took}` : ''}`;
  const rerun = canWrite && !active && run && !AM.isActive(run.status)
    ? `<button type="button" class="ws-btn ws-btn--sm" data-act="rerun-job" data-id="${actAttr(job.id)}">${PICONS.refresh(11)}<span>Re-run this job</span></button>` : '';
  const runner = job.runnerName ? `<div class="act-subtle act-runner">Runner: ${escapeHtml(job.runnerName)}${job.runnerGroup ? ` · ${escapeHtml(job.runnerGroup)}` : ''}${job.labels.length ? ` · ${job.labels.map(l => `<span class="act-label">${escapeHtml(l)}</span>`).join(' ')}` : ''}</div>` : '';
  return `
    <div class="act-page-head">
      <div class="act-page-title">
        <button type="button" class="act-back act-back--inline" data-act="back" title="Back" aria-label="Back">${PICONS.back(12)}</button>
        ${actStateIcon(state, 18)}
        <div><h2>${escapeHtml(job.name)}</h2><div class="act-subtle">${escapeHtml(sub)}</div></div>
      </div>
      <div class="act-page-actions">
        ${rerun}
        <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="job-more" title="Log options" aria-label="Log options">${PICONS.gear(13)}</button>
        ${actLinkToolsHtml(job.url, job.name)}
      </div>
    </div>
    ${runner}`;
}

function actLogTime(time) {
  return actModel().logTime(time);
}

/** Words of the search, marked in a line already escaped. */
function actMark(html, search) {
  if (!search) return html;
  const needle = escapeHtml(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(needle, 'gi'), m => `<mark class="act-hit">${m}</mark>`);
}

/**
 * A step's log: numbered lines, GitHub's marks coloured, each ##[group] a
 * line that opens on its lines (closed at first, open where the search finds
 * something). Of a very long log, the end.
 */
function actLogHtml(text, { stepKey = '', open = new Set(), timestamps = false, search = '' } = {}) {
  const AM = actModel();
  const lines = AM.logLines(text);
  const needle = search.toLowerCase();
  const hits = new Set();
  if (needle) lines.forEach((line, i) => { if (line.text.toLowerCase().includes(needle)) { hits.add(i); if (line.group !== null) hits.add(`g${line.group}`); } });
  const start = Math.max(0, lines.length - ACT_LOG_LINES_SHOWN);
  const out = [];
  if (start > 0) out.push(`<div class="act-log-note">The first ${start.toLocaleString('en-US')} lines are left out. Download the log for all of it.</div>`);
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.group !== null && !open.has(line.group) && !hits.has(`g${line.group}`)) continue;
    const kind = line.kind === 'plain' ? '' : ` act-log--${line.kind}`;
    const num = `<span class="act-log-num">${i + 1}</span>`;
    const time = timestamps ? `<span class="act-log-time" title="${actAttr(line.time || '')}">${escapeHtml(actLogTime(line.time))}</span>` : '';
    const body = actMark(escapeHtml(line.text), needle ? search : '');
    if (line.kind === 'group') {
      const isOpen = open.has(i) || hits.has(`g${i}`);
      out.push(`<div class="act-log-line act-log--group${isOpen ? ' is-open' : ''}" data-act="log-group" data-step-key="${actAttr(stepKey)}" data-line="${i}">${num}${time}<span class="act-log-text">${isOpen ? '▾' : '▸'} ${body}</span></div>`);
    } else {
      out.push(`<div class="act-log-line${kind}${line.group !== null ? ' act-log--in-group' : ''}${hits.has(i) ? ' is-hit' : ''}">${num}${time}<span class="act-log-text">${body}</span></div>`);
    }
  }
  return out.join('');
}

function actStepsHtml(job, data, { now = new Date() } = {}) {
  const AM = actModel();
  const open = data.openSteps.get(String(job.id)) || new Set();
  if (!(job.steps || []).length) {
    const state = AM.runState(job.status, job.conclusion);
    const words = state.bucket === 'skipped' ? 'This job was skipped: it ran no steps.'
      : AM.isActive(job.status) ? 'This job has not started its steps yet.' : 'This job has no steps.';
    return `<div class="act-step-live">${escapeHtml(words)}</div>`;
  }
  return (job.steps || []).map((step) => {
    const state = AM.runState(step.status, step.conclusion);
    const isOpen = open.has(step.number);
    const took = AM.formatDuration(AM.durationMs(step.startedAt, step.completedAt, now.getTime()));
    const key = `${job.id}/${step.number}`;
    let log = '';
    if (isOpen) {
      const entry = data.stepLogs.get(key);
      if (step.status !== 'completed') {
        log = `<div class="act-step-live">${actStateIcon(state, 12)}<span>${state.bucket === 'running' ? 'This step is running. GitHub gives its log once it has finished.' : 'This step has not started yet.'}</span>${state.bucket === 'running' && job.url ? `<button type="button" class="ws-btn ws-btn--sm" data-act="link-view" data-url="${actAttr(job.url)}" data-title="${actAttr(job.name)}">Follow live on GitHub</button>` : ''}</div>`;
      } else if (!entry || entry.loading) {
        log = actLoadingHtml('Reading the log…');
      } else if (entry.error) {
        const words = entry.pending ? AM.missingStepLog(AM.isActive(job.status)) : entry.error;
        log = `<div class="act-step-live">${escapeHtml(words)} <button type="button" class="act-link" data-act="step-log-retry" data-step="${actAttr(step.number)}">Try again</button></div>`;
      } else {
        log = `<div class="act-log" data-step-log="${actAttr(key)}">${entry.truncated ? '<div class="act-log-note">Only the end of the log is shown.</div>' : ''}${actLogHtml(entry.text, { stepKey: key, open: data.foldedGroups.get(key) || new Set(), timestamps: data.timestamps, search: data.logSearch })}</div>`;
      }
    }
    return `
      <div class="act-step${isOpen ? ' is-open' : ''}">
        <button type="button" class="act-step-row" data-act="step-toggle" data-step="${actAttr(step.number)}" aria-expanded="${isOpen}">
          <span class="act-step-chevron">${PICONS.chevronRight(10)}</span>${actStateIcon(state, 13)}<span class="act-step-name">${escapeHtml(step.name)}</span><span class="act-step-time">${escapeHtml(took)}</span>
        </button>
        ${log}
      </div>`;
  }).join('');
}

function actPaintJobPage(project, state, main, data) {
  const page = data.page;
  const entry = data.job.get(String(page.jobId));
  const back = `<div class="act-page-head"><div class="act-page-title"><button type="button" class="act-back act-back--inline" data-act="back">${PICONS.back(12)}</button><h2>Job</h2></div></div>`;
  if (!entry || (!entry.data && entry.loading)) { main.innerHTML = back + actLoadingHtml('Reading the job…'); return; }
  if (!entry.data) { main.innerHTML = back + actErrorHtml(entry, 'The job'); return; }
  const job = entry.data.job;
  const run = data.run.get(actRunKey(page.runId, page.attempt))?.data?.run || null;
  const typing = main.contains(document.activeElement) && document.activeElement.id === 'act-log-search';
  if (typing && main.querySelector('#act-steps')) { actRepaintJobSteps(project, state, data); return; }
  const scroll = main.scrollTop;
  main.innerHTML = `
    ${actJobHeadHtml(job, run, { canWrite: actCanWrite(data) })}
    ${actAnnotationsHtml({ [job.id]: entry.data.annotations || [] }, [job], { sha: job.sha })}
    <div class="act-log-tools">
      <label class="pr-search act-search">${PICONS.search(12)}<input type="search" id="act-log-search" placeholder="Search logs" autocomplete="off" spellcheck="false" aria-label="Search the logs of the steps shown" value="${actAttr(data.logSearch)}"></label>
      <span class="act-subtle" id="act-log-hits"></span>
    </div>
    <div class="act-steps" id="act-steps">${actStepsHtml(job, data)}</div>`;
  main.scrollTop = scroll;
  actUpdateHits(main);
  const input = main.querySelector('#act-log-search');
  let timer = null;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { data.logSearch = input.value; actRepaintJobSteps(project, state, data); }, 200);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); actNextHit(main, e.shiftKey ? -1 : 1, data); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; data.logSearch = ''; actRepaintJobSteps(project, state, data); }
  };
}

/** Repaint only the steps (a log read, a group folded, the search typed), keeping the scroll. */
function actRepaintJobSteps(project, state, data) {
  const body = actActiveBody(project);
  const main = body?.querySelector('#act-main');
  const slot = main?.querySelector('#act-steps');
  if (!slot || data.page.kind !== 'job') return;
  const job = data.job.get(String(data.page.jobId))?.data?.job;
  if (!job) return;
  const scroll = main.scrollTop;
  slot.innerHTML = actStepsHtml(job, data);
  main.scrollTop = scroll;
  actUpdateHits(main);
}

function actUpdateHits(main) {
  const label = main.querySelector('#act-log-hits');
  if (!label) return;
  const n = main.querySelectorAll('.act-hit').length;
  label.textContent = main.querySelector('#act-log-search')?.value ? `${n} result${n === 1 ? '' : 's'}${n ? ' · Enter for the next' : ''}` : '';
}

function actNextHit(main, by, data) {
  const hits = [...main.querySelectorAll('.act-hit')];
  if (!hits.length) return;
  data.logHit = ((data.logHit || 0) + by + hits.length) % hits.length;
  hits.forEach(h => h.classList.remove('is-current'));
  const hit = hits[data.logHit];
  hit.classList.add('is-current');
  hit.scrollIntoView({ block: 'center' });
}

function actRepaintRun(project, state, data) {
  const page = data.page;
  if (page.kind !== 'run' && page.kind !== 'job') return;
  actPaintSide(project, state);
  const body = actActiveBody(project);
  const main = body?.querySelector('#act-main');
  if (!main) return;
  if (page.kind === 'run') actPaintRunPage(project, state, main, data);
  else actPaintJobPage(project, state, main, data);
}

// --- Clicks on a run's and a job's pages ---

function actFindJob(data, jobId) {
  const entry = data.job.get(String(jobId));
  if (entry?.data?.job) return entry.data.job;
  for (const run of data.run.values()) {
    const job = (run.data?.jobs || []).find(j => String(j.id) === String(jobId));
    if (job) return job;
  }
  return null;
}

/** A click on a run's or a job's page; true when it was one of theirs. */
function actOnRunClick(project, state, data, target, e) {
  const act = target.dataset.act;
  const page = data.page;
  const repo = actSelectedRepo(state);
  const entry = (page.kind === 'run' || page.kind === 'job') ? data.run.get(actRunKey(page.runId, page.attempt)) : null;
  const run = entry?.data?.run || null;
  switch (act) {
    case 'run-tab':
      data.page = { ...page, kind: 'run', tab: target.dataset.tab };
      if (page.kind === 'job') data.page = { kind: 'run', runId: page.runId, attempt: page.attempt, tab: target.dataset.tab };
      actRepaint(project, state);
      if (data.page.tab === 'workflow' && run && !entry.data.workflow?.dynamic) actEnsureFile(project, state, run.path, run.sha);
      return true;
    case 'open-job': {
      const runId = page.kind === 'run' || page.kind === 'job' ? page.runId : null;
      const job = actFindJob(data, target.dataset.id);
      actGo(project, state, { kind: 'job', runId: runId || job?.runId, jobId: Number(target.dataset.id), attempt: page.attempt || null }, { replace: page.kind === 'job' });
      return true;
    }
    case 'graph-toggle': {
      const key = target.dataset.key;
      if (data.graphOpen.has(key)) data.graphOpen.delete(key); else data.graphOpen.add(key);
      actRepaintRun(project, state, data);
      return true;
    }
    case 'zoom': {
      const by = Number(target.dataset.by);
      if (by === 0) {
        // Fit to window: the graph's own width at zoom 1 into the room it has.
        const scroller = target.closest('.act-graph-wrap')?.querySelector('.act-graph-scroll');
        const graph = scroller?.querySelector('.act-graph');
        const natural = graph ? graph.scrollWidth / (data.zoom || 1) : 0;
        data.zoom = natural && scroller ? Math.min(1, Math.max(0.4, Math.floor(((scroller.clientWidth - 32) / natural) * 100) / 100)) : 1;
      } else {
        data.zoom = Math.min(1.6, Math.max(0.4, Math.round((data.zoom + by * 0.1) * 10) / 10));
      }
      actRepaintRun(project, state, data);
      return true;
    }
    case 'attempt-menu': {
      if (!entry?.data) return true;
      const total = entry.data.attempts || 1;
      const items = [];
      for (let n = total; n >= 1; n--) {
        items.push({ label: n === total ? `Latest #${n}` : `Attempt #${n}`, icon: n === entry.data.attempt ? PICONS.check(12) : '', onClick: () => actGo(project, state, { kind: 'run', runId: page.runId, attempt: n === total ? null : n, tab: page.tab || 'summary' }, { replace: true }) });
      }
      showContextMenu(items, { anchor: target });
      return true;
    }
    case 'rerun-menu': {
      if (!run) return true;
      const failed = (entry.data.jobs || []).some(j => ['failure', 'cancelled', 'timed_out'].includes(j.conclusion));
      showContextMenu([
        { label: 'Re-run all jobs', onClick: () => actRerunDialog(project, state, run, { failedOnly: false }) },
        failed ? { label: 'Re-run failed jobs', onClick: () => actRerunDialog(project, state, run, { failedOnly: true }) } : null,
      ].filter(Boolean), { anchor: target });
      return true;
    }
    case 'cancel-run':
      if (run) actCancelDialog(project, state, run);
      return true;
    case 'run-more': {
      if (!run) return true;
      const canWrite = actCanWrite(data);
      const active = actModel().isActive(run.status);
      showContextMenu([
        { label: 'View workflow file', onClick: () => actOnRunClick(project, state, data, { dataset: { act: 'run-tab', tab: 'workflow' } }) },
        { label: 'Download log archive', disabled: active, onClick: () => actSaveLog(project, state, { runId: run.id, attempt: page.attempt || null, suggestedName: `logs_${run.id}` }) },
        canWrite ? { sep: true } : null,
        canWrite && active ? { label: 'Force cancel workflow', danger: true, onClick: () => actConfirm(project, state, { title: 'Force cancel?', bodyHtml: '<p>Force cancel stops the run even past steps that run <code>always()</code>. Use it when Cancel does not stop it.</p>', primaryLabel: 'Force cancel', danger: true, params: { kind: 'force-cancel', runId: run.id } }) } : null,
        canWrite && !active ? { label: 'Delete all logs', danger: true, onClick: () => actConfirm(project, state, { title: 'Delete all logs?', bodyHtml: '<p>Every log of this run is deleted on GitHub. This cannot be undone.</p>', primaryLabel: 'Delete all logs', danger: true, params: { kind: 'delete-logs', runId: run.id } }) } : null,
        canWrite && !active ? { label: 'Delete workflow run', danger: true, onClick: () => actConfirm(project, state, { title: 'Delete workflow run?', bodyHtml: '<p>Are you sure you want to permanently delete this workflow run? This cannot be undone.</p>', primaryLabel: 'Yes, permanently delete this workflow run', danger: true, params: { kind: 'delete-run', runId: run.id }, after: () => actBack(project, state) }) } : null,
      ].filter(Boolean), { anchor: target });
      return true;
    }
    case 'approve-fork':
      if (run) actConfirm(project, state, { title: 'Approve and run', bodyHtml: '<p>This pull request comes from a fork. Approving runs its workflows with this repository\'s settings: read its changes first.</p>', primaryLabel: 'Approve and run', params: { kind: 'approve-fork', runId: run.id } });
      return true;
    case 'review-deployments':
      if (run) actReviewDialog(project, state, run, entry.data.pendingDeployments || []);
      return true;
    case 'artifact-download':
      if (run) actSaveArtifact(project, state, run, target.dataset.name);
      return true;
    case 'artifact-delete':
      actConfirm(project, state, { title: `Delete ${target.dataset.name}?`, bodyHtml: '<p>The artifact is deleted on GitHub. This cannot be undone.</p>', primaryLabel: 'Delete artifact', danger: true, params: { kind: 'delete-artifact', artifactId: Number(target.dataset.id) } });
      return true;
    case 'open-commit':
      if (data.repo && /^[0-9a-f]{40}$/.test(target.dataset.sha || '')) actOpenWeb(`https://${data.repo.host}/${data.repo.owner}/${data.repo.repo}/commit/${target.dataset.sha}`, target.dataset.sha.slice(0, 7));
      return true;
    case 'open-pr':
      if (data.repo) actOpenWeb(`https://${data.repo.host}/${data.repo.owner}/${data.repo.repo}/pull/${encodeURIComponent(target.dataset.number)}`, `#${target.dataset.number}`);
      return true;
    case 'open-annotation': {
      const rel = target.dataset.path;
      const sha = target.dataset.sha;
      const line = target.dataset.line;
      (async () => {
        const opened = repo && rel && !rel.startsWith('/') && !rel.split('/').includes('..') ? await actApi('openFileWindow', `${repo.path.replace(/\/$/, '')}/${rel}`) : false;
        if (opened === true) return;
        if (data.repo && rel) actOpenWeb(`https://${data.repo.host}/${data.repo.owner}/${data.repo.repo}/blob/${sha || 'HEAD'}/${rel.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`, rel);
      })();
      return true;
    }
    case 'rerun-job': {
      const job = actFindJob(data, target.dataset.id);
      if (job) actRerunDialog(project, state, run, { jobId: job.id, jobName: job.name });
      return true;
    }
    case 'job-more': {
      const job = actFindJob(data, page.jobId);
      if (!job) return true;
      const active = actModel().isActive(job.status);
      showContextMenu([
        { label: data.timestamps ? 'Hide timestamps' : 'Show timestamps', icon: data.timestamps ? PICONS.check(12) : '', onClick: () => { data.timestamps = !data.timestamps; actRepaintJobSteps(project, state, data); } },
        { label: 'Expand all steps', onClick: () => { const open = data.openSteps.get(String(job.id)) || new Set(); for (const s of job.steps || []) { open.add(s.number); if (s.status === 'completed') actLoadStepLog(project, state, job.id, s.number); } data.openSteps.set(String(job.id), open); actRepaintJobSteps(project, state, data); } },
        { label: 'Collapse all steps', onClick: () => { data.openSteps.set(String(job.id), new Set()); actRepaintJobSteps(project, state, data); } },
        { sep: true },
        { label: 'Download log', disabled: active, onClick: () => actSaveLog(project, state, { jobId: job.id, suggestedName: job.name }) },
        { label: 'Download log archive', disabled: !run || actModel().isActive(run.status), onClick: () => actSaveLog(project, state, { runId: page.runId, attempt: page.attempt || null, suggestedName: `logs_${page.runId}` }) },
      ], { anchor: target });
      return true;
    }
    case 'step-toggle': {
      const job = actFindJob(data, page.jobId);
      if (!job) return true;
      const key = String(job.id);
      const open = data.openSteps.get(key) || new Set();
      const n = Number(target.dataset.step);
      if (open.has(n)) open.delete(n);
      else {
        open.add(n);
        const step = (job.steps || []).find(s => s.number === n);
        if (step && step.status === 'completed') actLoadStepLog(project, state, job.id, n);
      }
      data.openSteps.set(key, open);
      actRepaintJobSteps(project, state, data);
      return true;
    }
    case 'step-log-retry': {
      data.stepLogs.delete(`${page.jobId}/${target.dataset.step}`);
      actLoadStepLog(project, state, page.jobId, Number(target.dataset.step));
      return true;
    }
    case 'log-group': {
      const key = target.dataset.stepKey;
      const line = Number(target.dataset.line);
      const open = data.foldedGroups.get(key) || new Set();
      if (open.has(line)) open.delete(line); else open.add(line);
      data.foldedGroups.set(key, open);
      actRepaintJobSteps(project, state, data);
      return true;
    }
    case 'link-copy': {
      window.api?.writeClipboard?.(target.dataset.url);
      target.innerHTML = PICONS.check(13);
      setTimeout(() => { if (target.isConnected) target.innerHTML = PICONS.link(13); }, 1200);
      return true;
    }
    case 'link-view': actOpenWeb(target.dataset.url, target.dataset.title || 'GitHub'); return true;
    case 'link-window': window.api?.openWebWindow?.(target.dataset.url, target.dataset.title || 'GitHub'); return true;
    case 'link-browser': window.api?.openExternal?.(target.dataset.url); return true;
    default: return false;
  }
}

function actCancelDialog(project, state, run) {
  return actConfirm(project, state, {
    title: `Cancel workflow run #${run.number}?`,
    bodyHtml: `<p>${escapeHtml(run.title)}</p><p class="act-subtle">Steps that run <code>always()</code> still run. If the run does not stop, Force cancel is in the "…" menu.</p>`,
    primaryLabel: 'Cancel workflow',
    cancelLabel: 'Keep running',
    danger: true,
    params: { kind: 'cancel', runId: run.id },
  });
}

/** Review deployments: the environments the account may approve, a comment, then Approve and deploy or Reject. */
function actReviewDialog(project, state, run, pending) {
  const mine = pending.filter(p => p.canApprove);
  if (!mine.length) return null;
  const body = `
    <div class="act-form">
      ${mine.map(p => `<label class="act-check"><input type="checkbox" data-env="${actAttr(p.environment.id)}" checked> <span>${escapeHtml(p.environment.name)}</span></label>`).join('')}
      <label class="act-field"><span>Leave a comment</span><textarea id="act-review-comment" rows="3" maxlength="65536"></textarea></label>
      <button type="button" class="ws-btn ws-btn--sm ws-btn--danger act-review-reject" data-reject="1">Reject</button>
    </div>`;
  let reject = false;
  const handle = actConfirm(project, state, {
    title: 'Review pending deployments',
    bodyHtml: body,
    primaryLabel: 'Approve and deploy',
    focusSelector: '#act-review-comment',
    params: (dialog) => {
      const ids = [...dialog.querySelectorAll('[data-env]')].filter(el => el.checked).map(el => Number(el.dataset.env));
      if (!ids.length) throw new Error('Choose at least one environment.');
      return { kind: 'review-deployments', runId: run.id, environmentIds: ids, state: reject ? 'rejected' : 'approved', comment: dialog.querySelector('#act-review-comment').value };
    },
  });
  const button = handle?.dialog.querySelector('[data-reject]');
  if (button) button.onclick = () => { reject = true; handle.dialog.querySelector('.gg-dialog-primary').click(); setTimeout(() => { reject = false; }, 0); };
  return handle;
}

async function actSaveArtifact(project, state, run, name) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  actSetNotice(project, state, { kind: 'busy', text: `Downloading ${name}…` });
  const result = await actApi('saveActionsArtifact', project.id, repo.path, actRemoteOpts(data, { runId: run.id, name }));
  if (result?.cancelled) { actSetNotice(project, state, null); return; }
  actSetNotice(project, state, result?.ok ? { kind: 'ok', text: result.message || 'Downloaded.' } : { kind: 'error', text: result?.error || 'The artifact could not be downloaded.' });
}

async function actSaveLog(project, state, opts) {
  const repo = actSelectedRepo(state);
  const data = actRepoState(project.id, state, repo.path);
  const result = await actApi('saveActionsLog', project.id, repo.path, actRemoteOpts(data, opts));
  if (result?.cancelled) return;
  actSetNotice(project, state, result?.ok ? { kind: 'ok', text: result.message || 'Saved.' } : { kind: 'error', text: result?.error || 'The log could not be saved.' });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    actRunHeadHtml, actRunSummaryBoxHtml, actRunWaitsHtml, actGraphHtml, actGraphNodeHtml, actAnnotationsHtml, actArtifactsHtml,
    actUsageHtml, actRunPageHtml, actJobHeadHtml, actLogHtml, actStepsHtml, actLinkToolsHtml, actMark, actOpenStepsOf,
  };
}
