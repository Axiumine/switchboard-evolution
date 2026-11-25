// The terminal's Commands palette in a window of its own (commands.html,
// opened by the palette's window button: main.js openCommandsWindow), for
// one session. command-catalog-view.js does the work; this gives it what the
// main window's globals give it there: the session, whether its CLI is
// working or waiting for an answer, and the palette, opened at once and kept
// open (commandPaletteInWindow). A pick types into that session, wherever its
// terminal is shown.

const COMMANDS_WINDOW = (() => {
  try {
    const query = new URLSearchParams(location.search);
    const sessionId = query.get('session');
    if (!sessionId) return null;
    return {
      sessionId,
      runtime: query.get('runtime') || null,
      type: query.get('type') || null,
      title: query.get('title') || '',
      cli: query.get('cli') || null,
    };
  } catch { return null; }
})();

const isMac = !!(window.api && window.api.platform === 'darwin');
let activeSessionId = COMMANDS_WINDOW ? COMMANDS_WINDOW.sessionId : null;
// No terminal here: the session's terminal is in the main window.
const openSessions = new Map();
const sessionMap = new Map(COMMANDS_WINDOW ? [[COMMANDS_WINDOW.sessionId, {
  sessionId: COMMANDS_WINDOW.sessionId,
  runtime: COMMANDS_WINDOW.runtime || undefined,
  type: COMMANDS_WINDOW.type || undefined,
  name: COMMANDS_WINDOW.title,
}]] : []);
// The state the rules read (commandCatalogState): kept from the events main sends this window.
const attentionSessions = new Set();
const sessionBusyState = new Map();

document.body.classList.add('commands-window');
if (COMMANDS_WINDOW) document.title = COMMANDS_WINDOW.title ? `Commands · ${COMMANDS_WINDOW.title}` : 'Commands';

/** Draw the palette again when the session's state changes what it offers. */
function commandsWindowStateChanged() {
  if (typeof commandPalette !== 'undefined' && commandPalette && commandPalette.catalog) renderCommandPalette();
}

if (window.api && COMMANDS_WINDOW) {
  window.api.onCliBusyState((sessionId, busy) => {
    if (sessionId !== COMMANDS_WINDOW.sessionId) return;
    sessionBusyState.set(sessionId, !!busy);
    // Working again: the question it asked has its answer.
    if (busy) attentionSessions.delete(sessionId);
    commandsWindowStateChanged();
  });
  window.api.onTerminalNotification((sessionId, _message, kind) => {
    if (sessionId !== COMMANDS_WINDOW.sessionId) return;
    if (kind === 'attention') attentionSessions.add(sessionId);
    else if (kind === 'idle') { sessionBusyState.set(sessionId, false); attentionSessions.delete(sessionId); }
    commandsWindowStateChanged();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!COMMANDS_WINDOW) {
    document.body.textContent = 'No session to show commands for.';
    return;
  }
  try {
    commandCatalogClis = (await window.api.getCommandCatalogClis()) || [];
  } catch {
    commandCatalogClis = [];
  }
  openCommandPalette(COMMANDS_WINDOW.cli ? { cli: COMMANDS_WINDOW.cli } : {});
});
