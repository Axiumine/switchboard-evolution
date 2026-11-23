// cbm-locator.js: which codebase-memory-mcp the app runs, and the download
// when there is none. Fake binaries in throwaway folders; the download runs a
// real tar over an archive made here, served by a fake fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const cbm = require('../cbm-locator');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeBin(dir, name = 'codebase-memory-mcp') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\n');
  fs.chmodSync(file, 0o755);
  return file;
}

test('versions are compared part by part', () => {
  assert.deepEqual(cbm.parseVersion('codebase-memory-mcp 0.12.1\n'), [0, 12, 1]);
  assert.equal(cbm.parseVersion('no version'), null);
  assert.equal(cbm.versionAtLeast([0, 12, 1]), true);
  assert.equal(cbm.versionAtLeast([0, 13, 0]), true);
  assert.equal(cbm.versionAtLeast([0, 11, 9]), false);
  assert.equal(cbm.versionAtLeast(null), false);
  assert.equal(cbm.isNewerVersion('0.12.2', '0.12.1'), true);
  assert.equal(cbm.isNewerVersion('0.12.1', '0.12.1'), false);
  assert.equal(cbm.isNewerVersion('1.0.0', '0.99.99'), true);
});

test('the server the agents registered is read from the user-wide mcpServers', (t) => {
  const dir = tmp(t, 'cbm-cfg-');
  const configPath = path.join(dir, '.claude.json');
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: '/x/other' }, 'codebase-memory-mcp': { command: '/opt/tools/codebase-memory-mcp', args: ['--tool-profile=scout'] } } }));
  assert.deepEqual(cbm.registeredServer({ configPath }), { name: 'codebase-memory-mcp', command: '/opt/tools/codebase-memory-mcp', args: ['--tool-profile=scout'] });

  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { graph: { command: '/somewhere/codebase-memory-mcp' } } }));
  assert.equal(cbm.registeredServer({ configPath }).name, 'graph', 'found by the binary name under another server name');

  fs.writeFileSync(configPath, '{ not json');
  assert.equal(cbm.registeredServer({ configPath }), null);
  assert.equal(cbm.registeredServer({ configPath: path.join(dir, 'missing.json') }), null);
});

test('locateCbm: override, settings, the agents\' binary, then the install folder and PATH', (t) => {
  const home = tmp(t, 'cbm-home-');
  const versions = new Map();
  const exec = (bin) => {
    if (!versions.has(bin)) throw new Error('not runnable');
    return `codebase-memory-mcp ${versions.get(bin)}\n`;
  };
  const installed = fakeBin(path.join(home, '.local', 'bin'));
  versions.set(installed, '0.12.1');
  const agents = fakeBin(path.join(home, 'agents'));
  versions.set(agents, '0.12.3');
  const override = fakeBin(path.join(home, 'override'));
  versions.set(override, '0.13.0');
  const base = { home, platform: 'darwin', env: {}, pathEnv: '', exec };

  assert.deepEqual(cbm.locateCbm({ ...base, override, registered: () => ({ command: agents }) }), { path: override, source: 'override', version: '0.13.0', ok: true });
  assert.deepEqual(cbm.locateCbm({ ...base, override: null, configured: agents, registered: () => null }), { path: agents, source: 'settings', version: '0.12.3', ok: true });
  assert.deepEqual(cbm.locateCbm({ ...base, override: null, registered: () => ({ command: agents }) }), { path: agents, source: 'agents', version: '0.12.3', ok: true });
  assert.deepEqual(cbm.locateCbm({ ...base, override: null, registered: () => null }), { path: installed, source: 'installed', version: '0.12.1', ok: true });
});

test('locateCbm skips what does not run, and reports an old one only when nothing newer exists', (t) => {
  const home = tmp(t, 'cbm-home-');
  const versions = new Map();
  const exec = (bin) => {
    if (!versions.has(bin)) throw new Error('not runnable');
    return `codebase-memory-mcp ${versions.get(bin)}`;
  };
  const broken = fakeBin(path.join(home, 'broken'));
  const old = fakeBin(path.join(home, '.local', 'bin'));
  versions.set(old, '0.11.0');
  const onPath = fakeBin(path.join(home, 'path-bin'));
  const base = { home, platform: 'darwin', env: {}, exec, override: null, registered: () => ({ command: broken }) };

  assert.deepEqual(cbm.locateCbm({ ...base, pathEnv: '' }), { path: old, source: 'installed', version: '0.11.0', ok: false });
  versions.set(onPath, '0.12.1');
  assert.deepEqual(cbm.locateCbm({ ...base, pathEnv: path.join(home, 'path-bin') }), { path: onPath, source: 'installed', version: '0.12.1', ok: true });
  assert.equal(cbm.locateCbm({ ...base, home: tmp(t, 'cbm-empty-'), pathEnv: '', registered: () => null }), null);
});

test('a relative command in the agents\' config is not trusted as a path', (t) => {
  const home = tmp(t, 'cbm-home-');
  const seen = [];
  const exists = (p) => { seen.push(p); return false; };
  assert.equal(cbm.locateCbm({ home, platform: 'linux', env: {}, pathEnv: '', exists, exec: () => '', override: null, registered: () => ({ command: 'codebase-memory-mcp' }) }), null);
  assert.ok(!seen.includes('codebase-memory-mcp'));
});

test('install folders follow CBM\'s installers', () => {
  assert.equal(cbm.defaultInstallDir({ home: '/home/u', platform: 'linux', env: {} }), path.join('/home/u', '.local', 'bin'));
  assert.equal(cbm.defaultInstallDir({ home: 'C:\\Users\\u', platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } }),
    path.join('C:\\Users\\u\\AppData\\Local', 'Programs', 'codebase-memory-mcp'));
});

