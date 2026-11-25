// knowledge.js — the Node Knowledge tab: a project's folders as
// codebase-memory-mcp (CBM) code graphs.
//
// The tab's folders are the project folder (project.root: plans, notes, tools,
// and where the agents' sessions start) and the attached ones. Each is one CBM
// project, under a name this module picks once and keeps in the project's
// settings: the name CBM already has for that folder when it is indexed (by
// the agents, by hand), else the folder's name, made unique; the project
// folder takes the name CBM gives it, the one an agent's session there finds.
// Every call is about a folder of the project, and the CBM name is filled in
// here: the renderer and the phone never name a CBM project or a path to index
// themselves, so they cannot reach other indexes or folders.
//
// A file is in one graph: the one of the innermost folder of the tab that holds
// it. A folder inside another (a worktree in the project folder's repos/, a
// repository attached on its own inside an attached one) has a graph of its
// own, and the graph around it leaves it out through a block this module keeps
// in that folder's .cbmignore (reconcileExclusions). Repositories inside a
// folder that are not folders of the tab (submodules, clones) are read with it
// (modules() says which ones, and which its rules leave out).
//
// Indexing runs as a CBM job (index_repository async) that this module polls
// and reports with 'knowledge-changed'. CBM's own watcher only follows the
// project of an agent's session, not the indexes made here, so keeping them
// fresh is this module's job too: scheduleRefresh() re-indexes (incremental,
// under a second when little changed) when the folder's git state moves.
//
// Like worktrees.js this is a singleton initialised with init(ctx), so tests
// can hand it a fake db, client and projects.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SETTINGS_PREFIX = 'knowledge:';
const GLOBAL_KEY = 'knowledge';
// Graphs whose delete CBM did not take (not running, busy): sweepOrphans() tries again.
const ORPHANS_KEY = 'knowledge-orphans';
const ORPHANS_MAX = 500;

// The tools a folder can be asked anything of: none of them writes.
const READ_TOOLS = new Set([
  'search_graph', 'search_code', 'trace_path', 'get_code_snippet', 'get_file_outline',
  'get_graph_schema', 'get_architecture', 'query_graph', 'detect_changes', 'index_status',
  'check_index_coverage',
]);
// Arguments the module sets itself; anything the caller passes for them is dropped.
const OWNED_ARGS = new Set(['project', 'repo_path', 'base_project', 'target_project', 'format', 'name']);
const INDEX_MODES = new Set(['full', 'moderate', 'fast']);
const TOOL_PROFILES = new Set(['all', 'analysis', 'scout']);
const ADR_MODES = new Set(['outline', 'get', 'update', 'set_sections']);
const PROMPTS = new Set(['explore_codebase', 'review_change_impact']);
const LENS_WORKSPACES = new Set(['explore', 'galaxy', 'architecture', 'adr', 'coverage', 'system']);
const JOB_DONE = new Set(['succeeded', 'failed', 'cancelled']);
const JOB_STATES = new Set(['queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled']);
// A job longer than this, or this many answers without a state CBM knows, is given up.
const JOB_MAX_MS = 2 * 60 * 60 * 1000;
const POLL_UNKNOWN_MAX = 10;
// How long the program found and the agents' configs are taken as read.
const AGENTS_TTL_MS = 15_000;
// How long a worktree's graph waits for a job still reading it before the delete goes ahead.
const FORGET_WAIT_MS = 2 * 60 * 1000;

const ARGS_MAX_BYTES = 64 * 1024;
// CBM trims answers to 3,200 tokens by default, a budget for a model's context.
// The app shows lists, not prompts: it asks for room unless the caller sets one.
const OUTPUT_TOKENS = 120000;
const ADR_MAX_BYTES = 8000;
const TRACES_FILE_MAX_BYTES = 20 * 1024 * 1024;
const TRACES_MAX = 10000;
const TRACE_PATH_MAX = 256;
const SAVED_QUERIES_MAX = 100;
// The names this module makes up are at most this long; the ones CBM makes
// (from the whole path, for a folder an agent's session indexed) reach NAME_CBM_MAX.
const NAME_MAX = 80;
const NAME_CBM_MAX = 200;
// The project folder's mode in the tab's folder list (an attached folder is 'in-place' or 'worktree').
const PROJECT_MODE = 'project';
// The block of .cbmignore this module keeps: the folders inside that have a graph of their own.
const IGNORE_FILE = '.cbmignore';
const IGNORE_START = '# switchboard:managed start (folders with a code graph of their own; kept by Switchboard)';
const IGNORE_END = '# switchboard:managed end';
// Repositories looked for inside a folder (modules()): how deep, how many folders read, how many found.
const MODULE_DEPTH = 4;
const MODULE_MAX_DIRS = 5000;
const MODULE_MAX = 100;
const MODULE_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'venv', '__pycache__']);
// check_index_coverage takes at most this many scopes per call.
const SCOPES_MAX = 32;
// How long a modules() answer stands before a refresh of the folder reads it again.
const MODULES_TTL_MS = 10 * 60 * 1000;
// Settings key: the graphs of the app's own folders (its CBM session's cwd before) were deleted once.
const APP_GRAPHS_KEY = 'knowledge-app-graphs-swept';
const POLL_MS = 1000;
const POLL_ERRORS_MAX = 10;
const REFRESH_DEBOUNCE_MS = 3000;
const LENS_PROBE_MS = 1500;
// The git watcher of a folder stops after 15 idle minutes; enabled folders are touched more often.
const WATCH_KEEPALIVE_MS = 5 * 60 * 1000;

// CBM's runtime settings the app shows (`config list/set`), with what each takes.
const CONFIG_KEYS = {
  auto_index: 'bool',
  auto_index_limit: 'count',
  auto_watch: 'bool',
  watch_non_git: 'bool',
  ignore_worktrees: 'bool',
  doc_candidates: ['auto', 'true', 'false'],
  index_max_files: 'limit',
  index_max_source_mb: 'limit',
  index_max_rss_mb: 'limit',
  index_max_duration_seconds: 'limit',
  ui_enabled: 'bool',
  ui_port: 'port',
};
// CBM reads a count into a C int (strtol, then a cast): more than this would wrap.
const CBM_INT_MAX = 2147483647;
// CBM settings the app changes once, the first time it finds CBM, and only
// from CBM's own default: after that the value is the user's.
const CONFIG_DEFAULTS = {
  // A repository an agent opens a session in is indexed if it has no graph yet…
  auto_index: { from: 'false', to: 'true' },
  // …however big it is.
  auto_index_limit: { from: '50000', to: String(CBM_INT_MAX) },
};
const CONFIG_DEFAULTS_KEY = 'knowledge-config-defaults';

let db, log, projects, client, locator, emit, runConfig, fetchImpl, now, timers, watchRepo, syncBrief, cbmDir, runInstall, runGit;
let keepAlive = null;
const jobs = new Map(); // folderPath → { projectId, name, state, mode, startedAt, finishedAt, error, kind, again }
const refreshTimers = new Map(); // folderPath → timeout
const linking = new Map(); // projectId → the cross-repo link under way
let naming = Promise.resolve(); // names are picked one at a time
let forgetting = Promise.resolve(); // graphs of folders that left, deleted one at a time
let autoIndexing = Promise.resolve(); // folders that joined a project with the graph on, read one at a time
let agentsCache = null; // { at, value }
let latestVersion = null;
let latestAsked = false;
let download = null; // { step, error } while a download runs or after it failed
let reconciling = Promise.resolve(); // .cbmignore blocks, written one pass at a time
const moduleCache = new Map(); // folderPath → the last modules() answer, for the brief

function init(ctx) {
  db = ctx.db;
  log = ctx.log || console;
  projects = ctx.projects;
  client = ctx.client;
  locator = ctx.locator || require('./cbm-locator');
  emit = ctx.emit || (() => {});
  runConfig = ctx.runConfig || defaultRunConfig;
  fetchImpl = ctx.fetchImpl || globalThis.fetch;
  now = ctx.now || (() => Date.now());
  timers = ctx.timers || { setTimeout, clearTimeout };
  watchRepo = ctx.watchRepo || null;
  syncBrief = ctx.syncBrief || (async () => {});
  cbmDir = ctx.cbmDir || null;
  runInstall = ctx.runInstall || defaultRunInstall;
  runGit = ctx.runGit || defaultRunGit;
  jobs.clear();
  reconciling = Promise.resolve();
  moduleCache.clear();
  for (const t of refreshTimers.values()) timers.clearTimeout(t);
  refreshTimers.clear();
  linking.clear();
  naming = Promise.resolve();
  forgetting = Promise.resolve();
  autoIndexing = Promise.resolve();
  agentsCache = null;
  latestVersion = null;
  latestAsked = false;
  download = null;
}

// --- Settings ---

/** A CBM project name: the app's own (NAME_MAX) or one CBM made from a long path (up to NAME_CBM_MAX). */
function cleanName(value) {
  return typeof value === 'string' && value.length <= NAME_CBM_MAX && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : null;
}

function cleanQueries(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item.query !== 'string' || !item.query.trim()) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : item.query.trim().slice(0, 40);
    out.push({ name, query: item.query.slice(0, 4000) });
    if (out.length >= SAVED_QUERIES_MAX) break;
  }
  return out;
}

function cleanMap(value, clean) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, v] of Object.entries(value)) {
    if (typeof key !== 'string' || !path.isAbsolute(key)) continue;
    const c = clean(v);
    if (c != null) out[key] = c;
  }
  return out;
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: s.enabled === true,
    mode: INDEX_MODES.has(s.mode) ? s.mode : 'full',
    toolProfile: TOOL_PROFILES.has(s.toolProfile) ? s.toolProfile : 'all',
    crossRepo: s.crossRepo !== false,
    autoRefresh: s.autoRefresh !== false,
    names: cleanMap(s.names, cleanName),
    // The folders CBM has a graph of: a name is kept after a delete (the next
    // index reuses it), so a name alone does not say there is one.
    indexed: cleanMap(s.indexed, (v) => (v === true ? true : null)),
    share: cleanMap(s.share, (v) => (v === true ? true : null)),
    // The folders that were worktrees when named: their graph goes when they leave the project.
    worktrees: cleanMap(s.worktrees, (v) => (v === true ? true : null)),
    savedQueries: cleanQueries(s.savedQueries),
  };
}

function requireProject(projectId) {
  const project = db.getProject(projectId);
  if (!project) throw new Error('Project not found');
  return project;
}

