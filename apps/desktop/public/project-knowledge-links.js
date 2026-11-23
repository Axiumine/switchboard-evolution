// project-knowledge-links.js — the Node Knowledge tab reached from the rest
// of the project page: a Code graph card on the Overview, the symbols of a
// file from the Files tab, and the impact of uncommitted work or of the
// commits since one from the Git tab (Changes, History) and the Worktrees view.
// Each entry is offered only for an attached folder, the unit of the tab.

function knIsAttached(project, folderPath) {
  return !!folderPath && (project?.folders || []).some(f => f.path === folderPath);
}

function knProjectById(projectId) {
  if (typeof findTreeProject === 'function') return findTreeProject(projectId);
  const p = typeof selectedProject === 'function' ? selectedProject() : null;
  return p && p.id === projectId ? p : null;
}

/** The Impact view on a folder, run right away: uncommitted work, a branch against its base, or since a ref. */
function knOpenImpact(project, folder, against = 'uncommitted', ref = '') {
  if (!knIsAttached(project, folder)) return;
  const s = knState(project);
  const d = knImpactState(s, folder);
  Object.assign(d, { against, ref: ref || '', scope: 'impact', result: null, error: null, autorun: true });
  s.folder = folder;
  s.view = 'impact';
  if (projectTab(project) !== 'knowledge') showProjectTab(project, 'knowledge');
  else knRedraw(project);
}

/** The symbols a file defines, in the Search view. */
function knOpenFileSymbols(project, folder, rel) {
  if (!knIsAttached(project, folder) || !rel) return;
  const s = knState(project);
  const d = knSearchState(s, folder);
  Object.assign(d, { kind: 'symbols', query: '', label: '', meaning: false, namePattern: '', filePattern: rel, results: null, symbol: null, autorun: true });
  s.folder = folder;
  s.view = 'search';
  if (projectTab(project) !== 'knowledge') showProjectTab(project, 'knowledge');
  else knRedraw(project);
}

/** The Search view with a query typed on the Overview's card. */
function knOpenSearch(project, folder, query) {
  const s = knState(project);
  const d = knSearchState(s, folder);
  Object.assign(d, { kind: 'symbols', query, filePattern: '', namePattern: '', results: null, symbol: null, autorun: !!query.trim() });
  s.folder = folder;
  s.view = 'search';
  showProjectTab(project, 'knowledge');
}

function knImpactButtonHtml() {
  // Not a .git-view-btn: the Changes view gives every one of those the list/tree toggle.
  return `<button type="button" class="kn-git-impact" data-kn-act="git-impact" title="What these changes touch and what depends on them (Node Knowledge)">${PICONS.search(11)}<span>Impact</span></button>`;
}

/** Items for the History's menus: the impact of the uncommitted changes, or of the commits since one. */
function knGitMenuItems(ctx, kind, commit) {
  const project = knProjectById(ctx.projectId);
  if (!project || !knIsAttached(project, ctx.folderPath) || typeof knOpenImpact !== 'function') return [];
  if (kind === 'uncommitted') return [{ id: 'knowledgeImpact', label: 'Impact of the uncommitted changes', onClick: () => knOpenImpact(project, ctx.folderPath, 'uncommitted') }];
  if (kind === 'commit' && commit?.hash) return [{ id: 'knowledgeImpact', label: 'Impact of the changes since this Commit', onClick: () => knOpenImpact(project, ctx.folderPath, 'since', commit.hash) }];
  return [];
}

// --- The Overview's card ---

const knSideCache = new Map(); // projectId → { at, status }
const KN_SIDE_TTL_MS = 30_000;

/**
 * The Code graph card on the project's Overview, for projects with the graph
 * on: each folder's graph and a search box. Nothing for the others, and
 * nothing that starts CBM until the setting says the graph is on.
 */
async function knRenderSideCard(project, el) {
  if (!el || !window.api?.getKnowledgeSettings) return;
  const settings = await window.api.getKnowledgeSettings(project.id);
  if (!settings?.settings?.enabled) { el.hidden = true; el.innerHTML = ''; return; }
  let cached = knSideCache.get(project.id);
  if (!cached || Date.now() - cached.at > KN_SIDE_TTL_MS) {
    const status = await window.api.getKnowledgeStatus(project.id);
    cached = { at: Date.now(), status: status?.error ? null : status };
    knSideCache.set(project.id, cached);
  }
  if (!el.isConnected) return;
  const status = cached.status;
  const rows = (status?.folders || []).map(f => {
    const busy = f.job && KnowledgeModel.jobActive(f.job);
    const sum = f.indexed && f.index ? KnowledgeModel.indexSummary(f.index) : null;
    const meta = busy ? KnowledgeModel.jobText(f.job) : sum ? `${knNumber(sum.nodes)} nodes · ${KnowledgeModel.ago(sum.indexedAt)}` : 'not indexed';
    return `<div class="ws-frow" title="${escapeAttr(f.path)}"><span class="ws-frow-icon">${PICONS.folder(13)}</span><span class="ws-frow-name">${escapeHtml(pathBasename(f.path))}</span><span class="ws-card-meta ws-frow-detail">${escapeHtml(meta)}</span></div>`;
  }).join('');
  el.hidden = false;
  el.innerHTML = `<div class="ws-card-h"><span class="ws-card-title">Code graph</span><span class="ws-flex"></span><button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="open">Open</button></div>
    ${rows || '<div class="ws-card-text muted">No folders attached.</div>'}
    ${status ? `<form class="kn-side-search" data-kn-form><input type="search" class="ws-input" placeholder="Find a function, a class, a route…" aria-label="Search the code graph"></form>` : '<div class="ws-card-text muted">codebase-memory-mcp is not available.</div>'}`;
  el.querySelector('[data-kn-act="open"]').onclick = () => showProjectTab(project, 'knowledge');
  const form = el.querySelector('[data-kn-form]');
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const folder = knFolder(project, knState(project));
      if (folder) knOpenSearch(project, folder, form.querySelector('input').value);
    };
  }
}
