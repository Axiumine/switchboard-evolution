// pull-request-markdown.js — GitHub's text in the Pull Requests view.
//
// A message is shown as the HTML GitHub itself renders for it (bodyHTML), so
// mentions, #references, emoji and task lists look as they do on GitHub. That
// HTML passes through DOMPurify (node_modules/dompurify, loaded by index.html)
// before it reaches the page: only http(s) and mailto links, no scripts, no
// frames, no forms, no inline styles. Links open in the browser.
//
// Every message is written in the same editor: Write and Preview (GitHub's own
// rendering of the text, through gh), the text kept as a draft in the view's
// state so a repaint puts it back, Cmd/Ctrl+Enter for the main button and
// Escape for Cancel.

// DOMPurify checks every attribute that is not known to be safe against this,
// not links only (an input's type="checkbox" too): DOMPurify's own pattern,
// with http(s) and mailto as the only schemes. A value with no scheme passes;
// javascript:, data:, file: and every other scheme do not.
const PR_SAFE_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
let prPurifyHooked = false;

function prPurify() {
  const purify = typeof window !== 'undefined' ? window.DOMPurify : null;
  if (!purify || typeof purify.sanitize !== 'function') return null;
  if (!prPurifyHooked && typeof purify.addHook === 'function') {
    prPurifyHooked = true;
    purify.addHook('afterSanitizeAttributes', (node) => {
      const tag = node.tagName;
      if (tag === 'A') {
        node.removeAttribute('target');
        node.setAttribute('rel', 'noopener noreferrer');
      } else if (tag === 'INPUT') {
        // A task list's boxes: shown, not ticked from here.
        node.setAttribute('disabled', '');
      } else if (tag === 'IMG') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }
    });
  }
  return purify;
}

/** The options DOMPurify gets: exported so the tests can see what is let through. */
const PR_PURIFY_OPTIONS = {
  ALLOWED_URI_REGEXP: PR_SAFE_URI,
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'srcdoc', 'formaction'],
};

/**
 * GitHub's HTML for a message, safe to put in the page. Without DOMPurify
 * nothing of the HTML is used: the Markdown shows as plain text.
 */
function prSafeHtml(html, fallbackText = '') {
  const purify = prPurify();
  if (!purify) return `<p class="pr-md-plain">${escapeHtml(String(fallbackText || ''))}</p>`;
  return purify.sanitize(String(html || ''), PR_PURIFY_OPTIONS);
}

/** Links inside GitHub's text open in the browser, never in the app's window. */
function prWireLinks(container) {
  if (!container || container._prLinks) return;
  container._prLinks = true;
  container.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[href]');
    if (!link || !container.contains(link)) return;
    e.preventDefault();
    const href = link.href || link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) window.api?.openExternal?.(href);
  });
}

// --- The editor ---

/**
 * One editor: `key` names it (its draft and its place on the page), `buttons`
 * are its actions ({ act, label, primary, danger }), the last primary one
 * taking Cmd/Ctrl+Enter. With `cancel`, a Cancel button and Escape close it.
 */
function prEditorHtml({ key, text = '', placeholder = 'Leave a comment', buttons = [], cancel = false, hint = '' } = {}) {
  const actions = buttons.map(b => `<button type="button" class="ws-btn ws-btn--sm${b.primary ? ' ws-btn--primary' : ''}${b.danger ? ' pr-editor-danger' : ''}" data-editor-act="${prAttr(b.act)}"${b.primary ? ' data-primary="1"' : ''}>${escapeHtml(b.label)}</button>`).join('');
  return `
    <div class="pr-editor" data-editor="${prAttr(key)}">
      <div class="pr-editor-tabs" role="tablist">
        <button type="button" class="pr-editor-tab on" data-mode="write" role="tab" aria-selected="true">Write</button>
        <button type="button" class="pr-editor-tab" data-mode="preview" role="tab" aria-selected="false">Preview</button>
      </div>
      <textarea class="pr-editor-input" rows="4" placeholder="${prAttr(placeholder)}" aria-label="${prAttr(placeholder)}">${escapeHtml(text)}</textarea>
      <div class="pr-editor-preview pr-md" hidden></div>
      <div class="pr-editor-error" role="alert" hidden></div>
      <div class="pr-editor-actions">
        <span class="pr-editor-hint">${escapeHtml(hint || 'Markdown is supported. ⌘↵ to send.')}</span>
        ${cancel ? '<button type="button" class="ws-ghost ws-ghost--sm" data-editor-act="cancel">Cancel</button>' : ''}
        ${actions}
      </div>
    </div>`;
}

