// How much memory each live session (and each running task) costs.
//
// A session is a PTY whose pid is a shell or the CLI itself; what it really
// costs is that process plus everything under it: the CLI, its MCP servers,
// the dev servers and builds it starts. So each owner is measured as the sum
// over its whole process tree, from one process-table snapshot per refresh.
//
// On macOS a process's memory is its footprint, what Activity Monitor's Memory
// column shows: the resident size (RSS) leaves out memory the system has
// compressed, and on a Mac short of RAM that is most of it. Elsewhere it is the
// resident size (Linux) or the working set (Windows).

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A footprint is read again once it is this old; reading it costs far more than `ps`.
const FOOTPRINT_MAX_AGE_MS = 5000;

// Interpreters whose own name says little: "node" is more useful as "node claude".
const SCRIPT_HOSTS = new Set(['node', 'bun', 'deno', 'python', 'python3', 'ruby', 'perl', 'php', 'java']);
// Flags after which an interpreter runs inline code, not a file.
const INLINE_CODE_FLAGS = new Set(['-e', '--eval', '-p', '--print', '-c']);

/**
 * The table `ps -A -o pid=,ppid=,rss=,pcpu=,stat=,comm=` prints, as pid → process.
 * rss is in KiB; the command name is last because it may contain spaces.
 * Zombies (state Z) have already exited and hold no memory, so they are left out.
 */
function parsePsTable(stdout) {
  const table = new Map();
  for (const line of String(stdout || '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match || match[5].startsWith('Z')) continue;
    const pid = Number(match[1]);
    table.set(pid, {
      pid,
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      cpu: Number(match[4].replace(',', '.')) || 0,
      name: path.basename(match[6]),
    });
  }
  return table;
}

/** The tab-separated table the Windows query prints: pid, ppid, working set in bytes, name. */
function parseWindowsTable(stdout) {
  const table = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const [pid, ppid, rss, ...name] = line.split('\t');
    if (!/^\d+$/.test(pid || '') || !/^\d+$/.test(ppid || '')) continue;
    table.set(Number(pid), {
      pid: Number(pid),
      ppid: Number(ppid),
      rssBytes: Number(rss) || 0,
      cpu: null,
      name: name.join('\t').trim(),
    });
  }
  return table;
}

/** `footprint --noCategories -f bytes -p …` output, as pid → footprint in bytes. */
function parseFootprint(stdout) {
  const sizes = new Map();
  for (const match of String(stdout || '').matchAll(/\[(\d+)\]:\s+\d+-bit\s+Footprint:\s+(\d+)\s*B\b/g)) {
    sizes.set(Number(match[1]), Number(match[2]));
  }
  return sizes;
}

/**
 * The memory in use on a Mac, from `vm_stat`, as Activity Monitor's "Memory
 * Used" counts it: app memory (anonymous pages that are not purgeable), wired
 * memory and what the compressor holds. Files kept in cache are left out: the
 * system hands them back as soon as anything needs the room. Null when the
 * output is not understood.
 */
function parseVmStat(stdout) {
  const text = String(stdout || '');
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (label) => {
    const match = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text);
    return match ? Number(match[1]) : null;
  };
  const anonymous = pages('Anonymous pages');
  const wired = pages('Pages wired down');
  if (!pageSize || anonymous === null || wired === null) return null;
  const purgeable = pages('Pages purgeable') || 0;
  const compressed = pages('Pages occupied by compressor') || 0;
  return (Math.max(0, anonymous - purgeable) + wired + compressed) * pageSize;
}

/** The memory in use on Linux, from /proc/meminfo: all of it but what is available. Null when unknown. */
function parseMeminfo(text) {
  const kib = (label) => {
    const match = new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(String(text || ''));
    return match ? Number(match[1]) * 1024 : null;
  };
  const total = kib('MemTotal');
  const available = kib('MemAvailable');
  return total === null || available === null ? null : Math.max(0, total - available);
}

/**
 * `df -kP` output: one entry per filesystem, sizes in bytes. The filesystem
 * name and the mount point may hold spaces, so the numbers are what anchors a line.
 */
