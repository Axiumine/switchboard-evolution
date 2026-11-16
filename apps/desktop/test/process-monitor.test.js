const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../process-monitor');

// launchd → zsh (session) → claude → two MCP servers, one of which runs vite.
const PS = [
  '    1     0   1000   0.0 Ss   /sbin/launchd',
  '  100     1  20000   1.5 Ss   /bin/zsh',
  '  101   100 400000  12.3 S+   /Users/me/.local/bin/claude',
  '  102   101  80000   0,5 S    /usr/local/bin/node',
  '  103   101  30000   0.0 S    /usr/bin/python3',
  '  104   102 250000  40.0 R    /Applications/Some App.app/Contents/MacOS/Some App',
  '  105   100      0   0.0 Z    <defunct>',
  '  200     1   5000   0.0 Ss   /bin/bash',
  'garbage line',
  '',
].join('\n');

test('ps output becomes a pid table, rss in bytes, names without their folder', () => {
  const table = parsePsTable(PS);
  assert.equal(table.size, 7);
  assert.equal(table.has(105), false, 'zombies are left out');
  assert.deepEqual(table.get(101), { pid: 101, ppid: 100, rssBytes: 400000 * 1024, cpu: 12.3, name: 'claude' });
  // A decimal comma still reads as a number; a name with spaces stays whole.
  assert.equal(table.get(102).cpu, 0.5);
  assert.equal(table.get(104).name, 'Some App');
});

test('the Windows query output becomes the same table, without CPU', () => {
  const table = parseWindowsTable('4\t0\t1024\tSystem\r\n900\t4\t2048\tclaude.exe\r\nnot a row\r\n');
  assert.deepEqual(table.get(900), { pid: 900, ppid: 4, rssBytes: 2048, cpu: null, name: 'claude.exe' });
  assert.equal(table.size, 2);
});

test('a tree is the root and every descendant, heaviest children first', () => {
  const tree = collectTree(parsePsTable(PS), 100);
  assert.deepEqual(tree.map(p => [p.pid, p.depth]), [[100, 0], [101, 1], [102, 2], [104, 3], [103, 2]]);
  assert.deepEqual(collectTree(parsePsTable(PS), 999), []);
  assert.deepEqual(collectTree(parsePsTable(PS), null), []);
});

test('a loop in the parent links cannot hang the walk', () => {
  const table = new Map([
    [1, { pid: 1, ppid: 2, rssBytes: 1, cpu: 0, name: 'a' }],
    [2, { pid: 2, ppid: 1, rssBytes: 1, cpu: 0, name: 'b' }],
  ]);
  assert.deepEqual(collectTree(table, 1).map(p => p.pid), [1, 2]);
});

test('a session costs the sum of its tree', () => {
  const summary = summarizeTree(collectTree(parsePsTable(PS), 100));
  assert.equal(summary.rssBytes, (20000 + 400000 + 80000 + 30000 + 250000) * 1024);
  assert.equal(summary.cpu, 54.3);
  assert.equal(summary.processCount, 5);
  assert.equal(summarizeTree([{ rssBytes: 5, cpu: null }]).cpu, null);
});

test('an interpreter is named after the script it runs', () => {
  assert.equal(friendlyName('node', 'node --max-old-space-size=4096 /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js --resume x'), 'node cli.js');
  assert.equal(friendlyName('node.exe', 'C:\\node.exe C:\\tools\\server.js'), 'node server.js');
  assert.equal(friendlyName('python3', 'python3 -m'), 'python3');
  assert.equal(friendlyName('claude', '/bin/claude --ide'), 'claude');
  assert.equal(friendlyName('node', null), 'node');
  assert.equal(friendlyName('node', 'node -e \\012const x = 1'), 'node');
  assert.equal(friendlyName('node', 'node -e const b=Buffer.alloc(300*1024*1024,1);'), 'node');
  assert.equal(friendlyName('python3', 'python3 -c import os; os.getcwd()'), 'python3');
  assert.equal(friendlyName('python3', 'python3 -m http.server 8000'), 'python3 http.server');
});

test('command lines are read per pid', () => {
  const lines = parseCommandLines('  101 /bin/claude --ide\n  102 node /x/server.js --port 3000\n');
  assert.equal(lines.get(102), 'node /x/server.js --port 3000');
});

test('the deepest processes are killed first', () => {
  const order = killOrder(collectTree(parsePsTable(PS), 100)).map(p => p.pid);
  assert.equal(order[0], 104);
  assert.equal(order[order.length - 1], 100);
});

function fakeMonitor(killed) {
  return createProcessMonitor({
    platform: 'darwin',
    exec: async (file, args) => {
      if (args.includes('pid=,args=')) return '  100 /bin/zsh -c claude\n  101 /bin/claude --ide\n  102 node /x/mcp.js\n';
      return PS;
    },
    kill: (pid, signal) => killed.push([pid, signal]),
  });
}

