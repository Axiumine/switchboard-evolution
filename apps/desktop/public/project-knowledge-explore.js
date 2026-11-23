// project-knowledge-explore.js — the Node Knowledge tab's Search and Trace
// views, and the symbol panel both open (project-knowledge-view.js has the
// tab). Search asks search_graph (names, BM25 text, meaning) or search_code
// (text in the source); a symbol shows get_code_snippet with its neighbours
// and the outline of its file. Trace draws trace_path as a two-sided tree
// that opens one node at a time, since CBM gives the hops of a trace but not
// the links between them.

const KN_LABELS = ['', 'Function', 'Method', 'Class', 'Interface', 'Type', 'Struct', 'Enum', 'Route', 'Variable', 'Constant', 'Module', 'File'];

// --- Search ---

function knSearchState(s, folder) {
  const d = knViewData(s, 'search', folder);
  if (!d.init) Object.assign(d, { init: true, kind: 'symbols', query: '', label: '', meaning: false, namePattern: '', filePattern: '', regex: false, results: null, loading: false, error: null, symbol: null });
  return d;
}

function knSymbolRowHtml(item, i, extra = '') {
  const where = item.file ? `${item.file}${item.start ? `:${item.start}` : ''}` : '';
  return `<button type="button" class="kn-result" data-kn-result="${i}" title="${escapeAttr(item.qn)}">
    <span class="kn-result-name">${escapeHtml(item.name || item.qn)}</span>
    ${item.label ? `<span class="kn-label">${escapeHtml(item.label)}</span>` : ''}
    ${extra}
    <span class="kn-result-where">${escapeHtml(where)}</span>
  </button>`;
}

