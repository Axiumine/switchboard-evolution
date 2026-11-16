// Against a real herdr-core, when one is given:
//   SWITCHBOARD_TEST_HC=/path/to/herdr-core SWITCHBOARD_TEST_HC_RUNTIME=/tmp/short npm test
// The runtime dir must be short: the core's socket path may not exceed 103 bytes.
// Uses its own HC_SESSION and state dir, so it never sees a real core.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createHcEngine } = require('../hc-engine');

const bin = process.env.SWITCHBOARD_TEST_HC;
const runtime = process.env.SWITCHBOARD_TEST_HC_RUNTIME;
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { for (let t = 0; t < ms && !fn(); t += 50) await tick(); assert.ok(fn(), 'condition never held'); };

test('a terminal outlives the engine that started it, and is adopted again', { skip: !bin || !runtime }, async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-state-'));
  const env = {
    HOME: os.homedir(), USER: process.env.USER || 'test', SHELL: '/bin/sh', PATH: '/usr/bin:/bin',
    HC_SESSION: `sbt${process.pid}`, XDG_STATE_HOME: state, XDG_CONFIG_HOME: state, XDG_RUNTIME_DIR: runtime,
  };
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const first = await createHcEngine({ binary: bin, env, log });
  try {
    // Printed once attached: output from before the attach comes as the repainted screen.
    const pty = first.spawn('/bin/sh', ['-c', 'sleep 0.5; printf "\\033]0;title here\\007"; echo hello-from-hc; exec cat'], {
      cwd: state, env: { TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app' }, labels: { sid: 'real-1' },
    });
    let out = '';
    pty.onData(d => { out += d; });
    await until(() => out.includes('hello-from-hc'));
    assert.ok(out.includes('\x1b]0;title here\x07'), 'OSC 0 passes through');
    first.close(); // Switchboard quits: detach only

    const second = await createHcEngine({ binary: bin, env, log });
    const found = await second.list();
    assert.equal(found.length, 1);
    assert.equal(found[0].labels.sid, 'real-1');
    const again = await second.adopt(found[0], { history: 100 });
    let paint = '';
    again.onData(d => { paint += d; });
    await until(() => paint.includes('hello-from-hc'));
    again.write('ping\r');
    await until(() => (paint.match(/ping/g) || []).length >= 2);
    const exits = [];
    again.onExit(e => exits.push(e));
    again.kill();
    await until(() => exits.length === 1);
    assert.equal(exits[0].signal, 1);
    assert.equal((await second.list()).length, 0, 'a finished terminal is gone from the list');
    await second._call('server.stop').catch(() => {});
    second.close();
  } finally {
    first.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});
