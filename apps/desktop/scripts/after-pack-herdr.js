// after-pack-herdr.js — electron-builder's afterPack hook (package.json
// build.afterPack): puts herdr-core in the app, as resources/bin/herdr-core,
// where hc-engine.js finds it. Sessions run in herdr-core so they keep
// running when the app quits; an app without it runs them inside itself, and
// a new version installed over one with it does not find the sessions it
// left running. So every build carries it: npm run build:*, the Release
// workflow and switchboard-e alike.
//
// The pinned version comes from releases.herdr.dev, checked against the
// SHA-256 in its manifest, and is kept in a cache so builds do not download it
// again. macOS and Linux only: hc-engine.js does not run herdr-core on Windows.
//
// A build that cannot get it stops, rather than ship an app that loses its
// sessions. SWITCHBOARD_SKIP_HC=1 builds without it, on purpose.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HC_VERSION = '0.1.21';
const RELEASES = 'https://releases.herdr.dev';
// electron-builder's Arch enum (builder-util), by number.
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

/** The herdr-core build for an Electron platform and arch ('macos-aarch64'), or null when there is none to ship. */
function herdrTarget(platform, arch) {
  const system = { darwin: 'macos', linux: 'linux' }[platform];
  const cpu = { arm64: 'aarch64', x64: 'x86_64' }[arch];
  return system && cpu ? `${system}-${cpu}` : null;
}

/** Where the packed app keeps its resources (process.resourcesPath once it runs). */
function resourcesDir({ platform, appOutDir, productFilename }) {
  return platform === 'darwin'
    ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
}

/** The cache of downloaded builds; on a Mac the one switchboard-e's fetch-hc.sh fills too. */
function cacheRoot() {
  if (process.env.HC_CACHE) return process.env.HC_CACHE;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'switchboard-fork', 'hc');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'switchboard-e', 'hc');
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The herdr-core binary for `target`, from the cache or downloaded and checked. */
async function fetchHerdrCore(target, { version = HC_VERSION, cache = cacheRoot() } = {}) {
  const out = path.join(cache, version, target, 'herdr-core');
  if (fs.existsSync(out)) return out;
  const manifest = JSON.parse((await download(`${RELEASES}/core/${version}/manifest.json`)).toString('utf8'));
  const entry = manifest.targets && manifest.targets[target];
  if (!entry || !entry.url || !entry.sha256) throw new Error(`herdr-core ${version} has no ${target} build`);
  const archive = await download(entry.url);
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  if (sha !== entry.sha256) throw new Error(`herdr-core ${version} ${target}: checksum mismatch`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-core-'));
  try {
    fs.writeFileSync(path.join(tmp, 'hc.tar.gz'), archive);
    execFileSync('tar', ['-xzf', 'hc.tar.gz'], { cwd: tmp });
    const bin = path.join(tmp, 'herdr-core');
    if (!fs.existsSync(bin)) throw new Error(`herdr-core ${version} ${target}: the archive has no herdr-core`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(bin, `${out}.tmp`);
    fs.chmodSync(`${out}.tmp`, 0o755);
    fs.renameSync(`${out}.tmp`, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

/** Copy herdr-core into the packed app; `fetchBinary` is fetchHerdrCore, replaced in tests. */
async function afterPack(context, { fetchBinary = fetchHerdrCore, env = process.env, log = console.log } = {}) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] || String(context.arch);
  if (env.SWITCHBOARD_SKIP_HC === '1') {
    log(`  • herdr-core left out (SWITCHBOARD_SKIP_HC=1): sessions will run inside the app`);
    return null;
  }
  const target = herdrTarget(platform, arch);
  if (!target) {
    log(`  • herdr-core: none for ${platform}-${arch}; sessions run inside the app there`);
    return null;
  }
  let bin;
  try {
    bin = await fetchBinary(target);
  } catch (err) {
    throw new Error(`herdr-core ${HC_VERSION} for ${target} could not be fetched (${err.message}). Without it the app loses its sessions on quit; set SWITCHBOARD_SKIP_HC=1 to build without it on purpose.`);
  }
  const dir = path.join(resourcesDir({ platform, appOutDir: context.appOutDir, productFilename: context.packager.appInfo.productFilename }), 'bin');
  const dest = path.join(dir, 'herdr-core');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(bin, dest);
  fs.chmodSync(dest, 0o755);
  log(`  • herdr-core ${HC_VERSION} (${target}) in ${path.relative(context.appOutDir, dest)}`);
  return dest;
}

module.exports = afterPack;
module.exports.default = afterPack;
Object.assign(module.exports, { afterPack, herdrTarget, resourcesDir, fetchHerdrCore, HC_VERSION });
