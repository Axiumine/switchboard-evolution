// The Improve prompt window in a window of its own (prompt-improver.html,
// opened by the window's button at its top right: main's
// prompt-improver-windows.js), for the session it was opened for.
// prompt-improver-view.js does the work; this gives it the state the page
// handed over (once, by the token in the address) and the window as its
// dialog. Insert and Replace are asked of the main window, which has the
// session's terminal; there is no terminal here.

const PROMPT_IMPROVER_WINDOW = (() => {
  try {
    const token = new URLSearchParams(location.search).get('token');
    return token ? { token } : null;
  } catch { return null; }
})();

const isMac = !!(window.api && window.api.platform === 'darwin');
document.body.classList.add('prompt-improver-window');

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('pi-window-root');
  let state = null;
  try {
    const [taken, info] = await Promise.all([
      PROMPT_IMPROVER_WINDOW ? window.api.getPromptImproverWindowState(PROMPT_IMPROVER_WINDOW.token) : null,
      window.api.getPromptImproverSettings().catch(() => null),
    ]);
    state = taken;
    promptImproverSettings = info && info.settings;
  } catch {
    state = null;
  }
  if (!state || !state.sessionId) {
    root.className = 'pi-window-empty';
    root.textContent = 'Nothing to improve here: open Improve prompt again from the session.';
    return;
  }
  document.title = state.title ? `Improve prompt · ${state.title}` : 'Improve prompt';
  openPromptImproverInWindow(state, root);
});

// Closing the window stops a run still going.
window.addEventListener('beforeunload', () => {
  const d = typeof promptImproverDialog !== 'undefined' ? promptImproverDialog : null;
  if (d && d.running) window.api.cancelPromptImprovement(d.sessionId).catch(() => {});
});
