// knowledge.js: one file in one graph. The project folder as a folder of the
// tab, names CBM makes, the .cbmignore block that leaves a folder with a graph
// of its own out of the graph around it, repositories inside a folder, graphs
// CBM made of subfolders, cross-repo links that go on past a failure, and the
// brief that routes the agents. Folders are real (temporary) where files are
// written; the CBM client is a fake that answers like 0.12.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const knowledge = require('../knowledge');

const quiet = { warn() {}, info() {}, error() {} };
const flush = () => new Promise(r => setImmediate(r));
async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await flush();
  }
  assert.fail(`timed out waiting for ${what}`);
}

function tmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kn-scope-')));
}

function fakeDb() {
  const rows = { projects: [], folders: [], settings: new Map() };
  return {
    rows,
    addProject: (id, { root = null, folders = [] } = {}) => {
      rows.projects.push({ id, name: id, root });
      folders.forEach((f, i) => {
        const spec = typeof f === 'string' ? { path: f } : f;
        rows.folders.push({ projectId: id, mode: 'in-place', sortOrder: i, ...spec });
      });
    },
    getSetting: (key) => rows.settings.get(key) ?? null,
    setSetting: (key, value) => { rows.settings.set(key, JSON.parse(JSON.stringify(value))); },
    deleteSetting: (key) => { rows.settings.delete(key); },
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

/**
 * A CBM that keeps its graphs: index_repository (async) makes or refreshes one
 * (a name, or the one CBM makes from the path), status says it succeeded.
 */
function cbmWorld({ graphs = [], coverage = () => ({ scopes: [] }), failLink = () => false } = {}) {
  const world = { graphs: graphs.map(g => ({ ...g })), calls: [] };
  const derived = (p) => p.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  const handlers = {
    list_projects: () => ({ projects: world.graphs.map(g => ({ name: g.name, root_path: g.root_path })), has_more: false }),
    index_repository: (args) => {
      if (args.status) return { state: 'succeeded' };
      if (args.mode === 'cross-repo-intelligence') {
        if (failLink(args)) throw new Error(`cannot link ${args.name}`);
        return { status: 'ran' };
      }
      const name = args.name || derived(args.repo_path);
      if (!world.graphs.some(g => g.name === name)) world.graphs.push({ name, root_path: args.repo_path });
      return { state: 'queued' };
    },
    delete_project: (args) => { world.graphs = world.graphs.filter(g => g.name !== args.project); return { deleted: true }; },
    index_status: (args) => ({ project: args.project, status: 'ready', nodes: 10, edges: 5, indexed_at: '2026-11-25T10:00:00Z' }),
    check_index_coverage: (args) => coverage(args),
  };
  const client = {
    calls: world.calls,
    async call(tool, args = {}) {
      world.calls.push({ tool, args });
      const h = handlers[tool];
      if (!h) throw Object.assign(new Error(`no handler for ${tool}`), { code: 'cbm-tool-error' });
      return h(args);
    },
    async prompt() { return ''; },
    refresh: () => ({ path: '/opt/cbm/codebase-memory-mcp', version: '0.12.1', ok: true, source: 'installed' }),
    reset() {},
    status: () => ({ running: true, error: null, halted: false }),
  };
  return { world, client, derived };
}

const fakeLocator = {
  SERVER_NAME: 'codebase-memory-mcp',
  registeredServer: () => null,
  codexRegistered: () => false,
  MIN_VERSION: [0, 12, 1],
  CBM_VERSION: '0.12.1',
  RELEASE_PAGE: 'https://example.invalid/releases',
  latestCbm: async () => null,
  assetFor: () => null,
  isNewerVersion: () => false,
  defaultInstallDir: () => '/home/u/.local/bin',
};

function setup({ db, client, runGit, cbmDir = null, syncBrief } = {}) {
  const events = [];
  knowledge.init({
    db,
    log: quiet,
    projects: fakeProjects(db),
    client,
    locator: fakeLocator,
    emit: (channel, payload) => events.push({ channel, ...payload }),
    timers: { setTimeout: (fn) => { setImmediate(fn); return 1; }, clearTimeout() {} },
    runConfig: async () => '',
    fetchImpl: async () => ({ ok: true }),
    now: () => 1000,
    runGit: runGit || (async () => null),
    cbmDir,
    syncBrief: syncBrief || (async () => {}),
  });
  return { events };
}

function settingsWith(db, projectId, patch) {
  db.setSetting(`knowledge:${projectId}`, { ...knowledge.settingsFor(projectId), ...patch });
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'pipe' }).toString();
}

