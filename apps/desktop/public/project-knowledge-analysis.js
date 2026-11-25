// project-knowledge-analysis.js — the Node Knowledge tab's Impact, Query,
// ADR, Coverage and Compare views (project-knowledge-view.js has the tab).
//   Impact    detect_changes: what a change touches and what depends on it.
//   Query     query_graph: Cypher over the graph, or over the "missed" graph
//             of coverage gaps; examples and saved queries.
//   ADR       manage_adr: the folder's architecture decision record, kept by
//             CBM beside its graph (not in the repository).
//   Coverage  index_status (verbose) and check_index_coverage: what the graph
//             holds in part, could not read, or leaves out on purpose.
//   Compare   compare_graphs between two folders of the project.

function knPlainResults(items, { emptyText = 'None', extra } = {}) {
  if (!items.length) return `<div class="kn-empty">${escapeHtml(emptyText)}</div>`;
  return items.map((item, i) => knSymbolRowHtml(item, i, extra ? extra(item) : '')).join('');
}

// --- Impact ---

function knImpactState(s, folder) {
  const d = knViewData(s, 'impact', folder);
  if (!d.init) Object.assign(d, { init: true, against: 'uncommitted', ref: '', scope: 'impact', depth: 2, fixpoint: false, result: null, loading: false, error: null });
  return d;
}

function knImpactArgs(d, cursor) {
  const args = { scope: d.scope, direction: 'inbound', depth: Math.max(1, Math.min(8, Number(d.depth) || 2)), via: true, limit: 100, changed_limit: 100 };
  if (d.fixpoint) args.fixpoint = true;
  if (d.against === 'uncommitted') args.since = 'HEAD';
  else if (d.against === 'since' && d.ref.trim()) args.since = d.ref.trim();
  else if (d.against === 'branch' && d.ref.trim()) args.base_branch = d.ref.trim();
  if (cursor) args.impact_cursor = cursor;
  return args;
}

async function knRunImpact(project, folder, d, { more = false } = {}) {
  d.loading = true;
  d.error = null;
  const r = await window.api.knowledgeQuery(project.id, folder, 'detect_changes', knImpactArgs(d, more ? d.result?.impactedCursor : null));
  d.loading = false;
  if (r?.error) { d.error = r.error; return; }
  if (d.scope === 'tests') { d.result = { tests: KnowledgeModel.testImpactModel(r) }; return; }
  const page = KnowledgeModel.impactModel(r);
  d.result = more && d.result?.impacted ? { ...page, impacted: d.result.impacted.concat(page.impacted) } : page;
}

