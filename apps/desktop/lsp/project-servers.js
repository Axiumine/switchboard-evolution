// lsp/project-servers.js — which language servers each project uses.
//
// A project's choice is kept on its row (db.js, column lspServers):
//   { enabled: { [serverId]: true|false }, found: { [serverId]: { files, extensions } }, scanned: [folders] }
// When a folder joins the project (and the first time a project without a
// choice needs one) its languages are detected (lsp/detect.js) and the
// servers for them are turned on. A detection only turns servers on that
// have no choice yet: one the user turned off stays off. The project's
// Settings tab shows every server and changes the choice.
//
// Language servers run code of the project (build scripts, Gradle, MSBuild,
// the project's TypeScript), so they only start for files inside a project's
// folders: the folders the user attached, which the app also marks as
// trusted for Claude Code (claude-trust.js).

const path = require('path');
const { SERVERS, serverById } = require('./servers');
const { detectLanguages, mergeFound } = require('./detect');

const EMPTY = () => ({ enabled: {}, found: {}, scanned: [] });

function within(folder, file) {
  const rel = path.relative(folder, file);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function createProjectServers({ db, detect = detectLanguages, locate = null, log = console } = {}) {
  const pending = new Map(); // projectId → the detection running for it

  function config(projectId) {
    const saved = db.getProjectLspServers(projectId);
    return saved && typeof saved === 'object' ? { ...EMPTY(), ...saved } : null;
  }

  function save(projectId, value) {
    db.setProjectLspServers(projectId, value);
  }

  /** The folders of a project: its own folder and the ones attached to it. */
  function projectFolders(projectId) {
    const project = db.getProject(projectId);
    if (!project) return [];
    return [project.root, ...db.listProjectFolders(projectId).map(f => f.path)].filter(Boolean);
  }

  /**
   * The project folder a file is in, the deepest one when folders nest:
   * { projectId, folder } or null for a file outside every project.
   */
  function folderOf(filePath) {
    if (!filePath || !path.isAbsolute(filePath)) return null;
    let best = null;
    const consider = (projectId, folder) => {
      if (folder && within(folder, filePath) && (!best || folder.length > best.folder.length)) best = { projectId, folder };
    };
    for (const project of db.listProjects()) consider(project.id, project.root);
    for (const row of db.listAllProjectFolders()) consider(row.projectId, row.path);
    return best;
  }

  /** Detect the folders not looked at yet and turn on the servers they need. */
  function ensureDetected(projectId, folders = projectFolders(projectId)) {
    const run = (pending.get(projectId) || Promise.resolve()).then(async () => {
      const current = config(projectId) || EMPTY();
      const todo = folders.filter(f => !current.scanned.includes(f));
      if (!todo.length && config(projectId)) return current;
      let found = current.found;
      for (const folder of todo) {
        try { found = mergeFound(found, await detect(folder)); } catch (err) { log.warn?.(`[lsp] could not look at ${folder}: ${err.message}`); }
      }
      const enabled = { ...current.enabled };
      for (const id of Object.keys(found)) if (enabled[id] === undefined) enabled[id] = true;
      const next = { enabled, found, scanned: [...current.scanned, ...todo] };
      save(projectId, next);
      return next;
    });
    pending.set(projectId, run.catch(() => {}));
    return run;
  }

  /** Look at every folder again ("Detect again"): the counts are new; choices made stay. */
  async function redetect(projectId) {
    const current = config(projectId) || EMPTY();
    save(projectId, { ...current, found: {}, scanned: [] });
    return ensureDetected(projectId);
  }

  /**
   * Whether the project uses `serverId`. Looks first at the folders not seen
   * yet (all of them for a project without a choice, a folder attached while
   * the language servers were switched off).
   */
  async function isEnabled(projectId, serverId) {
    const current = await ensureDetected(projectId);
    return current.enabled[serverId] === true;
  }

  function setEnabled(projectId, serverId, on) {
    if (!serverById(serverId)) return { error: `Unknown language server: ${serverId}` };
    if (!db.getProject(projectId)) return { error: 'Project not found' };
    const current = config(projectId) || EMPTY();
    save(projectId, { ...current, enabled: { ...current.enabled, [serverId]: !!on } });
    return { ok: true };
  }

  /**
   * Every server for the project's Settings: the ones found in its folders
   * first. Each: { id, label, languages, enabled, found, installed, path,
   * install, runsProjectCode, weight }.
   */
  async function summary(projectId, { detect = true } = {}) {
    const current = detect ? await ensureDetected(projectId) : (config(projectId) || EMPTY());
    const rows = await Promise.all(SERVERS.map(async (server) => {
      const located = locate ? await locate(server).catch(() => null) : null;
      return {
        id: server.id,
        label: server.label,
        languages: server.languages.map(l => l.id),
        enabled: current.enabled[server.id] === true,
        found: current.found[server.id] || null,
        installed: !!located,
        path: located ? located.path : null,
        command: located ? located.bin : server.commands[0].bin,
        install: server.install,
        runsProjectCode: !!server.runsProjectCode,
        weight: server.weight,
      };
    }));
    return rows.sort((a, b) => (!!b.found - !!a.found) || (b.found ? b.found.files : 0) - (a.found ? a.found.files : 0) || a.label.localeCompare(b.label));
  }

  return { config, ensureDetected, redetect, isEnabled, setEnabled, summary, folderOf, projectFolders };
}

module.exports = { createProjectServers, within };
