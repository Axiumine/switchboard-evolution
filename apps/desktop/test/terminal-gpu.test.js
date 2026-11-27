// The terminals' GPU budget (public/terminal-gpu.js): WebGL goes only to the
// terminals on screen, at most `max` of them. Loaded in a vm context without
// IntersectionObserver or WebglAddon, as the page's other plain scripts are,
// then driven with fake addons, a fake observe and a fake timer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../public/terminal-gpu.js'), 'utf8');

function load() {
  const context = vm.createContext({ window: {}, console, setTimeout, clearTimeout });
  vm.runInContext(SOURCE, context);
  return context;
}

// A budget over fakes. Each addon counts its dispose; each observed element
// exposes the callback the observer would run (cb) and whether it still watches.
function setup({ max = 2 } = {}) {
  const { createGpuBudget } = load();
  const addons = [];
  const watchers = new Map();
  const timers = [];
  const budget = createGpuBudget({
    max,
    makeAddon: () => {
      const addon = {
        disposed: 0, lossHandlers: [],
        onContextLoss(handler) { this.lossHandlers.push(handler); },
        dispose() { this.disposed += 1; },
        loseContext() { this.lossHandlers.forEach(handler => handler()); },
      };
      addons.push(addon);
      return addon;
    },
    observe: (element, cb) => {
      const watcher = { cb, watching: true };
      watchers.set(element, watcher);
      return () => { watcher.watching = false; };
    },
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; },
  });
  // Arrays from the vm context are of another realm; deepEqual wants this one's.
  const active = () => Array.from(budget.active());
  const make = id => {
    const listeners = [];
    const element = {
      id,
      addEventListener: (type, listener) => listeners.push({ type, listener }),
      removeEventListener: (type, listener) => {
        const at = listeners.findIndex(l => l.type === type && l.listener === listener);
        if (at !== -1) listeners.splice(at, 1);
      },
    };
    const terminal = { id, loaded: [], loadAddon(addon) { this.loaded.push(addon); } };
    return { id, element, terminal, listeners };
  };
  const show = (item, visible = true) => watchers.get(item.element).cb(visible);
  const pending = () => timers.filter(timer => !timer.cleared);
  return { budget, active, addons, watchers, timers, pending, make, show };
}

test('the page object exists only where its browser parts do', () => {
  assert.equal(load().window.terminalGpu, undefined);
  const context = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, IntersectionObserver: class { observe() {} disconnect() {} }, WebglAddon: { WebglAddon: class {} },
  });
  vm.runInContext(SOURCE, context);
  assert.equal(typeof context.window.terminalGpu.register, 'function');
});

test('visible terminals get WebGL up to the budget, most recent first', () => {
  const { budget, active, addons, make, show } = setup({ max: 2 });
  const [a, b, c] = ['a', 'b', 'c'].map(make);
  for (const item of [a, b, c]) budget.register(item.id, item.terminal, item.element);
  assert.deepEqual(active(), [], 'nothing is on screen yet');
  show(a); show(b);
  assert.deepEqual(active().sort(), ['a', 'b']);
  show(c);
  // c came to screen last: the one touched least recently, a, gives its addon back.
  assert.deepEqual(active().sort(), ['b', 'c']);
  assert.equal(addons.filter(addon => addon.disposed === 1).length, 1);
  assert.equal(a.terminal.loaded[0].disposed, 1);
  assert.equal(b.terminal.loaded[0].disposed, 0);
  assert.equal(c.terminal.loaded.length, 1);
  // Touching a (its focus) takes the slot of b, now the least recent.
  budget.touch('a');
  assert.deepEqual(active().sort(), ['a', 'c']);
  assert.equal(b.terminal.loaded[0].disposed, 1);
  assert.equal(a.terminal.loaded.length, 2, 'a gets a new addon, not the disposed one');
});