function knSearchResultsHtml(d) {
  if (d.error) return `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  if (d.loading && !d.results) return '<div class="kn-loading">Searching…</div>';
  const r = d.results;
  if (!r) return '<div class="kn-empty">Search the graph by name or words (“parse config”), by meaning, or the source text itself.</div>';
  if (r.kind === 'code') {
    const rows = r.items.map((item, i) => knSymbolRowHtml(item, i, item.matches ? `<span class="kn-result-meta">${item.matches.length} match${item.matches.length === 1 ? '' : 'es'}</span>` : '')).join('');
    const raw = r.raw.map((m, i) => `<button type="button" class="kn-result kn-result--raw" data-kn-raw="${i}"><span class="kn-result-name mono">${escapeHtml(m.content.trim().slice(0, 160))}</span><span class="kn-result-where">${escapeHtml(`${m.file}:${m.line}`)}</span></button>`).join('');
    return `<div class="kn-results-meta">${knNumber(r.total)} symbol${r.total === 1 ? '' : 's'} hold ${knNumber(r.matches)} match${r.matches === 1 ? '' : 'es'}</div>
      ${rows || ''}${raw ? `<div class="kn-results-meta">Outside any symbol</div>${raw}` : ''}
      ${!rows && !raw ? '<div class="kn-empty">Nothing found.</div>' : ''}
      ${r.hasMore ? `<button type="button" class="ws-ghost ws-ghost--sm kn-more" data-kn-act="more">More</button>` : ''}`;
  }
  const rows = r.items.map((item, i) => knSymbolRowHtml(item, i)).join('');
  const semantic = r.semantic.map((item, i) => knSymbolRowHtml(item, `s${i}`)).join('');
  return `<div class="kn-results-meta">${knNumber(r.total)} found${r.mode ? ` · ${escapeHtml(r.mode)}` : ''}</div>
    ${rows || (semantic ? '' : '<div class="kn-empty">Nothing found.</div>')}
    ${r.hasMore ? `<button type="button" class="ws-ghost ws-ghost--sm kn-more" data-kn-act="more">More</button>` : ''}
    ${semantic ? `<div class="kn-results-meta">Close in meaning</div>${semantic}` : ''}`;
}

async function knRunSearch(project, folder, d, { more = false } = {}) {
  const query = d.query.trim();
  if (!query && !d.namePattern.trim() && !d.filePattern.trim()) { d.results = null; return; }
  d.loading = true;
  d.error = null;
  let result;
  if (d.kind === 'code') {
    const offset = more && d.results ? d.results.nextOffset || 0 : 0;
    const args = { pattern: query, limit: 20, result_offset: offset, context: 0 };
    if (d.regex) args.regex = true;
    if (d.filePattern.trim()) args.file_pattern = d.filePattern.trim();
    result = await window.api.knowledgeQuery(project.id, folder, 'search_code', args);
    if (!result?.error) {
      const page = KnowledgeModel.codeResults(result);
      d.results = more && d.results ? { ...page, kind: 'code', items: d.results.items.concat(page.items), raw: d.results.raw.concat(page.raw) } : { ...page, kind: 'code' };
    }
  } else {
    const offset = more && d.results ? d.results.nextOffset || 0 : 0;
    const args = { limit: 30, offset };
    if (query) args.query = query;
    if (d.label) args.label = d.label;
    if (d.namePattern.trim()) args.name_pattern = d.namePattern.trim();
    if (d.filePattern.trim()) args.file_pattern = d.filePattern.trim();
    if (d.meaning && query && !more) args.semantic_query = [query];
    result = await window.api.knowledgeQuery(project.id, folder, 'search_graph', args);
    if (!result?.error) {
      const page = KnowledgeModel.searchResults(result);
      d.results = more && d.results ? { ...page, kind: 'symbols', items: d.results.items.concat(page.items), semantic: d.results.semantic } : { ...page, kind: 'symbols' };
    }
  }
  d.loading = false;
  if (result?.error) d.error = result.error;
}

function renderKnowledgeSearch(project, view, folder, body) {
  const s = knState(project);
  const d = knSearchState(s, folder);
  const labelOptions = KN_LABELS.map(l => `<option value="${l}"${l === d.label ? ' selected' : ''}>${l || 'Any kind'}</option>`).join('');
  view.innerHTML = `<div class="kn-split${d.symbol ? ' kn-split--open' : ''}">
    <div class="kn-split-list">
      <form class="kn-search-bar" data-kn-form>
        <div class="kn-seg" role="tablist" aria-label="Search in">
          <button type="button" class="kn-seg-btn${d.kind === 'symbols' ? ' active' : ''}" data-kn-kind="symbols">Symbols</button>
          <button type="button" class="kn-seg-btn${d.kind === 'code' ? ' active' : ''}" data-kn-kind="code">Code</button>
        </div>
        <input type="search" class="ws-input kn-search-input" data-kn-field="query" value="${escapeAttr(d.query)}" placeholder="${d.kind === 'code' ? 'Text in the source' : 'Name or words, e.g. parse config'}" spellcheck="false" aria-label="Search">
        <button type="submit" class="ws-btn ws-btn--primary">${PICONS.search(12)}<span>Search</span></button>
      </form>
      <div class="kn-search-options">
        ${d.kind === 'symbols'
          ? `<select class="ws-select" data-kn-field="label" aria-label="Kind">${labelOptions}</select>
             <label class="ws-check" title="Also find symbols whose code is about these words, not only named after them"><input type="checkbox" data-kn-field="meaning"${d.meaning ? ' checked' : ''}>By meaning</label>
             <input type="text" class="ws-input mono" data-kn-field="namePattern" value="${escapeAttr(d.namePattern)}" placeholder="name regex" spellcheck="false" aria-label="Name pattern (regular expression)">`
          : `<label class="ws-check"><input type="checkbox" data-kn-field="regex"${d.regex ? ' checked' : ''}>Regular expression</label>`}
        <input type="text" class="ws-input mono" data-kn-field="filePattern" value="${escapeAttr(d.filePattern)}" placeholder="files, e.g. src/**/*.ts" spellcheck="false" aria-label="File pattern">
      </div>
      <div class="kn-results" data-kn-results>${knSearchResultsHtml(d)}</div>
    </div>
    ${d.symbol ? '<div class="kn-split-detail" data-kn-symbol></div>' : ''}
  </div>`;

  const field = (name) => view.querySelector(`[data-kn-field="${name}"]`);
  const read = () => {
    d.query = field('query')?.value || '';
    if (field('label')) d.label = field('label').value;
    if (field('meaning')) d.meaning = field('meaning').checked;
    if (field('namePattern')) d.namePattern = field('namePattern').value;
    if (field('regex')) d.regex = field('regex').checked;
    d.filePattern = field('filePattern')?.value || '';
  };
  const run = async (opts) => {
    read();
    const pending = knRunSearch(project, folder, d, opts);
    paint();
    await pending;
    if (view.isConnected) paint();
  };
  const paint = () => {
    const box = view.querySelector('[data-kn-results]');
    if (!box) return;
    box.innerHTML = knSearchResultsHtml(d);
    wireResults();
  };
  const wireResults = () => {
    const r = d.results;
    view.querySelectorAll('[data-kn-result]').forEach(btn => {
      const key = btn.dataset.knResult;
      const item = key.startsWith('s') ? r.semantic[Number(key.slice(1))] : r.items[Number(key)];
      btn.onclick = () => knOpenSymbolPanel(project, folder, item.qn);
    });
    view.querySelectorAll('[data-kn-raw]').forEach(btn => {
      const m = r.raw[Number(btn.dataset.knRaw)];
      btn.onclick = () => knOpenInFiles(project, folder, m.file, m.line);
    });
    const more = view.querySelector('[data-kn-act="more"]');
    if (more) more.onclick = () => run({ more: true });
  };
  view.querySelector('[data-kn-form]').onsubmit = (e) => { e.preventDefault(); run(); };
  view.querySelectorAll('[data-kn-kind]').forEach(btn => {
    btn.onclick = () => {
      if (d.kind === btn.dataset.knKind) return;
      read();
      d.kind = btn.dataset.knKind;
      d.results = null;
      renderKnowledgeSearch(project, view, folder, body);
      if (d.query.trim()) run();
    };
  });
  wireResults();
  if (d.symbol) knRenderSymbol(project, folder, view.querySelector('[data-kn-symbol]'), d);
  const input = field('query');
  if (input && !d.symbol) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

// --- The symbol panel ---

/** Show a symbol in the Search view's panel, from anywhere in the tab. */
function knOpenSymbolPanel(project, folder, qn) {
  const s = knState(project);
  const d = knSearchState(s, folder);
  d.symbol = { qn, data: null, loading: false, error: null, outline: null };
  s.folder = folder;
  s.view = 'search';
  if (projectTab(project) !== 'knowledge') showProjectTab(project, 'knowledge');
  else knRedraw(project);
}

function knSourceHtml(source, start, mark) {
  const lines = String(source || '').replace(/\n$/, '').split('\n');
  const first = Number(start) || 1;
  return `<pre class="kn-source">${lines.map((text, i) => `<span class="kn-src-line${first + i === mark ? ' kn-src-line--mark' : ''}"><span class="kn-src-no">${first + i}</span>${escapeHtml(text) || ' '}</span>`).join('')}</pre>`;
}

function knNamesHtml(names, kind) {
  if (!names.length) return '<span class="ws-help">None</span>';
  // CBM gives these as names already (a module is its file name, dots and all).
  return names.slice(0, 40).map(n => `<button type="button" class="kn-sym-link" data-kn-name="${escapeAttr(n)}" data-kn-dir="${kind}">${escapeHtml(n)}</button>`).join('<span class="kn-arrow">·</span>');
}

async function knLoadSymbol(project, folder, sym) {
  sym.loading = true;
  const r = await window.api.knowledgeQuery(project.id, folder, 'get_code_snippet', { qualified_name: sym.qn, include_neighbors: true, source_mode: 'auto' });
  sym.loading = false;
  if (r?.error) { sym.error = r.error; return; }
  const amb = KnowledgeModel.ambiguity(r);
  if (amb) { sym.ambiguity = amb; return; }
  sym.data = KnowledgeModel.snippetModel(r);
  const rel = knRelPath(folder, sym.data.file);
  if (rel) {
    const o = await window.api.knowledgeQuery(project.id, folder, 'get_file_outline', { file_path: rel, limit: 200 });
    sym.outline = o?.error ? null : KnowledgeModel.outlineModel(o);
  }
}

function knRenderSymbol(project, folder, box, d) {
  const sym = d.symbol;
  if (!box || !sym) return;
  const close = `<button type="button" class="ws-ghost ws-ghost--sm kn-close" data-kn-act="close-symbol" title="Close" aria-label="Close">${PICONS.x(12)}</button>`;
  if (sym.error) box.innerHTML = `<div class="kn-symbol-head">${close}</div><div class="kn-notice-error">${escapeHtml(sym.error)}</div>`;
  else if (sym.ambiguity) {
    box.innerHTML = `<div class="kn-symbol-head"><span class="kn-symbol-title">Which one?</span>${close}</div>
      <div class="ws-help">${escapeHtml(sym.ambiguity.message)}</div>
      <div class="kn-results">${sym.ambiguity.suggestions.map((item, i) => knSymbolRowHtml(item, i)).join('')}</div>`;
    box.querySelectorAll('[data-kn-result]').forEach(btn => {
      const item = sym.ambiguity.suggestions[Number(btn.dataset.knResult)];
      btn.onclick = () => knOpenSymbolPanel(project, folder, item.qn);
    });
  } else if (!sym.data) {
    box.innerHTML = `<div class="kn-symbol-head">${close}</div><div class="kn-loading">Reading ${escapeHtml(KnowledgeModel.shortName(sym.qn))}…</div>`;
    if (!sym.loading) knLoadSymbol(project, folder, sym).then(() => { if (box.isConnected && d.symbol === sym) knRenderSymbol(project, folder, box, d); });
  } else {
    const x = sym.data;
    const where = x.file ? `${knRelPath(folder, x.file) || x.file}${x.start ? `:${x.start}${x.end && x.end !== x.start ? `-${x.end}` : ''}` : ''}` : '';
    const outline = sym.outline && sym.outline.items.length
      ? `<details class="kn-outline"><summary>Outline of the file · ${knNumber(sym.outline.total)}</summary>${sym.outline.items.map((item, i) => `<button type="button" class="kn-outline-row${item.qn === x.qn ? ' current' : ''}" data-kn-outline="${i}"><span class="kn-label">${escapeHtml(item.label || '')}</span><span>${escapeHtml(item.name)}</span><span class="kn-result-where">${item.start || ''}</span></button>`).join('')}</details>`
      : '';
    box.innerHTML = `<div class="kn-symbol-head">
        <span class="kn-symbol-title" title="${escapeAttr(x.qn)}">${escapeHtml(x.name)}</span>
        ${x.label ? `<span class="kn-label">${escapeHtml(x.label)}</span>` : ''}
        <span class="kn-spacer"></span>
        <button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="trace-symbol" title="Who calls it and what it calls">${PICONS.branch(11)}<span>Trace</span></button>
        <button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="open-symbol">${PICONS.open(11)}<span>Open in Files</span></button>
        ${close}
      </div>
      <div class="kn-symbol-where mono">${escapeHtml(where)}</div>
      <div class="kn-symbol-links"><b>Called by ${knNumber(x.callers)}</b>${knNamesHtml(x.callerNames, 'in')}</div>
      <div class="kn-symbol-links"><b>Calls ${knNumber(x.callees)}</b>${knNamesHtml(x.calleeNames, 'out')}</div>
      ${knSourceHtml(x.source, x.sourceMode === 'outline' ? null : x.start)}
      ${outline}`;
    box.querySelector('[data-kn-act="open-symbol"]').onclick = () => knOpenInFiles(project, folder, x.file, x.start);
    box.querySelector('[data-kn-act="trace-symbol"]').onclick = () => knOpenTrace(project, folder, x.qn, x.name);
    box.querySelectorAll('[data-kn-name]').forEach(btn => { btn.onclick = () => knOpenSymbolPanel(project, folder, btn.dataset.knName); });
    box.querySelectorAll('[data-kn-outline]').forEach(btn => {
      const item = sym.outline.items[Number(btn.dataset.knOutline)];
      btn.onclick = () => knOpenSymbolPanel(project, folder, item.qn);
    });
  }
  box.querySelector('[data-kn-act="close-symbol"]').onclick = () => { d.symbol = null; knRedraw(project); };
}

// --- Trace ---

function knTraceState(s, folder) {
  const d = knViewData(s, 'trace', folder);
  if (!d.init) Object.assign(d, { init: true, name: '', mode: 'calls', direction: 'both', depth: 3, tests: false, show: 'graph', tree: null, list: null, loading: false, error: null, ambiguity: null, selected: null });
  return d;
}

/** Open Trace on a symbol. */
function knOpenTrace(project, folder, qn, name) {
  const s = knState(project);
  const d = knTraceState(s, folder);
  d.name = qn;
  d.label = name || KnowledgeModel.shortName(qn);
  d.tree = null;
  d.list = null;
  d.ambiguity = null;
  d.selected = null;
  d.autorun = true;
  s.folder = folder;
  s.view = 'trace';
  knRedraw(project);
}

function knTraceArgs(d, name, depth, direction) {
  const args = { function_name: name, direction, depth, limit: 200, risk_labels: true };
  if (d.mode && d.mode !== 'calls') args.mode = d.mode;
  if (d.tests) args.include_tests = true;
  return args;
}

async function knRunTrace(project, folder, d) {
  const name = d.name.trim();
  if (!name) return;
  d.loading = true;
  d.error = null;
  d.ambiguity = null;
  d.selected = null;
  const depth = d.show === 'graph' ? 1 : Math.max(1, Math.min(10, Number(d.depth) || 3));
  const r = await window.api.knowledgeQuery(project.id, folder, 'trace_path', knTraceArgs(d, name, depth, d.direction));
  d.loading = false;
  if (r?.error) { d.error = r.error; return; }
  const amb = KnowledgeModel.ambiguity(r);
  if (amb) { d.ambiguity = amb; return; }
  const sides = KnowledgeModel.traceSides(r);
  d.raw = sides.callers.length || sides.callees.length ? null : r;
  d.list = sides;
  if (d.show === 'graph') {
    const root = sides.root || name;
    d.tree = { qn: root, name: d.label || KnowledgeModel.shortName(root), callers: sides.callers.filter(n => (n.hop || 1) === 1), callees: sides.callees.filter(n => (n.hop || 1) === 1) };
  }
}

/** Open a node of the graph: one more step on its side. */
async function knExpandNode(project, folder, d, node) {
  const direction = node.side === 'callers' ? 'inbound' : 'outbound';
  const r = await window.api.knowledgeQuery(project.id, folder, 'trace_path', knTraceArgs(d, node.qn, 1, direction));
  if (r?.error || KnowledgeModel.ambiguity(r)) return false;
  const sides = KnowledgeModel.traceSides(r);
  const next = (node.side === 'callers' ? sides.callers : sides.callees).filter(n => (n.hop || 1) === 1);
  d.tree = KnowledgeModel.expandTrace(d.tree, node.id, next);
  return true;
}

const KN_NODE_W = 172;
const KN_NODE_H = 26;

function knTraceGraphHtml(d) {
  const layout = KnowledgeModel.traceLayout(d.tree, { colWidth: 220, rowHeight: 36 });
  const pad = 16;
  const ox = -layout.minX + pad;
  const width = layout.width - 220 + KN_NODE_W + pad * 2;
  const height = layout.height + pad * 2;
  const byId = new Map(layout.nodes.map(n => [n.id, n]));
  const edges = layout.edges.map(e => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return '';
    const x1 = a.x + ox + KN_NODE_W;
    const y1 = a.y + pad + KN_NODE_H / 2;
    const x2 = b.x + ox;
    const y2 = b.y + pad + KN_NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="kn-edge" marker-end="url(#kn-arrowhead)"/>`;
  }).join('');
  const nodes = layout.nodes.map(n => {
    const color = KnowledgeModel.riskColor(n.risk);
    const cls = `kn-node${n.side === 'root' ? ' kn-node--root' : ''}${d.selected === n.id ? ' selected' : ''}`;
    const more = n.expandable ? '<span class="kn-node-more" aria-hidden="true">+</span>' : '';
    return `<button type="button" class="${cls}" data-kn-node="${escapeAttr(n.id)}" style="left:${n.x + ox}px;top:${n.y + pad}px;width:${KN_NODE_W}px;height:${KN_NODE_H}px;--kn-risk:${color}" title="${escapeAttr(`${n.qn}${n.risk ? ` · ${n.risk}` : ''}`)}"><span class="kn-node-name">${escapeHtml(n.name)}</span>${more}</button>`;
  }).join('');
  return `<div class="kn-graph" style="width:${width}px;height:${height}px">
    <svg class="kn-graph-svg" width="${width}" height="${height}" aria-hidden="true">
      <defs><marker id="kn-arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="kn-arrowhead"/></marker></defs>
      ${edges}
    </svg>
    ${nodes}
  </div>`;
}

