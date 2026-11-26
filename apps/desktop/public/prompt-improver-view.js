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

const PROMPT_IMPROVER_TYPE_AFTER_MS = 60;
let promptImproverBtn = null;
let promptImproverSettings = null;
let promptImproverDialog = null;

function improverModel() {
  return window.PromptImproverModel;
}

/** Does the session have a prompt to improve: a CLI session (not a plain shell), the improver on. */
function sessionCanImprove(session) {
  if (!session || session.type === 'terminal') return false;
  if (!promptImproverSettings || !promptImproverSettings.enabled) return false;
  return improverModel().CLIS.includes(session.runtime || 'claude');
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

if (window.api && window.api.onPromptImproverSettingsChanged) {
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

function closePromptImprover() {
  if (!promptImproverDialog) return;
  const d = promptImproverDialog;
  promptImproverDialog = null;
  if (d.running) window.api.cancelPromptImprovement(d.sessionId).catch(() => {});
  document.removeEventListener('keydown', d.onKey, true);
  d.overlay.remove();
  focusCommandTerminal(d.sessionId);
}

/** The session's id now: a fork or a resume may have changed it since the window opened. */
function improverSessionId(d) {
  return (d.entry && d.entry.session && d.entry.session.sessionId) || d.sessionId;
}

async function openPromptImprover(options = {}) {
  if (promptImproverDialog) return;
  const target = commandCatalogTarget();
  if (!target || !sessionCanImprove(target.session)) return;
  const M = improverModel();
  const cli = target.session.runtime || 'claude';
  const read = readSessionPrompt(target.entry, cli);
  const settings = promptImproverSettings || M.DEFAULT_SETTINGS;
  const engine = M.engineFor(settings, cli);

  const overlay = document.createElement('div');
  overlay.className = 'add-project-overlay gg-dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'add-project-dialog gg-dialog pi-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Improve prompt');
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const d = {
    overlay, dialog, entry: target.entry, sessionId: target.sessionId, cli, engine,
    read, original: read.text, improved: null, running: false, error: null,
    mode: settings.context, anchor: options.anchor || null,
  };
  d.onKey = (e) => {
    if (promptImproverDialog !== d) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      if (d.running) stopPromptImprover(d);
      else closePromptImprover();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      if (d.running) return;
      if (d.improved === null) runPromptImprover(d);
      else applyImprovedPrompt(d, d.canReplace ? 'replace' : 'insert');
    }
  };
  document.addEventListener('keydown', d.onKey, true);
  promptImproverDialog = d;
  renderPromptImprover(d);
}

function improverSourceNote(d) {
  if (d.read.confident) return d.read.text ? 'Read from the terminal. Correct it here if needed.' : 'The terminal\'s prompt is empty: write the prompt here.';
  return `${d.read.reason || 'Could not read the terminal\'s prompt.'} Write or paste the prompt here.`;
}

/** Can the improved prompt take the place of the one in the terminal: why not, or null. */
function replaceBlocker(d) {
  const state = commandCatalogState(improverSessionId(d));
  if (state === 'attention') return 'The CLI is waiting for your answer.';
  if (state === 'busy') return 'The CLI is working: wait for the turn to end, or insert it.';
  if (!d.read.confident) return 'The terminal\'s prompt could not be read for sure: insert or copy it.';
  const now = readSessionPrompt(d.entry, d.cli);
  if (!now.confident || now.text !== d.read.text) return 'The terminal\'s prompt changed since it was read: insert or copy it.';
  return null;
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
      <div class="gg-field">
        <label class="gg-field-label" for="pi-source">Prompt for ${escapeHtml(target)}</label>
        <textarea id="pi-source" class="gg-field-input pi-text" rows="7" spellcheck="true"${d.running ? ' disabled' : ''}>${escapeHtml(d.original)}</textarea>
        <span class="pi-note">${escapeHtml(improverSourceNote(d))}</span>
      </div>
      <div class="pi-row">
        <span class="pi-how">${escapeHtml(label)} rewrites it with your subscription, out of sight. Context:</span>
        ${modeSelect}
      </div>`;
    actions = `
      <button type="button" class="add-project-cancel-btn pi-cancel">${d.running ? 'Stop' : 'Cancel'}</button>
      <button type="button" class="add-project-add-btn gg-dialog-primary pi-improve"${d.running ? ' disabled' : ''}>${d.running ? '<span class="gg-dialog-spinner" aria-hidden="true"></span>Improving…' : 'Improve'}</button>`;
  } else {
    const blocker = replaceBlocker(d);
    d.canReplace = !blocker;
    body = `
      <div class="gg-field">
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
  d.dialog.setAttribute('aria-busy', d.running ? 'true' : 'false');
  d.dialog.innerHTML = `
    <h3>Improve prompt</h3>
    <div class="gg-dialog-body">${body}</div>
    <div class="gg-dialog-error" role="alert"${d.error ? '' : ' hidden'}>${escapeHtml(d.error || '')}</div>
    <div class="add-project-actions pi-actions">${actions}</div>`;

  const q = (sel) => d.dialog.querySelector(sel);
  const source = q('#pi-source');
  if (source) source.addEventListener('input', () => { d.original = source.value; });
  const result = q('#pi-result');
  if (result) result.addEventListener('input', () => { d.improved = result.value; });
  const mode = q('.pi-mode');
  if (mode) mode.addEventListener('change', () => { d.mode = mode.value; });
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
  const sessionId = improverSessionId(d);
  if (how === 'copy') {
    await window.api.writeClipboard(text);
    const btn = d.dialog.querySelector('.pi-copy');
    if (btn) btn.textContent = 'Copied';
    return;
  }
  const keys = window.TuiPromptReader.typeKeys(text);
  if (how === 'replace') {
    const blocker = replaceBlocker(d);
    if (blocker) {
      d.error = blocker;
      renderPromptImprover(d);
      return;
    }
    closePromptImprover();
    if (d.read.text) {
      window.api.sendInput(sessionId, window.TuiPromptReader.clearKeys(d.read.text));
      setTimeout(() => window.api.sendInput(sessionId, keys), PROMPT_IMPROVER_TYPE_AFTER_MS);
    } else {
      window.api.sendInput(sessionId, keys);
    }
    return;
  }
  closePromptImprover();
  window.api.sendInput(sessionId, keys);
}

document.addEventListener('keydown', (event) => {
  if (!isPromptImproverKey(event) || event._promptImproverHandled) return;
  event.preventDefault();
  event._promptImproverHandled = true;
  if (promptImproverDialog) closePromptImprover();
  else openPromptImprover();
});
