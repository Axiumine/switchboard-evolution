// A tab of a project in a window of its own (main.js openProjectWindow):
// index.html?projectWindow=<project id>&tab=<tab>. The same page as the main
// window, without the sidebar and the terminals (style.css body.project-window).
// It shows one project on one tab (projects-view.js showProjectWindow). A
// session it opens, or starts, goes to the main window, which has the
// terminals. Loaded before the other scripts, so they can read PROJECT_WINDOW.

// With `compare` ({ repo, hashes, labels, subjects }), the window shows only the
// comparison of those commits (main.js openGitCompareWindow). With `file`
// ({ repo, path, kind, fromRev, toRev, … }), only that file of the Git History
// (main.js openGitFileWindow).
const PROJECT_WINDOW = (() => {
  try {
    const query = new URLSearchParams(location.search);
    const projectId = query.get('projectWindow');
    if (!projectId) return null;
    let compare = null;
    try {
      const parsed = JSON.parse(query.get('compare') || 'null');
      if (parsed && typeof parsed.repo === 'string' && Array.isArray(parsed.hashes)) compare = parsed;
    } catch { compare = null; }
    let file = null;
    try {
      const parsed = JSON.parse(query.get('file') || 'null');
      if (parsed && typeof parsed.repo === 'string' && typeof parsed.path === 'string' && parsed.path) file = parsed;
    } catch { file = null; }
    return { projectId, tab: query.get('tab') || 'overview', compare, file };
  } catch { return null; }
})();

// What the main window does for this one (main.js PROJECT_WINDOW_RUN).
const PROJECT_WINDOW_RUN = ['openSession', 'showSession', 'launchNewSession', 'openRawTerminalSession'];

if (PROJECT_WINDOW) {
  document.body.classList.add('project-window');
  // Every script has run by now: their functions are replaced where they are
  // looked up, so every caller reaches the main window.
  document.addEventListener('DOMContentLoaded', () => {
    for (const name of PROJECT_WINDOW_RUN) {
      window[name] = (...args) => window.api.runInMainWindow(name, args);
    }
  }, { once: true });
}
