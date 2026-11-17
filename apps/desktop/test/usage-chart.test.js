const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLORS, formatBytes, formatDisk, formatPercent, memoryTotals, assignColors, memorySlices,
  diskLevel, diskSlices, donutPaths, resourceStatus,
} = require('../public/usage-chart');

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function owner(id, gb, extra = {}) {
  return { kind: 'session', id, rssBytes: gb * GB, processCount: 2, ...extra };
}

function usage(extra = {}) {
  return {
    platform: 'darwin',
    totalMemBytes: 36 * GB,
    usedMemBytes: 27.4 * GB,
    app: { rssBytes: 1 * GB, processCount: 5 },
    switchboard: { rssBytes: 4 * GB, processCount: 11 },
    owners: [owner('a', 2), owner('b', 1, { kind: 'task' })],
    disks: [{ name: 'Macintosh HD', mount: '/', totalBytes: 994e9, freeBytes: 582e9, primary: true }],
    ...extra,
  };
}

const sum = (slices) => slices.reduce((total, slice) => total + slice.bytes, 0);

test('formatters keep the units the Task Manager used', () => {
  assert.equal(formatBytes(0), '0 MB');
  assert.equal(formatBytes(512 * MB), '512 MB');
  assert.equal(formatBytes(1.5 * GB), '1.50 GB');
  assert.equal(formatBytes(27.4 * GB), '27.4 GB');
  assert.equal(formatDisk(994e9, 'darwin'), '994 GB');
  assert.equal(formatDisk(2.2e12, 'darwin'), '2.20 TB');
  assert.equal(formatDisk(50 * GB, 'linux'), '50.0 GB');
  assert.equal(formatDisk(120000, 'darwin'), '120 KB');
  assert.equal(formatDisk(5e6, 'darwin'), '5 MB');
  assert.equal(formatDisk(0, 'darwin'), '0 KB');
  assert.equal(formatPercent(3, 4), '75%');
  assert.equal(formatPercent(1, 40), '2.5%');
  assert.equal(formatPercent(1, 0), '');
  assert.equal(formatPercent(1, 10000), '<0.1%');
  assert.equal(formatPercent(0, 10), '0.0%');
});

test('memoryTotals clamps what is in use between Switchboard and the installed memory', () => {
  const totals = memoryTotals(usage());
  assert.equal(totals.ours, 4 * GB);
  assert.equal(totals.used, 27.4 * GB);
  assert.equal(totals.free, 36 * GB - 27.4 * GB);
  assert.deepEqual([totals.sessions, totals.tasks, totals.processes], [1, 1, 11]);
  assert.equal(memoryTotals(usage({ usedMemBytes: 1 * GB })).used, 4 * GB, 'never below Switchboard');
  assert.equal(memoryTotals(usage({ usedMemBytes: 99 * GB })).used, 36 * GB, 'never past installed');
});

test('memoryTotals works with a desktop too old to send used memory or its own total', () => {
  const totals = memoryTotals(usage({ usedMemBytes: undefined, switchboard: undefined }));
  assert.equal(totals.used, null);
  assert.equal(totals.free, null);
  assert.equal(totals.ours, 1 * GB + 3 * GB, 'app plus every owner');
  assert.equal(totals.processes, 5 + 4);
});

test('memorySlices draws the app, each owner, other apps and free, adding up to the installed memory', () => {
  const { slices, total } = memorySlices(usage(), { labelFor: (o) => `S ${o.id}` });
  assert.deepEqual(slices.map(s => s.key), ['app', 'session:a', 'task:b', 'other-apps', 'free']);
  assert.deepEqual(slices.map(s => s.label), ['Switchboard', 'S a', 'S b', 'Other apps', 'Free']);
  assert.equal(slices[0].bytes, 1 * GB, 'the app is Switchboard minus its sessions');
  assert.equal(slices[3].bytes, 27.4 * GB - 4 * GB);
  assert.equal(sum(slices), 36 * GB);
  assert.equal(total, 36 * GB);
  assert.equal(slices[0].color, COLORS.app);
  assert.equal(slices[4].color, COLORS.free);
});

