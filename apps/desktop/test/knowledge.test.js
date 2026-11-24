// knowledge.js: CBM names per folder, the folder boundary, index jobs, the
// read-only query surface, ADR and traces, CBM's settings and the Lens. A fake
// CBM client answers like the real one (shapes from a 0.12.1 session).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const knowledge = require('../knowledge');

const quiet = { warn() {}, info() {}, error() {} };
const flush = () => new Promise(r => setImmediate(r));

function fakeDb() {
  const rows = { projects: [], folders: [], settings: new Map() };
  return {
    rows,
    addProject: (id, folders) => {
      rows.projects.push({ id, name: id });
      folders.forEach((p, i) => rows.folders.push({ projectId: id, path: p, mode: 'in-place', sortOrder: i }));
    },
    getSetting: (key) => rows.settings.get(key) ?? null,
    setSetting: (key, value) => { rows.settings.set(key, JSON.parse(JSON.stringify(value))); },
    listProjects: () => rows.projects.slice(),
    getProject: (id) => rows.projects.find(p => p.id === id) || null,
    listProjectFolders: (id) => rows.folders.filter(f => f.projectId === id),
  };
}

function fakeProjects(db) {
  return {
    requireAttachedFolder(projectId, folderPath) {
      if (!db.getProject(projectId)) throw new Error('Project not found');
      const f = db.listProjectFolders(projectId).find(x => x.path === folderPath);
      if (!f) throw new Error('Repository is not attached to this project');
      return f;
    },
  };
}

/** handlers[tool](args) → result; calls are recorded. */
function fakeClient(handlers = {}) {
  const calls = [];
  const prompts = [];
  let found = { path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true, source: 'installed' };
  return {
    calls,
    prompts,
    setFound: (f) => { found = f; },
    resets: 0,
    async call(tool, args = {}) {
      calls.push({ tool, args });
      const h = handlers[tool];
      if (!h) throw Object.assign(new Error(`no handler for ${tool}`), { code: 'cbm-tool-error' });
      return h(args);
    },
    async prompt(name, args) { prompts.push({ name, args }); return `prompt ${name} for ${args.project}`; },
    refresh: () => found,
    reset() { this.resets += 1; },
    status: () => ({ running: true, binary: found, server: null, error: null, halted: false }),
  };
}

const registrations = { claude: null, codex: false };
const fakeLocator = {
  SERVER_NAME: 'codebase-memory-mcp',
  registeredServer: () => registrations.claude,
  codexRegistered: () => registrations.codex,
  MIN_VERSION: [0, 12, 1],
  CBM_VERSION: '0.12.1',
  RELEASE_PAGE: 'https://example.invalid/releases',
  latestCbm: async () => '0.12.3',
  assetFor: () => ({ name: 'cbm.tar.gz', exe: 'codebase-memory-mcp' }),
  isNewerVersion: (a, b) => a !== b && a > b,
  defaultInstallDir: () => '/home/u/.local/bin',
  downloadCbm: async () => ({ path: '/home/u/.local/bin/codebase-memory-mcp', version: '0.12.1' }),
};

function setup({ handlers = {}, projects: list = { p1: ['/work/api', '/work/web'] }, timers, runConfig, fetchImpl } = {}) {
  const db = fakeDb();
  for (const [id, folders] of Object.entries(list)) db.addProject(id, folders);
  const client = fakeClient(handlers);
  const events = [];
  knowledge.init({
    db,
    log: quiet,
    projects: fakeProjects(db),
    client,
    locator: fakeLocator,
    emit: (channel, payload) => events.push({ channel, ...payload }),
    timers: timers || { setTimeout: (fn) => { setImmediate(fn); return 1; }, clearTimeout() {} },
    runConfig: runConfig || (async () => ''),
    fetchImpl: fetchImpl || (async () => ({ ok: true })),
    now: () => 1000,
  });
  return { db, client, events };
}

// The graph on, as a test starts from it (setSettings would also read the folders that have none).
function graphOn(db, projectId) {
  db.setSetting(`knowledge:${projectId}`, { ...knowledge.settingsFor(projectId), enabled: true });
}

test('settings are normalized, and names cannot be set from outside', () => {
  const { db } = setup();
  assert.deepEqual(knowledge.normalizeSettings(null), { enabled: false, mode: 'full', toolProfile: 'all', crossRepo: true, autoRefresh: true, names: {}, indexed: {}, share: {}, worktrees: {}, savedQueries: [] });
  const r = knowledge.setSettings('p1', { enabled: true, mode: 'fast', toolProfile: 'scout', names: { '/work/api': 'evil' }, share: { '/work/api': true, '/elsewhere': true }, savedQueries: [{ name: 'calls', query: 'MATCH (n) RETURN n' }, { query: '' }] });
  assert.equal(r.settings.enabled, true);
  assert.equal(r.settings.mode, 'fast');
  assert.equal(r.settings.toolProfile, 'scout');
  assert.deepEqual(r.settings.names, {});
  assert.deepEqual(r.settings.share, { '/work/api': true }, 'only attached folders can be shared');
  assert.deepEqual(r.settings.savedQueries, [{ name: 'calls', query: 'MATCH (n) RETURN n' }]);
  knowledge.setSettings('p1', { mode: 'nonsense', share: { '/work/api': false } });
  assert.equal(knowledge.settingsFor('p1').mode, 'full');
  assert.deepEqual(knowledge.settingsFor('p1').share, {});
  assert.throws(() => knowledge.setSettings('missing', {}), /Project not found/);
  assert.ok(db.rows.settings.has('knowledge:p1'));
});

test('a folder already indexed keeps CBM\'s name; a new one gets its folder name, made unique', async () => {
  setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'billing-api', root_path: '/work/api' }, { name: 'web', root_path: '/other/web' }], has_more: false }),
    },
    projects: { p1: ['/work/api', '/work/web'], p2: ['/work/web', '/x/My Repo!'] },
  });
  assert.equal(await knowledge.nameFor('p1', '/work/api'), 'billing-api');
  assert.equal(await knowledge.nameFor('p1', '/work/web'), 'web-2', '"web" belongs to another folder');
  assert.equal(await knowledge.nameFor('p2', '/work/web'), 'web-2', 'the same folder in another project keeps its name');
  assert.equal(await knowledge.nameFor('p2', '/x/My Repo!'), 'My-Repo');
  assert.deepEqual(knowledge.settingsFor('p1').names, { '/work/api': 'billing-api', '/work/web': 'web-2' });
});

