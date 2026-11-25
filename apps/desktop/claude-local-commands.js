// The user's own Claude Code commands for the command catalog, read from
// disk the way Claude Code finds them (code.claude.com/docs/en/skills.md,
// "Choose where skills load" and "How a skill gets its command name"):
//
//   skills     <config>/skills/<name>/SKILL.md (personal), .claude/skills/ in
//              the session's folder and each parent up to the repository's
//              root (project; in a linked worktree with none of its own, the
//              main checkout's), and in each --add-dir folder
//   synced     <config>/skills/synced/<name>/, downloaded from claude.ai
//   commands   .md files under <config>/commands/ and the projects'
//              .claude/commands/ (a subfolder is a `sub:` prefix)
//   plugins    the skills and commands of the plugins installed in
//              <config>/plugins/installed_plugins.json and not switched off
//              in enabledPlugins, as /plugin:name
//   MCP        the servers of ~/.claude.json (user, and the project's own),
//              of the project's .mcp.json: /mcp reconnect <name>
//
// <config> is CLAUDE_CONFIG_DIR, or ~/.claude. Only files are read: no
// process is started, nothing is written. Every name read from a file must
// be a plain one (command-catalog-model.js, safeName), since a pick types it
// into a terminal.

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { firstSentences, slug } = require('./harnesses/commands/markdown');
const { safeName } = require('./public/command-catalog-model');

const HEAD_BYTES = 16 * 1024;
const MAX_ENTRIES = 600;
const MAX_COMMAND_DEPTH = 4;
const RESERVED = /^(synced|anthropic-skills(:.*)?)$/i;

function readHead(file, fsImpl) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fsImpl.readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.toString('utf8', 0, read);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fsImpl.closeSync(fd); } catch {}
  }
}

function readJson(file, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; }
}

function listDir(dir, fsImpl) {
  try { return fsImpl.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function isDir(p, fsImpl) {
  try { return fsImpl.statSync(p).isDirectory(); } catch { return false; }
}

/** The `key: value` lines at the top level of a frontmatter, as written (quotes taken off). */
function plainFields(block) {
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!m || !m[2]) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * The YAML frontmatter of a skill or command file, as an object, only when
 * `---` is the first line, and {} when it does not parse (Claude Code then
 * loads the skill with no fields set). `argument-hint` is taken as written:
 * unquoted, `[env]` is a YAML list. `lenient` reads the plain `key: value`
 * lines when the YAML does not parse, as Codex does with its prompts (its own
 * example, `argument-hint: [FILES=<paths>] [PR_TITLE="<title>"]`, is no YAML).
 */
function readFrontmatter(text, { lenient = false } = {}) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text || ''));
  if (!m) return { data: {}, body: String(text || '') };
  const plain = plainFields(m[1]);
  let data = null;
  try {
    const parsed = yaml.load(m[1], { json: true });
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch {}
  if (!data) return { data: lenient ? plain : {}, body: String(text).slice(m[0].length) };
  data = { ...data };
  if (plain['argument-hint']) data['argument-hint'] = plain['argument-hint'];
  return { data, body: String(text).slice(m[0].length) };
}

/** A frontmatter boolean: true, false, yes, no, on, off, 1, 0, in any case; undefined otherwise. */
function boolField(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  const v = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'off', '0'].includes(v)) return false;
  return undefined;
}

const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** What the skill says it does: its description, or the first line of its text. */
function describe(data, body) {
  const text = oneLine(data.description) || oneLine((String(body).split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '').replace(/^[-*>\s]+/, ''));
  return firstSentences(text, 2) || 'No description.';
}

/**
 * Where a folder sits in git, from the `.git` entries alone: the repository's
 * root (or the linked worktree's), and for a linked worktree the main
 * checkout's root.
 */
function repoOf(dir, fsImpl = fs) {
  let at = path.resolve(dir);
  for (;;) {
    const dotGit = path.join(at, '.git');
    let stat = null;
    try { stat = fsImpl.statSync(dotGit); } catch {}
    if (stat && stat.isDirectory()) return { root: at, mainRoot: null };
    if (stat && stat.isFile()) {
      const m = /gitdir:\s*(.+)/.exec(readHead(dotGit, fsImpl) || '');
      const gitdir = m ? path.resolve(at, m[1].trim()) : '';
      const w = gitdir.split(/[\\/]\.git[\\/]worktrees[\\/]/);
      return { root: at, mainRoot: w.length > 1 ? w[0] : null };
    }
    const parent = path.dirname(at);
    if (parent === at) return { root: null, mainRoot: null };
    at = parent;
  }
}

