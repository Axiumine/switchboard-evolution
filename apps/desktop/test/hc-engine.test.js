const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const { createHcEngine, locateHc, hcSessionName, versionAtLeast, parseVersion, frameBytes, KIND } = require('../hc-engine');

// --- A fake core: answers the engine's calls and streams frames back ---

function fakeCore({ generation = 1, terminals = [] } = {}) {
  const toEngine = new PassThrough();   // core stdout
  const fromEngine = new PassThrough(); // core stdin
  const calls = [];
  const frames = [];
  let framed = false;
  let buf = Buffer.alloc(0);
  let nextChannel = 5;
  let nextT = 1;
  const channels = new Map(); // channel -> address

  const reply = (id, result) => {
    const text = JSON.stringify({ jsonrpc: '2.0', id, result });
    if (framed) toEngine.write(frameBytes(0, KIND.DATA, Buffer.from(text)));
    else toEngine.write(text + '\n');
  };
  const fail = (id, kind, message) => toEngine.write(frameBytes(0, KIND.DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message, data: { kind } } }))));

  const core = {
    calls, frames, terminals, toEngine,
    /** Send stream bytes on a terminal's channel; `withReply` packs them into one write. */
    stream(address, bytes) { core.channelOf(address) && toEngine.write(frameBytes(core.channelOf(address), KIND.DATA, Buffer.from(bytes))); },
    end(address, reason) { toEngine.write(frameBytes(core.channelOf(address), KIND.CLOSE, Buffer.from(JSON.stringify(reason)))); },
    channelOf(address) { for (const [ch, a] of channels) if (a === address) return ch; return null; },
    firstPaint: new Map(), // address -> bytes sent right after the attach reply, in the same write
  };

  function handle(msg) {
    calls.push(msg);
    const { id, method, params } = msg;
    switch (method) {
      case 'hello': framed = false; reply(id, { framed: true, generation, core: { version: '0.1.21' } }); framed = true; break;
      case 'events.subscribe': reply(id, { seq: 0, terminals: [], channel: 1 }); break;
      case 'terminal.run': {
        const address = `t${nextT++}`;
        terminals.push({ address, state: 'live', labels: params.labels, pid: 4242, cols: params.size.cols, rows: params.size.rows });
        reply(id, { address, pid: 4242 });
        break;
      }
      case 'terminal.attach': {
        const t = terminals.find(x => x.address === params.terminal);
        if (!t) return fail(id, 'not_found', `no terminal ${params.terminal}`);
        const channel = nextChannel++;
        channels.set(channel, t.address);
        const text = JSON.stringify({ jsonrpc: '2.0', id, result: { channel, terminal: t, resize_notifications: false, automatic_input: false } });
        const paint = core.firstPaint.get(t.address);
        // The reply and the first paint in one write, as hc can send them.
        toEngine.write(Buffer.concat([frameBytes(0, KIND.DATA, Buffer.from(text)), ...(paint ? [frameBytes(channel, KIND.DATA, Buffer.from(paint))] : [])]));
        break;
      }
      case 'terminal.list': reply(id, { terminals: terminals.filter(t => Object.entries(params.labels || {}).every(([k, v]) => t.labels?.[k] === v)), hidden_finished: 0, machines: [] }); break;
      case 'terminal.kill': {
        const t = terminals.find(x => x.address === params.terminal);
        reply(id, { ...t, state: 'finished', reason: 'killed' });
        core.end(t.address, { reason: 'killed', exit_code: null, signal: 1 });
        break;
      }
      case 'terminal.label': reply(id, {}); break;
      default: reply(id, {});
    }
  }

  fromEngine.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (!framed) {
        const nl = buf.indexOf(0x0a);
        if (nl < 0) return;
        const line = buf.subarray(0, nl).toString();
        buf = buf.subarray(nl + 1);
        handle(JSON.parse(line));
        continue;
      }
      if (buf.length < 9) return;
      const channel = buf.readUInt32LE(0);
      const kind = buf.readUInt8(4);
      const len = buf.readUInt32LE(5);
      if (buf.length < 9 + len) return;
      const payload = Buffer.from(buf.subarray(9, 9 + len));
      buf = buf.subarray(9 + len);
      if (channel === 0 && kind === KIND.DATA) handle(JSON.parse(payload.toString()));
      else frames.push({ channel, kind, payload });
    }
  });

  core.connect = () => ({ input: fromEngine, output: toEngine, kill() {} });
  return core;
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await tick(10); assert.ok(fn(), 'condition never held'); };

