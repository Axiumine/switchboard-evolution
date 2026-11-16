// Terminals that outlive Switchboard: herdr-core (`hc`) owns the PTYs, and
// Switchboard is one of their viewers. Quitting Switchboard detaches; the
// programs keep running, and the next start finds them by their labels and
// attaches again. See https://github.com/herdrdev/herdr-core (schema/README.md)
// for the protocol: `herdr-core connect` speaks JSON-RPC 2.0 over stdio, then,
// after `hello {framed: true}`, frames of [channel u32 LE][kind u8][len u32 LE].
//
// HcPty has the shape of node-pty's IPty (onData, onExit, write, resize, kill,
// pid, process), so main.js treats both engines alike.

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');

const KIND = { DATA: 0, CREDIT: 1, CLOSE: 2, RESIZE: 3, FOCUS: 4, FACTS: 5, AUTOMATIC_INPUT: 6 };
const GENERATION = 1;
// The API this code was written against (terminal.run env/size/labels, attach history).
const MIN_VERSION = [0, 1, 20];
const APP_LABEL = 'switchboard';

// --- Finding hc ---

function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionAtLeast(version, min = MIN_VERSION) {
  if (!version) return false;
  for (let i = 0; i < 3; i++) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
}

function readVersion(bin, exec = execFileSync) {
  try {
    return parseVersion(exec(bin, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

/**
 * The hc to use: one installed on this Mac first (its updates are the user's),
 * else the copy shipped inside the app. The shipped copy runs from a copy in
 * userData, so replacing the app never pulls the binary from under a running
 * core. Null when there is none, or none recent enough.
 */
function locateHc({ home = os.homedir(), resourcesPath = process.resourcesPath, userDataDir, override = process.env.SWITCHBOARD_HC, exec = execFileSync, fsImpl = fs } = {}) {
  const installed = [
    override,
    path.join(home, '.local', 'bin', 'herdr-core'),
    path.join(home, '.local', 'bin', 'hc'),
    '/opt/homebrew/bin/herdr-core',
    '/opt/homebrew/bin/hc',
    '/usr/local/bin/herdr-core',
    '/usr/local/bin/hc',
  ].filter(Boolean);
  for (const candidate of installed) {
    if (!fsImpl.existsSync(candidate)) continue;
    const version = readVersion(candidate, exec);
    if (versionAtLeast(version)) return { path: candidate, version: version.join('.'), source: candidate === override ? 'override' : 'installed' };
  }

  const bundled = resourcesPath ? path.join(resourcesPath, 'bin', 'herdr-core') : null;
  if (!bundled || !userDataDir || !fsImpl.existsSync(bundled)) return null;
  const version = readVersion(bundled, exec);
  if (!versionAtLeast(version)) return null;
  const copy = path.join(userDataDir, 'hc', version.join('.'), 'herdr-core');
  try {
    if (!fsImpl.existsSync(copy)) {
      fsImpl.mkdirSync(path.dirname(copy), { recursive: true });
      fsImpl.copyFileSync(bundled, copy + '.tmp');
      fsImpl.chmodSync(copy + '.tmp', 0o755);
      fsImpl.renameSync(copy + '.tmp', copy);
    }
    return { path: copy, version: version.join('.'), source: 'bundled' };
  } catch {
    return { path: bundled, version: version.join('.'), source: 'bundled' };
  }
}

/**
 * Switchboard's own hc session (core, terminals and state), apart from the
 * user's. A test or dev instance with its own data dir gets its own too, so it
 * never finds the real app's terminals.
 */
function hcSessionName(dataDir) {
  if (!dataDir) return APP_LABEL;
  return `${APP_LABEL}-${crypto.createHash('sha1').update(path.resolve(dataDir)).digest('hex').slice(0, 8)}`;
}

// --- The wire: `herdr-core connect` over stdio ---

function frameBytes(channel, kind, payload = Buffer.alloc(0)) {
  const head = Buffer.alloc(9);
  head.writeUInt32LE(channel, 0);
  head.writeUInt8(kind, 4);
  head.writeUInt32LE(payload.length, 5);
  return Buffer.concat([head, payload]);
}

/**
 * One connection. `input`/`output` are the core's stdin/stdout (a child
 * process by default; tests pass streams). Emits 'notification' and 'close'.
 */
function createWire({ input, output, onClose = () => {} }) {
  const ev = new EventEmitter();
  const pending = new Map();
  const listeners = new Map();
  const backlog = new Map();
  let nextId = 1;
  let framed = false;
  let closed = false;
  let buf = Buffer.alloc(0);

  function deliver(msg) {
    if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(Object.assign(new Error(msg.error.message || 'hc error'), { kind: msg.error.data?.kind, data: msg.error.data }));
      else resolve(msg.result);
    } else if (msg.method) ev.emit('notification', msg);
  }

  output.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (!framed) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) return;
        const line = buf.subarray(0, nl).toString('utf8').trim();
        buf = buf.subarray(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        // The reply to hello {framed: true} is the last plain line.
        if (msg.result && msg.result.framed) framed = true;
        deliver(msg);
        continue;
      }
      if (buf.length < 9) return;
      const channel = buf.readUInt32LE(0);
      const kind = buf.readUInt8(4);
      const len = buf.readUInt32LE(5);
      if (buf.length < 9 + len) return;
      const payload = Buffer.from(buf.subarray(9, 9 + len));
      buf = buf.subarray(9 + len);
      if (channel === 0 && kind === KIND.DATA) {
        try { deliver(JSON.parse(payload.toString('utf8'))); } catch {}
        continue;
      }
      // A stream's first frames come in the same read as the attach reply,
      // before anyone listens: keep them until a listener takes the channel.
      const frame = { channel, kind, payload };
      if (listeners.has(channel)) listeners.get(channel)(frame);
      else {
        if (!backlog.has(channel)) backlog.set(channel, []);
        backlog.get(channel).push(frame);
      }
    }
  });

  const finish = (reason) => {
    if (closed) return;
    closed = true;
    for (const { reject } of pending.values()) reject(Object.assign(new Error('hc connection closed'), { kind: 'disconnected' }));
    pending.clear();
    onClose(reason);
    ev.emit('close', reason);
  };
  output.on('end', () => finish('end'));
  output.on('close', () => finish('close'));

  function send(channel, kind, payload) {
    if (closed) return;
    try { input.write(frameBytes(channel, kind, payload)); } catch {}
  }

  return {
    ev,
    get closed() { return closed; },
    call(method, params = {}) {
      if (closed) return Promise.reject(Object.assign(new Error('hc connection closed'), { kind: 'disconnected' }));
      const id = nextId++;
      const text = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          if (framed) input.write(frameBytes(0, KIND.DATA, Buffer.from(text, 'utf8')));
          else input.write(text + '\n');
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },
    hello() { return this.call('hello', { framed: true, generation: GENERATION }); },
    /** Take a stream's frames; the ones that came before this call are delivered first. */
    listen(channel, fn) {
      listeners.set(channel, fn);
      const early = backlog.get(channel) || [];
      backlog.delete(channel);
      for (const frame of early) fn(frame);
    },
    unlisten(channel) { listeners.delete(channel); backlog.delete(channel); },
    data(channel, bytes) { send(channel, KIND.DATA, bytes); },
    credit(channel, n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); send(channel, KIND.CREDIT, b); },
    resize(channel, cols, rows) { const b = Buffer.alloc(4); b.writeUInt16LE(cols, 0); b.writeUInt16LE(rows, 2); send(channel, KIND.RESIZE, b); },
    closeChannel(channel) { send(channel, KIND.CLOSE); },
    end() { try { input.end(); } catch {} finish('ended'); },
  };
}

