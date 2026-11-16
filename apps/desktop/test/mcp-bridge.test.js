const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

// The bridge writes its lock files under ~/.claude/ide: keep them out of the real one.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-test-'));
process.env.HOME = home;

const { addSink } = require('../broadcast');
const bridge = require('../mcp-bridge');

const log = { info() {}, debug() {}, warn() {}, error() {} };
const events = [];
addSink((channel, args) => { if (channel.startsWith('mcp-')) events.push([channel, ...args]); });

after(() => {
  bridge.shutdownAll();
  fs.rmSync(home, { recursive: true, force: true });
});

/** A Claude CLI connected to a session's MCP server. */
async function cli(sessionId) {
  const { port, authToken } = await bridge.startMcpServer(sessionId, [home], log);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, 'mcp', { headers: { 'x-claude-code-ide-authorization': authToken } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const replies = new Map();
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    replies.get(message.id)?.(message);
  });
  let nextId = 1;
  const call = (name, args) => {
    const id = nextId++;
    const reply = new Promise((resolve) => replies.set(id, resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }));
    return reply;
  };
  return { call, close: () => ws.close() };
}

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), 'timed out');
};

const diffArgs = (file) => ({ old_file_path: file, new_file_path: file, new_file_contents: 'new text\n', tab_name: `✻ [Claude Code] ${path.basename(file)}` });

test('a pending diff can be listed by a phone that connects later', async () => {
  events.length = 0;
  const file = path.join(home, 'app.js');
  fs.writeFileSync(file, 'old text\n');
  const claude = await cli('s-list');
  claude.call('openDiff', diffArgs(file));
  await until(() => events.length === 1);
  const [channel, sessionId, diffId, data] = events[0];
  assert.equal(channel, 'mcp-open-diff');
  assert.equal(sessionId, 's-list');
  assert.deepEqual(data, { oldFilePath: file, oldContent: 'old text\n', newContent: 'new text\n', tabName: '✻ [Claude Code] app.js' });
  const pending = bridge.listPendingDiffs();
  assert.equal(pending.length, 1);
  assert.equal(typeof pending[0].openedAt, 'number');
  assert.deepEqual({ ...pending[0], openedAt: 0 }, { sessionId: 's-list', diffId, ...data, openedAt: 0 });
  bridge.shutdownMcpServer('s-list');
  claude.close();
  assert.deepEqual(bridge.listPendingDiffs(), []);
});

test('the first answer wins, and every client hears it was answered', async () => {
  events.length = 0;
  const file = path.join(home, 'first.js');
  const claude = await cli('s-first');
  const reply = claude.call('openDiff', diffArgs(file));
  await until(() => events.length === 1);
  const [, , diffId] = events[0];
  assert.equal(bridge.resolvePendingDiff('s-first', diffId, 'reject', null), true);
  assert.equal(bridge.resolvePendingDiff('s-first', diffId, 'accept', null), false, 'a later answer is too late');
  assert.equal(bridge.resolvePendingDiff('s-other', diffId, 'accept', null), false);
  assert.deepEqual((await reply).result, { content: [{ type: 'text', text: 'DIFF_REJECTED' }] });
  assert.deepEqual(events.slice(1), [['mcp-diff-resolved', 's-first', diffId, 'reject']]);
  assert.deepEqual(bridge.listPendingDiffs(), []);
  bridge.shutdownMcpServer('s-first');
  claude.close();
});

test('a pending diff follows its session to a new id', async () => {
  events.length = 0;
  const claude = await cli('s-old');
  claude.call('openDiff', diffArgs(path.join(home, 'rekey.js')));
  await until(() => events.length === 1);
  bridge.rekeyMcpServer('s-old', 's-new');
  const [pending] = bridge.listPendingDiffs();
  assert.equal(pending.sessionId, 's-new');
  assert.equal(bridge.resolvePendingDiff('s-new', pending.diffId, 'accept', null), true);
  assert.deepEqual(events.at(-1), ['mcp-diff-resolved', 's-new', pending.diffId, 'accept']);
  bridge.shutdownMcpServer('s-new');
  claude.close();
});