function settingsFor(projectId) {
  return normalizeSettings(db.getSetting(SETTINGS_PREFIX + projectId));
}

function saveSettings(projectId, next) {
  db.setSetting(SETTINGS_PREFIX + projectId, normalizeSettings(next));
}

function getSettings(projectId) {
  requireProject(projectId);
  return { ok: true, settings: settingsFor(projectId) };
}

/** Change the project's Node Knowledge settings; names are the module's own and cannot be set here. */
function setSettings(projectId, patch) {
  requireProject(projectId);
  const current = settingsFor(projectId);
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...current };
  for (const key of ['enabled', 'mode', 'toolProfile', 'crossRepo', 'autoRefresh', 'savedQueries']) {
    if (key in p) next[key] = p[key];
  }
  if (p.share && typeof p.share === 'object') {
    // The project folder is not a repository to share a graph through.
    const folders = new Set(knowledgeFolders(projectId).filter(f => f.mode !== PROJECT_MODE).map(f => f.path));
    next.share = { ...current.share };
    for (const [folder, on] of Object.entries(p.share)) {
      if (!folders.has(folder)) continue;
      if (on === true) next.share[folder] = true; else delete next.share[folder];
    }
  }
  saveSettings(projectId, next);
  const settings = settingsFor(projectId);
  watchEnabledFolders();
  if (current.enabled !== settings.enabled || current.crossRepo !== settings.crossRepo) briefChanged(projectId);
  // Turned on: the folders without a graph are read now, the project folder first.
  if (!current.enabled && settings.enabled) {
    for (const f of knowledgeFolders(projectId)) if (!settings.indexed[f.path]) autoIndex(projectId, f.path);
  }
  emit('knowledge-changed', { projectId, reason: 'settings' });
  return { ok: true, settings };
}

/**
 * A new project (projects.js onProjectCreated) starts with the code graph on:
 * its project folder is read now, the attached folders as they join.
 */
function projectCreated({ projectId } = {}) {
  if (!projectId || !db.getProject(projectId)) return;
  saveSettings(projectId, { ...settingsFor(projectId), enabled: true });
  emit('knowledge-changed', { projectId, reason: 'settings' });
  const root = projectFolder(projectId);
  if (root) autoIndex(projectId, root.path);
}

/**
 * A project was deleted (projects.js onProjectDeleted; its attached folders
 * were reported detached before). The project folder stays on disk, but its
 * graph goes when no other project has that folder, and so do the settings.
 */
async function projectDeleted({ projectId, root } = {}) {
  if (!projectId) return { ok: false };
  const s = settingsFor(projectId);
  const rootPath = typeof root === 'string' && path.isAbsolute(root) ? root : null;
  let deleted = false;
  if (rootPath) {
    const name = s.names[rootPath] || null;
    if (name && !projectsWithFolder(rootPath).length) {
      deleted = await (forgetting = forgetting.then(() => deleteGraph(name, rootPath)).catch(() => false));
    }
  }
  if (typeof db.deleteSetting === 'function') db.deleteSetting(SETTINGS_PREFIX + projectId);
  else db.setSetting(SETTINGS_PREFIX + projectId, null);
  reconcileSoon();
  return { ok: true, deleted };
}

function globalSettings() {
  const raw = db.getSetting(GLOBAL_KEY);
  const s = raw && typeof raw === 'object' ? raw : {};
  return { binaryPath: typeof s.binaryPath === 'string' && path.isAbsolute(s.binaryPath) ? s.binaryPath : null };
}

function setGlobalSettings(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...globalSettings() };
  if ('binaryPath' in p) {
    if (p.binaryPath == null || p.binaryPath === '') next.binaryPath = null;
    else if (typeof p.binaryPath === 'string' && path.isAbsolute(p.binaryPath)) next.binaryPath = p.binaryPath;
    else throw new Error('The program path must be absolute');
  }
  db.setSetting(GLOBAL_KEY, next);
  agentsCache = null;
  client.reset();
  emit('knowledge-changed', { projectId: null, reason: 'binary' });
  return { ok: true, settings: globalSettings() };
}

// --- Folders and their CBM names ---

function samePath(a, b) {
  if (!a || !b) return false;
  if (path.resolve(a) === path.resolve(b)) return true;
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
}

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

/** child is strictly inside parent (both as given, resolved). */
function isInsidePath(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The project folder as one of the tab's folders, or null for a project without one. */
function projectFolder(projectId, project = db.getProject(projectId)) {
  if (!project || typeof project.root !== 'string' || !path.isAbsolute(project.root)) return null;
  const attached = db.listProjectFolders(projectId).find(f => path.resolve(f.path) === path.resolve(project.root));
  // A project folder also attached keeps its row's path, under which its settings are kept.
  return { path: attached ? attached.path : project.root, mode: PROJECT_MODE, sourcePath: null, branch: null, attached: !!attached };
}

/** The tab's folders: the project folder first, then the attached ones in their order. */
function knowledgeFolders(projectId) {
  const project = db.getProject(projectId);
  const attached = db.listProjectFolders(projectId);
  const root = projectFolder(projectId, project);
  if (!root) return attached;
  return [root, ...attached.filter(f => f.path !== root.path)];
}

function requireFolder(projectId, folderPath) {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('Pick one of the project\'s folders');
  const root = projectFolder(projectId);
  if (root && root.path === folderPath) return root;
  return projects.requireAttachedFolder(projectId, folderPath);
}

function nameSafe(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/-+$/, '');
}

function folderNameBase(folderPath) {
  return (nameSafe(path.basename(folderPath)) || 'repo').slice(0, NAME_MAX - 4);
}

/**
 * A worktree's name says what it is in the Lens: its repository's name (the
 * one the main checkout has, else its folder's), -wt-, then its branch.
 */
function worktreeNameBase(folder, byFolder, listed) {
  if (!folder.sourcePath) return folderNameBase(folder.path);
  const indexedSource = listed.find(p => samePath(p.root_path, folder.sourcePath));
  const source = byFolder.get(folder.sourcePath) || (indexedSource && cleanName(indexedSource.name)) || folderNameBase(folder.sourcePath);
  const branch = nameSafe(folder.branch) || nameSafe(path.basename(folder.path)) || 'worktree';
  return `${source}-wt-${branch}`.slice(0, NAME_MAX - 4).replace(/[-.]+$/, '');
}

function folderRow(projectId, folderPath) {
  return knowledgeFolders(projectId).find(f => f.path === folderPath) || null;
}

/** A worktree of a repository whose main checkout the project has too: a second copy of the same code. */
function isCopy(projectId, folder) {
  if (!folder || folder.mode !== 'worktree' || !folder.sourcePath) return false;
  return db.listProjectFolders(projectId).some(f => f.path !== folder.path && samePath(f.path, folder.sourcePath));
}

/** Every name the app has given, by folder, across projects: one folder keeps one name. */
function assignedNames() {
  const byFolder = new Map();
  const taken = new Set();
  for (const project of db.listProjects()) {
    const { names } = settingsFor(project.id);
    for (const [folder, name] of Object.entries(names)) {
      if (!byFolder.has(folder)) byFolder.set(folder, name);
      taken.add(name);
    }
  }
  return { byFolder, taken };
}

async function listProjects() {
  const out = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const page = await client.call('list_projects', { limit: 500, offset });
    const items = Array.isArray(page?.projects) ? page.projects : [];
    out.push(...items);
    if (!page?.has_more || !items.length) break;
  }
  return out;
}

/** The CBM name of a folder, picked once (see the top of the file). One at a time, so two folders never take the same name. */
function nameFor(projectId, folderPath, listed = null) {
  const run = naming.then(() => pickName(projectId, folderPath, listed));
  naming = run.catch(() => {});
  return run;
}

async function pickName(projectId, folderPath, listed) {
  const settings = settingsFor(projectId);
  if (settings.names[folderPath]) return settings.names[folderPath];
  const row = folderRow(projectId, folderPath);
  const worktree = row?.mode === 'worktree';
  const { byFolder, taken } = assignedNames();
  let name = byFolder.get(folderPath) || null;
  if (!name) {
    const indexed = listed || await listProjects();
    const existing = indexed.find(p => samePath(p.root_path, folderPath));
    if (existing && cleanName(existing.name)) name = existing.name;
    // The project folder is named by CBM on its first index (index() reads the
    // name back), so an agent's session that starts there finds the same graph.
    else if (row?.mode === PROJECT_MODE) return null;
    else {
      for (const p of indexed) taken.add(p.name);
      const base = worktree ? worktreeNameBase(row, byFolder, indexed) : folderNameBase(folderPath);
      name = base;
      for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    }
  }
  const fresh = settingsFor(projectId);
  fresh.names[folderPath] = name;
  if (worktree) fresh.worktrees[folderPath] = true;
  saveSettings(projectId, fresh);
  return name;
}

function knownName(projectId, folderPath) {
  const name = settingsFor(projectId).names[folderPath];
  if (!name) {
    const err = new Error('This folder has no code graph yet: index it first');
    err.code = 'not-indexed';
    throw err;
  }
  return name;
}

/** Record whether CBM has a graph of the folder, in every project that has it attached. */
function markIndexed(folderPath, on) {
  for (const id of projectsWithFolder(folderPath)) {
    const s = settingsFor(id);
    if (!!s.indexed[folderPath] === on) continue;
    if (on) s.indexed[folderPath] = true; else delete s.indexed[folderPath];
    saveSettings(id, s);
  }
}

// --- Status ---

function binaryStatus() {
  const found = client.refresh();
  if (!latestAsked) {
    latestAsked = true;
    locator.latestCbm({ fetchImpl }).then((v) => {
      latestVersion = v;
      if (v) emit('knowledge-changed', { projectId: null, reason: 'latest' });
    }).catch(() => {});
  }
  const asset = locator.assetFor();
  return {
    found: found ? { path: found.path, version: found.version, source: found.source, ok: found.ok } : null,
    minimum: locator.MIN_VERSION.join('.'),
    pinned: locator.CBM_VERSION,
    latest: latestVersion,
    updateAvailable: !!(found && latestVersion && locator.isNewerVersion(latestVersion, found.version)),
    canDownload: !!asset,
    installDir: locator.defaultInstallDir(),
    releasePage: locator.RELEASE_PAGE,
    download: download ? { ...download } : null,
  };
}