function repo(dir, files = { 'a.js': 'module.exports = 1;\n' }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

// --- The project folder ---

test('the project folder is the first folder of the tab, once even when it is attached too', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: ['/work/api'] });
  db.addProject('p2', { root: '/work/sb/p2', folders: ['/work/sb/p2', '/work/web'] });
  const { client } = cbmWorld({ graphs: [{ name: 'api', root_path: '/work/api' }] });
  setup({ db, client });
  const s1 = await knowledge.status('p1');
  assert.deepEqual(s1.folders.map(f => [f.path, f.mode]), [['/work/sb/p1', 'project'], ['/work/api', 'in-place']]);
  assert.equal(s1.folders[1].indexed, true);
  assert.equal(s1.folders[0].indexed, false);
  const s2 = await knowledge.status('p2');
  assert.deepEqual(s2.folders.map(f => [f.path, f.mode]), [['/work/sb/p2', 'project'], ['/work/web', 'in-place']]);
  // A project without a folder of its own (an old row) lists the attached ones only.
  db.addProject('p3', { folders: ['/work/api'] });
  assert.deepEqual((await knowledge.status('p3')).folders.map(f => f.path), ['/work/api']);
});

test('the project folder can be asked and indexed; a path inside it that is no folder of the tab cannot', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: ['/work/api'] });
  const { client } = cbmWorld();
  setup({ db, client });
  await assert.rejects(knowledge.query('p1', '/work/sb/p1/tools', 'search_graph', {}), /not attached/);
  await knowledge.index('p1', '/work/sb/p1', { wait: true });
  const r = await knowledge.query('p1', '/work/sb/p1', 'search_graph', { name_pattern: 'x' }).catch(e => e);
  // The query went to CBM under the project folder's name (no search_graph handler in the fake world).
  assert.match(String(r.message), /no handler for search_graph/);
  assert.equal(client.calls.at(-1).args.project, 'work-sb-p1');
});

test('the project folder takes the name CBM gives it, so an agent\'s session there finds the same graph', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: [] });
  const { client, world } = cbmWorld();
  setup({ db, client });
  await knowledge.index('p1', '/work/sb/p1', { wait: true });
  const started = client.calls.find(c => c.tool === 'index_repository' && !c.args.status);
  assert.equal(started.args.name, undefined, 'indexed without a name of the app\'s');
  assert.equal(knowledge.settingsFor('p1').names['/work/sb/p1'], 'work-sb-p1');
  assert.equal(knowledge.settingsFor('p1').indexed['/work/sb/p1'], true);
  assert.equal(world.graphs.length, 1);
  // A graph CBM already has of it (an agent's session made it) is adopted, however long its name.
  const long = `Users-someone-${'x'.repeat(150)}`;
  const db2 = fakeDb();
  db2.addProject('p2', { root: '/work/sb/p2', folders: [] });
  const w2 = cbmWorld({ graphs: [{ name: long, root_path: '/work/sb/p2' }] });
  setup({ db: db2, client: w2.client });
  await knowledge.index('p2', '/work/sb/p2', { wait: true });
  assert.equal(knowledge.settingsFor('p2').names['/work/sb/p2'], long);
  assert.equal(w2.world.graphs.length, 1);
  assert.equal(knowledge.normalizeSettings({ names: { '/a': long } }).names['/a'], long, 'kept by the settings');
  assert.equal(knowledge.normalizeSettings({ names: { '/a': 'y'.repeat(201) } }).names['/a'], undefined);
});