test('query on a folder without a code graph says so, without asking CBM', async () => {
  const { client } = setup({ handlers: { search_graph: (args) => ({ echo: args }) } });
  await assert.rejects(knowledge.query('p1', '/work/api', 'search_graph', {}), (err) => err.code === 'not-indexed');
  assert.equal(client.calls.length, 0);
});

test('query drops the arguments the module owns', async () => {
  const { client } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      search_graph: (args) => ({ echo: args }),
    },
  });
  await knowledge.nameFor('p1', '/work/api');
  const r = await knowledge.query('p1', '/work/api', 'search_graph', { query: 'login', project: 'someone-else', repo_path: '/etc', format: 'tree', limit: 5 });
  assert.deepEqual(r.echo, { max_output_tokens: 120000, query: 'login', limit: 5, project: 'api' });
  const own = await knowledge.query('p1', '/work/api', 'search_graph', { max_output_tokens: 500 });
  assert.equal(own.echo.max_output_tokens, 500, 'a budget the caller sets is kept');
  await assert.rejects(knowledge.query('p1', '/work/api', 'index_repository', {}), /Unknown tool/);
  await assert.rejects(knowledge.query('p1', '/work/api', 'delete_project', {}), /Unknown tool/);
  await assert.rejects(knowledge.query('p1', '/not/attached', 'search_graph', {}), /not attached/);
  await assert.rejects(knowledge.query('p1', 'relative/path', 'search_graph', {}), /Pick one/);
  await assert.rejects(knowledge.query('p1', '/work/api', 'search_graph', ['x']), /must be an object/);
  await assert.rejects(knowledge.query('p1', '/work/api', 'search_graph', { query: 'x'.repeat(70 * 1024) }), /too large/);
  assert.ok(client.calls.every(c => c.tool !== 'index_repository' && c.tool !== 'delete_project'));
});

test('index runs a CBM job, follows it to the end and links the project\'s folders cross-repo', async () => {
  const states = { '/work/api': ['running', 'succeeded'], '/work/web': ['succeeded'] };
  const indexed = new Set();
  const { client, events } = setup({
    handlers: {
      list_projects: () => ({ projects: [...indexed].map(n => ({ name: n, root_path: n === 'api' ? '/work/api' : '/work/web' })) }),
      index_repository: (args) => {
        if (args.mode === 'cross-repo-intelligence') return { status: 'ok' };
        if (args.status) {
          const next = states[args.repo_path].shift();
          if (next === 'succeeded') indexed.add(args.name);
          return { project: args.name, state: next };
        }
        return { project: args.name, state: 'queued', async: true };
      },
    },
  });
  knowledge.setSettings('p1', { share: { '/work/api': true } });
  await knowledge.index('p1', '/work/api', { wait: true });
  const start = client.calls.find(c => c.tool === 'index_repository');
  assert.deepEqual(start.args, { repo_path: '/work/api', name: 'api', mode: 'full', async: true, persistence: true });
  const jobEvents = events.filter(e => e.reason === 'job' && e.folderPath === '/work/api');
  assert.ok(jobEvents.length >= 3);
  assert.equal(client.calls.filter(c => c.args.mode === 'cross-repo-intelligence').length, 0, 'one indexed folder: nothing to link');

  await knowledge.index('p1', '/work/web', { wait: true, mode: 'fast' });
  const webStart = client.calls.filter(c => c.tool === 'index_repository' && c.args.async)[1];
  assert.equal(webStart.args.mode, 'fast');
  assert.equal('persistence' in webStart.args, false);
  const links = client.calls.filter(c => c.args.mode === 'cross-repo-intelligence').map(c => [c.args.name, c.args.target_projects]);
  assert.deepEqual(links, [['api', ['web']], ['web', ['api']]]);
  assert.ok(events.some(e => e.reason === 'cross-repo'));
});

test('a job that cannot start is reported failed', async () => {
  setup({
    handlers: {
      list_projects: () => ({ projects: [] }),
      index_repository: () => { throw new Error('path refused: outside the allowed root'); },
    },
  });
  await assert.rejects(knowledge.index('p1', '/work/api'), /path refused/);
  const st = await knowledge.status('p1');
  const api = st.folders.find(f => f.path === '/work/api');
  assert.equal(api.job.state, 'failed');
  assert.match(api.job.error, /path refused/);
});

test('a second index of a folder while one runs joins it', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { client } = setup({
    handlers: {
      list_projects: () => ({ projects: [] }),
      index_repository: async (args) => {
        if (args.status) { await gate; return { state: 'succeeded' }; }
        return { state: 'running' };
      },
    },
  });
  await knowledge.index('p1', '/work/api');
  const again = await knowledge.index('p1', '/work/api');
  assert.equal(again.already, true);
  assert.equal(client.calls.filter(c => c.tool === 'index_repository' && c.args.async).length, 1);
  release();
  await flush();
});

test('status lists each folder with its name, index status and job', async () => {
  const { client } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      index_status: (args) => ({ project: args.project, status: 'ready', nodes: 10, edges: 20 }),
    },
  });
  const st = await knowledge.status('p1');
  assert.equal(st.binary.found.version, '0.12.1');
  assert.equal(st.binary.pinned, '0.12.1');
  assert.deepEqual(st.folders.map(f => [f.path, f.name, f.indexed, f.index?.nodes ?? null]), [['/work/api', 'api', true, 10], ['/work/web', null, false, null]]);
  assert.deepEqual(knowledge.settingsFor('p1').names, { '/work/api': 'api' }, 'a folder found indexed gets its name recorded');

  client.setFound(null);
  const none = await knowledge.status('p1');
  assert.equal(none.binary.found, null);
  assert.equal(none.folders[0].indexed, false, 'without a binary nothing is asked');
});

