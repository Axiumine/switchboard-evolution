// knowledge.js — the Node Knowledge tab: a project's attached folders as
// codebase-memory-mcp (CBM) code graphs.
//
// Each attached folder is one CBM project, under a name this module picks
// once and keeps in the project's settings: the name CBM already has for that
// folder when it is indexed (by the agents, by hand), else the folder's name,
// made unique. Every call is about a folder of the project, and the CBM name
// is filled in here: the renderer and the phone never name a CBM project or a
// path to index themselves, so they cannot reach other indexes or folders.
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

const ARGS_MAX_BYTES = 64 * 1024;
// CBM trims answers to 3,200 tokens by default, a budget for a model's context.
// The app shows lists, not prompts: it asks for room unless the caller sets one.
const OUTPUT_TOKENS = 120000;
const ADR_MAX_BYTES = 8000;
const TRACES_FILE_MAX_BYTES = 20 * 1024 * 1024;
const TRACES_MAX = 10000;
const TRACE_PATH_MAX = 256;
const SAVED_QUERIES_MAX = 100;
const NAME_MAX = 80;
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

let db, log, projects, client, locator, emit, runConfig, fetchImpl, now, timers, watchRepo, syncBrief, cbmDir, runInstall;
let keepAlive = null;
const jobs = new Map(); // folderPath → { projectId, name, state, mode, startedAt, finishedAt, error, kind, again }
const refreshTimers = new Map(); // folderPath → timeout
const linking = new Map(); // projectId → the cross-repo link under way
let naming = Promise.resolve(); // names are picked one at a time
let agentsCache = null; // { at, value }
let latestVersion = null;
let latestAsked = false;
let download = null; // { step, error } while a download runs or after it failed

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
  jobs.clear();
  for (const t of refreshTimers.values()) timers.clearTimeout(t);
  refreshTimers.clear();
  linking.clear();
  naming = Promise.resolve();
  agentsCache = null;
  latestVersion = null;
  latestAsked = false;
  download = null;
}

// --- Settings ---

function cleanName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) ? value : null;
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
    const folders = new Set(db.listProjectFolders(projectId).map(f => f.path));
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
  emit('knowledge-changed', { projectId, reason: 'settings' });
  return { ok: true, settings };
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

function requireFolder(projectId, folderPath) {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('Pick one of the project\'s folders');
  return projects.requireAttachedFolder(projectId, folderPath);
}

