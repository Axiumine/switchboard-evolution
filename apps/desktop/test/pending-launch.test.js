const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const source = main.slice(main.indexOf('function resolvePendingLaunches('), main.indexOf('/**\n * Look through every folder a pending session'));

/** resolvePendingLaunches from main.js, with one Claude fork waiting for its transcript. */
function harness() {
  const calls = [];
  const session = { runtime: 'claude', pendingLaunch: { forkFrom: 'parent', spawnedAt: 0 }, realSessionId: null, exited: false };
  const context = vm.createContext({
    activeSessions: new Map([['temp-id', session]]),
    getHarness: () => ({
      matchesLaunch: (signals) => signals.forkedFrom === 'parent',
      readLaunchSignals: () => ({ sessionId: 'real-id', forkedFrom: 'parent' }),
    }),
    log: { info() {}, error() {} },
    moveSessionAssignment() {}, rekeyPlanLinks() {},
    dbModule: { rekeyScheduleSession() {} },
    rekeyMcpServer: (...args) => calls.push(['rekeyMcpServer', ...args]),
    emit: (...args) => calls.push(args),
  });
  vm.runInContext(source, context);
  return { context, session, calls };
}

test('a fork that finds its transcript moves everything to its real id, its IDE server too', () => {
  const { context, session, calls } = harness();
  context.resolvePendingLaunches(['/transcripts/real-id.jsonl']);
  assert.equal(session.realSessionId, 'real-id');
  assert.equal(context.activeSessions.get('real-id'), session);
  // Diffs the CLI opens afterwards carry the id the window and phones know.
  assert.deepEqual(calls, [['rekeyMcpServer', 'temp-id', 'real-id'], ['session-detected', 'temp-id', 'real-id']]);
});

// --- OpenCode: the id it was started on is what to look for ---

const tagsSource = main.slice(main.indexOf('function pendingLaunchTags('), main.indexOf('/** Is any session still waiting for its transcript to appear? */'));

test('an OpenCode launch is re-keyed onto the id it was started on once OpenCode records it', () => {
  const opencode = require('../harnesses/opencode');
  const codexChecks = [];
  const calls = [];
  const oc = { runtime: 'opencode', pendingLaunch: { tag: 'ses_chosen', spawnedAt: 0 }, realSessionId: null, exited: false };
  const cx = { runtime: 'codex', pendingLaunch: { tag: 'switchboard_x', spawnedAt: 0 }, realSessionId: null, exited: false };
  const recorded = new Set();
  const harnesses = {
    opencode: { ...opencode, id: 'opencode', readLaunchSignals: id => (recorded.has(id) ? { sessionId: id } : null) },
    codex: { id: 'codex', matchesLaunch: () => true, readLaunchSignals: p => { codexChecks.push(p); return { sessionId: 'codex-real' }; } },
  };
  const context = vm.createContext({
    activeSessions: new Map([['temp-oc', oc], ['temp-cx', cx]]),
    getHarness: id => harnesses[id],
    DEFAULT_HARNESS: 'claude',
    log: { info() {}, error() {} },
    moveSessionAssignment() {}, rekeyPlanLinks() {},
    dbModule: { rekeyScheduleSession() {} },
    rekeyMcpServer() {},
    emit: (...args) => calls.push(args),
  });
  vm.runInContext(source + tagsSource, context);

  assert.deepEqual([...context.pendingLaunchTags(harnesses.opencode)], ['ses_chosen']);

  // Nothing recorded yet: the session waits under its temporary id.
  context.resolvePendingLaunches(context.pendingLaunchTags(harnesses.opencode), 'opencode');
  assert.equal(oc.realSessionId, null);

  recorded.add('ses_chosen');
  context.resolvePendingLaunches(context.pendingLaunchTags(harnesses.opencode), 'opencode');
  assert.equal(oc.realSessionId, 'ses_chosen');
  assert.equal(context.activeSessions.get('ses_chosen'), oc);
  assert.deepEqual(calls, [['session-detected', 'temp-oc', 'ses_chosen']]);
  // OpenCode's ids are not offered to a Codex launch as transcripts.
  assert.deepEqual(codexChecks, []);
  assert.equal(cx.realSessionId, null);
});
