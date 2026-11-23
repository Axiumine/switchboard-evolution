// cbm-client.js against a fake codebase-memory-mcp: JSON-RPC lines over
// PassThrough streams, the way the real one answers (see tools in the
// structuredContent, errors as isError, a ping from the server).
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');
const readline = require('readline');

const { createCbmClient, toolResult, CbmError } = require('../cbm-client');

const quiet = { warn() {}, info() {}, error() {} };

/** A fake server: `handlers[method](params, ctx)` gives the result, or throws to answer an error; other methods get Method not found. */
function fakeSpawn(handlers = {}) {
  const spawned = [];
  const spawnImpl = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.received = [];
    child.killed = false;
    child.kill = (signal) => {
      if (child.killed) return;
      child.killed = true;
      setImmediate(() => child.emit('exit', null, signal || 'SIGTERM'));
    };
    child.die = (code = 1) => { child.killed = true; child.emit('exit', code, null); };
    child.say = (msg) => child.stdout.write(JSON.stringify(msg) + '\n');
    readline.createInterface({ input: child.stdin }).on('line', async (line) => {
      const msg = JSON.parse(line);
      child.received.push(msg);
      if (msg.id == null || !msg.method) return;
      const handler = handlers[msg.method];
      if (!handler) {
        child.say({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
        return;
      }
      try {
        const result = await handler(msg.params, { child, bin, args, opts });
        child.say({ jsonrpc: '2.0', id: msg.id, result });
      } catch (err) {
        child.say({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err.message } });
      }
    });
    spawned.push({ bin, args, opts, child });
    return child;
  };
  return { spawnImpl, spawned };
}

const INIT = { initialize: () => ({ protocolVersion: '2025-06-18', serverInfo: { name: 'codebase-memory-mcp', version: '0.12.1' }, capabilities: { tools: {} } }) };
const TOOLS = {
  'tools/list': () => ({
    tools: [
      { name: 'list_projects', inputSchema: { properties: { format: {}, detail: {}, limit: {}, offset: {} } } },
      { name: 'index_status', inputSchema: { properties: { project: {}, format: {} } } },
      { name: 'compare_graphs', inputSchema: { properties: { base_project: {}, target_project: {}, limit: {} }, additionalProperties: false } },
    ],
  }),
};
const FOUND = { path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true, source: 'installed' };

test('toolResult prefers structuredContent, then JSON text, then the plain text', () => {
  assert.deepEqual(toolResult({ structuredContent: { a: 1 }, content: [{ type: 'text', text: '{"a":2}' }] }), { a: 1 });
  assert.deepEqual(toolResult({ content: [{ type: 'text', text: '{"a":2}' }] }), { a: 2 });
  assert.deepEqual(toolResult({ content: [{ type: 'text', text: 'plain' }] }), { text: 'plain' });
  assert.throws(() => toolResult({ isError: true, content: [{ type: 'text', text: 'project not found' }] }), (err) => err instanceof CbmError && err.code === 'cbm-tool-error' && err.message === 'project not found');
});

test('the session starts on the first call, initializes once, and asks every tool for JSON', async () => {
  const { spawnImpl, spawned } = fakeSpawn({
    ...INIT,
    ...TOOLS,
    'tools/call': (params) => ({ content: [{ type: 'text', text: JSON.stringify({ got: params }) }], structuredContent: { got: params } }),
  });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, env: () => ({ HOME: '/home/u' }), cwd: '/tmp/x', log: quiet });
  assert.equal(client.status().running, false);
  const a = await client.call('list_projects', { detail: 'stats' });
  const b = await client.call('index_status', { project: 'p' });
  assert.deepEqual(a, { got: { name: 'list_projects', arguments: { detail: 'stats', format: 'json' } } });
  assert.deepEqual(b.got.arguments, { project: 'p', format: 'json' });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].bin, FOUND.path);
  assert.deepEqual(spawned[0].args, []);
  assert.equal(spawned[0].opts.cwd, '/tmp/x');
  assert.deepEqual(spawned[0].opts.env, { HOME: '/home/u' });
  const methods = spawned[0].child.received.map(m => m.method);
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'tools/call']);
  assert.deepEqual(client.status(), { running: true, binary: { path: FOUND.path, version: '0.12.1', source: 'installed' }, server: { name: 'codebase-memory-mcp', version: '0.12.1' }, error: null, halted: false });
  client.stop();
});

test('a call keeps only the arguments its tool declares, and asks for JSON only where the tool has a format', async () => {
  const { spawnImpl } = fakeSpawn({ ...INIT, ...TOOLS, 'tools/call': (p) => ({ structuredContent: { args: p.arguments } }) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet });
  assert.deepEqual((await client.call('compare_graphs', { base_project: 'a', target_project: 'b', format: 'tree', extra: 1 })).args, { base_project: 'a', target_project: 'b' });
  assert.deepEqual((await client.call('index_status', { project: 'p', verbose: undefined, junk: true })).args, { project: 'p', format: 'json' });
  assert.deepEqual((await client.call('not_listed', { a: 1 })).args, { a: 1, format: 'json' }, 'a tool the list does not name gets its arguments as given');
  client.stop();
});

test('calls made while the session starts share one start', async () => {
  const { spawnImpl, spawned } = fakeSpawn({ ...INIT, 'tools/call': (p) => ({ structuredContent: { tool: p.name } }) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet });
  const results = await Promise.all([client.call('a'), client.call('b'), client.call('c')]);
  assert.deepEqual(results.map(r => r.tool), ['a', 'b', 'c']);
  assert.equal(spawned.length, 1);
  client.stop();
});