function jobFor(folderPath) {
  const job = jobs.get(folderPath);
  return job ? { state: job.state, mode: job.mode, kind: job.kind, startedAt: job.startedAt, finishedAt: job.finishedAt || null, error: job.error || null } : null;
}

/**
 * What the tab shows first: the binary, the session, the project's settings
 * and each attached folder with its CBM name, index status and job.
 */
async function status(projectId) {
  requireProject(projectId);
  const settings = settingsFor(projectId);
  const binary = binaryStatus();
  const folders = knowledgeFolders(projectId).map(f => ({
    path: f.path,
    // 'project' (the project folder), 'in-place' or 'worktree'.
    mode: f.mode,
    // A worktree's repository (its main checkout) and branch.
    sourcePath: f.mode === 'worktree' ? f.sourcePath || null : null,
    branch: f.mode === 'worktree' ? f.branch || null : null,
    name: settings.names[f.path] || null,
    shared: !!settings.share[f.path],
    indexed: false,
    index: null,
    job: jobFor(f.path),
    error: null,
    // Other CBM graphs of folders inside this one (see innerGraphs).
    inner: [],
  }));
  let error = null;
  if (binary.found && binary.found.ok) {
    try {
      const listed = await listProjects();
      const inner = innerGraphs(listed);
      for (const folder of folders) folder.inner = inner.get(folder.path) || [];
      for (const folder of folders) {
        const existing = folder.name
          ? listed.find(p => p.name === folder.name)
          : listed.find(p => samePath(p.root_path, folder.path));
        if (!existing) {
          // Deleted outside the app (CBM's own tools, a cleared cache).
          if (settings.indexed[folder.path]) markIndexed(folder.path, false);
          continue;
        }
        if (!folder.name) folder.name = await nameFor(projectId, folder.path, listed);
        folder.indexed = true;
        if (!settings.indexed[folder.path]) markIndexed(folder.path, true);
        try {
          folder.index = await client.call('index_status', { project: folder.name });
        } catch (err) {
          folder.error = err.message;
        }
      }
    } catch (err) {
      error = err.message;
    }
  }
  return { ok: true, binary, client: client.status(), agents: binary.found && binary.found.ok ? agentsStatus() : null, settings, folders, error };
}

/** Every folder of the tab in every project, by path: { projectIds, indexed }. */
function allKnowledgeFolders() {
  const out = new Map();
  for (const project of db.listProjects()) {
    const s = settingsFor(project.id);
    for (const f of knowledgeFolders(project.id)) {
      const entry = out.get(f.path) || { path: f.path, mode: f.mode, projectIds: [], indexed: false };
      entry.projectIds.push(project.id);
      if (s.indexed[f.path]) entry.indexed = true;
      out.set(f.path, entry);
    }
  }
  return out;
}

/**
 * The CBM graphs of folders inside a folder of the tab that are not folders of
 * the tab themselves, by that folder: their files are in its graph already.
 * CBM makes one when an agent's session starts in a subfolder (auto_index
 * reads the session's folder, not its repository's). The tab names them and
 * deletes one when asked (deleteInnerGraph), never on its own: it did not make them.
 */
function innerGraphs(listed) {
  const known = [...allKnowledgeFolders().keys()].map(p => ({ path: p, real: realOrResolved(p) }));
  const knownReal = new Set(known.map(k => k.real));
  const out = new Map();
  for (const graph of listed) {
    const root = typeof graph?.root_path === 'string' ? realOrResolved(graph.root_path) : null;
    if (!root || !cleanName(graph.name) || knownReal.has(root)) continue;
    // The innermost folder of the tab that holds it.
    let owner = null;
    for (const k of known) {
      if (!isInsidePath(root, k.real)) continue;
      if (!owner || isInsidePath(k.real, owner.real)) owner = k;
    }
    if (!owner) continue;
    const list = out.get(owner.path) || [];
    list.push({ name: graph.name, path: graph.root_path, rel: path.relative(owner.real, root).split(path.sep).join('/') });
    out.set(owner.path, list);
  }
  return out;
}

/** Delete one of the graphs innerGraphs() found inside a folder of the project, and only such a one. */
async function deleteInnerGraph(projectId, folderPath, name) {
  requireFolder(projectId, folderPath);
  const listed = await listProjects();
  const match = (innerGraphs(listed).get(folderPath) || []).find(g => g.name === name);
  if (!match) throw new Error('That graph is not one inside this folder');
  await client.call('delete_project', { project: match.name });
  changed(projectId, folderPath, 'inner-deleted');
  return { ok: true, deleted: match.name };
}

// --- Asking the graph ---

// Arguments that name a file of the folder: relative to it, never out of it.
const PATH_ARGS = new Set(['file_path', 'path', 'paths']);
// Cypher clauses that change a graph. CBM's query_graph is read-only; this keeps it so whatever its version.
const CYPHER_WRITE = /(^|[^.\w$])(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|LOAD|CALL)\b/i;

function checkRelPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || value.includes('\0')) throw new Error('A file must be a path in the folder');
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split(/[\\/]+/).includes('..')) throw new Error('A file must be a path in the folder');
}

/** The Cypher without its strings and comments, where a write clause would show. */
function cypherCode(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, "''");
}

function readOnlyCypher(text) {
  return !CYPHER_WRITE.test(cypherCode(text));
}

function cleanArgs(args, tool = null) {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object');
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (OWNED_ARGS.has(key)) continue;
    if (PATH_ARGS.has(key) && value != null) {
      if (Array.isArray(value)) value.forEach(checkRelPath); else checkRelPath(value);
    }
    out[key] = value;
  }
  if (tool === 'query_graph' && out.query != null && !readOnlyCypher(out.query)) {
    throw new Error('Only reading queries: the graph is changed by indexing, not from here');
  }
  if (Buffer.byteLength(JSON.stringify(out)) > ARGS_MAX_BYTES) throw new Error('The request is too large');
  return out;
}

/** Ask one of the read-only tools about a folder of the project. */
async function query(projectId, folderPath, tool, args) {
  requireFolder(projectId, folderPath);
  if (!READ_TOOLS.has(tool)) throw new Error(`Unknown tool: ${String(tool).slice(0, 60)}`);
  const name = knownName(projectId, folderPath);
  return client.call(tool, { max_output_tokens: OUTPUT_TOKENS, ...cleanArgs(args, tool), project: name });
}

/** compare_graphs between two folders of the project (a worktree and its main checkout, two branches). */
async function compare(projectId, baseFolder, targetFolder, opts = {}) {
  requireFolder(projectId, baseFolder);
  requireFolder(projectId, targetFolder);
  const args = {};
  if (Number.isInteger(opts.limit)) args.limit = Math.max(1, Math.min(1000, opts.limit));
  if (Number.isInteger(opts.scan_limit)) args.scan_limit = Math.max(1, Math.min(10_000_000, opts.scan_limit));
  return client.call('compare_graphs', { ...args, base_project: knownName(projectId, baseFolder), target_project: knownName(projectId, targetFolder) });
}

/** The text of one of CBM's prompts, for a session the user starts from the tab. */
async function prompt(projectId, folderPath, promptName, args = {}) {
  requireFolder(projectId, folderPath);
  if (!PROMPTS.has(promptName)) throw new Error('Unknown prompt');
  const a = args && typeof args === 'object' ? args : {};
  const out = { project: knownName(projectId, folderPath) };
  if (promptName === 'explore_codebase') out.question = String(a.question || '').slice(0, 2000) || 'Give me an overview of this codebase.';
  else {
    out.change = String(a.change || '').slice(0, 2000) || 'the uncommitted changes';
    if (a.base_branch) out.base_branch = String(a.base_branch).slice(0, 200);
  }
  return { ok: true, text: await client.prompt(promptName, out) };
}

// --- Indexing ---

function changed(projectId, folderPath, reason) {
  emit('knowledge-changed', { projectId, folderPath, reason });
}

/** Projects that have this folder among the tab's folders (attached, or as their project folder). */
function projectsWithFolder(folderPath) {
  return db.listProjects().filter(p => knowledgeFolders(p.id).some(f => f.path === folderPath)).map(p => p.id);
}

function announceJob(folderPath) {
  for (const id of projectsWithFolder(folderPath)) changed(id, folderPath, 'job');
}

async function pollJob(folderPath, job, repoArgs) {
  let errors = 0;
  let unknown = 0;
  while (!JOB_DONE.has(job.state)) {
    await new Promise(r => timers.setTimeout(r, POLL_MS));
    if (jobs.get(folderPath) !== job) return job;
    if (now() - job.startedAt > JOB_MAX_MS) {
      job.state = 'failed';
      job.error = 'codebase-memory-mcp did not finish within two hours';
      break;
    }
    try {
      const s = await client.call('index_repository', { ...repoArgs, status: true });
      const state = s?.state || s?.status;
      errors = 0;
      // An answer without a state CBM uses (a job the daemon lost on a restart) is not progress.
      if (typeof state !== 'string' || !JOB_STATES.has(state)) {
        unknown += 1;
        if (unknown >= POLL_UNKNOWN_MAX) {
          job.state = 'failed';
          job.error = `codebase-memory-mcp lost track of the job${typeof state === 'string' ? ` (${state})` : ''}`;
        }
        continue;
      }
      unknown = 0;
      if (state !== job.state) {
        job.state = state;
        if (s.error || s.message) job.error = JOB_DONE.has(state) && state !== 'succeeded' ? String(s.error || s.message) : null;
        announceJob(folderPath);
      }
    } catch (err) {
      errors += 1;
      if (errors >= POLL_ERRORS_MAX) {
        job.state = 'failed';
        job.error = err.message;
      }
    }
  }
  job.finishedAt = now();
  announceJob(folderPath);
  return job;
}

/**
 * Index a folder (or refresh its index: CBM only re-reads what changed).
 * Resolves once the job is started; 'knowledge-changed' follows it. With
 * `wait` it resolves when the job ends.
 */
