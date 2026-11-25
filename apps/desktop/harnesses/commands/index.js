// The command catalog's built-in commands, one module per CLI (claude.js…).
//
// Each module exports:
//
//   id          the CLI, as in harnesses/index.js
//   SOURCES     [{ id, url }]: the pages it reads. A url with `{tag}` is read
//               at the git tag of a CLI version (tagFor(version)); a source
//               with `run` (and `buildOnly`) is the output of a command of
//               the CLI, run by the build script only: the refresh while the
//               app runs keeps the entries it gave
//   parseDocs(pages, { previous })   { [source id]: text } → catalog entries
//   sanity(entries)    → messages, empty when the entries look right
//   tagFor(version)    optional, for `{tag}` urls
//
// The snapshot packed with the app (public/command-catalog.generated.json) is
// written by scripts/build-command-catalog.mjs with buildCli(); the refresh at
// run time uses the same functions, so both read the docs alike.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const claude = require('./claude');
const codex = require('./codex');
const opencode = require('./opencode');

const MODULES = { [claude.id]: claude, [codex.id]: codex, [opencode.id]: opencode };

const SCHEMA = 1;
const KINDS = new Set(['slash', 'cli', 'flag', 'skill', 'custom', 'mcp', 'shortcut']);
const SOURCES = new Set(['official-docs', 'cli-source', 'cli-completion', 'project', 'user', 'plugin', 'config']);

/** The module of a CLI, or null. */
function commandsOf(cli) {
  return MODULES[cli] || null;
}

/** The CLIs that have a catalog of built-in commands. */
function catalogClis() {
  return Object.keys(MODULES);
}

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

/**
 * A hash of the code that reads a CLI's docs (markdown.js and its module),
 * line endings aside. The snapshot records it, so a change to the parser is
 * a reason to build the snapshot again even when the docs did not change.
 */
function parserHash(cli) {
  const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
  return sha256(read('markdown.js') + read(`${cli}.js`));
}

/** A source's url for a CLI version (`{tag}` filled in); null when it needs a version not given. */
function sourceUrl(cli, source, version) {
  if (!source.url) return null;
  if (!source.url.includes('{tag}')) return source.url;
  const mod = commandsOf(cli);
  return version && mod && mod.tagFor ? source.url.replace('{tag}', mod.tagFor(version)) : null;
}

/**
 * One CLI's part of the snapshot from its pages: { generatedAt, parser,
 * cliVersion?, sources, entries }. `meta` gives each source's Last-Modified,
 * when the server sent one; `version` the CLI version the pages are of;
 * `previous` the part to keep a build-only source's entries from when its
 * page is not given. Throws when the pages do not pass the sanity check.
 */
function buildCli(cli, pages, { now = new Date(), meta = {}, version, previous } = {}) {
  const mod = commandsOf(cli);
  if (!mod) throw new Error(`No command catalog for ${cli}`);
  const sources = {};
  for (const source of mod.SOURCES) {
    if (typeof pages[source.id] !== 'string') {
      const kept = source.buildOnly && previous && previous.sources && previous.sources[source.id];
      if (!kept) throw new Error(`${cli}: page ${source.id} is missing`);
      sources[source.id] = kept;
      continue;
    }
    const url = sourceUrl(cli, source, version);
    sources[source.id] = { ...(url ? { url } : { run: (source.run || []).join(' ') }), sha256: sha256(pages[source.id]) };
    if (meta[source.id] && meta[source.id].lastModified) sources[source.id].lastModified = meta[source.id].lastModified;
  }
  const entries = mod.parseDocs(pages, { previous });
  const problems = mod.sanity(entries);
  if (problems.length) throw new Error(`${cli}: the docs do not read as expected:\n  ${problems.join('\n  ')}`);
  const cliVersion = version || (previous && previous.cliVersion);
  return { generatedAt: now.toISOString(), parser: parserHash(cli), ...(cliVersion ? { cliVersion } : {}), sources, entries };
}

/**
 * Is a CLI's part built from the same pages as `pages` (same hashes), by the
 * same parser? Only the pages given are compared (a build-only one may not be).
 */
function samePages(part, cli, pages) {
  const mod = commandsOf(cli);
  if (!part || !part.sources || !mod || part.parser !== parserHash(cli)) return false;
  const given = mod.SOURCES.filter((s) => typeof pages[s.id] === 'string');
  return given.length > 0 && given.every((s) => part.sources[s.id] && part.sources[s.id].sha256 === sha256(pages[s.id]));
}

/** What is wrong with a snapshot, as messages; empty when it can be used. */
function validateSnapshot(snapshot) {
  const problems = [];
  if (!snapshot || snapshot.schema !== SCHEMA) return [`schema is not ${SCHEMA}`];
  for (const [cli, part] of Object.entries(snapshot.clis || {})) {
    const mod = commandsOf(cli);
    if (!mod) { problems.push(`${cli}: unknown CLI`); continue; }
    if (!part || !Array.isArray(part.entries)) { problems.push(`${cli}: no entries`); continue; }
    for (const e of part.entries) {
      const where = `${cli}: ${e && e.id}`;
      if (!e || typeof e.id !== 'string' || !e.id.startsWith(`${cli}:`)) problems.push(`${where}: bad id`);
      else if (e.cli !== cli) problems.push(`${where}: cli is ${e.cli}`);
      if (!KINDS.has(e.kind)) problems.push(`${where}: kind ${e.kind}`);
      if (!SOURCES.has(e.source)) problems.push(`${where}: source ${e.source}`);
      for (const key of ['command', 'name', 'description']) if (typeof e[key] !== 'string' || !e[key]) problems.push(`${where}: no ${key}`);
    }
    problems.push(...mod.sanity(part.entries).map((p) => `${cli}: ${p}`));
  }
  return problems;
}

/** The snapshot as JSON with one entry per line, so a change in the docs is a readable diff. */
function serializeSnapshot(snapshot) {
  const lines = ['{', `  "schema": ${JSON.stringify(snapshot.schema)},`, '  "clis": {'];
  const clis = Object.keys(snapshot.clis).sort();
  clis.forEach((cli, i) => {
    const part = snapshot.clis[cli];
    lines.push(`    ${JSON.stringify(cli)}: {`);
    lines.push(`      "generatedAt": ${JSON.stringify(part.generatedAt)},`);
    lines.push(`      "parser": ${JSON.stringify(part.parser)},`);
    if (part.cliVersion) lines.push(`      "cliVersion": ${JSON.stringify(part.cliVersion)},`);
    lines.push(`      "sources": ${JSON.stringify(part.sources)},`);
    lines.push('      "entries": [');
    part.entries.forEach((e, j) => lines.push(`        ${JSON.stringify(e)}${j < part.entries.length - 1 ? ',' : ''}`));
    lines.push('      ]');
    lines.push(`    }${i < clis.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}

module.exports = { SCHEMA, commandsOf, catalogClis, buildCli, samePages, sourceUrl, validateSnapshot, serializeSnapshot, sha256, parserHash };