/**
 * The project folders whose .claude/ load: the session's and each parent up
 * to the repository's root; with `mainFallback`, a linked worktree without
 * .claude/skills of its own adds the main checkout (Claude Code's rule).
 */
function projectDirs(cwd, fsImpl, { mainFallback = true } = {}) {
  if (!cwd) return [];
  const start = path.resolve(cwd);
  const { root, mainRoot } = repoOf(start, fsImpl);
  const dirs = [];
  let at = start;
  for (;;) {
    dirs.push(at);
    if (!root || at === root) break;
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  // A linked worktree without skills of its own loads the main checkout's.
  if (mainFallback && root && mainRoot && !isDir(path.join(root, '.claude', 'skills'), fsImpl)) dirs.push(mainRoot);
  return dirs;
}

function skillEntry({ dir, name: folder, source, origin, prefix = '', fsImpl }) {
  const file = path.join(dir, folder, 'SKILL.md');
  const text = readHead(file, fsImpl);
  if (text === null) return null;
  const { data, body } = readFrontmatter(text);
  if (boolField(data['user-invocable']) === false) return null;
  const own = typeof data.name === 'string' && safeName(data.name.trim()) ? data.name.trim() : folder;
  return makeEntry({ kind: 'skill', name: prefix + own, data, body, source, origin });
}

function makeEntry({ kind, name, data, body, source, origin }) {
  const safe = safeName(name);
  if (!safe) return null;
  const hint = oneLine(data['argument-hint']);
  return {
    id: `claude:${kind}:${slug(source)}:${slug(safe)}`,
    cli: 'claude',
    kind,
    command: `/${safe}`,
    name: safe,
    ...(hint ? { inputArgs: hint.slice(0, 200) } : {}),
    description: describe(data, body),
    source,
    ...(origin ? { origin } : {}),
  };
}

/** The skills in a `skills/` folder: one per subfolder with a SKILL.md. */
function scanSkills(dir, { source, origin, prefix, fsImpl, skip = RESERVED }) {
  const out = [];
  for (const d of listDir(dir, fsImpl)) {
    if (skip && skip.test(d.name)) continue;
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const entry = skillEntry({ dir, name: d.name, source, origin: origin ? origin(d.name) : undefined, prefix, fsImpl });
    if (entry) out.push(entry);
  }
  return out;
}

/** The command files under a `commands/` folder; a subfolder becomes a `sub:` prefix. */
function scanCommands(dir, { source, origin, prefix = '', fsImpl }) {
  const out = [];
  const walk = (at, parts) => {
    if (parts.length > MAX_COMMAND_DEPTH) return;
    for (const d of listDir(at, fsImpl)) {
      const full = path.join(at, d.name);
      if (d.isDirectory()) { walk(full, [...parts, d.name]); continue; }
      if (!/\.md$/i.test(d.name)) continue;
      const base = d.name.replace(/\.md$/i, '');
      if (RESERVED.test(base)) continue;
      const text = readHead(full, fsImpl);
      if (text === null) continue;
      const { data, body } = readFrontmatter(text);
      if (boolField(data['user-invocable']) === false) continue;
      const name = prefix + [...parts, base].join(':');
      const entry = makeEntry({ kind: 'custom', name, data, body, source, origin: origin ? origin([...parts, d.name].join('/')) : undefined });
      if (entry) out.push(entry);
    }
  };
  walk(dir, []);
  return out;
}

/** enabledPlugins merged the way Claude Code merges it: user, then project, then local. */
function enabledPlugins({ configDir, projectDir, fsImpl }) {
  const merged = {};
  const files = [path.join(configDir, 'settings.json')];
  if (projectDir) files.push(path.join(projectDir, '.claude', 'settings.json'), path.join(projectDir, '.claude', 'settings.local.json'));
  for (const file of files) {
    const settings = readJson(file, fsImpl);
    const map = settings && settings.enabledPlugins;
    if (map && typeof map === 'object') Object.assign(merged, map);
  }
  return merged;
}

/** The installed plugins that are on, each with its folder and name. */
function activePlugins({ configDir, projectDir, fsImpl }) {
  const installed = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'), fsImpl);
  const enabled = enabledPlugins({ configDir, projectDir, fsImpl });
  const out = [];
  for (const [key, installs] of Object.entries((installed && installed.plugins) || {})) {
    if (enabled[key] === false) continue;
    const list = Array.isArray(installs) ? installs : [];
    // A project-scope install counts only in its project.
    const install = list.find((i) => i && i.scope !== 'project') || list.find((i) => i && i.projectPath && projectDir && path.resolve(i.projectPath) === path.resolve(projectDir));
    if (!install || !install.installPath || !isDir(install.installPath, fsImpl)) continue;
    const manifest = readJson(path.join(install.installPath, '.claude-plugin', 'plugin.json'), fsImpl) || {};
    const name = safeName(String(manifest.name || key.split('@')[0]));
    if (!name) continue;
    out.push({ key, name, dir: install.installPath, manifest });
  }
  // Plugins synced from a claude.ai organisation: <config>/plugins/synced/<org>/<plugin>/,
  // switched off one by one with "<name>@synced": false (settings-reference.md). Their
  // layout is not documented further, so a folder without a readable manifest is skipped.
  const synced = path.join(configDir, 'plugins', 'synced');
  for (const org of listDir(synced, fsImpl)) {
    if (!org.isDirectory()) continue;
    for (const d of listDir(path.join(synced, org.name), fsImpl)) {
      if (!d.isDirectory()) continue;
      const dir = path.join(synced, org.name, d.name);
      const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json'), fsImpl);
      const name = manifest && safeName(String(manifest.name || ''));
      if (!name || enabled[`${name}@synced`] === false || out.some((p) => p.name === name)) continue;
      out.push({ key: `${name}@synced`, name, dir, manifest });
    }
  }
  return out;
}

const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((p) => typeof p === 'string');

function scanPlugin(plugin, fsImpl) {
  const { name, dir, manifest } = plugin;
  const source = 'plugin';
  const origin = () => name;
  const prefix = `${name}:`;
  const out = [];
  const skillDirs = [path.join(dir, 'skills'), ...asList(manifest.skills).map((p) => path.resolve(dir, p))];
  for (const skills of new Set(skillDirs)) {
    // A path in the manifest can name one skill's folder as well as a folder of skills.
    if (fsImpl.existsSync(path.join(skills, 'SKILL.md'))) {
      const one = skillEntry({ dir: path.dirname(skills), name: path.basename(skills), source, origin: name, prefix, fsImpl });
      if (one) out.push(one);
    } else {
      out.push(...scanSkills(skills, { source, origin, prefix, fsImpl, skip: null }));
    }
  }
  // A single skill at the plugin's root.
  const root = readHead(path.join(dir, 'SKILL.md'), fsImpl);
  if (root !== null) {
    const { data, body } = readFrontmatter(root);
    const own = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : path.basename(dir);
    const entry = makeEntry({ kind: 'skill', name: own.startsWith(prefix) ? own : prefix + own, data, body, source, origin: name });
    if (entry) out.push(entry);
  }
  const commandDirs = [path.join(dir, 'commands'), ...asList(manifest.commands).map((p) => path.resolve(dir, p))];
  for (const commands of new Set(commandDirs)) out.push(...scanCommands(commands, { source, origin, prefix, fsImpl }));
  return out;
}

/** The MCP servers Claude Code would load for a project: the user's, the project's own in ~/.claude.json, its .mcp.json. */
function mcpServers({ configFile, projectDirs: dirs, fsImpl }) {
  const out = [];
  const seen = new Set();
  const add = (servers, scope, origin) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, spec] of Object.entries(servers)) {
      const safe = safeName(name);
      if (!safe || seen.has(safe)) continue;
      seen.add(safe);
      const what = spec && typeof spec === 'object' ? (spec.url ? `${spec.type || 'http'} ${spec.url}` : spec.command ? `stdio: ${spec.command}` : '') : '';
      out.push({
        id: `claude:mcp:${slug(safe)}`,
        cli: 'claude',
        kind: 'mcp',
        command: `/mcp reconnect ${safe}`,
        name: safe,
        acceptedValues: ['reconnect', 'enable', 'disable'],
        description: `MCP server (${scope})${what ? `: ${what.slice(0, 160)}` : ''}.`,
        outputBehavior: `Also /mcp enable ${safe} and /mcp disable ${safe}; /mcp alone lists every server with its state.`,
        source: scope === 'user' ? 'user' : scope === 'project' ? 'project' : 'config',
        ...(origin ? { origin } : {}),
      });
    }
  };
  const config = readJson(configFile, fsImpl);
  const projects = (config && config.projects) || {};
  for (const dir of dirs) {
    const key = process.platform === 'win32' ? dir.replace(/\\/g, '/') : dir;
    add(projects[key] && projects[key].mcpServers, 'local', '~/.claude.json');
  }
  for (const dir of dirs) {
    const mcp = readJson(path.join(dir, '.mcp.json'), fsImpl);
    add(mcp && mcp.mcpServers, 'project', '.mcp.json');
  }
  add(config && config.mcpServers, 'user', '~/.claude.json');
  return out;
}

