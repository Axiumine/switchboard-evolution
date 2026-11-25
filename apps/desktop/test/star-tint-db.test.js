const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
// better-sqlite3 is built for Electron's ABI: db.js runs under Electron-as-Node.
const electronBin = require('electron');

function run(code, dataDir) {
  const r = spawnSync(electronBin, ['-e', code], {
    cwd: APP_DIR,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SWITCHBOARD_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const dbPath = JSON.stringify(path.join(APP_DIR, 'db.js'));

test('a pin gets a tint no other pinned session has, and an unpin drops it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-star-'));
  const out = run(`
    const db = require(${dbPath});
    const pins = ['a', 'b', 'c', 'd', 'e'].map(id => db.toggleStar(id));
    const unpin = db.toggleStar('c');
    const again = db.toggleStar('c');
    console.log(JSON.stringify({ pins, unpin, again, stored: db.getMeta('c').starTint }));
  `, dir);
  for (const pin of out.pins) {
    assert.equal(pin.starred, 1);
    assert.ok(Number.isInteger(pin.starTint) && pin.starTint >= 0 && pin.starTint < 10);
  }
  assert.equal(new Set(out.pins.map(p => p.starTint)).size, 5);
  assert.deepEqual(out.unpin, { starred: 0, starTint: null });
  assert.equal(out.again.starred, 1);
  // Pinned again, it does not take a color the four others still have.
  const others = out.pins.filter((_, i) => i !== 2).map(p => p.starTint);
  assert.ok(!others.includes(out.again.starTint));
  assert.equal(out.stored, out.again.starTint);
});

test('sessions pinned before tints existed get different ones when the database opens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-star-'));
  // An older database: session_meta without the starTint column, three pins and one not.
  run(`
    const Database = require('better-sqlite3');
    const db = new Database(require('path').join(process.env.SWITCHBOARD_DATA_DIR, 'switchboard.db'));
    db.exec('CREATE TABLE session_meta (sessionId TEXT PRIMARY KEY, name TEXT, starred INTEGER DEFAULT 0, archived INTEGER DEFAULT 0)');
    const add = db.prepare('INSERT INTO session_meta (sessionId, starred) VALUES (?, ?)');
    add.run('one', 1); add.run('two', 1); add.run('three', 1); add.run('loose', 0);
    console.log('{}');
  `, dir);
  const out = run(`
    const db = require(${dbPath});
    console.log(JSON.stringify(['one', 'two', 'three', 'loose'].map(id => db.getMeta(id).starTint)));
  `, dir);
  const [one, two, three, loose] = out;
  assert.equal(new Set([one, two, three]).size, 3);
  for (const tint of [one, two, three]) assert.ok(Number.isInteger(tint));
  assert.equal(loose, null);
});

test('pinned sessions keep the order they are dragged into, and an unpin forgets its place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-star-'));
  const out = run(`
    const db = require(${dbPath});
    for (const id of ['a', 'b', 'c']) db.toggleStar(id);
    const fresh = ['a', 'b', 'c'].map(id => db.getMeta(id).pinRank);
    // 'loose' is not pinned: an order never gives it a rank.
    db.setPinnedOrder(['c', 'a', 'loose', 'b']);
    const ordered = ['a', 'b', 'c', 'loose'].map(id => db.getMeta(id)?.pinRank ?? null);
    db.toggleStar('a');
    const unpinned = db.getMeta('a').pinRank;
    db.toggleStar('a');
    const again = db.getMeta('a').pinRank;
    console.log(JSON.stringify({ fresh, ordered, unpinned, again }));
  `, dir);
  assert.deepEqual(out.fresh, [null, null, null], 'a new pin has no place until the first drag');
  assert.deepEqual(out.ordered, [1, 3, 0, null]);
  assert.equal(out.unpinned, null);
  assert.equal(out.again, null, 'pinned again, it goes after the ordered ones');
});

test('a database from before the order gets the pinRank and starRank columns, empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-star-'));
  run(`
    const Database = require('better-sqlite3');
    const db = new Database(require('path').join(process.env.SWITCHBOARD_DATA_DIR, 'switchboard.db'));
    db.exec('CREATE TABLE session_meta (sessionId TEXT PRIMARY KEY, name TEXT, starred INTEGER DEFAULT 0, archived INTEGER DEFAULT 0)');
    db.prepare('INSERT INTO session_meta (sessionId, starred) VALUES (?, 1)').run('old');
    console.log('{}');
  `, dir);
  const out = run(`
    const db = require(${dbPath});
    console.log(JSON.stringify({ meta: db.getMeta('old') }));
  `, dir);
  assert.equal(out.meta.starred, 1);
  assert.equal(out.meta.pinRank, null);
});
