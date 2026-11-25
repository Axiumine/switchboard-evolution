// The terminal's Commands palette: what the CLI of the session in front
// understands (its slash commands, skills, MCP servers, its own commands and
// flags, its keyboard shortcuts), searchable, with what each one takes and
// does.
//
// A pick types the command and a space into the session, without Enter, and
// goes back to the terminal, ready for the arguments. Run, for a command that
// needs none while the session is idle, types it and presses Enter (80 ms
// later, as the phone does, so the CLI does not read both as one paste); it
// asks first for a command that ends the session, replaces the conversation,
// signs in or out or writes files. A CLI's own commands and flags are copied
// in its session (they would be a chat message) and typed in a plain shell.
//
// The button sits in the terminal header, before the project files button,
// and in each card of the grid view; Mod+Shift+K opens it too. The entries come from the main process
// (command-catalog.js), the rules from command-catalog-model.js, which the
// phone's sheet shares.

const ENTER_AFTER_MS = 80;
let commandCatalogClis = [];
let commandCatalogBtn = null;
let commandPalette = null;

function catalogModel() {
  return window.CommandCatalogModel;
}

/** The session in front, as the palette needs it: its id now, the session, its terminal entry. */
function commandCatalogTarget() {
  if (typeof activeSessionId === 'undefined' || !activeSessionId) return null;
  const entry = openSessions.get(activeSessionId) || null;
  const session = (entry && entry.session) || sessionMap.get(activeSessionId) || null;
  if (!session) return null;
  return { sessionId: session.sessionId || activeSessionId, session, entry };
}

/** Does the session have a catalog: a CLI that has one, or a plain shell when any CLI has one. */
function sessionHasCommandCatalog(session) {
  if (!session) return false;
  if (session.type === 'terminal') return commandCatalogClis.length > 0;
  return commandCatalogClis.includes(session.runtime || 'claude');
}

/** The session's state for the catalog's rules: 'attention', 'busy' or 'idle'. */
function commandCatalogState(sessionId) {
  if (typeof attentionSessions !== 'undefined' && attentionSessions.has(sessionId)) return 'attention';
  if (typeof sessionBusyState !== 'undefined' && sessionBusyState.get(sessionId) === true) return 'busy';
  return 'idle';
}

async function initCommandCatalog() {
  const controls = document.getElementById('terminal-header-controls');
  if (!controls || commandCatalogBtn) return;
  commandCatalogBtn = document.createElement('button');
  commandCatalogBtn.id = 'command-catalog-btn';
  commandCatalogBtn.type = 'button';
  commandCatalogBtn.title = `Commands (${isMac ? '⌘⇧K' : 'Ctrl+Shift+K'})`;
  commandCatalogBtn.setAttribute('aria-label', 'Commands');
  commandCatalogBtn.setAttribute('aria-haspopup', 'dialog');
  commandCatalogBtn.setAttribute('aria-expanded', 'false');
  commandCatalogBtn.innerHTML = ICONS.commands(16);
  commandCatalogBtn.style.display = 'none';
  commandCatalogBtn.addEventListener('click', toggleCommandPalette);
  const before = document.getElementById('project-files-btn') || document.getElementById('terminal-stop-btn');
  controls.insertBefore(commandCatalogBtn, before || null);
  try {
    commandCatalogClis = (await window.api.getCommandCatalogClis()) || [];
  } catch {
    commandCatalogClis = [];
  }
  updateCommandCatalogButton();
}

/** Show the button for the session in front, and close a palette left open on another session. */
function updateCommandCatalogButton() {
  if (!commandCatalogBtn) return;
  const target = commandCatalogTarget();
  const shown = !!target && sessionHasCommandCatalog(target.session);
  commandCatalogBtn.style.display = shown ? '' : 'none';
  if (commandPalette && (!target || target.sessionId !== commandPalette.sessionId)) closeCommandPalette();
}

function toggleCommandPalette() {
  if (commandPalette) closeCommandPalette();
  else openCommandPalette();
}

