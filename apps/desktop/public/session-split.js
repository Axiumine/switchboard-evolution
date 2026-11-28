// --- Split: a new session beside this one ---
// Split never shows the same session twice: it starts a new session in the
// same folder, project and track, with what the session was launched with
// (its CLI, model, permissions…), and puts it in a pane beside it. A plain
// terminal splits into a new terminal in the same folder.
//
// What each session was launched with is remembered here, through a one-line
// hook in launchNewSession (app.js): sessionLaunchSpecs.v1, at most 200, the
// newest kept. Options that belong to one launch only (a new worktree, a fork,
// a resume, a schedule's, a first prompt, a plan item) are never repeated. With
// nothing remembered (a session from before, or launched elsewhere), the
// folder's defaults and the session's CLI are used.
//
// `place(newId)` puts the new pane: by default in the Session tab's layout
// (placeTileSplit, tile-view.js); the overview's dock passes its own, and then
// `scope` is not used.
//
// Depends on: launchNewSession, sessionMap, openSessions (app.js);
// resolveDefaultSessionOptions, launchTerminalSession, showNewSessionDialog
// (dialogs.js); SessionConfig (session-config.js); placeTileSplit, TILE_ICONS,
// tileState (tile-view.js); sessionWindowMenuItems (session-window-host.js);
// ICONS (icons.js). The view's and the icons' are typeof guarded, so the logic
// runs without a page (test/session-split.test.js).

const SESSION_LAUNCH_SPECS_KEY = 'sessionLaunchSpecs.v1';
const SESSION_LAUNCH_SPECS_MAX = 200;
// Options of one launch only: a split never repeats them.
const LAUNCH_SPEC_ONE_OFF = ['worktree', 'worktreeName', 'forkFrom', 'resumeExisting', 'scheduleId', 'unattended', 'initialPrompt', 'planItem'];

const isLaunchSpecObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Where a session goes: its folder, project and track, and nothing else of the object given. */
function launchSpecTarget(place) {
  return {
    projectPath: typeof place?.projectPath === 'string' ? place.projectPath : '',
    projectId: place?.projectId || null,
    trackId: place?.trackId || null,
  };
}

/** { id: { project, options, savedAt } }; unreadable or invalid storage reads as none. */
function readLaunchSpecs() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SESSION_LAUNCH_SPECS_KEY) || 'null'); } catch { return {}; }
  if (!isLaunchSpecObject(saved) || !isLaunchSpecObject(saved.specs)) return {};
  const specs = {};
  for (const [id, spec] of Object.entries(saved.specs)) {
    if (!isLaunchSpecObject(spec) || !isLaunchSpecObject(spec.options)) continue;
    specs[id] = { project: launchSpecTarget(spec.project), options: spec.options, savedAt: Number(spec.savedAt) || 0 };
  }
  return specs;
}

function writeLaunchSpecs(specs) {
  try { localStorage.setItem(SESSION_LAUNCH_SPECS_KEY, JSON.stringify({ v: 1, specs })); } catch {}
}

/** A copy of launch options without those of one launch only. */
function cleanLaunchSpec(options) {
  const clean = { ...(isLaunchSpecObject(options) ? options : {}) };
  for (const key of LAUNCH_SPEC_ONE_OFF) delete clean[key];
  return clean;
}

/** launchNewSession's hook: what session `id` was launched with, and where. */
function rememberLaunchSpec(id, project, options) {
  if (typeof id !== 'string' || !id) return;
  const specs = readLaunchSpecs();
  specs[id] = { project: launchSpecTarget(project), options: cleanLaunchSpec(options), savedAt: Date.now() };
  const newest = Object.entries(specs).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, SESSION_LAUNCH_SPECS_MAX);
  writeLaunchSpecs(Object.fromEntries(newest));
}

/** A session that changed id (Codex's real one, a fork) keeps what it was launched with. */
function rekeyLaunchSpec(oldId, newId) {
  if (typeof oldId !== 'string' || typeof newId !== 'string' || !oldId || !newId || oldId === newId) return;
  const specs = readLaunchSpecs();
  if (!specs[oldId]) return;
  specs[newId] = specs[oldId];
  delete specs[oldId];
  writeLaunchSpecs(specs);
}

/**
 * What a split of `session` launches: where the session is now (its folder,
 * project and track) and what it was launched with, or the folder's defaults
 * with its CLI. The project and track go in `project`, as for any launch.
 */