test('scheduleRefresh re-indexes only folders of projects with the graph on, once indexed, debounced', async () => {
  const queue = [];
  const timers = { setTimeout: (fn) => { queue.push(fn); return queue.length; }, clearTimeout: (id) => { queue[id - 1] = null; } };
  const { client } = setup({
    timers,
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      index_repository: (args) => (args.status ? { state: 'succeeded' } : { state: 'queued' }),
    },
  });
  assert.equal(knowledge.scheduleRefresh('/work/api'), false, 'graph off');
  knowledge.setSettings('p1', { enabled: true });
  assert.equal(knowledge.scheduleRefresh('/work/api'), false, 'not indexed yet');
  await knowledge.nameFor('p1', '/work/api');
  assert.equal(knowledge.scheduleRefresh('/work/api'), false, 'a name alone is not a graph');
  await knowledge.status('p1');
  assert.equal(knowledge.scheduleRefresh('/work/api'), true);
  assert.equal(knowledge.scheduleRefresh('/work/api'), true);
  const live = queue.filter(Boolean);
  assert.equal(live.length, 1, 'debounced to one');
  live[0]();
  await flush();
  const starts = client.calls.filter(c => c.tool === 'index_repository' && c.args.async);
  assert.equal(starts.length, 1);
  knowledge.setSettings('p1', { autoRefresh: false });
  assert.equal(knowledge.scheduleRefresh('/work/api'), false);
});

test('compare and prompts use the folders\' CBM names', async () => {
  const { client } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }, { name: 'web', root_path: '/work/web' }] }),
      compare_graphs: (args) => args,
    },
  });
  await knowledge.nameFor('p1', '/work/api');
  await knowledge.nameFor('p1', '/work/web');
  assert.deepEqual(await knowledge.compare('p1', '/work/api', '/work/web', { limit: 5000 }), { limit: 1000, base_project: 'api', target_project: 'web' });
  const p = await knowledge.prompt('p1', '/work/api', 'review_change_impact', { change: 'login()', base_branch: 'main' });
  assert.equal(p.text, 'prompt review_change_impact for api');
  assert.deepEqual(client.prompts[0].args, { project: 'api', change: 'login()', base_branch: 'main' });
  await assert.rejects(knowledge.prompt('p1', '/work/api', 'other', {}), /Unknown prompt/);
});

test('ADR: outline by default, a size limit on update, sections as text', async () => {
  const { events } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      manage_adr: (args) => args,
    },
  });
  await knowledge.nameFor('p1', '/work/api');
  assert.deepEqual(await knowledge.adr('p1', '/work/api'), { project: 'api', mode: 'outline' });
  assert.deepEqual(await knowledge.adr('p1', '/work/api', { mode: 'update', content: '# Decisions\n' }), { project: 'api', mode: 'update', content: '# Decisions\n' });
  await assert.rejects(knowledge.adr('p1', '/work/api', { mode: 'update', content: 'é'.repeat(4001) }), /at most 8000 bytes/);
  await assert.rejects(knowledge.adr('p1', '/work/api', { mode: 'set_sections', section_updates: { Context: 3 } }), /must be a string/);
  const r = await knowledge.adr('p1', '/work/api', { mode: 'set_sections', section_updates: { Context: 'Why' } });
  assert.deepEqual(r.section_updates, { Context: 'Why' });
  assert.equal(events.filter(e => e.reason === 'adr').length, 2);
});

test('traces: from a file or the call, invalid ones left out, a label kept', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-traces-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'traces.json');
  fs.writeFileSync(file, JSON.stringify({ label: 'load-test', traces: [{ path: ['a.main', 'a.login', 'a.check'], count: 3 }, { caller: 'a.main', callee: 'a.exit' }, { path: ['only-one'] }, 'nope'] }));
  const { client } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      ingest_traces: (args) => ({ stored: args.traces.length }),
    },
  });
  await knowledge.nameFor('p1', '/work/api');
  const r = await knowledge.ingestTracesFile('p1', '/work/api', file);
  assert.equal(r.label, 'load-test');
  assert.equal(r.sent, 2);
  assert.equal(r.skipped, 2);
  assert.deepEqual(client.calls.at(-1).args.traces, [{ path: ['a.main', 'a.login', 'a.check'], count: 3 }, { caller: 'a.main', callee: 'a.exit', count: 1 }]);
  const r2 = await knowledge.ingestTraces('p1', '/work/api', { traces: [{ caller: 'x', callee: 'y', count: 2 }], label: 'phone' });
  assert.equal(r2.label, 'phone');
  await assert.rejects(knowledge.ingestTraces('p1', '/work/api', { traces: [{ path: ['x'] }] }), /None of the traces/);
  await assert.rejects(knowledge.ingestTraces('p1', '/work/api', { traces: file }), /expected an array/, 'a string is never read as a file');
  await assert.rejects(knowledge.ingestTraces('p1', '/work/api', { filePath: file }), /expected an array/);
  fs.writeFileSync(file, '{ nope');
  await assert.rejects(knowledge.ingestTracesFile('p1', '/work/api', file), /not JSON/);
});

test('CBM settings: parsed from `config list`, checked before `config set`', async () => {
  const ran = [];
  setup({
    runConfig: async (bin, args) => {
      ran.push([bin, ...args]);
      return 'Configuration:\n  auto_index                = false\n  ui_enabled                = true\n  ui_port                   = 9749\n  ui-lang                   = auto\n';
    },
  });
  const c = await knowledge.getConfig();
  assert.deepEqual(c.values, { auto_index: 'false', ui_enabled: 'true', ui_port: '9749' });
  await knowledge.setConfig('ui_port', '9800');
  assert.deepEqual(ran.at(-2), ['/opt/cbm/codebase-memory-mcp', 'config', 'set', 'ui_port', '9800']);
  await assert.rejects(knowledge.setConfig('ui_port', '80'), /between 1024 and 65535/);
  await assert.rejects(knowledge.setConfig('auto_watch', 'yes'), /true or false/);
  await assert.rejects(knowledge.setConfig('install_hooks', 'false'), /Unknown setting/);
  await knowledge.setConfig('index_max_files', 'off');
  await assert.rejects(knowledge.setConfig('index_max_files', '-3'), /whole number or off/);
});

