const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionAlerts, FINISHED_DELAY_MS, ATTENTION_DELAY_MS } = require('../session-alerts');

function harness({ looking = new Set(), onPhone = new Set() } = {}) {
  const events = [];
  const shown = new Map();
  const timers = new Map();
  let clock = 0;
  let nextTimer = 1;
  const alerts = createSessionAlerts({
    emit: (...event) => events.push(event),
    titleOf: (id) => (id === 'untitled' ? '' : `Session ${id}`),
    isLooking: (id) => looking.has(id),
    onPhone: (id) => onPhone.has(id),
    show: (alert) => shown.set(alert.sessionId, alert),
    close: (id) => shown.delete(id),
    now: () => clock,
    setTimer: (run, delay) => {
      timers.set(nextTimer, { run, at: clock + delay });
      return nextTimer++;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const send = (channel, ...args) => alerts.eventSink(channel, args);
  function advance(ms) {
    clock += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > clock) continue;
      timers.delete(id);
      timer.run();
    }
  }
  const said = () => events.filter(([channel]) => channel === 'session-alert').map(([, alert]) => alert);
  const turn = (id) => {
    send('cli-busy-state', id, true);
    send('cli-busy-state', id, false);
  };
  return { alerts, send, advance, said, events, shown, looking, onPhone, turn };
}

test('a turn that ends is announced once, after a moment', () => {
  const h = harness();
  h.turn('a');
  h.advance(FINISHED_DELAY_MS - 1);
  assert.deepEqual(h.said(), []);
  h.advance(1);
  assert.deepEqual(h.said(), [{ sessionId: 'a', kind: 'finished', body: 'Finished and is waiting for you', title: 'Session a', at: FINISHED_DELAY_MS }]);
  assert.equal(h.shown.size, 1);
  // The CLI's own "waiting for your input" a minute later says nothing new.
  h.send('terminal-notification', 'a', 'Claude is waiting for your input', 'idle');
  h.advance(60_000);
  assert.equal(h.said().length, 1);
});

test('a CLI that goes idle between two steps is not announced', () => {
  const h = harness();
  h.turn('a');
  h.advance(200);
  h.send('cli-busy-state', 'a', true);
  h.advance(10_000);
  assert.deepEqual(h.said(), []);
});

test('only a session that was working can finish', () => {
  const h = harness();
  h.send('cli-busy-state', 'a', false);
  h.advance(10_000);
  assert.deepEqual(h.said(), []);
});

test('a turn too quick to show as busy is announced from its notification', () => {
  const h = harness();
  h.send('terminal-notification', 'a', 'done', 'idle');
  h.advance(FINISHED_DELAY_MS);
  assert.equal(h.said()[0].kind, 'finished');
});

test('a question replaces the end of the turn, whichever is said first', () => {
  for (const first of ['idle', 'question']) {
    const h = harness();
    h.send('cli-busy-state', 'a', true);
    if (first === 'idle') h.send('cli-busy-state', 'a', false);
    h.send('terminal-notification', 'a', 'Action Required', 'attention');
    h.send('terminal-notification', 'a', 'Claude needs your permission to use Bash', 'attention');
    if (first === 'question') h.send('cli-busy-state', 'a', false);
    h.advance(10_000);
    assert.equal(h.said().length, 1, first);
    assert.equal(h.said()[0].kind, 'attention');
    assert.equal(h.said()[0].body, 'Claude needs your permission to use Bash');
  }
});

test('a repeat of a question that stands says nothing', () => {
  const h = harness();
  h.send('terminal-notification', 'a', 'Approval requested: ls', 'attention');
  h.advance(ATTENTION_DELAY_MS);
  h.send('terminal-notification', 'a', 'Approval requested: ls', 'attention');
  h.advance(10_000);
  assert.equal(h.said().length, 1);
});

test('nothing is said of a session in front here or on a phone', () => {
  const h = harness({ looking: new Set(['a']), onPhone: new Set(['b']) });
  h.turn('a');
  h.turn('b');
  h.send('terminal-notification', 'a', 'needs you', 'attention');
  h.advance(10_000);
  assert.deepEqual(h.said(), []);
  assert.equal(h.shown.size, 0);
});

test('an alert is taken back when the session works again', () => {
  const h = harness();
  h.send('terminal-notification', 'a', 'needs you', 'attention');
  h.advance(ATTENTION_DELAY_MS);
  h.send('cli-busy-state', 'a', true);
  assert.equal(h.shown.size, 0);
  assert.deepEqual(h.events.at(-1), ['session-alert-cleared', 'a']);
  assert.deepEqual(h.alerts.snapshot(), []);
  // And the next turn is announced again.
  h.send('cli-busy-state', 'a', false);
  h.advance(FINISHED_DELAY_MS);
  assert.equal(h.said().at(-1).kind, 'finished');
});

test('an alert is read when the session comes in front', () => {
  const h = harness();
  h.turn('a');
  h.turn('b');
  h.advance(FINISHED_DELAY_MS);
  h.looking.add('a');
  h.alerts.refresh();
  assert.deepEqual(h.alerts.snapshot().map((a) => a.sessionId), ['b']);
  assert.deepEqual([...h.shown.keys()], ['b']);
});

test('a mark the window drops reads its alert; a mark that never was does nothing', () => {
  const h = harness();
  h.turn('a');
  h.turn('b');
  h.advance(FINISHED_DELAY_MS);
  h.alerts.noticesChanged({ ready: ['a'], attention: [] });
  assert.equal(h.alerts.snapshot().length, 2);
  h.alerts.noticesChanged({ ready: [], attention: [] });
  assert.deepEqual(h.alerts.snapshot().map((a) => a.sessionId), ['b']);
});

test('a change to review is announced and goes when it is answered', () => {
  const h = harness();
  h.send('mcp-open-diff', 'a', 'd1', { oldFilePath: '/work/app/index.js' });
  h.send('terminal-notification', 'a', 'Claude needs your permission', 'attention');
  h.advance(ATTENTION_DELAY_MS);
  assert.equal(h.said().length, 1);
  assert.equal(h.said()[0].body, 'Wants to change index.js');
  assert.equal(h.said()[0].diffId, 'd1');
  h.send('mcp-diff-resolved', 'a', 'other', 'accept');
  assert.equal(h.alerts.snapshot().length, 1);
  h.send('mcp-diff-resolved', 'a', 'd1', 'accept');
  assert.equal(h.alerts.snapshot().length, 0);
});

test('an exit takes back a question and keeps a finished turn', () => {
  const h = harness();
  h.send('terminal-notification', 'asks', 'needs you', 'attention');
  h.turn('done');
  h.send('process-exited', 'done', 0);
  h.advance(FINISHED_DELAY_MS);
  h.send('process-exited', 'asks', 0);
  assert.deepEqual(h.alerts.snapshot().map((a) => a.sessionId), ['done']);
});

test('an alert follows a session whose id changes', () => {
  const h = harness();
  h.turn('temp');
  h.advance(FINISHED_DELAY_MS);
  h.send('session-detected', 'temp', 'real');
  assert.deepEqual([...h.shown.keys()], ['real']);
  assert.deepEqual(h.alerts.snapshot().map((a) => a.sessionId), ['real']);
  h.alerts.read('real');
  assert.equal(h.shown.size, 0);

  h.turn('temp2');
  h.send('session-forked', 'temp2', 'fork');
  h.advance(FINISHED_DELAY_MS);
  assert.equal(h.alerts.snapshot()[0].sessionId, 'fork');
});

test('a session with no name yet is "A session"', () => {
  const h = harness();
  h.turn('untitled');
  h.advance(FINISHED_DELAY_MS);
  assert.equal(h.said()[0].title, 'A session');
});
