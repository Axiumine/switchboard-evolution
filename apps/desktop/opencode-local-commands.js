// The user's own OpenCode commands for the command catalog, read from disk
// the way OpenCode 2 finds them (opencode.ai/docs/commands.md, skills.md,
// mcp-servers.md):
//
//   commands  .md files under <config>/commands/ and the project's
//             .opencode/commands/ (and the old command/ folders), a nested
//             path being a name with `/`; the `commands` key of
//             opencode.json(c). The nearer source replaces the farther one.
//   skills    typed as @id: ~/.claude/skills, .claude/skills, ~/.agents/skills,
//             .agents/skills, <config>/skills, .opencode/skills, the later
//             in that list winning; a <source>/<id>.md file or any
//             <source>/…/<id>/SKILL.md (six levels at most)
//   MCP       mcp.servers of opencode.json(c): /mcps lists them
//
// <config> is $XDG_CONFIG_HOME/opencode, or ~/.config/opencode. Only files are
// read: no process is started.

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonc = require('jsonc-parser');
const { readFrontmatter, projectDirs, readHead, listDir, describe } = require('./claude-local-commands');
const { slug } = require('./harnesses/commands/markdown');
const { safeName } = require('./public/command-catalog-model');

const MAX_ENTRIES = 400;
const MAX_SKILL_DEPTH = 6;
const MAX_COMMAND_DEPTH = 4;

function readJsonc(file, fsImpl) {
  try {
    const value = jsonc.parse(fsImpl.readFileSync(file, 'utf8'), [], { allowTrailingComma: true });
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** The config files of a folder, in the order they load: opencode.json, opencode.jsonc. */
function configFiles(dir) {
  return [path.join(dir, 'opencode.json'), path.join(dir, 'opencode.jsonc')];
}

function commandFiles(dir, { source, origin, fsImpl }) {
  const out = [];
  const walk = (at, parts) => {
    if (parts.length > MAX_COMMAND_DEPTH) return;
    for (const d of listDir(at, fsImpl)) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const full = path.join(at, d.name);
      if (d.isDirectory()) { walk(full, [...parts, d.name]); continue; }
      if (!/\.md$/i.test(d.name)) continue;
      const name = safeName([...parts, d.name.replace(/\.md$/i, '')].join('/'));
      if (!name) continue;
      const text = readHead(full, fsImpl);
      if (text === null) continue;
      const { data, body } = readFrontmatter(text, { lenient: true });
      out.push({ name, description: describe(data, body), source, origin: origin([...parts, d.name].join('/')), agent: typeof data.agent === 'string' ? data.agent : undefined });
    }
  };
  walk(dir, []);
  return out;
}

function jsonCommands(config, { source, origin }) {
  const map = (config && (config.commands || config.command)) || {};
  const out = [];
  for (const [key, spec] of Object.entries(map)) {
    const name = safeName(key);
    if (!name || !spec || typeof spec !== 'object') continue;
    const text = typeof spec.description === 'string' && spec.description.trim()
      ? spec.description
      : typeof spec.template === 'string' ? spec.template.split(/\r?\n/).find((l) => l.trim()) || '' : '';
    out.push({ name, description: describe({ description: text }, ''), source, origin });
  }
  return out;
}

/** The skills of one source folder: <id>.md at its root, or …/<id>/SKILL.md below it. */
function skillsIn(root, { source, origin, fsImpl }) {
  const out = [];
  for (const d of listDir(root, fsImpl)) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    if (d.isFile() && /\.md$/i.test(d.name)) {
      const id = safeName(d.name.replace(/\.md$/i, ''));
      const text = id && readHead(path.join(root, d.name), fsImpl);
      if (text) out.push(skillEntry(id, text, { source, origin: origin(d.name) }));
    }
  }
  const walk = (at, depth) => {
    if (depth > MAX_SKILL_DEPTH) return;
    for (const d of listDir(at, fsImpl)) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
      const dir = path.join(at, d.name);
      const text = readHead(path.join(dir, 'SKILL.md'), fsImpl);
      if (text !== null) {
        // A folder with SKILL.md is one skill: nothing below it is searched.
        const id = safeName(d.name);
        if (id) out.push(skillEntry(id, text, { source, origin: origin(path.relative(root, dir)) }));
        continue;
      }
      walk(dir, depth + 1);
    }
  };
  walk(root, 1);
  return out;
}

function skillEntry(id, text, { source, origin }) {
  const { data, body } = readFrontmatter(text, { lenient: true });
  return { id, description: describe(data, body), source, origin };
}