test('the project folder is not linked cross-repo, not watched by git, and not shared; turning the graph on reads it', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: ['/work/api', '/work/web'] });
  const { client } = cbmWorld();
  setup({ db, client });
  await knowledge.setSettings('p1', { enabled: true });
  await until(() => ['/work/sb/p1', '/work/api', '/work/web'].every(p => knowledge.settingsFor('p1').indexed[p]), 'every folder indexed');
  const links = client.calls.filter(c => c.args.mode === 'cross-repo-intelligence');
  assert.ok(links.length >= 2);
  assert.ok(links.every(c => c.args.repo_path !== '/work/sb/p1' && !c.args.target_projects.includes('work-sb-p1')), 'the project folder is left out of the links');
  assert.deepEqual(knowledge.watchedFolders().sort(), ['/work/api', '/work/web']);
  await knowledge.setSettings('p1', { share: { '/work/sb/p1': true, '/work/api': true } });
  assert.deepEqual(knowledge.settingsFor('p1').share, { '/work/api': true });
});

test('a session that ends, and the app that starts, read the project folder again', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: [] });
  const { client } = cbmWorld({ graphs: [{ name: 'work-sb-p1', root_path: '/work/sb/p1' }] });
  setup({ db, client });
  settingsWith(db, 'p1', { enabled: true, names: { '/work/sb/p1': 'work-sb-p1' }, indexed: { '/work/sb/p1': true } });
  assert.equal(knowledge.sessionEnded('p1'), true);
  await until(() => client.calls.some(c => c.tool === 'index_repository' && c.args.repo_path === '/work/sb/p1'), 'a refresh');
  const { count, done } = knowledge.refreshProjectFolders();
  assert.equal(count, 1);
  await done;
  assert.equal(knowledge.sessionEnded('nope'), false);
});

test('a new project reads its project folder at once; a deleted one loses its graph and its settings', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: [] });
  db.addProject('p2', { root: '/work/sb/shared', folders: [] });
  db.addProject('p3', { root: '/work/sb/shared', folders: [] });
  const { client, world } = cbmWorld();
  setup({ db, client });
  knowledge.projectCreated({ projectId: 'p1' });
  await until(() => knowledge.settingsFor('p1').indexed['/work/sb/p1'], 'the project folder indexed');
  assert.ok(world.graphs.some(g => g.root_path === '/work/sb/p1'));
  db.rows.projects = db.rows.projects.filter(p => p.id !== 'p1');
  const r = await knowledge.projectDeleted({ projectId: 'p1', root: '/work/sb/p1' });
  assert.equal(r.deleted, true);
  assert.ok(!world.graphs.some(g => g.root_path === '/work/sb/p1'));
  assert.equal(db.getSetting('knowledge:p1'), null);
  // A project folder another project has too keeps its graph.
  await knowledge.index('p2', '/work/sb/shared', { wait: true });
  db.rows.projects = db.rows.projects.filter(p => p.id !== 'p2');
  assert.equal((await knowledge.projectDeleted({ projectId: 'p2', root: '/work/sb/shared' })).deleted, false);
  assert.ok(world.graphs.some(g => g.root_path === '/work/sb/shared'));
});

test('the sweep deletes the graph of the app\'s cbm folder once, and never a project folder\'s', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: [] });
  const { client, world } = cbmWorld({ graphs: [
    { name: 'work-app-cbm', root_path: '/work/app/cbm' },
    { name: 'work-sb-p1', root_path: '/work/sb/p1' },
  ] });
  setup({ db, client, cbmDir: () => '/work/app/cbm' });
  settingsWith(db, 'p1', { enabled: true, names: { '/work/sb/p1': 'work-sb-p1' }, indexed: { '/work/sb/p1': true } });
  const r = await knowledge.sweepOrphans();
  assert.equal(r.deleted, 1);
  assert.deepEqual(world.graphs.map(g => g.name), ['work-sb-p1']);
  const lists = client.calls.filter(c => c.tool === 'list_projects').length;
  await knowledge.sweepOrphans();
  assert.equal(client.calls.filter(c => c.tool === 'list_projects').length, lists, 'once only: CBM is not asked again');
});

// --- One file, one graph ---

test('an ignore pattern is anchored to the folder and escapes what .gitignore reads as special', () => {
  assert.equal(knowledge.ignorePattern('repos/api-wt'), '/repos/api-wt/');
  assert.equal(knowledge.ignorePattern('a b/[x]*?'), '/a b/\\[x\\]\\*\\?/');
  assert.equal(knowledge.ignorePattern('trail '), '/trail\\ /');
});

