// Stats in a window of its own (stats.html, opened from the button in the
// Stats tab's tooltip): what app.js gives stats-view.js in the main window,
// the body it draws into, then a first load and the refresh button.

// Read by stats-view.js, as app.js's is in the main window.
const statsViewerBody = document.getElementById('stats-viewer-body');

(function () {
  const refresh = document.getElementById('stats-window-refresh');
  let loading = false;
  async function reload() {
    if (loading) return;
    loading = true;
    refresh.classList.add('spinning');
    try { await loadStats(); } finally {
      loading = false;
      refresh.classList.remove('spinning');
    }
  }
  refresh.addEventListener('click', reload);
  reload();
})();
