const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { afterPack, ghTarget, assetName, checksumFor, isNewerVersion, GH_VERSION } = require('../scripts/after-pack-gh');
const combined = require('../scripts/after-pack');
const pkg = require('../package.json');

function packed(platform, arch) {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-gh-'));
  const bin = path.join(appOutDir, 'fetched-gh');
  const license = path.join(appOutDir, 'fetched-LICENSE');
  fs.writeFileSync(bin, '#!/bin/sh\n');
  fs.writeFileSync(license, 'MIT License\n');
  const context = { electronPlatformName: platform, arch, appOutDir, packager: { appInfo: { productFilename: 'Switchboard Evolution' } } };
  return { context, appOutDir, fetched: { bin, license } };
}

test('the build runs one afterPack hook, which puts both herdr-core and gh in the app', () => {
  assert.equal(pkg.build.afterPack, 'scripts/after-pack.js');
  assert.equal(typeof combined, 'function');
  assert.equal(combined.default, combined);
});

test('ghTarget names the GitHub CLI build of each Mac, Linux and Windows', () => {
  assert.deepEqual(ghTarget('darwin', 'arm64'), { name: 'macOS_arm64', ext: 'zip', exe: 'gh' });
  assert.deepEqual(ghTarget('darwin', 'x64'), { name: 'macOS_amd64', ext: 'zip', exe: 'gh' });
  assert.deepEqual(ghTarget('linux', 'x64'), { name: 'linux_amd64', ext: 'tar.gz', exe: 'gh' });
  assert.deepEqual(ghTarget('linux', 'arm64'), { name: 'linux_arm64', ext: 'tar.gz', exe: 'gh' });
  assert.deepEqual(ghTarget('win32', 'x64'), { name: 'windows_amd64', ext: 'zip', exe: 'gh.exe' });
  assert.deepEqual(ghTarget('win32', 'arm64'), { name: 'windows_arm64', ext: 'zip', exe: 'gh.exe' });
  assert.equal(ghTarget('darwin', 'universal'), null);
  assert.equal(ghTarget('linux', 'armv7l'), null);
  assert.equal(assetName(ghTarget('darwin', 'arm64'), '2.105.0'), 'gh_2.105.0_macOS_arm64.zip');
  assert.equal(assetName(ghTarget('linux', 'x64'), '2.105.0'), 'gh_2.105.0_linux_amd64.tar.gz');
});

test('checksumFor reads the release\'s checksums file', () => {
  const sums = [
    `${'a'.repeat(64)}  gh_2.105.0_linux_amd64.tar.gz`,
    `${'B'.repeat(64)}  gh_2.105.0_macOS_arm64.zip`,
    '',
  ].join('\n');
  assert.equal(checksumFor(sums, 'gh_2.105.0_macOS_arm64.zip'), 'b'.repeat(64));
  assert.equal(checksumFor(sums, 'gh_2.105.0_linux_amd64.tar.gz'), 'a'.repeat(64));
  assert.equal(checksumFor(sums, 'gh_2.105.0_macOS_amd64.zip'), null);
});

test('afterPack puts the arch\'s gh in the app as bin/gh, executable, with its licence', async () => {
  const { context, appOutDir, fetched } = packed('darwin', 3);
  const asked = [];
  const dest = await afterPack(context, { fetchBinary: async (target) => { asked.push(target.name); return fetched; }, latest: async () => null, env: {}, log: () => {} });
  const bin = path.join(appOutDir, 'Switchboard Evolution.app', 'Contents', 'Resources', 'bin');
  assert.deepEqual(asked, ['macOS_arm64']);
  assert.equal(dest, path.join(bin, 'gh'));
  assert.equal(fs.statSync(dest).mode & 0o111, 0o111);
  assert.equal(fs.readFileSync(path.join(bin, 'gh.LICENSE'), 'utf8'), 'MIT License\n');
});

test('afterPack puts gh.exe in a Windows app and gh in a Linux one', async () => {
  const win = packed('win32', 1);
  assert.equal(await afterPack(win.context, { fetchBinary: async () => win.fetched, latest: async () => null, env: {}, log: () => {} }),
    path.join(win.appOutDir, 'resources', 'bin', 'gh.exe'));
  const linux = packed('linux', 1);
  assert.equal(await afterPack(linux.context, { fetchBinary: async () => linux.fetched, latest: async () => null, env: {}, log: () => {} }),
    path.join(linux.appOutDir, 'resources', 'bin', 'gh'));
});

test('afterPack stops the build when gh cannot be fetched, unless it is left out on purpose', async () => {
  const { context } = packed('linux', 1);
  const failing = async () => { throw new Error('offline'); };
  await assert.rejects(afterPack(context, { fetchBinary: failing, env: {}, log: () => {} }), /linux_amd64.*offline.*SWITCHBOARD_SKIP_GH/s);
  assert.equal(await afterPack(context, { fetchBinary: failing, env: { SWITCHBOARD_SKIP_GH: '1' }, log: () => {} }), null);
});

test('isNewerVersion compares gh versions number by number', () => {
  assert.equal(isNewerVersion('2.106.0', '2.105.0'), true);
  assert.equal(isNewerVersion('3.0.0', '2.105.9'), true);
  assert.equal(isNewerVersion('2.105.1', '2.105.0'), true);
  assert.equal(isNewerVersion('2.105.0', '2.105.0'), false);
  assert.equal(isNewerVersion('2.99.0', '2.105.0'), false);
});

test('afterPack says when GitHub has a newer gh, as a warning in GitHub Actions', async () => {
  const { context, fetched } = packed('darwin', 3);
  const lines = [];
  const options = { fetchBinary: async () => fetched, latest: async () => '9.9.9', log: (line) => lines.push(line) };
  await afterPack(context, { ...options, env: {} });
  await afterPack(context, { ...options, env: { GITHUB_ACTIONS: 'true' } });
  assert.match(lines.find(l => l.includes('9.9.9')), new RegExp(`gh 9\\.9\\.9 is out, the app carries ${GH_VERSION.replace(/\./g, '\\.')}`));
  assert.ok(lines.some(l => l.startsWith('::warning::gh 9.9.9 is out')));
  lines.length = 0;
  await afterPack(context, { ...options, latest: async () => GH_VERSION, env: {} });
  await afterPack(context, { ...options, latest: async () => null, env: {} });
  assert.equal(lines.filter(l => l.includes('is out')).length, 0);
});
