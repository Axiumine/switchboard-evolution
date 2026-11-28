const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLookingCheck, createDesktopNotifications } = require('../desktop-notifications');

function lookingAt({ focused = 'main', idle = 'active', front = 'a' } = {}) {
  const windows = { main: { name: 'main' }, own: { name: 'own' }, other: { name: 'other' } };
  return createLookingCheck({
    powerMonitor: { getSystemIdleState: () => idle },
    focusedWindow: () => windows[focused] || null,
    mainWindow: () => windows.main,
    frontSessionId: () => front,
    sessionWindow: (id) => (id === 'windowed' ? windows.own : null),
  });
}

test('the main window shows its front session only', () => {
  const isLooking = lookingAt();
  assert.equal(isLooking('a'), true);
  assert.equal(isLooking('b'), false);
});

test('a session in a window of its own is looked at when that window has the focus', () => {
  assert.equal(lookingAt({ focused: 'own' })('windowed'), true);
  assert.equal(lookingAt({ focused: 'own' })('a'), false);
  assert.equal(lookingAt({ focused: 'other' })('windowed'), false);
});

test('nobody looks without a focused window, or away from the computer', () => {
  assert.equal(lookingAt({ focused: 'none' })('a'), false);
  assert.equal(lookingAt({ idle: 'idle' })('a'), false);
  assert.equal(lookingAt({ idle: 'locked' })('a'), false);
  assert.equal(lookingAt({ idle: 'unknown' })('a'), true);
});

function popups({ enabled = true, supported = true } = {}) {
  const made = [];
  const opened = [];
  class Notification {
    static isSupported() { return supported; }
    constructor(options) { this.options = options; this.handlers = {}; this.closed = false; this.shown = false; made.push(this); }
    on(name, handler) { this.handlers[name] = handler; }
    show() { this.shown = true; }
    close() { this.closed = true; }
  }
  const notifications = createDesktopNotifications({ Notification, enabled: () => enabled, open: (id) => opened.push(id), log: { warn() {} } });
  return { notifications, made, opened };
}

test('a notification carries the alert and opens its session when clicked', () => {
  const { notifications, made, opened } = popups();
  notifications.show({ sessionId: 'a', title: 'Fix the parser', body: 'Needs your input' });
  assert.deepEqual(made[0].options, { title: 'Fix the parser', body: 'Needs your input' });
  assert.equal(made[0].shown, true);
  made[0].handlers.click();
  assert.deepEqual(opened, ['a']);
});

test('a newer one replaces a session\'s notification, and close takes it back', () => {
  const { notifications, made } = popups();
  notifications.show({ sessionId: 'a', title: 't', body: '1' });
  notifications.show({ sessionId: 'a', title: 't', body: '2' });
  assert.equal(made[0].closed, true);
  assert.equal(made[1].closed, false);
  notifications.close('a');
  assert.equal(made[1].closed, true);
});

test('none shows when the setting is off or the system has none', () => {
  for (const options of [{ enabled: false }, { supported: false }]) {
    const { notifications, made } = popups(options);
    notifications.show({ sessionId: 'a', title: 't', body: 'b' });
    assert.equal(made.length, 0);
  }
});