function knImpactResultHtml(d) {
  if (d.error) return `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  if (d.loading && !d.result) return '<div class="kn-loading">Reading the change…</div>';
  const r = d.result;
  if (!r) return '<div class="kn-empty">See what a change touches before it lands: the symbols it edits, everything that calls them, step by step, and the modules they sit in. Pick what to compare with, then Analyse.</div>';
  if (r.tests) {
    const t = r.tests;
    return `<div class="ws-card"><div class="ws-card-h"><span class="ws-card-title">Tests to run</span><span class="ws-card-meta">experimental in codebase-memory-mcp</span></div>
      <div class="ws-card-text">${escapeHtml(t.decision ? `Decision: ${t.decision}` : 'No decision')} · ${knNumber(t.suites)} suites · ${knNumber(t.tests)} tests</div>
      ${t.runAllReasons.length ? `<div class="ws-card-text">Run everything because: ${escapeHtml(t.runAllReasons.join('; '))}</div>` : ''}
      ${t.warnings.map(w => `<div class="ws-card-text muted">${escapeHtml(w)}</div>`).join('')}
      <div class="ws-card-text muted">CBM picks single tests only for the C and C++ harnesses it supports; elsewhere it says whether a change needs the tests at all.</div></div>`;
  }
  const changed = r.changedFiles.length
    ? r.changedFiles.map((f, i) => `<button type="button" class="kn-result" data-kn-file="${i}"><span class="kn-result-name mono">${escapeHtml(f)}</span></button>`).join('')
    : '<div class="kn-empty">No changed files.</div>';
  const modules = r.modules.length ? `<div class="kn-chips">${r.modules.map(m => `<span class="kn-chip"><span>${escapeHtml(m.module)}</span><b>${knNumber(m.count)}</b></span>`).join('')}</div>` : '';
  const rows = r.impacted.map((item, i) => `<button type="button" class="kn-result" data-kn-impact="${i}" title="${escapeAttr(item.qn)}">
      <span class="kn-hop">${item.hop || ''}</span>
      <span class="kn-result-name">${escapeHtml(item.name)}</span>
      ${item.label ? `<span class="kn-label">${escapeHtml(item.label)}</span>` : ''}
      ${item.viaName ? `<span class="kn-result-meta">via ${escapeHtml(item.viaName)}${item.viaEdge && item.viaEdge !== 'CALLS' ? ` (${escapeHtml(item.viaEdge)})` : ''}</span>` : ''}
      <span class="kn-result-where">${escapeHtml(item.file || '')}</span></button>`).join('');
  return `<div class="kn-results-meta">${knNumber(r.changedTotal)} file${r.changedTotal === 1 ? '' : 's'} changed${r.base ? ` against ${escapeHtml(r.base)}` : ''} · ${knNumber(r.seeds)} symbol${r.seeds === 1 ? '' : 's'} in them · ${knNumber(r.impactedTotal)} reached</div>
    <div class="kn-impact-grid">
      <div class="ws-card kn-impact-files"><div class="ws-card-h"><span class="ws-card-title">Changed files</span></div><div class="kn-results">${changed}</div></div>
      <div class="ws-card kn-impact-reach"><div class="ws-card-h"><span class="ws-card-title">What depends on them</span><span class="ws-card-meta">by steps from the change</span></div>
        ${modules}
        <div class="kn-results">${rows || '<div class="kn-empty">Nothing calls the changed symbols.</div>'}</div>
        ${r.impactedCursor ? '<button type="button" class="ws-ghost ws-ghost--sm kn-more" data-kn-act="more">More</button>' : ''}
      </div>
    </div>`;
}

function renderKnowledgeImpact(project, view, folder, body) {
  const s = knState(project);
  const d = knImpactState(s, folder);
  const against = [['uncommitted', 'Uncommitted changes'], ['branch', 'This branch against its base'], ['since', 'Since a commit or tag']]
    .map(([v, l]) => `<option value="${v}"${v === d.against ? ' selected' : ''}>${l}</option>`).join('');
  const refPlaceholder = d.against === 'branch' ? 'base branch (empty: main, master or origin\'s)' : 'commit, tag or ref';
  view.innerHTML = `<div class="kn-page">
    <form class="kn-search-bar" data-kn-form>
      <select class="ws-select" data-kn-field="against" aria-label="Compare with">${against}</select>
      ${d.against !== 'uncommitted' ? `<input type="text" class="ws-input mono kn-search-input" data-kn-field="ref" value="${escapeAttr(d.ref)}" placeholder="${escapeAttr(refPlaceholder)}" spellcheck="false" aria-label="Reference">` : ''}
      <div class="kn-seg" role="tablist" aria-label="Show">
        ${[['impact', 'Impact'], ['files', 'Files only'], ['tests', 'Tests']].map(([v, l]) => `<button type="button" class="kn-seg-btn${d.scope === v ? ' active' : ''}" data-kn-scope="${v}">${l}</button>`).join('')}
      </div>
      <label class="ws-check">Steps <input type="number" class="ws-input kn-num" min="1" max="8" data-kn-field="depth" value="${Number(d.depth) || 2}"></label>
      <label class="ws-check" title="Follow callers until nothing new is reached"><input type="checkbox" data-kn-field="fixpoint"${d.fixpoint ? ' checked' : ''}>To the end</label>
      <button type="submit" class="ws-btn ws-btn--primary">${PICONS.play(12)}<span>Analyse</span></button>
      <span class="kn-spacer"></span>
      ${typeof knAskAgentButtonHtml === 'function' ? knAskAgentButtonHtml('review') : ''}
    </form>
    <div data-kn-impact-body>${knImpactResultHtml(d)}</div>
  </div>`;
  const field = (n) => view.querySelector(`[data-kn-field="${n}"]`);
  const read = () => {
    d.against = field('against').value;
    if (field('ref')) d.ref = field('ref').value;
    d.depth = Number(field('depth').value) || 2;
    d.fixpoint = field('fixpoint').checked;
  };
  const run = async (opts) => {
    read();
    const pending = knRunImpact(project, folder, d, opts);
    renderKnowledgeImpact(project, view, folder, body);
    await pending;
    if (view.isConnected) renderKnowledgeImpact(project, view, folder, body);
  };
  view.querySelector('[data-kn-form]').onsubmit = (e) => { e.preventDefault(); run(); };
  field('against').onchange = () => { read(); renderKnowledgeImpact(project, view, folder, body); };
  view.querySelectorAll('[data-kn-scope]').forEach(btn => { btn.onclick = () => { read(); d.scope = btn.dataset.knScope; d.result = null; run(); }; });
  const r = d.result;
  view.querySelectorAll('[data-kn-file]').forEach(btn => { btn.onclick = () => knOpenInFiles(project, folder, r.changedFiles[Number(btn.dataset.knFile)]); });
  view.querySelectorAll('[data-kn-impact]').forEach(btn => { btn.onclick = () => knOpenSymbolPanel(project, folder, r.impacted[Number(btn.dataset.knImpact)].qn); });
  const more = view.querySelector('[data-kn-act="more"]');
  if (more) more.onclick = () => run({ more: true });
  if (typeof knWireAskAgent === 'function') knWireAskAgent(project, view, folder, () => ({ change: d.against === 'uncommitted' ? 'the uncommitted changes' : d.ref.trim() || 'this branch', base_branch: d.against === 'branch' ? d.ref.trim() : '' }));
  if (d.autorun) { d.autorun = false; run(); }
}

// --- Query ---

function knQueryState(s, folder) {
  const d = knViewData(s, 'query', folder);
  if (!d.init) Object.assign(d, { init: true, text: KnowledgeModel.CYPHER_EXAMPLES[0].query, graph: 'code', result: null, loading: false, error: null, saving: false });
  return d;
}

async function knRunQuery(project, folder, d, { more = false } = {}) {
  const query = d.text.trim();
  if (!query) return;
  d.loading = true;
  d.error = null;
  const offset = more && d.result ? d.result.rows.length : 0;
  const r = await window.api.knowledgeQuery(project.id, folder, 'query_graph', { query, graph: d.graph, max_rows: 200, offset });
  d.loading = false;
  if (r?.error) { d.error = r.error; return; }
  const page = KnowledgeModel.queryTable(r);
  d.result = more && d.result ? { ...page, rows: d.result.rows.concat(page.rows) } : page;
}

function knQueryResultHtml(d) {
  if (d.error) return `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  if (d.loading && !d.result) return '<div class="kn-loading">Running…</div>';
  const r = d.result;
  if (!r) return '<div class="kn-empty">Ask the graph in Cypher (read-only: MATCH, WHERE, WITH, RETURN, ORDER BY, aggregates). Run with ⌘↵.</div>';
  if (!r.rows.length) return '<div class="kn-empty">No rows.</div>';
  const head = r.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const rows = r.rows.map(row => `<tr>${row.map(v => `<td title="${escapeAttr(KnowledgeModel.cellText(v))}">${escapeHtml(KnowledgeModel.cellText(v))}</td>`).join('')}</tr>`).join('');
  return `<div class="kn-results-meta">${knNumber(r.rows.length)} of ${knNumber(r.total)} row${r.total === 1 ? '' : 's'}${r.truncated ? ' · cut short' : ''}</div>
    <div class="kn-table-wrap kn-table-wrap--query"><table class="kn-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    ${r.hasMore ? '<button type="button" class="ws-ghost ws-ghost--sm kn-more" data-kn-act="more">More</button>' : ''}`;
}