test('owners are measured over their trees and sorted heaviest first', async () => {
  const monitor = fakeMonitor([]);
  const result = await monitor.measure([
    { id: 'light', pid: 200 },
    { id: 'heavy', pid: 100 },
    { id: 'gone', pid: 999 },
  ]);
  assert.deepEqual(result.map(o => o.id), ['heavy', 'light', 'gone']);
  assert.equal(result[0].processCount, 5);
  assert.equal(result[0].processes[2].label, 'node mcp.js');
  assert.equal(result[2].found, false);
  assert.equal(result[2].rssBytes, 0);
});

test('only a process still inside the session can be killed', async () => {
  const killed = [];
  const monitor = fakeMonitor(killed);
  assert.deepEqual(await monitor.killInTree(100, 104), { ok: true });
  assert.equal((await monitor.killInTree(100, 200)).ok, false);
  assert.equal((await monitor.killInTree(100, 1)).ok, false);
  assert.deepEqual(killed, [[104, 'SIGTERM']]);
});

test('a forced stop kills the whole tree, root last', async () => {
  const killed = [];
  const monitor = fakeMonitor(killed);
  assert.deepEqual(await monitor.killTree(100), { ok: true, killed: 5 });
  assert.deepEqual(killed.map(([pid]) => pid).sort(), [100, 101, 102, 103, 104]);
  assert.ok(killed.every(([, signal]) => signal === 'SIGKILL'));
  assert.deepEqual(killed[killed.length - 1], [100, 'SIGKILL']);
  assert.equal((await monitor.killTree(999)).ok, false);
});

test('stopping leaves no orphan: what ignores the hangup gets SIGTERM, then SIGKILL', async () => {
  // After the stop the shell (100) and claude (101) are gone; node (102) was
  // reparented to launchd and keeps running; python (103) ends on SIGTERM.
  const after = PS.split('\n').filter(l => !/^\s*(100|101) /.test(l)).map(l => l.replace(/^(\s*102\s+)101/, '$1  1')).join('\n');
  const stages = [PS, after, after.split('\n').filter(l => !/^\s*103 /.test(l)).join('\n')];
  let snap = 0;
  const killed = [];
  const steps = [];
  const monitor = createProcessMonitor({
    platform: 'darwin',
    exec: async () => stages[Math.min(snap++, stages.length - 1)],
    kill: (pid, signal) => killed.push([pid, signal]),
    sleep: async (ms) => steps.push(ms),
  });
  let stopped = false;
  const result = await monitor.stopTree(100, () => { stopped = true; }, { graceMs: 10, termMs: 20 });
  assert.equal(stopped, true);
  assert.deepEqual(steps, [10, 20]);
  assert.deepEqual(result, { ok: true, terminated: 3, killed: 2 });
  assert.deepEqual(killed.filter(([, s]) => s === 'SIGTERM').map(([pid]) => pid).sort(), [102, 103, 104]);
  assert.deepEqual(killed.filter(([, s]) => s === 'SIGKILL').map(([pid]) => pid).sort(), [102, 104]);
});

test('a clean stop signals nothing, and a reused pid is never hit', async () => {
  const gone = PS.split('\n').filter(l => !/^\s*10\d /.test(l));
  // pid 102 now belongs to something else entirely.
  gone.push('  102     1   9000   0.0 S    /usr/bin/unrelated');
  const stages = [PS, gone.join('\n')];
  let snap = 0;
  const killed = [];
  const monitor = createProcessMonitor({
    platform: 'darwin',
    exec: async () => stages[Math.min(snap++, stages.length - 1)],
    kill: (pid, signal) => killed.push([pid, signal]),
    sleep: async () => {},
  });
  assert.deepEqual(await monitor.stopTree(100, () => {}), { ok: true, terminated: 0, killed: 0 });
  assert.deepEqual(killed, []);
});

// --- Memory: footprint on macOS, the app and its terminal host, the whole computer ---

// The app (300) with a window helper (301) and a node-pty shell (302, a
// session); herdr-core (400 → 401) hosting another session (402 → 403).
const APP_PS = [
  '    1     0   1000   0.0 Ss   /sbin/launchd',
  '  300     1 100000   2.0 S    /Applications/Switchboard.app/Contents/MacOS/Switchboard',
  '  301   300 200000   1.0 S    /Applications/Switchboard.app/Contents/Frameworks/Switchboard Helper (Renderer).app/Contents/MacOS/Switchboard Helper (Renderer)',
  '  302   300  10000   0.0 Ss   /bin/zsh',
  '  304   300    900   0.0 R    ps',
  '  400     1   8000   0.0 S    /Users/me/Library/Application Support/switchboard/hc/0.1.21/herdr-core',
  '  401   400   9000   0.0 S    /Users/me/Library/Application Support/switchboard/hc/0.1.21/herdr-core',
  '  402   401 300000   5.0 S    /Users/me/.local/bin/claude',
  '  403   402  50000   0.0 S    /usr/local/bin/node',
].join('\n');

