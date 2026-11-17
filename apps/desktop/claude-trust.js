// claude-trust.js — Remember that Claude Code may work in a project's attached folders.
//
// Switchboard passes every attached folder to `claude` as --add-dir. Claude Code
// asks "Adding a new directory … Is this a directory you created or one you
// trust?" for each one it does not trust, and that answer only lasts for the
// session, so the question came back with every new session. Claude keeps the
// lasting answer in its global config (~/.claude.json, or .claude.json in
// CLAUDE_CONFIG_DIR) as projects[<folder>].hasTrustDialogAccepted, the same
// record it writes when it is started in a folder and the user trusts it there.
//
// Which record counts, as Claude Code 2.1.326 reads it:
// - a folder inside a git repository is keyed by the repository's root;
// - otherwise by the folder itself (its real path);
// - a trusted parent also counts, but for a folder inside a repository the
//   search stops at the repository's root.
// Claude saves the file under a proper-lockfile lock (<file>.lock, a directory)
// and reads it again before every write, so a write made under the same lock,
// replacing the file atomically, is kept.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LOCK_STALE_MS = 10000;
const LOCK_WAIT_MS = 100;
const LOCK_TRIES = 60;

// The shape Claude Code gives a project it has not seen before.
const DEFAULT_PROJECT = Object.freeze({
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasTrustDialogAccepted: false,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
});

function configPath(env = process.env) {
  return env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(os.homedir(), '.claude.json');
}

/** A path as Claude Code writes it in projects: real, and with forward slashes on Windows. */
function configKey(p) {
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
}

function realPath(p) {
  try { return fs.realpathSync(path.resolve(p)); } catch { return null; }
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], {
      timeout: 5000,
      env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
    }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/**
 * Where a folder sits: its real path and, inside a git repository, the
 * repository's root and, for a linked worktree, the main checkout's root.
 */
async function locate(folder) {
  const real = realPath(folder);
  if (!real) return null;
  const out = await runGit(real, ['rev-parse', '--show-toplevel', '--git-common-dir']);
  if (!out) return { real, repoRoot: null, mainRoot: null };
  const [top, common] = out.split(/\r?\n/);
  const repoRoot = top ? realPath(top) : null;
  let mainRoot = null;
  if (common) {
    const commonDir = path.resolve(real, common);
    if (path.basename(commonDir) === '.git') mainRoot = realPath(path.dirname(commonDir));
  }
  return { real, repoRoot, mainRoot: mainRoot && mainRoot !== repoRoot ? mainRoot : null };
}

/**
 * The records to write for a folder: the repository's root (or the folder
 * itself outside a repository), plus the main checkout of a linked worktree,
 * which Claude treats as the same repository. A record too many is harmless.
 */
async function trustKeysFor(folder) {
  const where = await locate(folder);
  if (!where) return [];
  const keys = [where.repoRoot || where.real];
  if (where.mainRoot) keys.push(where.mainRoot);
  return [...new Set(keys)].map(configKey);
}

function readConfig(file = configPath()) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function accepted(config, key) {
  return config?.projects?.[key]?.hasTrustDialogAccepted === true;
}

/** Whether Claude Code already trusts a folder, read the way it reads it. */
async function isTrusted(folder, config) {
  const where = await locate(folder);
  if (!where) return true; // A folder that is gone gets no question either way.
  const keys = [where.repoRoot || where.real, where.mainRoot].filter(Boolean).map(configKey);
  if (keys.some(key => accepted(config, key))) return true;
  // A trusted parent counts, up to the repository's root inside a repository.
  const stop = where.repoRoot;
  let dir = where.real;
  while (true) {
    if (accepted(config, configKey(dir))) return true;
    if (stop && dir === stop) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** The attached folders Claude Code would ask about. Never throws: an unreadable config asks about none. */
async function untrustedFolders(folders, { file = configPath() } = {}) {
  let config;
  try { config = readConfig(file); } catch { return []; }
  const list = [...new Set((folders || []).filter(Boolean))];
  const checks = await Promise.all(list.map(folder => isTrusted(folder, config)));
  return list.filter((_, i) => !checks[i]);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Take the lock Claude Code takes on its config (proper-lockfile: a directory next to it). */
async function withLock(file, fn) {
  const lock = `${file}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try { stale = Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS; } catch { continue; }
      if (stale) {
        try { fs.rmdirSync(lock); } catch {}
        continue;
      }
      if (attempt >= LOCK_TRIES) throw new Error('Claude Code\'s config is locked');
      await sleep(LOCK_WAIT_MS);
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.rmdirSync(lock); } catch {}
  }
}

/**
 * Record that Claude Code may work in these folders, as if it had been started
 * in each one and the user had trusted it there. Resolves { ok, keys } with the
 * records it added, or { error }. Never writes a config it cannot read.
 */
async function recordTrust(folders, { file = configPath() } = {}) {
  try {
    const home = realPath(os.homedir());
    const keys = new Set();
    for (const folder of [...new Set((folders || []).filter(Boolean))]) {
      for (const key of await trustKeysFor(folder)) {
        // Claude never keeps a record for the home folder or the disk's root.
        if (key === configKey(home || '') || key === path.parse(key).root || key === '/') continue;
        keys.add(key);
      }
    }
    if (!keys.size) return { ok: true, keys: [] };
    const target = realPath(file);
    if (!target) return { error: `${file} does not exist` };
    return await withLock(target, () => {
      const config = readConfig(target);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Unexpected config format');
      const projects = config.projects && typeof config.projects === 'object' ? config.projects : {};
      const added = [];
      for (const key of keys) {
        if (accepted({ projects }, key)) continue;
        const existing = projects[key] && typeof projects[key] === 'object' ? projects[key] : DEFAULT_PROJECT;
        projects[key] = { ...existing, hasTrustDialogAccepted: true };
        added.push(key);
      }
      if (!added.length) return { ok: true, keys: [] };
      config.projects = projects;
      const mode = fs.statSync(target).mode & 0o777;
      const tmp = `${target}.switchboard-${process.pid}-${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode });
      fs.renameSync(tmp, target);
      return { ok: true, keys: added };
    });
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  DEFAULT_PROJECT,
  configPath,
  trustKeysFor,
  isTrusted,
  untrustedFolders,
  recordTrust,
};