test('a folder with a graph of its own inside another is left out of that one through a block of its .cbmignore', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sb = path.join(root, 'sb', 'p1');
  const wt = path.join(sb, 'repos', 'api-wt');
  const api = path.join(root, 'api');
  const nested = path.join(api, 'libs', 'auth');
  for (const d of [wt, nested]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(sb, '.cbmignore'), '# the user\'s own\n*.log\n');
  const db = fakeDb();
  db.addProject('p1', { root: sb, folders: [api, { path: wt, mode: 'worktree', sourcePath: api, branch: 'wt' }, nested] });
  const { client } = cbmWorld();
  setup({ db, client });
  settingsWith(db, 'p1', { enabled: true });
  for (const f of [wt, nested, api, sb]) await knowledge.index('p1', f, { wait: true });
  await knowledge.reconcileExclusions();
  await until(() => !client.calls.some(c => false), 'settled');
  const rootIgnore = fs.readFileSync(path.join(sb, '.cbmignore'), 'utf8');
  assert.match(rootIgnore, /^# the user's own\n\*\.log\n\n# switchboard:managed start/);
  assert.match(rootIgnore, /\n\/repos\/api-wt\/\n# switchboard:managed end\n$/, 'the block is last');
  assert.equal(fs.readFileSync(path.join(api, '.cbmignore'), 'utf8').includes('/libs/auth/'), true);
  assert.deepEqual(knowledge.foldersToLeaveOut(api), ['libs/auth']);
  // The child's graph goes: the folder around it takes its files back, and is read again.
  const before = client.calls.length;
  await knowledge.deleteIndex('p1', nested);
  await knowledge.reconcileExclusions();
  assert.equal(fs.existsSync(path.join(api, '.cbmignore')), false, 'a file only the block was in goes');
  await until(() => client.calls.slice(before).some(c => c.tool === 'index_repository' && c.args.repo_path === api && !c.args.status), 'the parent read again');
  assert.match(fs.readFileSync(path.join(sb, '.cbmignore'), 'utf8'), /\/repos\/api-wt\//);
});

test('a folder without a graph stays in the graph around it, whichever project has it', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = path.join(root, 'api');
  const child = path.join(api, 'child');
  fs.mkdirSync(child, { recursive: true });
  const db = fakeDb();
  db.addProject('a', { folders: [api] });
  db.addProject('b', { folders: [child] });
  const { client } = cbmWorld();
  setup({ db, client });
  await knowledge.index('a', api, { wait: true });
  await knowledge.reconcileExclusions();
  assert.equal(fs.existsSync(path.join(api, '.cbmignore')), false, 'the child has no graph yet');
  await knowledge.index('b', child, { wait: true });
  await knowledge.reconcileExclusions();
  assert.match(fs.readFileSync(path.join(api, '.cbmignore'), 'utf8'), /\/child\//, 'its graph in project b is the one that holds it');
});

test('a .cbmignore that is a link, or that the repository tracks, is left alone and the overlap reported', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = path.join(root, 'api');
  const web = path.join(root, 'web');
  for (const d of [path.join(api, 'child'), path.join(web, 'child')]) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(web, '.git'));
  fs.writeFileSync(path.join(root, 'elsewhere'), 'x\n');
  fs.symlinkSync(path.join(root, 'elsewhere'), path.join(api, '.cbmignore'));
  fs.writeFileSync(path.join(web, '.cbmignore'), 'tracked\n');
  const db = fakeDb();
  db.addProject('p1', { folders: [api, path.join(api, 'child'), web, path.join(web, 'child')] });
  const { client } = cbmWorld();
  // git says the web .cbmignore is tracked.
  setup({ db, client, runGit: async (cwd, args) => (args[0] === 'ls-files' && cwd === web ? '.cbmignore\n' : null) });
  for (const f of [path.join(api, 'child'), path.join(web, 'child'), api, web]) await knowledge.index('p1', f, { wait: true });
  await knowledge.reconcileExclusions();
  assert.equal(fs.readFileSync(path.join(root, 'elsewhere'), 'utf8'), 'x\n');
  assert.equal(fs.readFileSync(path.join(web, '.cbmignore'), 'utf8'), 'tracked\n');
  // Both pairs overlap: the links leave each child out of its parent's targets.
  client.calls.length = 0;
  await knowledge.linkCrossRepo('p1');
  const fromApi = client.calls.find(c => c.args.mode === 'cross-repo-intelligence' && c.args.repo_path === api);
  const names = knowledge.settingsFor('p1').names;
  assert.ok(!fromApi.args.target_projects.includes(names[path.join(api, 'child')]));
  assert.ok(fromApi.args.target_projects.includes(names[web]));
});