async function splitSpecFor(session) {
  const spec = readLaunchSpecs()[session.sessionId];
  const project = launchSpecTarget(session);
  if (!project.projectPath && spec) project.projectPath = spec.project.projectPath;
  const source = spec ? spec.options : await resolveDefaultSessionOptions(project);
  const { projectId, trackId, ...options } = cleanLaunchSpec(source);
  options.runtime = session.runtime || options.runtime || 'claude';
  return { project, options };
}

function splitSourceSession(id) {
  if (typeof id !== 'string' || !id) return null;
  return sessionMap.get(id) || openSessions.get(id)?.session || null;
}

function defaultSplitPlace(targetId, { direction, scope }) {
  return newId => {
    if (typeof placeTileSplit === 'function') placeTileSplit(targetId, newId, { direction, scope });
  };
}

/**
 * Starts a session beside `id` without taking the screen, then `place(newId)`.
 * Resolves the new id, or null when nothing was started.
 */
async function splitSession(id, { direction = 'auto', scope = 'main', place } = {}) {
  const session = splitSourceSession(id);
  if (!session) return null;
  let newId;
  if (session.type === 'terminal') {
    newId = await launchTerminalSession(launchSpecTarget(session), { show: false });
  } else {
    const { project, options } = await splitSpecFor(session);
    newId = await launchNewSession(project, options, { focus: false });
  }
  if (typeof newId !== 'string' || !newId) return null;
  (place || defaultSplitPlace(id, { direction, scope }))(newId);
  return newId;
}

/** The new session dialog's fields, filled with what the session was launched with. */
function splitFormOverrides(runtime, options) {
  const overrides = {};
  if (typeof SessionConfig === 'undefined') return overrides;
  // A field the form does not take, or a value it refuses, is left to the folder default.
  for (const [key, value] of Object.entries(options)) {
    try { Object.assign(overrides, SessionConfig.normalizeOverrides(runtime, { [key]: value })); } catch {}
  }
  return overrides;
}

/** "New split session with configuration…": the dialog, filled; the session it starts goes beside `id`. */
async function splitSessionWithConfiguration(id, { direction = 'auto', scope = 'main', place } = {}) {
  const session = splitSourceSession(id);
  if (!session) return;
  if (session.type === 'terminal') { await splitSession(id, { direction, scope, place }); return; }
  const { project, options } = await splitSpecFor(session);
  const put = place || defaultSplitPlace(id, { direction, scope });
  // Like a plain split, it runs where the session runs unless a worktree is asked for.
  const overrides = splitFormOverrides(options.runtime, { ...options, worktree: false });
  await showNewSessionDialog(project, options.runtime, {
    overrides,
    onStart: chosen => Promise.resolve()
      .then(() => launchNewSession(project, chosen, { focus: false }))
      .then(newId => { if (typeof newId === 'string' && newId) put(newId); })
      .catch(err => console.warn('[split] The configured split could not start:', err)),
  });
}

/**
 * Split, Split right, Split down and New split session with configuration…, for
 * a session's menu, then Open in new window. Each item (its separator too) is
 * marked `splitItem`: the Session Overview puts its own in their place
 * (session-overview-dock.js, session-overview.js).
 */
function splitMenuItems(session) {
  if (!session?.sessionId || session.archived) return [];
  if (typeof PROJECT_WINDOW !== 'undefined' && PROJECT_WINDOW) return [];
  const id = session.sessionId;
  // The layouts of the window the menu is in: the main window's, or a session window's own.
  const scope = typeof tileState !== 'undefined' ? tileState.scope : 'main';
  const icon = (name, size = 14) => (typeof TILE_ICONS !== 'undefined' && TILE_ICONS[name] ? TILE_ICONS[name](size) : '');
  const run = (label, start) => () => Promise.resolve().then(start)
    .catch(err => console.warn(`[split] ${label} failed:`, err));
  const items = [
    { label: 'Split', icon: icon('split'), onClick: run('Split', () => splitSession(id, { scope })) },
    { label: 'Split right', icon: icon('splitRight'), onClick: run('Split right', () => splitSession(id, { direction: 'right', scope })) },
    { label: 'Split down', icon: icon('splitDown'), onClick: run('Split down', () => splitSession(id, { direction: 'down', scope })) },
  ];
  if (session.type !== 'terminal') {
    items.push({
      label: 'New split session with configuration…',
      icon: typeof ICONS !== 'undefined' ? ICONS.launchConfig(14) : '',
      onClick: run('Split with configuration', () => splitSessionWithConfiguration(id, { scope })),
    });
  }
  // Open in new window, or Show window and Bring back (session-window-host.js).
  if (typeof sessionWindowMenuItems === 'function') items.push(...sessionWindowMenuItems(session));
  return [...items, { sep: true }].map(item => ({ ...item, splitItem: true }));
}
