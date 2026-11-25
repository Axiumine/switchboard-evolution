// The language servers' side in the main process: lsp/framing, servers,
// locate, detect, project-servers and manager.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { encodeMessage, MessageReader } = require('../lsp/framing');
const { SERVERS, serverForFile, serverById, commandArgs } = require('../lsp/servers');
const { parseLoginPath, readLoginPath, searchDirs, findExecutable, locateServer } = require('../lsp/locate');
const { countLanguages, detectLanguages, mergeFound } = require('../lsp/detect');
const { createProjectServers } = require('../lsp/project-servers');
const { createLspManager, completeInitialize, answerServerRequest, settingsSection, IDLE_MS, MAX_SERVERS } = require('../lsp/manager');

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ── framing ─────────────────────────────────────────────────────────

test('a message is framed with its length in bytes, UTF-8 included', () => {
  const bytes = encodeMessage({ text: 'è' });
  assert.equal(bytes.toString('utf8'), 'Content-Length: 13\r\n\r\n{"text":"è"}');
});

test('the reader gives whole messages from chunks cut anywhere, and ignores other headers', () => {
  const a = encodeMessage({ id: 1 });
  const b = Buffer.concat([Buffer.from('Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n'), encodeMessage({ id: 2, s: 'ünï' })]);
  const all = Buffer.concat([a, b]);
  const reader = new MessageReader();
  const out = [];
  for (let i = 0; i < all.length; i += 5) out.push(...reader.push(all.slice(i, i + 5)));
  assert.deepEqual(out.map(m => JSON.parse(m)), [{ id: 1 }, { id: 2, s: 'ünï' }]);
});

test('a header without Content-Length is refused', () => {
  assert.throws(() => new MessageReader().push(Buffer.from('X-Foo: 1\r\n\r\n{}')), /Content-Length/);
});

// ── the table ───────────────────────────────────────────────────────

test('the table: unique ids, a command and an install hint each, every extension served once', () => {
  const ids = new Set();
  const seen = new Map();
  for (const server of SERVERS) {
    assert.ok(!ids.has(server.id), server.id);
    ids.add(server.id);
    assert.ok(server.commands.length > 0 && server.install && server.label, server.id);
    for (const lang of server.languages) {
      for (const ext of lang.extensions || []) {
        assert.ok(!seen.has(ext), `${ext} in ${server.id} and ${seen.get(ext)}`);
        seen.set(ext, server.id);
      }
    }
  }
  assert.ok(SERVERS.length >= 28, `${SERVERS.length} servers`);
  for (const id of ['typescript', 'python', 'go', 'rust', 'clangd', 'java', 'kotlin', 'csharp', 'php', 'ruby', 'swift', 'dart']) assert.ok(serverById(id), id);
});

test('a file finds its server and languageId by extension or by name', () => {
  assert.deepEqual([serverForFile('/a/b.tsx').server.id, serverForFile('/a/b.tsx').languageId], ['typescript', 'typescriptreact']);
  assert.equal(serverForFile('/a/go.mod').languageId, 'gomod');
  assert.equal(serverForFile('/a/Dockerfile.prod').server.id, 'dockerfile');
  assert.equal(serverForFile('/a/Gemfile').server.id, 'ruby');
  assert.equal(serverForFile('/a/README'), null);
});

test('jdtls gets a data folder of its own for each project', () => {
  const jdtls = serverById('java').commands[0];
  const a = commandArgs(jdtls, { root: '/p/one', dataDir: '/data' });
  const b = commandArgs(jdtls, { root: '/p/two', dataDir: '/data' });
  assert.equal(a[0], '-data');
  assert.ok(a[1].startsWith(path.join('/data', 'jdtls')));
  assert.notEqual(a[1], b[1]);
});

// ── locate ──────────────────────────────────────────────────────────