test('a .cbmignore the app makes in a repository is kept out of git', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = repo(path.join(root, 'api'));
  fs.mkdirSync(path.join(api, 'child'));
  const db = fakeDb();
  db.addProject('p1', { folders: [api, path.join(api, 'child')] });
  const { client } = cbmWorld();
  knowledge.init({ db, log: quiet, projects: fakeProjects(db), client, locator: fakeLocator, emit() {}, timers: { setTimeout: (fn) => { setImmediate(fn); return 1; }, clearTimeout() {} }, now: () => 1000 });
  await knowledge.index('p1', path.join(api, 'child'), { wait: true });
  await knowledge.index('p1', api, { wait: true });
  assert.match(fs.readFileSync(path.join(api, '.cbmignore'), 'utf8'), /\/child\//);
  assert.match(fs.readFileSync(path.join(api, '.git', 'info', 'exclude'), 'utf8'), /^\/\.cbmignore$/m);
  assert.equal(git(api, 'status', '--porcelain', '--untracked-files=all').includes('.cbmignore'), false);
});

test('a folder inside another that leaves its last project loses its graph: the one around it takes it back', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = path.join(root, 'api');
  const child = path.join(api, 'child');
  const other = path.join(root, 'other');
  for (const d of [child, other]) fs.mkdirSync(d, { recursive: true });
  const db = fakeDb();
  db.addProject('p1', { folders: [api, child, other] });
  const { client, world } = cbmWorld();
  setup({ db, client });
  for (const f of [child, api, other]) await knowledge.index('p1', f, { wait: true });
  await knowledge.reconcileExclusions();
  assert.match(fs.readFileSync(path.join(api, '.cbmignore'), 'utf8'), /\/child\//);
  db.rows.folders = db.rows.folders.filter(f => f.path !== child && f.path !== other);
  knowledge.folderChanged({ projectId: 'p1', folder: { path: child, mode: 'in-place' }, change: 'detached' });
  knowledge.folderChanged({ projectId: 'p1', folder: { path: other, mode: 'in-place' }, change: 'detached' });
  await until(() => !world.graphs.some(g => g.root_path === child), 'the child graph deleted');
  await knowledge.reconcileExclusions();
  assert.equal(fs.existsSync(path.join(api, '.cbmignore')), false);
  assert.ok(world.graphs.some(g => g.root_path === other), 'a folder inside no other keeps its graph, as before');
});

// --- Cross-repo links ---

test('a link goes on past a folder that fails, and the brief says which folder it could not read', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: ['/work/api', '/work/web', '/work/jobs'] });
  const { client } = cbmWorld({ failLink: (args) => args.repo_path === '/work/web' });
  setup({ db, client });
  settingsWith(db, 'p1', { enabled: true });
  for (const f of ['/work/api', '/work/web', '/work/jobs']) await knowledge.index('p1', f, { wait: true, kind: 'refresh' });
  const r = await knowledge.linkCrossRepo('p1');
  assert.equal(r.linked, 2);
  assert.deepEqual(Object.keys(r.errors), ['/work/web']);
  assert.match(knowledge.briefSection('p1'), /The last link could not read `\/work\/web`/);
});

// --- Repositories inside a folder ---