function renderKnowledgeQuery(project, view, folder, body) {
  const s = knState(project);
  const d = knQueryState(s, folder);
  const saved = s.status?.settings?.savedQueries || [];
  const examples = KnowledgeModel.CYPHER_EXAMPLES.map((q, i) => `<option value="e${i}">${escapeHtml(q.name)}</option>`).join('');
  const savedOptions = saved.map((q, i) => `<option value="s${i}">${escapeHtml(q.name)}</option>`).join('');
  const schema = knViewData(s, 'overview', folder).schema;
  const chips = schema
    ? `<div class="kn-chips kn-query-schema">${schema.labels.slice(0, 18).map(x => `<button type="button" class="kn-chip" data-kn-insert=":${escapeAttr(x.label)}">${escapeHtml(x.label)}</button>`).join('')}${schema.edges.slice(0, 18).map(x => `<button type="button" class="kn-chip kn-chip--edge" data-kn-insert="[:${escapeAttr(x.type)}]">${escapeHtml(x.type)}</button>`).join('')}</div>`
    : '';
  view.innerHTML = `<div class="kn-page">
    <div class="kn-search-options">
      <select class="ws-select" data-kn-field="example" aria-label="Examples"><option value="">Examples…</option>${examples}${savedOptions ? `<optgroup label="Saved">${savedOptions}</optgroup>` : ''}</select>
      <div class="kn-seg" role="tablist" aria-label="Graph">
        <button type="button" class="kn-seg-btn${d.graph === 'code' ? ' active' : ''}" data-kn-graph="code" title="The code graph">Code</button>
        <button type="button" class="kn-seg-btn${d.graph === 'missed' ? ' active' : ''}" data-kn-graph="missed" title="The folders and files the index flagged (coverage gaps)">Gaps</button>
      </div>
      <span class="kn-spacer"></span>
      ${d.saving
        ? `<input type="text" class="ws-input" data-kn-field="save-name" placeholder="Name of the query" aria-label="Name"><button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="save-ok">Save</button><button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="save-cancel">Cancel</button>`
        : `<button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="save">${PICONS.plus(11)}<span>Save query</span></button>${saved.length ? `<button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="forget" title="Forget the saved query picked in the list">${PICONS.trash(11)}</button>` : ''}`}
      <button type="button" class="ws-btn ws-btn--primary" data-kn-act="run">${PICONS.play(12)}<span>Run</span></button>
    </div>
    <div class="kn-query-editor" data-kn-editor></div>
    ${chips}
    <div data-kn-query-body>${knQueryResultHtml(d)}</div>
  </div>`;
  const host = view.querySelector('[data-kn-editor]');
  let editor = null;
  if (typeof window.createEditableViewer === 'function') {
    // A query box: the editor without its status bar.
    editor = window.createEditableViewer(host, d.text, 'query.cypher', { wrap: true, statusBar: false, onChange: () => { d.text = editor.state.doc.toString(); } });
  } else {
    host.innerHTML = `<textarea class="ws-input mono kn-query-text" spellcheck="false">${escapeHtml(d.text)}</textarea>`;
    host.querySelector('textarea').oninput = (e) => { d.text = e.target.value; };
  }
  const setText = (text) => {
    d.text = text;
    if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    else host.querySelector('textarea').value = text;
  };
  const run = async (opts) => {
    const pending = knRunQuery(project, folder, d, opts);
    paint();
    await pending;
    if (view.isConnected) paint();
  };
  const paint = () => {
    const box = view.querySelector('[data-kn-query-body]');
    if (!box) return;
    box.innerHTML = knQueryResultHtml(d);
    const more = box.querySelector('[data-kn-act="more"]');
    if (more) more.onclick = () => run({ more: true });
  };
  host.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(); }
  }, true);
  const pick = view.querySelector('[data-kn-field="example"]');
  pick.onchange = () => {
    const v = pick.value;
    const q = v.startsWith('e') ? KnowledgeModel.CYPHER_EXAMPLES[Number(v.slice(1))] : v.startsWith('s') ? saved[Number(v.slice(1))] : null;
    if (q) { setText(q.query); d.picked = v; }
  };
  view.querySelectorAll('[data-kn-graph]').forEach(btn => { btn.onclick = () => { d.graph = btn.dataset.knGraph; d.result = null; renderKnowledgeQuery(project, view, folder, body); }; });
  view.querySelectorAll('[data-kn-insert]').forEach(btn => {
    btn.onclick = () => {
      const text = btn.dataset.knInsert;
      if (editor) { editor.dispatch(editor.state.replaceSelection(text)); editor.focus(); d.text = editor.state.doc.toString(); }
      else setText(d.text + text);
    };
  });
  const on = (act, fn) => { const el = view.querySelector(`[data-kn-act="${act}"]`); if (el) el.onclick = fn; };
  on('run', () => run());
  on('save', () => { d.saving = true; renderKnowledgeQuery(project, view, folder, body); view.querySelector('[data-kn-field="save-name"]')?.focus(); });
  on('save-cancel', () => { d.saving = false; renderKnowledgeQuery(project, view, folder, body); });
  on('save-ok', async () => {
    const name = view.querySelector('[data-kn-field="save-name"]').value.trim() || d.text.trim().slice(0, 40);
    const next = saved.filter(q => q.name !== name).concat({ name, query: d.text });
    const r = await window.api.setKnowledgeSettings(project.id, { savedQueries: next });
    if (knToastError(r)) return;
    if (s.status) s.status.settings = r.settings;
    d.saving = false;
    renderKnowledgeQuery(project, view, folder, body);
  });
  on('forget', async () => {
    if (!d.picked || !d.picked.startsWith('s')) return;
    const next = saved.filter((_q, i) => `s${i}` !== d.picked);
    const r = await window.api.setKnowledgeSettings(project.id, { savedQueries: next });
    if (knToastError(r)) return;
    if (s.status) s.status.settings = r.settings;
    d.picked = null;
    renderKnowledgeQuery(project, view, folder, body);
  });
  paint();
  if (!schema) {
    const data = knViewData(s, 'overview', folder);
    if (!data.loading && !data.schema) knLoadOverview(project, folder, data, knFolderStatus(s, folder)?.index?.indexed_at || '').then(() => { if (view.isConnected && data.schema && !d.saving) renderKnowledgeQuery(project, view, folder, body); });
  }
}