async function index(projectId, folderPath, opts = {}) {
  const folder = requireFolder(projectId, folderPath);
  const running = jobs.get(folderPath);
  if (running && !JOB_DONE.has(running.state)) {
    // A change while the folder is read: read it again once this job ends.
    if (opts.kind === 'refresh') running.again = true;
    // Asked to wait: for the job under way (it already reads what changed before it started).
    if (opts.wait && running.done) await Promise.resolve(running.done).catch(() => {});
    return { ok: true, job: jobFor(folderPath), already: true };
  }
  const settings = settingsFor(projectId);
  const mode = INDEX_MODES.has(opts.mode) ? opts.mode : settings.mode;
  // In the map before anything is awaited, so a second call joins this one.
  const job = { projectId, name: null, state: 'queued', mode, kind: opts.kind === 'refresh' ? 'refresh' : 'index', startedAt: now(), finishedAt: null, error: null, again: false };
  // Settles when the job ends, from the start: a call that joins it while it starts can wait for it.
  let settle;
  job.done = new Promise((resolve) => { settle = resolve; });
  jobs.set(folderPath, job);
  announceJob(folderPath);
  let repoArgs;
  try {
    // The folders inside with a graph of their own are left out of this one first.
    await reconcileFolder(folderPath).catch((err) => log.warn?.('[knowledge] could not update .cbmignore', folderPath, err.message));
    const name = await nameFor(projectId, folderPath);
    job.name = name;
    // A project folder without a graph yet is named by CBM (pickName); its name is read back below.
    repoArgs = name ? { repo_path: folderPath, name } : { repo_path: folderPath };
    const args = { ...repoArgs, mode, async: true };
    if (settings.share[folderPath] && folder?.mode !== PROJECT_MODE) args.persistence = true;
    // CBM set to ignore worktrees (ignore_worktrees) still takes one asked for by name.
    if (folder?.mode === 'worktree') args.index_worktree = true;
    const started = await client.call('index_repository', args);
    const state = started?.state || started?.status;
    if (typeof state === 'string') job.state = state;
  } catch (err) {
    job.state = 'failed';
    job.error = err.message;
    job.finishedAt = now();
    announceJob(folderPath);
    settle(job);
    throw err;
  }
  announceJob(folderPath);
  const done = pollJob(folderPath, job, repoArgs).then(async (finished) => {
    // The folder left the project while it was read: forgetFolder() takes it from here.
    if (!projectsWithFolder(folderPath).length) return finished;
    if (finished.state === 'succeeded' && !job.name) {
      // The project folder's first graph: take the name CBM gave it.
      const named = await adoptName(projectId, folderPath).catch(() => null);
      if (named) job.name = named;
      else { finished.state = 'failed'; finished.error = 'codebase-memory-mcp indexed the folder but lists no graph of it'; announceJob(folderPath); }
    }
    if (finished.state === 'succeeded') {
      const wasIndexed = !!settingsFor(projectId).indexed[folderPath];
      markIndexed(folderPath, true);
      watchEnabledFolders();
      // The brief names the folder once its first graph is there; a folder inside
      // another with a graph of its own now leaves that one.
      if (!wasIndexed) {
        for (const id of projectsWithFolder(folderPath)) briefChanged(id);
        reconcileSoon();
      }
      // Which repositories inside it the graph has, for the brief and the Coverage view:
      // with an index asked for, and at most every few minutes with the refreshes.
      const cached = moduleCache.get(folderPath);
      if (finished.kind === 'index' || !cached || now() - cached.at > MODULES_TTL_MS) {
        modules(projectId, folderPath).catch((err) => log.warn?.('[knowledge] modules', folderPath, err.message));
      }
      // Links between folders come with an index asked for, not with each refresh,
      // and not for a second checkout of a repository the project has nor for the project folder.
      const row = folderRow(projectId, folderPath);
      if (finished.kind === 'index' && settingsFor(projectId).crossRepo && row?.mode !== PROJECT_MODE && !isCopy(projectId, row)) {
        await linkCrossRepo(projectId).catch((err) => log.warn?.('[knowledge] cross-repo link failed', err.message));
      }
    }
    if (finished.again) scheduleRefresh(folderPath);
    return finished;
  });
  done.then(settle, () => settle(job));
  if (opts.wait) await done;
  else done.catch(() => {});
  return { ok: true, job: jobFor(folderPath) };
}

/** The name CBM gave a folder indexed without one (the project folder), kept like any other. */
async function adoptName(projectId, folderPath) {
  const listed = await listProjects();
  const existing = listed.find(p => samePath(p.root_path, folderPath));
  const name = existing ? cleanName(existing.name) : null;
  if (!name) return null;
  for (const id of projectsWithFolder(folderPath)) {
    const s = settingsFor(id);
    if (s.names[folderPath]) continue;
    s.names[folderPath] = name;
    saveSettings(id, s);
  }
  return name;
}

/** Index every folder of the project (the project folder first), one job after the other. */
async function indexAll(projectId, opts = {}) {
  requireProject(projectId);
  const folders = knowledgeFolders(projectId).map(f => f.path);
  const run = async () => {
    for (const folder of folders) {
      try { await index(projectId, folder, { ...opts, wait: true }); } catch (err) { log.warn?.('[knowledge] index failed', folder, err.message); }
    }
  };
  if (opts.wait) await run(); else run().catch(() => {});
  return { ok: true, folders: folders.length };
}

/**
 * Link the project's indexed folders with each other (CROSS_* edges: one
 * calls the other's HTTP routes, queues, …). Needs two of them.
 */
function linkCrossRepo(projectId) {
  requireProject(projectId);
  // One link at a time per project: a second asks joins the first.
  if (linking.has(projectId)) return linking.get(projectId);
  const run = linkNow(projectId).finally(() => linking.delete(projectId));
  linking.set(projectId, run);
  return run;
}

/** The folders that take part in cross-repo links: indexed, attached (not the project folder), not a second checkout. */
function linkableFolders(projectId) {
  const settings = settingsFor(projectId);
  // A worktree next to its main checkout would only link the same code twice.
  return knowledgeFolders(projectId)
    .filter(f => f.mode !== PROJECT_MODE && !isCopy(projectId, f))
    .map(f => f.path)
    .filter(p => settings.names[p] && settings.indexed[p]);
}

// The folders the last link of each project could not link: the brief says so.
const LINK_ERRORS_KEY = 'knowledge-link-errors:';

