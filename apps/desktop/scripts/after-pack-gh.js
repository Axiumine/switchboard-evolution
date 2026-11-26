// after-pack-gh.js — puts the GitHub CLI in the app, as resources/bin/gh
// (gh.exe on Windows), with its licence next to it as gh.LICENSE. The Git
// tab's Pull Requests view runs gh (pull-requests.js): a gh installed on the
// computer comes first, and this copy is what the view uses when there is
// none, so the view works on a computer without gh too.
//
// The pinned version comes from GitHub's release of cli/cli, checked against
// the SHA-256 in that release's checksums file, and is kept in a cache so
// builds do not download it again. Run by scripts/after-pack.js (package.json
// build.afterPack), for every build: npm run build:*, the Release workflow and
// switchboard-e alike.
//
// A build that cannot get it stops, rather than ship an app whose Pull
// Requests view needs a gh the computer may not have. SWITCHBOARD_SKIP_GH=1
// builds without it, on purpose.
//
// Each build also asks GitHub for the latest gh and says so when it is newer
// than GH_VERSION (a warning in GitHub Actions): then update GH_VERSION, in a
// commit of its own (AGENTS.md, "Rules").

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GH_VERSION = '2.106.0';
const RELEASES = 'https://github.com/cli/cli/releases/download';
const LATEST_API = 'https://api.github.com/repos/cli/cli/releases/latest';
// electron-builder's Arch enum (builder-util), by number.
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

/**
 * The gh build for an Electron platform and arch, or null when there is none
 * to ship: { name: 'macOS_arm64', ext: 'zip', exe: 'gh' }.
 */
function ghTarget(platform, arch) {
  const system = { darwin: 'macOS', linux: 'linux', win32: 'windows' }[platform];
  const cpu = { arm64: 'arm64', x64: 'amd64' }[arch];
  if (!system || !cpu) return null;
  return {
    name: `${system}_${cpu}`,
    ext: platform === 'linux' ? 'tar.gz' : 'zip',
    exe: platform === 'win32' ? 'gh.exe' : 'gh',
  };
}

/** The release asset of a target: gh_2.106.0_macOS_arm64.zip. */
function assetName(target, version = GH_VERSION) {
  return `gh_${version}_${target.name}.${target.ext}`;
}

/** Where the packed app keeps its resources (process.resourcesPath once it runs). */
function resourcesDir({ platform, appOutDir, productFilename }) {
  return platform === 'darwin'
    ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
}

/** The cache of downloaded builds. */
function cacheRoot() {
  if (process.env.GH_CACHE) return process.env.GH_CACHE;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'switchboard-e', 'gh');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'switchboard-e', 'gh');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'switchboard-e', 'gh');
}

/** True when version `a` ('2.106.0') is newer than `b`. */
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/** The SHA-256 the checksums file gives `asset`, or null. */
function checksumFor(text, asset) {
  for (const line of String(text).split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim());
    if (m && m[2] === asset) return m[1].toLowerCase();
  }
  return null;
}

/** The latest gh on GitHub, or null when it cannot be read: it never stops a build. */
async function latestGh({ env = process.env } = {}) {
  try {
    const token = env.GH_TOKEN || env.GITHUB_TOKEN;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'switchboard-e-build' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(LATEST_API, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const { tag_name: tag } = await res.json();
    const version = typeof tag === 'string' ? tag.replace(/^v/, '') : '';
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}

// Asked once per build, not once per packed arch.
let latestAsked = null;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The tar that opens the archive: bsdtar on a Mac and on Windows (zip too), GNU tar on Linux (tar.gz). */
function tarCommand() {
  if (process.platform === 'win32') return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return 'tar';
}

/** The first file called `name` in a bin folder under `dir`. */
function findInBin(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findInBin(full, name);
      if (found) return found;
    } else if (entry.name === name && path.basename(dir) === 'bin') {
      return full;
    }
  }
  return null;
}

