const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createTerminalFanout, RING_BYTES, MAX_BUFFERED_BYTES } = require('../terminal-fanout');

/** A fanout with timers the test fires by hand. */
function setup() {
  const timers = [];
  const fanout = createTerminalFanout({
    setTimer: (fn) => { timers.push(fn); return fn; },
    clearTimer: (fn) => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); },
  });
  const fire = () => { while (timers.length) timers.shift()(); };
  return { fanout, fire };
}

function client({ buffered = 0 } = {}) {
  const sent = [];
  return { sent, send: (m) => sent.push(m), bufferedAmount: () => buffered };
}

function session(extra = {}) {
  return { outputBuffer: [], outputSeq: 0, altScreen: false, isPlainTerminal: false, ...extra };
}

/** Feed chunks the way the PTY's onData does: buffer for the window, then the fanout. */
function output(fanout, s, ...chunks) {
  for (const data of chunks) {
    s.outputBuffer.push(data);
    fanout.feed(s, data);
  }
}

test('a first attach gets the window replay, then live output in batches', () => {
  const { fanout, fire } = setup();
  const s = session({ altScreen: true, pty: { cols: 120, rows: 30 } });
  output(fanout, s, 'hello ', 'world');
  const phone = client();
  assert.deepEqual(fanout.attach(s, 's1', phone), { seq: 11 });
  assert.deepEqual(phone.sent, [{ event: 'terminal-reset', args: ['s1', '\x1b[?1049hhello world\x1b[?25l', 11, { altScreen: true, plain: false, cols: 120, rows: 30 }] }]);
  output(fanout, s, 'a', 'b', 'c');
  assert.equal(phone.sent.length, 1, 'nothing until the batch timer fires');
  fire();
  assert.deepEqual(phone.sent[1], { event: 'terminal-data', args: ['s1', 'abc', 14] });
});

test('a plain terminal replays its buffer without screen or cursor codes', () => {
  const { fanout } = setup();
  const s = session({ isPlainTerminal: true, altScreen: true });
  output(fanout, s, '$ ls\r\n');
  const phone = client();
  fanout.attach(s, 't1', phone);
  assert.deepEqual(phone.sent[0].args.slice(1), ['$ ls\r\n', 6, { altScreen: true, plain: true, cols: null, rows: null }]);
});

test('coming back with the last position gets only what was missed, even mid-chunk', () => {
  const { fanout, fire } = setup();
  const s = session();
  const phone = client();
  fanout.attach(s, 's1', phone);
  output(fanout, s, 'one ');
  fire();
  const seen = phone.sent.at(-1).args[2];
  fanout.detachClient(phone);
  output(fanout, s, 'two ', 'three');
  const again = client();
  fanout.attach(s, 's1', again, seen);
  assert.deepEqual(again.sent, [{ event: 'terminal-data', args: ['s1', 'two three', 13] }]);
  const partial = client();
  fanout.attach(s, 's1', partial, 6);
  assert.deepEqual(partial.sent, [{ event: 'terminal-data', args: ['s1', 'o three', 13] }]);
  const upToDate = client();
  fanout.attach(s, 's1', upToDate, 13);
  assert.deepEqual(upToDate.sent, []);
});

test('a position older than the ring, or from another session, gets a reset', () => {
  const { fanout } = setup();
  const s = session();
  fanout.attach(s, 's1', client());
  output(fanout, s, 'x'.repeat(RING_BYTES), 'y'.repeat(1000));
  const late = client();
  fanout.attach(s, 's1', late, 5);
  assert.equal(late.sent[0].event, 'terminal-reset');
  const future = client();
  fanout.attach(s, 's1', future, s.outputSeq + 100);
  assert.equal(future.sent[0].event, 'terminal-reset');
});

test('a phone that cannot keep up is told to reattach instead of piling up', () => {
  const { fanout, fire } = setup();
  const s = session();
  const slow = client({ buffered: MAX_BUFFERED_BYTES + 1 });
  fanout.attach(s, 's1', slow);
  output(fanout, s, 'lots');
  fire();
  assert.deepEqual(slow.sent.at(-1), { event: 'terminal-overflow', args: ['s1'] });
  output(fanout, s, 'more');
  fire();
  assert.equal(slow.sent.at(-1).event, 'terminal-overflow', 'no more data after the overflow');
  assert.equal(s.remoteSubscribers.size, 0);
});

test('detaching stops output; a re-keyed session reports its real id', () => {
  const { fanout, fire } = setup();
  const s = session();
  const phone = client();
  fanout.attach(s, 'temp-id', phone);
  s.realSessionId = 'real-id';
  output(fanout, s, 'after detection');
  fire();
  assert.deepEqual(phone.sent.at(-1).args.slice(0, 2), ['real-id', 'after detection']);
  assert.equal(fanout.detach(s, phone), true);
  output(fanout, s, 'unseen');
  fire();
  assert.equal(phone.sent.at(-1).args[1], 'after detection');
  assert.equal(fanout.detach(s, phone), false);
});

test('a resize reaches attached phones after the output queued before it', () => {
  const { fanout } = setup();
  const s = session();
  const phone = client();
  fanout.attach(s, 's1', phone);
  output(fanout, s, 'wide line');
  fanout.resized(s, 50, 20);
  assert.deepEqual(phone.sent.slice(1), [
    { event: 'terminal-data', args: ['s1', 'wide line', 9] },
    { event: 'terminal-size', args: ['s1', 50, 20] },
  ]);
  fanout.resized(session(), 10, 10); // nobody attached: nothing to do
});

test('sessions nobody attached to keep no ring', () => {
  const { fanout } = setup();
  const s = session();
  output(fanout, s, 'quiet');
  assert.equal(s.outputSeq, 5);
  assert.equal(s.remoteRing, undefined);
});