test('release assets and checksums', () => {
  assert.deepEqual(cbm.assetFor('darwin', 'arm64'), { name: 'codebase-memory-mcp-darwin-arm64.tar.gz', exe: 'codebase-memory-mcp' });
  assert.deepEqual(cbm.assetFor('linux', 'x64'), { name: 'codebase-memory-mcp-linux-amd64.tar.gz', exe: 'codebase-memory-mcp' });
  assert.deepEqual(cbm.assetFor('win32', 'arm64'), { name: 'codebase-memory-mcp-windows-arm64.zip', exe: 'codebase-memory-mcp.exe' });
  assert.equal(cbm.assetFor('aix', 'x64'), null);
  const sums = `${'a'.repeat(64)}  codebase-memory-mcp-ui-darwin-arm64.tar.gz\n${'b'.repeat(64)}  codebase-memory-mcp-darwin-arm64.tar.gz\n`;
  assert.equal(cbm.checksumFor(sums, 'codebase-memory-mcp-darwin-arm64.tar.gz'), 'b'.repeat(64));
  assert.equal(cbm.checksumFor(sums, 'codebase-memory-mcp-linux-amd64.tar.gz'), null);
});

// An archive like CBM's: the binary at the top, beside LICENSE. The fake binary
// prints its version and, for `install --dir=D`, copies itself into D.
function makeArchive(t, version) {
  const dir = tmp(t, 'cbm-arc-');
  const stage = path.join(dir, 'stage');
  fs.mkdirSync(stage);
  const bin = path.join(stage, 'codebase-memory-mcp');
  fs.writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codebase-memory-mcp ${version}"; exit 0; fi
if [ "$1" = "install" ]; then
  for a in "$@"; do case "$a" in --dir=*) d="\${a#--dir=}";; esac; done
  echo "$@" > "$d/install-args"
  cp "$0" "$d/codebase-memory-mcp"; exit 0
fi
exit 1
`);
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(stage, 'LICENSE'), 'MIT');
  const archive = path.join(dir, 'codebase-memory-mcp-linux-amd64.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', stage, 'codebase-memory-mcp', 'LICENSE']);
  return fs.readFileSync(archive);
}

function fakeFetch(files) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const body = files[url];
    if (!body) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  return { fetchImpl, asked };
}

const skipTar = process.platform === 'win32' && 'the fake archive needs a POSIX shell';

test('downloadCbm checks the archive and lets the new binary install itself without agent config', { skip: skipTar }, async (t) => {
  const archive = makeArchive(t, '0.12.1');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const base = 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1';
  const { fetchImpl, asked } = fakeFetch({
    [`${base}/checksums.txt`]: Buffer.from(`${sha}  codebase-memory-mcp-linux-amd64.tar.gz\n`),
    [`${base}/codebase-memory-mcp-linux-amd64.tar.gz`]: archive,
  });
  const installDir = path.join(tmp(t, 'cbm-dest-'), 'bin');
  const steps = [];
  const got = await cbm.downloadCbm({ version: '0.12.1', platform: 'linux', arch: 'x64', installDir, fetchImpl, onStep: (s) => steps.push(s) });
  assert.deepEqual(got, { path: path.join(installDir, 'codebase-memory-mcp'), version: '0.12.1' });
  assert.deepEqual(steps, ['download', 'verify', 'install']);
  assert.equal(asked.length, 2);
  const args = fs.readFileSync(path.join(installDir, 'install-args'), 'utf8').trim();
  assert.equal(args, `install -y --force --dir=${installDir} --skip-config`);
});

test('downloadCbm refuses a download that does not match its checksum', { skip: skipTar }, async (t) => {
  const archive = makeArchive(t, '0.12.1');
  const base = 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1';
  const { fetchImpl } = fakeFetch({
    [`${base}/checksums.txt`]: Buffer.from(`${'0'.repeat(64)}  codebase-memory-mcp-linux-amd64.tar.gz\n`),
    [`${base}/codebase-memory-mcp-linux-amd64.tar.gz`]: archive,
  });
  const installDir = path.join(tmp(t, 'cbm-dest-'), 'bin');
  await assert.rejects(cbm.downloadCbm({ version: '0.12.1', platform: 'linux', arch: 'x64', installDir, fetchImpl }), /does not match its checksum/);
  assert.equal(fs.existsSync(installDir), false);
});

test('downloadCbm refuses a binary that reports another version', { skip: skipTar }, async (t) => {
  const archive = makeArchive(t, '0.12.0');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const base = 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1';
  const { fetchImpl } = fakeFetch({
    [`${base}/checksums.txt`]: Buffer.from(`${sha}  codebase-memory-mcp-linux-amd64.tar.gz\n`),
    [`${base}/codebase-memory-mcp-linux-amd64.tar.gz`]: archive,
  });
  await assert.rejects(cbm.downloadCbm({ version: '0.12.1', platform: 'linux', arch: 'x64', installDir: tmp(t, 'cbm-dest-'), fetchImpl }), /reports codebase-memory-mcp 0\.12\.0/);
});

test('latestCbm reads the release tag and gives null when GitHub cannot be read', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ tag_name: 'v0.12.4' }) });
  assert.equal(await cbm.latestCbm({ fetchImpl: ok }), '0.12.4');
  assert.equal(await cbm.latestCbm({ fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await cbm.latestCbm({ fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await cbm.latestCbm({ fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'nightly' }) }) }), null);
});