/** The first file called `name` anywhere under `dir`. */
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

/** gh for `target` from the cache, or downloaded and checked: { bin, license }. */
async function fetchGh(target, { version = GH_VERSION, cache = cacheRoot() } = {}) {
  const dir = path.join(cache, version, target.name);
  const out = path.join(dir, target.exe);
  const license = path.join(dir, 'LICENSE');
  if (fs.existsSync(out) && fs.existsSync(license)) return { bin: out, license };
  const asset = assetName(target, version);
  const sums = (await download(`${RELEASES}/v${version}/gh_${version}_checksums.txt`)).toString('utf8');
  const want = checksumFor(sums, asset);
  if (!want) throw new Error(`gh ${version} has no ${asset}`);
  const archive = await download(`${RELEASES}/v${version}/${asset}`);
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  if (sha !== want) throw new Error(`gh ${version} ${target.name}: checksum mismatch`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
  try {
    const file = path.join(tmp, asset);
    fs.writeFileSync(file, archive);
    const unpacked = path.join(tmp, 'x');
    fs.mkdirSync(unpacked);
    execFileSync(tarCommand(), ['-xf', file, '-C', unpacked]);
    const bin = findInBin(unpacked, target.exe);
    if (!bin) throw new Error(`gh ${version} ${target.name}: the archive has no bin/${target.exe}`);
    const licenseFile = findFile(unpacked, 'LICENSE');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(bin, `${out}.tmp`);
    fs.chmodSync(`${out}.tmp`, 0o755);
    fs.renameSync(`${out}.tmp`, out);
    if (licenseFile) fs.copyFileSync(licenseFile, license);
    else fs.writeFileSync(license, 'GitHub CLI, MIT License: https://github.com/cli/cli/blob/trunk/LICENSE\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { bin: out, license };
}

/** Copy gh into the packed app; `fetchBinary` and `latest` are replaced in tests. */
async function afterPack(context, { fetchBinary = fetchGh, latest, env = process.env, log = console.log } = {}) {
  const platform = context.electronPlatformName;
  const arch = ARCH_NAMES[context.arch] || String(context.arch);
  if (env.SWITCHBOARD_SKIP_GH === '1') {
    log(`  • gh left out (SWITCHBOARD_SKIP_GH=1): the Pull Requests view needs one installed on the computer`);
    return null;
  }
  const target = ghTarget(platform, arch);
  if (!target) {
    log(`  • gh: none for ${platform}-${arch}; the Pull Requests view needs one installed on the computer there`);
    return null;
  }
  let fetched;
  try {
    fetched = await fetchBinary(target);
  } catch (err) {
    throw new Error(`gh ${GH_VERSION} for ${target.name} could not be fetched (${err.message}). Set SWITCHBOARD_SKIP_GH=1 to build without it on purpose.`);
  }
  const dir = path.join(resourcesDir({ platform, appOutDir: context.appOutDir, productFilename: context.packager.appInfo.productFilename }), 'bin');
  const dest = path.join(dir, target.exe);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(fetched.bin, dest);
  fs.chmodSync(dest, 0o755);
  if (fetched.license) fs.copyFileSync(fetched.license, path.join(dir, 'gh.LICENSE'));
  log(`  • gh ${GH_VERSION} (${target.name}) in ${path.relative(context.appOutDir, dest)}`);
  const newest = await (latest ? latest() : (latestAsked ||= latestGh({ env })));
  if (newest && isNewerVersion(newest, GH_VERSION)) {
    const message = `gh ${newest} is out, the app carries ${GH_VERSION}: update GH_VERSION in apps/desktop/scripts/after-pack-gh.js`;
    log(env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `  • ${message}`);
  }
  return dest;
}

module.exports = afterPack;
module.exports.default = afterPack;
Object.assign(module.exports, { afterPack, ghTarget, assetName, resourcesDir, checksumFor, fetchGh, isNewerVersion, latestGh, GH_VERSION });
