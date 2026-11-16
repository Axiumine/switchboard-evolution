// The remote-access server: lets a paired phone see and drive this desktop.
//
// It only runs while the sidebar switch is on. It listens on every interface,
// so a phone on the same network (or the same Tailscale tailnet) can reach it,
// and every message after the handshake is encrypted end to end
// (remote-protocol.js). One WebSocket per phone carries requests, replies and
// events. From the Internet a phone comes through a tunnel (Cloudflare or
// ngrok, remote-tunnels.js) and must carry the access key (admits).

const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');
const { PROTOCOL_VERSION, toBase64, encodeUtf8 } = require('./remote-protocol');

const WS_PATH = '/remote';
const HANDSHAKE_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
// projects-changed fires several times a minute per running session; a phone
// gets it at most this often.
const PROJECTS_CHANGED_INTERVAL_MS = 1000;

// Close codes a phone can act on.
const CLOSE = {
  PROTOCOL: 4002,
  UNKNOWN_DEVICE: 4003,
  REVOKED: 4004,
  PAIRING_FAILED: 4005,
  SHUTDOWN: 1001,
};

/**
 * The addresses a phone can try, best first: LAN addresses, then the
 * machine's .local name, then Tailscale (100.64.0.0/10) addresses.
 */
function reachableAddresses(interfaces, hostName) {
  const lan = [];
  const tailscale = [];
  for (const list of Object.values(interfaces || {})) {
    for (const info of list || []) {
      if (info.internal || info.family !== 'IPv4') continue;
      const [a, b] = info.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) tailscale.push(info.address);
      else if (!(a === 169 && b === 254)) lan.push(info.address);
    }
  }
  const local = hostName ? (hostName.endsWith('.local') ? hostName : `${hostName}.local`) : null;
  return [...new Set([...lan, ...(local ? [local] : []), ...tailscale])];
}