function parseDf(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split('\n')) {
    const match = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(?:\d+%|-)\s+(\/.*?)\s*$/.exec(line);
    if (!match) continue;
    rows.push({ filesystem: match[1], totalBytes: Number(match[2]) * 1024, freeBytes: Number(match[4]) * 1024, mount: match[5] });
  }
  return rows;
}

/** `mount` output on macOS, as mount point → its flags (apfs, local, read-only, nobrowse…). */
function parseMountFlags(stdout) {
  const flags = new Map();
  for (const line of String(stdout || '').split('\n')) {
    const match = /^.+? on (\/.*?) \(([^)]*)\)\s*$/.exec(line);
    if (match) flags.set(match[1], match[2].split(',').map(flag => flag.trim()));
  }
  return flags;
}

/**
 * The disks a Mac user would name: the startup disk ("/", whose free space
 * is its whole APFS container's) and every disk under /Volumes the Finder
 * shows. Left out: the system's own volumes, read-only images (installers,
 * simulator runtimes) and what the Finder hides.
 */
function macDisks(dfRows, mountFlags, rootName = 'Macintosh HD') {
  const disks = [];
  for (const row of dfRows) {
    const flags = mountFlags.get(row.mount) || [];
    if (row.mount === '/') {
      disks.push({ name: rootName, mount: '/', totalBytes: row.totalBytes, freeBytes: row.freeBytes, primary: true });
      continue;
    }
    if (!/^\/Volumes\/[^/]+$/.test(row.mount)) continue;
    if (flags.includes('nobrowse') || flags.includes('read-only') || !row.totalBytes) continue;
    disks.push({ name: row.mount.slice('/Volumes/'.length), mount: row.mount, totalBytes: row.totalBytes, freeBytes: row.freeBytes, primary: false });
  }
  return disks;
}

/** The Windows query's lines: drive, label, size and free bytes, tab-separated. */
function parseWindowsDisks(stdout, homeDrive = 'C:') {
  const disks = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const [drive, label, size, free] = line.split('\t');
    if (!/^[A-Za-z]:$/.test(drive || '') || !/^\d+$/.test(size || '') || !/^\d+$/.test(free || '')) continue;
    disks.push({
      name: label ? `${label.trim()} (${drive})` : drive,
      mount: `${drive}\\`,
      totalBytes: Number(size),
      freeBytes: Number(free),
      primary: drive.toUpperCase() === String(homeDrive).toUpperCase(),
    });
  }
  return disks;
}

/** `ps -o pid=,args=` output, as pid → full command line. */
function parseCommandLines(stdout) {
  const lines = new Map();
  for (const line of String(stdout || '').split('\n')) {
    const match = /^\s*(\d+)\s+(.*?)\s*$/.exec(line);
    if (match) lines.set(Number(match[1]), match[2]);
  }
  return lines;
}

/**
 * The process at `rootPid` and every descendant, root first, each with its
 * depth below the root. Empty when the root is gone.
 */
function collectTree(table, rootPid) {
  if (!rootPid || !table.has(rootPid)) return [];
  const children = new Map();
  for (const proc of table.values()) {
    if (proc.pid === proc.ppid) continue;
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc);
  }
  const out = [];
  const seen = new Set();
  const visit = (proc, depth) => {
    if (seen.has(proc.pid)) return;
    seen.add(proc.pid);
    out.push({ ...proc, depth });
    const kids = (children.get(proc.pid) || []).slice().sort((a, b) => b.rssBytes - a.rssBytes);
    for (const kid of kids) visit(kid, depth + 1);
  };
  visit(table.get(rootPid), 0);
  return out;
}

/** "node" alone hides which program it runs; name the script too when there is one. */
function friendlyName(name, commandLine) {
  const base = String(name || '').replace(/\.exe$/i, '');
  if (!SCRIPT_HOSTS.has(base.toLowerCase()) || !commandLine) return name || '';
  // The first argument that looks like a file, skipping flags; inline code (-e, -c) has none.
  for (const arg of String(commandLine).split(/\s+/).slice(1)) {
    if (INLINE_CODE_FLAGS.has(arg)) return name;
    if (!arg || arg.startsWith('-')) continue;
    if (/[/.]/.test(arg) || /^[A-Za-z]:\\/.test(arg)) return `${base} ${path.win32.basename(arg)}`;
  }
  return name;
}