test('the Lens: its address for a folder, and whether it answers', async () => {
  const asked = [];
  setup({
    handlers: { list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }) },
    runConfig: async () => 'ui_enabled = true\nui_port = 9750\n',
    fetchImpl: async (url) => { asked.push(url); return { ok: true }; },
  });
  await knowledge.nameFor('p1', '/work/api');
  const l = await knowledge.lens('p1', '/work/api', 'architecture');
  assert.deepEqual(l, { ok: true, enabled: true, reachable: true, port: 9750, base: 'http://127.0.0.1:9750/', url: 'http://127.0.0.1:9750/?project=api&workspace=architecture', project: 'api', workspace: 'architecture' });
  assert.deepEqual(asked, ['http://127.0.0.1:9750/']);
  const other = await knowledge.lens('p1', '/work/web', 'nope');
  assert.equal(other.url, 'http://127.0.0.1:9750/', 'no project name before the first index');
  assert.equal(other.workspace, 'galaxy');
});

test('deleteIndex removes the graph but keeps the name for the next index', async () => {
  const { client, events } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      delete_project: (args) => ({ project: args.project, status: 'deleted' }),
    },
  });
  await knowledge.nameFor('p1', '/work/api');
  const r = await knowledge.deleteIndex('p1', '/work/api');
  assert.deepEqual(r.result, { project: 'api', status: 'deleted' });
  assert.equal(knowledge.settingsFor('p1').names['/work/api'], 'api');
  assert.ok(events.some(e => e.reason === 'deleted'));
  assert.deepEqual(client.calls.at(-1), { tool: 'delete_project', args: { project: 'api' } });
});

test('the binary path set in the app must be absolute, and restarts the session', () => {
  const { client } = setup();
  assert.throws(() => knowledge.setGlobalSettings({ binaryPath: 'cbm' }), /absolute/);
  knowledge.setGlobalSettings({ binaryPath: '/opt/x/codebase-memory-mcp' });
  assert.equal(knowledge.globalSettings().binaryPath, '/opt/x/codebase-memory-mcp');
  assert.equal(client.resets, 1);
  knowledge.setGlobalSettings({ binaryPath: '' });
  assert.equal(knowledge.globalSettings().binaryPath, null);
});

test('downloadBinary reports its steps and restarts the session', async () => {
  const { client, events } = setup();
  const r = await knowledge.downloadBinary();
  assert.equal(r.installed.version, '0.12.1');
  assert.equal(client.resets, 1);
  assert.ok(events.some(e => e.reason === 'download'));
  assert.ok(events.some(e => e.reason === 'binary'));
});

test('the git watcher is kept on for indexed folders of projects with the graph on', async () => {
  const db = fakeDb();
  db.addProject('p1', ['/work/api', '/work/web']);
  db.addProject('p2', ['/work/web', '/work/docs']);
  const watched = [];
  knowledge.init({
    db, log: quiet, projects: fakeProjects(db), locator: fakeLocator, emit() {},
    client: fakeClient({ list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }, { name: 'web', root_path: '/work/web' }, { name: 'docs', root_path: '/work/docs' }] }) }),
    watchRepo: (dir) => { watched.push(dir); },
  });
  await knowledge.status('p1');
  await knowledge.status('p2');
  assert.deepEqual(knowledge.watchEnabledFolders(), []);
  knowledge.setSettings('p1', { enabled: true });
  assert.deepEqual(watched.sort(), ['/work/api', '/work/web'], 'turning the graph on starts the watches');
  assert.deepEqual(knowledge.watchedFolders().sort(), ['/work/api', '/work/web']);
  knowledge.setSettings('p1', { autoRefresh: false });
  assert.deepEqual(knowledge.watchedFolders(), []);
  knowledge.stopWatching();
});

test('projects.js gives knowledge.js the folder check it relies on', () => {
  assert.equal(typeof require('../projects').requireAttachedFolder, 'function');
});


test('the brief gets a Code graph section only with the graph on, naming each indexed folder', async () => {
  const synced = [];
  const { db } = setup({ handlers: { list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }, { name: 'web', root_path: '/work/web' }] }) } });
  assert.equal(knowledge.briefSection('p1'), '');
  graphOn(db, 'p1');
  assert.equal(knowledge.briefSection('p1'), '', 'on, but no graph to name yet');
  await knowledge.nameFor('p1', '/work/api');
  assert.equal(knowledge.briefSection('p1'), '', 'a name alone is not a graph');
  await knowledge.status('p1');
  const section = knowledge.briefSection('p1');
  assert.match(section, /^## Code graph \(codebase-memory-mcp\)/);
  assert.match(section, /\| `\/work\/api` \| `api` \|/);
  assert.match(section, /CROSS_HTTP_CALLS/, 'two folders linked');
  knowledge.setSettings('p1', { crossRepo: false });
  assert.doesNotMatch(knowledge.briefSection('p1'), /CROSS_HTTP_CALLS/);
  assert.ok(synced);
});

test('turning the graph on syncs the brief and drops the block the cbm-setup kit wrote', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-brief-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managed = '<!-- switchboard:managed -->\n# Shop\n<!-- /switchboard:managed -->\n';
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `${managed}\n<!-- cbm:start -->\n## Code graph (codebase-memory-mcp)\nold\n<!-- cbm:end -->\n\nMy own notes.\n`);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), `${managed}\nNothing else.\n`);
  const db = fakeDb();
  db.addProject('p1', ['/work/api']);
  db.rows.projects[0].root = root;
  const synced = [];
  knowledge.init({ db, log: quiet, projects: fakeProjects(db), client: fakeClient({}), locator: fakeLocator, emit() {}, syncBrief: async (id) => { synced.push(id); } });
  knowledge.setSettings('p1', { mode: 'fast' });
  assert.deepEqual(synced, [], 'nothing that changes the brief');
  knowledge.setSettings('p1', { enabled: true });
  assert.deepEqual(synced, ['p1']);
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), `${managed}\nMy own notes.\n`);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), `${managed}\nNothing else.\n`);
});