function linkErrors(projectId) {
  const raw = db.getSetting(LINK_ERRORS_KEY + projectId);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function linkNow(projectId) {
  const settings = settingsFor(projectId);
  const folders = linkableFolders(projectId);
  if (folders.length < 2) return { ok: true, linked: 0 };
  const listed = new Set((await listProjects()).map(p => p.name));
  const indexed = folders.filter(p => listed.has(settings.names[p]));
  if (indexed.length < 2) return { ok: true, linked: 0 };
  let linked = 0;
  // One folder that fails does not keep the others from being linked.
  const errors = {};
  for (const folder of indexed) {
    const name = settings.names[folder];
    // A folder inside another that could not be left out of its graph is in both:
    // linking the two would only link the same code.
    const targets = indexed.filter(p => p !== folder && !overlapping(folder, p)).map(p => settings.names[p]);
    if (!targets.length) continue;
    try {
      await client.call('index_repository', { repo_path: folder, name, mode: 'cross-repo-intelligence', target_projects: targets }, { timeoutMs: 10 * 60 * 1000 });
      linked += 1;
    } catch (err) {
      errors[folder] = String(err.message || err).slice(0, 300);
      log.warn?.('[knowledge] cross-repo link failed', folder, err.message);
    }
  }
  const before = JSON.stringify(linkErrors(projectId));
  db.setSetting(LINK_ERRORS_KEY + projectId, errors);
  if (before !== JSON.stringify(errors)) briefChanged(projectId);
  changed(projectId, null, 'cross-repo');
  if (!linked) throw new Error(`No folder could be linked: ${Object.values(errors)[0] || 'codebase-memory-mcp did not answer'}`);
  return { ok: true, linked, errors };
}

/**
 * Refresh a folder's index soon (its git state moved). Only for projects with
 * the code graph turned on and automatic refresh kept, and only once indexed.
 */
function refreshOwner(folderPath) {
  return projectsWithFolder(folderPath).find((id) => {
    const s = settingsFor(id);
    return s.enabled && s.autoRefresh && s.names[folderPath] && s.indexed[folderPath];
  }) || null;
}

function scheduleRefresh(folderPath) {
  const owner = refreshOwner(folderPath);
  if (!owner) return false;
  const pendingTimer = refreshTimers.get(folderPath);
  if (pendingTimer) timers.clearTimeout(pendingTimer);
  refreshTimers.set(folderPath, timers.setTimeout(() => {
    refreshTimers.delete(folderPath);
    index(owner, folderPath, { kind: 'refresh' }).catch((err) => log.warn?.('[knowledge] refresh failed', err.message));
  }, REFRESH_DEBOUNCE_MS));
  return true;
}

/**
 * The folders whose git state starts a refresh: indexed ones of projects with
 * the graph on. Not the project folder, which is no repository: it is read
 * again when a session of the project ends and when the app starts
 * (sessionEnded, refreshProjectFolders).
 */
function watchedFolders() {
  const out = new Set();
  for (const project of db.listProjects()) {
    const s = settingsFor(project.id);
    if (!s.enabled || !s.autoRefresh) continue;
    for (const f of db.listProjectFolders(project.id)) if (s.names[f.path] && s.indexed[f.path]) out.add(f.path);
  }
  return [...out];
}

/** A session of the project ended: what it wrote in the project folder (plans, notes, tools) is read soon. */
function sessionEnded(projectId) {
  if (!projectId) return false;
  const root = projectFolder(projectId);
  return root ? scheduleRefresh(root.path) : false;
}

/**
 * At start: the project folders with a graph are read again, one after the
 * other (sessions herdr-core kept running may have written there).
 */
function refreshProjectFolders() {
  const roots = [];
  for (const project of db.listProjects()) {
    const root = projectFolder(project.id);
    const owner = root && refreshOwner(root.path);
    if (owner) roots.push({ owner, path: root.path });
  }
  const run = roots.reduce((chain, r) => chain.then(() => index(r.owner, r.path, { kind: 'refresh', wait: true })
    .catch((err) => log.warn?.('[knowledge] refresh failed', r.path, err.message))), Promise.resolve());
  return { count: roots.length, done: run };
}

/**
 * Keep the git watcher (git-graph-service.js) of those folders running, so its
 * 'git-graph-repo-changed' reaches scheduleRefresh. Called at start, when
 * settings or indexes change, and every few minutes (an idle watch stops).
 */
function watchEnabledFolders() {
  if (!watchRepo) return [];
  const folders = watchedFolders();
  for (const folder of folders) {
    try { Promise.resolve(watchRepo(folder)).catch(() => {}); } catch {}
  }
  return folders;
}

function startWatching() {
  watchEnabledFolders();
  if (keepAlive) return;
  keepAlive = setInterval(watchEnabledFolders, WATCH_KEEPALIVE_MS);
  keepAlive.unref?.();
}

function stopWatching() {
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
}

/** Remove a folder's code graph from CBM (its ADR too). The name stays for the next index. */
async function deleteIndex(projectId, folderPath) {
  requireFolder(projectId, folderPath);
  const name = knownName(projectId, folderPath);
  const result = await client.call('delete_project', { project: name });
  jobs.delete(folderPath);
  const pendingTimer = refreshTimers.get(folderPath);
  if (pendingTimer) { timers.clearTimeout(pendingTimer); refreshTimers.delete(folderPath); }
  // No graph any more: no refresh brings it back, and the brief stops naming it.
  markIndexed(folderPath, false);
  moduleCache.delete(folderPath);
  for (const id of projectsWithFolder(folderPath)) { changed(id, folderPath, 'deleted'); briefChanged(id); }
  // A folder around it reads its files again.
  reconcileSoon();
  return { ok: true, result };
}

// --- Worktrees: a graph of their own while they are in a project ---

/**
 * A folder joined a project or left it (projects.js onFolderChange). One that
 * joins a project with the graph on is indexed; a worktree as a CBM project
 * of its own (a Lens project too). A worktree that leaves, removed or only
 * detached, loses its graph; any other folder keeps it. A folder is read
 * after the deletes asked before it, so a worktree that moves keeps its name.
 */
function folderChanged({ projectId, folder, change } = {}) {
  if (!projectId || !folder || typeof folder.path !== 'string') return;
  if (change === 'detached') {
    // A worktree, or a folder inside another folder of the tab (whose graph
    // takes its files back), loses its graph once no project has it.
    if (folder.mode === 'worktree' || insideAnotherFolder(folder.path)) {
      forgetting = forgetting.then(() => forgetFolder(projectId, folder.path))
        .catch((err) => log.warn?.('[knowledge] could not delete a folder\'s graph', folder.path, err.message));
    }
    reconcileSoon();
    return;
  }
  if (change === 'attached' && settingsFor(projectId).enabled) autoIndex(projectId, folder.path);
}

/** The folder sits inside another folder of the tab (of any project). */
function insideAnotherFolder(folderPath) {
  const real = realOrResolved(folderPath);
  for (const other of allKnowledgeFolders().keys()) {
    if (other !== folderPath && isInsidePath(real, realOrResolved(other))) return true;
  }
  return false;
}

/**
 * Index a folder of a project with the graph on, when CBM is there: one
 * folder after the other, each once the deletes asked before it are done.
 * Skipped when, by its turn, the folder left or the graph was turned off.
 */
function autoIndex(projectId, folderPath) {
  const found = client.refresh();
  if (!found || !found.ok) return autoIndexing;
  const deletes = forgetting;
  autoIndexing = autoIndexing.then(() => deletes).then(() => {
    if (!settingsFor(projectId).enabled || !folderRow(projectId, folderPath)) return null;
    return index(projectId, folderPath, { wait: true });
  }).catch((err) => log.warn?.('[knowledge] could not index a folder that joined', folderPath, err.message));
  return autoIndexing;
}

function orphans() {
  const raw = db.getSetting(ORPHANS_KEY);
  return Array.isArray(raw) ? raw.filter(o => o && cleanName(o.name)).map(o => ({ name: o.name, path: typeof o.path === 'string' ? o.path : null })) : [];
}

function saveOrphans(list) {
  db.setSetting(ORPHANS_KEY, list.slice(-ORPHANS_MAX));
}

function dropFolder(projectId, folderPath) {
  const s = settingsFor(projectId);
  let dropped = false;
  for (const key of ['names', 'indexed', 'share', 'worktrees']) {
    if (folderPath in s[key]) { delete s[key][folderPath]; dropped = true; }
  }
  if (dropped) saveSettings(projectId, s);
}

/** Delete a graph from CBM, once a job still reading the folder ends. False when CBM did not take it: the name is kept for later. */
async function deleteGraph(name, folderPath) {
  const running = jobs.get(folderPath);
  if (running && !JOB_DONE.has(running.state)) {
    running.again = false;
    let timer = null;
    await Promise.race([
      Promise.resolve(running.done).catch(() => {}),
      new Promise(r => { timer = timers.setTimeout(r, FORGET_WAIT_MS); }),
    ]);
    timers.clearTimeout(timer);
  }
  const pendingTimer = refreshTimers.get(folderPath);
  if (pendingTimer) { timers.clearTimeout(pendingTimer); refreshTimers.delete(folderPath); }
  try {
    await client.call('delete_project', { project: name });
  } catch (err) {
    log.warn?.('[knowledge] the graph stays for now', name, err.message);
    saveOrphans(orphans().filter(o => o.name !== name).concat({ name, path: folderPath }));
    return false;
  }
  jobs.delete(folderPath);
  saveOrphans(orphans().filter(o => o.name !== name));
  return true;
}

/**
 * A folder left a project: its name goes from the project's settings and,
 * when no project has the folder any more, its graph goes from CBM (and from
 * every project's settings). A delete CBM does not take is tried again by
 * sweepOrphans().
 */
async function forgetFolder(projectId, folderPath) {
  const name = settingsFor(projectId).names[folderPath] || null;
  const owners = projectsWithFolder(folderPath);
  let deleted = false;
  if (name && !owners.length) deleted = await deleteGraph(name, folderPath);
  dropFolder(projectId, folderPath);
  if (!owners.length) {
    for (const p of db.listProjects()) if (p.id !== projectId) dropFolder(p.id, folderPath);
  }
  changed(projectId, folderPath, 'forgotten');
  return { ok: true, name, deleted };
}

/**
 * Delete the graphs nothing uses any more: the ones whose delete CBM did not
 * take, and those of folders that left their project while the app could
 * not act (a worktree, or a folder gone from disk). Never a graph a project
 * still has attached. CBM starts only when there is something to delete.
 */
async function sweepOrphans() {
  const stale = [];
  for (const project of db.listProjects()) {
    const s = settingsFor(project.id);
    const own = new Set(knowledgeFolders(project.id).map(f => f.path));
    for (const folder of Object.keys(s.names)) {
      if (own.has(folder)) continue;
      if (s.worktrees[folder] || !fs.existsSync(folder)) stale.push({ projectId: project.id, folder });
    }
  }
  const appGraphs = db.getSetting(APP_GRAPHS_KEY) !== true && !!appCbmDir();
  if (!stale.length && !orphans().length && !appGraphs) return { ok: true, deleted: 0 };
  const found = client.refresh();
  if (!found || !found.ok) return { ok: false, deleted: 0 };
  let deleted = 0;
  if (appGraphs) deleted += await sweepAppGraphs().catch((err) => { log.warn?.('[knowledge] sweep of the app\'s graphs', err.message); return 0; });
  for (const { projectId, folder } of stale) {
    const r = await forgetFolder(projectId, folder).catch((err) => { log.warn?.('[knowledge] sweep', folder, err.message); return null; });
    if (r?.deleted) deleted += 1;
  }
  for (const orphan of orphans()) {
    // A folder took the name again in the meantime: that graph is in use.
    if (assignedNames().taken.has(orphan.name)) {
      saveOrphans(orphans().filter(o => o.name !== orphan.name));
      continue;
    }
    if (await deleteGraph(orphan.name, orphan.path || '')) deleted += 1;
  }
  return { ok: true, deleted };
}

function appCbmDir() {
  const dir = typeof cbmDir === 'function' ? cbmDir() : cbmDir;
  return typeof dir === 'string' && path.isAbsolute(dir) ? dir : null;
}

/**
 * Once: the graphs CBM made of the app's own cbm folder, where the app's CBM
 * session used to start (with auto_index on, CBM reads the folder a session
 * starts in). The session starts in the home folder now, which CBM never indexes.
 */
async function sweepAppGraphs() {
  const dir = appCbmDir();
  if (!dir) return 0;
  let deleted = 0;
  for (const graph of await listProjects()) {
    if (!cleanName(graph.name) || !samePath(graph.root_path, dir)) continue;
    await client.call('delete_project', { project: graph.name });
    deleted += 1;
  }
  db.setSetting(APP_GRAPHS_KEY, true);
  return deleted;
}

// --- One file, one graph: .cbmignore blocks ---

/**
 * The folders that sit inside it and have a graph of their own, relative to
 * it: they are left out of its graph. Across every project, since a folder has
 * one graph whichever project it is in. A folder without a graph (the code
 * graph off in its projects, never indexed) stays in the graph around it.
 */
function foldersToLeaveOut(folderPath, known = allKnowledgeFolders()) {
  const real = realOrResolved(folderPath);
  const out = [];
  for (const entry of known.values()) {
    if (entry.path === folderPath || !entry.indexed) continue;
    const childReal = realOrResolved(entry.path);
    if (!isInsidePath(childReal, real)) continue;
    out.push(path.relative(real, childReal).split(path.sep).join('/'));
  }
  return out.sort();
}

/** A path as an anchored .gitignore pattern for a folder: /a/b c/ with its special characters escaped. */
function ignorePattern(rel) {
  const escaped = rel.split('/').map(seg => seg.replace(/[\\*?[\]]/g, '\\$&').replace(/ +$/, m => m.replace(/ /g, '\\ '))).join('/');
  return `/${escaped}/`;
}

/** The text without this module's block, and whether it had one. */
function stripBlock(text) {
  const lines = String(text).split('\n');
  const start = lines.findIndex(l => l.trim() === IGNORE_START);
  if (start < 0) return { text: String(text), had: false };
  let end = lines.findIndex((l, i) => i > start && l.trim() === IGNORE_END);
  if (end < 0) end = lines.length - 1;
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n').replace(/\n{3,}/g, '\n\n');
  return { text: rest, had: true };
}

function defaultRunGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout || ''));
    });
  });
}

// Folders whose block could not be written, by folder: { reason, inside: [rel] }.
const exclusionIssues = new Map();

/**
 * Keep the block of a folder's .cbmignore that leaves out the folders inside
 * it with a graph of their own. The block is the file's last lines (a rule of
 * the user's after it could not take a folder back), and goes when nothing is
 * left out. A .cbmignore that is a link, or that the repository tracks (the
 * team's rules), is not written: the overlap is reported instead (exclusionIssues).
 * A .cbmignore this module creates in a repository is kept out of git through
 * info/exclude. Resolves { changed }.
 */
