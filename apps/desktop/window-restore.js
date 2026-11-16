// window-restore.js — the windows of their own (the Task Manager, Stats, a
// project's tab) that were open when Switchboard closed, as a list kept in
// the settings, and that list read back at the next start to open them again
// where they were.
const MAX_WINDOWS = 24;

function boundsOf(win) {
  try {
    const b = win.isMinimized() ? win.getNormalBounds() : win.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return null;
  }
}

/**
 * The open windows as the list to keep: tool windows by kind, project
 * windows by project and tab (`${projectId}\n${tab}` keys), each with its
 * place and size.
 */
function describeOpenWindows(toolWindows, projectWindows) {
  const list = [];
  for (const [kind, win] of toolWindows || []) {
    if (!win || win.isDestroyed()) continue;
    list.push({ kind, bounds: boundsOf(win) });
  }
  for (const [key, win] of projectWindows || []) {
    if (!win || win.isDestroyed()) continue;
    const [projectId, tab] = String(key).split('\n');
    list.push({ kind: 'project', projectId, tab, bounds: boundsOf(win) });
  }
  return list.slice(0, MAX_WINDOWS);
}

function cleanBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < 100 || height < 100 || width > 20000 || height > 20000) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * The saved list, keeping only what can be opened again: a tool window of a
 * known kind, a project window of a known tab whose project still exists;
 * each once. Bounds that make no sense are dropped (the window then opens
 * where its kind last was).
 */
function windowsToRestore(saved, { toolKinds, projectTabs, projectExists }) {
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of saved) {
    if (!entry || typeof entry !== 'object' || out.length >= MAX_WINDOWS) continue;
    let key;
    let item;
    if (entry.kind === 'project') {
      const { projectId, tab } = entry;
      if (typeof projectId !== 'string' || !projectId || projectId.length > 200) continue;
      if (!projectTabs.has(tab)) continue;
      let exists = false;
      try { exists = !!projectExists(projectId); } catch {}
      if (!exists) continue;
      key = `project\n${projectId}\n${tab}`;
      item = { kind: 'project', projectId, tab };
    } else {
      if (typeof entry.kind !== 'string' || !toolKinds.has(entry.kind)) continue;
      key = entry.kind;
      item = { kind: entry.kind };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const bounds = cleanBounds(entry.bounds);
    if (bounds) item.bounds = bounds;
    out.push(item);
  }
  return out;
}

module.exports = { describeOpenWindows, windowsToRestore, MAX_WINDOWS };