async function openCommandPalette(options = {}) {
  const target = commandCatalogTarget();
  if (!target || !sessionHasCommandCatalog(target.session)) return;
  closeCommandPalette();
  const isShell = target.session.type === 'terminal';
  const cli = options.cli || (isShell ? (commandPalette && commandPalette.cli) || commandCatalogClis[0] : undefined);
  // What the window knows of the session's CLI, for one main has no row of yet.
  const runtime = isShell ? 'terminal' : target.session.runtime || 'claude';
  const el = document.createElement('div');
  el.className = 'cmdp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Commands');
  el.innerHTML = '<div class="cmdp-loading">Loading commands…</div>';
  document.body.appendChild(el);
  commandPalette = { el, sessionId: target.sessionId, catalog: null, tab: null, query: '', selected: 0, cli, confirm: null, anchor: options.anchor || null };
  placeCommandPalette();
  commandCatalogBtn && commandCatalogBtn.setAttribute('aria-expanded', 'true');
  commandCatalogBtn && commandCatalogBtn.classList.add('active');
  document.addEventListener('mousedown', commandPaletteOutside, true);
  window.addEventListener('resize', placeCommandPalette);
  const palette = commandPalette;
  let catalog = null;
  try {
    catalog = await window.api.getCommandCatalog(target.sessionId, cli ? { cli, runtime } : { runtime });
  } catch {
    catalog = null;
  }
  if (commandPalette !== palette) return;
  if (!catalog) {
    el.innerHTML = '<div class="cmdp-loading">No commands for this session.</div>';
    return;
  }
  palette.catalog = catalog;
  palette.cli = catalog.cli;
  palette.tab = (catalogModel().tabsFor(catalog)[0] || {}).id || null;
  renderCommandPalette({ focusSearch: true });
}

function closeCommandPalette() {
  if (!commandPalette) return;
  commandPalette.el.remove();
  commandPalette = null;
  document.removeEventListener('mousedown', commandPaletteOutside, true);
  window.removeEventListener('resize', placeCommandPalette);
  if (commandCatalogBtn) {
    commandCatalogBtn.setAttribute('aria-expanded', 'false');
    commandCatalogBtn.classList.remove('active');
  }
}

function commandPaletteOutside(event) {
  if (!commandPalette) return;
  const anchor = commandPalette.anchor || commandCatalogBtn;
  if (commandPalette.el.contains(event.target) || (anchor && anchor.contains(event.target))) return;
  closeCommandPalette();
}

/**
 * Under the button, its right edge on the button's, inside the window. Placed
 * again at every render: a grid card may still be moving when it opens.
 */
function placeCommandPalette() {
  if (!commandPalette) return;
  const el = commandPalette.el;
  const button = commandPalette.anchor || commandCatalogBtn;
  const anchor = button && button.offsetParent ? button.getBoundingClientRect() : null;
  const width = Math.min(720, window.innerWidth - 16);
  const height = el.offsetHeight || Math.min(560, window.innerHeight - 72);
  el.style.width = `${width}px`;
  const right = anchor ? anchor.right : window.innerWidth - 8;
  el.style.left = `${Math.max(8, Math.min(right - width, window.innerWidth - width - 8))}px`;
  const below = anchor ? anchor.bottom + 6 : 48;
  el.style.top = `${Math.max(8, Math.min(below, window.innerHeight - height - 8))}px`;
}

/** The entries shown: the tab's, matching the search. */
function commandPaletteEntries() {
  const p = commandPalette;
  if (!p || !p.catalog) return [];
  const M = catalogModel();
  return M.searchCommands(p.catalog.entries, p.query, {
    tab: p.query ? null : p.tab,
    tabs: M.tabsFor(p.catalog).map((t) => t.id),
  });
}

function formatCatalogDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function commandRowHtml(entry, index, selected, version) {
  const M = catalogModel();
  const badges = M.badgesOf(entry, version).filter((b) => b.id === 'danger' || b.id === 'newer' || b.id === 'source' || b.id === 'bundled');
  return `<button type="button" class="cmdp-row${selected ? ' selected' : ''}" role="option" aria-selected="${selected}" data-index="${index}">` +
    `<span class="cmdp-row-top"><span class="cmdp-cmd">${escapeHtml(entry.command)}</span>` +
    (entry.inputArgs ? `<span class="cmdp-args">${escapeHtml(entry.inputArgs)}</span>` : '') +
    badges.map((b) => `<span class="cmdp-badge cmdp-badge--${b.id}">${escapeHtml(b.label)}</span>`).join('') +
    `</span><span class="cmdp-desc">${escapeHtml(entry.description)}</span></button>`;
}