async function reconcileFolder(folderPath, known) {
  const inside = foldersToLeaveOut(folderPath, known);
  const file = path.join(folderPath, IGNORE_FILE);
  let stat = null;
  try { stat = fs.lstatSync(file); } catch {}
  if (stat && stat.isSymbolicLink()) {
    if (inside.length) exclusionIssues.set(folderPath, { reason: 'link', inside }); else exclusionIssues.delete(folderPath);
    return { changed: false };
  }
  let text = '';
  if (stat) {
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { changed: false }; }
  }
  const { text: rest, had } = stripBlock(text);
  const block = inside.length ? [IGNORE_START, ...inside.map(ignorePattern), IGNORE_END].join('\n') : '';
  const next = block ? `${rest.trimEnd() ? `${rest.trimEnd()}\n\n` : ''}${block}\n` : rest;
  if (next === text) { exclusionIssues.delete(folderPath); return { changed: false }; }
  if (!block && !had) { exclusionIssues.delete(folderPath); return { changed: false }; }
  const isRepo = fs.existsSync(path.join(folderPath, '.git'));
  if (stat && isRepo && (await runGit(folderPath, ['ls-files', '--error-unmatch', '--', IGNORE_FILE])) != null) {
    if (inside.length) exclusionIssues.set(folderPath, { reason: 'tracked', inside }); else exclusionIssues.delete(folderPath);
    return { changed: false };
  }
  if (!next.trim() && !stat) { exclusionIssues.delete(folderPath); return { changed: false }; }
  if (!next.trim()) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, next, 'utf8');
  if (!stat && isRepo) await keepOutOfGit(folderPath).catch(() => {});
  exclusionIssues.delete(folderPath);
  return { changed: true };
}

/** A new .cbmignore stays out of the repository's changes: info/exclude, unless git ignores it already. */
async function keepOutOfGit(repo) {
  if ((await runGit(repo, ['check-ignore', '-q', '--', IGNORE_FILE])) != null) return;
  const rel = String(await runGit(repo, ['rev-parse', '--git-path', 'info/exclude']) || '').trim();
  if (!rel) return;
  const exclude = path.resolve(repo, rel);
  let text = '';
  try { text = fs.readFileSync(exclude, 'utf8'); } catch {}
  if (text.split('\n').some(l => l.trim() === `/${IGNORE_FILE}` || l.trim() === IGNORE_FILE)) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.writeFileSync(exclude, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# codebase-memory-mcp rules, kept by Switchboard\n/${IGNORE_FILE}\n`, 'utf8');
}

/** Two folders of the tab where one holds the other, and the graph around could not leave the inner one out. */
function overlapping(a, b) {
  const ra = realOrResolved(a);
  const rb = realOrResolved(b);
  const [outer, inner, innerReal, outerReal] = isInsidePath(rb, ra) ? [a, b, rb, ra] : isInsidePath(ra, rb) ? [b, a, ra, rb] : [null];
  if (!outer) return false;
  const issue = exclusionIssues.get(outer);
  if (!issue) return false;
  const rel = path.relative(outerReal, innerReal).split(path.sep).join('/');
  return issue.inside.includes(rel);
}

/**
 * Every folder of the tab with a graph gets its block right; a folder whose
 * block changed is read again (an incremental index drops what is now left
 * out, and takes back what is not). One pass at a time.
 */
function reconcileExclusions() {
  const run = reconciling.then(async () => {
    const known = allKnowledgeFolders();
    const refreshed = [];
    for (const entry of known.values()) {
      if (!entry.indexed) {
        // Its graph comes with its first index, which writes the block first.
        continue;
      }
      let result;
      try { result = await reconcileFolder(entry.path, known); } catch (err) {
        log.warn?.('[knowledge] could not update .cbmignore', entry.path, err.message);
        continue;
      }
      if (!result.changed) continue;
      refreshed.push(entry.path);
      const owner = entry.projectIds.find(id => settingsFor(id).names[entry.path]) || entry.projectIds[0];
      index(owner, entry.path, { kind: 'refresh' }).catch((err) => log.warn?.('[knowledge] refresh failed', entry.path, err.message));
    }
    for (const entry of known.values()) for (const id of entry.projectIds) if (refreshed.includes(entry.path)) changed(id, entry.path, 'exclusions');
    return { ok: true, refreshed };
  });
  reconciling = run.catch(() => {});
  return run;
}

function reconcileSoon() {
  reconcileExclusions().catch((err) => log.warn?.('[knowledge] exclusions', err.message));
}

// --- Repositories inside a folder ---

function hasGitEntry(dir) {
  try { fs.lstatSync(path.join(dir, '.git')); return true; } catch { return false; }
}

/** The git dir a .git file points to (a worktree, a submodule's checkout), resolved; null for a .git directory. */
function gitFileTarget(dir) {
  const entry = path.join(dir, '.git');
  try {
    if (!fs.lstatSync(entry).isFile()) return null;
    const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(entry, 'utf8'));
    return m ? realOrResolved(path.resolve(dir, m[1].trim())) : null;
  } catch { return null; }
}

/**
 * The repositories inside a folder (submodules, clones, checkouts of other
 * repositories), at most MODULE_DEPTH levels down, without going into
 * node_modules and the like or into a repository found. A checkout of the
 * folder's own repository (a worktree of it, e.g. under .claude/worktrees) is
 * the same code, not a module. [{ rel, kind }] and whether the walk stopped short.
 */
async function findModules(folderPath) {
  const root = realOrResolved(folderPath);
  const isRepo = fs.existsSync(path.join(root, '.git'));
  // The folder's own repository (its common git dir, shared by its worktrees).
  const common = isRepo ? String(await runGit(root, ['rev-parse', '--git-common-dir']) || '').trim() : '';
  const ownGit = common ? realOrResolved(path.resolve(root, common)) : null;
  const submodules = new Set();
  if (isRepo && fs.existsSync(path.join(root, '.gitmodules'))) {
    // -z: each entry is "key\nvalue\0" (a submodule's name, in its key, may hold spaces).
    const out = await runGit(root, ['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']);
    for (const entry of String(out || '').split('\0')) {
      const nl = entry.indexOf('\n');
      const rel = nl >= 0 ? entry.slice(nl + 1).trim().replace(/\/+$/, '') : '';
      if (rel && !path.isAbsolute(rel) && !rel.split('/').includes('..')) submodules.add(rel);
    }
  }
  const found = [];
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  let limited = false;
  while (queue.length) {
    if (visited >= MODULE_MAX_DIRS || found.length >= MODULE_MAX) { limited = true; break; }
    const { dir, depth } = queue.shift();
    visited += 1;
    const rel = path.relative(root, dir).split(path.sep).join('/');
    if (depth > 0 && hasGitEntry(dir)) {
      if (submodules.has(rel)) { found.push({ rel, kind: 'submodule' }); continue; }
      const target = gitFileTarget(dir);
      // A worktree of the folder's own repository: its gitdir is under the folder's common git dir.
      const own = target && ownGit && (target === ownGit || isInsidePath(target, ownGit));
      if (!own) found.push({ rel, kind: target ? 'checkout' : 'clone' });
      continue;
    }
    if (depth >= MODULE_DEPTH) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      // A link's dirent is not a directory: links are never followed.
      if (!entry.isDirectory() || entry.name === '.git' || MODULE_SKIP.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      // Hidden folders (tools' own, which CBM leaves out) only when a submodule lives there.
      if (entry.name.startsWith('.') && ![...submodules].some(s => s === childRel || s.startsWith(`${childRel}/`))) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  for (const rel of submodules) {
    if (!found.some(m => m.rel === rel) && fs.existsSync(path.join(root, rel))) found.push({ rel, kind: 'submodule' });
  }
  return { modules: found.sort((a, b) => a.rel.localeCompare(b.rel)), limited };
}

/**
 * The repositories inside a folder of the project, and where their code is:
 *  - 'own': a folder of the tab with a graph of its own (left out of this one);
 *  - 'in': in this folder's graph (gaps: what CBM flagged inside it);
 *  - 'out': in no graph, left out by this folder's rules (ignored by git or
 *    .cbmignore): attach it to give it a graph of its own;
 *  - 'unknown': this folder has no graph yet.
 */
async function modules(projectId, folderPath) {
  requireFolder(projectId, folderPath);
  const { modules: found, limited } = await findModules(folderPath);
  const settings = settingsFor(projectId);
  const name = settings.indexed[folderPath] ? settings.names[folderPath] : null;
  const known = allKnowledgeFolders();
  const knownByReal = new Map([...known.values()].map(e => [realOrResolved(e.path), e]));
  const real = realOrResolved(folderPath);
  const list = found.map((m) => {
    const abs = path.join(folderPath, ...m.rel.split('/'));
    const entry = knownByReal.get(path.join(real, ...m.rel.split('/')));
    const own = entry && entry.indexed;
    return { path: abs, rel: m.rel, kind: m.kind, attached: !!entry, state: own ? 'own' : name ? 'in' : 'unknown', gaps: 0, graph: own ? (namesOf(entry.path) || null) : name };
  });
  const asked = list.filter(m => m.state === 'in');
  for (let i = 0; i < asked.length; i += SCOPES_MAX) {
    const chunk = asked.slice(i, i + SCOPES_MAX);
    let r;
    try { r = await client.call('check_index_coverage', { project: name, scopes: chunk.map(m => m.rel), scope_limit: 50 }); } catch { continue; }
    for (const scope of Array.isArray(r?.scopes) ? r.scopes : []) {
      const m = chunk.find(x => x.rel === (scope.requested_scope || scope.scope));
      if (!m) continue;
      const entries = Array.isArray(scope.entries) ? scope.entries : [];
      if (entries.some(e => e && e.kind === 'not_indexed_dir' && String(e.path || '').replace(/\/+$/, '') === m.rel)) {
        m.state = 'out';
        m.graph = null;
      } else {
        // A repository's own .git is always left out: not a gap in its code.
        m.gaps = entries.filter(e => e && !/(^|\/)\.git\/?$/.test(String(e.path || ''))).length;
      }
    }
  }
  const result = { ok: true, folder: folderPath, modules: list, limited, at: now() };
  const before = JSON.stringify(moduleCache.get(folderPath)?.modules || null);
  moduleCache.set(folderPath, result);
  if (before !== JSON.stringify(list)) for (const id of projectsWithFolder(folderPath)) briefChanged(id);
  return result;
}

/** A folder's CBM name, whichever project named it. */
function namesOf(folderPath) {
  for (const project of db.listProjects()) {
    const n = settingsFor(project.id).names[folderPath];
    if (n) return n;
  }
  return null;
}

// --- ADR and runtime traces ---

function cleanSections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sections must map a heading to its text');
  const out = {};
  for (const [heading, body] of Object.entries(value)) {
    if (typeof body !== 'string') throw new Error('A section\'s text must be a string');
    out[String(heading).slice(0, 200)] = body;
  }
  return out;
}

/** The folder's architecture decision record (kept in CBM's index, not in the repository). */
async function adr(projectId, folderPath, opts = {}) {
  requireFolder(projectId, folderPath);
  const o = opts && typeof opts === 'object' ? opts : {};
  const mode = ADR_MODES.has(o.mode) ? o.mode : 'outline';
  const args = { project: knownName(projectId, folderPath), mode };
  if (Number.isInteger(o.section_limit)) args.section_limit = Math.max(1, Math.min(500, o.section_limit));
  if (Number.isInteger(o.section_offset)) args.section_offset = Math.max(0, o.section_offset);
  if (mode === 'update') {
    if (typeof o.content !== 'string') throw new Error('The decision record\'s text is missing');
    if (Buffer.byteLength(o.content) > ADR_MAX_BYTES) throw new Error(`A decision record holds at most ${ADR_MAX_BYTES} bytes`);
    args.content = o.content;
  }
  if (mode === 'set_sections') {
    args.section_updates = cleanSections(o.section_updates);
  }
  const result = await client.call('manage_adr', args);
  if (mode === 'update' || mode === 'set_sections') changed(projectId, folderPath, 'adr');
  return result;
}

function cleanTrace(item) {
  if (!item || typeof item !== 'object') return null;
  const count = Number.isInteger(item.count) && item.count > 0 ? item.count : 1;
  if (Array.isArray(item.path)) {
    const hops = item.path.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 500));
    if (hops.length < 2) return null;
    return { path: hops.slice(0, TRACE_PATH_MAX), count };
  }
  if (typeof item.caller === 'string' && typeof item.callee === 'string' && item.caller.trim() && item.callee.trim()) {
    return { caller: item.caller.trim().slice(0, 500), callee: item.callee.trim().slice(0, 500), count };
  }
  return null;
}

