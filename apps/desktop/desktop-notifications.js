// The computer's side of session alerts (session-alerts.js): whether someone is
// looking at a session here, and the system notification when nobody is.

// Longer without a key or a mouse move than this, and the one at the computer is away.
const AWAY_AFTER_SECONDS = 120;

/**
 * Whether a session is in front of someone: its window has the focus, shows
 * it, and the computer is in use.
 *
 * deps: powerMonitor (Electron's), focusedWindow(), mainWindow(),
 * frontSessionId() (the main window's), sessionWindow(sessionId)
 * (session-windows.js).
 */
function createLookingCheck({ powerMonitor, focusedWindow, mainWindow, frontSessionId, sessionWindow }) {
  return function isLooking(sessionId) {
    const focused = focusedWindow();
    if (!focused) return false;
    // 'unknown' (some Linux desktops) counts as in use.
    const idle = powerMonitor.getSystemIdleState(AWAY_AFTER_SECONDS);
    if (idle === 'idle' || idle === 'locked') return false;
    if (focused === mainWindow()) return frontSessionId() === sessionId;
    return focused === sessionWindow(sessionId);
  };
}

/**
 * One system notification per session: a newer one replaces it, a click opens
 * the session.
 *
 * deps: Notification (Electron's), enabled() (the setting), open(sessionId),
 * log ({ warn }).
 */
function createDesktopNotifications({ Notification, enabled, open, log }) {
  // Held until replaced or closed: a notification that is collected loses its click.
  const shown = new Map(); // session id → Notification

  function close(sessionId) {
    const notification = shown.get(sessionId);
    if (!notification) return;
    shown.delete(sessionId);
    try { notification.close(); } catch {}
  }

  function show(alert) {
    close(alert.sessionId);
    if (!enabled() || !Notification.isSupported()) return;
    try {
      // No icon of its own: the system shows the app's, as installed.
      const notification = new Notification({ title: alert.title, body: alert.body });
      notification.on('click', () => open(alert.sessionId));
      notification.on('failed', (_event, error) => log.warn(`[notifications] ${error}`));
      shown.set(alert.sessionId, notification);
      notification.show();
    } catch (err) {
      log.warn(`[notifications] could not show one: ${err?.message || err}`);
    }
  }

  return { show, close };
}

module.exports = { createLookingCheck, createDesktopNotifications, AWAY_AFTER_SECONDS };