test('a missing or old binary rejects without spawning anything', async () => {
  const { spawnImpl, spawned } = fakeSpawn(INIT);
  const missing = createCbmClient({ locate: () => null, spawnImpl, log: quiet });
  await assert.rejects(missing.call('list_projects'), (err) => err.code === 'cbm-missing');
  const old = createCbmClient({ locate: () => ({ ...FOUND, version: '0.11.0', ok: false }), spawnImpl, log: quiet });
  await assert.rejects(old.call('list_projects'), (err) => err.code === 'cbm-old' && err.data.version === '0.11.0');
  assert.equal(spawned.length, 0);
});

test('tool errors and RPC errors reject with CBM\'s words', async () => {
  const { spawnImpl } = fakeSpawn({
    ...INIT,
    'tools/call': (p) => {
      if (p.name === 'bad') throw new Error('Unknown tool: bad');
      return { isError: true, content: [{ type: 'text', text: 'project "x" not found' }] };
    },
  });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet });
  await assert.rejects(client.call('index_status', { project: 'x' }), (err) => err.code === 'cbm-tool-error' && /not found/.test(err.message));
  await assert.rejects(client.call('bad'), (err) => err.code === 'cbm-rpc-error' && err.message === 'Unknown tool: bad');
  client.stop();
});

test('a call the server never answers times out', async () => {
  const { spawnImpl } = fakeSpawn({ ...INIT, 'tools/call': () => new Promise(() => {}) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet, callTimeoutMs: 50 });
  await assert.rejects(client.call('search_graph', {}), (err) => err.code === 'cbm-timeout');
  client.stop();
});

test('the server\'s ping is answered and unknown requests are refused', async () => {
  const { spawnImpl, spawned } = fakeSpawn({ ...INIT, 'tools/call': () => ({ structuredContent: {} }) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet });
  await client.call('list_projects');
  const { child } = spawned[0];
  const replies = [];
  const origWrite = child.stdin.write.bind(child.stdin);
  child.stdin.write = (chunk, ...rest) => { replies.push(JSON.parse(String(chunk))); return origWrite(chunk, ...rest); };
  child.say({ jsonrpc: '2.0', id: 'p1', method: 'ping' });
  child.say({ jsonrpc: '2.0', id: 'p2', method: 'roots/list' });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(replies, [
    { jsonrpc: '2.0', id: 'p1', result: {} },
    { jsonrpc: '2.0', id: 'p2', error: { code: -32601, message: 'Method not found' } },
  ]);
  client.stop();
});

test('when the session dies, waiting calls fail and the next call starts a new one', async () => {
  const { spawnImpl, spawned } = fakeSpawn({ ...INIT, 'tools/call': (p) => (p.name === 'hang' ? new Promise(() => {}) : { structuredContent: { ok: 1 } }) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet });
  await client.call('list_projects');
  const waiting = client.call('hang');
  await new Promise(r => setTimeout(r, 10));
  spawned[0].child.die(1);
  await assert.rejects(waiting, (err) => err.code === 'cbm-exited');
  assert.match(client.status().error, /stopped \(code 1\)/);
  assert.deepEqual(await client.call('list_projects'), { ok: 1 });
  assert.equal(spawned.length, 2);
  client.stop();
});

test('after three crashes in a minute it waits for reset()', async () => {
  let clock = 0;
  const { spawnImpl, spawned } = fakeSpawn({ ...INIT, 'tools/call': () => ({ structuredContent: { ok: 1 } }) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet, now: () => clock });
  for (let i = 0; i < 3; i++) {
    await client.call('list_projects');
    spawned[spawned.length - 1].child.die(1);
    await new Promise(r => setImmediate(r));
    clock += 1000;
  }
  await assert.rejects(client.call('list_projects'), (err) => err.code === 'cbm-halted');
  assert.equal(client.status().halted, true);
  client.reset();
  assert.deepEqual(await client.call('list_projects'), { ok: 1 });
  assert.equal(spawned.length, 4);
  client.stop();
});

test('refresh() stops a session whose binary changed, and the next call runs the new one', async () => {
  let found = FOUND;
  const { spawnImpl, spawned } = fakeSpawn({ ...INIT, 'tools/call': () => ({ structuredContent: { ok: 1 } }) });
  const client = createCbmClient({ locate: () => found, spawnImpl, log: quiet });
  await client.call('list_projects');
  client.refresh();
  assert.equal(spawned[0].child.killed, false, 'same binary: kept');
  found = { ...FOUND, version: '0.12.2' };
  client.refresh();
  assert.equal(spawned[0].child.killed, true);
  await client.call('list_projects');
  assert.equal(spawned.length, 2);
  assert.equal(client.status().binary.version, '0.12.2');
  client.stop();
});

test('prompts come back as their text', async () => {
  const { spawnImpl } = fakeSpawn({
    ...INIT,
    'prompts/get': (p) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Review ${p.arguments.change} in ${p.arguments.project}` } }] }),
  });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet });
  assert.equal(await client.prompt('review_change_impact', { project: 'p', change: 'f' }), 'Review f in p');
  client.stop();
});

test('a server that exits while starting rejects the start', async () => {
  const { spawnImpl, spawned } = fakeSpawn({ initialize: () => new Promise(() => {}) });
  const client = createCbmClient({ locate: () => FOUND, spawnImpl, log: quiet, startTimeoutMs: 1000 });
  const call = client.call('list_projects');
  await new Promise(r => setTimeout(r, 10));
  spawned[0].child.stderr.write('error: another build is active\n');
  await new Promise(r => setTimeout(r, 5));
  spawned[0].child.die(3);
  await assert.rejects(call, (err) => err.code === 'cbm-exited' && /another build is active/.test(err.message));
});