function commandDetailsHtml(entry, catalog, state) {
  const M = catalogModel();
  if (!entry) return '<div class="cmdp-empty">Nothing matches.</div>';
  const version = catalog.version && (catalog.version.session || catalog.version.installed);
  const insertion = M.insertionFor(entry, { target: catalog.target });
  const run = M.canRun(entry, { target: catalog.target, state });
  const notice = M.stateNotice(entry, state);
  const section = (label, html) => `<div class="cmdp-section"><div class="cmdp-label">${label}</div>${html}</div>`;
  let html = `<div class="cmdp-title"><span class="cmdp-cmd">${escapeHtml(entry.command)}</span>` +
    (entry.inputArgs ? ` <span class="cmdp-args">${escapeHtml(entry.inputArgs)}</span>` : '') + '</div>';
  const badges = M.badgesOf(entry, version);
  if (badges.length) html += `<div class="cmdp-badges">${badges.map((b) => `<span class="cmdp-badge cmdp-badge--${b.id}">${escapeHtml(b.label)}</span>`).join('')}</div>`;
  html += `<p class="cmdp-text">${escapeHtml(entry.description)}</p>`;
  if (entry.outputBehavior) html += `<p class="cmdp-text cmdp-text--dim">${escapeHtml(entry.outputBehavior)}</p>`;
  if (entry.aliases && entry.aliases.length) {
    const prefix = entry.kind === 'slash' ? '/' : '';
    html += section('Also', entry.aliases.map((a) => `<code>${escapeHtml(prefix + a)}</code>`).join(' '));
  }
  if (entry.acceptedValues && entry.acceptedValues.length) {
    html += section('Values', entry.acceptedValues.map((v) => `<code>${escapeHtml(v)}</code>`).join(' '));
  }
  if (entry.example) html += section('Example', `<code>${escapeHtml(entry.example)}</code>`);
  if (entry.group) html += section('Section', escapeHtml(entry.group));
  if (notice) html += `<div class="cmdp-notice">${escapeHtml(notice)}</div>`;
  const confirm = commandPalette && commandPalette.confirm && commandPalette.confirm.id === entry.id ? commandPalette.confirm : null;
  if (confirm) {
    html += `<div class="cmdp-confirm"><span>${escapeHtml(confirm.question)}</span>` +
      `<button type="button" class="cmdp-btn cmdp-btn--danger" data-act="confirm">${confirm.action === 'run' ? 'Run' : 'Insert'}</button>` +
      '<button type="button" class="cmdp-btn" data-act="cancel">Cancel</button></div>';
  }
  html += '<div class="cmdp-actions">';
  if (insertion) {
    html += `<button type="button" class="cmdp-btn cmdp-btn--primary" data-act="${insertion.mode}">${insertion.mode === 'insert' ? 'Insert' : 'Copy'}</button>`;
  }
  if (catalog.target === 'agent' && insertion && insertion.mode === 'insert') {
    html += `<button type="button" class="cmdp-btn" data-act="run"${run.ok ? '' : ' disabled'} title="${escapeHtml(run.ok ? `Type it and press Enter (${isMac ? '⌘↵' : 'Ctrl+Enter'})` : run.reason)}">Run</button>`;
  }
  if (entry.docUrl) html += '<button type="button" class="cmdp-btn cmdp-btn--link" data-act="docs">Docs</button>';
  html += '</div>';
  if (!insertion) html += '<div class="cmdp-hint">A key to press in the terminal: nothing to insert.</div>';
  return html;
}