/** The text in the pairing QR code: a link the mobile app opens. */
function pairingLink({ name, addresses, port, publicKey, code, expiresAt, accessKey, routes }) {
  const payload = JSON.stringify({
    v: PROTOCOL_VERSION, n: name, a: addresses, p: port,
    k: toBase64(publicKey), c: toBase64(code), x: expiresAt,
    // The Internet routes ({ cloudflare, ngrok }: wss:// addresses) and the
    // access key they need. Left out when there are none, as before.
    ...(accessKey ? { ak: accessKey } : {}),
    ...(routes && Object.keys(routes).length ? { r: routes } : {}),
  });
  const data = toBase64(encodeUtf8(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Switchboard Evolution's own scheme, so the phone camera opens its app,
  // not the old one (the app reads both).
  return `switchboard-e://pair?d=${data}`;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Whether a connection may start the handshake. A tunnel (cloudflared, ngrok)
 * reaches the server from this computer, so a connection from here comes from
 * the Internet and must carry the access key. From the local network the key
 * may be missing, for a phone paired before it existed; a wrong one is never
 * let in. Without a key (no tunnels in play) everyone may try, as before.
 */
function admits({ remoteAddress, given, key }) {
  if (!key) return true;
  if (given === null) return !LOOPBACK.has(remoteAddress);
  const a = Buffer.from(String(given));
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createRemoteServer({ protocol, auth, api, log, appVersion, desktopName, accessKey = () => null, routes = () => ({}), onStatus = () => {}, onClientClosed = () => {} }) {
  let httpServer = null;
  let wss = null;
  let heartbeat = null;
  let state = { running: false, port: null, error: null };
  const clients = new Set(); // { ws, channel, device, lastProjectsChangedAt, pendingProjectsReason, projectsTimer }

  function status() {
    return { ...state, clients: [...clients].map(c => ({ id: c.device.id, name: c.device.name })) };
  }

  function reportStatus() {
    try { onStatus(status()); } catch (err) { log.error('[remote] status listener failed', err); }
  }

  function send(client, message) {
    if (client.ws.readyState !== client.ws.OPEN) return;
    client.ws.send(client.channel.seal(message));
  }

  function closeClient(client, code, reason) {
    clearTimeout(client.projectsTimer);
    try { client.ws.close(code, reason); } catch {}
  }

  function handleConnection(ws, req) {
    const remote = req.socket.remoteAddress;
    let step = 'hello';
    let handshake = null;
    let client = null;
    const fail = (code, reason) => {
      log.warn(`[remote] ${remote}: ${reason}`);
      try { ws.close(code, reason); } catch {}
    };
    const handshakeTimer = setTimeout(() => {
      if (!client) fail(CLOSE.PROTOCOL, 'Handshake timed out');
    }, HANDSHAKE_TIMEOUT_MS);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (data, isBinary) => {
      try {
        if (step === 'hello' || step === 'proof') {
          if (isBinary) return fail(CLOSE.PROTOCOL, 'Expected a handshake message');
          const message = JSON.parse(data.toString('utf8'));
          if (step === 'hello') {
            const { message: challenge, state: pending } = protocol.desktopChallenge(message, auth.identity());
            if (pending.mode === 'auth' && !auth.findDevice(pending.devicePublicKey)) {
              return fail(CLOSE.UNKNOWN_DEVICE, 'Unknown device');
            }
            if (pending.mode === 'pair' && !auth.pairingOpen()) {
              return fail(CLOSE.PAIRING_FAILED, 'Pairing is not open');
            }
            handshake = pending;
            step = 'proof';
            ws.send(JSON.stringify(challenge));
            return;
          }
          const verified = protocol.desktopVerifyProof(message, handshake, auth.identity());
          let device;
          if (handshake.mode === 'pair') {
            const paired = auth.completePairing(verified.pairingCode, verified.devicePublicKey, handshake.name);
            if (!paired.ok) return fail(CLOSE.PAIRING_FAILED, paired.error);
            device = paired.device;
            log.info(`[remote] paired "${device.name}" from ${remote}`);
          } else {
            device = auth.findDevice(verified.devicePublicKey);
            if (!device) return fail(CLOSE.UNKNOWN_DEVICE, 'Unknown device');
          }
          clearTimeout(handshakeTimer);
          step = 'ready';
          handshake = null;
          client = { ws, channel: verified.channel, device, lastProjectsChangedAt: 0, pendingProjectsReason: null, projectsTimer: null };
          // What the methods that need to know the caller get: a way to send
          // to this phone, and how much it still has to receive.
          client.handle = { device, send: (message) => send(client, message), bufferedAmount: () => ws.bufferedAmount };
          clients.add(client);
          auth.touchDevice(device.id);
          log.info(`[remote] "${device.name}" connected from ${remote}`);
          send(client, {
            event: 'remote-access-hello',
            // The access key and routes too, so a phone paired before them learns them here.
            args: [{ v: PROTOCOL_VERSION, appVersion, desktop: desktopName, device: { id: device.id, name: device.name }, methods: api.capabilities(), accessKey: accessKey() || undefined, routes: routes() }],
          });
          reportStatus();
          return;
        }
        // Ready: every frame is an encrypted request.
        if (!isBinary) return fail(CLOSE.PROTOCOL, 'Expected an encrypted frame');
        const request = client.channel.open(data);
        if (!request || typeof request.method !== 'string') return fail(CLOSE.PROTOCOL, 'Malformed request');
        const reply = await api.call(request.method, request.params, client.handle);
        send(client, { id: request.id, ...reply });
      } catch (err) {
        fail(CLOSE.PROTOCOL, err?.message || 'Protocol error');
      }
    });

    ws.on('close', () => {
      clearTimeout(handshakeTimer);
      if (client && clients.delete(client)) {
        clearTimeout(client.projectsTimer);
        log.info(`[remote] "${client.device.name}" disconnected`);
        try { onClientClosed(client.handle); } catch (err) { log.error('[remote] cleanup after a disconnect failed', err); }
        reportStatus();
      }
    });
    ws.on('error', (err) => log.warn(`[remote] ${remote}: ${err.message}`));
  }

  /** Start listening on every interface. Resolves with the status. */
  function start(port) {
    if (state.running) return Promise.resolve(status());
    return new Promise((resolve) => {
      httpServer = http.createServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found\n');
      });
      wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
      wss.on('connection', handleConnection);
      httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname !== WS_PATH) { socket.destroy(); return; }
        if (!admits({ remoteAddress: req.socket.remoteAddress, given: url.searchParams.get('k'), key: accessKey() })) {
          log.warn(`[remote] ${req.socket.remoteAddress}: no access key`);
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
      httpServer.once('error', (err) => {
        const error = err.code === 'EADDRINUSE' ? `Port ${port} is already in use` : err.message;
        // Retried every few seconds while the port is busy: say it once.
        if (state.error !== error) log.error(`[remote] could not listen on ${port}: ${err.message}`);
        state = { running: false, port, error };
        httpServer = null;
        wss = null;
        reportStatus();
        resolve(status());
      });
      httpServer.listen(port, '0.0.0.0', () => {
        state = { running: true, port: httpServer.address().port, error: null };
        heartbeat = setInterval(() => {
          for (const ws of wss.clients) {
            if (!ws.isAlive) { ws.terminate(); continue; }
            ws.isAlive = false;
            try { ws.ping(); } catch {}
          }
        }, HEARTBEAT_MS);
        log.info(`[remote] listening on port ${state.port}`);
        reportStatus();
        resolve(status());
      });
    });
  }

  /** Stop listening and disconnect every phone. */
  function stop() {
    if (!httpServer) {
      state = { running: false, port: null, error: null };
      reportStatus();
      return Promise.resolve(status());
    }
    clearInterval(heartbeat);
    heartbeat = null;
    for (const client of [...clients]) closeClient(client, CLOSE.SHUTDOWN, 'Remote access turned off');
    for (const client of clients) {
      try { onClientClosed(client.handle); } catch (err) { log.error('[remote] cleanup on stop failed', err); }
    }
    clients.clear();
    for (const ws of wss.clients) { try { ws.terminate(); } catch {} }
    const closing = httpServer;
    httpServer = null;
    wss = null;
    return new Promise((resolve) => {
      closing.close(() => {
        state = { running: false, port: null, error: null };
        log.info('[remote] stopped');
        reportStatus();
        resolve(status());
      });
      closing.closeAllConnections?.();
    });
  }

  /** Disconnect a device's open connections, after it is revoked. */
  function disconnectDevice(id) {
    for (const client of [...clients]) {
      if (client.device.id === id) closeClient(client, CLOSE.REVOKED, 'Device revoked');
    }
  }

  function sendProjectsChanged(client) {
    client.projectsTimer = null;
    client.lastProjectsChangedAt = Date.now();
    const reason = client.pendingProjectsReason;
    client.pendingProjectsReason = null;
    send(client, { event: 'projects-changed', args: [reason] });
  }

  /** A broadcast.js destination: forward the events a phone receives. */
  function eventSink(channel, args) {
    if (!api.forwardsEvent(channel)) return;
    for (const client of clients) {
      if (channel !== 'projects-changed') { send(client, { event: channel, args }); continue; }
      // A 'project' change outranks a 'sessions' one.
      client.pendingProjectsReason = client.pendingProjectsReason === 'project' || args[0] === 'project' ? 'project' : 'sessions';
      if (client.projectsTimer) continue;
      const wait = PROJECTS_CHANGED_INTERVAL_MS - (Date.now() - client.lastProjectsChangedAt);
      if (wait <= 0) sendProjectsChanged(client);
      else client.projectsTimer = setTimeout(() => sendProjectsChanged(client), wait);
    }
  }

  return { start, stop, status, eventSink, disconnectDevice };
}

module.exports = { createRemoteServer, reachableAddresses, pairingLink, admits, WS_PATH, CLOSE };