/**
 * Bring an editor to life. `drafts` (a Map) keeps its text under its key;
 * `preview(text)` resolves to { ok, html } or { error }; `onAction(act, text,
 * ui)` runs a button (ui.setError, ui.done); `onCancel()` closes it. A button
 * spins and every control is off while its action runs; an error stays shown.
 */
function prWireEditor(editor, { drafts, preview, onAction, onCancel, focus = false } = {}) {
  if (!editor) return null;
  const key = editor.dataset.editor;
  const input = editor.querySelector('.pr-editor-input');
  const previewEl = editor.querySelector('.pr-editor-preview');
  const errorEl = editor.querySelector('.pr-editor-error');
  let busy = false;
  const setError = (text) => {
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  };
  const controls = () => [...editor.querySelectorAll('button, textarea')];
  const setBusy = (on, button) => {
    busy = on;
    editor.classList.toggle('is-busy', on);
    for (const el of controls()) el.disabled = on;
    if (button) {
      if (on) { button.dataset.label = button.textContent; button.innerHTML = `<span class="gg-dialog-spinner" aria-hidden="true"></span>${escapeHtml(button.dataset.label)}`; }
      else if (button.dataset.label) button.textContent = button.dataset.label;
    }
  };
  input.addEventListener('input', () => {
    if (drafts) drafts.set(key, input.value);
    setError('');
  });
  const showMode = async (mode) => {
    editor.querySelectorAll('.pr-editor-tab').forEach((tab) => {
      const on = tab.dataset.mode === mode;
      tab.classList.toggle('on', on);
      tab.setAttribute('aria-selected', String(on));
    });
    const write = mode === 'write';
    input.hidden = !write;
    previewEl.hidden = write;
    if (write) { input.focus(); return; }
    if (!input.value.trim()) { previewEl.innerHTML = '<p class="pr-muted">Nothing to preview.</p>'; return; }
    previewEl.innerHTML = '<p class="pr-muted"><span class="git-loading-dot"></span>Rendering…</p>';
    const result = preview ? await preview(input.value) : { error: 'No preview here.' };
    if (previewEl.hidden) return;
    previewEl.innerHTML = result?.ok ? (prSafeHtml(result.html, input.value) || '<p class="pr-muted">Nothing to preview.</p>') : `<p class="pr-editor-error-inline">${escapeHtml(result?.error || 'The preview could not be made.')}</p>`;
    prWireLinks(previewEl);
  };
  editor.querySelectorAll('.pr-editor-tab').forEach((tab) => { tab.onclick = () => showMode(tab.dataset.mode); });
  const run = async (button) => {
    if (busy) return;
    const act = button.dataset.editorAct;
    if (act === 'cancel') { onCancel?.(); return; }
    setError('');
    setBusy(true, button);
    let failed = false;
    try {
      await onAction?.(act, input.value, { setError: (text) => { failed = true; setError(text); } });
    } catch (err) {
      failed = true;
      setError(err?.message || String(err));
    } finally {
      if (editor.isConnected) setBusy(false, button);
    }
    if (failed && editor.isConnected) input.focus();
  };
  editor.querySelectorAll('[data-editor-act]').forEach((button) => { button.onclick = () => run(button); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      const primaries = editor.querySelectorAll('[data-primary="1"]');
      const primary = primaries[primaries.length - 1];
      if (primary && !primary.disabled) run(primary);
    } else if (e.key === 'Escape' && editor.querySelector('[data-editor-act="cancel"]')) {
      e.preventDefault();
      e.stopPropagation();
      onCancel?.();
    }
  });
  if (focus) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  return { input, setError };
}

/** The text of a quote reply: every line of the message behind "> ", then an empty line. */
function prQuoteText(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').trimEnd().split('\n');
  return `${lines.map(line => (line ? `> ${line}` : '>')).join('\n')}\n\n`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PR_SAFE_URI, PR_PURIFY_OPTIONS, prSafeHtml, prEditorHtml, prQuoteText };
}
