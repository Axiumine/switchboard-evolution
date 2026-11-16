const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panel = fs.readFileSync(path.join(__dirname, '../public/file-panel.js'), 'utf8');
const slice = (from, to) => panel.slice(panel.indexOf(from), panel.indexOf(to));

/** The panel's IPC wiring and diff closing, with one session's diff tab open. */
function harness(tab) {
  const listeners = {};
  const state = { currentTab: tab, panelVisible: true, explorerVisible: false };
  const context = vm.createContext({
    filePanelState: new Map([['s1', state]]),
    currentPanelSessionId: 's1',
    destroyCurrentTab() {}, renderPanel() {}, hidePanel() { state.hidden = true; },
    openDiffTab() {}, openFileTab() {}, closeAllDiffs() {},
    window: { api: new Proxy({}, { get: (_, name) => (callback) => { listeners[name] = callback; } }) },
  });
  vm.runInContext(slice('function wireIpcListeners(', '// ── Session State Helpers'), context);
  vm.runInContext(slice('function closeDiffByDiffId(', '// ── Panel Show/Hide'), context);
  context.wireIpcListeners();
  return { state, listeners };
}

test('a diff answered elsewhere closes its tab in the window', () => {
  const { state, listeners } = harness({ type: 'diff', diffId: 'd1', resolved: false });
  listeners.onMcpDiffResolved('s1', 'd2', 'accept');
  assert.equal(state.currentTab.diffId, 'd1', 'another diff leaves this one alone');
  listeners.onMcpDiffResolved('s1', 'd1', 'accept');
  assert.equal(state.currentTab, null);
  assert.equal(state.hidden, true);
});

test('a diff the window answered itself stays as the window left it', () => {
  const tab = { type: 'diff', diffId: 'd1', resolved: true };
  const { state, listeners } = harness(tab);
  listeners.onMcpDiffResolved('s1', 'd1', 'reject');
  assert.equal(state.currentTab, tab);
});

test('an answer the window gives second is not taken: the tab closes and says so', async () => {
  for (const won of [true, false]) {
    const alerts = [];
    const tab = { type: 'diff', diffId: 'd1', resolved: false, newContent: 'x', editorView: null };
    const state = { currentTab: tab, panelVisible: true, explorerVisible: false };
    const context = vm.createContext({
      filePanelState: new Map([['s1', state]]), currentPanelSessionId: 's1',
      destroyCurrentTab() {}, renderPanel() {}, hidePanel() {},
      diffActionsEl: { style: {} },
      alert: (text) => alerts.push(text),
      window: { api: { mcpDiffResponse: async () => won } },
    });
    vm.runInContext(slice('function closeDiffByDiffId(', '// ── Panel Show/Hide'), context);
    vm.runInContext(slice('async function handleDiffAction(', '// ── IDE Emulation Indicator'), context);
    await context.handleDiffAction('s1', tab, 'accept');
    assert.equal(state.currentTab === null, !won, `won=${won}`);
    assert.deepEqual(alerts.length, won ? 0 : 1);
  }
});