/** Total memory, CPU and process count of one tree. */
function summarizeTree(procs) {
  let rssBytes = 0;
  let cpu = 0;
  let hasCpu = false;
  for (const proc of procs) {
    rssBytes += proc.rssBytes || 0;
    if (typeof proc.cpu === 'number') { cpu += proc.cpu; hasCpu = true; }
  }
  return { rssBytes, cpu: hasCpu ? Math.round(cpu * 10) / 10 : null, processCount: procs.length };
}

/** Deepest first, so nothing gets a chance to respawn or be reparented midway. */
function killOrder(procs) {
  return procs.slice().sort((a, b) => b.depth - a.depth);
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10000, windowsHide: true, ...options }, (err, stdout) => {
      if (err) { err.stdout = stdout; reject(err); } else resolve(stdout);
    });
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.platform]  process.platform by default
 * @param {Function} [options.exec]    (file, args, options) → Promise<stdout>, for tests
 * @param {Function} [options.kill]    (pid, signal) → void, for tests
 * @param {Function} [options.sleep]   ms → Promise, for tests
 */
function createProcessMonitor(options = {}) {
  const platform = options.platform || process.platform;
  const exec = options.exec || run;
  const kill = options.kill || ((pid, signal) => process.kill(pid, signal));
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const readFile = options.readFile || (file => fs.promises.readFile(file, 'utf8'));
  const totalmem = options.totalmem || os.totalmem;
  const freemem = options.freemem || os.freemem;
  // Numbers printed the C way, whatever the user's locale.
  const env = { ...process.env, LC_ALL: 'C' };
  // pid → { bytes, name, at }: footprints read lately, so a refresh every few
  // seconds (and two viewers at once) does not read them all every time.
  const footprintCache = new Map();
  let footprintMissing = false;

  async function snapshot() {
    if (platform === 'win32') {
      const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.WorkingSetSize)`t$($_.Name)" }';
      return parseWindowsTable(await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]));
    }
    return parsePsTable(await exec('ps', ['-A', '-o', 'pid=,ppid=,rss=,pcpu=,stat=,comm='], { env }));
  }

  /** Full command lines, only for the processes on screen. Best effort. */
  async function commandLines(pids) {
    if (!pids.length) return new Map();
    if (platform === 'win32') {
      const filter = pids.map(pid => `ProcessId=${Number(pid)}`).join(' OR ');
      const script = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`;
      try { return parseCommandLines(await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])); } catch { return new Map(); }
    }
    try {
      return parseCommandLines(await exec('ps', ['-o', 'pid=,args=', '-p', pids.map(Number).join(',')], { env }));
    } catch (err) {
      // ps exits 1 when one of the pids ended in between, but still prints the rest.
      return parseCommandLines(err?.stdout || '');
    }
  }

  /**
   * The footprint of each process on macOS (pid → bytes), from the cache when
   * it was read in the last few seconds by the same program. Empty elsewhere,
   * or when the `footprint` tool is missing: the caller keeps the RSS then.
   */
  async function footprints(procs) {
    const sizes = new Map();
    if (platform !== 'darwin' || footprintMissing || !procs.length) return sizes;
    const at = now();
    const stale = [];
    for (const proc of procs) {
      const cached = footprintCache.get(proc.pid);
      if (cached && cached.name === proc.name && at - cached.at < FOOTPRINT_MAX_AGE_MS) sizes.set(proc.pid, cached.bytes);
      else stale.push(proc);
    }
    if (stale.length) {
      let stdout = '';
      try {
        stdout = await exec('footprint', ['--noCategories', '-f', 'bytes', ...stale.flatMap(proc => ['-p', String(proc.pid)])], { env });
      } catch (err) {
        // A process that ended in between makes it fail, after printing the others.
        if (err?.code === 'ENOENT') footprintMissing = true;
        stdout = err?.stdout || '';
      }
      const read = parseFootprint(stdout);
      for (const proc of stale) {
        if (!read.has(proc.pid)) continue;
        sizes.set(proc.pid, read.get(proc.pid));
        footprintCache.set(proc.pid, { bytes: read.get(proc.pid), name: proc.name, at });
      }
    }
    const live = new Set(procs.map(proc => proc.pid));
    for (const pid of footprintCache.keys()) if (!live.has(pid)) footprintCache.delete(pid);
    return sizes;
  }

  /** The name of the measure: what each process's memory number is. */
  function measureName(sizes) {
    if (platform === 'win32') return 'working-set';
    return platform === 'darwin' && sizes.size ? 'footprint' : 'rss';
  }

  /**
   * What everything Switchboard runs costs. Each owner ({ pid, ...anything })
   * is measured over its process tree and comes back with rssBytes (its
   * memory, see measureName), cpu, processCount and its processes; owners are
   * heaviest first, and one whose pid is unknown or gone measures zero.
   *
   * `appPid` is the app's own process: its tree, less the owners in it (PTYs
   * started by the app), is the app (window, GPU, helpers). Terminal hosts
   * that run sessions outside the app's tree (herdr-core), named in
   * `hostNames`, count as the app too, but not the other programs they run.
   * `total` is the app and every owner together.
   */
  async function usage(owners, { appPid = null, hostNames = [] } = {}) {
    const table = await snapshot();
    const trees = owners.map(owner => collectTree(table, owner.pid));
    const ownerPids = new Set(trees.flat().map(proc => proc.pid));
    // The `ps` of this very snapshot is a child of the app too.
    const appProcs = appPid
      ? collectTree(table, appPid).filter(proc => !ownerPids.has(proc.pid) && !(proc.name === 'ps' && proc.ppid === appPid))
      : [];
    const appPids = new Set(appProcs.map(proc => proc.pid));
    for (const tree of trees) {
      let parent = tree[0] ? table.get(tree[0].ppid) : null;
      while (parent && hostNames.includes(parent.name) && !ownerPids.has(parent.pid) && !appPids.has(parent.pid)) {
        appProcs.push({ ...parent, depth: 0 });
        appPids.add(parent.pid);
        parent = table.get(parent.ppid);
      }
    }

    const sizes = await footprints([...trees.flat(), ...appProcs]);
    for (const proc of [...trees.flat(), ...appProcs]) {
      if (sizes.has(proc.pid)) proc.rssBytes = sizes.get(proc.pid);
    }

    const measured = owners.map((owner, i) => ({ ...owner, ...summarizeTree(trees[i]), processes: trees[i], found: trees[i].length > 0 }));
    const lines = await commandLines([...ownerPids]);
    for (const owner of measured) {
      for (const proc of owner.processes) {
        proc.command = lines.get(proc.pid) || null;
        proc.label = friendlyName(proc.name, proc.command);
      }
    }
    measured.sort((a, b) => b.rssBytes - a.rssBytes);

    const app = summarizeTree(appProcs);
    const ownersBytes = measured.reduce((sum, owner) => sum + owner.rssBytes, 0);
    const ownersCount = measured.reduce((sum, owner) => sum + owner.processCount, 0);
    return {
      owners: measured,
      app: { rssBytes: app.rssBytes, cpu: app.cpu, processCount: app.processCount },
      total: { rssBytes: app.rssBytes + ownersBytes, processCount: app.processCount + ownersCount },
      measure: measureName(sizes),
    };
  }

  /**
   * Free space on the computer's disks, the one Switchboard and its projects
   * live on marked primary and listed first. macOS: the startup disk and every
   * disk the Finder shows; Windows: every local and removable drive; Linux:
   * the filesystems that hold `paths` (home, projects, the app). Disks only
   * local ones, so a network share that stopped answering cannot hang it.
   */
  async function disks({ paths = [], home = os.homedir() } = {}) {
    let list = [];
    try {
      if (platform === 'darwin') {
        const [df, mount] = await Promise.all([exec('df', ['-kPl'], { env }), exec('mount', [], { env })]);
        let rootName = 'Macintosh HD';
        try {
          for (const entry of await fs.promises.readdir('/Volumes')) {
            if (await fs.promises.readlink(`/Volumes/${entry}`).catch(() => null) === '/') rootName = entry;
          }
        } catch {}
        list = macDisks(parseDf(df), parseMountFlags(mount), rootName);
      } else if (platform === 'win32') {
        const script = 'Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or $_.DriveType -eq 3 } | ForEach-Object { "$($_.DeviceID)`t$($_.VolumeName)`t$($_.Size)`t$($_.FreeSpace)" }';
        list = parseWindowsDisks(await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]), path.win32.parse(home).root.slice(0, 2));
      } else {
        const wanted = [home, ...paths].filter(Boolean);
        let stdout = '';
        try { stdout = await exec('df', ['-kP', '--', ...wanted], { env }); } catch (err) { stdout = err?.stdout || ''; }
        const rows = parseDf(stdout);
        const seen = new Set();
        rows.forEach((row, i) => {
          if (seen.has(row.mount)) return;
          seen.add(row.mount);
          list.push({ name: row.mount, mount: row.mount, totalBytes: row.totalBytes, freeBytes: row.freeBytes, primary: i === 0 });
        });
      }
    } catch {}
    return list.sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  /** The owners alone, measured as usage() measures them. */
  async function measure(owners) {
    return (await usage(owners)).owners;
  }

  /**
   * The memory installed and in use on the whole computer. On macOS
   * os.freemem() counts only the pages nobody has touched, so it would show a
   * Mac nearly full: vm_stat counts it as Activity Monitor does instead.
   */
  async function systemMemory() {
    const totalBytes = totalmem();
    let usedBytes = null;
    try {
      if (platform === 'darwin') usedBytes = parseVmStat(await exec('vm_stat', [], { env }));
      else if (platform === 'linux') usedBytes = parseMeminfo(await readFile('/proc/meminfo'));
    } catch {}
    if (usedBytes === null) usedBytes = Math.max(0, totalBytes - freemem());
    return { totalBytes, usedBytes: Math.min(totalBytes, usedBytes) };
  }

  /**
   * Signal one process, but only one that is still under `rootPid` right now:
   * a pid from an older snapshot may since have been reused by anything.
   */
  async function killInTree(rootPid, pid, signal = 'SIGTERM') {
    const tree = collectTree(await snapshot(), rootPid);
    if (!tree.some(proc => proc.pid === pid)) return { ok: false, error: 'That process is no longer part of this session' };
    try {
      kill(pid, signal);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** SIGKILL the whole tree under `rootPid`, root included. */
  async function killTree(rootPid) {
    const tree = collectTree(await snapshot(), rootPid);
    if (!tree.length) return { ok: false, error: 'The process has already ended' };
    let killed = 0;
    for (const proc of killOrder(tree)) {
      try { kill(proc.pid, 'SIGKILL'); killed++; } catch {}
    }
    return { ok: true, killed };
  }

  /**
   * Stop an owner and make sure nothing of it is left behind. `stop` is its
   * own way out (the PTY hangup, the task stop); a child that ignores the
   * hangup, or runs in the background, would otherwise outlive the session as
   * an orphan nobody sees. So whatever of the tree taken before the stop is
   * still there after `graceMs` gets SIGTERM, and after `termMs` more SIGKILL.
   * A survivor must still carry its name, so a reused pid is never hit.
   */
  async function stopTree(rootPid, stop, { graceMs = 2500, termMs = 1500 } = {}) {
    const tree = collectTree(await snapshot(), rootPid);
    await stop();
    if (!tree.length) return { ok: true, terminated: 0, killed: 0 };
    const survivors = async () => {
      const now = await snapshot();
      return tree.filter(proc => now.get(proc.pid)?.name === proc.name);
    };
    await sleep(graceMs);
    let left = await survivors();
    for (const proc of killOrder(left)) { try { kill(proc.pid, 'SIGTERM'); } catch {} }
    const terminated = left.length;
    if (!left.length) return { ok: true, terminated: 0, killed: 0 };
    await sleep(termMs);
    left = await survivors();
    for (const proc of killOrder(left)) { try { kill(proc.pid, 'SIGKILL'); } catch {} }
    return { ok: true, terminated, killed: left.length };
  }

  return { snapshot, measure, usage, systemMemory, disks, killInTree, killTree, stopTree };
}

module.exports = {
  createProcessMonitor,
  parsePsTable,
  parseWindowsTable,
  parseCommandLines,
  parseFootprint,
  parseVmStat,
  parseMeminfo,
  parseDf,
  parseMountFlags,
  macDisks,
  parseWindowsDisks,
  collectTree,
  friendlyName,
  summarizeTree,
  killOrder,
};
