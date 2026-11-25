// The command catalog of a session (command-catalog.js) and the CLI version
// it compares the entries with (session-version.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCommandCatalog } = require('../command-catalog');
const { lastVersionInFile, nativeClaudeVersion, versionsFor } = require('../session-version');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SNAPSHOT = {
  schema: 1,
  clis: {
    claude: {
      generatedAt: '2026-11-25T06:00:00.000Z',
      entries: [{ id: 'claude:slash:compact', cli: 'claude', kind: 'slash', command: '/compact', name: 'compact', description: 'Summarize', source: 'official-docs' }],
    },
  },
};

test('a Claude session gets the packed entries and the version in its transcript', () => {
  const asked = [];
  const catalog = createCommandCatalog({
    loadSnapshot: () => SNAPSHOT,
    versionsFor: (ctx) => { asked.push(ctx); return { session: '2.1.331', source: 'transcript' }; },
  });
  const got = catalog.forSession({ runtime: 'claude', transcript: '/t/s.jsonl' });
  assert.equal(got.cli, 'claude');
  assert.equal(got.target, 'agent');
  assert.deepEqual(got.version, { session: '2.1.331', source: 'transcript' });
  assert.deepEqual(got.docs, { generatedAt: '2026-11-25T06:00:00.000Z', refreshedAt: undefined, origin: 'bundled' });
  assert.equal(got.entries.length, 1);
  assert.deepEqual(asked, [{ cli: 'claude', transcript: '/t/s.jsonl' }]);
  assert.deepEqual(catalog.clis(), ['claude', 'codex', 'opencode']);
});

test('a plain terminal gets a CLI catalog aimed at the shell; a CLI without a catalog gets none', () => {
  const catalog = createCommandCatalog({ loadSnapshot: () => SNAPSHOT });
  assert.equal(catalog.forSession({ isPlainTerminal: true }).target, 'terminal');
  assert.equal(catalog.forSession({ isPlainTerminal: true }).cli, 'claude');
  assert.equal(catalog.forSession({ isPlainTerminal: true }, { cli: 'nope' }), null);
  assert.equal(catalog.forSession({ runtime: 'nope' }), null);
  // No runtime: a Claude session (rows written before the column existed).
  assert.equal(catalog.forSession({}).cli, 'claude');
});

test('a refreshed copy of the docs wins over the packed one; a missing snapshot gives a note', () => {
  const newer = { generatedAt: '2026-11-26T00:00:00.000Z', refreshedAt: '2026-11-26T01:00:00.000Z', entries: [] };
  const catalog = createCommandCatalog({ loadSnapshot: () => SNAPSHOT, refreshed: (cli) => (cli === 'claude' ? newer : null) });
  const got = catalog.forSession({ runtime: 'claude' });
  assert.equal(got.docs.origin, 'refreshed');
  assert.equal(got.docs.refreshedAt, '2026-11-26T01:00:00.000Z');
  const broken = createCommandCatalog({ loadSnapshot: () => { throw new Error('gone'); } });
  const none = broken.forSession({ runtime: 'claude' });
  assert.deepEqual(none.entries, []);
  assert.equal(none.notes.length, 1);
});

test('the packed snapshot loads by default', () => {
  const got = createCommandCatalog().forSession({ runtime: 'claude' });
  assert.ok(got.entries.length > 100);
  assert.equal(got.docs.origin, 'bundled');
});

test('the last version in a transcript, not versions quoted inside messages', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', version: '2.1.319', message: { content: 'x' } }),
    JSON.stringify({ type: 'assistant', version: '2.1.323', message: { content: '{"version":"9.9.9"}' } }),
    '',
  ].join('\n'));
  assert.equal(lastVersionInFile(file), '2.1.323');
  // Only the tail is read: a version earlier than it is not seen.
  const big = path.join(dir, 'big.jsonl');
  fs.writeFileSync(big, `${JSON.stringify({ version: '2.1.1' })}\n${'x'.repeat(200)}\n`);
  assert.equal(lastVersionInFile(big, { tailBytes: 100 }), null);
  assert.equal(lastVersionInFile(big), '2.1.1');
  assert.equal(lastVersionInFile(path.join(dir, 'missing.jsonl')), null);
});

test('the native install link gives the installed version', (t) => {
  const home = tempDir(t);
  assert.equal(nativeClaudeVersion({ home }), null);
  const versions = path.join(home, '.local', 'share', 'claude', 'versions');
  fs.mkdirSync(versions, { recursive: true });
  fs.writeFileSync(path.join(versions, '2.1.332'), '');
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.symlinkSync(path.join(versions, '2.1.332'), path.join(home, '.local', 'bin', 'claude'));
  assert.equal(nativeClaudeVersion({ home }), '2.1.332');
  assert.deepEqual(versionsFor({ cli: 'claude', home }), { installed: '2.1.332', source: 'install' });
  const file = path.join(home, 's.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ version: '2.1.330' })}\n`);
  assert.deepEqual(versionsFor({ cli: 'claude', transcript: file, home }), { session: '2.1.330', installed: '2.1.332', source: 'transcript' });
  assert.deepEqual(versionsFor({ cli: 'codex', home, env: {} }), { source: 'unknown' });
  assert.deepEqual(versionsFor({ cli: 'opencode', home, env: {} }), { source: 'unknown' });
});
