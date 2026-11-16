const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const nacl = require('tweetnacl');
const WebSocket = require('ws');

const { createRemoteProtocol } = require('../remote-protocol');
const { createRemoteAuth } = require('../remote-auth');
const { createRemoteApi } = require('../remote-api');
const { createRemoteServer, reachableAddresses, pairingLink, WS_PATH, CLOSE } = require('../remote-server');

const protocol = createRemoteProtocol(nacl);
const quietLog = { info() {}, warn() {}, error() {} };

/** A running server with in-memory settings and a few fake handlers. */
async function setup(handlers = {}, { localMethods = {}, onClientClosed } = {}) {
  const settings = new Map();
  const auth = createRemoteAuth({
    nacl,
    getSetting: (key) => (settings.has(key) ? JSON.parse(settings.get(key)) : null),
    setSetting: (key, value) => settings.set(key, JSON.stringify(value)),
  });
  const registry = new Map(Object.entries(handlers).map(([channel, fn]) => [channel, { kind: 'handle', fn: (_e, ...args) => fn(...args) }]));
  const api = createRemoteApi({ getHandler: (channel) => registry.get(channel) || null, localMethods });
  const statuses = [];
  const server = createRemoteServer({ protocol, auth, api, log: quietLog, appVersion: '9.9.9', desktopName: 'Test Mac', onStatus: (s) => statuses.push(s), onClientClosed });
  const status = await server.start(0);
  return { server, auth, port: status.port, statuses };
}

/**
 * Connect as a phone. Resolves once the handshake is done (with the hello
 * event) or the server closes the socket (with its close code).
 */
function connectPhone(port, { device, desktopPublicKey, mode = 'auth', code = null, afterHandshake } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
    const phone = { ws, events: [], replies: new Map(), nextId: 1 };
    let pending = null;
    ws.on('open', () => {
      const hello = protocol.phoneHello(device, { mode, name: 'Test phone' });
      pending = hello.state;
      ws.send(JSON.stringify(hello.message));
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const answer = protocol.phoneAnswer(JSON.parse(data.toString()), pending, device, desktopPublicKey, code);
        phone.channel = answer.channel;
        ws.send(JSON.stringify(answer.message));
        return;
      }
      const message = phone.channel.open(data);
      if (message.event === 'remote-access-hello') {
        phone.hello = message.args[0];
        afterHandshake?.(phone);
        resolve(phone);
      } else if (message.event) {
        phone.events.push([message.event, ...message.args]);
      } else {
        phone.replies.get(message.id)?.(message);
      }
    });
    ws.on('close', (closeCode, reason) => {
      phone.closeCode = closeCode;
      phone.closeReason = reason.toString();
      phone.onClose?.();
      resolve(phone);
    });
  });
}

function call(phone, method, params) {
  return new Promise((resolve) => {
    const id = phone.nextId++;
    phone.replies.set(id, resolve);
    phone.ws.send(phone.channel.seal({ id, method, params }));
  });
}

function closed(phone) {
  if (phone.closeCode) return Promise.resolve(phone.closeCode);
  return new Promise((resolve) => { phone.onClose = () => resolve(phone.closeCode); });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a phone pairs with the QR code, then connects and calls methods', async () => {
  const { server, auth, port } = await setup({ 'get-projects': (archived) => [{ projectPath: '/p', archived }] });
  try {
    const device = nacl.box.keyPair();
    const desktopPublicKey = auth.identity().publicKey;
    const { code } = auth.startPairing();
    const paired = await connectPhone(port, { device, desktopPublicKey, mode: 'pair', code });
    assert.equal(paired.hello.desktop, 'Test Mac');
    assert.equal(paired.hello.device.name, 'Test phone');
    assert.deepEqual(paired.hello.methods, ['get-projects']);
    paired.ws.close();

    const phone = await connectPhone(port, { device, desktopPublicKey });
    assert.equal(phone.hello.device.id, paired.hello.device.id);
    assert.deepEqual(await call(phone, 'get-projects', [true]), { id: 1, result: [{ projectPath: '/p', archived: true }] });
    assert.match((await call(phone, 'open-external', ['https://example.com'])).error, /Not available remotely/);
    assert.equal(server.status().clients.length, 1);
    phone.ws.close();
  } finally {
    await server.stop();
  }
});

test('unknown devices, closed pairings and wrong codes are turned away', async () => {
  const { server, auth, port } = await setup();
  try {
    const desktopPublicKey = auth.identity().publicKey;
    const stranger = await connectPhone(port, { device: nacl.box.keyPair(), desktopPublicKey });
    assert.equal(stranger.closeCode, CLOSE.UNKNOWN_DEVICE);

    const noPairing = await connectPhone(port, { device: nacl.box.keyPair(), desktopPublicKey, mode: 'pair', code: nacl.randomBytes(32) });
    assert.equal(noPairing.closeCode, CLOSE.PAIRING_FAILED);

    auth.startPairing();
    const wrongCode = await connectPhone(port, { device: nacl.box.keyPair(), desktopPublicKey, mode: 'pair', code: nacl.randomBytes(32) });
    assert.equal(wrongCode.closeCode, CLOSE.PAIRING_FAILED);
    assert.equal(auth.listDevices().length, 0);
  } finally {
    await server.stop();
  }
});

