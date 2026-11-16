const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = between('/** The .jsonl files of a Claude project folder', "ipcMain.handle('get-terminal-engine'");

/** adoptHcSessions against stubs: `records` is what hc lists. */
async function adopt(records, { active = new Map(), meta = {} } = {}) {
  const wired = [];
  const adopted = [];
  const context = vm.createContext({
    path, fs, process: { platform: 'darwin' },
    PROJECTS_DIR: '/nonexistent', DEFAULT_HARNESS: 'claude',
    readHead: () => '',
    encodeProjectPath: p => p.replace(/\//g, '-'),
    getHarness: id => ({ id }),
    getMeta: id => meta[id] || null,
    createTerminalActivity: opts => ({ opts }),
    startTerminalActivitySweep: () => {},
    activeSessions: active,
    wireSessionPty: (id, session, harness) => wired.push({ id, harness: harness?.id || null }),
    log: { info() {}, error() {} },
    hcEngine: {
      list: async () => records,
      adopt: async (record, opts) => { adopted.push({ address: record.address, history: opts.history }); return { address: record.address }; },
    },
  });
  vm.runInContext(code, context);
  await context.adoptHcSessions();
  return { active, wired, adopted };
}

test('a kept CLI session is rebuilt from its labels and wired like a new one', async () => {
  const { active, wired, adopted } = await adopt([{
    address: 't3', cwd: '/src/api', created_ms: 1000,
    labels: { app: 'switchboard', sid: 'abc', kind: 'cli', runtime: 'codex', projectPath: '/src/api', projectId: 'p1', trackId: 't1', openedAt: '5000', pendingTag: 'switchboard_abc', pendingSpawnedAt: '4000' },
  }]);
  const s = active.get('abc');
  assert.equal(s.runtime, 'codex');
  assert.equal(s.isPlainTerminal, false);
  assert.equal(s.projectPath, '/src/api');
  assert.equal(s.projectId, 'p1');
  assert.equal(s.trackId, 't1');
  assert.equal(s._openedAt, 5000);
  assert.deepEqual({ ...s.pendingLaunch }, { tag: 'switchboard_abc', forkFrom: null, projectPath: '/src/api', spawnedAt: 4000 });
  assert.equal(s.mcpServer, null, 'its IDE server went with the Switchboard that started it');
  assert.equal(s.ideLost, false, 'it had none to lose');
  assert.equal(s.exited, false);
  assert.deepEqual(adopted, [{ address: 't3', history: 1000 }]);
  assert.deepEqual(wired, [{ id: 'abc', harness: 'codex' }]);
});

test('a kept terminal gets its shell back for the activity sweep, and a resumed session its project', async () => {
  const { active } = await adopt([
    { address: 't1', cwd: '/src/web', labels: { app: 'switchboard', sid: 'term-1', kind: 'terminal', shell: 'fish', projectPath: '/src/web' } },
    { address: 't2', cwd: '/src/api', labels: { app: 'switchboard', sid: 'resumed', kind: 'cli', projectPath: '/src/api', ide: '1' } },
  ], { meta: { resumed: { projectId: 'p9', trackId: null } } });
  const term = active.get('term-1');
  assert.equal(term.isPlainTerminal, true);
  assert.equal(term.runtime, null);
  assert.equal(term.activity.opts.shellName, 'fish');
  const resumed = active.get('resumed');
  assert.equal(resumed.runtime, 'claude');
  assert.equal(resumed.projectFolder, '-src-api');
  assert.equal(resumed.projectId, 'p9');
  assert.equal(resumed.ideLost, true, 'it had an IDE server, gone with the old Switchboard');
});

test('a session already known, or a record with no session id, is left alone', async () => {
  const known = { pty: 'mine' };
  const { active, adopted } = await adopt([
    { address: 't1', labels: { app: 'switchboard', sid: 'here' } },
    { address: 't2', labels: { app: 'switchboard' } },
  ], { active: new Map([['here', known]]) });
  assert.equal(active.get('here'), known);
  assert.equal(active.size, 1);
  assert.deepEqual(adopted, []);
});
