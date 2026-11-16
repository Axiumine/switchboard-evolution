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