test('sessions get CBM\'s MCP server only with the graph on and when the agent has none of its own', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-mcp-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); registrations.claude = null; registrations.codex = false; });
  const db = fakeDb();
  db.addProject('p1', ['/work/api']);
  knowledge.init({ db, log: quiet, projects: fakeProjects(db), client: fakeClient({}), locator: fakeLocator, emit() {}, cbmDir: () => dir });
  assert.deepEqual(knowledge.sessionLaunch('p1', 'claude'), {}, 'graph off');
  knowledge.setSettings('p1', { enabled: true, toolProfile: 'scout' });
  const claude = knowledge.sessionLaunch('p1', 'claude');
  assert.equal(claude.mcpConfig, path.join(dir, 'mcp-scout.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(claude.mcpConfig, 'utf8')), { mcpServers: { 'codebase-memory-mcp': { type: 'stdio', command: '/opt/cbm/codebase-memory-mcp', args: ['--tool-profile=scout'] } } });
  assert.deepEqual(knowledge.sessionLaunch('p1', 'codex'), { mcpServers: [{ name: 'codebase-memory-mcp', command: '/opt/cbm/codebase-memory-mcp', args: ['--tool-profile=scout'] }] });
  assert.deepEqual(knowledge.sessionLaunch('p1', 'opencode'), {});
  assert.deepEqual(knowledge.sessionLaunch(null, 'claude'), {});
  registrations.claude = { command: '/opt/cbm/codebase-memory-mcp' };
  registrations.codex = true;
  knowledge.restart(); // drops what was read of the agents' configs
  assert.deepEqual(knowledge.sessionLaunch('p1', 'claude'), {}, 'already in the agent\'s config');
  assert.deepEqual(knowledge.sessionLaunch('p1', 'codex'), {});
  assert.deepEqual(knowledge.agentsStatus(), { claude: 'global', codex: 'global' });
});

test('the agents\' installer runs as a dry run first, then for real', async () => {
  const ran = [];
  const db = fakeDb();
  db.addProject('p1', []);
  const events = [];
  knowledge.init({ db, log: quiet, projects: fakeProjects(db), client: fakeClient({}), locator: fakeLocator, emit: (c, p) => events.push(p), runInstall: async (bin, args) => { ran.push([bin, ...args]); return { ok: true, output: 'would write ~/.claude.json' }; } });
  const preview = await knowledge.installAgents();
  assert.equal(preview.dryRun, true);
  assert.equal(preview.output, 'would write ~/.claude.json');
  await knowledge.installAgents({ dryRun: false });
  assert.deepEqual(ran, [['/opt/cbm/codebase-memory-mcp', 'install', '--dry-run', '-n'], ['/opt/cbm/codebase-memory-mcp', 'install', '-y']]);
  assert.ok(events.some(e => e.reason === 'agents'));
});


test('a deleted graph is not rebuilt by the next change, and leaves the brief', async () => {
  const queue = [];
  const timers = { setTimeout: (fn) => { queue.push(fn); return queue.length; }, clearTimeout: (id) => { queue[id - 1] = null; } };
  let listed = [{ name: 'api', root_path: '/work/api' }];
  setup({ timers, handlers: { list_projects: () => ({ projects: listed }), delete_project: () => { listed = []; return { status: 'deleted' }; } } });
  knowledge.setSettings('p1', { enabled: true });
  await knowledge.status('p1');
  assert.match(knowledge.briefSection('p1'), /`api`/);
  assert.equal(knowledge.scheduleRefresh('/work/api'), true);
  await knowledge.deleteIndex('p1', '/work/api');
  assert.equal(queue.filter(Boolean).length, 0, 'the refresh waiting is dropped');
  assert.equal(knowledge.scheduleRefresh('/work/api'), false);
  assert.doesNotMatch(knowledge.briefSection('p1'), /`api`/);
  assert.equal(knowledge.settingsFor('p1').names['/work/api'], 'api', 'the name is kept for the next index');
});

test('a graph deleted outside the app is noticed by the status', async () => {
  let listed = [{ name: 'api', root_path: '/work/api' }];
  setup({ handlers: { list_projects: () => ({ projects: listed }) } });
  await knowledge.status('p1');
  assert.equal(knowledge.settingsFor('p1').indexed['/work/api'], true);
  listed = [];
  await knowledge.status('p1');
  assert.equal(knowledge.settingsFor('p1').indexed['/work/api'], undefined);
});

test('a refresh links nothing again; an index does, once at a time', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { client } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }, { name: 'web', root_path: '/work/web' }] }),
      index_repository: async (args) => {
        if (args.mode === 'cross-repo-intelligence') { await gate; return {}; }
        return args.status ? { state: 'succeeded' } : { state: 'queued' };
      },
    },
  });
  await knowledge.status('p1');
  await knowledge.index('p1', '/work/api', { kind: 'refresh', wait: true });
  assert.equal(client.calls.filter(c => c.args.mode === 'cross-repo-intelligence').length, 0);
  const first = knowledge.linkCrossRepo('p1');
  const second = knowledge.linkCrossRepo('p1');
  assert.equal(first, second, 'the second joins the first');
  release();
  await first;
  assert.equal(client.calls.filter(c => c.args.mode === 'cross-repo-intelligence').length, 2, 'one pass over the two folders');
});

test('a change while a folder is read is read again after; a job CBM lost is given up', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let answer = 'running';
  const { db, client } = setup({
    handlers: {
      list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }),
      index_repository: async (args) => {
        if (!args.status) return { state: 'queued' };
        await gate;
        return answer === 'lost' ? { error: 'no such job' } : { state: answer };
      },
    },
  });
  graphOn(db, 'p1');
  await knowledge.status('p1');
  await knowledge.index('p1', '/work/api');
  const again = await knowledge.index('p1', '/work/api', { kind: 'refresh' });
  assert.equal(again.already, true);
  answer = 'succeeded';
  release();
  await new Promise(r => setTimeout(r, 30));
  const starts = client.calls.filter(c => c.tool === 'index_repository' && c.args.async);
  assert.equal(starts.length, 2, 'the refresh asked for during the job ran after it');

  answer = 'lost';
  const st = await knowledge.index('p1', '/work/api', { wait: true });
  assert.equal(st.ok, true);
  const s2 = await knowledge.status('p1');
  assert.equal(s2.folders[0].job.state, 'failed');
  assert.match(s2.folders[0].job.error, /lost track/);
});

