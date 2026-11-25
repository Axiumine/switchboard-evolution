// The user's own Codex commands for the command catalog, read from disk the
// way Codex finds them (learn.chatgpt.com/docs/build-skills.md and
// custom-prompts.md):
//
//   skills    .agents/skills/<name>/SKILL.md in the session's folder and each
//             parent up to the repository's root, ~/.agents/skills,
//             /etc/codex/skills, and $CODEX_HOME/skills (the old place);
//             typed as `$name`. `[[skills.config]]` in config.toml switches
//             one off by path or name.
//   prompts   $CODEX_HOME/prompts/*.md, typed as /prompts:<name> (deprecated
//             by Codex, still read)
//   MCP       [mcp_servers.<id>] in $CODEX_HOME/config.toml
//
// Only files are read: no process is started. config.toml is read line by
// line for those two tables only, not as full TOML.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFrontmatter, boolField, projectDirs, readHead, listDir, describe } = require('./claude-local-commands');
const { slug } = require('./harnesses/commands/markdown');
const { safeName } = require('./public/command-catalog-model');

const MAX_ENTRIES = 400;

/** A TOML value as written: a basic or literal string, a boolean, or the raw text. */
function tomlValue(raw) {
  const v = raw.trim();
  let m = /^"((?:[^"\\]|\\.)*)"/.exec(v);
  if (m) return m[1].replace(/\\(["\\])/g, '$1');
  m = /^'([^']*)'/.exec(v);
  if (m) return m[1];
  if (/^true\b/.test(v)) return true;
  if (/^false\b/.test(v)) return false;
  return v.replace(/\s+#.*$/, '');
}

/**
 * The parts of config.toml the catalog uses: the `[[skills.config]]` entries
 * and the `[mcp_servers.<id>]` tables (their sub-tables, like `.env`, skipped).
 */
function readCodexConfig(text) {
  const skills = [];
  const servers = {};
  let at = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^\[\[\s*skills\.config\s*\]\]/.test(trimmed)) { at = {}; skills.push(at); continue; }
    const table = /^\[\s*([^\]]+?)\s*\]/.exec(trimmed);
    if (table) {
      const m = /^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([\w-]+))$/.exec(table[1]);
      at = m ? (servers[m[1] || m[2] || m[3]] = {}) : null;
      continue;
    }
    if (!at) continue;
    const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (kv) at[kv[1]] = tomlValue(kv[2]);
  }
  return { skills, servers };
}

/** Is a skill switched off by `[[skills.config]]`: the last entry that matches it wins. */
function skillOff(rules, file, name) {
  let off = false;
  for (const rule of rules) {
    const matches = (rule.path && path.resolve(rule.path) === path.resolve(file)) || (rule.name && rule.name === name);
    if (matches && typeof rule.enabled === 'boolean') off = !rule.enabled;
  }
  return off;
}

function skillsIn(dir, { source, origin, rules, fsImpl }) {
  const out = [];
  for (const d of listDir(dir, fsImpl)) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const file = path.join(dir, d.name, 'SKILL.md');
    const text = readHead(file, fsImpl);
    if (text === null) continue;
    const { data, body } = readFrontmatter(text, { lenient: true });
    const name = safeName(typeof data.name === 'string' ? data.name.trim() : '') || safeName(d.name);
    if (!name || skillOff(rules, file, name)) continue;
    out.push({
      id: `codex:skill:${slug(source)}:${slug(name)}`,
      cli: 'codex',
      kind: 'skill',
      command: `$${name}`,
      name,
      description: describe(data, body),
      source,
      origin: origin(d.name),
    });
  }
  return out;
}

function promptsIn(dir, fsImpl) {
  const out = [];
  for (const d of listDir(dir, fsImpl)) {
    if (!d.isFile() || !/\.md$/i.test(d.name)) continue;
    const base = safeName(d.name.replace(/\.md$/i, ''));
    if (!base) continue;
    const text = readHead(path.join(dir, d.name), fsImpl);
    if (text === null) continue;
    const { data, body } = readFrontmatter(text, { lenient: true });
    const hint = typeof data['argument-hint'] === 'string' ? data['argument-hint'].trim() : '';
    out.push({
      id: `codex:custom:${slug(base)}`,
      cli: 'codex',
      kind: 'custom',
      command: `/prompts:${base}`,
      name: `prompts:${base}`,
      ...(hint ? { inputArgs: hint.slice(0, 200) } : {}),
      description: describe(data, body),
      source: 'user',
      origin: `~/.codex/prompts/${d.name}`,
    });
  }
  return out;
}

/** Every command of the user's own for a Codex session in `cwd`. */
function scanCodexLocal({ cwd, home = os.homedir(), env = process.env, fsImpl = fs, etc = '/etc/codex/skills' } = {}) {
  const codexHome = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex');
  let config = { skills: [], servers: {} };
  try { config = readCodexConfig(fsImpl.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')); } catch {}
  const rules = config.skills;
  const dirs = projectDirs(cwd, fsImpl, { mainFallback: false });
  const projectDir = dirs[0] || null;

  const found = [];
  for (const dir of dirs) {
    const skills = path.join(dir, '.agents', 'skills');
    found.push(...skillsIn(skills, { source: 'project', origin: (n) => path.relative(projectDir, path.join(skills, n)) || '.', rules, fsImpl }));
  }
  found.push(...skillsIn(path.join(home, '.agents', 'skills'), { source: 'user', origin: (n) => `~/.agents/skills/${n}`, rules, fsImpl }));
  found.push(...skillsIn(path.join(codexHome, 'skills'), { source: 'user', origin: (n) => `~/.codex/skills/${n}`, rules, fsImpl }));
  if (etc) found.push(...skillsIn(etc, { source: 'config', origin: (n) => `${etc}/${n}`, rules, fsImpl }));
  found.push(...promptsIn(path.join(codexHome, 'prompts'), fsImpl));

  // Codex lists two skills of the same name side by side; the catalog keeps
  // the first (the most specific folder), as `$name` picks one anyway.
  const out = [];
  const taken = new Set();
  for (const entry of found) {
    if (taken.has(entry.command) || out.length >= MAX_ENTRIES) continue;
    taken.add(entry.command);
    out.push(entry);
  }
  for (const [id, spec] of Object.entries(config.servers)) {
    const name = safeName(id);
    if (!name || out.length >= MAX_ENTRIES) continue;
    const what = spec.url ? `http ${spec.url}` : spec.command ? `stdio: ${spec.command}` : '';
    out.push({
      id: `codex:mcp:${slug(name)}`,
      cli: 'codex',
      kind: 'mcp',
      command: '/mcp',
      name,
      description: `MCP server${spec.enabled === false ? ', switched off' : ''}${what ? `: ${String(what).slice(0, 160)}` : ''}.`,
      outputBehavior: `/mcp lists the tools of every server; /mcp login ${name} signs in to one that uses OAuth.`,
      source: 'config',
      origin: '~/.codex/config.toml',
    });
  }
  return out;
}

module.exports = { scanCodexLocal, readCodexConfig, skillOff, boolField };
