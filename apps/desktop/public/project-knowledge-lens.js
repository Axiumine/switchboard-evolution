// project-knowledge-lens.js — the Node Knowledge tab's Lens view: CBM Lens,
// codebase-memory-mcp's own web UI (the 3D graph, Galaxy, Architecture, ADR,
// Coverage, System), served by its daemon on 127.0.0.1 without a login.
//
// The Lens refuses to be framed (frame-ancestors 'none'), so it is a <webview>
// in a session of its own, which main lets load http on 127.0.0.1 only
// (web-page.js). The page is redrawn whole at every projects-changed, and a
// webview that is moved or made again reloads; so there is one webview, on
// document.body, laid over a slot the view draws, and hidden when the slot is
// gone (another tab, view or project).

const KN_LENS_PARTITION = 'persist:cbm-lens';
const knLens = { host: null, webview: null, url: null, slot: null, timer: null };

function knLensHost() {
  if (knLens.host) return knLens.host;
  const host = document.createElement('div');
  host.className = 'kn-lens-host';
  host.hidden = true;
  const webview = document.createElement('webview');
  webview.setAttribute('partition', KN_LENS_PARTITION);
  webview.className = 'kn-lens-webview';
  host.appendChild(webview);
  document.body.appendChild(host);
  knLens.host = host;
  knLens.webview = webview;
  window.addEventListener('resize', knLensPlace);
  return host;
}

/** Lay the webview over the slot, or hide it when the slot is gone. */
function knLensPlace() {
  const host = knLens.host;
  if (!host) return;
  const slot = knLens.slot;
  const rect = slot && slot.isConnected ? slot.getBoundingClientRect() : null;
  if (!rect || rect.width < 2 || rect.height < 2) {
    host.hidden = true;
    clearInterval(knLens.timer);
    knLens.timer = null;
    return;
  }
  host.hidden = false;
  Object.assign(host.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  // A slot can go without an event this file hears (the page redrawn, a tab
  // switched): look again while the Lens shows.
  if (!knLens.timer) knLens.timer = setInterval(knLensPlace, 300);
}

function knLensShow(slot, url) {
  knLensHost();
  knLens.slot = slot;
  if (knLens.url !== url) {
    knLens.url = url;
    knLens.webview.setAttribute('src', url);
  }
  knLensPlace();
}

function knLensState(s, folder) {
  const d = knViewData(s, 'lens', folder);
  if (!d.init) Object.assign(d, { init: true, workspace: 'galaxy', info: null, loading: false, error: null });
  return d;
}

async function knLoadLens(project, folder, d) {
  d.loading = true;
  const r = await window.api.knowledgeLens(project.id, folder, d.workspace);
  d.loading = false;
  d.error = r?.error || null;
  d.info = r?.error ? null : r;
}

function renderKnowledgeLens(project, view, folder, body) {
  const s = knState(project);
  const d = knLensState(s, folder);
  if (!d.info && !d.loading && !d.error) {
    view.innerHTML = '<div class="kn-page"><div class="kn-loading">Looking for the Lens…</div></div>';
    knLoadLens(project, folder, d).then(() => { if (view.isConnected) renderKnowledgeLens(project, view, folder, body); });
    return;
  }
  const info = d.info;
  const warning = 'The Lens has no login: any program on this computer can open it, and through it read every indexed project and start or delete indexes. It listens on 127.0.0.1 only; never publish its port through a tunnel.';
  if (d.error || !info) {
    view.innerHTML = `<div class="kn-page">${knNoticeHtml('The Lens could not be reached', d.error || '', `<button type="button" class="ws-btn" data-kn-act="retry">${PICONS.refresh(12)}<span>Try again</span></button>`)}</div>`;
  } else if (!info.enabled) {
    view.innerHTML = `<div class="kn-page">${knNoticeHtml('The Lens is off', `CBM Lens is codebase-memory-mcp's own view of the graph: a 3D map of the whole codebase (Galaxy), the architecture, the decision record, coverage and the daemon. ${warning}`,
      `<button type="button" class="ws-btn ws-btn--primary" data-kn-act="enable">Turn the Lens on</button>`)}</div>`;
  } else if (!info.reachable) {
    view.innerHTML = `<div class="kn-page">${knNoticeHtml(`The Lens is not answering on port ${info.port}`, 'codebase-memory-mcp\'s daemon serves it, and reads this setting when it starts. The daemon is shared with your agents\' sessions: it starts again, with the Lens, once they have all ended. Another program may also hold the port; change it in Settings › Node Knowledge.',
      `<button type="button" class="ws-btn" data-kn-act="retry">${PICONS.refresh(12)}<span>Try again</span></button>`)}</div>`;
  } else {
    // The Lens has its own bar of workspaces (Explore, Galaxy, Architecture…).
    view.innerHTML = `<div class="kn-lens">
      <div class="kn-lens-bar">
        <span class="ws-help">${info.project ? `CBM Lens on <span class="kn-mono">${escapeHtml(info.project)}</span>, served by codebase-memory-mcp on port ${info.port}` : 'This folder is not indexed yet: the Lens opens on its own project list.'}</span>
        <span class="kn-spacer"></span>
        <button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="reload" title="Reload the Lens">${PICONS.refresh(11)}</button>
        <button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="browser" title="${escapeAttr(warning)}">${PICONS.globe(11)}<span>Open in the browser</span></button>
      </div>
      <div class="kn-lens-slot" data-kn-lens-slot></div>
    </div>`;
    knLensShow(view.querySelector('[data-kn-lens-slot]'), info.url);
  }
  const on = (act, fn) => { const el = view.querySelector(`[data-kn-act="${act}"]`); if (el) el.onclick = fn; };
  on('retry', () => { d.info = null; d.error = null; renderKnowledgeLens(project, view, folder, body); });
  on('enable', async (e) => {
    e.currentTarget.disabled = true;
    const r = await window.api.setKnowledgeConfig('ui_enabled', 'true');
    if (knToastError(r)) { e.currentTarget.disabled = false; return; }
    d.info = null;
    renderKnowledgeLens(project, view, folder, body);
  });
  on('reload', () => { try { knLens.webview?.reload(); } catch {} });
  on('browser', () => window.api.openExternal(info.url));
}

/** Open the Lens view on a folder, at one of its workspaces (from elsewhere in the tab). */
function knOpenLens(project, folder, workspace) {
  const s = knState(project);
  const d = knLensState(s, folder);
  d.workspace = KnowledgeModel.LENS_WORKSPACES.some(w => w.id === workspace) ? workspace : 'galaxy';
  d.info = null;
  s.folder = folder;
  s.view = 'lens';
  if (projectTab(project) !== 'knowledge') showProjectTab(project, 'knowledge');
  else knRedraw(project);
}

knViewRenderers.lens = renderKnowledgeLens;
