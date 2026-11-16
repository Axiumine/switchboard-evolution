// The Task Manager in a window of its own (task-manager.html, opened from the
// button in its tab's tooltip). process-viewer.js does the work; this gives it
// what the main window's globals give it there: the sessions' names, and the
// main window to open a session or a task's output in. The pin is
// tool-window.js.

(function () {
  const sessions = new Map();

  /** Names change rarely: the list is read now and then, not on every refresh. */
  async function loadSessions() {
    try {
      const folders = await window.api.getProjects(false);
      sessions.clear();
      for (const folder of folders || []) {
        for (const session of folder.sessions || []) sessions.set(session.sessionId, session);
      }
    } catch {}
  }
  loadSessions();
  setInterval(loadSessions, 20000);

  window.taskManagerHost = {
    standalone: true,
    sessionFor: (id) => sessions.get(id) || null,
    // The main window comes to the front with the session or the task's output.
    openOwner: (owner) => window.api.openInMainWindow(owner),
    stopRequested: () => {},
    stopped: () => {},
    forceStopped: () => {},
  };
})();
