const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { keepWindowOnClose, showWindow, createPowerSaveGuard } = require('../window-lifecycle');

/**
 * A BrowserWindow with just what the helper touches. Like a real one on
 * macOS, hide() and show() emit nothing: 'hide' and 'show' follow occlusion
 * there, so a window already covered by another app's emits neither.
 */
function fakeWindow({ fullScreen = false } = {}) {
  const win = new EventEmitter();
  Object.assign(win, {
    visible: true, minimized: false, fullScreen, focused: 0,
    isDestroyed: () => false,
    isVisible: () => win.visible,
    isMinimized: () => win.minimized,
    isFullScreen: () => win.fullScreen,
    setFullScreen(on) { win.fullScreen = on; if (!on) win.emit('leave-full-screen'); },
    hide() { win.visible = false; },
    show() { win.visible = true; },
    minimize() { win.minimized = true; win.emit('minimize'); },
    restore() { win.minimized = false; win.emit('restore'); },
    focus() { win.focused++; },
  });
  return win;
}

function close(win) {
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  win.emit('close', event);
  return event.defaultPrevented;
}

function setup({ platform = 'darwin', keepAlive = true, quitting = false, fullScreen = false } = {}) {
  const win = fakeWindow({ fullScreen });
  const options = { platform, keepAlive, quitting };
  const visibility = [];
  keepWindowOnClose(win, {
    platform,
    keepAlive: () => options.keepAlive,
    isQuitting: () => options.quitting,
    onVisibility: (visible) => visibility.push(visible),
  });
  return { win, options, visibility };
}

test('on macOS with remote access on, closing the window hides it', () => {
  const { win, visibility } = setup();
  assert.equal(close(win), true);
  assert.equal(win.visible, false);
  assert.deepEqual(visibility, [false]);
});

test('quitting, remote access off, or another platform: closing closes', () => {
  for (const [name, options] of Object.entries({
    quitting: { quitting: true },
    'remote access off': { keepAlive: false },
    linux: { platform: 'linux' },
    windows: { platform: 'win32' },
  })) {
    const { win } = setup(options);
    assert.equal(close(win), false, name);
    assert.equal(win.visible, true, name);
  }
});

test('the choice is made at close time, not when the window opens', () => {
  const { win, options } = setup({ keepAlive: false });
  options.keepAlive = true;
  assert.equal(close(win), true);
  win.show();
  options.quitting = true;
  assert.equal(close(win), false);
});

test('a full-screen window leaves full screen before it hides', () => {
  const { win } = setup({ fullScreen: true });
  assert.equal(close(win), true);
  assert.equal(win.fullScreen, false);
  assert.equal(win.visible, false);
});

test('the window says when it goes off screen and comes back', () => {
  const { win, visibility } = setup();
  win.minimize();
  win.restore();
  close(win);
  showWindow(win);
  showWindow(win);
  assert.deepEqual(visibility, [false, true, false, true]);
});

test('another window on top is not off screen; focus means back on screen', () => {
  const { win, visibility } = setup();
  win.emit('hide');
  assert.deepEqual(visibility, []);
  close(win);
  win.show();
  win.emit('focus');
  assert.deepEqual(visibility, [false, true]);
});

test('showing the window brings back a hidden or minimized one', () => {
  const win = fakeWindow();
  win.hide();
  showWindow(win);
  assert.equal(win.visible, true);
  win.minimize();
  showWindow(win);
  assert.equal(win.minimized, false);
  assert.equal(win.focused, 2);
});

test('the Mac stays awake only while it is wanted', () => {
  const calls = [];
  let nextId = 1;
  const powerSaveBlocker = {
    start: (type) => { calls.push(['start', type]); return nextId++; },
    stop: (id) => calls.push(['stop', id]),
  };
  let wanted = false;
  const guard = createPowerSaveGuard({ powerSaveBlocker, wanted: () => wanted });
  guard.update();
  wanted = true;
  guard.update();
  guard.update();
  assert.equal(guard.active(), true);
  wanted = false;
  guard.update();
  guard.update();
  wanted = true;
  guard.update();
  assert.deepEqual(calls, [['start', 'prevent-app-suspension'], ['stop', 1], ['start', 'prevent-app-suspension']]);
});
