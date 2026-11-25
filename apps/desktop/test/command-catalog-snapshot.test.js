// The snapshot packed with the app (public/command-catalog.generated.json,
// written by scripts/build-command-catalog.mjs) and the functions that build it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../harnesses/commands');
const claude = require('../harnesses/commands/claude');

const FILE = path.join(__dirname, '..', 'public', 'command-catalog.generated.json');
const snapshot = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('the packed snapshot is valid and has every CLI with a catalog', () => {
  assert.deepEqual(catalog.validateSnapshot(snapshot), []);
  for (const cli of catalog.catalogClis()) assert.ok(snapshot.clis[cli], cli);
});

test('the packed snapshot was built by the parser as it is now', () => {
  for (const cli of catalog.catalogClis()) {
    assert.equal(snapshot.clis[cli].parser, catalog.parserHash(cli),
      `${cli}: the parser changed since the snapshot was built; run npm run build-command-catalog in apps/desktop`);
  }
});

test('the packed snapshot is written as the build script writes it', () => {
  assert.equal(fs.readFileSync(FILE, 'utf8'), catalog.serializeSnapshot(snapshot));
});

test('every command named in a CLI\'s flags is one of its slash commands', () => {
  for (const cli of catalog.catalogClis()) {
    const names = new Set(snapshot.clis[cli].entries.filter((e) => e.kind === 'slash')
      .flatMap((e) => [e.name.split(' ')[0], ...(e.aliases || [])]));
    assert.deepEqual(catalog.commandsOf(cli).flaggedNames().filter((n) => !names.has(n)), [], cli);
  }
  assert.ok(claude.flaggedNames().length > 10);
});

test('no two entries share a name or an alias within a kind (a subcommand\'s flags among themselves)', () => {
  for (const [cli, part] of Object.entries(snapshot.clis)) {
    for (const kind of ['slash', 'flag']) {
      const seen = new Map();
      for (const e of part.entries.filter((x) => x.kind === kind)) {
        for (const n of [e.name, ...(e.aliases || [])].map((name) => `${e.group || ''} ${name}`)) {
          assert.ok(!seen.has(n), `${cli} ${kind} ${n}: ${seen.get(n)} and ${e.id}`);
          seen.set(n, e.id);
        }
      }
    }
  }
});

test('buildCli refuses pages that do not read as expected, and records their hashes', () => {
  const pages = { commands: '# Commands\n', 'cli-reference': '', 'interactive-mode': '' };
  assert.throws(() => catalog.buildCli('claude', pages), /do not read as expected/);
  assert.throws(() => catalog.buildCli('claude', { commands: '' }), /cli-reference is missing/);
  assert.throws(() => catalog.buildCli('nope', {}), /No command catalog/);
  assert.equal(catalog.samePages(snapshot.clis.claude, 'claude', pages), false);
  assert.equal(catalog.sha256('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});

test('validateSnapshot names what is wrong', () => {
  assert.deepEqual(catalog.validateSnapshot({ schema: 0 }), ['schema is not 1']);
  const broken = { schema: 1, clis: { claude: { entries: [{ id: 'codex:x', cli: 'claude', kind: 'thing', source: 'web', command: '/x', name: 'x', description: 'd' }] } } };
  const problems = catalog.validateSnapshot(broken);
  assert.ok(problems.includes('claude: codex:x: bad id'));
  assert.ok(problems.includes('claude: codex:x: kind thing'));
  assert.ok(problems.includes('claude: codex:x: source web'));
  assert.ok(catalog.validateSnapshot({ schema: 1, clis: { other: { entries: [] } } }).includes('other: unknown CLI'));
});