// --- ADR ---

const KN_ADR_TEMPLATE = `# Architecture decisions

## Context
What the system is, and the forces that shape it.

## Decision
What was decided, and what it rules out.

## Consequences
What becomes easier, what becomes harder.

## Status
Accepted
`;

function knAdrState(s, folder) {
  const d = knViewData(s, 'adr', folder);
  if (!d.init) Object.assign(d, { init: true, content: null, outline: null, loading: false, error: null, editing: false, draft: '' });
  return d;
}

async function knLoadAdr(project, folder, d) {
  d.loading = true;
  const [got, outline] = await Promise.all([
    window.api.knowledgeAdr(project.id, folder, { mode: 'get' }),
    window.api.knowledgeAdr(project.id, folder, { mode: 'outline' }),
  ]);
  d.loading = false;
  d.error = got?.error || null;
  d.content = got?.error ? null : (typeof got?.content === 'string' ? got.content : '');
  d.outline = outline?.error ? null : KnowledgeModel.adrOutline(outline);
}

function knMarkdownHtml(text) {
  const raw = window.marked ? window.marked.parse(String(text || '')) : `<pre>${escapeHtml(text)}</pre>`;
  return window.DOMPurify ? window.DOMPurify.sanitize(raw) : `<pre>${escapeHtml(text)}</pre>`;
}

