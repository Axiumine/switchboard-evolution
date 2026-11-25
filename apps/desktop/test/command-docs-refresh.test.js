// The refresh of the CLIs' docs while the app runs (command-docs-refresh.js),
// with a fake fetch and pages made up to look like Claude Code's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('../harnesses/commands');
const { createDocsRefresher } = require('../command-docs-refresh');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-docs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Pages with `slash` slash commands (the ones sanity asks for among them) and enough of the rest. */
function pages({ slash = 90, extra = '' } = {}) {
  const required = ['clear', 'compact', 'help', 'model', 'exit'];
  const names = [...required, ...Array.from({ length: slash - required.length }, (_, i) => `cmd-${i}`)];
  const commands = ['## All commands', '| Command | Purpose |', '| :- | :- |',
    ...names.map((n) => `| \`/${n}\` | Does ${n}${extra}. |`)].join('\n');
  const cli = ['## CLI commands', '| Command | Description | Example |', '| :- | :- | :- |',
    '| `claude` | Start interactive session | `claude` |',
    '| `claude -p "query"` | Query via SDK, then exit | `claude -p "x"` |',
    ...Array.from({ length: 16 }, (_, i) => `| \`claude sub${i}\` | Sub ${i} | \`claude sub${i}\` |`),
    '## CLI flags', '| Flag | Description | Example |', '| :- | :- | :- |',
    ...['--print', '--model', '--output-format', '--permission-mode', ...Array.from({ length: 40 }, (_, i) => `--flag-${i}`)]
      .map((f) => `| \`${f}\` | Flag ${f} | \`claude ${f}\` |`)].join('\n');
  const keys = ['## Keyboard shortcuts', '### General controls', '| Shortcut | Description | Context |', '| :- | :- | :- |',
    ...Array.from({ length: 12 }, (_, i) => `| \`Ctrl+${String.fromCharCode(65 + i)}\` | Key ${i} | Anywhere |`)].join('\n');
  return { commands, 'cli-reference': cli, 'interactive-mode': keys };
}

const URLS = Object.fromEntries(catalog.commandsOf('claude').SOURCES.map((s) => [s.url, s.id]));

/** A fetch that serves `site` (source id → text), or fails with `error`; records the URLs asked. */
function fakeFetch(site, { error = null, status = 200 } = {}) {
  const asked = [];
  const fn = async (url) => {
    asked.push(url);
    if (error) throw new Error(error);
    return { ok: status === 200, status, text: async () => site[URLS[url]] };
  };
  fn.asked = asked;
  return fn;
}

function setup(t, { site = pages(), packedPages = pages(), clock = { now: Date.UTC(2026, 10, 25, 8) }, fetchOptions } = {}) {
  const cacheDir = tempDir(t);
  const emitted = [];
  const packedPart = catalog.buildCli('claude', packedPages, { now: new Date('2026-11-01T00:00:00Z') });
  const fetchImpl = fakeFetch(site, fetchOptions);
  const refresher = createDocsRefresher({
    cacheDir,
    fetchImpl,
    packed: () => packedPart,
    emit: (...args) => emitted.push(args),
    now: () => clock.now,
  });
  return { refresher, emitted, fetchImpl, cacheDir, clock, packedPart };
}

test('pages like the packed ones change nothing, and are not asked again for a day', async (t) => {
  const { refresher, fetchImpl, emitted, clock } = setup(t);
  assert.equal(await refresher.maybeRefresh('claude'), 'unchanged');
  assert.equal(fetchImpl.asked.length, 3);
  assert.equal(refresher.current('claude'), null);
  assert.equal(await refresher.maybeRefresh('claude'), 'fresh');
  assert.equal(fetchImpl.asked.length, 3);
  clock.now += 25 * 60 * 60 * 1000;
  assert.equal(await refresher.maybeRefresh('claude'), 'unchanged');
  assert.equal(fetchImpl.asked.length, 6);
  assert.deepEqual(emitted, []);
});

test('newer pages are kept, said, and read back by the next run of the app', async (t) => {
  const { refresher, emitted, cacheDir, clock, packedPart } = setup(t, { site: pages({ slash: 95 }) });
  assert.equal(await refresher.maybeRefresh('claude'), 'updated');
  assert.deepEqual(emitted, [['command-catalog-updated', { cli: 'claude' }]]);
  const part = refresher.current('claude');
  assert.equal(part.entries.filter((e) => e.kind === 'slash').length, 95);
  assert.equal(part.refreshedAt, new Date(clock.now).toISOString());
  const again = createDocsRefresher({ cacheDir, packed: () => packedPart, now: () => clock.now });
  assert.equal(again.current('claude').entries.length, part.entries.length);
  assert.equal(await again.maybeRefresh('claude'), 'fresh');
});

test('offline, an error page or a broken layout keep what there is, and wait a day', async (t) => {
  const offline = setup(t, { fetchOptions: { error: 'getaddrinfo ENOTFOUND' } });
  assert.equal(await offline.refresher.maybeRefresh('claude'), 'failed');
  assert.equal(await offline.refresher.maybeRefresh('claude'), 'fresh');
  const notFound = setup(t, { fetchOptions: { status: 404 } });
  assert.equal(await notFound.refresher.maybeRefresh('claude'), 'failed');
  const broken = setup(t, { site: { commands: '# Moved', 'cli-reference': '', 'interactive-mode': '' } });
  assert.equal(await broken.refresher.maybeRefresh('claude'), 'failed');
  assert.equal(broken.refresher.current('claude'), null);
  assert.deepEqual(broken.emitted, []);
});

test('pages that lost too many entries are not used', async (t) => {
  // These pages pass the sanity check, but give 164 entries where the packed snapshot has 274.
  const { refresher, emitted } = setup(t, { packedPages: pages({ slash: 200 }), site: pages({ slash: 90 }) });
  assert.equal(await refresher.maybeRefresh('claude'), 'failed');
  assert.equal(refresher.current('claude'), null);
  assert.deepEqual(emitted, []);
});

test('a copy older than the packed snapshot, or read by another parser, is not used', async (t) => {
  const { refresher, cacheDir, packedPart } = setup(t, { site: pages({ slash: 95 }) });
  await refresher.maybeRefresh('claude');
  const saved = JSON.parse(fs.readFileSync(path.join(cacheDir, 'claude.json'), 'utf8'));
  const newerPacked = { ...packedPart, generatedAt: '2099-01-01T00:00:00.000Z' };
  assert.equal(createDocsRefresher({ cacheDir, packed: () => newerPacked }).current('claude'), null);
  fs.writeFileSync(path.join(cacheDir, 'claude.json'), JSON.stringify({ ...saved, part: { ...saved.part, parser: 'old' } }));
  assert.equal(createDocsRefresher({ cacheDir, packed: () => packedPart }).current('claude'), null);
});

test('one refresh at a time per CLI; a CLI without a catalog is skipped', async (t) => {
  const { refresher, fetchImpl } = setup(t, { site: pages({ slash: 95, extra: ' again' }) });
  const [a, b] = await Promise.all([refresher.maybeRefresh('claude'), refresher.maybeRefresh('claude')]);
  assert.deepEqual([a, b], ['updated', 'updated']);
  assert.equal(fetchImpl.asked.length, 3);
  assert.equal(await refresher.maybeRefresh('nope'), 'skipped');
});