test('repositories inside a folder: submodules, clones and checkouts of other repositories, not its own worktrees', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const libSource = repo(path.join(root, 'lib-source'), { 'lib.js': 'module.exports = 2;\n' });
  const other = repo(path.join(root, 'other'), { 'o.js': '1;\n' });
  const parent = repo(path.join(root, 'parent'), { 'main.js': '1;\n', '.gitignore': 'vendor-tool/\n' });
  git(parent, 'submodule', 'add', '-q', libSource, 'libs/shared lib');
  git(parent, 'commit', '-qm', 'submodule');
  repo(path.join(parent, 'tools', 'cloned'));
  repo(path.join(parent, 'vendor-tool'));
  git(parent, 'worktree', 'add', '-q', path.join(parent, '.claude', 'worktrees', 'feature'), '-b', 'feature');
  git(other, 'worktree', 'add', '-q', path.join(parent, 'checkouts', 'other-wt'), '-b', 'wt');
  fs.mkdirSync(path.join(parent, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(parent, 'node_modules', 'pkg', '.git'));
  const db = fakeDb();
  db.addProject('p1', { folders: [parent] });
  knowledge.init({ db, log: quiet, projects: fakeProjects(db), client: cbmWorld().client, locator: fakeLocator, emit() {}, now: () => 1000 });
  const { modules, limited } = await knowledge.findModules(parent);
  assert.equal(limited, false);
  assert.deepEqual(modules, [
    { rel: 'checkouts/other-wt', kind: 'checkout' },
    { rel: 'libs/shared lib', kind: 'submodule' },
    { rel: 'tools/cloned', kind: 'clone' },
    { rel: 'vendor-tool', kind: 'clone' },
  ]);
});

test('modules says where each repository inside is: in the graph, out of it, or in a graph of its own', async (t) => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = path.join(root, 'parent');
  for (const d of ['in-repo', 'ignored', 'attached']) {
    fs.mkdirSync(path.join(parent, d), { recursive: true });
    fs.mkdirSync(path.join(parent, d, '.git'));
  }
  const db = fakeDb();
  db.addProject('p1', { root: path.join(root, 'sb'), folders: [parent, path.join(parent, 'attached')] });
  const coverage = (args) => ({ scopes: args.scopes.map(scope => (scope === 'ignored'
    ? { requested_scope: scope, scope, total: 1, entries: [{ path: 'ignored', kind: 'not_indexed_dir', detail: 'excluded subtree' }] }
    : { requested_scope: scope, scope, total: 3, entries: [{ path: `${scope}/.git`, kind: 'not_indexed_dir' }, { path: `${scope}/gen`, kind: 'not_indexed_dir' }, { path: `${scope}/x.sql`, kind: 'parse_partial' }] })) });
  const { client } = cbmWorld({ coverage });
  const briefs = [];
  setup({ db, client, syncBrief: async (id) => { briefs.push(id); } });
  settingsWith(db, 'p1', { enabled: true });
  await knowledge.index('p1', path.join(parent, 'attached'), { wait: true });
  await knowledge.index('p1', parent, { wait: true });
  const r = await knowledge.modules('p1', parent);
  const byRel = Object.fromEntries(r.modules.map(m => [m.rel, m]));
  assert.equal(byRel['in-repo'].state, 'in');
  assert.equal(byRel['in-repo'].gaps, 2, 'its own .git is no gap');
  assert.equal(byRel.ignored.state, 'out');
  assert.equal(byRel.attached.state, 'own');
  assert.equal(byRel.attached.graph, knowledge.settingsFor('p1').names[path.join(parent, 'attached')]);
  const coverageCall = client.calls.filter(c => c.tool === 'check_index_coverage').at(-1);
  assert.deepEqual(coverageCall.args.scopes.sort(), ['ignored', 'in-repo'], 'a module with a graph of its own is not asked about');
  // The brief routes each one.
  const brief = knowledge.briefSection('p1');
  assert.match(brief, new RegExp(`\\| \`${path.join(parent, 'in-repo').replace(/[/\\]/g, '.')}\` \\(repository inside \`parent\`\\) \\| in \`parent\` \\|`));
  assert.match(brief, /ignored` \(repository inside `parent`\) \| not indexed: read its files directly \|/);
  assert.ok(!/attached` \(repository inside/.test(brief), 'a folder of the table is not listed twice');
});

// --- Graphs CBM made of subfolders ---