function renderKnowledgeAdr(project, view, folder, body) {
  const s = knState(project);
  const d = knAdrState(s, folder);
  if (d.content == null && !d.loading && !d.error) {
    view.innerHTML = '<div class="kn-page"><div class="kn-loading">Reading the decision record…</div></div>';
    knLoadAdr(project, folder, d).then(() => { if (view.isConnected) renderKnowledgeAdr(project, view, folder, body); });
    return;
  }
  if (d.loading) { view.innerHTML = '<div class="kn-page"><div class="kn-loading">Reading the decision record…</div></div>'; return; }
  let content;
  if (d.editing) {
    const bytes = KnowledgeModel.utf8Bytes(d.draft);
    content = `<div class="kn-adr-edit">
      <textarea class="ws-input mono kn-adr-text" data-kn-field="draft" spellcheck="true" aria-label="Decision record">${escapeHtml(d.draft)}</textarea>
      <div class="kn-adr-foot"><span class="ws-help${bytes > 8000 ? ' kn-error-text' : ''}" data-kn-bytes>${knNumber(bytes)} / 8,000 bytes</span><span class="kn-spacer"></span>
        <button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="cancel">Cancel</button>
        <button type="button" class="ws-btn ws-btn--primary" data-kn-act="save"${bytes > 8000 ? ' disabled' : ''}>Save</button></div>
    </div>`;
  } else if (d.error) content = `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  else if (!d.content || !d.content.trim()) {
    content = knNoticeHtml('No decision record yet', 'The ADR is the folder\'s architecture decisions in Markdown, kept by codebase-memory-mcp beside the graph (not in the repository). Agents read it with manage_adr; decisions found in the repository\'s own docs show up as ADR nodes in the graph.',
      `<button type="button" class="ws-btn ws-btn--primary" data-kn-act="start">${PICONS.plus(12)}<span>Start one</span></button>`);
  } else {
    const toc = d.outline && d.outline.headings.length
      ? `<nav class="kn-adr-toc">${d.outline.headings.map(h => `<span class="kn-adr-toc-item" style="padding-left:${(h.level - 1) * 12}px">${escapeHtml(h.title)}</span>`).join('')}</nav>`
      : '';
    content = `<div class="kn-adr">${toc}<article class="kn-adr-body markdown-body">${knMarkdownHtml(d.content)}</article></div>`;
  }
  view.innerHTML = `<div class="kn-page">
    <div class="kn-section-title"><span>Architecture decisions of ${escapeHtml(pathBasename(folder))}</span>
      ${!d.editing && d.content && d.content.trim() ? `<button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="edit">${PICONS.pencil(11)}<span>Edit</span></button>` : ''}</div>
    ${content}
  </div>`;
  const on = (act, fn) => { const el = view.querySelector(`[data-kn-act="${act}"]`); if (el) el.onclick = fn; };
  on('start', () => { d.editing = true; d.draft = KN_ADR_TEMPLATE; renderKnowledgeAdr(project, view, folder, body); });
  on('edit', () => { d.editing = true; d.draft = d.content || ''; renderKnowledgeAdr(project, view, folder, body); });
  on('cancel', () => { d.editing = false; renderKnowledgeAdr(project, view, folder, body); });
  on('save', async (e) => {
    e.currentTarget.disabled = true;
    const r = await window.api.knowledgeAdr(project.id, folder, { mode: 'update', content: d.draft });
    if (knToastError(r)) { e.currentTarget.disabled = false; return; }
    d.editing = false;
    d.content = null;
    renderKnowledgeAdr(project, view, folder, body);
  });
  const area = view.querySelector('[data-kn-field="draft"]');
  if (area) {
    const changed = () => {
      const bytes = KnowledgeModel.utf8Bytes(d.draft);
      const label = view.querySelector('[data-kn-bytes]');
      label.textContent = `${knNumber(bytes)} / 8,000 bytes`;
      label.classList.toggle('kn-error-text', bytes > 8000);
      view.querySelector('[data-kn-act="save"]').disabled = bytes > 8000;
    };
    if (typeof window.createCodeEditor === 'function') {
      // The app's editor, in Markdown: find and replace, go to a heading, the rest.
      const host = document.createElement('div');
      host.className = 'kn-adr-text kn-adr-editor';
      area.replaceWith(host);
      const editor = window.createCodeEditor(host, {
        doc: d.draft, language: 'markdown', wrap: true,
        onChange: () => { d.draft = window.cmGetText(editor); changed(); },
      });
      // Cmd/Ctrl+S saves, as the Save button.
      host.addEventListener('cm-save', (e) => {
        e.stopPropagation();
        const save = view.querySelector('[data-kn-act="save"]');
        if (save && !save.disabled) save.click();
      });
      editor.focus();
    } else {
      area.oninput = () => { d.draft = area.value; changed(); };
      area.focus();
    }
  }
}

// --- Coverage ---

function knCoverageState(s, folder) {
  const d = knViewData(s, 'coverage', folder);
  if (!d.init) Object.assign(d, { init: true, gaps: null, generation: null, loading: false, error: null, paths: '', check: null, modules: null, modulesGeneration: null, modulesLoading: false, modulesError: null });
  return d;
}

/** "410", or "500 of 1,345 listed" when codebase-memory-mcp sent fewer rows than there are. */
function knCountText(total, listed) {
  return listed < total ? `${knNumber(listed)} of ${knNumber(total)} listed` : knNumber(total);
}

function knGapListHtml(title, items, { total = items.length, hint = '', groups = [] } = {}) {
  if (!total) return '';
  const groupHtml = groups.length > 1
    ? `<div class="kn-chips" title="By folder, of the files listed">${groups.slice(0, 16).map(g => `<span class="kn-chip"><span class="mono">${escapeHtml(g.folder === '.' ? '(top)' : `${g.folder}/`)}</span><b>${knNumber(g.count)}</b></span>`).join('')}</div>`
    : '';
  return `<div class="ws-card" data-kn-gap-card="${escapeAttr(title)}"><div class="ws-card-h"><span class="ws-card-title">${escapeHtml(title)}</span><span class="ws-card-meta">${knCountText(total, items.length)} file${total === 1 ? '' : 's'}</span></div>
    ${hint ? `<div class="ws-card-text muted">${escapeHtml(hint)}</div>` : ''}
    ${groupHtml}
    <div class="kn-results kn-gap-list">${items.map((g, i) => `<button type="button" class="kn-result" data-kn-gap="${escapeAttr(title)}" data-kn-i="${i}">
      <span class="kn-result-name mono">${escapeHtml(g.path)}</span>
      ${g.ranges ? `<span class="kn-result-meta">lines ${escapeHtml(g.ranges)}</span>` : ''}
      ${g.reason ? `<span class="kn-label kn-label--muted">${escapeHtml(g.reason)}</span>` : ''}</button>`).join('')}</div></div>`;
}

/** The left-out folders by name: ".claude" in eight places is one rule. */
function knDirGroupsHtml(groups) {
  if (!groups.length) return '';
  return `<div class="kn-chips">${groups.slice(0, 40).map(g => {
    const where = g.where.map(w => (w === '.' ? '(top)' : w));
    const title = `${g.name} is left out in ${g.count} place${g.count === 1 ? '' : 's'}: ${where.slice(0, 30).join(', ')}${where.length > 30 ? ', …' : ''}`;
    return `<span class="kn-chip" title="${escapeAttr(title)}"><span class="mono">${escapeHtml(g.name)}</span><b>${knNumber(g.count)}</b></span>`;
  }).join('')}</div>`;
}

/** The repositories inside the folder, and where their code is. */
function knModulesHtml(d) {
  if (d.modulesError) return `<div class="ws-card"><div class="ws-card-h"><span class="ws-card-title">Repositories inside</span></div><div class="kn-notice-error">${escapeHtml(d.modulesError)}</div></div>`;
  if (!d.modules) return d.modulesLoading ? '<div class="kn-loading">Looking for repositories inside…</div>' : '';
  const { modules, limited } = d.modules;
  if (!modules.length && !limited) return '';
  const rows = modules.map((m, i) => {
    const state = KnowledgeModel.MODULE_STATE_TEXT[m.state] || m.state;
    const extra = m.state === 'in' && m.gaps ? ` · ${knNumber(m.gaps)} gap${m.gaps === 1 ? '' : 's'} flagged` : m.state === 'own' && m.graph ? ` · ${m.graph}` : '';
    const action = m.state === 'out' && !m.attached
      ? `<button type="button" class="ws-ghost ws-ghost--sm" data-kn-module-attach="${i}" title="Attach it to the project: it gets a graph of its own">${PICONS.plus(11)}<span>Attach</span></button>`
      : '';
    return `<div class="kn-result kn-result--static kn-module kn-module--${escapeAttr(m.state)}">
      <span class="kn-result-name mono" title="${escapeAttr(m.path)}">${escapeHtml(m.rel)}</span>
      <span class="kn-label kn-label--muted">${escapeHtml(KnowledgeModel.MODULE_KIND_TEXT[m.kind] || m.kind)}</span>
      <span class="kn-result-meta${m.state === 'out' ? ' kn-error-text' : ''}">${escapeHtml(state + extra)}</span>
      ${action}</div>`;
  }).join('');
  return `<div class="ws-card" data-kn-modules><div class="ws-card-h"><span class="ws-card-title">Repositories inside</span><span class="ws-card-meta">${knNumber(modules.length)}${limited ? '+' : ''}</span></div>
    <div class="ws-card-text muted">Submodules and repositories cloned inside this folder. Their code is in this graph, in a graph of their own (a folder of the project), or in none when this folder's rules leave them out: attach one of those to read it.</div>
    <div class="kn-results kn-gap-list">${rows}</div>
    ${limited ? '<div class="ws-card-text muted">The search stopped early (a very large folder): repositories deeper down may be missing from the list.</div>' : ''}</div>`;
}

/** Other CBM graphs of folders inside this one (made by a session that started in a subfolder): its files are here already. */
function knInnerGraphsHtml(fstatus) {
  const inner = fstatus?.inner || [];
  if (!inner.length) return '';
  return `<div class="ws-card" data-kn-inner><div class="ws-card-h"><span class="ws-card-title">Other graphs inside this folder</span><span class="ws-card-meta">${knNumber(inner.length)}</span></div>
    <div class="ws-card-text muted">codebase-memory-mcp made these when an agent's session started in a subfolder. Their files are in this folder's graph already, so they only repeat it.</div>
    <div class="kn-results kn-gap-list">${inner.map((g, i) => `<div class="kn-result kn-result--static"><span class="kn-result-name mono">${escapeHtml(g.rel)}</span><span class="kn-result-meta mono">${escapeHtml(g.name)}</span>
      <button type="button" class="ws-link-danger" data-kn-inner-delete="${i}">Delete</button></div>`).join('')}</div></div>`;
}

function renderKnowledgeCoverage(project, view, folder, body) {
  const s = knState(project);
  const d = knCoverageState(s, folder);
  const fstatus = knFolderStatus(s, folder);
  const generation = fstatus?.index?.indexed_at || '';
  if ((!d.gaps && !d.loading && !d.error) || (d.generation !== generation && !d.loading)) {
    d.loading = true;
    d.generation = generation;
    // 'full': every row CBM keeps (up to 500 of each list); 'summary' would give five.
    window.api.knowledgeQuery(project.id, folder, 'index_status', { verbose: true, diagnostics: 'full' }).then(r => {
      d.loading = false;
      d.error = r?.error || null;
      d.gaps = r?.error ? null : KnowledgeModel.indexGaps(r);
      if (view.isConnected) renderKnowledgeCoverage(project, view, folder, body);
    });
  }
  if (window.api.knowledgeModules && ((!d.modules && !d.modulesLoading && !d.modulesError) || (d.modulesGeneration !== generation && !d.modulesLoading))) {
    d.modulesLoading = true;
    d.modulesGeneration = generation;
    window.api.knowledgeModules(project.id, folder).then(r => {
      d.modulesLoading = false;
      d.modulesError = r?.error || null;
      d.modules = r?.error ? null : KnowledgeModel.modulesModel(r);
      if (view.isConnected) renderKnowledgeCoverage(project, view, folder, body);
    });
  }
  const g = d.gaps;
  let gapsHtml;
  if (d.error) gapsHtml = `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  else if (!g) gapsHtml = '<div class="kn-loading">Reading the index…</div>';
  else {
    const reasons = g.reasons.map(r => `<span class="kn-chip"><span>${escapeHtml(r.reason)}</span><b>${knNumber(r.count)}</b></span>`).join('');
    gapsHtml = `${g.note ? `<details class="kn-outline"><summary>How to read these lists</summary><div class="ws-help">${escapeHtml(g.note)}</div></details>` : ''}
      ${g.truncated ? '<div class="ws-card-text muted kn-truncated">codebase-memory-mcp lists at most 500 rows of each list; the counts are whole. Check a file or a folder above for its own gaps.</div>' : ''}
      ${knGapListHtml('Read in part', g.partial, { total: g.counts.partial, groups: g.partialByFolder, hint: 'These files are in the graph, but codebase-memory-mcp\'s parser could not read the lines shown: what is on them may be missing from the graph. Read those lines in the file. This is a limit of the parser, not a cut made by Switchboard.' })}
      ${knGapListHtml('Could not read', g.unusable, { total: g.counts.unusable, hint: 'The parser could not use these files: none of their code is in the graph. Read them directly.' })}
      ${knGapListHtml('Skipped', g.skipped, { total: g.counts.skipped })}
      <div class="ws-card" data-kn-left-out><div class="ws-card-h"><span class="ws-card-title">Left out on purpose</span><span class="ws-card-meta">${knCountText(g.counts.notIndexed, g.listed.notIndexed)} files · ${knCountText(g.counts.notIndexedDirs, g.listed.notIndexedDirs)} folders</span>
        <span class="kn-spacer"></span><button type="button" class="ws-ghost ws-ghost--sm" data-kn-act="ignore">${PICONS.file(11)}<span>Ignore rules</span></button></div>
        <div class="ws-card-text muted">The same rule leaves a folder out wherever it is: the folders are counted by name.</div>
        ${knDirGroupsHtml(g.dirsByName)}
        ${reasons ? `<div class="kn-chips" title="Why, for the files listed">${reasons}</div>` : ''}
        <details class="kn-outline kn-gap-details"><summary>The folders</summary><div class="ws-card-text muted mono">${g.notIndexedDirs.map(x => escapeHtml(x)).join(' · ')}</div></details>
        <details class="kn-outline kn-gap-details"><summary>The files</summary><div class="kn-results kn-gap-list">${g.notIndexed.slice(0, 500).map(f => `<div class="kn-result kn-result--static"><span class="kn-result-name mono">${escapeHtml(f.path)}</span>${f.reason ? `<span class="kn-label kn-label--muted">${escapeHtml(f.reason)}</span>` : ''}</div>`).join('')}</div></details>
      </div>
      ${!g.counts.partial && !g.counts.unusable && !g.counts.skipped ? '<div class="kn-empty">Every source file was read whole. (A clean index means no recorded gap, not proof that nothing is missing.)</div>' : ''}`;
  }
  const c = d.check;
  const scopeRows = c?.model ? (c.model.scopes || []).map(sc => `<tr><td>${escapeHtml(String(sc.scope || sc.requested_scope || ''))}/</td><td>${escapeHtml(String(sc.status || ''))}</td><td></td><td>${knNumber(sc.total || 0)} gap${Number(sc.total) === 1 ? '' : 's'}</td></tr>`).join('') : '';
  const checkHtml = !c ? '' : c.error ? `<div class="kn-notice-error">${escapeHtml(c.error)}</div>`
    : `<div class="kn-table-wrap"><table class="kn-table"><thead><tr><th>file or folder</th><th>status</th><th>freshness</th><th>what to do</th></tr></thead><tbody>${c.model.paths.map(p => `<tr><td>${escapeHtml(p.path)}</td><td>${escapeHtml(p.status || '')}</td><td>${escapeHtml(p.freshness || '')}</td><td>${escapeHtml((p.action || '').replace(/_/g, ' '))}</td></tr>`).join('')}${scopeRows}</tbody></table></div>`;
  view.innerHTML = `<div class="kn-page">
    <div class="kn-section-title">Check files</div>
    <form class="kn-search-bar" data-kn-form>
      <input type="text" class="ws-input mono kn-search-input" data-kn-field="paths" value="${escapeAttr(d.paths)}" placeholder="files or folders (ending in /), separated by commas, e.g. src/app.ts, src/routes/" spellcheck="false" aria-label="Paths">
      <button type="submit" class="ws-btn">${PICONS.check(12)}<span>Check</span></button>
    </form>
    ${checkHtml}
    <div class="kn-section-title">What the graph is missing</div>
    ${knInnerGraphsHtml(fstatus)}
    ${knModulesHtml(d)}
    ${gapsHtml}
  </div>`;
  view.querySelector('[data-kn-form]').onsubmit = async (e) => {
    e.preventDefault();
    d.paths = view.querySelector('[data-kn-field="paths"]').value;
    const items = d.paths.split(/[,\n]/).map(p => p.trim()).filter(Boolean);
    const paths = items.filter(p => !/[\\/]$/.test(p)).slice(0, 128);
    const scopes = items.filter(p => /[\\/]$/.test(p)).map(p => p.replace(/[\\/]+$/, '')).filter(Boolean).slice(0, 32);
    if (!paths.length && !scopes.length) return;
    const args = {};
    if (paths.length) args.paths = paths;
    if (scopes.length) args.scopes = scopes;
    const r = await window.api.knowledgeQuery(project.id, folder, 'check_index_coverage', args);
    d.check = r?.error ? { error: r.error } : { model: KnowledgeModel.coverageModel(r) };
    if (view.isConnected) renderKnowledgeCoverage(project, view, folder, body);
  };
  view.querySelector('[data-kn-act="ignore"]')?.addEventListener('click', () => knEditIgnore(project, folder));
  view.querySelectorAll('[data-kn-gap]').forEach(btn => {
    const list = { 'Read in part': g.partial, 'Could not read': g.unusable, Skipped: g.skipped }[btn.dataset.knGap] || [];
    const item = list[Number(btn.dataset.knI)];
    const first = item?.ranges ? Number(String(item.ranges).split(/[-,]/)[0]) : null;
    btn.onclick = () => item && knOpenInFiles(project, folder, item.path, first);
  });
  view.querySelectorAll('[data-kn-module-attach]').forEach(btn => {
    const m = d.modules?.modules[Number(btn.dataset.knModuleAttach)];
    btn.onclick = async () => {
      if (!m) return;
      btn.disabled = true;
      const r = await window.api.attachProjectFolder(project.id, { path: m.path, mode: 'in-place' });
      if (knToastError(r)) { btn.disabled = false; return; }
      d.modules = null;
      s.stale = true;
      await knLoadStatus(project);
      if (view.isConnected) renderKnowledgeCoverage(project, view, folder, body);
    };
  });
  view.querySelectorAll('[data-kn-inner-delete]').forEach(btn => {
    const inner = (fstatus?.inner || [])[Number(btn.dataset.knInnerDelete)];
    btn.onclick = async () => {
      if (!inner) return;
      btn.disabled = true;
      const r = await window.api.knowledgeDeleteInnerGraph(project.id, folder, inner.name);
      if (knToastError(r)) { btn.disabled = false; return; }
      s.stale = true;
      await knLoadStatus(project);
      if (view.isConnected) renderKnowledgeCoverage(project, view, folder, body);
    };
  });
}

