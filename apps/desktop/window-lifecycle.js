// Keeping sessions reachable from a paired phone.
//
// With remote access on, closing the window on macOS hides it instead of
// ending every session: the app already stays in the dock, and a phone may be
// driving those sessions. Quitting (Cmd+Q, the updater) still quits. While a
// session works, the Mac does not go to sleep on its own.

// Telling a hidden window on screen again, per window.
const backOnScreen = new WeakMap();

/**
 * Hide the window on close when `keepAlive()` says so (asked at close time),
 * and report when it goes off screen (hidden that way, or minimized) and
 * comes back. Not from 'hide' and 'show': on macOS those follow occlusion, so
 * a window behind another app's emits neither when hidden, and one that is
 * merely covered emits 'hide'.
 */
function keepWindowOnClose(win, { platform, keepAlive, isQuitting, onVisibility }) {
  let hidden = false;
  let reported = true;
  const report = () => {
    const onScreen = !hidden && !win.isMinimized();
    if (onScreen !== reported) onVisibility(reported = onScreen);
  };
  const hide = () => {
    win.hide();
    hidden = true;
    report();
  };
  const back = () => {
    hidden = false;
    report();
  };
  backOnScreen.set(win, back);

  win.on('close', (event) => {
    if (platform !== 'darwin' || isQuitting() || !keepAlive()) return;
    event.preventDefault();
    // A full-screen window hidden as it is leaves an empty space behind.
    if (win.isFullScreen()) {
      win.once('leave-full-screen', hide);
      win.setFullScreen(false);
    } else {
      hide();
    }
  });
  win.on('minimize', report);
  for (const name of ['restore', 'show', 'focus']) win.on(name, back);
}

/** Bring the window back, hidden or minimized. */
function showWindow(win) {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  backOnScreen.get(win)?.();
}

/** Hold off idle sleep while `wanted()`; call update() whenever that may have changed. */
function createPowerSaveGuard({ powerSaveBlocker, wanted }) {
  let id = null;
  return {
    update() {
      const want = !!wanted();
      if (want && id === null) {
        id = powerSaveBlocker.start('prevent-app-suspension');
      } else if (!want && id !== null) {
        powerSaveBlocker.stop(id);
        id = null;
      }
    },
    active: () => id !== null,
  };
}

module.exports = { keepWindowOnClose, showWindow, createPowerSaveGuard };
