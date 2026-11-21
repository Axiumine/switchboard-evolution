const { test } = require('node:test');
const assert = require('node:assert/strict');

const { markBusy, markIdle, applyStatusReport } = require('../cli-state');

test('busy is raised once, and clears a pending attention', () => {
  const session = { _needsAttention: true, _oscIdle: true };
  assert.equal(markBusy(session), true);
  assert.deepEqual(session, { _cliBusy: true, _oscIdle: false, _needsAttention: false });
  assert.equal(markBusy(session), false, 'already busy: nothing to announce');
});

test('idle only follows busy', () => {
  const session = {};
  assert.equal(markIdle(session), false);
  markBusy(session);
  assert.equal(markIdle(session), true);
  assert.equal(session._cliBusy, false);
  assert.equal(session._oscIdle, true);
  assert.equal(markIdle(session), false);
});

test('a working report makes the session busy, an idle one ends the turn', () => {
  const session = {};
  assert.deepEqual(applyStatusReport(session, { state: 'busy' }), [['cli-busy-state', true]]);
  assert.deepEqual(applyStatusReport(session, { state: 'busy' }), [], 'repeated reports change nothing');
  assert.deepEqual(applyStatusReport(session, { state: 'idle' }), [['cli-busy-state', false]]);
  assert.deepEqual(applyStatusReport(session, { state: 'idle' }), []);
});

test('a blocked report asks for attention once, and the turn stops spinning', () => {
  const session = {};
  applyStatusReport(session, { state: 'busy' });
  assert.deepEqual(applyStatusReport(session, { state: 'attention', message: 'Permission needs input' }), [
    ['terminal-notification', 'Permission needs input', 'attention'],
    ['cli-busy-state', false],
  ]);
  assert.equal(session._needsAttention, true);
  // The record is sent again on every change elsewhere: still one notification.
  assert.deepEqual(applyStatusReport(session, { state: 'attention', message: 'Permission needs input' }), []);
  // Answered: back to work, which clears the attention.
  assert.deepEqual(applyStatusReport(session, { state: 'busy' }), [['cli-busy-state', true]]);
  assert.equal(session._needsAttention, false);
  // A later block is a new one.
  assert.equal(applyStatusReport(session, { state: 'attention', message: 'Input needs response' })[0][1], 'Input needs response');
});