test('memorySlices folds the owners past the largest five into one slice', () => {
  const owners = [1, 2, 3, 4, 5, 6, 7].map(n => owner(`s${n}`, n / 10));
  const { slices } = memorySlices(usage({ owners, switchboard: { rssBytes: 4 * GB, processCount: 20 } }));
  const keys = slices.map(s => s.key);
  assert.deepEqual(keys.slice(1, 6), ['session:s7', 'session:s6', 'session:s5', 'session:s4', 'session:s3']);
  const other = slices.find(s => s.key === 'other-owners');
  assert.equal(other.label, '2 others');
  assert.ok(Math.abs(other.bytes - 0.3 * GB) < 1);
  assert.equal(other.color, COLORS.otherOwners);
  assert.equal(sum(slices), 36 * GB);
});

test('memorySlices without used memory has no other apps and frees the rest', () => {
  const { slices } = memorySlices(usage({ usedMemBytes: undefined }));
  assert.equal(slices.some(s => s.key === 'other-apps'), false);
  assert.equal(slices.at(-1).bytes, 36 * GB - 4 * GB);
});

test('a session keeps its colour when its rank changes, a new one takes a free colour', () => {
  const first = memorySlices(usage({ owners: [owner('a', 2), owner('b', 1)] }));
  const colorOf = (result, key) => result.slices.find(s => s.key === key).color;
  const second = memorySlices(usage({ owners: [owner('b', 3), owner('a', 2), owner('c', 1)] }), { previous: first.colors });
  assert.equal(colorOf(second, 'session:a'), colorOf(first, 'session:a'));
  assert.equal(colorOf(second, 'session:b'), colorOf(first, 'session:b'));
  assert.equal(colorOf(second, 'session:c'), COLORS.owners[2]);
  assert.deepEqual(assignColors({ x: 0, y: 0 }, ['x', 'y'], 5), { x: 0, y: 1 }, 'no two keys share a colour');
  assert.deepEqual(assignColors(null, ['b', 'a'], 5), assignColors(null, ['a', 'b'], 5), 'without memory, colours go by key, not by rank');
});

test('diskSlices: used then free, coloured by how full the disk is', () => {
  const ok = diskSlices({ totalBytes: 100, freeBytes: 60 });
  assert.deepEqual(ok.slices.map(s => [s.key, s.bytes]), [['used', 40], ['free', 60]]);
  assert.equal(ok.slices[0].color, COLORS.diskLow);
  assert.equal(diskSlices({ totalBytes: 100, freeBytes: 15 }).slices[0].color, COLORS.diskMid);
  assert.equal(diskSlices({ totalBytes: 100, freeBytes: 5 }).level, 'high');
  assert.deepEqual(diskLevel({ totalBytes: 0, freeBytes: 0 }), { used: 0, level: 'low' });
});

test('donutPaths: one path per visible slice, none for zero, a whole ring in two halves', () => {
  const paths = donutPaths([{ key: 'a', bytes: 1 }, { key: 'b', bytes: 0 }, { key: 'c', bytes: 3 }], { size: 100, thickness: 10 });
  assert.deepEqual(paths.map(p => p.key), ['a', 'c']);
  for (const { d } of paths) assert.match(d, /^M[\d. -]+A50 50 0 [01] 1 [\d. -]+L[\d. -]+A40 40 0 [01] 0 [\d. -]+Z$/);
  // The quarter starts at the top, just after the gap.
  assert.match(paths[0].d, /^M51 0/);
  const whole = donutPaths([{ key: 'only', bytes: 5 }], { size: 100, thickness: 10 });
  assert.equal(whole.length, 1);
  assert.equal(whole[0].d.match(/M/g).length, 2);
  assert.deepEqual(donutPaths([{ key: 'z', bytes: 0 }]), []);
});

