const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE = require.resolve('../public/terminal-zoom');

// A fresh copy of the module, with the browser globals it reads at run time.
function load({ saved = null, storage } = {}) {
  const store = new Map(saved === null ? [] : [['terminalFontSize', saved]]);
  const frames = [];
  const observers = [];
  const scrolls = [];
  global.localStorage = storage || {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  global.requestAnimationFrame = callback => frames.push(callback);
  global.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.target = null; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
    see(isIntersecting) { this.callback([{ isIntersecting }]); }
  };
  global.isAtBottom = terminal => terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
  global.safeFit = entry => { entry.fits += 1; };
  delete require.cache[MODULE];
  const zoom = require(MODULE);
  // One frame: what was asked for before it. flush runs frames until none is asked for.
  const frame = () => frames.splice(0).forEach(callback => callback());
  const flush = () => { while (frames.length) frame(); };
  // A terminal the page has made, and (unless told otherwise) shows.
  const open = (entry, { seen = true, ...options } = {}) => {
    const addon = zoom.createTerminalZoomAddon(entry, options);
    addon.activate();
    const observer = observers.at(-1);
    observer.see(seen);
    return { addon, observer };
  };
  return { zoom, store, observers, scrolls, frame, flush, open };
}

function fakeEntry(scrolls, { width = 800, height = 600, viewportY = 50, baseY = 50 } = {}) {
  const listeners = [];
  const element = {
    isConnected: true,
    clientWidth: width,
    clientHeight: height,
    querySelector: () => null,
    addEventListener: (type, listener, options) => listeners.push({ type, listener, options }),
    removeEventListener: (type, listener, options) => {
      const index = listeners.findIndex(l => l.type === type && l.listener === listener && l.options.capture === options.capture);
      if (index !== -1) listeners.splice(index, 1);
    },
  };
  const terminal = {
    options: { fontSize: 12 },
    buffer: { active: { viewportY, baseY, length: 100 } },
    scrollLines: amount => scrolls.push(['lines', amount]),
    scrollToLine: line => scrolls.push(['line', line]),
  };
  return { terminal, element, listeners, fits: 0 };
}

function wheel(entry, fields) {
  const event = {
    deltaY: -120, deltaMode: 0, timeStamp: 1000, ctrlKey: true, metaKey: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...fields,
  };
  for (const { listener } of entry.listeners) listener(event);
  return event;
}

test('the saved text size is kept within bounds, and 12 without one', () => {
  const { zoom } = load();
  assert.equal(zoom.clampTerminalFontSize(null), 12);
  assert.equal(zoom.clampTerminalFontSize('nonsense'), 12);
  assert.equal(zoom.clampTerminalFontSize('18'), 18);
  assert.equal(zoom.clampTerminalFontSize(13.6), 14);
  assert.equal(zoom.clampTerminalFontSize(0), 8);
  assert.equal(zoom.clampTerminalFontSize(500), 32);
  assert.equal(load({ saved: '20' }).zoom.terminalFontSize(), 20);
  assert.equal(load({ saved: '-3' }).zoom.terminalFontSize(), 8);
});

test('larger text starts a terminal with fewer rows, never more than 24', () => {
  for (const [saved, rows] of [[null, 24], ['8', 24], ['12', 24], ['13', 22], ['16', 18], ['18', 16], ['24', 12], ['32', 9]]) {
    assert.equal(load({ saved }).zoom.terminalInitialRows(), rows, `size ${saved}`);
  }
});

test('zooming works when the size cannot be stored', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const { zoom } = load({ storage: broken });
  assert.equal(zoom.terminalFontSize(), 12);
  zoom.setTerminalFontSize(13);
  zoom.setTerminalFontSize(14);
  assert.equal(zoom.terminalFontSize(), 14);
});

test('only Ctrl + wheel zooms, and Cmd + wheel on the Mac', () => {
  const { zoom } = load();
  assert.equal(zoom.isTerminalZoomWheel({ ctrlKey: true }, false), true);
  assert.equal(zoom.isTerminalZoomWheel({ ctrlKey: true }, true), true);
  assert.equal(zoom.isTerminalZoomWheel({ metaKey: true }, true), true);
  assert.equal(zoom.isTerminalZoomWheel({ metaKey: true }, false), false);
  assert.equal(zoom.isTerminalZoomWheel({ shiftKey: true, altKey: true }, false), false);
});

test('each notch of a wheel is one step, up for larger', () => {
  const steps = load().zoom.createTerminalZoomSteps();
  assert.equal(steps({ deltaY: -120, deltaMode: 0, timeStamp: 0 }), 1);
  assert.equal(steps({ deltaY: -120, deltaMode: 0, timeStamp: 20 }), 1);
  assert.equal(steps({ deltaY: 120, deltaMode: 0, timeStamp: 40 }), -1);
  assert.equal(steps({ deltaY: 900, deltaMode: 0, timeStamp: 60 }), -1);
  assert.equal(steps({ deltaY: 0, deltaMode: 0, timeStamp: 80 }), 0);
});