test('the graph is only read: write clauses and files out of the folder are refused', async () => {
  const { client } = setup({ handlers: { list_projects: () => ({ projects: [{ name: 'api', root_path: '/work/api' }] }), query_graph: () => ({ columns: [], rows: [] }), get_file_outline: () => ({}), check_index_coverage: () => ({}) } });
  await knowledge.status('p1');
  for (const q of ['MATCH (n) DETACH DELETE n', 'CREATE (n:Function {name: "x"})', 'MATCH (n) SET n.name = 1', 'match (n) remove n.x', 'MERGE (a)-[:CALLS]->(b)', "CALL db.labels()", 'MATCH (n) /* x */ DELETE n']) {
    await assert.rejects(knowledge.query('p1', '/work/api', 'query_graph', { query: q }), /Only reading queries/, q);
  }
  for (const q of ["MATCH (f:Function) WHERE f.name = 'deleteUser' RETURN f.name", 'MATCH (f) WHERE f.name CONTAINS "create" RETURN f.set, f.create LIMIT 5', 'MATCH (a)-[:CALLS]->(b) RETURN a.name, b.name // set later']) {
    await knowledge.query('p1', '/work/api', 'query_graph', { query: q });
  }
  assert.equal(client.calls.filter(c => c.tool === 'query_graph').length, 3);
  for (const bad of ['/etc/hosts', '../secrets.txt', 'src/../../x', 'C:\\x', '']) {
    await assert.rejects(knowledge.query('p1', '/work/api', 'get_file_outline', { file_path: bad }), /a path in the folder/, bad);
  }
  await assert.rejects(knowledge.query('p1', '/work/api', 'check_index_coverage', { paths: ['src/a.js', '../b.js'] }), /a path in the folder/);
  await knowledge.query('p1', '/work/api', 'get_file_outline', { file_path: 'src/app.js' });
  await knowledge.query('p1', '/work/api', 'check_index_coverage', { paths: ['src/a.js', 'lib/b.ts'] });
});

// --- Worktrees: a graph of their own while they are in a project ---

/** A CBM that keeps its graphs: an index job ends after `polls` status calls; `order` records what it was asked. */
function cbmWorld({ polls = 1 } = {}) {
  const graphs = new Map(); // name → root
  const left = new Map();
  const world = { graphs, order: [], failDelete: false };
  world.handlers = {
    list_projects: () => ({ projects: [...graphs].map(([name, root]) => ({ name, root_path: root })) }),
    index_repository: (args) => {
      if (args.mode === 'cross-repo-intelligence') { world.order.push(`link ${args.name}`); return { status: 'ok' }; }
      if (args.status) {
        const n = (left.get(args.name) ?? 1) - 1;
        left.set(args.name, n);
        world.order.push(`poll ${args.name}`);
        if (n > 0) return { state: 'running' };
        graphs.set(args.name, args.repo_path);
        return { state: 'succeeded' };
      }
      left.set(args.name, polls);
      world.order.push(`index ${args.name}`);
      return { state: 'queued' };
    },
    delete_project: (args) => {
      if (world.failDelete) throw new Error('the daemon is busy');
      world.order.push(`delete ${args.project}`);
      return { project: args.project, status: graphs.delete(args.project) ? 'deleted' : 'not_found' };
    },
    index_status: (args) => ({ project: args.project, status: 'ready' }),
  };
  return world;
}

// Short waits (polls, refreshes) run at once; the wait for a job before a delete does not end by itself.
const jobTimers = { setTimeout: (fn, ms) => { if (ms < 60_000) setImmediate(fn); return 1; }, clearTimeout() {} };
const WT = '/work/api.worktrees/feat-login';

function addWorktree(db, projectId, folderPath, sourcePath, branch) {
  db.rows.folders.push({ projectId, path: folderPath, mode: 'worktree', sourcePath, branch, sortOrder: 9 });
}

function removeFolder(db, projectId, folderPath) {
  const row = db.rows.folders.find(f => f.projectId === projectId && f.path === folderPath);
  db.rows.folders = db.rows.folders.filter(f => f !== row);
  return row;
}

async function until(check, what) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await flush();
  }
  assert.fail(`still waiting for ${what}`);
}

test('a worktree is named after its repository and branch, and remembered as one', async () => {
  const world = cbmWorld();
  world.graphs.set('billing-api', '/work/api');
  const { db } = setup({ handlers: world.handlers, projects: { p1: ['/work/api'] } });
  addWorktree(db, 'p1', WT, '/work/api', 'feat/login');
  addWorktree(db, 'p1', '/elsewhere/login', '/work/api', 'feat/login');
  addWorktree(db, 'p1', '/tmp/wt/fix', '/work/web', 'fix: the #2 bug');
  addWorktree(db, 'p1', '/tmp/wt/detached-head', '/work/web', '');
  assert.equal(await knowledge.nameFor('p1', WT), 'billing-api-wt-feat-login', 'the name CBM has for the repository');
  assert.equal(await knowledge.nameFor('p1', '/elsewhere/login'), 'billing-api-wt-feat-login-2', 'made unique');
  assert.equal(await knowledge.nameFor('p1', '/tmp/wt/fix'), 'web-wt-fix-the-2-bug', 'else the repository folder\'s name');
  assert.equal(await knowledge.nameFor('p1', '/tmp/wt/detached-head'), 'web-wt-detached-head', 'no branch: the worktree folder\'s name');
  assert.deepEqual(Object.keys(knowledge.settingsFor('p1').worktrees).sort(), [WT, '/elsewhere/login', '/tmp/wt/fix', '/tmp/wt/detached-head'].sort());
});