const FOOTPRINT = (sizes) => Object.entries(sizes)
  .map(([pid, bytes]) => `x [${pid}]: 64-bit    Footprint: ${bytes} B (16384 bytes per page)`).join('\n') + '\nSummary Footprint: 1 B\n';

test('footprint output becomes pid → bytes, the summary left out', () => {
  const sizes = parseFootprint('claude [22038]: 64-bit    Footprint: 495863464 B (16384 bytes per page)\n'
    + 'Some App [9]: 64-bit    Footprint: 12 B (16384 bytes per page)\nSummary Footprint: 1018469456 B\n');
  assert.deepEqual([...sizes], [[22038, 495863464], [9, 12]]);
});

test('vm_stat gives the memory in use as Activity Monitor counts it', () => {
  const out = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                                     4497.',
    'Pages wired down:                             279969.',
    'Pages purgeable:                                   6.',
    'File-backed pages:                            287669.',
    'Anonymous pages:                              524259.',
    'Pages occupied by compressor:                 959279.',
  ].join('\n');
  assert.equal(parseVmStat(out), (524259 - 6 + 279969 + 959279) * 16384);
  assert.equal(parseVmStat('nonsense'), null);
});

test('/proc/meminfo gives all of the memory but what is available', () => {
  assert.equal(parseMeminfo('MemTotal:       16000000 kB\nMemFree:  100 kB\nMemAvailable:    6000000 kB\n'), 10000000 * 1024);
  assert.equal(parseMeminfo('MemTotal: 1 kB\n'), null);
});

function usageMonitor({ platform = 'darwin', footprint = null, calls = [], clock = { now: 0 } } = {}) {
  return createProcessMonitor({
    platform,
    now: () => clock.now,
    exec: async (file, args) => {
      calls.push(file);
      if (file === 'footprint') {
        if (!footprint) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        const asked = args.filter((_, i) => args[i - 1] === '-p').map(Number);
        return FOOTPRINT(Object.fromEntries(asked.filter(pid => footprint[pid]).map(pid => [pid, footprint[pid]])));
      }
      if (args.includes('pid=,args=')) return '';
      return APP_PS;
    },
  });
}

test('the app is its own tree less the sessions, plus the herdr-core that hosts sessions', async () => {
  const monitor = usageMonitor({ platform: 'linux' });
  const result = await monitor.usage([{ id: 'pty', pid: 302 }, { id: 'hc', pid: 402 }], { appPid: 300, hostNames: ['herdr-core'] });
  assert.equal(result.measure, 'rss');
  // 300 + 301 (not the session's shell, not ps) + both herdr-core processes.
  assert.equal(result.app.processCount, 4);
  assert.equal(result.app.rssBytes, (100000 + 200000 + 8000 + 9000) * 1024);
  assert.deepEqual(result.owners.map(o => o.id), ['hc', 'pty']);
  assert.equal(result.owners[0].rssBytes, 350000 * 1024);
  assert.equal(result.total.rssBytes, result.app.rssBytes + (350000 + 10000) * 1024);
  assert.equal(result.total.processCount, 4 + 3);
});

test('on macOS each process counts its footprint, read again only after a few seconds', async () => {
  const calls = [];
  const clock = { now: 0 };
  const footprint = { 300: 1000, 301: 2000, 302: 30, 400: 40, 401: 50, 402: 7000, 403: 800 };
  const monitor = usageMonitor({ footprint, calls, clock });
  const owners = [{ id: 'hc', pid: 402 }];
  const first = await monitor.usage(owners, { appPid: 300, hostNames: ['herdr-core'] });
  assert.equal(first.measure, 'footprint');
  assert.equal(first.owners[0].rssBytes, 7800);
  // 300, 301, the shell 302 (no owner here), 400, 401.
  assert.equal(first.app.rssBytes, 1000 + 2000 + 30 + 40 + 50);

  clock.now = 3000;
  await monitor.usage(owners, { appPid: 300, hostNames: ['herdr-core'] });
  assert.equal(calls.filter(f => f === 'footprint').length, 1);
  clock.now = 6000;
  await monitor.usage(owners, { appPid: 300, hostNames: ['herdr-core'] });
  assert.equal(calls.filter(f => f === 'footprint').length, 2);
});