test('a short notch after a pause steps at once, and so does a line or a page', () => {
  const steps = load().zoom.createTerminalZoomSteps();
  assert.equal(steps({ deltaY: -4, deltaMode: 0, timeStamp: 0 }), 1);
  assert.equal(steps({ deltaY: -4, deltaMode: 0, timeStamp: 500 }), 1);
  assert.equal(steps({ deltaY: -3, deltaMode: 1, timeStamp: 510 }), 1);
  assert.equal(steps({ deltaY: 1, deltaMode: 2, timeStamp: 520 }), -1);
});

test('notches turned steadily are one step each, however short', () => {
  for (const deltaY of [-4, -33.33]) {
    const steps = load().zoom.createTerminalZoomSteps();
    let total = 0;
    for (let i = 0; i < 10; i++) total += steps({ deltaY, deltaMode: 0, timeStamp: i * 100 });
    assert.equal(total, 10, `notches of ${deltaY}`);
  }
});

test('a touchpad scroll or pinch steps by the distance travelled', () => {
  const steps = load().zoom.createTerminalZoomSteps();
  assert.equal(steps({ deltaY: -5, deltaMode: 0, timeStamp: 0 }), 1);
  const rest = [];
  for (let i = 1; i <= 16; i++) rest.push(steps({ deltaY: -5, deltaMode: 0, timeStamp: i * 16 }));
  assert.deepEqual(rest.map((step, i) => (step ? i + 1 : null)).filter(Boolean), [7, 14]);
  // Turning back starts the distance again.
  assert.equal(steps({ deltaY: -20, deltaMode: 0, timeStamp: 272 }), 0);
  assert.equal(steps({ deltaY: 30, deltaMode: 0, timeStamp: 288 }), 0);
  assert.equal(steps({ deltaY: 30, deltaMode: 0, timeStamp: 304 }), -1);
});

test('a zoom wheel event is taken from xterm and the page, another is left alone', () => {
  const { scrolls, flush, open } = load();
  const entry = fakeEntry(scrolls);
  let heard = 0;
  open(entry, { onWheel: () => { heard += 1; } });
  assert.deepEqual(entry.listeners[0].options, { capture: true, passive: false });

  const plain = wheel(entry, { ctrlKey: false });
  assert.equal(plain.prevented || plain.stopped, false);
  assert.equal(heard, 0);

  const zoomed = wheel(entry, { timeStamp: 2000 });
  flush();
  assert.equal(zoomed.prevented && zoomed.stopped, true);
  assert.equal(heard, 1);
  assert.equal(entry.terminal.options.fontSize, 13);

  // Taken even when it is not yet a step.
  const small = wheel(entry, { deltaY: -1, timeStamp: 2001 });
  flush();
  assert.equal(small.prevented && small.stopped, true);
  assert.equal(entry.terminal.options.fontSize, 13);
});

test('Cmd + wheel zooms on the Mac only', () => {
  for (const [mac, size] of [[true, 13], [false, 12]]) {
    const { zoom, scrolls, open } = load();
    const entry = fakeEntry(scrolls);
    open(entry, { mac });
    const event = wheel(entry, { ctrlKey: false, metaKey: true });
    assert.equal(event.prevented, mac);
    assert.equal(zoom.terminalFontSize(), size);
  }
});

test('a scroll still coasting when the key goes down stays a scroll', () => {
  const { zoom, scrolls, open } = load();
  const entry = fakeEntry(scrolls);
  open(entry, { mac: true });
  wheel(entry, { ctrlKey: false, timeStamp: 1000 });
  for (let i = 1; i <= 20; i++) {
    const event = wheel(entry, { ctrlKey: false, metaKey: true, deltaY: -60, timeStamp: 1000 + i * 16 });
    assert.equal(event.prevented || event.stopped, false);
  }
  assert.equal(zoom.terminalFontSize(), 12);
  wheel(entry, { ctrlKey: false, metaKey: true, timeStamp: 2000 });
  assert.equal(zoom.terminalFontSize(), 13);
});

test('every terminal gets the size, which is saved and stops at the bounds', () => {
  const { store, scrolls, flush, open } = load({ saved: '31' });
  const one = fakeEntry(scrolls);
  const two = fakeEntry(scrolls);
  open(one);
  open(two);
  wheel(one);
  flush();
  assert.equal(one.terminal.options.fontSize, 32);
  assert.equal(two.terminal.options.fontSize, 32);
  assert.equal(store.get('terminalFontSize'), '32');
  assert.deepEqual([one.fits, two.fits], [1, 1]);

  wheel(one, { timeStamp: 2000 });
  flush();
  assert.deepEqual([one.fits, two.fits], [1, 1]);
});