test('a hidden terminal gives its context back', () => {
  const { budget, active, addons, make, show } = setup({ max: 2 });
  const [a, b, c] = ['a', 'b', 'c'].map(make);
  for (const item of [a, b, c]) budget.register(item.id, item.terminal, item.element);
  show(a); show(b); show(c);
  assert.deepEqual(active().sort(), ['b', 'c']);
  show(b, false);
  assert.equal(b.terminal.loaded[0].disposed, 1);
  // The slot b left goes to a, which is still on screen.
  assert.deepEqual(active().sort(), ['a', 'c']);
  assert.equal(a.terminal.loaded.length, 2);
  show(a, false);
  assert.deepEqual(active(), ['c']);
  assert.equal(addons.every(addon => addon.disposed <= 1), true);
});

test('a lost context falls back and is retried when still visible', () => {
  const { budget, active, pending, make, show } = setup({ max: 2 });
  const a = make('a');
  budget.register(a.id, a.terminal, a.element);
  show(a);
  const first = a.terminal.loaded[0];
  first.loseContext();
  assert.equal(first.disposed, 1);
  assert.deepEqual(active(), [], 'the terminal is back on the DOM renderer');
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].ms, 5000);
  pending()[0].fn();
  assert.deepEqual(active(), ['a']);
  assert.equal(a.terminal.loaded.length, 2);
  assert.notEqual(a.terminal.loaded[1], first);

  // Lost again, and gone from the screen before the retry: nothing is loaded.
  a.terminal.loaded[1].loseContext();
  show(a, false);
  pending()[0].fn();
  assert.deepEqual(active(), []);
  assert.equal(a.terminal.loaded.length, 2);
});

test('a terminal that lost its context does not keep a slot while it waits', () => {
  const { budget, active, pending, make, show } = setup({ max: 1 });
  const [a, b] = ['a', 'b'].map(make);
  for (const item of [a, b]) budget.register(item.id, item.terminal, item.element);
  show(a);
  a.terminal.loaded[0].loseContext();
  show(b);
  assert.deepEqual(active(), ['b']);
  pending()[0].fn();
  // Back from the wait, a is on screen but b was touched last and holds the only slot.
  assert.deepEqual(active(), ['b']);
});

test('unregister disposes and stops observing', () => {
  const { budget, active, watchers, pending, make, show } = setup({ max: 2 });
  const [a, b] = ['a', 'b'].map(make);
  for (const item of [a, b]) budget.register(item.id, item.terminal, item.element);
  assert.equal(a.listeners.length, 1, 'focus is listened for');
  show(a); show(b);
  a.terminal.loaded[0].loseContext();
  assert.equal(pending().length, 1);
  budget.unregister('a');
  assert.equal(watchers.get(a.element).watching, false);
  assert.equal(a.listeners.length, 0);
  assert.equal(pending().length, 0, 'the retry timer is cleared');
  budget.unregister('b');
  assert.equal(b.terminal.loaded[0].disposed, 1);
  assert.equal(watchers.get(b.element).watching, false);
  assert.deepEqual(active(), []);
  // Late calls for a terminal that is gone do nothing.
  budget.touch('a');
  budget.unregister('a');
  assert.deepEqual(active(), []);
});

test('focus in a terminal touches it', () => {
  const { budget, active, make, show } = setup({ max: 1 });
  const [a, b] = ['a', 'b'].map(make);
  for (const item of [a, b]) budget.register(item.id, item.terminal, item.element);
  show(a); show(b);
  assert.deepEqual(active(), ['b']);
  assert.equal(a.listeners[0].type, 'focusin');
  a.listeners[0].listener();
  assert.deepEqual(active(), ['a']);
});

test('a WebGL addon that cannot load leaves the terminal on the DOM renderer', () => {
  const { createGpuBudget } = load();
  const warnings = [];
  const budget = createGpuBudget({
    max: 2,
    makeAddon: () => { throw new Error('no WebGL'); },
    observe: (element, cb) => { element.cb = cb; return () => {}; },
    warn: (...args) => warnings.push(args),
  });
  const element = { addEventListener() {}, removeEventListener() {} };
  budget.register('a', { loadAddon() {} }, element);
  element.cb(true);
  assert.deepEqual(Array.from(budget.active()), []);
  assert.equal(warnings.length, 1);
  element.cb(false);
  element.cb(true);
  assert.equal(warnings.length, 1, 'it is not tried again');
});