function renderCommandPalette({ focusSearch = false } = {}) {
  const p = commandPalette;
  if (!p || !p.catalog) return;
  const M = catalogModel();
  const { catalog } = p;
  const state = commandCatalogState(p.sessionId);
  const entries = commandPaletteEntries();
  if (p.selected >= entries.length) p.selected = Math.max(0, entries.length - 1);
  const version = catalog.version && (catalog.version.session || catalog.version.installed);
  const tabs = M.tabsFor(catalog);
  const searchValue = p.el.querySelector('.cmdp-search') ? p.el.querySelector('.cmdp-search').value : p.query;
  const clis = catalog.target === 'terminal' && commandCatalogClis.length > 1
    ? `<div class="kn-seg cmdp-clis" role="tablist" aria-label="CLI">${commandCatalogClis.map((c) =>
      `<button type="button" class="kn-seg-btn${c === catalog.cli ? ' active' : ''}" data-cli="${escapeHtml(c)}">${escapeHtml(M.cliLabel(c))}</button>`).join('')}</div>`
    : '';
  const footer = [
    `${escapeHtml(M.cliLabel(catalog.cli))}${version ? ` ${escapeHtml(version)}` : ''}`,
    catalog.docs && catalog.docs.generatedAt ? `docs of ${escapeHtml(formatCatalogDate(catalog.docs.refreshedAt || catalog.docs.generatedAt))}` : '',
  ].filter(Boolean).join(' · ');
  p.el.innerHTML =
    '<div class="cmdp-head">' +
      `<input class="cmdp-search" type="search" placeholder="Search ${escapeHtml(M.cliLabel(catalog.cli))} commands" aria-label="Search commands" spellcheck="false">` +
      clis +
    '</div>' +
    (p.query ? '' : `<div class="kn-seg cmdp-tabs" role="tablist">${tabs.map((t) =>
      `<button type="button" role="tab" class="kn-seg-btn${t.id === p.tab ? ' active' : ''}" aria-selected="${t.id === p.tab}" data-tab="${t.id}">${escapeHtml(t.label)}</button>`).join('')}</div>`) +
    '<div class="cmdp-body">' +
      `<div class="cmdp-list" role="listbox" aria-label="Commands">${entries.map((e, i) => commandRowHtml(e, i, i === p.selected, version)).join('') ||
        '<div class="cmdp-empty">Nothing matches.</div>'}</div>` +
      `<div class="cmdp-details">${commandDetailsHtml(entries[p.selected], catalog, state)}</div>` +
    '</div>' +
    `<div class="cmdp-foot"><span>${footer}</span><span>↑↓ choose · ↵ ${catalog.target === 'agent' ? 'insert' : 'insert or copy'} · ${isMac ? '⌘↵' : 'Ctrl+↵'} run · Tab next tab · Esc close</span></div>` +
    (catalog.notes && catalog.notes.length ? `<div class="cmdp-notes">${catalog.notes.map(escapeHtml).join('<br>')}</div>` : '');
  const search = p.el.querySelector('.cmdp-search');
  search.value = searchValue;
  search.addEventListener('input', () => { p.query = search.value; p.selected = 0; p.confirm = null; renderCommandPalette({ focusSearch: true }); });
  search.addEventListener('keydown', commandPaletteKey);
  p.el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    p.tab = b.dataset.tab; p.selected = 0; p.confirm = null; renderCommandPalette({ focusSearch: true });
  }));
  p.el.querySelectorAll('[data-cli]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.cli !== catalog.cli) openCommandPalette({ cli: b.dataset.cli, anchor: p.anchor });
  }));
  p.el.querySelectorAll('.cmdp-row').forEach((row) => {
    row.addEventListener('click', () => {
      const index = Number(row.dataset.index);
      if (index === p.selected) { commandPaletteAct('primary'); return; }
      p.selected = index; p.confirm = null; renderCommandPalette({ focusSearch: true });
    });
  });
  p.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => commandPaletteAct(b.dataset.act)));
  placeCommandPalette();
  const selectedRow = p.el.querySelector('.cmdp-row.selected');
  if (selectedRow && selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: 'nearest' });
  if (focusSearch) {
    search.focus();
    const end = search.value.length;
    search.setSelectionRange(end, end);
  }
}