test('a graph CBM made of a subfolder is named in the status, and only such a graph can be deleted from the tab', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: ['/work/api'] });
  const { client, world } = cbmWorld({ graphs: [
    { name: 'api', root_path: '/work/api' },
    { name: 'work-api-backend', root_path: '/work/api/backend' },
    { name: 'work-sb-p1-tools-x', root_path: '/work/sb/p1/tools/x' },
    { name: 'elsewhere', root_path: '/work/other' },
  ] });
  setup({ db, client });
  const st = await knowledge.status('p1');
  const byPath = Object.fromEntries(st.folders.map(f => [f.path, f.inner.map(g => [g.name, g.rel])]));
  assert.deepEqual(byPath['/work/api'], [['work-api-backend', 'backend']]);
  assert.deepEqual(byPath['/work/sb/p1'], [['work-sb-p1-tools-x', 'tools/x']]);
  await assert.rejects(knowledge.deleteInnerGraph('p1', '/work/api', 'elsewhere'), /not one inside this folder/);
  await assert.rejects(knowledge.deleteInnerGraph('p1', '/work/api', 'api'), /not one inside this folder/);
  await knowledge.deleteInnerGraph('p1', '/work/api', 'work-api-backend');
  assert.deepEqual(world.graphs.map(g => g.name).sort(), ['api', 'elsewhere', 'work-sb-p1-tools-x']);
});

// --- The brief ---

test('the brief is a routing table: the project folder, a file to its innermost folder, and how to read without opening files at random', async () => {
  const db = fakeDb();
  db.addProject('p1', { root: '/work/sb/p1', folders: ['/work/api', { path: '/work/sb/p1/repos/api-wt', mode: 'worktree', sourcePath: '/work/api', branch: 'feat' }] });
  const { client } = cbmWorld();
  setup({ db, client });
  settingsWith(db, 'p1', { enabled: true });
  for (const f of ['/work/sb/p1', '/work/api', '/work/sb/p1/repos/api-wt']) await knowledge.index('p1', f, { wait: true, kind: 'refresh' });
  const brief = knowledge.briefSection('p1');
  assert.match(brief, /\| `\/work\/sb\/p1` \(project folder: plans, notes, tools\) \| `work-sb-p1` \|/);
  assert.match(brief, /\| `\/work\/api` \| `api` \|/);
  assert.match(brief, /the one of the innermost folder of this table that holds it/);
  assert.match(brief, /Pass that graph's name as `project` to every CBM tool/);
  assert.match(brief, /1\. `search_graph`.*\n2\. `trace_path`.*\n3\. `get_code_snippet`.*\n4\. `check_index_coverage`/);
  assert.match(brief, /A symbol another folder defines is in that folder's graph, not missing from yours/);
  assert.match(brief, /for a symbol whose folder you do not know, in each code folder's graph of the table/);
  assert.match(brief, /A call from one folder into another's code .* is not an edge of either graph: find its callers with `search_code`/);
  assert.match(brief, /Sessions start in the project folder, so CBM's own hints .* point at `work-sb-p1`: that graph holds plans, notes and tools, not the code. Look for code in the other graphs of this table first\./);
  assert.match(brief, /Grep, glob or read whole files only for what the graphs cannot answer/);
  assert.match(brief, /A worktree has a graph of its own/);
});

test('the routing check reads the brief the way the agents do', async (t) => {
  const { parseTable } = require('../scripts/knowledge-routing-check');
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = path.join(root, 'parent');
  for (const d of ['in-repo', 'ignored']) fs.mkdirSync(path.join(parent, d, '.git'), { recursive: true });
  const db = fakeDb();
  db.addProject('p1', { root: path.join(root, 'sb'), folders: [parent] });
  const coverage = (args) => ({ scopes: args.scopes.map(scope => (scope === 'ignored'
    ? { requested_scope: scope, total: 1, entries: [{ path: 'ignored', kind: 'not_indexed_dir' }] }
    : { requested_scope: scope, total: 0, entries: [] })) });
  const { client } = cbmWorld({ coverage });
  setup({ db, client });
  settingsWith(db, 'p1', { enabled: true });
  await knowledge.index('p1', path.join(root, 'sb'), { wait: true });
  await knowledge.index('p1', parent, { wait: true });
  await knowledge.modules('p1', parent);
  const { graphs, modules } = parseTable(knowledge.briefSection('p1'));
  const names = knowledge.settingsFor('p1').names;
  assert.deepEqual(graphs.map(g => [g.folder, g.name]), [[path.join(root, 'sb'), names[path.join(root, 'sb')]], [parent, names[parent]]]);
  assert.deepEqual(modules.map(m => [m.path, m.where, m.graph]), [[path.join(parent, 'ignored'), 'out', null], [path.join(parent, 'in-repo'), 'in', names[parent]]]);
});
