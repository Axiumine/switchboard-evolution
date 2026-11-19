// What the Sessions tab lists, and in which order: the status, pinned and
// order combos, the "Group by folders" box, and the flat list. Pure functions
// over session lists and render items, so the rules can be tested without a
// window. sidebar.js builds the rows; app.js holds the choices.

const SESSION_STATUS_FILTERS = [
  ['all', 'All statuses'],
  ['running', 'Running'],
  ['attention', 'Needs input'],
  ['stopped', 'Not running'],
];
const SESSION_PIN_FILTERS = [
  ['all', 'Pinned or not'],
  ['pinned', 'Pinned'],
  ['unpinned', 'Not pinned'],
];
const SESSION_ORDERS = [
  ['recent', 'Most recent first'],
  ['priority', 'Running & pinned first'],
];
const SESSION_LIST_DEFAULTS = { status: 'all', pinned: 'all', order: 'recent', groupByFolders: false };
// The order key of the one flat list, in place of a folder's path.
const FLAT_SESSIONS_KEY = '__flat__';
const SESSION_LIST_STORAGE_KEYS = {
  status: 'sessions.status',
  pinned: 'sessions.pinned',
  order: 'sessions.order',
  groupByFolders: 'sessions.groupByFolders',
};

function sessionListChoices(kind) {
  return { status: SESSION_STATUS_FILTERS, pinned: SESSION_PIN_FILTERS, order: SESSION_ORDERS }[kind] || [];
}

/** A saved choice, or the default when it is missing or no longer offered. */
function validSessionListChoice(kind, value) {
  return sessionListChoices(kind).some(([v]) => v === value) ? value : SESSION_LIST_DEFAULTS[kind];
}

/** The four choices as saved in `storage` (localStorage); defaults when it throws or is empty. */
function loadSessionListPrefs(storage) {
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  return {
    status: validSessionListChoice('status', read(SESSION_LIST_STORAGE_KEYS.status)),
    pinned: validSessionListChoice('pinned', read(SESSION_LIST_STORAGE_KEYS.pinned)),
    order: validSessionListChoice('order', read(SESSION_LIST_STORAGE_KEYS.order)),
    groupByFolders: read(SESSION_LIST_STORAGE_KEYS.groupByFolders) === '1',
  };
}

function saveSessionListPrefs(storage, prefs) {
  try {
    storage.setItem(SESSION_LIST_STORAGE_KEYS.status, prefs.status);
    storage.setItem(SESSION_LIST_STORAGE_KEYS.pinned, prefs.pinned);
    storage.setItem(SESSION_LIST_STORAGE_KEYS.order, prefs.order);
    storage.setItem(SESSION_LIST_STORAGE_KEYS.groupByFolders, prefs.groupByFolders ? '1' : '0');
  } catch {}
}

/** Whether a status or pinned filter hides some sessions. Order and grouping never do. */
function sessionFiltersActive(prefs) {
  return prefs.status !== 'all' || prefs.pinned !== 'all';
}

/**
 * The sessions that pass the status and pinned combos. `isRunning` and
 * `needsInput` take a session id. Running holds the sessions that need input
 * too: they are running as well.
 */
function filterSessionsByPrefs(sessions, prefs, { isRunning, needsInput }) {
  return sessions.filter(s => {
    if (prefs.pinned === 'pinned' && !s.starred) return false;
    if (prefs.pinned === 'unpinned' && s.starred) return false;
    if (prefs.status === 'running') return isRunning(s.sessionId);
    if (prefs.status === 'attention') return needsInput(s.sessionId);
    if (prefs.status === 'stopped') return !isRunning(s.sessionId);
    return true;
  });
}

/** Running and pinned 3, running 2, pinned 1, the rest 0. */
function sessionPriority(pinned, running) {
  return pinned && running ? 3 : running ? 2 : pinned ? 1 : 0;
}

/** A sort of sessions or render items: `recent` is the time alone, `priority` puts running and pinned first. */
function compareByOrder(order, priorityOf, timeOf) {
  return (a, b) => {
    if (order === 'priority') {
      const diff = priorityOf(b) - priorityOf(a);
      if (diff) return diff;
    }
    return timeOf(b) - timeOf(a);
  };
}

function sortSessionsByOrder(sessions, order, isRunning) {
  return [...sessions].sort(compareByOrder(order,
    s => sessionPriority(!!s.starred, isRunning(s.sessionId)),
    s => new Date(s.modified)));
}

/**
 * Put render items ({ sortTime, pinned, running, element: { id } }) in order.
 * With `resort`, or no earlier order for this list, by the chosen order. Else
 * rows keep the places they had (`previousIds`) so nothing jumps while you
 * work, and new rows go on top.
 */
function orderRenderItems(items, { order, resort, previousIds }) {
  if (resort || !previousIds) {
    return [...items].sort(compareByOrder(order, i => sessionPriority(i.pinned, i.running), i => i.sortTime));
  }
  const orderIndex = new Map(previousIds.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const aPos = orderIndex.get(a.element.id);
    const bPos = orderIndex.get(b.element.id);
    if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
    if (aPos === undefined && bPos !== undefined) return -1;
    if (aPos !== undefined && bPos === undefined) return 1;
    return b.sortTime - a.sortTime;
  });
}

/**
 * Split ordered render items into the ones shown and the "+ N older" rest.
 * Running and pinned rows always show; the others fill `visibleCount` places
 * and must be newer than `maxAgeDays`. With `showAll` (a search or a filter is
 * on) nothing is held back. A list with nothing shown shows its older rows.
 */
function truncateRenderItems(items, { showAll, visibleCount, maxAgeDays, now = Date.now() }) {
  if (showAll) return { visible: items, older: [] };
  let visible = [];
  let older = [];
  let count = 0;
  const ageCutoff = now - maxAgeDays * 86400000;
  for (const item of items) {
    if (item.running || item.pinned || (count < visibleCount && item.sortTime >= ageCutoff)) {
      visible.push(item);
      count++;
    } else {
      older.push(item);
    }
  }
  if (visible.length === 0 && older.length > 0) { visible = older; older = []; }
  return { visible, older };
}

/**
 * A folder's name for a row of the flat list. A Claude worktree
 * (<repo>/.claude/worktrees/<name>) reads "<repo folder>/<name>", since its own
 * last segments say nothing; a folder inside a project reads as that project's
 * header does (`rootLabel`); any other folder by its last two segments.
 */
function sessionFolderLabel(projectPath, rootLabel = null) {
  if (!projectPath) return '';
  const worktree = projectPath.match(/^(.+?)\/\.claude\/worktrees\/([^/]+)\/?$/);
  if (worktree) {
    const repo = worktree[1].split(/[\\/]/).filter(Boolean).pop() || worktree[1];
    return `${repo}/${worktree[2]}`;
  }
  if (rootLabel) return rootLabel;
  return projectPath.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

/**
 * The one list of the flat view, shaped like a folder so it goes through the
 * same processing: every folder's sessions (worktrees too), once each, and
 * `folderLabels` saying where each lives.
 */
function flatSessionsFolder(folders, labelOf) {
  const sessions = [];
  const folderLabels = new Map();
  for (const folder of folders) {
    const label = labelOf(folder.projectPath);
    for (const session of folder.sessions) {
      if (folderLabels.has(session.sessionId)) continue;
      folderLabels.set(session.sessionId, label);
      sessions.push(session);
    }
  }
  return { projectPath: FLAT_SESSIONS_KEY, sessions, folderLabels };
}
