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

test('getSlugSessions lists the sessions with a slug, with their project filing and archive flag', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-plans-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rows = run(`
    const db = require(${dbPath});
    db.upsertCachedSessions([
      { sessionId: 's1', folder: 'f', projectPath: '/work/app', slug: 'brave-otter', created: '2026-01-31T00:00:00Z', modified: '2026-02-01T00:00:00Z' },
      { sessionId: 's2', folder: 'f', projectPath: '/work/site', slug: 'quiet-fox', modified: '2026-03-01T00:00:00Z' },
      { sessionId: 's3', folder: 'f', projectPath: '/work/none', slug: null, modified: '2026-03-01T00:00:00Z' },
      { sessionId: 's4', folder: 'f', projectPath: '/work/codex', slug: '', modified: '2026-03-01T00:00:00Z', runtime: 'codex' },
    ]);
    db.setArchived('s1', true);
    db.setSessionAssignment('s2', 'p-site', null);
    console.log(JSON.stringify(db.getSlugSessions().sort((a, b) => a.sessionId.localeCompare(b.sessionId))));
  `, dir);
  assert.deepEqual(rows, [
    { slug: 'brave-otter', sessionId: 's1', projectPath: '/work/app', created: '2026-01-31T00:00:00Z', modified: '2026-02-01T00:00:00Z', projectId: null, archived: true },
    { slug: 'quiet-fox', sessionId: 's2', projectPath: '/work/site', created: null, modified: '2026-03-01T00:00:00Z', projectId: 'p-site', archived: false },
  ]);
});