test('the login shell\'s PATH is read between its markers, whatever the shell prints around it', async () => {
  const { MARK } = require('../lsp/locate');
  assert.equal(parseLoginPath(`welcome!\n${MARK}/a:/b${MARK}\n`), '/a:/b');
  assert.equal(parseLoginPath('nothing'), null);
  const login = await readLoginPath({ shell: '/bin/zsh', platform: 'darwin', run: (file, args, opts, cb) => cb(null, `motd ${MARK}/opt/x/bin:/usr/bin${MARK}`) });
  assert.equal(login, '/opt/x/bin:/usr/bin');
  assert.equal(await readLoginPath({ platform: 'win32' }), null);
});

test('the folders are the login PATH, the app\'s PATH and the installers\' folders, each once', () => {
  const dirs = searchDirs({ login: '/login/bin:/usr/bin', envPath: '/usr/bin:/app/bin', home: '/home/u', platform: 'darwin' });
  assert.deepEqual(dirs.slice(0, 3), ['/login/bin', '/usr/bin', '/app/bin']);
  assert.ok(dirs.includes('/home/u/.cargo/bin') && dirs.includes('/home/u/go/bin') && dirs.includes('/opt/homebrew/bin'));
  assert.equal(dirs.filter(d => d === '/usr/bin').length, 1);
});

test('on Windows an npm server is its .cmd', () => {
  const found = findExecutable('intelephense', ['C:\\npm'], { platform: 'win32', exists: f => f === path.join('C:\\npm', 'intelephense.cmd') });
  assert.equal(found, path.join('C:\\npm', 'intelephense.cmd'));
});

test('the first installed command wins; one that must answer --version is skipped when it does not', async () => {
  const kotlin = serverById('kotlin');
  const got = await locateServer(kotlin, {}, { dirs: ['/bin'], exists: f => f === '/bin/kotlin-language-server' });
  assert.deepEqual(got, { bin: 'kotlin-language-server', path: '/bin/kotlin-language-server', args: [] });
  const rust = serverById('rust');
  const shim = await locateServer(rust, {}, { dirs: ['/cargo'], exists: () => true, run: (f, a, o, cb) => cb(new Error('no component')) });
  assert.equal(shim, null);
  const real = await locateServer(rust, {}, { dirs: ['/cargo'], exists: () => true, run: (f, a, o, cb) => cb(null, 'rust-analyzer 1.0') });
  assert.equal(real.path, '/cargo/rust-analyzer');
});

// ── detect ──────────────────────────────────────────────────────────

test('languages are counted from the files, without dependency folders', () => {
  const found = countLanguages(['src/a.ts', 'src/b.tsx', 'node_modules/x/index.js', 'lib/c.py', 'Dockerfile', 'README']);
  assert.deepEqual(found.typescript, { files: 2, extensions: { '.ts': 1, '.tsx': 1 } });
  assert.deepEqual(found.python, { files: 1, extensions: { '.py': 1 } });
  assert.deepEqual(found.dockerfile, { files: 1, extensions: { Dockerfile: 1 } });
  assert.equal(found.javascript, undefined);
});

