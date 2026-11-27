// prompt-improver-windows.js — the Improve prompt window opened in a window
// of its own (its button at the top right of the window in the page).
//
// The window belongs to the session it was opened for, whichever session the
// main window shows afterwards: Insert and Replace always go into that one.
// It starts with the state of the window in the page (the prompt read from
// the terminal, the improved one, the context), handed over once by a token.
//
// The session's terminal, and so the reading of its input box that Replace
// checks, is in the main window: Insert and Replace go there as a request
// (prompt-improver-apply-request) and its answer comes back
// (prompt-improver-applied); main then brings the main window forward.

const crypto = require('crypto');
const { MAX_PROMPT } = require('./public/prompt-improver-model');

const APPLY_TIMEOUT_MS = 10000;
const HOW = new Set(['insert', 'replace']);

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const line = (value, max) => text(value, max * 4).replace(/\s+/g, ' ').trim().slice(0, max);

/** The state a window starts with, keeping only known fields of the right kind and size. */
function cleanState(state) {
  const s = state && typeof state === 'object' ? state : {};
  const read = s.read && typeof s.read === 'object' ? s.read : {};
  return {
    sessionId: line(s.sessionId, 200),
    cli: ['claude', 'codex', 'opencode'].includes(s.cli) ? s.cli : 'claude',
    title: line(s.title, 200),
    folder: line(s.folder, 300),
    read: { text: text(read.text, MAX_PROMPT), confident: read.confident === true, reason: line(read.reason, 300) || null },
    original: text(s.original, MAX_PROMPT),
    improved: typeof s.improved === 'string' ? text(s.improved, MAX_PROMPT * 2) : null,
    mode: s.mode === 'none' ? 'none' : 'recent',
    engine: ['claude', 'codex', 'opencode'].includes(s.engine) ? s.engine : null,
    ms: Number.isFinite(s.ms) ? s.ms : 0,
  };
}

/**
 * deps:
 *   openWindow({ token, title, sessionId }) → a BrowserWindow-like ({ on, isDestroyed })
 *   bringForward(win)                       shows an open window again
 *   mainWindow()                            the main window, or null
 *   randomId()                              ids for tokens and requests
 */
function createPromptImproverWindows(deps) {
  const {
    openWindow, bringForward = () => {}, mainWindow, randomId = () => crypto.randomBytes(12).toString('hex'),
    timeoutMs = APPLY_TIMEOUT_MS,
  } = deps;
  const states = new Map();
  const windows = new Map();
  const pending = new Map();

  /** Opens (or brings forward) the window of a session; `{ ok, existing? }` or `{ ok: false, error }`. */
  function open(state) {
    const s = cleanState(state);
    if (!s.sessionId) return { ok: false, error: 'No session.' };
    const existing = windows.get(s.sessionId);
    if (existing && !existing.isDestroyed()) {
      bringForward(existing);
      return { ok: true, existing: true };
    }
    const token = randomId();
    states.set(token, s);
    const win = openWindow({ token, title: s.title, sessionId: s.sessionId });
    windows.set(s.sessionId, win);
    win.on('closed', () => {
      if (windows.get(s.sessionId) === win) windows.delete(s.sessionId);
      states.delete(token);
    });
    return { ok: true };
  }

  /** The state for a window's token, once. */
  function take(token) {
    if (typeof token !== 'string') return null;
    const s = states.get(token) || null;
    states.delete(token);
    return s;
  }

  /**
   * Insert or Replace from a window: asks the main window, which has the
   * session's terminal, to do it. Resolves its answer, `{ ok, error? }`.
   */
  function apply(request) {
    const r = request && typeof request === 'object' ? request : {};
    const how = HOW.has(r.how) ? r.how : null;
    const sessionId = line(r.sessionId, 200);
    const value = text(r.text, MAX_PROMPT * 2);
    if (!how || !sessionId || !value.trim()) return Promise.resolve({ ok: false, error: 'Nothing to put in the session.' });
    const win = mainWindow();
    if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: 'The main window is not open.' });
    const id = randomId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'The main window did not answer.' });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      win.webContents.send('prompt-improver-apply-request', {
        id, how, sessionId, cli: ['claude', 'codex', 'opencode'].includes(r.cli) ? r.cli : 'claude',
        readText: text(r.readText, MAX_PROMPT), readConfident: r.readConfident === true, text: value,
      });
    });
  }

  /** The main window's answer to a request. */
  function applied(id, result) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimeout(p.timer);
    const ok = !!(result && result.ok);
    p.resolve(ok ? { ok: true } : { ok: false, error: line(result && result.error, 300) || 'Not done.' });
    return true;
  }

  return { open, take, apply, applied, isOpen: (sessionId) => !!windows.get(sessionId) };
}

module.exports = { createPromptImproverWindows, cleanState };