/** Every command of the user's own for an OpenCode 2 session in `cwd`. */
function scanOpencodeLocal({ cwd, home = os.homedir(), env = process.env, fsImpl = fs } = {}) {
  const configDir = path.join(env.XDG_CONFIG_HOME ? path.resolve(env.XDG_CONFIG_HOME) : path.join(home, '.config'), 'opencode');
  // From the project's root to the session's folder: the nearer replaces the farther.
  const dirs = projectDirs(cwd, fsImpl, { mainFallback: false }).reverse();
  const projectDir = dirs[dirs.length - 1] || null;
  const rel = (p) => (projectDir ? path.relative(projectDir, p) || '.' : p);

  // Commands, lower to higher precedence.
  const commands = new Map();
  const addCommands = (list) => { for (const c of list) commands.set(c.name, c); };
  const globalConfig = configFiles(configDir).map((f) => readJsonc(f, fsImpl)).filter(Boolean);
  for (const config of globalConfig) addCommands(jsonCommands(config, { source: 'user', origin: '~/.config/opencode/opencode.json' }));
  for (const folder of ['command', 'commands']) {
    addCommands(commandFiles(path.join(configDir, folder), { source: 'user', origin: (f) => `~/.config/opencode/${folder}/${f}`, fsImpl }));
  }
  const projectConfigs = [];
  for (const dir of dirs) {
    for (const file of [...configFiles(dir), ...configFiles(path.join(dir, '.opencode'))]) {
      const config = readJsonc(file, fsImpl);
      if (config) projectConfigs.push(config);
      if (config) addCommands(jsonCommands(config, { source: 'project', origin: rel(file) }));
    }
    for (const folder of ['command', 'commands']) {
      const at = path.join(dir, '.opencode', folder);
      addCommands(commandFiles(at, { source: 'project', origin: (f) => rel(path.join(at, f)), fsImpl }));
    }
  }

  // Skills, lower to higher precedence (skills.md, "Precedence").
  const skills = new Map();
  const addSkills = (root, source, origin) => { for (const s of skillsIn(root, { source, origin, fsImpl })) skills.set(s.id, s); };
  addSkills(path.join(home, '.claude', 'skills'), 'user', (p) => `~/.claude/skills/${p}`);
  for (const dir of dirs) addSkills(path.join(dir, '.claude', 'skills'), 'project', (p) => rel(path.join(dir, '.claude', 'skills', p)));
  addSkills(path.join(home, '.agents', 'skills'), 'user', (p) => `~/.agents/skills/${p}`);
  for (const dir of dirs) addSkills(path.join(dir, '.agents', 'skills'), 'project', (p) => rel(path.join(dir, '.agents', 'skills', p)));
  addSkills(path.join(configDir, 'skills'), 'user', (p) => `~/.config/opencode/skills/${p}`);
  for (const dir of dirs) addSkills(path.join(dir, '.opencode', 'skills'), 'project', (p) => rel(path.join(dir, '.opencode', 'skills', p)));

  const out = [];
  for (const c of commands.values()) {
    if (out.length >= MAX_ENTRIES) break;
    out.push({
      id: `opencode:custom:${slug(c.name)}`,
      cli: 'opencode',
      kind: 'custom',
      command: `/${c.name}`,
      name: c.name,
      inputArgs: '[args]',
      description: c.description,
      ...(c.agent ? { outputBehavior: `Runs with the ${c.agent} agent.` } : {}),
      source: c.source,
      origin: c.origin,
    });
  }
  for (const s of skills.values()) {
    if (out.length >= MAX_ENTRIES) break;
    out.push({ id: `opencode:skill:${slug(s.id)}`, cli: 'opencode', kind: 'skill', command: `@${s.id}`, name: s.id, description: s.description, source: s.source, origin: s.origin });
  }
  // MCP servers: the project's over the user's.
  const servers = new Map();
  for (const config of [...globalConfig, ...projectConfigs]) {
    const map = config.mcp && typeof config.mcp === 'object' ? (config.mcp.servers || {}) : {};
    for (const [key, spec] of Object.entries(map)) if (safeName(key) && spec && typeof spec === 'object') servers.set(key, spec);
  }
  for (const [name, spec] of servers) {
    if (out.length >= MAX_ENTRIES) break;
    const what = spec.url ? `${spec.type || 'remote'} ${spec.url}` : Array.isArray(spec.command) ? `local: ${spec.command.join(' ')}` : '';
    out.push({
      id: `opencode:mcp:${slug(name)}`,
      cli: 'opencode',
      kind: 'mcp',
      command: '/mcps',
      name,
      description: `MCP server${spec.disabled ? ', switched off' : ''}${what ? `: ${what.slice(0, 160)}` : ''}.`,
      outputBehavior: '/mcps lists the servers and their state.',
      source: 'config',
      origin: 'opencode.json',
    });
  }
  return out;
}

module.exports = { scanOpencodeLocal };
