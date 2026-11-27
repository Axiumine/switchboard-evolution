// The prompt improver in the terminal page: a button next to Commands (and
// in each card of the grid view), Mod+Shift+P too.
//
// The prompt being written stays in the CLI's own input box, so the button
// reads it from the terminal (tui-prompt-reader.js) into a window where it can
// be corrected: that window is the question before anything runs. Improve
// asks the main process (prompt-improver.js) to have the CLI rewrite it, out
// of sight, with the user's own sign-in; the improved prompt comes back in the
// same window, editable, with:
//   - Replace in terminal: clears the CLI's box and types the new prompt in
//     its place, never Enter. Only when the session is idle, the box was read
//     for sure, and it still holds what was read;
//   - Insert: types it where the cursor is; Copy; Try again.
// The prompt is never sent: the user does that in the terminal.
//
// The window belongs to the session it was opened for, and says so: Insert
// and Replace go into that session whichever one is in front. At its top
// right, Expand makes it nearly as large as the app's window, and the button
// at the far right opens it in a window of its own (prompt-improver.html,
// prompt-improver-window.js, main's prompt-improver-windows.js), which keeps
// what it holds. From there Insert and Replace are asked of the main window
// (applyToSession, which has the session's terminal), which then shows that
// session.

const PROMPT_IMPROVER_TYPE_AFTER_MS = 60;
const PROMPT_IMPROVER_MAX_KEY = 'promptImprover.expanded';
let promptImproverBtn = null;
let promptImproverSettings = null;
let promptImproverDialog = null;

const PI_ICONS = {
  expand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
  shrink: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>',
};

function improverModel() {
  return window.PromptImproverModel;
}

/** In a window of its own (prompt-improver.html): its state, else null. */
function improverWindowMode() {
  return typeof PROMPT_IMPROVER_WINDOW !== 'undefined' && PROMPT_IMPROVER_WINDOW ? PROMPT_IMPROVER_WINDOW : null;
}

function improverExpanded() {
  try { return localStorage.getItem(PROMPT_IMPROVER_MAX_KEY) === '1'; } catch { return false; }
}

function setImproverExpanded(on) {
  try {
    if (on) localStorage.setItem(PROMPT_IMPROVER_MAX_KEY, '1');
    else localStorage.removeItem(PROMPT_IMPROVER_MAX_KEY);
  } catch {}
}

/** Does the session have a prompt to improve: a CLI session (not a plain shell), the improver on. */
function sessionCanImprove(session) {
  if (!session || session.type === 'terminal') return false;
  if (!promptImproverSettings || !promptImproverSettings.enabled) return false;
  return improverModel().CLIS.includes(session.runtime || 'claude');
}

/** How a session is named in the window: its title, and its CLI and folder. */
function improverSessionLabel(session) {
  const raw = (session && (session.name || session.aiTitle || session.summary)) || 'New session';
  const title = typeof cleanDisplayName === 'function' ? cleanDisplayName(raw) || raw : raw;
  const folder = String((session && session.projectPath) || '').split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
  return { title, folder };
}

async function initPromptImprover() {
  const controls = document.getElementById('terminal-header-controls');
  if (!controls || promptImproverBtn) return;
  promptImproverBtn = document.createElement('button');
  promptImproverBtn.id = 'prompt-improver-btn';
  promptImproverBtn.type = 'button';
  promptImproverBtn.title = `Improve prompt (${isMac ? '⌘⇧P' : 'Ctrl+Shift+P'})`;
  promptImproverBtn.setAttribute('aria-label', 'Improve prompt');
  promptImproverBtn.setAttribute('aria-haspopup', 'dialog');
  promptImproverBtn.innerHTML = ICONS.sparkle(16);
  promptImproverBtn.style.display = 'none';
  promptImproverBtn.addEventListener('click', () => openPromptImprover());
  const commands = document.getElementById('command-catalog-btn');
  const before = (commands && commands.nextSibling) || document.getElementById('project-files-btn') || document.getElementById('terminal-stop-btn');
  controls.insertBefore(promptImproverBtn, before || null);
  try {
    const info = await window.api.getPromptImproverSettings();
    promptImproverSettings = info && info.settings;
  } catch {
    promptImproverSettings = null;
  }
  updatePromptImproverButton();
}

