// project-knowledge-lens.js — the Node Knowledge tab's Lens view: the Lens,
// codebase-memory-mcp's own web UI (the 3D graph, Galaxy, Architecture, ADR,
// Coverage, System), served by its daemon on 127.0.0.1 without a login.
//
// The Lens refuses to be framed (frame-ancestors 'none'), so it is a <webview>
// in a session of its own, which main lets load http on 127.0.0.1 only
// (web-page.js). The page is redrawn whole at every projects-changed, and a
// webview that is moved or made again reloads; so there is one webview, on
// document.body, laid over a slot the view draws, and hidden when the slot is
// gone (another tab, view or project).
//
// The Lens has its own green: it takes the app's accent colour instead
// (knLensRecolor, run in its page), and its title reads LENS.

const KN_LENS_PARTITION = 'persist:cbm-lens';

// The Lens's header says "CBM Lens": text alone, so the brand's own text is
// hidden and LENS drawn in its place, with nothing in its page changed.
const KN_LENS_CSS = `
.atlas-brand { font-size: 0 !important; gap: 0 !important; }
.atlas-brand::before { content: 'LENS'; font-size: 15px; }
.atlas-brand-beta { font-size: 10px !important; margin-left: 8px; }
`;

/**
 * Runs inside the Lens's page (webview.executeJavaScript, as a string): its
 * accent becomes the app's. The accent variables and the bright greens take
 * the colour itself; every other green in its stylesheets (pressed and hover
 * states, borders) turns to the accent's hue, keeping its lightness,
 * saturation and alpha, and its greenish greys become the app's cool greys. The first values are kept, so another
 * accent starts from them again; stylesheets that come later are seen too.
 */
function knLensRecolor(accent) {
  const doc = document;
  const state = window.__sbLensAccent || (window.__sbLensAccent = { originals: new Map(), observing: false });
  state.accent = accent;
  const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g;
  function parse(text) {
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(text);
    if (!m) return null;
    const a = m[4] == null ? 1 : (m[5] ? Number(m[4]) / 100 : Number(m[4]));
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  }
  function hsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
  }
  function rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }
  const A = parse(accent);
  if (!A) return 0;
  const AH = hsl(A);
  const out = (c, a) => (a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(a * 1000) / 1000})`);
  function shift(text) {
    const c = parse(text);
    if (!c) return text;
    const h = hsl(c);
    if (h.h < 85 || h.h > 175 || h.s < 0.08) return text;
    // The Lens's phosphor and its kin are the accent itself.
    if (h.s > 0.6 && h.l > 0.5 && h.l < 0.8) return out(A, c.a);
    // Its greenish greys (backgrounds, lines, dim text) become the app's cool greys, whatever the accent.
    if (h.s < 0.25) return out(rgb(240, Math.min(h.s, 0.15), h.l), c.a);
    return out(rgb(AH.h, Math.min(h.s, Math.max(AH.s, 0.3)), h.l), c.a);
  }
  const VARS = { '--atlas-phosphor': accent, '--atlas-phosphor-mute': `color-mix(in srgb, ${accent} 50%, black)` };
  let changed = 0;
  function recolor(rule) {
    let saved = state.originals.get(rule);
    if (!saved) {
      saved = [];
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        const value = rule.style.getPropertyValue(prop);
        if (VARS[prop] || (value && value.match(COLOR))) saved.push([prop, value, rule.style.getPropertyPriority(prop)]);
      }
      state.originals.set(rule, saved);
    }
    for (const [prop, value, priority] of saved) {
      const next = VARS[prop] || value.replace(COLOR, shift);
      if (rule.style.getPropertyValue(prop) !== next) { rule.style.setProperty(prop, next, priority); changed++; }
    }
  }
  function walk(rules) {
    for (const rule of Array.from(rules || [])) {
      if (rule.style) recolor(rule);
      if (rule.cssRules) walk(rule.cssRules);
    }
  }
  for (const sheet of Array.from(doc.styleSheets || [])) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { continue; }
    walk(rules);
  }
  if (!state.observing && typeof MutationObserver === 'function' && doc.head) {
    state.observing = true;
    new MutationObserver((records) => {
      for (const r of records) for (const node of r.addedNodes) {
        if (node.nodeName === 'STYLE') knLensRecolorAgain();
        else if (node.nodeName === 'LINK') node.addEventListener('load', knLensRecolorAgain, { once: true });
      }
    }).observe(doc.head, { childList: true });
  }
  function knLensRecolorAgain() { setTimeout(() => window.__sbLensRecolor && window.__sbLensRecolor(state.accent), 0); }
  return changed;
}

/** Give the Lens the app's accent and its own title: at each load, and when the accent changes. */
function knLensTheme() {
  const webview = knLens.webview;
  if (!webview || !knLens.ready) return;
  const accent = window.AccentColor ? window.AccentColor.current() : '#8088ff';
  const code = `window.__sbLensRecolor = ${knLensRecolor.toString()}; window.__sbLensRecolor(${JSON.stringify(accent)});`;
  try { webview.executeJavaScript(code).catch(() => {}); } catch {}
}
const knLens = { host: null, webview: null, url: null, slot: null, timer: null, ready: false };

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
  webview.addEventListener('dom-ready', () => {
    knLens.ready = true;
    try { webview.insertCSS(KN_LENS_CSS).catch(() => {}); } catch {}
    knLensTheme();
    // The Lens draws its workspaces after its scripts run.
    setTimeout(knLensTheme, 1500);
  });
  window.addEventListener('accent-color-changed', knLensTheme);
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
    knLens.ready = false;
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
    view.innerHTML = `<div class="kn-page">${knNoticeHtml('The Lens is off', `The Lens is codebase-memory-mcp's own view of the graph: a 3D map of the whole codebase (Galaxy), the architecture, the decision record, coverage and the daemon. ${warning}`,
      `<button type="button" class="ws-btn ws-btn--primary" data-kn-act="enable">Turn the Lens on</button>`)}</div>`;
  } else if (!info.reachable) {
    view.innerHTML = `<div class="kn-page">${knNoticeHtml(`The Lens is not answering on port ${info.port}`, 'codebase-memory-mcp\'s daemon serves it, and reads this setting when it starts. The daemon is shared with your agents\' sessions: it starts again, with the Lens, once they have all ended. Another program may also hold the port; change it in Settings › Node Knowledge.',
      `<button type="button" class="ws-btn" data-kn-act="retry">${PICONS.refresh(12)}<span>Try again</span></button>`)}</div>`;
  } else {
    // The Lens has its own bar of workspaces (Explore, Galaxy, Architecture…).
    view.innerHTML = `<div class="kn-lens">
      <div class="kn-lens-bar">
        <span class="ws-help">${info.project ? `Lens on <span class="kn-mono">${escapeHtml(info.project)}</span>, served by codebase-memory-mcp on port ${info.port}` : 'This folder is not indexed yet: the Lens opens on its own project list.'}</span>
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
