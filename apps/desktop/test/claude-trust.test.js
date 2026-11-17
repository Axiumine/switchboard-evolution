const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  DEFAULT_PROJECT, configPath, trustKeysFor, isTrusted, untrustedFolders, recordTrust,
} = require('../claude-trust');

// Everything happens in a temporary folder with its own config file: the real
// ~/.claude.json is never read or written.
function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-trust-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'claude.json');
  const write = (config) => fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = (...parts) => {
    const p = path.join(temp, ...parts);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  return { temp, file, write, read, dir };
}

function git(cwd, ...args) {
  execFileSync('git', ['-C', cwd, '-c', 'user.email=dev@example.com', '-c', 'user.name=Dev', ...args], { stdio: 'ignore' });
}

function repo(at) {
  fs.mkdirSync(at, { recursive: true });
  git(at, 'init', '-q');
  git(at, 'commit', '-q', '--allow-empty', '-m', 'first');
  return at;
}

test('configPath follows CLAUDE_CONFIG_DIR', () => {
  assert.equal(configPath({ CLAUDE_CONFIG_DIR: '/cfg' }), path.join('/cfg', '.claude.json'));
  assert.equal(configPath({}), path.join(os.homedir(), '.claude.json'));
});

test('trustKeysFor uses the repository root, the folder outside a repository, and the main checkout of a worktree', async t => {
  const { dir, temp } = fixture(t);
  const plain = dir('plain', 'sub');
  const main = repo(path.join(temp, 'app'));
  const inside = dir('app', 'src', 'lib');
  git(main, 'worktree', 'add', '-q', path.join(temp, 'app-feature'));

  assert.deepEqual(await trustKeysFor(plain), [plain]);
  assert.deepEqual(await trustKeysFor(main), [main]);
  assert.deepEqual(await trustKeysFor(inside), [main]);
  assert.deepEqual(await trustKeysFor(path.join(temp, 'app-feature')), [path.join(temp, 'app-feature'), main]);
  assert.deepEqual(await trustKeysFor(path.join(temp, 'missing')), []);
});

test('isTrusted inherits from parents, but not past the root of a repository', async t => {
  const { dir, temp } = fixture(t);
  const plain = dir('workspace', 'notes', 'deep');
  const nested = repo(path.join(temp, 'workspace', 'repo'));
  const workspace = path.join(temp, 'workspace');
  const config = { projects: { [workspace]: { hasTrustDialogAccepted: true } } };

  assert.equal(await isTrusted(plain, config), true);
  assert.equal(await isTrusted(nested, config), false, 'a repository needs its own record');
  assert.equal(await isTrusted(path.join(nested), { projects: { [nested]: { hasTrustDialogAccepted: true } } }), true);
  assert.equal(await isTrusted(dir('workspace', 'repo', 'src'), { projects: { [nested]: { hasTrustDialogAccepted: true } } }), true);
  assert.equal(await isTrusted(plain, { projects: { [workspace]: { hasTrustDialogAccepted: false } } }), false);
  assert.equal(await isTrusted(path.join(temp, 'gone'), {}), true, 'a missing folder never asks');
});

test('untrustedFolders lists only the folders Claude would ask about, and none when the config cannot be read', async t => {
  const { dir, file, write, temp } = fixture(t);
  const trusted = repo(path.join(temp, 'trusted'));
  const fresh = repo(path.join(temp, 'fresh'));
  const plain = dir('plain');
  write({ projects: { [trusted]: { hasTrustDialogAccepted: true } } });

  assert.deepEqual(await untrustedFolders([trusted, fresh, plain, fresh], { file }), [fresh, plain]);
  assert.deepEqual(await untrustedFolders([fresh], { file: path.join(temp, 'nope.json') }), []);
});

test('recordTrust adds full records, keeps everything else and the file mode', async t => {
  const { file, write, read, temp } = fixture(t);
  const app = repo(path.join(temp, 'app'));
  const known = repo(path.join(temp, 'known'));
  write({
    numStartups: 3,
    projects: {
      [known]: { allowedTools: ['Bash'], hasTrustDialogAccepted: false, lastCost: 1.5 },
      '/elsewhere': { hasTrustDialogAccepted: true },
    },
  });

  const result = await recordTrust([path.join(app), known], { file });
  assert.deepEqual(result, { ok: true, keys: [app, known] });
  const config = read();
  assert.equal(config.numStartups, 3);
  assert.deepEqual(config.projects[app], { ...DEFAULT_PROJECT, hasTrustDialogAccepted: true });
  assert.deepEqual(config.projects[known], { allowedTools: ['Bash'], hasTrustDialogAccepted: true, lastCost: 1.5 });
  assert.deepEqual(config.projects['/elsewhere'], { hasTrustDialogAccepted: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(`${file}.lock`), false, 'the lock is released');
  assert.deepEqual(fs.readdirSync(temp).filter(name => name.endsWith('.tmp')), []);

  assert.deepEqual(await recordTrust([app], { file }), { ok: true, keys: [] }, 'nothing to add the second time');
});

test('recordTrust writes the worktree and its main checkout', async t => {
  const { file, write, read, temp } = fixture(t);
  const main = repo(path.join(temp, 'app'));
  const worktree = path.join(temp, 'app-fix');
  git(main, 'worktree', 'add', '-q', worktree);
  write({ projects: {} });

  await recordTrust([worktree], { file });
  assert.equal(read().projects[worktree].hasTrustDialogAccepted, true);
  assert.equal(read().projects[main].hasTrustDialogAccepted, true);
});

test('recordTrust never writes a config it cannot read', async t => {
  const { file, temp, dir } = fixture(t);
  const folder = dir('folder');
  fs.writeFileSync(file, '{ not json');
  const result = await recordTrust([folder], { file });
  assert.ok(result.error);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');

  const missing = await recordTrust([folder], { file: path.join(temp, 'missing.json') });
  assert.ok(missing.error);
  assert.equal(fs.existsSync(path.join(temp, 'missing.json')), false);
});

test('recordTrust waits for a held lock and takes over a stale one', async t => {
  const { file, write, read, dir } = fixture(t);
  const folder = dir('folder');
  write({ projects: {} });

  fs.mkdirSync(`${file}.lock`);
  setTimeout(() => fs.rmdirSync(`${file}.lock`), 250);
  const waited = await recordTrust([folder], { file });
  assert.deepEqual(waited.keys, [folder]);

  const other = dir('other');
  fs.mkdirSync(`${file}.lock`);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(`${file}.lock`, old, old);
  const taken = await recordTrust([other], { file });
  assert.deepEqual(taken.keys, [other]);
  assert.equal(read().projects[other].hasTrustDialogAccepted, true);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});
