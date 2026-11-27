// --- Terminal GPU budget ---
// WebGL contexts are few, and a terminal that is not on screen has no use for
// one. The budget gives a WebGL addon only to the terminals on screen, at most
// `max` of them: when more are visible, the one touched (focused) least
// recently draws with the DOM renderer. A terminal that goes out of sight gives
// its context back, and one whose context the GPU takes away falls back to the
// DOM renderer and tries again a little later, if it is still on screen.
//
// terminal-manager.js only registers a terminal when it makes it and
// unregisters it when it closes it.

const TERMINAL_GPU_MAX = 10;
const TERMINAL_GPU_RETRY_MS = 5000;

/**
 * @param {object} options
 * @param {number} [options.max] most terminals drawing with WebGL at once
 * @param {() => object} options.makeAddon a new WebGL addon (with onContextLoss and dispose)
 * @param {(element: object, cb: (visible: boolean) => void) => () => void} options.observe
 *   tells cb whether the element is on screen; returns a function that stops
 * @param {(element: object) => (Function | null | undefined)} [options.freeContext]
 *   called once before the budget disposes an addon on purpose; what it returns
 *   is called right after the dispose, to free the addon's WebGL context
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 * @param {Function} [options.warn]
 */
function createGpuBudget({
  max = TERMINAL_GPU_MAX, makeAddon, observe,
  freeContext = () => null, setTimer = setTimeout, clearTimer = clearTimeout, warn = console.warn,
}) {
  // id -> { id, terminal, element, visible, touched, addon, waiting, unsupported, retryTimer, stopObserving, onFocus }
  const entries = new Map();
  let clock = 0;

  // Disposes the addon. A deliberate release also frees its WebGL context at
  // once: the addon never does, and a context nobody frees lives until it is
  // garbage-collected, while the browser holds only 16 and evicts the oldest
  // live one (maybe a terminal on screen) for the 17th. A context the GPU has
  // already taken away needs no freeing.
  function release(entry, { free = true } = {}) {
    const { addon } = entry;
    if (!addon) return;
    entry.addon = null;
    let freed = null;
    if (free) {
      try { freed = freeContext(entry.element); } catch (e) { warn('[terminal] finding the WebGL context failed', e); }
    }
    disposeAddon(addon);
    if (freed) {
      try { freed(); } catch (e) { warn('[terminal] freeing the WebGL context failed', e); }
    }
  }

  function disposeAddon(addon) {
    try { addon.dispose(); } catch (e) { warn('[terminal] WebGL addon dispose failed', e); }
  }

  function acquire(entry) {
    let addon = null;
    try {
      addon = makeAddon();
      addon.onContextLoss(() => loseContext(entry, addon));
      entry.terminal.loadAddon(addon);
      entry.addon = addon;
    } catch (e) {
      // No WebGL here: the DOM renderer stays, as it did before the budget.
      if (addon) disposeAddon(addon);
      entry.unsupported = true;
      warn('[terminal] WebGL addon failed, falling back to DOM renderer', e);
    }
  }

  // The visible terminals, most recently touched first, share the budget. A
  // terminal waiting to retry after a context loss is not asked for one.
  function rebalance() {
    const wanted = new Set(
      [...entries.values()]
        .filter(entry => entry.visible && !entry.waiting && !entry.unsupported)
        .sort((a, b) => b.touched - a.touched)
        .slice(0, max),
    );
    for (const entry of entries.values()) if (!wanted.has(entry)) release(entry);
    for (const entry of wanted) if (!entry.addon) acquire(entry);
  }

  function loseContext(entry, addon) {
    if (entry.addon !== addon || entries.get(entry.id) !== entry) return;
    release(entry, { free: false });
    entry.waiting = true;
    entry.retryTimer = setTimer(() => {
      entry.retryTimer = null;
      entry.waiting = false;
      rebalance(); // loads again only if it is still on screen and within the budget
    }, TERMINAL_GPU_RETRY_MS);
    rebalance();
  }

  function touch(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.touched = ++clock;
    rebalance();
  }

  function register(id, terminal, element) {
    if (entries.has(id)) unregister(id);
    const entry = {
      id, terminal, element, visible: false, touched: ++clock, addon: null,
      waiting: false, unsupported: false, retryTimer: null, stopObserving: null, onFocus: null,
    };
    entry.onFocus = () => touch(id);
    entries.set(id, entry);
    element.addEventListener('focusin', entry.onFocus);
    entry.stopObserving = observe(element, visible => {
      entry.visible = Boolean(visible);
      rebalance();
    });
  }

  function unregister(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.stopObserving?.();
    entry.element.removeEventListener('focusin', entry.onFocus);
    if (entry.retryTimer !== null) clearTimer(entry.retryTimer);
    release(entry);
    rebalance();
  }

  function active() {
    return [...entries.values()].filter(entry => entry.addon).map(entry => entry.id);
  }

  return { register, unregister, touch, active };
}

// Finds the WebGL canvas of a terminal (the addon adds it to .xterm-screen, with
// no class; the layer canvases it also adds have a 2D context) and returns the
// function that loses its context. The lookup must be made before the addon is
// disposed, which removes the canvas. getContext('webgl2') gives a canvas its
// context back, but would make one on a canvas that has none: a canvas of a
// layer is left alone, and so is a canvas that does not answer.
function findWebglContextLoser(element) {
  try {
    const canvas = [...element.querySelectorAll('.xterm-screen canvas')]
      .find(candidate => !/-layer\b/.test(String(candidate.className)));
    const extension = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    return extension ? () => extension.loseContext() : null;
  } catch {
    return null;
  }
}

// The page's budget. Without a browser's IntersectionObserver and the WebGL
// addon (the tests load this file without them) there is none.
if (typeof window !== 'undefined' && typeof IntersectionObserver !== 'undefined' && typeof WebglAddon !== 'undefined') {
  window.terminalGpu = createGpuBudget({
    max: TERMINAL_GPU_MAX,
    makeAddon: () => new WebglAddon.WebglAddon(),
    freeContext: findWebglContextLoser,
    // An element with display:none does not intersect, so a hidden terminal is not visible.
    observe: (element, cb) => {
      const observer = new IntersectionObserver(records => {
        const last = records[records.length - 1];
        if (last) cb(last.isIntersecting);
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
  });
}
