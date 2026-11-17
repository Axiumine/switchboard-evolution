const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDiskUsage, summarize, duBytes, walkBytes } = require('../disk-usage');

function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-disk-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dir = (...parts) => {
    const p = path.join(temp, ...parts);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  return { temp, dir };
}

test('a project counts its folder and attached folders once, nested ones included', (t) => {
  const { dir } = fixture(t);
  const root = dir('projects', 'demo');
  const checkout = dir('projects', 'demo', 'repos', 'app');
  const work = dir('work');
  const inner = dir('work', 'api');
  const sizes = new Map([[root, 100], [checkout, 40], [work, 500], [inner, 200]]);
  const { projects, totalBytes } = summarize([{ id: 'p', name: 'Demo', root, folders: [checkout, work, inner] }], sizes);
  const [demo] = projects;
  assert.equal(demo.bytes, 600, 'the root (with its checkout) and work (with api)');
  assert.equal(demo.ringBytes, 600);
  assert.equal(totalBytes, 600);
  const byName = Object.fromEntries(demo.folders.map(f => [f.name, f]));
  assert.equal(byName.demo.isRoot, true);
  assert.equal(byName.app.inside, 'demo');
  assert.equal(byName.api.inside, 'work');
  assert.equal(byName.work.inside, null);
  assert.deepEqual(byName.api.alsoIn, []);
});

test('a folder attached to two projects goes in the ring once, to the larger project', (t) => {
  const { dir } = fixture(t);
  const a = dir('projects', 'a');
  const b = dir('projects', 'b');
  const shared = dir('shared');
  const sub = dir('shared', 'sub');
  const sizes = new Map([[a, 10], [b, 5], [shared, 300], [sub, 100]]);
  const { projects, totalBytes } = summarize([
    { id: 'a', name: 'Alpha', root: a, folders: [shared] },
    { id: 'b', name: 'Beta', root: b, folders: [sub] },
  ], sizes);
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  assert.equal(byId.a.bytes, 310);
  assert.equal(byId.b.bytes, 105, 'its own size still counts the folder');
  assert.equal(byId.a.ringBytes, 310);
  assert.equal(byId.b.ringBytes, 5, 'sub is already in Alpha\'s shared folder');
  assert.equal(totalBytes, 315);
  assert.deepEqual(byId.b.folders.find(f => f.name === 'sub').alsoIn, ['Alpha']);
  assert.deepEqual(projects.map(p => p.id), ['a', 'b'], 'largest first');
});

test('missing folders are skipped and unmeasured ones count as nothing', (t) => {
  const { dir, temp } = fixture(t);
  const root = dir('p');
  const { projects } = summarize([{ id: 'p', name: 'P', root, folders: [path.join(temp, 'gone')] }], new Map([[root, null]]));
  assert.equal(projects[0].bytes, 0);
  assert.equal(projects[0].folders.length, 1);
  assert.equal(projects[0].folders[0].bytes, null);
});

test('get answers at once, measures in the background and keeps the result', async (t) => {
  const { dir } = fixture(t);
  const root = dir('p');
  let calls = 0;
  let clock = 1000;
  const usage = createDiskUsage({
    listProjects: () => [{ id: 'p', name: 'P', root, folders: [] }],
    measure: async () => { calls++; return 2048; },
    now: () => clock,
    maxAgeMs: 100,
  });
  const first = usage.get();
  assert.equal(first.measuring, true);
  assert.equal(first.projects, null);
  await usage.idle();
  const second = usage.get();
  assert.equal(second.measuring, false);
  assert.equal(second.projects[0].bytes, 2048);
  assert.equal(calls, 1);
  clock += 50;
  usage.get();
  assert.equal(calls, 1, 'still fresh');
  usage.get({ force: true });
  await usage.idle();
  assert.equal(calls, 2, 'Measure again');
  clock += 500;
  assert.equal(usage.get().measuring, true, 'old: measured again');
  await usage.idle();
  assert.equal(calls, 3);
});

test('du and the walk measure a real folder', async (t) => {
  const { dir } = fixture(t);
  const d = dir('m');
  fs.writeFileSync(path.join(d, 'a.bin'), Buffer.alloc(64 * 1024));
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'b.bin'), Buffer.alloc(32 * 1024));
  assert.equal(await walkBytes(d), 96 * 1024);
  if (process.platform !== 'win32') assert.ok((await duBytes(d)) >= 96 * 1024);
});
