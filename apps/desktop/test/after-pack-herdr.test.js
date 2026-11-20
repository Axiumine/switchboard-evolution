const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { afterPack, herdrTarget, resourcesDir, isNewerVersion, HC_VERSION } = require('../scripts/after-pack-herdr');

function packed(platform, arch) {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'));
  const bin = path.join(appOutDir, 'fetched-herdr-core');
  fs.writeFileSync(bin, '#!/bin/sh\n');
  const context = { electronPlatformName: platform, arch, appOutDir, packager: { appInfo: { productFilename: 'Switchboard Evolution' } } };
  return { context, appOutDir, bin };
}

test('herdrTarget names the herdr-core build of each Mac and Linux, and none for Windows', () => {
  assert.equal(herdrTarget('darwin', 'arm64'), 'macos-aarch64');
  assert.equal(herdrTarget('darwin', 'x64'), 'macos-x86_64');
  assert.equal(herdrTarget('linux', 'x64'), 'linux-x86_64');
  assert.equal(herdrTarget('linux', 'arm64'), 'linux-aarch64');
  assert.equal(herdrTarget('win32', 'x64'), null);
  assert.equal(herdrTarget('darwin', 'universal'), null);
});

test('resourcesDir is where process.resourcesPath points in the packed app', () => {
  assert.equal(resourcesDir({ platform: 'darwin', appOutDir: '/out/mac-arm64', productFilename: 'Switchboard Evolution' }),
    path.join('/out/mac-arm64', 'Switchboard Evolution.app', 'Contents', 'Resources'));
  assert.equal(resourcesDir({ platform: 'linux', appOutDir: '/out/linux-unpacked', productFilename: 'Switchboard Evolution' }),
    path.join('/out/linux-unpacked', 'resources'));
});

test('afterPack puts the arch\'s herdr-core in the app as bin/herdr-core, executable', async () => {
  const { context, appOutDir, bin } = packed('darwin', 3);
  const asked = [];
  const dest = await afterPack(context, { fetchBinary: async (target) => { asked.push(target); return bin; }, latest: async () => null, env: {}, log: () => {} });
  assert.deepEqual(asked, ['macos-aarch64']);
  assert.equal(dest, path.join(appOutDir, 'Switchboard Evolution.app', 'Contents', 'Resources', 'bin', 'herdr-core'));
  assert.equal(fs.statSync(dest).mode & 0o111, 0o111);
});

test('afterPack stops the build when herdr-core cannot be fetched, unless it is left out on purpose', async () => {
  const { context } = packed('linux', 1);
  const failing = async () => { throw new Error('offline'); };
  await assert.rejects(afterPack(context, { fetchBinary: failing, env: {}, log: () => {} }), /linux-x86_64.*offline.*SWITCHBOARD_SKIP_HC/s);
  assert.equal(await afterPack(context, { fetchBinary: failing, env: { SWITCHBOARD_SKIP_HC: '1' }, log: () => {} }), null);
});

test('afterPack leaves Windows without herdr-core', async () => {
  const { context } = packed('win32', 1);
  let fetched = false;
  assert.equal(await afterPack(context, { fetchBinary: async () => { fetched = true; }, env: {}, log: () => {} }), null);
  assert.equal(fetched, false);
});

test('isNewerVersion compares herdr-core versions number by number', () => {
  assert.equal(isNewerVersion('0.1.22', '0.1.21'), true);
  assert.equal(isNewerVersion('0.2.0', '0.1.99'), true);
  assert.equal(isNewerVersion('0.1.10', '0.1.9'), true);
  assert.equal(isNewerVersion('0.1.21', '0.1.21'), false);
  assert.equal(isNewerVersion('0.1.20', '0.1.21'), false);
});

test('afterPack says when releases.herdr.dev has a newer herdr-core, as a warning in GitHub Actions', async () => {
  const { context, bin } = packed('darwin', 3);
  const lines = [];
  const options = { fetchBinary: async () => bin, latest: async () => '9.9.9', log: (line) => lines.push(line) };
  await afterPack(context, { ...options, env: {} });
  await afterPack(context, { ...options, env: { GITHUB_ACTIONS: 'true' } });
  assert.match(lines.find(l => l.includes('9.9.9')), new RegExp(`herdr-core 9\\.9\\.9 is out, the app carries ${HC_VERSION.replace(/\./g, '\\.')}`));
  assert.ok(lines.some(l => l.startsWith('::warning::herdr-core 9.9.9 is out')));
  lines.length = 0;
  await afterPack(context, { ...options, latest: async () => HC_VERSION, env: {} });
  await afterPack(context, { ...options, latest: async () => null, env: {} });
  assert.equal(lines.filter(l => l.includes('is out')).length, 0);
});