// --- A terminal in hc, shaped like node-pty's IPty ---

class HcPty {
  constructor(engine, { cols = 120, rows = 30, address = null, pid = null, labels = {} } = {}) {
    this._engine = engine;
    this.cols = cols;
    this.rows = rows;
    this.address = address;
    this.pid = pid;
    this.labels = { ...labels };
    this.channel = null;
    this._foreground = '';
    this._dataListeners = new Set();
    // Output before anyone listens (the first paint of an adopted terminal) waits here.
    this._early = [];
    this._exitListeners = new Set();
    this._queue = [];
    this._decoder = new StringDecoder('utf8');
    this._exited = false;
    this._detached = false;
    this._killWhenStarted = false;
  }

  /** The foreground process's name, as node-pty's `process`. */
  get process() { return this._foreground; }

  onData(fn) {
    this._dataListeners.add(fn);
    const early = this._early;
    this._early = [];
    for (const text of early) fn(text);
    return { dispose: () => this._dataListeners.delete(fn) };
  }

  _emitData(text) {
    if (!this._dataListeners.size) { this._early.push(text); return; }
    for (const fn of [...this._dataListeners]) fn(text);
  }
  onExit(fn) { this._exitListeners.add(fn); return { dispose: () => this._exitListeners.delete(fn) }; }

  write(data) {
    if (this._exited || this._detached) return;
    if (this.channel === null) { this._queue.push(data); return; }
    this._engine._wire().data(this.channel, Buffer.from(String(data), 'utf8'));
  }