function knTraceListHtml(d) {
  const side = (title, items, total) => `<div class="ws-card kn-trace-side"><div class="ws-card-h"><span class="ws-card-title">${title}</span><span class="ws-card-meta">${knNumber(total)}</span></div>
    ${items.length ? items.map((item, i) => `<button type="button" class="kn-result" data-kn-trace="${title === 'Called by' ? 'c' : 'e'}${i}" title="${escapeAttr(item.qn)}">
      <span class="kn-hop">${item.hop || ''}</span><span class="kn-risk" style="--kn-risk:${KnowledgeModel.riskColor(item.risk)}">${escapeHtml(item.risk || '')}</span>
      <span class="kn-result-name">${escapeHtml(item.name)}</span><span class="kn-result-where">${escapeHtml(item.file || '')}</span></button>`).join('') : '<div class="ws-card-text muted">None</div>'}
  </div>`;
  const l = d.list;
  return `<div class="kn-trace-list">${d.direction !== 'outbound' ? side('Called by', l.callers, l.callersTotal) : ''}${d.direction !== 'inbound' ? side('Calls', l.callees, l.calleesTotal) : ''}</div>`;
}

function renderKnowledgeTrace(project, view, folder, body) {
  const s = knState(project);
  const d = knTraceState(s, folder);
  const modeOptions = KnowledgeModel.TRACE_MODES.map(m => `<option value="${m.id}"${m.id === d.mode ? ' selected' : ''} title="${escapeAttr(m.hint)}">${escapeHtml(m.label)}</option>`).join('');
  const dirOptions = [['both', 'Both ways'], ['inbound', 'Who calls it'], ['outbound', 'What it calls']].map(([v, l]) => `<option value="${v}"${v === d.direction ? ' selected' : ''}>${l}</option>`).join('');
  let content;
  if (d.error) content = `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  else if (d.loading) content = '<div class="kn-loading">Tracing…</div>';
  else if (d.ambiguity) {
    content = `<div class="ws-help">${escapeHtml(d.ambiguity.message)}</div><div class="kn-results">${d.ambiguity.suggestions.map((item, i) => knSymbolRowHtml(item, `a${i}`)).join('')}</div>`;
  } else if (d.raw) content = `<div class="ws-help">No calls in this mode. CBM answered:</div><pre class="kn-source">${escapeHtml(JSON.stringify(d.raw, null, 2))}</pre>`;
  else if (d.show === 'graph' && d.tree) content = `<div class="ws-help">Click a node with + to open its next step; pick a node to read or trace it.</div><div class="kn-graph-scroll">${knTraceGraphHtml(d)}</div><div class="kn-node-bar" data-kn-nodebar></div>`;
  else if (d.show === 'list' && d.list) content = knTraceListHtml(d);
  else content = '<div class="kn-empty">Trace a function: who calls it, what it calls, and how risky a change to each one is. Open one from Search with Trace, or type its name.</div>';

  view.innerHTML = `<div class="kn-page">
    <form class="kn-search-bar" data-kn-form>
      <input type="text" class="ws-input kn-search-input mono" data-kn-field="name" value="${escapeAttr(d.name)}" placeholder="function name or qualified name" spellcheck="false" aria-label="Function">
      <select class="ws-select" data-kn-field="mode" aria-label="What to follow">${modeOptions}</select>
      <select class="ws-select" data-kn-field="direction" aria-label="Direction">${dirOptions}</select>
      <button type="submit" class="ws-btn ws-btn--primary">${PICONS.branch(12)}<span>Trace</span></button>
    </form>
    <div class="kn-search-options">
      <div class="kn-seg" role="tablist" aria-label="Show as">
        <button type="button" class="kn-seg-btn${d.show === 'graph' ? ' active' : ''}" data-kn-show="graph">Graph</button>
        <button type="button" class="kn-seg-btn${d.show === 'list' ? ' active' : ''}" data-kn-show="list">List</button>
      </div>
      ${d.show === 'list' ? `<label class="ws-check">Steps <input type="number" class="ws-input kn-num" min="1" max="10" data-kn-field="depth" value="${Number(d.depth) || 3}"></label>` : ''}
      <label class="ws-check"><input type="checkbox" data-kn-field="tests"${d.tests ? ' checked' : ''}>Include tests</label>
      <span class="kn-legend">${KnowledgeModel.RISKS.map(r => `<span class="kn-risk" style="--kn-risk:${KnowledgeModel.riskColor(r)}">${r.toLowerCase()}</span>`).join('')}</span>
    </div>
    <div class="kn-trace-body">${content}</div>
  </div>`;

  const field = (name) => view.querySelector(`[data-kn-field="${name}"]`);
  const read = () => {
    const typed = field('name').value;
    if (typed !== d.name) d.label = null;
    d.name = typed;
    d.mode = field('mode').value;
    d.direction = field('direction').value;
    if (field('depth')) d.depth = Number(field('depth').value) || 3;
    d.tests = field('tests').checked;
  };
  const run = async () => {
    read();
    const pending = knRunTrace(project, folder, d);
    renderKnowledgeTrace(project, view, folder, body);
    await pending;
    if (view.isConnected) renderKnowledgeTrace(project, view, folder, body);
  };
  view.querySelector('[data-kn-form]').onsubmit = (e) => { e.preventDefault(); run(); };
  view.querySelectorAll('[data-kn-show]').forEach(btn => {
    btn.onclick = () => { if (d.show === btn.dataset.knShow) return; d.show = btn.dataset.knShow; if (d.name.trim()) run(); else renderKnowledgeTrace(project, view, folder, body); };
  });
  view.querySelectorAll('[data-kn-result]').forEach(btn => {
    const key = btn.dataset.knResult;
    if (!key.startsWith('a')) return;
    const item = d.ambiguity.suggestions[Number(key.slice(1))];
    btn.onclick = () => { d.name = item.qn; d.label = item.name; run(); };
  });
  view.querySelectorAll('[data-kn-trace]').forEach(btn => {
    const key = btn.dataset.knTrace;
    const item = (key[0] === 'c' ? d.list.callers : d.list.callees)[Number(key.slice(1))];
    btn.onclick = () => knOpenSymbolPanel(project, folder, item.qn);
  });
  if (d.show === 'graph' && d.tree) knWireGraph(project, view, folder, body, d);
  if (d.autorun) { d.autorun = false; run(); }
}

function knWireGraph(project, view, folder, body, d) {
  const layout = KnowledgeModel.traceLayout(d.tree, { colWidth: 220, rowHeight: 36 });
  const byId = new Map(layout.nodes.map(n => [n.id, n]));
  const bar = view.querySelector('[data-kn-nodebar]');
  const paintBar = () => {
    const n = d.selected && byId.get(d.selected);
    if (!n) { bar.innerHTML = ''; return; }
    bar.innerHTML = `<span class="kn-node-bar-name mono" title="${escapeAttr(n.qn)}">${escapeHtml(n.qn)}</span>
      ${n.risk ? `<span class="kn-risk" style="--kn-risk:${KnowledgeModel.riskColor(n.risk)}">${escapeHtml(n.risk.toLowerCase())}</span>` : ''}
      <span class="kn-spacer"></span>
      <button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="node-code">${PICONS.file(11)}<span>Read code</span></button>
      ${n.side !== 'root' ? `<button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="node-trace">${PICONS.branch(11)}<span>Trace from here</span></button>` : ''}`;
    bar.querySelector('[data-kn-act="node-code"]').onclick = () => knOpenSymbolPanel(project, folder, n.qn);
    bar.querySelector('[data-kn-act="node-trace"]')?.addEventListener('click', () => knOpenTrace(project, folder, n.qn, n.name));
  };
  view.querySelectorAll('[data-kn-node]').forEach(btn => {
    btn.onclick = async () => {
      const n = byId.get(btn.dataset.knNode);
      if (!n) return;
      d.selected = n.id;
      if (n.expandable && n.side !== 'root') {
        btn.classList.add('loading');
        await knExpandNode(project, folder, d, n);
        if (view.isConnected) renderKnowledgeTrace(project, view, folder, body);
        return;
      }
      view.querySelectorAll('.kn-node.selected').forEach(el => el.classList.remove('selected'));
      btn.classList.add('selected');
      paintBar();
    };
  });
  paintBar();
}

knViewRenderers.search = renderKnowledgeSearch;
knViewRenderers.trace = renderKnowledgeTrace;