// --- Compare ---

function knCompareState(s, project) {
  const d = knViewData(s, 'compare', '*');
  if (!d.init) Object.assign(d, { init: true, base: null, target: null, result: null, loading: false, error: null });
  return d;
}

function knCompareListHtml(title, items, kind) {
  const rows = kind === 'nodes'
    ? items.slice(0, 300).map(n => `<div class="kn-result kn-result--static"><span class="kn-result-name">${escapeHtml(n.name)}</span>${n.label ? `<span class="kn-label">${escapeHtml(n.label)}</span>` : ''}<span class="kn-result-where">${escapeHtml(n.file || '')}</span></div>`).join('')
    : items.slice(0, 300).map(e => `<div class="kn-result kn-result--static"><span class="kn-result-name mono">${escapeHtml(e.from)}</span><span class="kn-arrow">→</span><span class="kn-result-name mono">${escapeHtml(e.to)}</span><span class="kn-label kn-label--muted">${escapeHtml(e.type || '')}</span></div>`).join('');
  return `<div class="ws-card"><div class="ws-card-h"><span class="ws-card-title">${escapeHtml(title)}</span><span class="ws-card-meta">${knNumber(items.length)}</span></div><div class="kn-results kn-gap-list">${rows || '<div class="ws-card-text muted">None</div>'}</div></div>`;
}