/** Traces as data: an array of them, or { traces, label }. */
function parseTraces(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.traces) ? data.traces : null;
  if (!list) throw new Error('No traces: expected an array, or an object with "traces"');
  const traces = list.map(cleanTrace).filter(Boolean);
  if (!traces.length) throw new Error('None of the traces has a path of two names or a caller and a callee');
  if (traces.length > TRACES_MAX) throw new Error(`At most ${TRACES_MAX} traces at a time`);
  return { traces, label: typeof data?.label === 'string' ? data.label : null, skipped: list.length - traces.length };
}

/** Traces from a JSON file the user picked in the app's own open dialog (never a path from the renderer or a phone). */
function readTracesFile(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Pick a JSON file');
  if (stat.size > TRACES_FILE_MAX_BYTES) throw new Error('The traces file is larger than 20 MB');
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { throw new Error('The traces file is not JSON'); }
  return parseTraces(data);
}

async function sendTraces(projectId, folderPath, parsed, label) {
  const name = knownName(projectId, folderPath);
  const finalLabel = String(label || parsed.label || 'unlabeled').trim().slice(0, 100) || 'unlabeled';
  const result = await client.call('ingest_traces', { project: name, traces: parsed.traces, label: finalLabel });
  changed(projectId, folderPath, 'traces');
  return { ok: true, label: finalLabel, sent: parsed.traces.length, skipped: parsed.skipped, result };
}

/** Record observed call paths (a profiler, OpenTelemetry spans turned into caller → callee). */
async function ingestTraces(projectId, folderPath, opts = {}) {
  requireFolder(projectId, folderPath);
  const o = opts && typeof opts === 'object' ? opts : {};
  return sendTraces(projectId, folderPath, parseTraces(o.traces), o.label);
}

/** The same from a file: main.js calls it with the path its open dialog returned. */
async function ingestTracesFile(projectId, folderPath, filePath, label) {
  requireFolder(projectId, folderPath);
  knownName(projectId, folderPath);
  return sendTraces(projectId, folderPath, readTracesFile(filePath), label);
}

// --- CBM's own settings and the Lens ---

function defaultRunConfig(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf8', timeout: 15000 }, (err, stdout, stderr) => {
      // `config list` prints the list and still exits 1 on some builds: the text is what counts.
      if (stdout && stdout.trim()) resolve(stdout);
      else if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve('');
    });
  });
}

function parseConfigList(text) {
  const values = {};
  for (const line of String(text).split('\n')) {
    const m = /^\s*([a-z_][a-z0-9_-]*)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

function cleanConfigValue(key, value) {
  const kind = CONFIG_KEYS[key];
  if (!kind) throw new Error(`Unknown setting: ${String(key).slice(0, 60)}`);
  const v = String(value).trim();
  if (Array.isArray(kind)) {
    if (!kind.includes(v)) throw new Error(`${key} takes ${kind.join(', ')}`);
    return v;
  }
  if (kind === 'bool') {
    if (v !== 'true' && v !== 'false') throw new Error(`${key} takes true or false`);
    return v;
  }
  if (kind === 'port') {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('The port must be between 1024 and 65535');
    return String(n);
  }
  if (kind === 'count' || kind === 'limit') {
    if (kind === 'limit' && v === 'off') return v;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${key} takes a whole number${kind === 'limit' ? ' or off' : ''}`);
    // A count past CBM's int would wrap (4294967296 reads as 0): the largest it takes instead.
    if (kind === 'count') return String(Math.min(n, CBM_INT_MAX));
    return String(n);
  }
  throw new Error(`Unknown setting: ${key}`);
}

function requireBinary() {
  const found = client.refresh();
  if (!found) {
    const err = new Error('codebase-memory-mcp is not installed');
    err.code = 'cbm-missing';
    throw err;
  }
  return found;
}

async function getConfig() {
  const found = requireBinary();
  const all = parseConfigList(await runConfig(found.path, ['config', 'list']));
  const values = {};
  for (const key of Object.keys(CONFIG_KEYS)) if (key in all) values[key] = all[key];
  return { ok: true, values, keys: CONFIG_KEYS };
}

async function setConfig(key, value) {
  const clean = cleanConfigValue(key, value);
  const found = requireBinary();
  await runConfig(found.path, ['config', 'set', key, clean]);
  emit('knowledge-changed', { projectId: null, reason: 'config' });
  return getConfig();
}

/**
 * Apply CONFIG_DEFAULTS once: each key still at CBM's own default takes the
 * app's; a key the user set is left alone. Nothing runs once every key is
 * done, or while CBM is missing (the next start, or a download, tries again).
 */
async function applyConfigDefaults() {
  const raw = db.getSetting(CONFIG_DEFAULTS_KEY);
  const done = raw && typeof raw === 'object' ? { ...raw } : {};
  const todo = Object.keys(CONFIG_DEFAULTS).filter(key => done[key] !== true);
  if (!todo.length) return { ok: true, applied: [] };
  const found = client.refresh();
  if (!found || !found.ok) return { ok: false, applied: [] };
  const current = parseConfigList(await runConfig(found.path, ['config', 'list']));
  const applied = [];
  for (const key of todo) {
    const { from, to } = CONFIG_DEFAULTS[key];
    if (!(key in current)) continue; // a CBM that does not list it yet: next time
    if (current[key] === from) {
      try {
        await runConfig(found.path, ['config', 'set', key, to]);
        applied.push(key);
      } catch (err) {
        log.warn?.('[knowledge] could not set', key, err.message);
        continue;
      }
    }
    done[key] = true;
  }
  db.setSetting(CONFIG_DEFAULTS_KEY, done);
  if (applied.length) emit('knowledge-changed', { projectId: null, reason: 'config' });
  return { ok: true, applied };
}

async function probe(url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(LENS_PROBE_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The Lens (CBM's own web UI: the 3D graph, Galaxy, Architecture…) for a
 * folder: where it is and whether it answers. It listens on 127.0.0.1 only,
 * without a login.
 */
async function lens(projectId, folderPath, workspace) {
  requireFolder(projectId, folderPath);
  const { values } = await getConfig();
  const port = Number(values.ui_port) || 9749;
  const base = `http://127.0.0.1:${port}/`;
  const enabled = values.ui_enabled === 'true';
  const reachable = enabled ? await probe(base) : false;
  const name = settingsFor(projectId).names[folderPath] || null;
  const ws = LENS_WORKSPACES.has(workspace) ? workspace : 'galaxy';
  const url = name ? `${base}?project=${encodeURIComponent(name)}&workspace=${ws}` : base;
  return { ok: true, enabled, reachable, port, base, url, project: name, workspace: ws };
}

// --- The project's agents: the brief and the MCP server of their sessions ---

/**
 * The "Code graph" section of the project's managed block (CLAUDE.md,
 * AGENTS.md), for projects with the graph on: the CBM name of each indexed
 * folder and how to use the tools. projects.js asks for it at every sync.
 */
function briefSection(projectId) {
  const s = settingsFor(projectId);
  if (!s.enabled) return '';
  const rows = knowledgeFolders(projectId).filter(f => s.names[f.path] && s.indexed[f.path]);
  // Nothing to name yet (a new project, CBM missing): the section comes with the first graph.
  if (!rows.length) return '';
  const lines = ['## Code graph (codebase-memory-mcp)'];
  const folderCell = (f) => {
    if (f.mode === PROJECT_MODE) return `\`${f.path}\` (project folder: plans, notes, tools)`;
    if (f.mode !== 'worktree') return `\`${f.path}\``;
    const of = f.sourcePath ? ` of \`${f.sourcePath}\`` : '';
    return `\`${f.path}\` (worktree${of}${f.branch ? `, branch \`${f.branch}\`` : ''})`;
  };
  const table = rows.map(f => `| ${folderCell(f)} | \`${s.names[f.path]}\` |`);
  // The repositories inside the folders: in the folder's graph, in a graph of their own, or in none.
  for (const f of rows) {
    const found = moduleCache.get(f.path);
    for (const m of found ? found.modules : []) {
      if (m.state === 'own' && rows.some(r => samePath(r.path, m.path))) continue; // a row of the table already
      const what = m.kind === 'submodule' ? 'submodule' : m.kind === 'checkout' ? 'checkout of another repository' : 'repository';
      const where = m.state === 'own' ? (m.graph ? `\`${m.graph}\` (a graph of its own)` : 'a graph of its own')
        : m.state === 'in' ? `in \`${s.names[f.path]}\`` : m.state === 'out' ? 'not indexed: read its files directly' : 'not indexed yet';
      table.push(`| \`${m.path}\` (${what} inside \`${path.basename(f.path)}\`) | ${where} |`);
    }
  }
  lines.push('These folders are indexed by codebase-memory-mcp (CBM), each as a graph of its own, and Switchboard keeps the graphs fresh. A file belongs to one graph: the one of the innermost folder of this table that holds it. Pass that graph\'s name as `project` to every CBM tool.');
  const root = rows.find(f => f.mode === PROJECT_MODE);
  if (root) {
    lines.push('', `Sessions start in the project folder, so CBM's own hints (its session hook, its skill's "the project whose root_path contains your working directory") point at \`${s.names[root.path]}\`: that graph holds plans, notes and tools, not the code. Look for code in the other graphs of this table first.`);
  }
  lines.push('', '| Folder | CBM project |', '|---|---|', ...table, '');
  lines.push('To reach the code a task needs without reading files at random:');
  lines.push('1. `search_graph` (or `search_code` for literal text) in the graph of the folder you work in; for a symbol whose folder you do not know, in each code folder\'s graph of the table, one call each, before anything else;');
  lines.push('2. `trace_path` for who calls it and what it calls, within its graph (`query_graph`, read-only Cypher, for questions over many hops). A call from one folder into another\'s code (an import across folders, into a folder inside it too) is not an edge of either graph: find its callers with `search_code` for the name in the other folders\' graphs;');
  lines.push('3. `get_code_snippet` to read just that symbol;');
  lines.push('4. `check_index_coverage` on the files the answer relies on: read only the line ranges it flags (code CBM\'s parser could not read) and the files it says are not indexed.');
  lines.push('', 'Grep, glob or read whole files only for what the graphs cannot answer: the rows of this table that say "not indexed", the flagged lines, and text that is not code.');
  lines.push('', '`get_architecture` gives a graph\'s layout, `detect_changes` what a change reaches before a commit, and `manage_adr` each folder\'s architecture decisions. A symbol another folder defines is in that folder\'s graph, not missing from yours; paths in the project folder\'s plans and notes belong to the folders of this table.');
  if (rows.some(f => f.mode === 'worktree')) {
    lines.push('', 'A worktree has a graph of its own, of its branch: when you work in a worktree, pass its name, not the main checkout\'s. Switchboard deletes that graph when the worktree leaves the project.');
  }
  const named = rows.filter(f => f.mode !== PROJECT_MODE && !isCopy(projectId, f));
  if (named.length > 1 && s.crossRepo) {
    lines.push('', 'The folders are linked with each other: `query_graph(project, "MATCH (a)-[r:CROSS_HTTP_CALLS]->(b) RETURN a.name, a.file_path, b.name, properties(r)")` finds the calls one makes into another.');
    const failed = Object.keys(linkErrors(projectId)).filter(p => rows.some(f => f.path === p));
    if (failed.length) {
      lines.push(`The last link could not read ${failed.map(p => `\`${p}\``).join(', ')}: calls from there into the other folders may be missing, so look for them with \`search_code\` too.`);
    }
  }
  return lines.join('\n') + '\n';
}