function commandPaletteKey(event) {
  const p = commandPalette;
  if (!p) return;
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const entries = commandPaletteEntries();
  if (event.key === 'Escape') {
    event.preventDefault();
    if (p.confirm) { p.confirm = null; renderCommandPalette({ focusSearch: true }); return; }
    const sessionId = p.sessionId;
    closeCommandPalette();
    focusCommandTerminal(sessionId);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!entries.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    p.selected = (p.selected + step + entries.length) % entries.length;
    p.confirm = null;
    renderCommandPalette({ focusSearch: true });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    commandPaletteAct(p.confirm ? 'confirm' : mod ? 'run' : 'primary');
  } else if (event.key === 'Tab' && !p.query) {
    event.preventDefault();
    const tabs = catalogModel().tabsFor(p.catalog);
    const at = tabs.findIndex((t) => t.id === p.tab);
    const next = tabs[(at + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
    if (next) { p.tab = next.id; p.selected = 0; p.confirm = null; renderCommandPalette({ focusSearch: true }); }
  }
}

function focusCommandTerminal(sessionId) {
  const entry = openSessions.get(sessionId) || openSessions.get(activeSessionId);
  if (entry && entry.terminal) entry.terminal.focus();
}

/**
 * What a button or key of the palette does to the selected entry: insert,
 * copy, run (each asking first when the rules say so), confirm or cancel
 * that question, open the docs.
 */
async function commandPaletteAct(action) {
  const p = commandPalette;
  if (!p || !p.catalog) return;
  const M = catalogModel();
  const entry = commandPaletteEntries()[p.selected];
  if (!entry) return;
  const state = commandCatalogState(p.sessionId);
  const insertion = M.insertionFor(entry, { target: p.catalog.target });
  if (action === 'cancel') { p.confirm = null; renderCommandPalette({ focusSearch: true }); return; }
  if (action === 'docs') { if (entry.docUrl) window.api.openExternal(entry.docUrl); return; }
  if (action === 'primary') action = insertion ? insertion.mode : null;
  if (!action) return;
  if (action === 'confirm') {
    if (!p.confirm || p.confirm.id !== entry.id) return;
    action = p.confirm.action;
    p.confirm = { ...p.confirm, done: true };
  }
  const confirmed = p.confirm && p.confirm.done && p.confirm.id === entry.id;
  if (action === 'copy') {
    if (!insertion) return;
    await window.api.writeClipboard(insertion.text.trimEnd());
    const btn = p.el.querySelector('[data-act="copy"]');
    if (btn && typeof flashButtonText === 'function') flashButtonText(btn, 'Copied');
    return;
  }
  if (!insertion || insertion.mode !== 'insert') return;
  if (action === 'run') {
    const run = M.canRun(entry, { target: p.catalog.target, state });
    if (!run.ok) return;
    const question = M.needsConfirm(entry);
    if (question && !confirmed) { p.confirm = { id: entry.id, action: 'run', question }; renderCommandPalette({ focusSearch: true }); return; }
  } else if (action === 'insert' && state === 'attention' && !confirmed) {
    p.confirm = { id: entry.id, action: 'insert', question: M.stateNotice(entry, state) };
    renderCommandPalette({ focusSearch: true });
    return;
  }
  // The session's id now: a fork or a resume may have changed it since the palette opened.
  const target = commandCatalogTarget();
  const sessionId = target ? target.sessionId : p.sessionId;
  closeCommandPalette();
  sendCatalogCommand(sessionId, insertion.text, { run: action === 'run' });
  focusCommandTerminal(sessionId);
}

/** Type a picked command into a session; with `run`, press Enter a moment later. */
function sendCatalogCommand(sessionId, text, { run = false } = {}) {
  window.api.sendInput(sessionId, text);
  if (run) setTimeout(() => window.api.sendInput(sessionId, '\r'), ENTER_AFTER_MS);
}

/** Mod+Shift+K, from anywhere in the window (the terminal passes it on, see terminal-manager.js). */
function isCommandPaletteKey(event) {
  return event.code === 'KeyK' && event.shiftKey && !event.altKey && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

/** Newer docs were read (command-docs-refresh.js): an open palette of that CLI shows them, keeping its place. */
async function commandCatalogUpdated(info) {
  const p = commandPalette;
  if (!p || !p.catalog || (info && info.cli && info.cli !== p.catalog.cli)) return;
  let catalog = null;
  try {
    catalog = await window.api.getCommandCatalog(p.sessionId, p.catalog.target === 'terminal' ? { cli: p.catalog.cli, runtime: 'terminal' } : { runtime: p.catalog.cli });
  } catch {
    return;
  }
  if (commandPalette !== p || !catalog) return;
  const selectedId = (commandPaletteEntries()[p.selected] || {}).id;
  p.catalog = catalog;
  const at = commandPaletteEntries().findIndex((e) => e.id === selectedId);
  p.selected = at >= 0 ? at : 0;
  renderCommandPalette({ focusSearch: document.activeElement === p.el.querySelector('.cmdp-search') });
}

if (window.api && window.api.onCommandCatalogUpdated) window.api.onCommandCatalogUpdated(commandCatalogUpdated);

document.addEventListener('keydown', (event) => {
  if (!isCommandPaletteKey(event) || event._commandPaletteHandled) return;
  event.preventDefault();
  event._commandPaletteHandled = true;
  toggleCommandPalette();
});