test('resourceStatus: three RAM figures and the main disk, as the status bar shows them', () => {
  const status = resourceStatus(usage());
  assert.equal(status.ram, 'RAM 4 / 27.4 / 36 GB');
  assert.equal(status.disk, 'Disk 412 / 994 GB');
  assert.match(status.title, /^RAM: Switchboard and its sessions 4.00 GB · in use on this computer 27.4 GB · installed 36.0 GB\nDisk \(Macintosh HD\): 412 GB used of 994 GB · 582 GB free$/);
});

test('resourceStatus with an old desktop, a big disk, and nothing to say', () => {
  const old = resourceStatus(usage({ usedMemBytes: undefined, disks: undefined }));
  assert.equal(old.ram, 'RAM 4 / 36 GB');
  assert.equal(old.disk, '');
  const big = resourceStatus(usage({ disks: [{ name: 'Data', totalBytes: 2e12, freeBytes: 0.8e12 }] }));
  assert.equal(big.disk, 'Disk 1.2 / 2 TB');
  const linux = resourceStatus(usage({ platform: 'linux', disks: [{ totalBytes: 50 * GB, freeBytes: 20 * GB }] }));
  assert.equal(linux.disk, 'Disk 30 / 50 GB');
  assert.deepEqual(resourceStatus(null), { ram: '', disk: '', title: '' });
});

test('donutPaths keeps a sliver for a tiny slice, taken from the large ones', () => {
  const paths = donutPaths([{ key: 'big', bytes: 1000 }, { key: 'tiny', bytes: 1 }, { key: 'rest', bytes: 999 }], { size: 120, thickness: 14 });
  assert.deepEqual(paths.map(p => p.key), ['big', 'tiny', 'rest']);
});

test('diskSlices with project sizes: the largest projects, the others, other files and free', () => {
  const projects = [
    { id: 'a', name: 'Alpha', bytes: 120, ringBytes: 120 },
    { id: 'b', name: 'Beta', bytes: 80, ringBytes: 30 },
    ...[1, 2, 3, 4, 5].map(n => ({ id: `x${n}`, name: `X${n}`, bytes: n, ringBytes: n })),
  ];
  const { slices, colors } = diskSlices({ totalBytes: 1000, freeBytes: 600 }, { projects });
  assert.deepEqual(slices.map(s => s.key), ['project:a', 'project:b', 'project:x5', 'project:x4', 'project:x3', 'other-projects', 'other-files', 'free']);
  assert.equal(slices[1].bytes, 30, 'the ring counts a shared folder once');
  assert.equal(slices[1].display, 80, 'the legend shows the project\'s own size');
  assert.equal(slices.find(s => s.key === 'other-projects').label, '2 other projects');
  assert.equal(slices.find(s => s.key === 'other-files').bytes, 400 - (120 + 30 + 5 + 4 + 3 + 3));
  assert.equal(sum(slices), 1000);
  const again = diskSlices({ totalBytes: 1000, freeBytes: 600 }, { projects: [projects[1], { ...projects[0], ringBytes: 10 }], previous: colors });
  assert.equal(again.slices.find(s => s.key === 'project:a').color, slices[0].color, 'colours follow the project');
});

test('diskSlices never lets projects take more than what is used', () => {
  const { slices } = diskSlices({ totalBytes: 100, freeBytes: 90 }, { projects: [{ id: 'a', name: 'A', bytes: 40, ringBytes: 40 }] });
  assert.equal(slices[0].bytes, 10);
  assert.equal(slices.find(s => s.key === 'other-files').bytes, 0);
  assert.equal(sum(slices), 100);
  assert.deepEqual(diskSlices({ totalBytes: 100, freeBytes: 90 }, { projects: [] }).slices.map(s => s.key), ['used', 'free']);
});