test('a folder without git is walked, skipping the folders that do not matter', async () => {
  const dir = tmp('sb-lsp-detect-');
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'target'));
    fs.writeFileSync(path.join(dir, 'src', 'main.rs'), '');
    fs.writeFileSync(path.join(dir, 'target', 'gen.rs'), '');
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '');
    const found = await detectLanguages(dir, { run: (cmd, args, opts, cb) => cb(new Error('not a repository')) });
    assert.deepEqual(found.rust, { files: 1, extensions: { '.rs': 1 } });
    assert.deepEqual(found.toml, { files: 1, extensions: { '.toml': 1 } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('two detections add up', () => {
  assert.deepEqual(mergeFound({ go: { files: 1, extensions: { '.go': 1 } } }, { go: { files: 2, extensions: { '.go': 2 } } }), { go: { files: 3, extensions: { '.go': 3 } } });
});

// ── project servers ─────────────────────────────────────────────────

function fakeDb() {
  const rows = { projects: [{ id: 'p1', root: '/work/p1' }, { id: 'p2', root: '/work/p2' }], folders: [{ projectId: 'p1', path: '/code/app' }, { projectId: 'p1', path: '/code/app/sub' }], lsp: new Map() };
  return {
    rows,
    getProject: id => rows.projects.find(p => p.id === id) || null,
    listProjects: () => rows.projects,
    listProjectFolders: id => rows.folders.filter(f => f.projectId === id),
    listAllProjectFolders: () => rows.folders,
    getProjectLspServers: id => (rows.lsp.has(id) ? JSON.parse(rows.lsp.get(id)) : null),
    setProjectLspServers: (id, v) => { rows.lsp.set(id, JSON.stringify(v)); },
  };
}

test('a file belongs to the deepest project folder it is in; a file elsewhere to none', () => {
  const ps = createProjectServers({ db: fakeDb(), detect: async () => ({}) });
  assert.deepEqual(ps.folderOf('/code/app/sub/x.ts'), { projectId: 'p1', folder: '/code/app/sub' });
  assert.deepEqual(ps.folderOf('/code/app/y.ts'), { projectId: 'p1', folder: '/code/app' });
  assert.deepEqual(ps.folderOf('/work/p2/notes.md'), { projectId: 'p2', folder: '/work/p2' });
  assert.equal(ps.folderOf('/code/application/z.ts'), null, 'a sibling with a common prefix is not inside');
  assert.equal(ps.folderOf('/tmp/z.ts'), null);
});

test('detection turns on the servers found, once per folder, and never turns back on one turned off', async () => {
  const db = fakeDb();
  const looked = [];
  const detect = async (folder) => { looked.push(folder); return folder === '/code/app' ? { typescript: { files: 3, extensions: { '.ts': 3 } } } : {}; };
  const ps = createProjectServers({ db, detect });
  assert.equal(await ps.isEnabled('p1', 'typescript'), true);
  assert.equal(await ps.isEnabled('p1', 'python'), false);
  assert.deepEqual(looked.sort(), ['/code/app', '/code/app/sub', '/work/p1']);
  ps.setEnabled('p1', 'typescript', false);
  await ps.ensureDetected('p1', ['/code/app', '/new/folder']);
  assert.deepEqual(looked.filter(f => f === '/code/app').length, 1, 'a folder is looked at once');
  assert.equal(await ps.isEnabled('p1', 'typescript'), false, 'the user\'s choice stays');
  await ps.redetect('p1');
  assert.equal(await ps.isEnabled('p1', 'typescript'), false, 'also after Detect again');
  assert.deepEqual(ps.setEnabled('p1', 'nope', true), { error: 'Unknown language server: nope' });
});

test('the summary lists every server, the ones found first, with whether each is installed', async () => {
  const db = fakeDb();
  const ps = createProjectServers({
    db,
    detect: async folder => (folder === '/code/app' ? { python: { files: 2, extensions: { '.py': 2 } }, go: { files: 9, extensions: { '.go': 9 } } } : {}),
    locate: async server => (server.id === 'go' ? { bin: 'gopls', path: '/go/bin/gopls' } : null),
  });
  const rows = await ps.summary('p1');
  assert.equal(rows.length, SERVERS.length);
  assert.deepEqual(rows.slice(0, 2).map(r => [r.id, r.enabled, r.installed]), [['go', true, true], ['python', true, false]]);
  assert.equal(rows[0].path, '/go/bin/gopls');
  assert.equal(rows[1].install, serverById('python').install);
});

// ── manager ─────────────────────────────────────────────────────────

/** A fake language server process: what the manager writes, and a way to answer. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.received = [];
  const reader = new MessageReader();
  child.stdin.on('data', d => child.received.push(...reader.push(d).map(m => JSON.parse(m))));
  child.reply = msg => child.stdout.write(encodeMessage(msg));
  child.killed = [];
  child.kill = (sig = 'SIGTERM') => { child.killed.push(sig); setImmediate(() => child.emit('exit', null, sig)); return true; };
  return child;
}

const tick = () => new Promise(r => setImmediate(r));

function makeManager({ enabled = true, located = { bin: 'gopls', path: '/bin/gopls', args: [] } } = {}) {
  const children = [];
  const sent = [];
  const timers = [];
  const manager = createLspManager({
    projectServers: {
      folderOf: f => (f.startsWith('/code/') ? { projectId: 'p1', folder: '/code' } : null),
      isEnabled: async () => enabled,
    },
    locate: async () => located,
    send: (...args) => sent.push(args),
    log: { info() {}, warn() {} },
    dataDir: '/data',
    spawn: (file, args, opts) => { const c = fakeChild(); c.file = file; c.args = args; c.opts = opts; children.push(c); return c; },
    env: async () => ({ PATH: '/bin' }),
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
  });
  return { manager, children, sent, timers };
}

test('why there is no server: no language, outside a project, off, not installed', async () => {
  assert.equal((await makeManager().manager.open({ ownerId: 1, filePath: '/code/x.unknown' })).unavailable, 'no-server');
  assert.equal((await makeManager().manager.open({ ownerId: 1, filePath: '/tmp/x.go' })).unavailable, 'outside-project');
  assert.equal((await makeManager({ enabled: false }).manager.open({ ownerId: 1, filePath: '/code/x.go' })).unavailable, 'off');
  const missing = await makeManager({ located: null }).manager.open({ ownerId: 1, filePath: '/code/x.go' });
  assert.equal(missing.unavailable, 'not-installed');
  assert.equal(missing.install, serverById('go').install);
});

test('one process per window, folder and server; started in the folder', async () => {
  const { manager, children } = makeManager();
  const a = await manager.open({ ownerId: 1, filePath: '/code/a.go' });
  const b = await manager.open({ ownerId: 1, filePath: '/code/b.go' });
  const c = await manager.open({ ownerId: 2, filePath: '/code/c.go' });
  assert.equal(a.sessionId, b.sessionId);
  assert.notEqual(a.sessionId, c.sessionId);
  assert.equal(children.length, 2);
  assert.equal(children[0].opts.cwd, '/code');
  assert.equal(a.languageId, 'go');
  assert.equal(a.rootUri, 'file:///code');
});

test('the client\'s initialize is completed; nothing before it reaches a restarted server', async () => {
  const { manager, children, sent } = makeManager();
  const { sessionId } = await manager.open({ ownerId: 1, filePath: '/code/a.go' });
  manager.fromClient(1, sessionId, JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {} }));
  manager.fromClient(1, sessionId, JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { capabilities: { textDocument: { diagnostic: {}, hover: {} } } } }));
  await tick();
  const [init] = children[0].received;
  assert.equal(children[0].received.length, 1, 'the early didChange was dropped');
  assert.equal(init.method, 'initialize');
  assert.equal(init.params.processId, process.pid);
  assert.deepEqual(init.params.workspaceFolders, [{ uri: 'file:///code', name: 'code' }]);
  assert.equal(init.params.capabilities.textDocument.diagnostic, undefined, 'no pull diagnostics');
  assert.ok(init.params.capabilities.textDocument.hover);
  assert.equal(init.params.capabilities.workspace.configuration, true);
  // Its answer makes the server ready, and goes on to the window.
  children[0].reply({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } });
  await tick();
  assert.ok(sent.some(([owner, ch, id, st]) => owner === 1 && ch === 'lsp-state' && id === sessionId && st.state === 'ready'));
  assert.ok(sent.some(([owner, ch, id, text]) => ch === 'lsp-message' && JSON.parse(text).id === 0));
  // Another window's message is not this session's.
  manager.fromClient(2, sessionId, JSON.stringify({ jsonrpc: '2.0', method: 'x', params: {} }));
  await tick();
  assert.equal(children[0].received.length, 1);
});

test('the manager answers configuration, registrations and progress tokens itself', async () => {
  assert.deepEqual(settingsSection({ python: { analysis: { a: 1 } } }, 'python.analysis'), { a: 1 });
  assert.equal(settingsSection({ python: {} }, 'go'), null);
  const s = { server: serverById('python'), rootUri: 'file:///code', folder: '/code' };
  assert.deepEqual(answerServerRequest({ method: 'workspace/configuration', params: { items: [{ section: 'python.analysis' }, { section: 'other' }] } }, s), [serverById('python').settings.python.analysis, null]);
  assert.equal(answerServerRequest({ method: 'client/registerCapability' }, s), null);
  assert.equal(answerServerRequest({ method: 'window/workDoneProgress/create' }, s), null);
  assert.equal(answerServerRequest({ method: 'textDocument/somethingElse' }, s), undefined);

  const { manager, children, sent } = makeManager();
  const { sessionId } = await manager.open({ ownerId: 1, filePath: '/code/a.go' });
  manager.fromClient(1, sessionId, JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }));
  children[0].reply({ jsonrpc: '2.0', id: 0, result: {} });
  children[0].reply({ jsonrpc: '2.0', id: 7, method: 'workspace/configuration', params: { items: [{ section: 'gopls' }] } });
  children[0].reply({ jsonrpc: '2.0', method: '$/progress', params: { token: 't', value: { kind: 'begin', title: 'Loading packages' } } });
  await tick();
  assert.deepEqual(children[0].received.find(m => m.id === 7), { jsonrpc: '2.0', id: 7, result: [null] });
  assert.ok(!sent.some(([, ch, , text]) => ch === 'lsp-message' && JSON.parse(text).id === 7), 'not passed on to the window');
  assert.ok(sent.some(([, ch, , st]) => ch === 'lsp-state' && st.state === 'indexing' && st.message === 'Loading packages'));
  children[0].reply({ jsonrpc: '2.0', method: '$/progress', params: { token: 't', value: { kind: 'end' } } });
  await tick();
  assert.equal(sent.filter(([, ch]) => ch === 'lsp-state').pop()[3].state, 'ready');
});

test('a server with no file open stops after a while; opening one keeps it', async () => {
  const { manager, children, timers } = makeManager();
  const { sessionId } = await manager.open({ ownerId: 1, filePath: '/code/a.go' });
  manager.fromClient(1, sessionId, JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }));
  manager.fromClient(1, sessionId, JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///code/a.go' } } }));
  const idle = timers.filter(t => t.ms === IDLE_MS);
  assert.ok(idle.every(t => t.cleared), 'a file open: no idle stop');
  manager.fromClient(1, sessionId, JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///code/a.go' } } }));
  const pending = timers.filter(t => t.ms === IDLE_MS && !t.cleared);
  assert.equal(pending.length, 1);
  pending[0].fn();
  await tick();
  assert.ok(children[0].received.some(m => m.method === 'shutdown') && children[0].received.some(m => m.method === 'exit'));
});

test('a server that exits on its own starts again, until it has done so three times in a minute', async () => {
  const { manager, children, sent } = makeManager();
  const { sessionId } = await manager.open({ ownerId: 1, filePath: '/code/a.go' });
  children[0].emit('exit', 1, null);
  await tick(); await tick();
  assert.equal(children.length, 2);
  assert.ok(sent.some(([, ch, , st]) => ch === 'lsp-state' && st.state === 'restarted'));
  children[1].emit('exit', 1, null);
  await tick(); await tick();
  children[2].emit('exit', 1, null);
  await tick(); await tick();
  assert.equal(children.length, 3, 'no fourth start');
  assert.equal(sent.filter(([, ch]) => ch === 'lsp-state').pop()[3].state, 'error');
  await manager.restart(1, sessionId);
  assert.equal(children.length, 4, 'Restart starts it again');
});

test('a window that closes stops its servers; MAX_SERVERS run at most', async () => {
  const { manager, children } = makeManager();
  const { sessionId } = await manager.open({ ownerId: 9, filePath: '/code/a.go' });
  const stopped = manager.closeOwner(9);
  await tick();
  children[0].emit('exit', 0, null);
  await stopped;
  assert.equal(manager.sessionFor(sessionId), null);

  const many = makeManager();
  for (let i = 0; i < MAX_SERVERS; i++) {
    const open = await many.manager.open({ ownerId: i + 1, filePath: '/code/a.go' });
    many.manager.fromClient(i + 1, open.sessionId, JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }));
    many.manager.fromClient(i + 1, open.sessionId, JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///code/a.go' } } }));
  }
  assert.equal((await many.manager.open({ ownerId: 99, filePath: '/code/a.go' })).unavailable, 'too-many', 'all busy: no room');
  many.manager.fromClient(1, many.manager.list()[0].sessionId, JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///code/a.go' } } }));
  const room = await many.manager.open({ ownerId: 99, filePath: '/code/a.go' });
  assert.ok(room.sessionId, 'the idle one made room');
});

test('completeInitialize keeps what the client sent and adds the server\'s options', () => {
  const p = completeInitialize({ capabilities: { general: { x: 1 } }, initializationOptions: undefined }, { rootUri: 'file:///w', folder: '/w', server: serverById('html'), pid: 42 });
  assert.equal(p.processId, 42);
  assert.deepEqual(p.capabilities.general, { x: 1 });
  assert.deepEqual(p.initializationOptions, { provideFormatter: true });
});

// ── edits to files not open, Go to Definition through the graph ─────

const { applyTextEdits, editsByFile, writeFileEdits } = require('../lsp/apply-edits');
const { rankDefinitions, findDefinitionInGraph } = require('../lsp/graph-definition');

test('text edits apply from the end, LSP positions as lines and UTF-16 characters, CRLF kept', () => {
  const text = 'int add(int a);\r\nint x = add(1);\n';
  const out = applyTextEdits(text, [
    { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } }, newText: 'sum' },
    { range: { start: { line: 1, character: 8 }, end: { line: 1, character: 11 } }, newText: 'sum' },
  ]);
  assert.equal(out, 'int sum(int a);\r\nint x = sum(1);\n');
  assert.equal(applyTextEdits('é x', [{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: 'y' }]), 'é y');
});

test('a WorkspaceEdit\'s changes and documentChanges both become edits by file', () => {
  const edits = editsByFile({
    changes: { 'file:///w/a.c': [{ range: {}, newText: '1' }] },
    documentChanges: [{ textDocument: { uri: 'file:///w/b%20c.h', version: 1 }, edits: [{ range: {}, newText: '2' }] }, { kind: 'create', uri: 'file:///w/new' }],
  });
  assert.deepEqual(Object.keys(edits).sort(), ['/w/a.c', '/w/b c.h']);
});

test('edits are written only when every file is in a project', () => {
  const files = new Map([['/p/a.c', 'int add;'], ['/p/b.c', 'add();']]);
  const io = { readFile: f => files.get(f), writeFile: (f, t) => files.set(f, t) };
  const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '//' };
  assert.match(writeFileEdits({ '/p/a.c': [edit], '/elsewhere/x.c': [edit] }, { folderOf: f => (f.startsWith('/p/') ? {} : null), ...io }).error, /Not in a project/);
  assert.equal(files.get('/p/a.c'), 'int add;', 'nothing written');
  assert.deepEqual(writeFileEdits({ '/p/a.c': [edit], '/p/b.c': [edit] }, { folderOf: () => ({}), ...io }), { ok: true, files: 2 });
  assert.equal(files.get('/p/b.c'), '//add();');
});

test('the graph\'s definitions: the same file first, then the same folder, then functions before variables', () => {
  const items = [
    { name: 'add', label: 'Variable', file: 'lib/other.c', start: 3 },
    { name: 'add', label: 'Function', file: 'src/util.c', start: 10 },
    { name: 'add', label: 'Function', file: 'src/main.c', start: 40 },
    { name: 'add', label: 'File', file: 'add.c', start: 1 },
  ];
  const ranked = rankDefinitions(items, { folder: '/repo', filePath: '/repo/src/main.c' });
  assert.deepEqual(ranked.map(r => `${r.file}:${r.line}`), ['/repo/src/main.c:40', '/repo/src/util.c:10', '/repo/lib/other.c:3']);
});

test('Go to Definition through the graph: asks search_graph for the exact name, says when the folder is not indexed', async () => {
  const calls = [];
  const deps = {
    folderOf: () => ({ projectId: 'p', folder: '/repo' }),
    query: async (projectId, folder, tool, args) => {
      calls.push([tool, args]);
      // search_graph's table, as CBM gives it.
      return { cols: ['name', 'label', 'file_path', 'start_line', 'qualified_name'], rows: [['add', 'Function', 'src/util.c', 7, 'src.util.add']] };
    },
  };
  const found = await findDefinitionInGraph(deps, '/repo/src/main.c', 'add');
  assert.deepEqual(calls[0], ['search_graph', { name_pattern: '^add$', limit: 25 }]);
  assert.deepEqual(found.locations.map(l => [l.file, l.line]), [['/repo/src/util.c', 7]]);
  const notIndexed = await findDefinitionInGraph({ ...deps, query: async () => { const e = new Error('not indexed'); e.code = 'not-indexed'; throw e; } }, '/repo/src/main.c', 'add');
  assert.equal(notIndexed.error, 'not-indexed');
  assert.equal((await findDefinitionInGraph(deps, '/repo/src/main.c', 'a.b')).error, 'no-symbol');
  assert.equal((await findDefinitionInGraph({ ...deps, folderOf: () => null }, '/tmp/x.c', 'add')).error, 'outside-project');
});

// ── The app's switch ────────────────────────────────────────────────

test('with the language servers switched off nothing starts, whatever the project says', async () => {
  let on = false;
  const children = [];
  const manager = createLspManager({
    projectServers: { folderOf: () => ({ projectId: 'p1', folder: '/code' }), isEnabled: async () => true },
    locate: async () => ({ bin: 'gopls', path: '/bin/gopls', args: [] }),
    send() {}, log: { info() {} }, dataDir: '/data',
    spawn: () => { const c = fakeChild(); children.push(c); return c; },
    env: async () => ({}), isOn: () => on,
    setTimer: () => ({}), clearTimer: () => {},
  });
  assert.deepEqual(await manager.open({ ownerId: 1, filePath: '/code/a.go' }), { unavailable: 'switched-off' });
  assert.equal(children.length, 0);
  on = true;
  assert.ok((await manager.open({ ownerId: 1, filePath: '/code/a.go' })).sessionId);
});

test('a folder attached while switched off is looked at the first time a server is needed', async () => {
  const db = fakeDb();
  const looked = [];
  const ps = createProjectServers({ db, detect: async (folder) => { looked.push(folder); return folder === '/late' ? { go: { files: 1, extensions: { '.go': 1 } } } : {}; } });
  await ps.ensureDetected('p1');
  db.rows.folders.push({ projectId: 'p1', path: '/late' });
  assert.equal(await ps.isEnabled('p1', 'go'), true);
  assert.ok(looked.includes('/late'));
  // The Settings tab with the switch off lists the choices without looking at the folders.
  db.rows.folders.push({ projectId: 'p1', path: '/later' });
  await ps.summary('p1', { detect: false });
  assert.ok(!looked.includes('/later'));
});