function renderKnowledgeCompare(project, view, folder, body) {
  const s = knState(project);
  const d = knCompareState(s, project);
  const indexed = (s.status?.folders || []).filter(f => f.indexed);
  if (indexed.length < 2) {
    view.innerHTML = `<div class="kn-page">${knNoticeHtml('Compare needs two indexed folders', 'Compare puts two code graphs of this project side by side, such as a worktree and its main checkout: the symbols and calls one has and the other lacks. Index a second folder first. To see what a branch or uncommitted work changes, use Impact.')}</div>`;
    return;
  }
  if (!indexed.some(f => f.path === d.base)) d.base = indexed[0].path;
  if (!indexed.some(f => f.path === d.target) || d.target === d.base) d.target = (indexed.find(f => f.path !== d.base) || indexed[1]).path;
  const options = (sel) => indexed.map(f => `<option value="${escapeAttr(f.path)}"${f.path === sel ? ' selected' : ''}>${escapeHtml(pathBasename(f.path))}</option>`).join('');
  const r = d.result;
  let content;
  if (d.error) content = `<div class="kn-notice-error">${escapeHtml(d.error)}</div>`;
  else if (d.loading) content = '<div class="kn-loading">Comparing…</div>';
  else if (!r) content = '<div class="kn-empty">Pick the two folders, then Compare.</div>';
  else {
    content = `<div class="kn-results-meta">${escapeHtml(pathBasename(d.base))}: ${knNumber(r.base.nodes)} nodes · ${escapeHtml(pathBasename(d.target))}: ${knNumber(r.target.nodes)} nodes${r.partial ? ' · <span class="kn-error-text">partial: codebase-memory-mcp cut its lists short, so some symbols both have may show up as added and removed</span>' : ''}</div>
      <div class="kn-impact-grid">
        ${knCompareListHtml(`Only in ${pathBasename(d.target)}`, r.addedNodes, 'nodes')}
        ${knCompareListHtml(`Only in ${pathBasename(d.base)}`, r.removedNodes, 'nodes')}
        ${knCompareListHtml('Calls added', r.addedEdges, 'edges')}
        ${knCompareListHtml('Calls removed', r.removedEdges, 'edges')}
      </div>`;
  }
  view.innerHTML = `<div class="kn-page">
    <form class="kn-search-bar" data-kn-form>
      <select class="ws-select" data-kn-field="base" aria-label="From">${options(d.base)}</select>
      <span class="kn-arrow">→</span>
      <select class="ws-select" data-kn-field="target" aria-label="To">${options(d.target)}</select>
      <button type="submit" class="ws-btn ws-btn--primary">Compare</button>
    </form>
    ${content}
  </div>`;
  view.querySelector('[data-kn-form]').onsubmit = async (e) => {
    e.preventDefault();
    d.base = view.querySelector('[data-kn-field="base"]').value;
    d.target = view.querySelector('[data-kn-field="target"]').value;
    if (d.base === d.target) return;
    d.loading = true;
    d.error = null;
    renderKnowledgeCompare(project, view, folder, body);
    const res = await window.api.knowledgeCompare(project.id, d.base, d.target, { limit: 1000 });
    d.loading = false;
    if (res?.error) d.error = res.error; else d.result = KnowledgeModel.compareModel(res);
    if (view.isConnected) renderKnowledgeCompare(project, view, folder, body);
  };
}

knViewRenderers.impact = renderKnowledgeImpact;
knViewRenderers.query = renderKnowledgeQuery;
knViewRenderers.adr = renderKnowledgeAdr;
knViewRenderers.coverage = renderKnowledgeCoverage;
knViewRenderers.compare = renderKnowledgeCompare;
