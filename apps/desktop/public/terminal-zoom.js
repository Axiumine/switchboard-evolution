// --- Terminal zoom ---
// Ctrl + mouse wheel over a terminal (Cmd too on the Mac; a touchpad pinch also
// arrives as Ctrl + wheel) makes the terminals' text larger or smaller. It is
// apart from the app's own zoom (View menu), and is kept for the next start.
//
// Depends on globals at run time: isAtBottom, safeFit (terminal-manager.js)

const TERMINAL_FONT_SIZE_KEY = 'terminalFontSize';
const TERMINAL_FONT_SIZE_DEFAULT = 12;
const TERMINAL_FONT_SIZE_MIN = 8;
const TERMINAL_FONT_SIZE_MAX = 32;
const TERMINAL_DEFAULT_ROWS = 24; // what xterm makes a terminal with
// The wheel distance of one more step while a scroll goes on. A mouse notch is
// about 100 to 120, and 33 with Windows set to one line a notch; a touchpad
// pinch sends only a few pixels at a time.
const TERMINAL_ZOOM_WHEEL_STEP = 32;
// After a pause this long the next turn of the wheel steps at once, however
// short: a slow notch on a Mac mouse is only a few pixels.
const TERMINAL_ZOOM_WHEEL_PAUSE_MS = 50;
// A scroll still coasting when Ctrl or Cmd goes down stays a scroll: its events
// come closer together than this.
const TERMINAL_ZOOM_COAST_GAP_MS = 50;

// Every live terminal: { terminal, element, fitAddon }.
const zoomableTerminals = new Set();
let currentTerminalFontSize = null;

function clampTerminalFontSize(value) {
  const size = Math.round(Number.parseFloat(value));
  if (!Number.isFinite(size)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, size));
}

/** The text size a terminal is made with. */
function terminalFontSize() {
  if (currentTerminalFontSize === null) {
    let saved = null;
    try { saved = localStorage.getItem(TERMINAL_FONT_SIZE_KEY); } catch {}
    currentTerminalFontSize = clampTerminalFontSize(saved);
  }
  return currentTerminalFontSize;
}

/**
 * The rows a terminal is made with: fewer than xterm's own for larger text. One
 * that its first fit shrinks before xterm draws it can stop following output.
 */
function terminalInitialRows() {
  const scaled = Math.floor((TERMINAL_DEFAULT_ROWS * TERMINAL_FONT_SIZE_DEFAULT) / terminalFontSize());
  return Math.min(TERMINAL_DEFAULT_ROWS, scaled);
}

function isTerminalZoomWheel(event, mac) {
  return !!(event.ctrlKey || (mac && event.metaKey));
}

/**
 * Turns wheel events into text size steps: 1 larger (wheel up), -1 smaller,
 * 0 not yet. Never more than one step for one event.
 */
function createTerminalZoomSteps() {
  let travelled = 0;
  let direction = 0;
  let lastTime = -Infinity;
  return ({ deltaY, deltaMode, timeStamp }) => {
    const sign = Math.sign(deltaY);
    if (!sign) return 0;
    const paused = timeStamp - lastTime > TERMINAL_ZOOM_WHEEL_PAUSE_MS;
    if (sign !== direction) travelled = 0;
    direction = sign;
    lastTime = timeStamp;
    // Lines and pages (deltaMode 1 and 2) come as small numbers: each is a step.
    travelled += deltaMode ? TERMINAL_ZOOM_WHEEL_STEP : Math.abs(deltaY);
    if (!paused && travelled < TERMINAL_ZOOM_WHEEL_STEP) return 0;
    travelled = 0;
    return -sign;
  };
}

/** Whether the terminal is drawn: xterm draws no hidden or scrolled-away one. */
function isTerminalOnScreen(entry) {
  const { element } = entry;
  return !!(entry.zoomOnScreen && element.isConnected && element.clientWidth && element.clientHeight);
}

/**
 * Give a terminal the text size it still lacks and fit it, once a frame however
 * fast the wheel turns. Only on screen: one resized while xterm is not drawing
 * it can stop following its output. The others get the size when they are shown.
 */
function applyTerminalZoom(entry) {
  if (entry.zoomQueued || entry.terminal.options.fontSize === terminalFontSize()) return;
  entry.zoomQueued = true;
  requestAnimationFrame(() => {
    entry.zoomQueued = false;
    if (!isTerminalOnScreen(entry)) return;
    const { element, terminal } = entry;
    try {
      const atBottom = isAtBottom(terminal);
      terminal.options.fontSize = terminalFontSize();
      safeFit(entry);
      const line = terminal.buffer.active.viewportY;
      // xterm 6 keeps the scroll bar's old position in pixels after the cells
      // change size, and the next turn of the wheel jumps. Scrolling away and
      // back, once it has measured the new cells, puts it right. A line down
      // first: at the very top, going up alone would move nothing. Only the last
      // change does so: an earlier one holds a place that is no longer right.
      const change = entry.zoomChange = (entry.zoomChange || 0) + 1;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (change !== entry.zoomChange || !element.isConnected) return;
        try {
          terminal.scrollLines(1);
          terminal.scrollLines(-terminal.buffer.active.length);
          terminal.scrollToLine(atBottom ? terminal.buffer.active.baseY : line);
        } catch {}
      }));
    } catch {}
  });
}

/** Give every terminal this text size, and keep it. */
function setTerminalFontSize(value) {
  const size = clampTerminalFontSize(value);
  if (size === terminalFontSize()) return;
  currentTerminalFontSize = size;
  try { localStorage.setItem(TERMINAL_FONT_SIZE_KEY, String(size)); } catch {}
  for (const entry of zoomableTerminals) applyTerminalZoom(entry);
}

/**
 * The xterm addon that zooms with the wheel over `entry.element`; disposing the
 * terminal takes it away. Load it after `terminal.open`. `onWheel` hears the
 * wheel events the zoom takes.
 */
function createTerminalZoomAddon(entry, { mac = false, onWheel } = {}) {
  const steps = createTerminalZoomSteps();
  let scrollTime = -Infinity; // the last event of a scroll that is not a zoom
  const listener = (event) => {
    if (!isTerminalZoomWheel(event, mac) || event.timeStamp - scrollTime <= TERMINAL_ZOOM_COAST_GAP_MS) {
      scrollTime = event.timeStamp;
      return;
    }
    // Taken before xterm sees it, so neither the scrollback nor a program that
    // reads the mouse gets it, and Chromium does not take it as a page zoom.
    event.preventDefault();
    event.stopPropagation();
    onWheel?.();
    const step = steps(event);
    if (step) setTerminalFontSize(terminalFontSize() + step);
  };
  let observer = null;
  return {
    activate() {
      zoomableTerminals.add(entry);
      entry.element.addEventListener('wheel', listener, { capture: true, passive: false });
      // What xterm itself watches to decide whether to draw.
      observer = new IntersectionObserver((changes) => {
        entry.zoomOnScreen = changes[changes.length - 1].isIntersecting;
        if (entry.zoomOnScreen) applyTerminalZoom(entry);
      });
      observer.observe(entry.element.querySelector('.xterm-screen') || entry.element);
    },
    dispose() {
      zoomableTerminals.delete(entry);
      entry.element.removeEventListener('wheel', listener, { capture: true });
      observer?.disconnect();
    },
  };
}

// Expose to Node for unit testing. No-op in the browser, where this file is
// loaded as a plain <script> and `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clampTerminalFontSize, terminalFontSize, terminalInitialRows, setTerminalFontSize,
    isTerminalZoomWheel, createTerminalZoomSteps, createTerminalZoomAddon,
  };
}
