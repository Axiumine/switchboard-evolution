// The Improve prompt window in the page (public/prompt-improver-view.js) in a
// vm: it says which session the prompt goes into, and Insert and Replace go
// into the session it was opened for, whichever session is in front.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');

function setup({ active = 's2', busy = [], ptys = ['s1', 's2'], screen = '❯ fix it' } = {}) {
  const calls = [];
  const T = require('../public/tui-prompt-reader');
  const rule = T.rowFromText('─'.repeat(60));
  const rowsFor = () => [rule, T.rowFromText(screen), rule];
  const terminal = (id) => ({ cols: 60, focus: () => calls.push(['focus', id]) });
  const openSessions = new Map([
    ['s1', { session: { sessionId: 's1', runtime: 'claude', name: 'Login work', projectPath: '/work/demo' }, terminal: terminal('s1') }],
    ['s2', { session: { sessionId: 's2', runtime: 'codex', name: 'Other', projectPath: '/work/other' }, terminal: terminal('s2') }],
  ]);
  const context = vm.createContext({
    window: {
      api: { platform: 'darwin', sendInput: (id, text) => calls.push(['input', id, text]) },
      PromptImproverModel: require('../public/prompt-improver-model'),
      TuiPromptReader: { ...T, rowsFromXterm: () => rowsFor() },
    },
    document: { addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn) => fn(),
    isMac: true,
    ICONS: new Proxy({}, { get: () => () => '' }),
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    openSessions,
    sessionMap: new Map(),
    activePtyIds: new Set(ptys),
    attentionSessions: new Set(),
    sessionBusyState: new Map(busy.map((id) => [id, true])),
    activeSessionId: active,
    showSession: (id) => calls.push(['show', id]),
    focusCommandTerminal: (id) => calls.push(['focusTerminal', id]),
    commandCatalogState: (id) => (busy.includes(id) ? 'busy' : 'idle'),
  });
  vm.runInContext(read('prompt-improver-view.js'), context);
  return { context, calls };
}

test('Insert goes into the session the window was opened for, and that session is shown', () => {
  const { context, calls } = setup({ active: 's2' });
  const res = context.applyToSession({ sessionId: 's1', cli: 'claude', how: 'insert', readText: 'fix it', readConfident: true, text: 'Fix the login.\nRun the tests.' });
  assert.deepEqual(JSON.parse(JSON.stringify(res)), { ok: true });
  assert.deepEqual(calls[0], ['input', 's1', 'Fix the login.\x1b[13;2uRun the tests.']);
  assert.deepEqual(calls.slice(1), [['show', 's1'], ['focusTerminal', 's1']]);
});

test('Replace clears what was read, then types, in that session only, while it is idle', () => {
  const { context, calls } = setup({ active: 's2' });
  const res = context.applyToSession({ sessionId: 's1', cli: 'claude', how: 'replace', readText: 'fix it', readConfident: true, text: 'Fix the login.' });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.slice(0, 2), [['input', 's1', `\x05${'\x7f'.repeat(10)}`], ['input', 's1', 'Fix the login.']]);

  const busy = setup({ busy: ['s1'] });
  assert.match(busy.context.applyToSession({ sessionId: 's1', cli: 'claude', how: 'replace', readText: 'fix it', readConfident: true, text: 'x' }).error, /working/);
  assert.equal(busy.calls.length, 0);

  const changed = setup({ screen: '❯ fix it now' });
  assert.match(changed.context.applyToSession({ sessionId: 's1', cli: 'claude', how: 'replace', readText: 'fix it', readConfident: true, text: 'x' }).error, /changed since it was read/);

  const gone = setup({ ptys: ['s2'] });
  assert.match(gone.context.applyToSession({ sessionId: 's1', cli: 'claude', how: 'insert', text: 'x' }).error, /not open in the main window/);
});

test('the window names the session the prompt goes into', () => {
  const { context } = setup();
  const label = context.improverSessionLabel({ name: 'Login work', projectPath: '/Users/someone/work/demo' });
  assert.deepEqual(JSON.parse(JSON.stringify(label)), { title: 'Login work', folder: 'work/demo' });
  const page = context.improverTargetHtml({ title: 'Login <work>', cli: 'codex', folder: 'work/demo', windowMode: false });
  assert.match(page, /Goes into <strong>Login &lt;work&gt;<\/strong> <span class="pi-target-meta">Codex · work\/demo<\/span>/);
  assert.match(page, /If you open it in a window of its own and change session, it still goes here\./);
  const own = context.improverTargetHtml({ title: 'Login work', cli: 'claude', folder: '', windowMode: true });
  assert.match(own, /even if another session is in front in the main window\. You do not need to go back to it/);
});