test('a worktree that joins a project with the graph on is indexed on its own, outside the cross-repo links', async () => {
  const world = cbmWorld();
  world.graphs.set('api', '/work/api');
  world.graphs.set('web', '/work/web');
  const { db, client } = setup({ handlers: world.handlers, timers: jobTimers });
  await knowledge.status('p1');
  const folder = { path: WT, mode: 'worktree', sourcePath: '/work/api', branch: 'feat/login' };
  addWorktree(db, 'p1', WT, '/work/api', 'feat/login');
  const starts = () => client.calls.filter(c => c.tool === 'index_repository' && c.args.async);

  knowledge.folderChanged({ projectId: 'p1', folder, change: 'attached' });
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(starts().length, 0, 'the graph is off');

  client.setFound(null);
  knowledge.setSettings('p1', { enabled: true });
  knowledge.folderChanged({ projectId: 'p1', folder, change: 'attached' });
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(starts().length, 0, 'no CBM to index with');
  client.setFound({ path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true });

  knowledge.folderChanged({ projectId: 'p1', folder, change: 'attached' });
  await until(() => knowledge.settingsFor('p1').indexed[WT], 'the worktree\'s graph');
  assert.deepEqual(starts().map(c => c.args), [{ repo_path: WT, name: 'api-wt-feat-login', mode: 'full', async: true, index_worktree: true }]);
  assert.equal(world.order.filter(o => o.startsWith('link')).length, 0, 'a second checkout of api links nothing');

  const brief = knowledge.briefSection('p1');
  assert.match(brief, /\| `\/work\/api\.worktrees\/feat-login` \(worktree of `\/work\/api`, branch `feat\/login`\) \| `api-wt-feat-login` \|/);
  assert.match(brief, /when you work in a worktree, pass its name/);
  assert.match(brief, /CROSS_HTTP_CALLS/, 'api and web are still linked');
  removeFolder(db, 'p1', '/work/web');
  assert.doesNotMatch(knowledge.briefSection('p1'), /CROSS_HTTP_CALLS/, 'a repository and its worktree are not two folders to link');

  const row = (await knowledge.status('p1')).folders.find(f => f.path === WT);
  assert.deepEqual([row.mode, row.sourcePath, row.branch, row.indexed], ['worktree', '/work/api', 'feat/login', true]);
  assert.deepEqual((await knowledge.status('p1')).folders.find(f => f.path === '/work/api').sourcePath, null);
});

test('a worktree that leaves the project loses its graph, once the job reading it ends', async () => {
  const world = cbmWorld({ polls: 3 });
  const { db, client, events } = setup({ handlers: world.handlers, timers: jobTimers, projects: { p1: ['/work/api'], p2: ['/work/web'] } });
  graphOn(db, 'p1');
  addWorktree(db, 'p1', WT, '/work/api', 'feat/login');
  await knowledge.index('p1', WT);
  knowledge.folderChanged({ projectId: 'p1', folder: removeFolder(db, 'p1', WT), change: 'detached' });
  await until(() => world.order.includes('delete api-wt-feat-login'), 'the delete');
  assert.deepEqual(world.order, ['index api-wt-feat-login', 'poll api-wt-feat-login', 'poll api-wt-feat-login', 'poll api-wt-feat-login', 'delete api-wt-feat-login']);
  assert.equal(world.graphs.size, 0);
  await until(() => events.some(e => e.reason === 'forgotten' && e.folderPath === WT), 'the event');
  const s = knowledge.settingsFor('p1');
  assert.deepEqual([s.names[WT], s.indexed[WT], s.worktrees[WT]], [undefined, undefined, undefined]);

  // A folder that is not a worktree keeps its graph and its name.
  await knowledge.nameFor('p2', '/work/web');
  knowledge.folderChanged({ projectId: 'p2', folder: removeFolder(db, 'p2', '/work/web'), change: 'detached' });
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(knowledge.settingsFor('p2').names['/work/web'], 'web');

  // A worktree another project still has keeps its graph: only this project forgets it.
  addWorktree(db, 'p1', '/wt/shared', '/work/api', 'shared');
  addWorktree(db, 'p2', '/wt/shared', '/work/api', 'shared');
  await knowledge.nameFor('p1', '/wt/shared');
  await knowledge.nameFor('p2', '/wt/shared');
  knowledge.folderChanged({ projectId: 'p1', folder: removeFolder(db, 'p1', '/wt/shared'), change: 'detached' });
  await until(() => !knowledge.settingsFor('p1').names['/wt/shared'], 'p1 forgetting it');
  assert.equal(knowledge.settingsFor('p2').names['/wt/shared'], 'api-wt-shared');
  assert.equal(client.calls.filter(c => c.tool === 'delete_project').length, 1);
});

test('a worktree that moves keeps its name: the old graph goes before the new one is made', async () => {
  const world = cbmWorld();
  const { db } = setup({ handlers: world.handlers, timers: jobTimers, projects: { p1: ['/work/api'] } });
  graphOn(db, 'p1');
  addWorktree(db, 'p1', WT, '/work/api', 'feat/login');
  await knowledge.index('p1', WT, { wait: true });
  const row = removeFolder(db, 'p1', WT);
  addWorktree(db, 'p1', '/work/moved', '/work/api', 'feat/login');
  knowledge.folderChanged({ projectId: 'p1', folder: row, change: 'detached' });
  knowledge.folderChanged({ projectId: 'p1', folder: { ...row, path: '/work/moved' }, change: 'attached' });
  await until(() => knowledge.settingsFor('p1').indexed['/work/moved'], 'the moved worktree\'s graph');
  assert.equal(knowledge.settingsFor('p1').names['/work/moved'], 'api-wt-feat-login');
  assert.deepEqual([...world.graphs], [['api-wt-feat-login', '/work/moved']]);
});

test('the sweep deletes what CBM did not take, and graphs of folders that left while the app could not act', async (t) => {
  const kept = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-kept-'));
  t.after(() => fs.rmSync(kept, { recursive: true, force: true }));
  const world = cbmWorld();
  const { db, client } = setup({ handlers: world.handlers, timers: jobTimers, projects: { p1: ['/work/api'] } });
  assert.deepEqual(await knowledge.sweepOrphans(), { ok: true, deleted: 0 });
  assert.equal(client.calls.length, 0, 'nothing to delete: CBM is not asked');

  addWorktree(db, 'p1', WT, '/work/api', 'feat/login');
  await knowledge.index('p1', WT, { wait: true });
  world.failDelete = true;
  knowledge.folderChanged({ projectId: 'p1', folder: removeFolder(db, 'p1', WT), change: 'detached' });
  await until(() => !knowledge.settingsFor('p1').names[WT], 'the worktree forgotten');
  assert.ok(world.graphs.has('api-wt-feat-login'), 'CBM did not take the delete');
  assert.deepEqual(db.getSetting('knowledge-orphans'), [{ name: 'api-wt-feat-login', path: WT }]);

  // Left while the app was away: a worktree, a folder gone from disk, a folder still there.
  const s = knowledge.settingsFor('p1');
  Object.assign(s.names, { '/old/wt': 'api-wt-old', '/gone/repo-kn': 'gone', [kept]: 'docs' });
  s.worktrees['/old/wt'] = true;
  db.setSetting('knowledge:p1', s);
  world.graphs.set('api-wt-old', '/old/wt');
  world.graphs.set('gone', '/gone/repo-kn');
  world.graphs.set('docs', kept);
  client.setFound(null);
  assert.deepEqual(await knowledge.sweepOrphans(), { ok: false, deleted: 0 }, 'no CBM: tried again later');
  client.setFound({ path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true });
  world.failDelete = false;
  assert.deepEqual(await knowledge.sweepOrphans(), { ok: true, deleted: 3 });
  assert.deepEqual([...world.graphs.keys()], ['docs'], 'a detached folder still on disk keeps its graph');
  assert.deepEqual(knowledge.settingsFor('p1').names, { [kept]: 'docs' });
  assert.deepEqual(db.getSetting('knowledge-orphans'), []);

  // A name a folder took again is in use: it leaves the list, its graph stays.
  db.setSetting('knowledge-orphans', [{ name: 'docs', path: '/somewhere/else' }]);
  assert.deepEqual(await knowledge.sweepOrphans(), { ok: true, deleted: 0 });
  assert.ok(world.graphs.has('docs'));
  assert.deepEqual(db.getSetting('knowledge-orphans'), []);
});

