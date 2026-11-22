// --- Files dropped on the sidebar ---
// Dragging a file from outside the app over the sidebar, on any tab, turns it
// into a drop zone of two halves: the upper one opens the file here, in the
// Files tab's editor; the lower one opens it in a window of its own. Either
// way the file joins the Files tab's list (files-view.js openDroppedFiles).
// Drags inside the app (a pinned file being moved, a session) carry no files
// and are left alone. A project's window has no sidebar, so no drop zone.

(function setupSidebarFileDrop() {
  if (typeof PROJECT_WINDOW !== 'undefined' && PROJECT_WINDOW) return;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-drop-overlay');
  if (!sidebar || !overlay) return;
  const halves = [...overlay.querySelectorAll('[data-drop]')];
  let depth = 0;

  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const canDrop = () => !sidebar.classList.contains('collapsed');
  const targetAt = (e) => {
    const rect = sidebar.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'here' : 'window';
  };
  const show = (target) => {
    // Fixed over the sidebar's box, so the sidebar's own layout is untouched.
    const rect = sidebar.getBoundingClientRect();
    Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    overlay.hidden = false;
    for (const half of halves) half.classList.toggle('is-over', half.dataset.drop === target);
  };
  const hide = () => {
    depth = 0;
    overlay.hidden = true;
    for (const half of halves) half.classList.remove('is-over');
  };

  sidebar.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e) || !canDrop()) return;
    e.preventDefault();
    depth++;
    show(targetAt(e));
  });
  sidebar.addEventListener('dragover', (e) => {
    if (!isFileDrag(e) || !canDrop()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    show(targetAt(e));
  });
  sidebar.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) hide();
  });
  sidebar.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const target = targetAt(e);
    hide();
    if (!canDrop()) return;
    const paths = Array.from(e.dataTransfer.files || []).map((file) => {
      try { return window.api.getPathForFile(file); } catch { return ''; }
    }).filter(Boolean);
    openDroppedFiles(paths, target);
  });
  // A drag that ends elsewhere, or is cancelled, takes the drop zone with it.
  window.addEventListener('dragend', hide);
  window.addEventListener('blur', () => { if (!overlay.hidden) hide(); });
  document.addEventListener('drop', () => { if (!overlay.hidden) hide(); });
})();
