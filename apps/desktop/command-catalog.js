// The command catalog of a session: what its CLI understands, for the
// terminal's Commands palette and the phone's sheet.
//
// The CLI's built-in commands come from the snapshot packed with the app
// (public/command-catalog.generated.json, see harnesses/commands/), or from a
// newer copy of the docs when the refresh found one. The user's own skills,
// commands and MCP servers are read from disk for the session's folder
// (claude-local-commands.js), kept ten seconds. The version of the CLI in the
// session says which commands it may be too old for. The entries' shape is
// in packages/shared/command-catalog-model.d.ts.
//
// Everything is read when asked, from memory and small files: opening the
// palette starts no process.

const path = require('path');
const { catalogClis } = require('./harnesses/commands');

const SNAPSHOT = path.join(__dirname, 'public', 'command-catalog.generated.json');
const LOCAL_TTL_MS = 10 * 1000;

/**
 * Built-in entries with the user's own in front: a skill or command named
 * like a built-in command runs instead of it (but not instead of its
 * aliases), so both say so.
 */
function mergeEntries(builtIn, local) {
  if (!local.length) return builtIn;
  const mine = new Map(local.filter((e) => e.kind === 'skill' || e.kind === 'custom').map((e) => [e.name, e]));
  const replaced = new Set();
  const builtins = builtIn.map((e) => {
    const own = e.kind === 'slash' && mine.get(e.name);
    if (!own) return e;
    replaced.add(own.id);
    return { ...e, outputBehavior: `Here ${e.command} runs ${own.source === 'plugin' ? 'a plugin' : 'your'} skill of the same name; its aliases still run this one.` };
  });
  const locals = local.map((e) => (replaced.has(e.id) ? { ...e, outputBehavior: `Runs instead of the built-in ${e.command}.` } : e));
  return [...builtins.filter((e) => e.kind === 'slash'), ...locals, ...builtins.filter((e) => e.kind !== 'slash')];
}

/**
 * `loadSnapshot()` gives the packed snapshot (read once), `refreshed(cli)` a
 * newer part for a CLI or null, `versionsFor(ctx)` the CLI versions of a
 * session (session-version.js), `localScanners[cli](ctx)` the user's own
 * entries for a session's folder.
 */
function createCommandCatalog({
  loadSnapshot = () => require(SNAPSHOT),
  refreshed = () => null,
  versionsFor = () => ({ source: 'unknown' }),
  localScanners = {},
  now = Date.now,
} = {}) {
  let snapshot = null;
  const localCache = new Map();
  const packed = (cli) => {
    if (!snapshot) {
      try { snapshot = loadSnapshot(); } catch { snapshot = { clis: {} }; }
    }
    return (snapshot.clis || {})[cli] || null;
  };

  /** The CLIs that have a catalog. */
  function clis() {
    return catalogClis();
  }

  function localEntries(cli, ctx) {
    const scan = localScanners[cli];
    if (!scan || !ctx.projectPath) return { entries: [] };
    const key = JSON.stringify([cli, ctx.projectPath, ctx.addDirs || []]);
    const hit = localCache.get(key);
    if (hit && now() - hit.at < LOCAL_TTL_MS) return hit.value;
    let value;
    try {
      value = { entries: scan({ cwd: ctx.projectPath, addDirs: ctx.addDirs || [] }) || [] };
    } catch (err) {
      value = { entries: [], note: `Your own commands could not be read: ${err.message}` };
    }
    localCache.set(key, { at: now(), value });
    // Keep the cache small: one entry per folder seen lately.
    if (localCache.size > 50) localCache.delete(localCache.keys().next().value);
    return value;
  }

  function build(cli, target, version, ctx) {
    if (!clis().includes(cli)) return null;
    const newer = refreshed(cli);
    const part = newer || packed(cli);
    const notes = [];
    if (!part) notes.push('The list of built-in commands could not be read.');
    const local = target === 'agent' ? localEntries(cli, ctx) : { entries: [] };
    if (local.note) notes.push(local.note);
    return {
      cli,
      target,
      version,
      docs: {
        generatedAt: part ? part.generatedAt : undefined,
        refreshedAt: newer ? newer.refreshedAt : undefined,
        origin: newer ? 'refreshed' : 'bundled',
      },
      entries: mergeEntries(part ? part.entries : [], local.entries),
      notes: notes.length ? notes : undefined,
    };
  }

  /**
   * The catalog of a session: `ctx` is { runtime, isPlainTerminal,
   * transcript, projectPath, addDirs }. A plain terminal gets the catalog of
   * `cli` (Claude when not given), aimed at a shell; a CLI without a catalog
   * gives null.
   */
  function forSession(ctx = {}, { cli } = {}) {
    if (ctx.isPlainTerminal) {
      const chosen = cli || 'claude';
      return build(chosen, 'terminal', versionsFor({ cli: chosen }), ctx);
    }
    const runtime = ctx.runtime || 'claude';
    return build(runtime, 'agent', versionsFor({ cli: runtime, transcript: ctx.transcript }), ctx);
  }

  return { clis, forSession, packed };
}

module.exports = { createCommandCatalog, mergeEntries };
