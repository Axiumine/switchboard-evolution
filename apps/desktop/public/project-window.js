// A tab of a project in a window of its own (main.js openProjectWindow):
// index.html?projectWindow=<project id>&tab=<tab>. The same page as the main
// window, without the sidebar and the terminals (style.css body.project-window).
// It shows one project on one tab (projects-view.js showProjectWindow). A
// session it opens, or starts, goes to the main window, which has the
// terminals. Loaded before the other scripts, so they can read PROJECT_WINDOW.

const PROJECT_WINDOW = (() => {
  try {
    const query = new URLSearchParams(location.search);
    const projectId = query.get('projectWindow');
    return projectId ? { projectId, tab: query.get('tab') || 'overview' } : null;
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