/**
 * Every command of the user's own for a Claude session, most specific first
 * where Claude Code says one replaces another. `cwd` is the session's folder,
 * `addDirs` the folders given with --add-dir.
 */
function scanClaudeLocal({ cwd, addDirs = [], home = os.homedir(), env = process.env, fsImpl = fs } = {}) {
  const configDir = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  const configFile = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json');
  const dirs = projectDirs(cwd, fsImpl);
  const projectDir = dirs[0] || null;
  const rel = (from) => (p) => path.relative(from, p) || '.';

  const skills = [];
  const commands = [];
  // Personal over project (an enterprise folder is not read: it belongs to the organisation's setup).
  skills.push(...scanSkills(path.join(configDir, 'skills'), { source: 'user', origin: (n) => `~/.claude/skills/${n}`, fsImpl }));
  for (const dir of dirs) {
    skills.push(...scanSkills(path.join(dir, '.claude', 'skills'), { source: 'project', origin: (n) => `${rel(projectDir)(path.join(dir, '.claude', 'skills', n))}`, fsImpl }));
  }
  // An added folder's skill gets the folder's name as a prefix when its name is taken.
  for (const added of addDirs) {
    const prefix = `${path.basename(added)}:`;
    for (const entry of scanSkills(path.join(added, '.claude', 'skills'), { source: 'project', origin: (n) => `${path.basename(added)}/.claude/skills/${n}`, fsImpl })) {
      skills.push(entry);
      entry._addedPrefix = prefix;
    }
  }
  commands.push(...scanCommands(path.join(configDir, 'commands'), { source: 'user', origin: (f) => `~/.claude/commands/${f}`, fsImpl }));
  for (const dir of [...dirs, ...addDirs]) {
    commands.push(...scanCommands(path.join(dir, '.claude', 'commands'), { source: 'project', origin: (f) => `${path.basename(dir)}/.claude/commands/${f}`, fsImpl }));
  }

  const out = [];
  const taken = new Set();
  const take = (entry) => {
    if (!entry || out.length >= MAX_ENTRIES) return;
    let e = entry;
    if (taken.has(e.name) && e._addedPrefix) {
      const name = safeName(e._addedPrefix + e.name);
      e = name ? { ...e, name, command: `/${name}`, id: `${e.id}:${slug(e._addedPrefix)}` } : null;
    }
    if (!e || taken.has(e.name)) return;
    delete e._addedPrefix;
    taken.add(e.name);
    out.push(e);
  };
  skills.forEach(take);
  // A skill wins over a command file of the same name.
  commands.forEach(take);
  // Synced skills keep their short name only while no other command has it.
  for (const entry of scanSkills(path.join(configDir, 'skills', 'synced'), { source: 'user', origin: () => 'claude.ai', fsImpl, skip: null })) {
    take(taken.has(entry.name) ? { ...entry, name: `anthropic-skills:${entry.name}`, command: `/anthropic-skills:${entry.name}`, id: `${entry.id}:synced` } : entry);
  }
  // Plugin skills are namespaced, so they never clash.
  for (const plugin of activePlugins({ configDir, projectDir, fsImpl })) scanPlugin(plugin, fsImpl).forEach(take);
  for (const server of mcpServers({ configFile, projectDirs: dirs, fsImpl })) if (out.length < MAX_ENTRIES) out.push(server);
  return out;
}

module.exports = { scanClaudeLocal, readFrontmatter, boolField, repoOf, projectDirs, enabledPlugins, readHead, listDir, describe };