test('versions: at least 0.1.20', () => {
  assert.deepEqual(parseVersion('hc 0.1.21\n'), [0, 1, 21]);
  assert.equal(versionAtLeast([0, 1, 20]), true);
  assert.equal(versionAtLeast([0, 2, 0]), true);
  assert.equal(versionAtLeast([0, 1, 19]), false);
  assert.equal(versionAtLeast(null), false);
});

test('each data dir gets its own hc session name', () => {
  assert.equal(hcSessionName(null), 'switchboard');
  const a = hcSessionName('/tmp/a');
  assert.match(a, /^switchboard-[0-9a-f]{8}$/);
  assert.notEqual(a, hcSessionName('/tmp/b'));
  assert.equal(a, hcSessionName('/tmp/a'));
});

test('an installed hc wins over the bundled one; an old one does not count', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-home-'));
  const res = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-res-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-ud-'));
  const local = path.join(home, '.local', 'bin', 'herdr-core');
  const bundled = path.join(res, 'bin', 'herdr-core');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(local, 'local');
  fs.writeFileSync(bundled, 'bundled');
  const versions = new Map([[local, 'hc 0.1.21'], [bundled, 'hc 0.1.20']]);
  const exec = (bin) => { if (!versions.has(bin)) throw new Error('missing'); return versions.get(bin); };
  const base = { home, resourcesPath: res, userDataDir: userData, override: null, exec };

  assert.deepEqual(locateHc(base), { path: local, version: '0.1.21', source: 'installed' });

  versions.set(local, 'hc 0.1.5');
  const fallback = locateHc(base);
  assert.equal(fallback.source, 'bundled');
  assert.equal(fallback.path, path.join(userData, 'hc', '0.1.20', 'herdr-core'));
  assert.equal(fs.readFileSync(fallback.path, 'utf8'), 'bundled', 'runs from a copy, so replacing the app leaves it in place');

  fs.rmSync(bundled);
  versions.delete(bundled);
  assert.equal(locateHc({ ...base, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hc-ud2-')) }), null);
});

test('a core of another protocol generation is refused', async () => {
  const core = fakeCore({ generation: 2 });
  await assert.rejects(createHcEngine({ connect: core.connect, log: quiet }), /generation 2/);
});

test('spawn runs the program with its labels, attaches, and streams both ways', async () => {
  const core = fakeCore();
  const engine = await createHcEngine({ connect: core.connect, log: quiet });
  const pty = engine.spawn('/bin/zsh', ['-l', '-i', '-c', 'claude'], { cwd: '/src/app', env: { TERM_PROGRAM: 'iTerm.app' }, cols: 120, rows: 30, labels: { sid: 'abc', projectId: null } });
  const out = [];
  pty.onData(d => out.push(d));
  pty.write('typed before attach\r');
  await until(() => pty.channel !== null);

  const run = core.calls.find(c => c.method === 'terminal.run').params;
  assert.deepEqual(run.argv, ['/bin/zsh', '-l', '-i', '-c', 'claude']);
  assert.equal(run.cwd, '/src/app');
  assert.deepEqual(run.env, { TERM_PROGRAM: 'iTerm.app' });
  assert.deepEqual(run.size, { cols: 120, rows: 30 });
  assert.deepEqual(run.labels, { app: 'switchboard', sid: 'abc' });
  assert.equal(run.no_parent, true);
  assert.equal(pty.pid, 4242);

  // Keys typed before the stream opened go out once it does.
  await until(() => core.frames.some(f => f.kind === KIND.DATA));
  assert.equal(core.frames.find(f => f.kind === KIND.DATA).payload.toString(), 'typed before attach\r');

  // A character split across two frames still arrives whole, and credit goes back.
  const euro = Buffer.from('€');
  core.stream('t1', Buffer.concat([Buffer.from('price '), euro.subarray(0, 1)]));
  core.stream('t1', euro.subarray(1));
  await until(() => out.join('') === 'price €');
  await until(() => core.frames.filter(f => f.kind === KIND.CREDIT).length === 2);

  pty.resize(100, 40);
  await until(() => core.frames.some(f => f.kind === KIND.RESIZE));
  const size = core.frames.find(f => f.kind === KIND.RESIZE).payload;
  assert.deepEqual([size.readUInt16LE(0), size.readUInt16LE(2)], [100, 40]);
  engine.close();
});

test('kill ends the program and reports a signal exit like node-pty', async () => {
  const core = fakeCore();
  const engine = await createHcEngine({ connect: core.connect, log: quiet });
  const pty = engine.spawn('/bin/sh', [], { cwd: '/' });
  const exits = [];
  pty.onExit(e => exits.push(e));
  await until(() => pty.channel !== null);
  pty.kill();
  await until(() => exits.length === 1);
  assert.deepEqual(exits[0], { exitCode: 0, signal: 1 });
  assert.ok(core.calls.some(c => c.method === 'terminal.kill' && c.params.terminal === 't1'));
  engine.close();
});

test('detach closes the stream without ending the program', async () => {
  const core = fakeCore();
  const engine = await createHcEngine({ connect: core.connect, log: quiet });
  const pty = engine.spawn('/bin/sh', [], { cwd: '/' });
  const exits = [];
  pty.onExit(e => exits.push(e));
  await until(() => pty.channel !== null);
  const channel = pty.channel;
  pty.detach();
  await until(() => core.frames.some(f => f.kind === KIND.CLOSE && f.channel === channel));
  assert.equal(exits.length, 0);
  assert.ok(!core.calls.some(c => c.method === 'terminal.kill'));
  engine.close();
});

test('a terminal found again is adopted: its first paint arrives with the attach reply', async () => {
  const core = fakeCore();
  core.terminals.push({ address: 't9', state: 'live', labels: { app: 'switchboard', sid: 'kept' }, pid: 77, cols: 120, rows: 30 });
  core.terminals.push({ address: 't10', state: 'live', labels: { app: 'other' }, pid: 78 });
  core.firstPaint.set('t9', '\x18\x1b[H\x1b[2Jstill here');
  const engine = await createHcEngine({ connect: core.connect, log: quiet });
  const found = await engine.list();
  assert.deepEqual(found.map(t => t.address), ['t9']);
  const out = [];
  const pty = await engine.adopt(found[0], { history: 500 });
  pty.onData(d => out.push(d));
  // The paint came before onData was set, in the same read as the reply: it must not be lost.
  assert.equal(core.calls.find(c => c.method === 'terminal.attach').params.history, 500);
  core.stream('t9', ' and more');
  await until(() => out.join('') === '\x18\x1b[H\x1b[2Jstill here and more');
  engine.close();
});

test('relabel keeps hc in step, and an empty value removes a label', async () => {
  const core = fakeCore();
  const engine = await createHcEngine({ connect: core.connect, log: quiet });
  const pty = engine.spawn('/bin/sh', [], { cwd: '/', labels: { sid: 'temp', pendingTag: 'x' } });
  await until(() => pty.channel !== null);
  pty.relabel({ sid: 'real', pendingTag: '' });
  await until(() => core.calls.some(c => c.method === 'terminal.label'));
  assert.deepEqual(core.calls.find(c => c.method === 'terminal.label').params, { terminal: 't1', labels: { sid: 'real', pendingTag: '' } });
  assert.deepEqual(pty.labels, { app: 'switchboard', sid: 'real' });
  engine.close();
});
