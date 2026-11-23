// Finding codebase-memory-mcp (CBM), the code-graph indexer behind the Node
// Knowledge tab, and getting it when the computer has none.
//
// CBM lets every process that is active at the same time run one build of the
// binary over one cache folder, and refuses the others. The coding agents a
// user runs already have one registered (`~/.claude.json`, Codex's
// config.toml), so the app uses that same binary rather than a copy of its own,
// and never sets CBM_CACHE_DIR. When there is none, the app downloads the
// pinned release (CBM_VERSION), checks its SHA-256 against the release's
// checksums file, and lets that binary install itself where CBM's own
// installer puts it (`install --skip-config`): the new binary moves running
// processes over and swaps the file safely, and writes no agent configuration.
// CBM_VERSION is checked before every release, like HC_VERSION and GH_VERSION.

const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findBinary } = require('./find-binary');

const CBM_VERSION = '0.12.1';
// The schemas this code reads (async index jobs, `groups` tables, risk labels),
// and the release that fixed the CVEs of the 0.9-0.10 line.
const MIN_VERSION = [0, 12, 1];
const SERVER_NAME = 'codebase-memory-mcp';
const RELEASES = 'https://github.com/DeusData/codebase-memory-mcp/releases/download';
const LATEST_API = 'https://api.github.com/repos/DeusData/codebase-memory-mcp/releases/latest';
const RELEASE_PAGE = 'https://github.com/DeusData/codebase-memory-mcp/releases';

function exeName(platform = process.platform) {
  return platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
}

/** Where CBM's own installers put it: ~/.local/bin, or %LOCALAPPDATA%\Programs\codebase-memory-mcp. */
function defaultInstallDir({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(local, 'Programs', 'codebase-memory-mcp');
  }
  return path.join(home, '.local', 'bin');
}

function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionAtLeast(version, min = MIN_VERSION) {
  if (!version) return false;
  for (let i = 0; i < 3; i++) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
}

/** True when version `a` ('0.12.2') is newer than `b`. */
function isNewerVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

function readVersion(bin, exec = execFileSync) {
  try {
    return parseVersion(exec(bin, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

/** Claude Code's user config (~/.claude.json, or under CLAUDE_CONFIG_DIR). */
function claudeConfigPath({ env = process.env, home = os.homedir() } = {}) {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json');
}

/**
 * The CBM server the coding agents have registered: { command, args } from the
 * user-wide mcpServers of Claude Code's config, or null. Read only; a config
 * that cannot be read counts as none.
 */
function registeredServer({ configPath = claudeConfigPath(), readFile = fs.readFileSync } = {}) {
  try {
    const config = JSON.parse(readFile(configPath, 'utf8'));
    const servers = config && typeof config.mcpServers === 'object' ? config.mcpServers : null;
    if (!servers) return null;
    const name = Object.keys(servers).find(key => key === SERVER_NAME)
      || Object.keys(servers).find(key => typeof servers[key]?.command === 'string' && path.basename(servers[key].command).startsWith(SERVER_NAME));
    const server = name ? servers[name] : null;
    if (!server || typeof server.command !== 'string' || !server.command) return null;
    return { name, command: server.command, args: Array.isArray(server.args) ? server.args.map(String) : [] };
  } catch {
    return null;
  }
}

/** Codex's user config: $CODEX_HOME/config.toml, or ~/.codex/config.toml. */
function codexConfigPath({ env = process.env, home = os.homedir() } = {}) {
  return path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
}

/** Whether Codex has a codebase-memory-mcp server in its config ([mcp_servers.<name>] with CBM's command). */
function codexRegistered({ configPath = codexConfigPath(), readFile = fs.readFileSync } = {}) {
  let text;
  try { text = readFile(configPath, 'utf8'); } catch { return false; }
  if (new RegExp(`^\\s*\\[mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME})\\]`, 'm').test(text)) return true;
  // Another server name whose command is CBM's binary.
  return /^\s*\[mcp_servers\.[^\]]+\][^[]*?^\s*command\s*=\s*"[^"]*codebase-memory-mcp(?:\.exe)?"/m.test(text);
}

/**
 * The CBM to run, as { path, version, source, ok }: `ok` is false when the one
 * found is older than MIN_VERSION (the tab asks to update it). In order:
 * SWITCHBOARD_CBM, the path set in the app's settings, the binary the agents
 * have registered, then CBM's install folder, PATH and Homebrew's folders.
 * Null when there is none.
 */
function locateCbm({
  override = process.env.SWITCHBOARD_CBM,
  configured = null,
  home = os.homedir(),
  platform = process.platform,
  env = process.env,
  pathEnv = process.env.PATH || '',
  exists = fs.existsSync,
  exec = execFileSync,
  registered = () => registeredServer({ configPath: claudeConfigPath({ env, home }) }),
} = {}) {
  const exe = exeName(platform);
  const candidates = [];
  if (override) candidates.push({ path: override, source: 'override' });
  if (configured) candidates.push({ path: configured, source: 'settings' });
  const agents = registered();
  if (agents && path.isAbsolute(agents.command)) candidates.push({ path: agents.command, source: 'agents' });
  candidates.push({ path: path.join(defaultInstallDir({ home, platform, env }), exe), source: 'installed' });
  const onPath = findBinary(exe, { pathEnv, exists });
  if (onPath) candidates.push({ path: onPath, source: 'installed' });

  let old = null;
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (!exists(candidate.path)) continue;
    const version = readVersion(candidate.path, exec);
    if (!version) continue;
    const found = { ...candidate, version: version.join('.'), ok: versionAtLeast(version) };
    if (found.ok) return found;
    if (!old) old = found;
  }
  return old;
}

// --- Downloading ---

const OS_NAMES = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCH_NAMES = { x64: 'amd64', arm64: 'arm64' };

/** The release asset for a platform: codebase-memory-mcp-darwin-arm64.tar.gz, …-windows-amd64.zip. Null when CBM ships none. */
function assetFor(platform = process.platform, arch = process.arch) {
  const osName = OS_NAMES[platform];
  const archName = ARCH_NAMES[arch];
  if (!osName || !archName) return null;
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  return { name: `codebase-memory-mcp-${osName}-${archName}.${ext}`, exe: exeName(platform) };
}

/** The SHA-256 the checksums file gives `asset`, or null. */
function checksumFor(text, asset) {
  for (const line of String(text).split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim());
    if (m && m[2] === asset) return m[1].toLowerCase();
  }
  return null;
}

async function fetchBuffer(url, fetchImpl, timeoutMs = 5 * 60 * 1000) {
  // A stalled download fails, so the tab can offer it again.
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'switchboard-e' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The latest CBM release, or null when it cannot be read (offline, rate limit). */
async function latestCbm({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'switchboard-e' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const { tag_name: tag } = await res.json();
    const version = typeof tag === 'string' ? tag.replace(/^v/, '') : '';
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || stdout || '').trim().split('\n').slice(-3).join(' ');
        reject(new Error(detail ? `${err.message.split('\n')[0]}: ${detail}` : err.message));
      } else resolve({ stdout, stderr });
    });
  });
}