  resize(cols, rows) {
    if (!cols || !rows) return;
    this.cols = cols;
    this.rows = rows;
    if (this.channel !== null && !this._exited) this._engine._wire().resize(this.channel, cols, rows);
  }

  /** End the program (hc hangs up, then escalates). Resolves once hc has the request. */
  kill() {
    if (this._exited) return Promise.resolve();
    if (!this.address) { this._killWhenStarted = true; return Promise.resolve(); }
    return this._engine._call('terminal.kill', { terminal: this.address }).catch(() => {});
  }

  /** Stop viewing; the program keeps running in hc. */
  detach() {
    if (this._detached || this._exited) return;
    this._detached = true;
    if (this.channel !== null) {
      const wire = this._engine._wire();
      wire.closeChannel(this.channel);
      wire.unlisten(this.channel);
    }
    this._engine._forget(this);
  }

  /** Keep labels in step with the session (e.g. its id once known). `key: ''` removes one. */
  relabel(labels) {
    for (const [k, v] of Object.entries(labels)) {
      if (v === '' || v === null || v === undefined) delete this.labels[k];
      else this.labels[k] = String(v);
    }
    if (!this.address || this._exited) return;
    const sent = Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]));
    this._engine._call('terminal.label', { terminal: this.address, labels: sent }).catch(() => {});
  }

  async _attach({ history = 0, resumed = false } = {}) {
    const result = await this._engine._call('terminal.attach', {
      terminal: this.address, cols: this.cols, rows: this.rows, history, resumed,
    });
    if (this._detached) { this._engine._wire().closeChannel(result.channel); return; }
    this.channel = result.channel;
    if (result.terminal?.pid) this.pid = result.terminal.pid;
    if (result.terminal?.foreground?.name) this._foreground = result.terminal.foreground.name;
    this._engine._wire().listen(this.channel, frame => this._onFrame(frame));
    const queued = this._queue;
    this._queue = [];
    for (const data of queued) this.write(data);
  }

  _onFrame({ kind, payload }) {
    if (kind === KIND.DATA) {
      const text = this._decoder.write(payload);
      // Give the bytes back as consumed: hc stops sending past 256 KiB unacknowledged.
      this._engine._wire().credit(this.channel, payload.length);
      if (text) this._emitData(text);
    } else if (kind === KIND.CLOSE) {
      this._engine._wire().unlisten(this.channel);
      this.channel = null;
      let reason = null;
      try { reason = payload.length ? JSON.parse(payload.toString('utf8')) : null; } catch {}
      // An empty CLOSE answers our own detach; anything else means the program is over.
      if (reason && reason.reason) this._finish(reason);
    }
  }

  _finish({ exit_code: exitCode = null, signal = null } = {}) {
    if (this._exited) return;
    this._exited = true;
    this._engine._forget(this);
    const tail = this._decoder.end();
    if (tail) this._emitData(tail);
    // node-pty reports a signal kill as exitCode 0 plus the signal.
    const info = { exitCode: exitCode ?? 0, signal: signal ?? undefined };
    for (const fn of [...this._exitListeners]) fn(info);
  }

  _failStart(err) {
    const message = `\r\n\x1b[31mSwitchboard could not start this terminal in herdr-core: ${err.message}\x1b[0m\r\n`;
    this._emitData(message);
    this._finish({ exit_code: 1 });
  }
}

// --- The engine ---

/**
 * Start a connection to Switchboard's hc session. `connect` makes the stdio
 * pair (tests pass a fake core). Resolves to the engine, or rejects when hc
 * cannot be reached or speaks another protocol generation.
 */
