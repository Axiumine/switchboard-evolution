// settings-panel.js follows settings changed elsewhere (global-settings-changed)
// through one listener for the page on screen: a new page replaces the
// listener of the one before, and a listener whose page is gone removes only
// itself, never the listener of the page that replaced it. The helper is read
// out of the panel's source, which needs a DOM to load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '../public/settings-panel.js'), 'utf8');
const start = panel.indexOf('function createChangeFollower(');
const source = start < 0 ? '' : panel.slice(start, panel.indexOf('\n  }\n', start) + 4);

function loadFollower() {
  assert.ok(source, 'settings-panel.js has createChangeFollower');
  return vm.runInNewContext(`${source}\ncreateChangeFollower`, {});
}

/** The preload's onGlobalSettingsChanged: subscribe(cb) gives back the unsubscribe. */
function fakeBus() {
  const listeners = new Set();
  return {
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    emit(event) { for (const cb of [...listeners]) cb(event); },
    size: () => listeners.size,
  };
}

test('a new page replaces the listener of the one before, and follows every change', () => {
  const createChangeFollower = loadFollower();
  const bus = fakeBus();
  const follower = createChangeFollower(bus.subscribe);
  const first = [];
  const second = [];
  follower.follow(e => first.push(e), () => true);
  follower.follow(e => second.push(e), () => true);
  bus.emit(1);
  bus.emit(2);
  assert.deepEqual(first, []);
  assert.deepEqual(second, [1, 2]);
  assert.equal(bus.size(), 1);
  follower.stop();
  assert.equal(bus.size(), 0);
});

test('a listener whose page is gone removes only itself', () => {
  const createChangeFollower = loadFollower();
  const bus = fakeBus();
  const follower = createChangeFollower(bus.subscribe);
  // Another listener on the same event (the main window's own, app.js).
  const others = [];
  bus.subscribe(e => others.push(e));
  let live = true;
  const gone = [];
  follower.follow(e => gone.push(e), () => live);
  live = false;
  bus.emit(1);
  assert.deepEqual(gone, []);
  assert.deepEqual(others, [1]);
  assert.equal(bus.size(), 1, 'the stale listener left, the other one stayed');
  follower.stop();
  assert.equal(bus.size(), 1, 'stop has nothing left to remove');

  // The next page follows every change, not just the first.
  const next = [];
  follower.follow(e => next.push(e), () => true);
  bus.emit(2);
  bus.emit(3);
  assert.deepEqual(next, [2, 3]);
  assert.deepEqual(others, [1, 2, 3]);
});

test('a page whose open was overtaken stops before it draws', () => {
  // Each open takes a token; after its awaits, an open that is no longer the
  // latest one returns before rendering or subscribing.
  assert.match(panel, /const token = \+\+openToken;/);
  const body = panel.slice(panel.indexOf('async function openSettingsViewer('));
  const checks = body.match(/if \(superseded\(\)\) return;/g) || [];
  assert.ok(checks.length >= 2, 'checked after the settings are read and before the page is drawn');
  assert.ok(body.indexOf('if (superseded()) return;') < body.indexOf('settingsViewerBody.innerHTML ='));
});