function tarCommand(platform = process.platform) {
  if (platform === 'win32') return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return 'tar';
}

/**
 * Download CBM `version`, check it, and let it install itself into
 * `installDir` without touching any agent's configuration. Resolves to the
 * installed { path, version }. `onStep` hears 'download', 'verify', 'install'.
 */
async function downloadCbm({
  version = CBM_VERSION,
  platform = process.platform,
  arch = process.arch,
  installDir = defaultInstallDir({ platform }),
  fetchImpl = globalThis.fetch,
  runFile = run,
  tmpRoot = os.tmpdir(),
  onStep = () => {},
} = {}) {
  const asset = assetFor(platform, arch);
  if (!asset) throw new Error(`codebase-memory-mcp has no build for ${platform}-${arch}`);
  onStep('download');
  const sums = (await fetchBuffer(`${RELEASES}/v${version}/checksums.txt`, fetchImpl, 30_000)).toString('utf8');
  const want = checksumFor(sums, asset.name);
  if (!want) throw new Error(`codebase-memory-mcp ${version} lists no ${asset.name}`);
  const archive = await fetchBuffer(`${RELEASES}/v${version}/${asset.name}`, fetchImpl);
  onStep('verify');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  if (sha !== want) throw new Error(`codebase-memory-mcp ${version}: the download does not match its checksum`);
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'cbm-'));
  try {
    const file = path.join(tmp, asset.name);
    fs.writeFileSync(file, archive);
    const unpacked = path.join(tmp, 'x');
    fs.mkdirSync(unpacked);
    await runFile(tarCommand(platform), ['-xf', file, '-C', unpacked]);
    const candidate = path.join(unpacked, asset.exe);
    const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) throw new Error(`codebase-memory-mcp ${version}: the archive has no ${asset.exe}`);
    fs.chmodSync(candidate, 0o755);
    if (platform === 'darwin') {
      // What CBM's install.sh does: an ad-hoc signature, so macOS runs it.
      await runFile('codesign', ['--sign', '-', '--force', candidate]).catch(() => {});
    }
    const { stdout } = await runFile(candidate, ['--version'], { timeout: 20000 });
    const got = parseVersion(stdout);
    if (!got || got.join('.') !== version) throw new Error(`codebase-memory-mcp ${version}: the download reports ${String(stdout).trim() || 'no version'}`);
    onStep('install');
    fs.mkdirSync(installDir, { recursive: true });
    await runFile(candidate, ['install', '-y', '--force', `--dir=${installDir}`, '--skip-config']);
    const dest = path.join(installDir, asset.exe);
    if (!fs.existsSync(dest)) throw new Error(`codebase-memory-mcp did not install into ${installDir}`);
    return { path: dest, version };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = {
  CBM_VERSION,
  MIN_VERSION,
  SERVER_NAME,
  RELEASE_PAGE,
  exeName,
  defaultInstallDir,
  parseVersion,
  versionAtLeast,
  isNewerVersion,
  readVersion,
  claudeConfigPath,
  registeredServer,
  codexConfigPath,
  codexRegistered,
  locateCbm,
  assetFor,
  checksumFor,
  latestCbm,
  downloadCbm,
};
