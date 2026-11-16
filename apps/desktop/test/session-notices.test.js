const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSessionNotices } = require('../session-notices');

function setup() {
  const events = [];
  const notices = createSessionNotices({ emit: (channel, ...args) => events.push([channel, ...args]) });
  return { notices, events };
}

test('the window publishes its marks; phones hear only real changes', () => {
  const { notices, events } = setup();
  assert.deepEqual(notices.snapshot(), { ready: [], attention: [] });
  notices.publish({ ready: ['s1'], attention: [] });
  notices.publish({ ready: ['s1'], attention: [] });
  notices.publish({ ready: ['s1'], attention: ['s2'] });
  assert.deepEqual(events, [
    ['session-notices-changed', { ready: ['s1'], attention: [] }],
    ['session-notices-changed', { ready: ['s1'], attention: ['s2'] }],
  ]);
  assert.deepEqual(notices.snapshot(), { ready: ['s1'], attention: ['s2'] });
});

test('what the window publishes is cleaned up before it reaches a phone', () => {
  const { notices } = setup();
  notices.publish({ ready: ['s1', 42, null, 'x'.repeat(201), 's1'], attention: 'not a list', extra: true });
  assert.deepEqual(notices.snapshot(), { ready: ['s1'], attention: [] });
  notices.publish(null);
  assert.deepEqual(notices.snapshot(), { ready: [], attention: [] });
});

test('marking read or unread from a phone goes to the window, which owns the marks', () => {
  const { notices, events } = setup();
  assert.equal(notices.setRead('s1', true), true);
  assert.equal(notices.setRead('s2', false), true);
  assert.deepEqual(events, [['remote-mark-read', 's1', true], ['remote-mark-read', 's2', false]]);
});

test('the window hears which sessions are on a phone screen, across phones', () => {
  const { notices, events } = setup();
  const phone = { name: 'phone' };
  const tablet = { name: 'tablet' };
  notices.setViewing(phone, 's1');
  notices.setViewing(tablet, 's1');
  notices.setViewing(tablet, 's2');
  notices.setViewing(phone, null);
  assert.deepEqual(events, [
    ['remote-viewing', ['s1']],
    ['remote-viewing', ['s1', 's2']],
    ['remote-viewing', ['s2']],
  ]);
  assert.deepEqual(notices.viewingIds(), ['s2']);
});

test('a phone that disconnects stops viewing', () => {
  const { notices, events } = setup();
  const phone = {};
  notices.clientClosed(phone);
  assert.deepEqual(events, []);
  notices.setViewing(phone, 's1');
  notices.clientClosed(phone);
  assert.deepEqual(events, [['remote-viewing', ['s1']], ['remote-viewing', []]]);
});

test('a session on a phone screen keeps being seen when its id changes', () => {
  const { notices, events } = setup();
  const phone = {};
  notices.setViewing(phone, 'temp-id');
  notices.eventSink('session-detected', ['temp-id', 'real-id']);
  notices.eventSink('session-forked', ['other', 'fork']);
  notices.eventSink('cli-busy-state', ['real-id', true]);
  assert.deepEqual(events, [['remote-viewing', ['temp-id']], ['remote-viewing', ['real-id']]]);
  assert.deepEqual(notices.viewingIds(), ['real-id']);
});
