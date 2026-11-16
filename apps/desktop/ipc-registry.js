// Every renderer → main handler, by channel, so another transport can call the
// same functions the window does. install() wraps ipcMain once, before any
// handler is registered; registration itself is unchanged.
//
// No handler reads its event argument, so another transport calls them with
// a null event.

const handlers = new Map(); // channel → { kind: 'handle' | 'on', fn }

function install(ipcMain) {
  const handle = ipcMain.handle.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, fn) => {
    handlers.set(channel, { kind: 'handle', fn });
    return handle(channel, fn);
  };
  ipcMain.on = (channel, fn) => {
    handlers.set(channel, { kind: 'on', fn });
    return on(channel, fn);
  };
}

/** The handler registered for a channel, or null. */
function getHandler(channel) {
  return handlers.get(channel) || null;
}

module.exports = { install, getHandler };