// The block the cbm-setup kit writes under the managed block; the section
// above takes its place, so it goes when the graph is on.
const KIT_BLOCK = /\n*<!-- cbm:start -->[\s\S]*?<!-- cbm:end -->[ \t]*\n?/;

function removeKitBlock(root) {
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const target = path.join(root, file);
    let text;
    try { text = fs.readFileSync(target, 'utf8'); } catch { continue; }
    if (!KIT_BLOCK.test(text)) continue;
    const next = text.replace(KIT_BLOCK, '\n').replace(/\n{3,}$/, '\n');
    if (next !== text) fs.writeFileSync(target, next, 'utf8');
  }
}

function briefChanged(projectId) {
  const project = db.getProject(projectId);
  if (!project) return;
  if (settingsFor(projectId).enabled && project.root) {
    try { removeKitBlock(project.root); } catch (err) { log.warn?.('[knowledge] could not tidy the brief', err.message); }
  }
  Promise.resolve(syncBrief(projectId)).catch((err) => log.warn?.('[knowledge] brief sync failed', err.message));
}

function profileArgs(profile) {
  return profile === 'analysis' || profile === 'scout' ? [`--tool-profile=${profile}`] : [];
}

/** How each agent gets CBM: 'global' (its own config has it), 'session' (Switchboard adds it), or null (no CBM to run). */
function agentsStatus() {
  // ~/.claude.json can be large and is read again only every few seconds.
  if (agentsCache && now() - agentsCache.at < AGENTS_TTL_MS) return agentsCache.value;
  const found = client.refresh();
  const usable = !!(found && found.ok);
  const value = {
    claude: locator.registeredServer() ? 'global' : usable ? 'session' : null,
    codex: locator.codexRegistered() ? 'global' : usable ? 'session' : null,
  };
  agentsCache = { at: now(), value };
  return value;
}

/**
 * What a session of the project needs for CBM's MCP server, for the harness
 * that starts it: nothing when the graph is off or the agent already has the
 * server in its own config; else { mcpConfig } (Claude: a JSON file for
 * --mcp-config) or { mcpServers } (Codex: -c overrides).
 */
function sessionLaunch(projectId, harnessId) {
  if (!projectId) return {};
  const s = settingsFor(projectId);
  if (!s.enabled) return {};
  const found = client.refresh();
  if (!found || !found.ok) return {};
  const args = profileArgs(s.toolProfile);
  const agents = agentsStatus();
  if (harnessId === 'claude') {
    if (agents.claude === 'global') return {};
    const dir = typeof cbmDir === 'function' ? cbmDir() : cbmDir;
    if (!dir) return {};
    const file = path.join(dir, `mcp-${s.toolProfile || 'all'}.json`);
    const config = { mcpServers: { [locator.SERVER_NAME]: { type: 'stdio', command: found.path, args } } };
    const text = JSON.stringify(config, null, 2) + '\n';
    try {
      fs.mkdirSync(dir, { recursive: true });
      let current = null;
      try { current = fs.readFileSync(file, 'utf8'); } catch {}
      if (current !== text) fs.writeFileSync(file, text, { mode: 0o600 });
    } catch (err) {
      log.warn?.('[knowledge] could not write the MCP config', err.message);
      return {};
    }
    return { mcpConfig: file };
  }
  if (harnessId === 'codex') {
    if (agents.codex === 'global') return {};
    return { mcpServers: [{ name: locator.SERVER_NAME, command: found.path, args }] };
  }
  return {};
}

function defaultRunInstall(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim(), error: err ? err.message.split('\n')[0] : null });
    });
  });
}

/**
 * CBM's own installer for the coding agents (MCP registration, skill, hooks,
 * graph agents in every client it finds): `install --dry-run` first lists what
 * it would change; then `install -y` does it.
 */
async function installAgents({ dryRun = true } = {}) {
  const found = requireBinary();
  const result = await runInstall(found.path, dryRun ? ['install', '--dry-run', '-n'] : ['install', '-y']);
  if (!dryRun) {
    agentsCache = null;
    emit('knowledge-changed', { projectId: null, reason: 'agents' });
  }
  return { ok: result.ok, dryRun, output: String(result.output || '').slice(0, 200000), error: result.error || null };
}

// --- The binary ---

/** Download and install the pinned CBM (see cbm-locator.js). */
async function downloadBinary() {
  if (download && !download.error && !download.done) return { ok: true, already: true };
  download = { step: 'download', error: null, done: false };
  emit('knowledge-changed', { projectId: null, reason: 'download' });
  try {
    const installed = await locator.downloadCbm({
      fetchImpl,
      onStep: (step) => { download = { step, error: null, done: false }; emit('knowledge-changed', { projectId: null, reason: 'download' }); },
    });
    download = null;
    agentsCache = null;
    client.reset();
    emit('knowledge-changed', { projectId: null, reason: 'binary' });
    applyConfigDefaults().catch((err) => log.warn?.('[knowledge] could not apply the CBM defaults', err.message));
    return { ok: true, installed };
  } catch (err) {
    download = { step: download?.step || 'download', error: err.message, done: true };
    emit('knowledge-changed', { projectId: null, reason: 'download' });
    throw err;
  }
}

/** The program and the session, for the app's settings (no project needed). */
function binary() {
  return { ok: true, binary: binaryStatus(), client: client.status(), settings: globalSettings() };
}

/** Try the session again (after repeated crashes, or a binary fixed by hand). */
function restart() {
  agentsCache = null;
  client.reset();
  emit('knowledge-changed', { projectId: null, reason: 'binary' });
  return { ok: true, client: client.status() };
}

module.exports = {
  init,
  READ_TOOLS,
  CONFIG_KEYS,
  LENS_WORKSPACES,
  normalizeSettings,
  readOnlyCypher,
  getSettings,
  setSettings,
  settingsFor,
  globalSettings,
  setGlobalSettings,
  nameFor,
  status,
  query,
  compare,
  prompt,
  index,
  indexAll,
  linkCrossRepo,
  scheduleRefresh,
  watchedFolders,
  watchEnabledFolders,
  startWatching,
  stopWatching,
  deleteIndex,
  deleteInnerGraph,
  knowledgeFolders,
  PROJECT_MODE,
  projectCreated,
  projectDeleted,
  sessionEnded,
  refreshProjectFolders,
  reconcileExclusions,
  foldersToLeaveOut,
  ignorePattern,
  modules,
  findModules,
  folderChanged,
  forgetFolder,
  sweepOrphans,
  applyConfigDefaults,
  CONFIG_DEFAULTS,
  adr,
  ingestTraces,
  ingestTracesFile,
  parseTraces,
  getConfig,
  setConfig,
  parseConfigList,
  lens,
  downloadBinary,
  binary,
  briefSection,
  sessionLaunch,
  agentsStatus,
  installAgents,
  restart,
};