// --- New projects: the graph on, each folder read as it joins ---

test('a new project starts with the graph on, and its folders are read one after the other as they join', async () => {
  const world = cbmWorld({ polls: 2 });
  const { db, client, events } = setup({ handlers: world.handlers, timers: jobTimers });
  knowledge.projectCreated({ projectId: 'nope' });
  assert.equal(db.getSetting('knowledge:nope'), null, 'no such project: nothing saved');
  knowledge.projectCreated({ projectId: 'p1' });
  assert.equal(knowledge.settingsFor('p1').enabled, true);
  assert.ok(events.some(e => e.projectId === 'p1' && e.reason === 'settings'));

  knowledge.folderChanged({ projectId: 'p1', folder: { path: '/work/api', mode: 'in-place' }, change: 'attached' });
  knowledge.folderChanged({ projectId: 'p1', folder: { path: '/work/web', mode: 'in-place' }, change: 'attached' });
  await until(() => knowledge.settingsFor('p1').indexed['/work/web'], 'web\'s graph');
  const starts = client.calls.filter(c => c.tool === 'index_repository' && c.args.async).map(c => c.args);
  assert.deepEqual(starts, [
    { repo_path: '/work/api', name: 'api', mode: 'full', async: true },
    { repo_path: '/work/web', name: 'web', mode: 'full', async: true },
  ]);
  assert.ok(world.order.indexOf('index web') > world.order.lastIndexOf('poll api'), 'web waits for api\'s job to end');
  await until(() => world.order.some(o => o.startsWith('link')), 'the cross-repo link');
  const brief = knowledge.briefSection('p1');
  assert.match(brief, /\| `\/work\/api` \| `api` \|/);
  assert.match(brief, /\| `\/work\/web` \| `web` \|/);
});

test('turning the graph on reads the folders that have none; nothing is read with the graph off or without CBM', async () => {
  const world = cbmWorld();
  world.graphs.set('api', '/work/api');
  const { db, client } = setup({ handlers: world.handlers, timers: jobTimers, projects: { p1: ['/work/api', '/work/web', '/work/docs'] } });
  await knowledge.status('p1');
  const starts = () => client.calls.filter(c => c.tool === 'index_repository' && c.args.async).map(c => c.args.repo_path);

  knowledge.folderChanged({ projectId: 'p1', folder: { path: '/work/web', mode: 'in-place' }, change: 'attached' });
  client.setFound(null);
  knowledge.setSettings('p1', { enabled: true });
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(starts(), [], 'the graph off, then no CBM');

  knowledge.setSettings('p1', { enabled: false });
  client.setFound({ path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true });
  knowledge.setSettings('p1', { enabled: true });
  removeFolder(db, 'p1', '/work/docs');
  await until(() => knowledge.settingsFor('p1').indexed['/work/web'], 'web\'s graph');
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(starts(), ['/work/web'], 'api has its graph; docs left before its turn');

  knowledge.setSettings('p1', { enabled: false });
  knowledge.setSettings('p1', { enabled: true });
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(starts(), ['/work/web'], 'on again: every folder has its graph');
});

test('auto_index on and auto_index_limit at the largest CBM takes: set once over CBM\'s own defaults, never over the user\'s', async () => {
  const values = { auto_index: 'false', auto_index_limit: '50000' };
  const ran = [];
  const runConfig = async (bin, args) => {
    ran.push(args.join(' '));
    if (args[1] === 'set') { values[args[2]] = args[3]; return 'ok\n'; }
    return 'Configuration:\n' + Object.entries(values).map(([k, v]) => `  ${k.padEnd(25)} = ${v}`).join('\n') + '\n';
  };
  const { db, client, events } = setup({ runConfig });
  client.setFound(null);
  assert.deepEqual(await knowledge.applyConfigDefaults(), { ok: false, applied: [] }, 'no CBM: the next start tries again');
  assert.deepEqual(ran, []);

  client.setFound({ path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true });
  assert.deepEqual(await knowledge.applyConfigDefaults(), { ok: true, applied: ['auto_index', 'auto_index_limit'] });
  assert.deepEqual([values.auto_index, values.auto_index_limit], ['true', '2147483647']);
  assert.ok(events.some(e => e.reason === 'config'));

  Object.assign(values, { auto_index: 'false', auto_index_limit: '50000' });
  ran.length = 0;
  assert.deepEqual(await knowledge.applyConfigDefaults(), { ok: true, applied: [] });
  assert.deepEqual(ran, [], 'done once: the value is the user\'s from then on, and CBM is not asked again');

  db.setSetting('knowledge-config-defaults', null);
  values.auto_index_limit = '120000';
  assert.deepEqual(await knowledge.applyConfigDefaults(), { ok: true, applied: ['auto_index'] });
  assert.deepEqual([values.auto_index, values.auto_index_limit], ['true', '120000'], 'a value set before is kept');
  assert.deepEqual(db.getSetting('knowledge-config-defaults'), { auto_index: true, auto_index_limit: true });

  // More than CBM's int would wrap (4294967296 reads as 0): it takes the largest instead.
  await knowledge.setConfig('auto_index_limit', '9999999999');
  assert.equal(values.auto_index_limit, '2147483647');
  await knowledge.setConfig('auto_index_limit', '80000');
  assert.equal(values.auto_index_limit, '80000');
});
