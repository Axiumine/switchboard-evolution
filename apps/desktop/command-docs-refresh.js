// The command catalog's refresh of the CLIs' docs while the app runs: the
// snapshot packed with the app (public/command-catalog.generated.json) is as
// old as the release, and the CLIs change more often than that.
//
// At most once a day per CLI, and only when someone opens its catalog, the
// pages of harnesses/commands/<cli>.js are fetched again, in the background:
// a page kept at a release's tag (Codex's source) at the tag of the version
// installed, when it is known. A source that only the build script can make
// (the CLI's own output) keeps the entries it gave.
// The docs' servers send a Last-Modified that is the time of the request, so
// a change is told by the pages' hashes, not by a conditional request. New
// pages go through the same parser and sanity check as the snapshot, and
// must give at least 80% of the entries the snapshot has; then they are kept
// in <cacheDir>/<cli>.json and `emit('command-catalog-updated', { cli })`
// tells the window and the phones. Anything else (offline, a proxy refusing,
// a page that changed its layout) keeps what the catalog already has.
//
// A copy written by another version of the parser is not used: the snapshot
// of that app is then the better one.

const fs = require('fs');
const path = require('path');
const commands = require('./harnesses/commands');

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SHARE = 0.8;

function createDocsRefresher({
  cacheDir,
  fetchImpl = (url, init) => fetch(url, init),
  packed = () => null,
  versionOf = () => null,
  emit = () => {},
  now = Date.now,
  ttlMs = DAY_MS,
  timeoutMs = 10000,
  catalog = commands,
} = {}) {
  const state = new Map(); // cli → { checkedAt, part }
  const running = new Map(); // cli → Promise

  const file = (cli) => path.join(cacheDir, `${cli}.json`);

  function load(cli) {
    if (state.has(cli)) return state.get(cli);
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(file(cli), 'utf8')); } catch {}
    const value = { checkedAt: (saved && saved.checkedAt) || 0, part: (saved && saved.part) || null };
    state.set(cli, value);
    return value;
  }

  function save(cli, value) {
    state.set(cli, value);
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const tmp = `${file(cli)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value));
      fs.renameSync(tmp, file(cli));
    } catch {}
  }

  /** A newer part than the packed one for a CLI, read by this parser; null otherwise. */
  function current(cli) {
    const { part } = load(cli);
    if (!part || part.parser !== catalog.parserHash(cli)) return null;
    const base = packed(cli);
    if (base && base.generatedAt && part.generatedAt && part.generatedAt <= base.generatedAt) return null;
    return part;
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(cli) {
    const mod = catalog.commandsOf(cli);
    if (!mod) return 'skipped';
    const known = load(cli);
    const pages = {};
    const base = current(cli) || packed(cli);
    const version = versionOf(cli) || (base && base.cliVersion) || undefined;
    try {
      for (const source of mod.SOURCES) {
        if (source.buildOnly || !source.url) continue;
        const url = catalog.sourceUrl(cli, source, version);
        if (!url) throw new Error(`no version for ${source.id}`);
        pages[source.id] = await fetchText(url);
      }
    } catch {
      // Offline or refused: try again tomorrow, not at every opening.
      save(cli, { ...known, checkedAt: now() });
      return 'failed';
    }
    if (base && catalog.samePages(base, cli, pages)) {
      save(cli, { ...known, checkedAt: now() });
      return 'unchanged';
    }
    let part;
    try {
      part = catalog.buildCli(cli, pages, { now: new Date(now()), version, previous: base });
    } catch {
      save(cli, { ...known, checkedAt: now() });
      return 'failed';
    }
    const before = base && Array.isArray(base.entries) ? base.entries.length : 0;
    if (before && part.entries.length < before * MIN_SHARE) {
      save(cli, { ...known, checkedAt: now() });
      return 'failed';
    }
    part.refreshedAt = new Date(now()).toISOString();
    save(cli, { checkedAt: now(), part });
    emit('command-catalog-updated', { cli });
    return 'updated';
  }

  /**
   * Fetch a CLI's docs again if the last look is older than a day: resolves
   * 'fresh' (looked lately), 'unchanged', 'updated', 'failed' or 'skipped'.
   * One refresh per CLI at a time.
   */
  function maybeRefresh(cli) {
    if (!catalog.commandsOf(cli)) return Promise.resolve('skipped');
    if (running.has(cli)) return running.get(cli);
    if (now() - load(cli).checkedAt < ttlMs) return Promise.resolve('fresh');
    const job = refresh(cli).catch(() => 'failed').finally(() => running.delete(cli));
    running.set(cli, job);
    return job;
  }

  return { current, maybeRefresh };
}

module.exports = { createDocsRefresher };
