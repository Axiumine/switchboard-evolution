const { test } = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');
const WebSocket = require('ws');

const { createRemoteProtocol } = require('../remote-protocol');
const { createRemoteAuth } = require('../remote-auth');
const { createRemoteApi } = require('../remote-api');
const { createRemoteServer, pairingLink, admits, WS_PATH } = require('../remote-server');

const protocol = createRemoteProtocol(nacl);
const quietLog = { info() {}, warn() {}, error() {} };

/** A running server that also answers through tunnels: an access key and Internet routes. */
async function setup({ routes = {} } = {}) {
  const settings = new Map();
  const auth = createRemoteAuth({
    nacl,
    getSetting: (key) => (settings.has(key) ? JSON.parse(settings.get(key)) : null),
    setSetting: (key, value) => settings.set(key, JSON.stringify(value)),
  });
  const api = createRemoteApi({ getHandler: () => null, localMethods: {} });
  const server = createRemoteServer({
    protocol, auth, api, log: quietLog, appVersion: '9.9.9', desktopName: 'Test Mac',
    accessKey: () => auth.accessKey(), routes: () => routes,
  });
  const status = await server.start(0);
  return { server, auth, port: status.port };
}

/** Pair a phone over `query` (e.g. "?k=..."). Resolves with the hello, or with the close code when turned away. */
function pairPhone(port, auth, query = '') {
  const device = nacl.box.keyPair();
  const { code } = auth.startPairing();
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}${query}`);
    let state = null;
    let channel = null;
    ws.on('open', () => {
      const hello = protocol.phoneHello(device, { mode: 'pair', name: 'Test phone' });
      state = hello.state;
      ws.send(JSON.stringify(hello.message));
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const answer = protocol.phoneAnswer(JSON.parse(data.toString()), state, device, auth.identity().publicKey, code);
        channel = answer.channel;
        ws.send(JSON.stringify(answer.message));
        return;
      }
      const message = channel.open(data);
      if (message.event === 'remote-access-hello') { resolve({ hello: message.args[0] }); ws.close(); }
    });
    ws.on('error', () => {});
    ws.on('close', (closeCode) => resolve({ closeCode }));
  });
}

test('the access key is made once and kept, and fits in a URL', () => {
  const settings = new Map();
  const make = () => createRemoteAuth({
    nacl,
    getSetting: (key) => (settings.has(key) ? JSON.parse(settings.get(key)) : null),
    setSetting: (key, value) => settings.set(key, JSON.stringify(value)),
  });
  const key = make().accessKey();
  assert.match(key, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(make().accessKey(), key);
});

test('the pairing link carries the access key and the Internet routes', () => {
  const link = pairingLink({
    name: 'Mac', addresses: ['192.168.1.20'], port: 47100, publicKey: new Uint8Array(32), code: new Uint8Array(32), expiresAt: 1,
    accessKey: 'abc_DEF-123', routes: { cloudflare: 'wss://sb.example.com', ngrok: 'wss://sb.ngrok-free.app' },
  });
  const data = link.split('d=')[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  assert.equal(payload.ak, 'abc_DEF-123');
  assert.deepEqual(payload.r, { cloudflare: 'wss://sb.example.com', ngrok: 'wss://sb.ngrok-free.app' });
});

test('without routes or a key, the link stays as the apps of today read it', () => {
  const link = pairingLink({ name: 'Mac', addresses: ['192.168.1.20'], port: 47100, publicKey: new Uint8Array(32), code: new Uint8Array(32), expiresAt: 1, routes: {} });
  const payload = JSON.parse(Buffer.from(link.split('d=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['a', 'c', 'k', 'n', 'p', 'v', 'x']);
});

test('through a tunnel, a phone with the access key pairs and learns the key and the routes', async () => {
  const routes = { cloudflare: 'wss://sb.example.com' };
  const { server, auth, port } = await setup({ routes });
  try {
    const { hello } = await pairPhone(port, auth, `?k=${auth.accessKey()}`);
    assert.equal(hello.accessKey, auth.accessKey());
    assert.deepEqual(hello.routes, routes);
  } finally {
    await server.stop();
  }
});

test('through a tunnel, a connection without the access key, or with a wrong one, is turned away before the handshake', async () => {
  const { server, auth, port } = await setup();
  try {
    // 127.0.0.1 is how cloudflared and ngrok reach the server.
    const none = await pairPhone(port, auth);
    assert.equal(none.hello, undefined);
    assert.equal(none.closeCode, 1006);
    const wrong = await pairPhone(port, auth, '?k=not-the-key');
    assert.equal(wrong.hello, undefined);
    assert.equal(auth.listDevices().length, 0);
  } finally {
    await server.stop();
  }
});

test('from the local network the key may be missing, for phones paired before it existed, but never wrong', () => {
  const key = 'the-key';
  assert.equal(admits({ remoteAddress: '192.168.1.30', given: null, key }), true);
  assert.equal(admits({ remoteAddress: '192.168.1.30', given: 'the-key', key }), true);
  assert.equal(admits({ remoteAddress: '192.168.1.30', given: 'other', key }), false);
  for (const loopback of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(admits({ remoteAddress: loopback, given: null, key }), false, loopback);
    assert.equal(admits({ remoteAddress: loopback, given: 'the-key', key }), true, loopback);
  }
  // A server without a key (no tunnels in play) admits as before.
  assert.equal(admits({ remoteAddress: '127.0.0.1', given: null, key: null }), true);
});