test('without the footprint tool a Mac falls back to the resident size', async () => {
  const monitor = usageMonitor({ footprint: null });
  const result = await monitor.usage([{ id: 'hc', pid: 402 }], { appPid: 300 });
  assert.equal(result.measure, 'rss');
  assert.equal(result.owners[0].rssBytes, 350000 * 1024);
});

test('the memory in use: vm_stat on macOS, never the free pages alone', async () => {
  const mac = createProcessMonitor({
    platform: 'darwin',
    totalmem: () => 32 * 2 ** 30,
    freemem: () => 70 * 2 ** 20,
    exec: async () => 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages wired down: 1000.\nAnonymous pages: 3000.\nPages purgeable: 0.\nPages occupied by compressor: 2000.\n',
  });
  assert.deepEqual(await mac.systemMemory(), { totalBytes: 32 * 2 ** 30, usedBytes: 6000 * 16384 });

  const linux = createProcessMonitor({
    platform: 'linux',
    totalmem: () => 16000000 * 1024,
    readFile: async () => 'MemTotal: 16000000 kB\nMemAvailable: 6000000 kB\n',
  });
  assert.equal((await linux.systemMemory()).usedBytes, 10000000 * 1024);

  const windows = createProcessMonitor({ platform: 'win32', totalmem: () => 1000, freemem: () => 250 });
  assert.equal((await windows.systemMemory()).usedBytes, 750);
});

// --- Free disk space ---

const MAC_DF = [
  'Filesystem     1024-blocks      Used Available Capacity  Mounted on',
  '/dev/disk3s1s1   482797652  12348196  17515580    42%    /',
  'devfs                  227       227         0   100%    /dev',
  '/dev/disk3s5     482797652 427177464  17515580    97%    /System/Volumes/Data',
  'map auto_home            0         0         0   100%    /System/Volumes/Data/home',
  '/dev/disk7s1      17639424  17136884    457296    98%    /Library/Developer/CoreSimulator/Volumes/iOS_23E244',
  '/dev/disk8s1    1953514552 953514552 1000000000    49%    /Volumes/Backup Disk',
  '/dev/disk9s1        204800    204000       800   100%    /Volumes/Some Installer',
].join('\n');

const MAC_MOUNT = [
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
  '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)',
  '/dev/disk8s1 on /Volumes/Backup Disk (apfs, local, nodev, nosuid, journaled, noowners)',
  '/dev/disk9s1 on /Volumes/Some Installer (hfs, local, nodev, nosuid, read-only, noowners, quarantine, mounted by me)',
].join('\n');

test('df lines keep names and mount points with spaces', () => {
  const rows = parseDf(MAC_DF);
  assert.equal(rows.find(r => r.mount === '/Volumes/Backup Disk').freeBytes, 1000000000 * 1024);
  assert.equal(rows.find(r => r.mount === '/System/Volumes/Data/home').filesystem, 'map auto_home');
});

test('a Mac lists its startup disk and the disks the Finder shows, nothing else', () => {
  const disks = macDisks(parseDf(MAC_DF), parseMountFlags(MAC_MOUNT), 'Macintosh HD');
  assert.deepEqual(disks.map(d => [d.name, d.primary]), [['Macintosh HD', true], ['Backup Disk', false]]);
  assert.equal(disks[0].freeBytes, 17515580 * 1024);
});

test('Windows lists its drives by label, the home drive first', async () => {
  const out = 'C:\tWindows\t511101108224\t120000000000\r\nD:\t\t1000202039296\t900000000000\r\ngarbage\r\n';
  const disks = parseWindowsDisks(out, 'C:');
  assert.deepEqual(disks.map(d => [d.name, d.primary]), [['Windows (C:)', true], ['D:', false]]);

  const monitor = createProcessMonitor({ platform: 'win32', exec: async () => out.replace(/^C:.*\r\n/, '') + 'C:\tWindows\t5\t1\r\n' });
  assert.deepEqual((await monitor.disks({ home: 'C:\\Users\\me' })).map(d => d.name), ['Windows (C:)', 'D:']);
});

test('Linux lists the filesystems of home, the projects and the app, each once', async () => {
  const asked = [];
  const monitor = createProcessMonitor({
    platform: 'linux',
    exec: async (file, args) => {
      asked.push(args);
      return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
        + '/dev/sda2 100 40 60 40% /home\n/dev/sda2 100 40 60 40% /home\n/dev/sda1 50 45 5 90% /\n';
    },
  });
  const disks = await monitor.disks({ home: '/home/me', paths: ['/home/me/projects', '/opt/Switchboard'] });
  assert.deepEqual(asked[0], ['-kP', '--', '/home/me', '/home/me/projects', '/opt/Switchboard']);
  assert.deepEqual(disks.map(d => [d.name, d.primary, d.freeBytes]), [['/home', true, 60 * 1024], ['/', false, 5 * 1024]]);
});