test('after the handshake, an unencrypted frame closes the connection', async () => {
  const { server, auth, port } = await setup();
  try {
    const device = nacl.box.keyPair();
    const desktopPublicKey = auth.identity().publicKey;
    auth.completePairing(auth.startPairing().code, device.publicKey, 'Phone');
    const phone = await connectPhone(port, { device, desktopPublicKey });
    phone.ws.send(JSON.stringify({ id: 1, method: 'get-projects' }));
    assert.equal(await closed(phone), CLOSE.PROTOCOL);
  } finally {
    await server.stop();
  }
});

test('phones receive their events, with projects-changed at most once a second', async () => {
  const { server, auth, port } = await setup();
  try {
    const device = nacl.box.keyPair();
    auth.completePairing(auth.startPairing().code, device.publicKey, 'Phone');
    const phone = await connectPhone(port, { device, desktopPublicKey: auth.identity().publicKey });
    server.eventSink('cli-busy-state', ['s1', true]);
    server.eventSink('terminal-data', ['s1', 'secret output']);
    server.eventSink('projects-changed', ['sessions']);
    server.eventSink('projects-changed', ['project']);
    server.eventSink('projects-changed', ['sessions']);
    await wait(100);
    assert.deepEqual(phone.events, [['cli-busy-state', 's1', true], ['projects-changed', 'sessions']]);
    await wait(1100);
    assert.deepEqual(phone.events.slice(2), [['projects-changed', 'project']]);
    phone.ws.close();
  } finally {
    await server.stop();
  }
});

test('revoking a device or turning the server off disconnects at once', async () => {
  const { server, auth, port, statuses } = await setup();
  const desktopPublicKey = auth.identity().publicKey;
  const first = nacl.box.keyPair();
  const second = nacl.box.keyPair();
  const { device } = auth.completePairing(auth.startPairing().code, first.publicKey, 'First');
  auth.completePairing(auth.startPairing().code, second.publicKey, 'Second');
  const a = await connectPhone(port, { device: first, desktopPublicKey });
  const b = await connectPhone(port, { device: second, desktopPublicKey });

  auth.revokeDevice(device.id);
  server.disconnectDevice(device.id);
  assert.equal(await closed(a), CLOSE.REVOKED);
  assert.equal((await connectPhone(port, { device: first, desktopPublicKey })).closeCode, CLOSE.UNKNOWN_DEVICE);

  const stopped = await server.stop();
  assert.equal(await closed(b), CLOSE.SHUTDOWN);
  assert.equal(stopped.running, false);
  assert.equal(statuses.at(-1).running, false);
});

test('a port already in use is reported, not thrown', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '0.0.0.0', r));
  const port = blocker.address().port;
  const { server } = await setup();
  await server.stop();
  try {
    const status = await server.start(port);
    assert.equal(status.running, false);
    assert.match(status.error, new RegExp(`Port ${port} is already in use`));
  } finally {
    blocker.close();
  }
});

test('addresses list the LAN first, then the .local name, then Tailscale', () => {
  const interfaces = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    utun4: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
    en5: [{ address: '169.254.10.1', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(reachableAddresses(interfaces, 'mac-mini'), ['192.168.1.20', 'mac-mini.local', '100.101.102.103']);
  assert.deepEqual(reachableAddresses(interfaces, 'mac-mini.local'), ['192.168.1.20', 'mac-mini.local', '100.101.102.103']);
});

test('the pairing link carries what the phone needs, URL-safe', () => {
  const publicKey = new Uint8Array(32).fill(251);
  const code = new Uint8Array(32).fill(7);
  const link = pairingLink({ name: 'Mac', addresses: ['192.168.1.20'], port: 47100, publicKey, code, expiresAt: 123 });
  assert.match(link, /^switchboard-e:\/\/pair\?d=[A-Za-z0-9_-]+$/);
  const data = link.split('d=')[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  assert.deepEqual(payload, { v: 1, n: 'Mac', a: ['192.168.1.20'], p: 47100, k: Buffer.from(publicKey).toString('base64'), c: Buffer.from(code).toString('base64'), x: 123 });
});

test('a local method gets the calling phone, can push to it, and hears when it leaves', async () => {
  const closed = [];
  const { server, auth, port } = await setup({}, {
    localMethods: {
      'attach-terminal': (phone, id) => {
        phone.send({ event: 'terminal-reset', args: [id, 'replay', 6, {}] });
        return { seq: 6, device: phone.device.name, buffered: phone.bufferedAmount() };
      },
    },
    onClientClosed: (phone) => closed.push(phone.device.name),
  });
  try {
    const device = nacl.box.keyPair();
    auth.completePairing(auth.startPairing().code, device.publicKey, 'Phone');
    const phone = await connectPhone(port, { device, desktopPublicKey: auth.identity().publicKey });
    const reply = await call(phone, 'attach-terminal', ['s1']);
    assert.deepEqual(reply.result, { seq: 6, device: 'Phone', buffered: 0 });
    assert.deepEqual(phone.events, [['terminal-reset', 's1', 'replay', 6, {}]]);
    phone.ws.close();
    await wait(50);
    assert.deepEqual(closed, ['Phone']);
  } finally {
    await server.stop();
  }
});