function updatePromptImproverButton() {
  if (promptImproverBtn) {
    const target = commandCatalogTarget();
    promptImproverBtn.style.display = target && sessionCanImprove(target.session) ? '' : 'none';
  }
  // The grid view's cards have one each (grid-view.js).
  for (const btn of document.querySelectorAll('.grid-card-improve-btn')) {
    const session = sessionMap.get(btn.dataset.sessionId) || (openSessions.get(btn.dataset.sessionId) || {}).session;
    btn.style.display = sessionCanImprove(session) ? '' : 'none';
  }
}

if (window.api && window.api.onPromptImproverSettingsChanged && !improverWindowMode()) {
  window.api.onPromptImproverSettingsChanged((settings) => {
    promptImproverSettings = settings;
    updatePromptImproverButton();
  });
}

/** What the CLI's box holds now: `{ text, confident, reason }`. */
function readSessionPrompt(entry, cli) {
  if (!entry || !entry.terminal) return { text: '', confident: false, reason: 'The terminal is not open.' };
  const rows = window.TuiPromptReader.rowsFromXterm(entry.terminal, 60);
  return window.TuiPromptReader.readTuiPrompt(rows, cli, { cols: entry.terminal.cols });
}

/** Mod+Shift+P, from anywhere in the window (the terminal passes it on, see terminal-manager.js). */
function isPromptImproverKey(event) {
  return event.code === 'KeyP' && event.shiftKey && !event.altKey && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

function closePromptImprover({ focus = true } = {}) {
  if (!promptImproverDialog) return;
  const d = promptImproverDialog;
  promptImproverDialog = null;
  if (d.running) window.api.cancelPromptImprovement(d.sessionId).catch(() => {});
  document.removeEventListener('keydown', d.onKey, true);
  if (d.windowMode) {
    window.close();
    return;
  }
  d.overlay.remove();
  if (focus) focusCommandTerminal(d.sessionId);
}

/** The session's id now: a fork or a resume may have changed it since the window opened. */
function improverSessionId(d) {
  return (d.entry && d.entry.session && d.entry.session.sessionId) || d.sessionId;
}

/**
 * Puts `text` into the session's terminal (the main window does this for a
 * window of its own too): `insert` types it where the cursor is, `replace`
 * clears the box first, only while the session is idle and its box still
 * holds `readText`. Then the session is shown. `{ ok, error? }`.
 */
function applyToSession({ sessionId, cli, how, readText, readConfident, text }) {
  const entry = openSessions.get(sessionId);
  if (!entry || entry.closed || (typeof activePtyIds !== 'undefined' && !activePtyIds.has(sessionId))) {
    return { ok: false, error: 'The session\'s terminal is not open in the main window.' };
  }
  const keys = window.TuiPromptReader.typeKeys(String(text || '').trim());
  if (!keys) return { ok: false, error: 'There is nothing to put in the session.' };
  if (how === 'replace') {
    const state = commandCatalogState(sessionId);
    if (state === 'attention') return { ok: false, error: 'The CLI is waiting for your answer.' };
    if (state === 'busy') return { ok: false, error: 'The CLI is working: wait for the turn to end, or insert it.' };
    if (!readConfident) return { ok: false, error: 'The terminal\'s prompt could not be read for sure: insert or copy it.' };
    const now = readSessionPrompt(entry, cli);
    if (!now.confident || now.text !== readText) return { ok: false, error: 'The terminal\'s prompt changed since it was read: insert or copy it.' };
    if (readText) {
      window.api.sendInput(sessionId, window.TuiPromptReader.clearKeys(readText));
      setTimeout(() => window.api.sendInput(sessionId, keys), PROMPT_IMPROVER_TYPE_AFTER_MS);
    } else {
      window.api.sendInput(sessionId, keys);
    }
  } else {
    window.api.sendInput(sessionId, keys);
  }
  if (typeof activeSessionId !== 'undefined' && activeSessionId !== sessionId && typeof showSession === 'function') showSession(sessionId);
  focusCommandTerminal(sessionId);
  return { ok: true };
}

// A window of its own asks the main window to put its prompt in the session.
if (window.api && window.api.onPromptImproverApplyRequest && !improverWindowMode()) {
  window.api.onPromptImproverApplyRequest((request) => {
    let result;
    try { result = applyToSession(request || {}); } catch (err) { result = { ok: false, error: err && err.message ? err.message : String(err) }; }
    window.api.promptImproverApplied(request && request.id, result);
  });
}

function newImproverDialog(state, { windowMode = false, entry = null } = {}) {
  const M = improverModel();
  const settings = promptImproverSettings || M.DEFAULT_SETTINGS;
  const d = {
    windowMode, entry, sessionId: state.sessionId, cli: state.cli, title: state.title, folder: state.folder,
    engine: state.engine || M.engineFor(settings, state.cli),
    read: state.read, original: state.original, improved: state.improved == null ? null : state.improved,
    ms: state.ms || 0, mode: state.mode || settings.context, running: false, error: null,
    expanded: !windowMode && improverExpanded(),
  };
  d.onKey = (e) => {
    if (promptImproverDialog !== d) return;
    if (e.key === 'Escape') {
      if (d.running) { e.stopPropagation(); e.preventDefault(); stopPromptImprover(d); return; }
      // A window of its own stays: closing it is the window's own button.
      if (d.windowMode) return;
      e.stopPropagation();
      e.preventDefault();
      closePromptImprover();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      if (d.running) return;
      if (d.improved === null) runPromptImprover(d);
      else applyImprovedPrompt(d, d.canReplace === false ? 'insert' : 'replace');
    }
  };
  return d;
}

async function openPromptImprover(options = {}) {
  if (promptImproverDialog || improverWindowMode()) return;
  const target = commandCatalogTarget();
  if (!target || !sessionCanImprove(target.session)) return;
  const cli = target.session.runtime || 'claude';
  const read = readSessionPrompt(target.entry, cli);
  const { title, folder } = improverSessionLabel(target.session);
  const d = newImproverDialog({ sessionId: target.sessionId, cli, title, folder, read, original: read.text }, { entry: target.entry });
  d.anchor = options.anchor || null;
  d.overlay = document.createElement('div');
  d.overlay.className = 'add-project-overlay gg-dialog-overlay';
  d.dialog = document.createElement('div');
  d.overlay.appendChild(d.dialog);
  document.body.appendChild(d.overlay);
  document.addEventListener('keydown', d.onKey, true);
  promptImproverDialog = d;
  renderPromptImprover(d);
}

/** In a window of its own: the window is the dialog, with the state the page handed over. */
function openPromptImproverInWindow(state, container) {
  const d = newImproverDialog(state, { windowMode: true });
  d.dialog = container;
  document.addEventListener('keydown', d.onKey, true);
  promptImproverDialog = d;
  renderPromptImprover(d);
}

function improverSourceNote(d) {
  if (d.read.confident) return d.read.text ? 'Read from the terminal. Correct it here if needed.' : 'The terminal\'s prompt was empty: write the prompt here.';
  return `${d.read.reason || 'Could not read the terminal\'s prompt.'} Write or paste the prompt here.`;
}

/** Which session the prompt goes into, said plainly (the window is tied to it). */
function improverTargetHtml(d) {
  const M = improverModel();
  const where = `<strong>${escapeHtml(d.title || 'New session')}</strong> <span class="pi-target-meta">${escapeHtml(M.cliLabel(d.cli))}${d.folder ? ` · ${escapeHtml(d.folder)}` : ''}</span>`;
  const rest = d.windowMode
    ? 'the session this window was opened for, even if another session is in front in the main window. You do not need to go back to it: Insert and Replace type there, and the main window then shows it.'
    : 'the session this window was opened for. If you open it in a window of its own and change session, it still goes here.';
  return `<div class="pi-target" role="note">${ICONS.sparkle(12)}<span>Goes into ${where}: ${rest}</span></div>`;
}

/** Can the improved prompt take the place of the one in the terminal: why not, or null. */
function replaceBlocker(d) {
  if (d.windowMode) return d.read.confident ? null : 'The terminal\'s prompt could not be read for sure: insert or copy it.';
  const state = commandCatalogState(improverSessionId(d));
  if (state === 'attention') return 'The CLI is waiting for your answer.';
  if (state === 'busy') return 'The CLI is working: wait for the turn to end, or insert it.';
  if (!d.read.confident) return 'The terminal\'s prompt could not be read for sure: insert or copy it.';
  const now = readSessionPrompt(d.entry, d.cli);
  if (!now.confident || now.text !== d.read.text) return 'The terminal\'s prompt changed since it was read: insert or copy it.';
  return null;
}

function improverToolsHtml(d) {
  if (d.windowMode) return '';
  const expand = d.expanded
    ? `<button type="button" class="cmdp-tool on pi-expand" title="Back to its size" aria-label="Back to its size" aria-pressed="true">${PI_ICONS.shrink}</button>`
    : `<button type="button" class="cmdp-tool pi-expand" title="Expand" aria-label="Expand" aria-pressed="false">${PI_ICONS.expand}</button>`;
  const popOut = `<button type="button" class="cmdp-tool pi-window" title="Open in a window of its own" aria-label="Open in a window of its own"${d.running ? ' disabled' : ''}>${ICONS.popOut(14)}</button>`;
  return `<div class="pi-tools">${expand}${popOut}</div>`;
}

function renderPromptImprover(d) {
  const M = improverModel();
  const label = M.cliLabel(d.engine);
  const target = M.cliLabel(d.cli);
  const modeSelect = `<select class="gg-field-input pi-mode" aria-label="Context"${d.running ? ' disabled' : ''}>
      <option value="recent"${d.mode === 'recent' ? ' selected' : ''}>Prompt and the last turns</option>
      <option value="none"${d.mode === 'none' ? ' selected' : ''}>Prompt only</option>
    </select>`;
  let body;
  let actions;
  if (d.improved === null) {
    body = `
      ${improverTargetHtml(d)}
      <div class="gg-field pi-grow">
        <label class="gg-field-label" for="pi-source">Prompt for ${escapeHtml(target)}</label>
        <textarea id="pi-source" class="gg-field-input pi-text" rows="7" spellcheck="true"${d.running ? ' disabled' : ''}>${escapeHtml(d.original)}</textarea>
        <span class="pi-note">${escapeHtml(improverSourceNote(d))}</span>
      </div>
      <div class="pi-row">
        <span class="pi-how">${escapeHtml(label)} rewrites it with your subscription, out of sight. Context:</span>
        ${modeSelect}
      </div>`;
    actions = `
      <button type="button" class="add-project-cancel-btn pi-cancel">${d.running ? 'Stop' : d.windowMode ? 'Close' : 'Cancel'}</button>
      <button type="button" class="add-project-add-btn gg-dialog-primary pi-improve"${d.running ? ' disabled' : ''}>${d.running ? '<span class="gg-dialog-spinner" aria-hidden="true"></span>Improving…' : 'Improve'}</button>`;
  } else {
    const blocker = replaceBlocker(d);
    d.canReplace = !blocker;
    body = `
      ${improverTargetHtml(d)}
      <div class="gg-field pi-grow">
        <label class="gg-field-label" for="pi-result">Improved prompt <span class="pi-meta">${escapeHtml(label)} · ${(d.ms / 1000).toFixed(1)} s</span></label>
        <textarea id="pi-result" class="gg-field-input pi-text" rows="12" spellcheck="true">${escapeHtml(d.improved)}</textarea>
      </div>
      <details class="pi-original"><summary>Original prompt</summary><pre>${escapeHtml(d.original)}</pre></details>
      ${blocker ? `<span class="pi-note">${escapeHtml(blocker)}</span>` : '<span class="pi-note">Nothing is sent: check it in the terminal, then press Enter there.</span>'}`;
    actions = `
      <button type="button" class="add-project-cancel-btn pi-cancel">Close</button>
      <button type="button" class="add-project-cancel-btn pi-again">Try again</button>
      <button type="button" class="add-project-cancel-btn pi-copy">Copy</button>
      <button type="button" class="${blocker ? 'add-project-add-btn gg-dialog-primary' : 'add-project-cancel-btn'} pi-insert">Insert</button>
      <button type="button" class="add-project-add-btn gg-dialog-primary pi-replace"${blocker ? ' disabled' : ''}>Replace in terminal</button>`;
  }
  d.dialog.className = `add-project-dialog gg-dialog pi-dialog${d.expanded ? ' pi-expanded' : ''}${d.windowMode ? ' pi-in-window' : ''}`;
  d.dialog.setAttribute('role', 'dialog');
  d.dialog.setAttribute('aria-modal', d.windowMode ? 'false' : 'true');
  d.dialog.setAttribute('aria-label', 'Improve prompt');
  d.dialog.setAttribute('aria-busy', d.running ? 'true' : 'false');
  d.dialog.innerHTML = `
    <div class="pi-head"><h3>Improve prompt</h3>${improverToolsHtml(d)}</div>
    <div class="gg-dialog-body pi-body">${body}</div>
    <div class="gg-dialog-error" role="alert"${d.error ? '' : ' hidden'}>${escapeHtml(d.error || '')}</div>
    <div class="add-project-actions pi-actions">${actions}</div>`;

  const q = (sel) => d.dialog.querySelector(sel);
  const source = q('#pi-source');
  if (source) source.addEventListener('input', () => { d.original = source.value; });
  const result = q('#pi-result');
  if (result) result.addEventListener('input', () => { d.improved = result.value; });
  const mode = q('.pi-mode');
  if (mode) mode.addEventListener('change', () => { d.mode = mode.value; });
  const expand = q('.pi-expand');
  if (expand) expand.onclick = () => { d.expanded = !d.expanded; setImproverExpanded(d.expanded); renderPromptImprover(d); };
  const popOut = q('.pi-window');
  if (popOut) popOut.onclick = () => openImproverWindow(d);
  q('.pi-cancel').onclick = () => (d.running ? stopPromptImprover(d) : closePromptImprover());
  if (q('.pi-improve')) q('.pi-improve').onclick = () => runPromptImprover(d);
  if (q('.pi-again')) q('.pi-again').onclick = () => { d.improved = null; d.error = null; renderPromptImprover(d); runPromptImprover(d); };
  if (q('.pi-copy')) q('.pi-copy').onclick = () => applyImprovedPrompt(d, 'copy');
  if (q('.pi-insert')) q('.pi-insert').onclick = () => applyImprovedPrompt(d, 'insert');
  if (q('.pi-replace')) q('.pi-replace').onclick = () => applyImprovedPrompt(d, 'replace');
  const focus = result || source;
  if (focus && !d.running) {
    focus.focus();
    if (focus === source) focus.setSelectionRange(focus.value.length, focus.value.length);
  }
}

/** Hands the window over to a window of its own, with what it holds now. */
async function openImproverWindow(d) {
  if (d.running) return;
  const state = {
    sessionId: improverSessionId(d), cli: d.cli, title: d.title, folder: d.folder, read: d.read,
    original: d.original, improved: d.improved, mode: d.mode, engine: d.engine, ms: d.ms,
  };
  let res;
  try { res = await window.api.openPromptImproverWindow(state); } catch (err) { res = { ok: false, error: err && err.message }; }
  if (!res || !res.ok) {
    d.error = (res && res.error) || 'The window could not open.';
    renderPromptImprover(d);
    return;
  }
  closePromptImprover({ focus: false });
}

async function runPromptImprover(d) {
  if (d.running || promptImproverDialog !== d) return;
  const check = improverModel().checkPrompt(d.original);
  if (!check.ok) {
    d.error = check.error;
    renderPromptImprover(d);
    return;
  }
  d.running = true;
  d.error = null;
  renderPromptImprover(d);
  let res;
  try {
    res = await window.api.improvePrompt(improverSessionId(d), d.original, { mode: d.mode, runtime: d.cli });
  } catch (err) {
    res = { ok: false, error: err && err.message ? err.message : String(err) };
  }
  if (promptImproverDialog !== d) return;
  d.running = false;
  if (res && res.ok) {
    d.improved = res.text;
    d.engine = res.engine || d.engine;
    d.ms = res.ms || 0;
  } else if (!(res && res.cancelled)) {
    d.error = (res && res.error) || 'The prompt could not be improved.';
  }
  renderPromptImprover(d);
}

function stopPromptImprover(d) {
  window.api.cancelPromptImprovement(improverSessionId(d)).catch(() => {});
}

/** Puts the improved prompt to use: copy, insert at the cursor, or replace the terminal's prompt. */
async function applyImprovedPrompt(d, how) {
  const text = String(d.improved || '').trim();
  if (!text) return;
  if (how === 'copy') {
    await window.api.writeClipboard(text);
    const btn = d.dialog.querySelector('.pi-copy');
    if (btn) btn.textContent = 'Copied';
    return;
  }
  const request = { sessionId: improverSessionId(d), cli: d.cli, how, readText: d.read.text, readConfident: !!d.read.confident, text };
  let res;
  if (d.windowMode) {
    try { res = await window.api.applyPromptImprovement(request); } catch (err) { res = { ok: false, error: err && err.message }; }
  } else {
    res = applyToSession(request);
  }
  if (promptImproverDialog !== d) return;
  if (!res || !res.ok) {
    d.error = (res && res.error) || 'Not done.';
    renderPromptImprover(d);
    return;
  }
  closePromptImprover({ focus: false });
}

document.addEventListener('keydown', (event) => {
  if (improverWindowMode() || !isPromptImproverKey(event) || event._promptImproverHandled) return;
  event.preventDefault();
  event._promptImproverHandled = true;
  if (promptImproverDialog) closePromptImprover();
  else openPromptImprover();
});