test('several steps in one frame fit a terminal once', () => {
  const { zoom, scrolls, flush, open } = load();
  const entry = fakeEntry(scrolls);
  open(entry);
  zoom.setTerminalFontSize(13);
  zoom.setTerminalFontSize(14);
  flush();
  assert.equal(entry.fits, 1);
  assert.equal(entry.terminal.options.fontSize, 14);
});

test('the scroll position is put back two frames after the fit', () => {
  for (const [viewportY, back] of [[50, 90], [20, 20]]) {
    const { zoom, scrolls, frame, open } = load();
    const entry = fakeEntry(scrolls, { viewportY });
    open(entry);
    zoom.setTerminalFontSize(13);
    frame(); // the fit
    // Output arrives before xterm has measured the new cells.
    entry.terminal.buffer.active.baseY = 90;
    frame();
    assert.deepEqual(scrolls, []);
    frame();
    // At the bottom it goes to the new bottom; scrolled up, to the same line.
    assert.deepEqual(scrolls, [['lines', 1], ['lines', -100], ['line', back]]);
  }
});

test('while the wheel keeps turning, only the last change puts the scroll back', () => {
  const { zoom, scrolls, frame, flush, open } = load();
  const entry = fakeEntry(scrolls, { viewportY: 20 });
  open(entry);
  zoom.setTerminalFontSize(13);
  frame();
  zoom.setTerminalFontSize(14);
  frame();
  zoom.setTerminalFontSize(15);
  flush();
  assert.equal(entry.fits, 3);
  assert.deepEqual(scrolls, [['lines', 1], ['lines', -100], ['line', 20]]);
});

test('a terminal that is not on screen keeps its size until it is shown', () => {
  // Hidden (no size), and scrolled away in the grid (it has a size).
  for (const box of [{ width: 0, height: 0 }, { width: 800, height: 600 }]) {
    const { zoom, scrolls, flush, open } = load();
    const entry = fakeEntry(scrolls, box);
    const { observer } = open(entry, { seen: false });
    zoom.setTerminalFontSize(16);
    flush();
    assert.equal(entry.terminal.options.fontSize, 12);
    assert.equal(entry.fits, 0);

    entry.element.clientWidth = 800;
    entry.element.clientHeight = 600;
    observer.see(true);
    flush();
    assert.equal(entry.terminal.options.fontSize, 16);
    assert.equal(entry.fits, 1);

    // Coming into view again with the size it has changes nothing.
    observer.see(false);
    observer.see(true);
    flush();
    assert.equal(entry.fits, 1);
  }
});

test('a terminal hidden before its frame comes is left for later', () => {
  const { zoom, scrolls, flush, open } = load();
  const entry = fakeEntry(scrolls);
  const { observer } = open(entry);
  zoom.setTerminalFontSize(16);
  entry.element.clientWidth = 0;
  flush();
  assert.equal(entry.fits, 0);
  entry.element.clientWidth = 800;
  observer.see(true);
  flush();
  assert.equal(entry.fits, 1);
});

test('it watches the part of the terminal that xterm draws', () => {
  const { scrolls, open } = load();
  const entry = fakeEntry(scrolls);
  const screen = {};
  entry.element.querySelector = selector => (selector === '.xterm-screen' ? screen : null);
  assert.equal(open(entry).observer.target, screen);
});

test('a disposed terminal is let go', () => {
  const { zoom, scrolls, flush, open } = load();
  const entry = fakeEntry(scrolls);
  const { addon, observer } = open(entry);
  addon.dispose();
  zoom.setTerminalFontSize(16);
  flush();
  assert.equal(entry.listeners.length, 0);
  assert.equal(observer.target, null);
  assert.equal(entry.terminal.options.fontSize, 12);
});

test('the page loads the zoom before the terminals that use it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const at = name => html.indexOf(`<script src="${name}"></script>`);
  assert.ok(at('terminal-zoom.js') !== -1);
  assert.ok(at('terminal-zoom.js') < at('terminal-manager.js'));
  assert.ok(at('terminal-zoom.js') < at('task-runner.js'));
});

test('session terminals and task logs start at the kept size and zoom', () => {
  for (const name of ['terminal-manager.js', 'task-runner.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
    assert.match(source, /new Terminal\(\{\s*fontSize: terminalFontSize\(\),\s*rows: terminalInitialRows\(\),/, name);
    assert.match(source, /terminal\.loadAddon\(createTerminalZoomAddon\(entry, \{ mac: isMac\b/, name);
  }
});
