const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// wireSessionPty from main.js, run against a fake PTY: what each CLI's output
// makes Switchboard announce.
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const source = main.slice(main.indexOf('function wireSessionPty('), main.indexOf('/** A session\'s PTY: in herdr-core'));

function wire(harnessId) {
  const events = [];
  let onData = null;
  const session = {
    pty: { onData: fn => { onData = fn; }, onExit() {} },
    outputBuffer: [], outputBufferSize: 0, runtime: harnessId,
  };
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const context = vm.createContext({
    ...require('../cli-state'),
    progressBusyState: require('../harnesses').progressBusyState,
    emit: (channel, ...args) => { if (channel !== 'terminal-data') events.push([channel, ...args]); },
    log: quiet,
    getCachedSession: () => null,
    notifyRendererProjectsChanged() {},
    terminalFanout: { feed() {} },
    MAX_BUFFER_SIZE: 1 << 20,
    activeSessions: new Map(),
  });
  vm.runInContext(source, context);
  context.wireSessionPty('s1', session, require('../harnesses').getHarness(harnessId));
  return { feed: data => onData(data), events, session };
}

const osc7501 = fields => `\x1b]7501;${fields}\x1b\\`;
const b64 = text => Buffer.from(text).toString('base64');

test('OpenCode: the TUI\'s status record drives busy, attention and the end of a turn', () => {
  const { feed, events, session } = wire('opencode');
  feed(osc7501('state=idle:app=opencode') + '\x1b]0;OpenCode\x07');
  assert.deepEqual(events, []);

  // Both records come for a turn: the TUI's (no id) and the session's.
  feed(osc7501(`state=working:app=opencode:title=${b64('New session')}`)
    + osc7501(`state=working:id=ses_a:app=opencode:title=${b64('New session')}`));
  assert.deepEqual(events.splice(0), [['cli-busy-state', 's1', true]]);

  const title = b64('A title long enough that the message lands well past the first hundred and twenty characters');
  feed(osc7501(`state=blocked:kind=permission:app=opencode:title=${title}:msg=${b64('Permission needs input')}`));
  assert.deepEqual(events.splice(0), [
    ['terminal-notification', 's1', 'Permission needs input', 'attention'],
    ['cli-busy-state', 's1', false],
  ]);
  assert.equal(session._needsAttention, true);

  feed(osc7501('state=working:app=opencode'));
  feed(osc7501('state=clear:id=ses_a') + osc7501('state=idle:app=opencode'));
  assert.deepEqual(events.splice(0), [['cli-busy-state', 's1', true], ['cli-busy-state', 's1', false]]);
  assert.equal(session._needsAttention, false);
});

test('OpenCode: a session\'s own record does not override the TUI\'s', () => {
  const { feed, events } = wire('opencode');
  feed(osc7501('state=working:id=ses_other:app=opencode'));
  assert.deepEqual(events, []);
});

test('OpenCode: its "OC | <title>" names the session before it is indexed', () => {
  const { feed, session } = wire('opencode');
  feed('\x1b]0;OC | Fix the login\x07');
  assert.equal(session._cliTitle, 'Fix the login');
});

test('Claude: spinner and idle titles still drive busy as before', () => {
  const { feed, events, session } = wire('claude');
  feed('\x1b]0;⠹ Working\x07');
  feed('\x1b]0;⠼ Working\x07');
  feed('\x1b]0;✳ Done\x07');
  assert.deepEqual(events, [['cli-busy-state', 's1', true], ['cli-busy-state', 's1', false]]);
  assert.equal(session._oscIdle, true);
});

test('Claude: progress reports still raise and end a turn', () => {
  const { feed, events } = wire('claude');
  feed('\x1b]9;4;3;\x07');
  feed('\x1b]9;4;0;\x07');
  assert.deepEqual(events, [['cli-busy-state', 's1', true], ['cli-busy-state', 's1', false]]);
});

test('Codex: an "Action Required" title asks for attention once and ends busy', () => {
  const { feed, events } = wire('codex');
  feed('\x1b]0;⠋ my-project\x07');
  feed('\x1b]0;[ ! ] Action Required my-project\x07');
  feed('\x1b]0;[ ! ] Action Required my-project\x07');
  assert.deepEqual(events, [
    ['cli-busy-state', 's1', true],
    ['terminal-notification', 's1', '[ ! ] Action Required my-project', 'attention'],
    ['cli-busy-state', 's1', false],
  ]);
});

test('OpenCode: a status record split across two chunks still counts, once', () => {
  // OpenCode sends a record only when it changes, so a lost one is not repeated.
  const record = osc7501('state=working:app=opencode');
  for (const cut of [5, 12, record.length - 1, 3]) {
    const { feed, events } = wire('opencode');
    feed('output ' + record.slice(0, cut));
    feed(record.slice(cut) + ' more output');
    assert.deepEqual(events, [['cli-busy-state', 's1', true]], `cut at ${cut}`);
  }
});

test('OpenCode: a record in one chunk is not read twice with the next one', () => {
  const { feed, events } = wire('opencode');
  feed(osc7501('state=working:app=opencode'));
  feed(osc7501('state=idle:app=opencode') + osc7501('state=working:app=opencode').slice(0, 9));
  feed(osc7501('state=working:app=opencode').slice(9));
  assert.deepEqual(events, [['cli-busy-state', 's1', true], ['cli-busy-state', 's1', false], ['cli-busy-state', 's1', true]]);
});