function folderNameBase(folderPath) {
  const base = path.basename(folderPath).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/-+$/, '');
  return (base || 'repo').slice(0, NAME_MAX - 4);
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
  const { byFolder, taken } = assignedNames();
  let name = byFolder.get(folderPath) || null;
  if (!name) {
    const indexed = listed || await listProjects();
    const existing = indexed.find(p => samePath(p.root_path, folderPath));
    if (existing && cleanName(existing.name)) name = existing.name;
    else {
      for (const p of indexed) taken.add(p.name);
      const base = folderNameBase(folderPath);
      name = base;
      for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    }
  }
  const fresh = settingsFor(projectId);
  fresh.names[folderPath] = name;
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
  const folders = db.listProjectFolders(projectId).map(f => ({
    path: f.path,
    mode: f.mode,
    name: settings.names[f.path] || null,
    shared: !!settings.share[f.path],
    indexed: false,
    index: null,
    job: jobFor(f.path),
    error: null,
  }));
  let error = null;
  if (binary.found && binary.found.ok) {
    try {
      const listed = await listProjects();
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

/** Projects that have this folder attached. */
function projectsWithFolder(folderPath) {
  return db.listProjects().filter(p => db.listProjectFolders(p.id).some(f => f.path === folderPath)).map(p => p.id);
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
  requireFolder(projectId, folderPath);
  const running = jobs.get(folderPath);
  if (running && !JOB_DONE.has(running.state)) {
    // A change while the folder is read: read it again once this job ends.
    if (opts.kind === 'refresh') running.again = true;
    return { ok: true, job: jobFor(folderPath), already: true };
  }
  const settings = settingsFor(projectId);
  const mode = INDEX_MODES.has(opts.mode) ? opts.mode : settings.mode;
  // In the map before anything is awaited, so a second call joins this one.
  const job = { projectId, name: null, state: 'queued', mode, kind: opts.kind === 'refresh' ? 'refresh' : 'index', startedAt: now(), finishedAt: null, error: null, again: false };
  jobs.set(folderPath, job);
  announceJob(folderPath);
  let repoArgs;
  try {
    const name = await nameFor(projectId, folderPath);
    job.name = name;
    repoArgs = { repo_path: folderPath, name };
    const args = { ...repoArgs, mode, async: true };
    if (settings.share[folderPath]) args.persistence = true;
    const started = await client.call('index_repository', args);
    const state = started?.state || started?.status;
    if (typeof state === 'string') job.state = state;
  } catch (err) {
    job.state = 'failed';
    job.error = err.message;
    job.finishedAt = now();
    announceJob(folderPath);
    throw err;
  }
  announceJob(folderPath);
  const done = pollJob(folderPath, job, repoArgs).then(async (finished) => {
    if (finished.state === 'succeeded') {
      const wasIndexed = !!settingsFor(projectId).indexed[folderPath];
      markIndexed(folderPath, true);
      watchEnabledFolders();
      // The brief names the folder once its first graph is there.
      if (!wasIndexed) for (const id of projectsWithFolder(folderPath)) briefChanged(id);
      // Links between folders come with an index asked for, not with each refresh.
      if (finished.kind === 'index' && settingsFor(projectId).crossRepo) {
        await linkCrossRepo(projectId).catch((err) => log.warn?.('[knowledge] cross-repo link failed', err.message));
      }
    }
    if (finished.again) scheduleRefresh(folderPath);
    return finished;
  });
  if (opts.wait) await done;
  else done.catch(() => {});
  return { ok: true, job: jobFor(folderPath) };
}

/** Index every attached folder of the project, one job after the other. */
async function indexAll(projectId, opts = {}) {
  requireProject(projectId);
  const folders = db.listProjectFolders(projectId).map(f => f.path);
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

async function linkNow(projectId) {
  const settings = settingsFor(projectId);
  const folders = db.listProjectFolders(projectId).map(f => f.path).filter(p => settings.names[p] && settings.indexed[p]);
  if (folders.length < 2) return { ok: true, linked: 0 };
  const listed = new Set((await listProjects()).map(p => p.name));
  const indexed = folders.filter(p => listed.has(settings.names[p]));
  if (indexed.length < 2) return { ok: true, linked: 0 };
  const names = indexed.map(p => settings.names[p]);
  let linked = 0;
  for (const folder of indexed) {
    const name = settings.names[folder];
    await client.call('index_repository', { repo_path: folder, name, mode: 'cross-repo-intelligence', target_projects: names.filter(n => n !== name) }, { timeoutMs: 10 * 60 * 1000 });
    linked += 1;
  }
  changed(projectId, null, 'cross-repo');
  return { ok: true, linked };
}

/**
 * Refresh a folder's index soon (its git state moved). Only for projects with
 * the code graph turned on and automatic refresh kept, and only once indexed.
 */
function scheduleRefresh(folderPath) {
  const owner = projectsWithFolder(folderPath).find((id) => {
    const s = settingsFor(id);
    return s.enabled && s.autoRefresh && s.names[folderPath] && s.indexed[folderPath];
  });
  if (!owner) return false;
  const pendingTimer = refreshTimers.get(folderPath);
  if (pendingTimer) timers.clearTimeout(pendingTimer);
  refreshTimers.set(folderPath, timers.setTimeout(() => {
    refreshTimers.delete(folderPath);
    index(owner, folderPath, { kind: 'refresh' }).catch((err) => log.warn?.('[knowledge] refresh failed', err.message));
  }, REFRESH_DEBOUNCE_MS));
  return true;
}

/** The folders whose git state starts a refresh: indexed ones of projects with the graph on. */
function watchedFolders() {
  const out = new Set();
  for (const project of db.listProjects()) {
    const s = settingsFor(project.id);
    if (!s.enabled || !s.autoRefresh) continue;
    for (const f of db.listProjectFolders(project.id)) if (s.names[f.path] && s.indexed[f.path]) out.add(f.path);
  }
  return [...out];
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
  for (const id of projectsWithFolder(folderPath)) { changed(id, folderPath, 'deleted'); briefChanged(id); }
  return { ok: true, result };
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
  const folders = db.listProjectFolders(projectId).map(f => f.path);
  const named = folders.filter(p => s.names[p] && s.indexed[p]);
  const lines = ['## Code graph (codebase-memory-mcp)'];
  if (!named.length) {
    lines.push('The code graph is on for this project, but no attached folder is indexed yet. Index them in Switchboard\'s Node Knowledge tab.');
    return lines.join('\n') + '\n';
  }
  lines.push('The attached folders are indexed by codebase-memory-mcp (CBM), and Switchboard keeps the indexes fresh. Pass these names as `project` to every CBM tool:');
  lines.push('', '| Folder | CBM project |', '|---|---|', ...named.map(p => `| \`${p}\` | \`${s.names[p]}\` |`), '');
  lines.push('Graph first: `search_graph` to find a symbol, `trace_path` for who calls what, `get_code_snippet` to read it, `query_graph` (read-only Cypher) for questions over many hops, `get_architecture` for the layout, and `detect_changes` before a commit to see what a change reaches. Use `search_code` or grep for literal text and for the files `check_index_coverage` flags. Each folder\'s architecture decisions are in `manage_adr`.');
  if (named.length > 1 && s.crossRepo) {
    lines.push('', 'The folders are linked with each other: `query_graph(project, "MATCH (a)-[r:CROSS_HTTP_CALLS]->(b) RETURN a.name, a.file_path, b.name, properties(r)")` finds the calls one makes into another.');
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
