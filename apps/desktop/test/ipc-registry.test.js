const { test } = require('node:test');
const assert = require('node:assert/strict');

const { install, getHandler } = require('../ipc-registry');

/** A stand-in for Electron's ipcMain that records what it was given. */
function fakeIpcMain() {
  const registered = [];
  return {
    registered,
    handle(channel, fn) { registered.push(['handle', channel, fn]); },
    on(channel, fn) { registered.push(['on', channel, fn]); return this; },
  };
}

test('handlers are still registered with ipcMain and kept by channel', async () => {
  const ipcMain = fakeIpcMain();
  install(ipcMain);
  const rename = async (_event, id, name) => ({ id, name });
  const input = (_event, id, data) => data;
  ipcMain.handle('test-rename-session', rename);
  ipcMain.on('test-terminal-input', input);

  assert.deepEqual(ipcMain.registered.map(([kind, channel, fn]) => [kind, channel, fn]), [
    ['handle', 'test-rename-session', rename],
    ['on', 'test-terminal-input', input],
  ]);
  assert.deepEqual(getHandler('test-rename-session'), { kind: 'handle', fn: rename });
  assert.deepEqual(getHandler('test-terminal-input'), { kind: 'on', fn: input });
  // Another transport calls the same function with a null event.
  assert.deepEqual(await getHandler('test-rename-session').fn(null, 's1', 'Login'), { id: 's1', name: 'Login' });
});

test('ipcMain.on keeps returning what Electron returns, for chaining', () => {
  const ipcMain = fakeIpcMain();
  install(ipcMain);
  assert.equal(ipcMain.on('test-chain', () => {}), ipcMain);
});

test('an unknown channel has no handler', () => {
  assert.equal(getHandler('test-not-registered'), null);
});