async function createHcEngine({ binary, env, log = console, connect } = {}) {
  const open = connect || (() => {
    const child = spawn(binary, ['connect'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', d => log.warn?.(`[hc] ${String(d).trim()}`));
    child.on('error', err => log.error?.('[hc] connect failed', err));
    return { input: child.stdin, output: child.stdout, kill: () => child.kill() };
  });

  const live = new Map(); // address -> HcPty
  let wire = null;
  let conn = null;
  let closing = false;
  let reconnecting = null;
  let info = null;

  async function dial() {
    conn = open();
    const next = createWire({ input: conn.input, output: conn.output, onClose: () => onDrop(next) });
    wire = next;
    const hello = await next.hello();
    if (hello.generation !== GENERATION) {
      next.end();
      throw new Error(`hc speaks protocol generation ${hello.generation}, Switchboard speaks ${GENERATION}`);
    }
    info = { version: hello.core?.version || null };
    const sub = await next.call('events.subscribe', { labels: { app: APP_LABEL } });
    for (const record of sub.terminals || []) applyRecord(record);
    if (sub.channel !== null && sub.channel !== undefined) {
      const decoder = new StringDecoder('utf8');
      let pendingText = '';
      next.listen(sub.channel, ({ kind, payload }) => {
        if (kind !== KIND.DATA) return;
        next.credit(sub.channel, payload.length);
        pendingText += decoder.write(payload);
        let nl;
        while ((nl = pendingText.indexOf('\n')) >= 0) {
          const line = pendingText.slice(0, nl).trim();
          pendingText = pendingText.slice(nl + 1);
          if (line) { try { onEvent(JSON.parse(line)); } catch {} }
        }
        const rest = pendingText.trim();
        if (rest.startsWith('{') && rest.endsWith('}')) { try { onEvent(JSON.parse(rest)); pendingText = ''; } catch {} }
      });
    }
  }

  function applyRecord(record) {
    const pty = live.get(record.address);
    if (!pty) return;
    if (record.foreground?.name) pty._foreground = record.foreground.name;
    if (record.pid) pty.pid = record.pid;
  }

  function onEvent(msg) {
    if (msg.method !== 'event') return;
    const { type, terminal, data } = msg.params || {};
    const pty = live.get(terminal);
    if (!pty) return;
    if (type === 'foreground') pty._foreground = data?.name || '';
    else if (type === 'finished') pty._finish(data || {});
    else if (type === 'removed') pty._finish({});
  }

  function onDrop(dropped) {
    if (closing || dropped !== wire) return;
    log.warn?.('[hc] connection lost; reconnecting');
    reconnecting = reconnect();
  }

  async function reconnect() {
    for (const delay of [500, 1000, 2000, 5000, 5000, 10000]) {
      await new Promise(r => setTimeout(r, delay));
      if (closing) return;
      try {
        await dial();
        for (const pty of [...live.values()]) {
          pty.channel = null;
          await pty._attach({ resumed: true }).catch(err => {
            if (err.kind === 'not_found') pty._finish({});
          });
        }
        log.info?.('[hc] reconnected');
        reconnecting = null;
        return;
      } catch (err) {
        log.warn?.(`[hc] reconnect failed: ${err.message}`);
      }
    }
    // hc is gone for good: whatever it ran is out of reach.
    for (const pty of [...live.values()]) pty._finish({});
  }

  await dial();

  const engine = {
    get version() { return info?.version; },
    _wire: () => wire,
    _call: async (method, params) => {
      if (reconnecting) await reconnecting;
      return wire.call(method, params);
    },
    _forget: (pty) => { if (pty.address && live.get(pty.address) === pty) live.delete(pty.address); },

    /** Start a program in a new hc terminal; returns at once, like node-pty. */
    spawn(file, args, { cwd, env: termEnv = {}, cols = 120, rows = 30, labels = {} } = {}) {
      const allLabels = { app: APP_LABEL, ...Object.fromEntries(Object.entries(labels).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])) };
      const pty = new HcPty(engine, { cols, rows, labels: allLabels });
      (async () => {
        // Labels added right after spawn (e.g. by relabel) go out with the run.
        await null;
        const run = await engine._call('terminal.run', {
          argv: [file, ...(args || [])], cwd, env: termEnv, size: { cols, rows },
          labels: { ...pty.labels }, no_parent: true, rm: true,
        });
        pty.address = run.address;
        pty.pid = run.pid || null;
        live.set(run.address, pty);
        if (pty._killWhenStarted) { pty.kill(); }
        await pty._attach({ history: 0 });
      })().catch(err => {
        log.error?.('[hc] could not start a terminal', err);
        pty._failStart(err);
      });
      return pty;
    },

    /** The live terminals Switchboard started (in this hc session), with their labels. */
    async list() {
      const result = await engine._call('terminal.list', { labels: { app: APP_LABEL } });
      return (result.terminals || []).filter(t => t.state === 'live' && !t.reason);
    },

    /** View a terminal found by list(): its screen and history come first. */
    async adopt(record, { cols = record.cols || 120, rows = record.rows || 30, history = 1000 } = {}) {
      const pty = new HcPty(engine, { cols, rows, address: record.address, pid: record.pid || null, labels: record.labels || {} });
      if (record.foreground?.name) pty._foreground = record.foreground.name;
      live.set(record.address, pty);
      await pty._attach({ history });
      return pty;
    },

    /** Detach every terminal and drop the connection; the programs keep running. */
    close() {
      closing = true;
      for (const pty of [...live.values()]) pty.detach();
      wire?.end();
      try { conn?.kill?.(); } catch {}
    },
  };
  return engine;
}

module.exports = {
  createHcEngine, createWire, locateHc, hcSessionName, parseVersion, versionAtLeast, frameBytes,
  HcPty, KIND, APP_LABEL, MIN_VERSION,
};
