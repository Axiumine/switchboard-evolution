// knowledge.js with the real codebase-memory-mcp, only when asked:
//   SWITCHBOARD_TEST_CBM=1 node --test test/knowledge-real.test.js
// It uses the CBM found on this computer and its normal cache (CBM refuses a
// second cache folder while the agents' sessions use it), indexes a throwaway
// repository under a unique name, asks it a few things, and deletes the index.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const cbmLocator = require('../cbm-locator');
const { createCbmClient } = require('../cbm-client');
const knowledge = require('../knowledge');
const { buildPtyEnv } = require('../pty-env');

const found = process.env.SWITCHBOARD_TEST_CBM === '1' ? cbmLocator.locateCbm() : null;
const skip = process.env.SWITCHBOARD_TEST_CBM !== '1' ? 'set SWITCHBOARD_TEST_CBM=1 to run against the real codebase-memory-mcp'
  : !found?.ok ? 'no codebase-memory-mcp recent enough on this computer' : false;

test('index, query, trace and delete a throwaway repository', { skip, timeout: 180000 }, async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kn-real-')));
  const repo = path.join(root, `kn-real-${process.pid}`);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'auth.js'), [
    'function checkPassword(user, password) { return user.hash === hash(password); }',
    'function hash(text) { return String(text).split("").reverse().join(""); }',
    'function login(user, password) { if (!checkPassword(user, password)) throw new Error("no"); return { user }; }',
    'module.exports = { login };',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'src', 'server.js'), 'const { login } = require("./auth");\nfunction handle(req) { return login(req.user, req.password); }\nmodule.exports = { handle };\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });

  const rows = { settings: new Map() };
  const db = {
    getSetting: (k) => rows.settings.get(k) ?? null,
    setSetting: (k, v) => rows.settings.set(k, JSON.parse(JSON.stringify(v))),
    listProjects: () => [{ id: 'p' }],
    getProject: (id) => (id === 'p' ? { id } : null),
    listProjectFolders: () => [{ projectId: 'p', path: repo, mode: 'in-place' }],
  };
  // As main.js starts it: in the home folder, which CBM never indexes (a session in `root` would make a graph of it).
  const client = createCbmClient({ locate: () => found, env: () => buildPtyEnv(process.env), cwd: os.homedir(), log: console });
  knowledge.init({
    db, log: console, client,
    projects: { requireAttachedFolder: (id, p) => { if (p !== repo) throw new Error('not attached'); return { path: p }; } },
  });
  let name = null;
  t.after(async () => {
    if (name) { try { await client.call('delete_project', { project: name }); } catch {} }
    client.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await knowledge.index('p', repo, { wait: true, mode: 'fast' });
  name = knowledge.settingsFor('p').names[repo];
  assert.ok(name && name.startsWith('kn-real-'), name);
  const st = await knowledge.status('p');
  assert.equal(st.folders[0].indexed, true);
  assert.equal(st.folders[0].index.status, 'ready');
  assert.equal(st.folders[0].job.state, 'succeeded');

  const found1 = await knowledge.query('p', repo, 'search_graph', { name_pattern: 'login', label: 'Function' });
  assert.ok(JSON.stringify(found1).includes('login'));
  const trace = await knowledge.query('p', repo, 'trace_path', { function_name: 'login', direction: 'both', depth: 2 });
  assert.ok(JSON.stringify(trace).includes('checkPassword'), JSON.stringify(trace).slice(0, 400));
  const snippet = await knowledge.query('p', repo, 'get_code_snippet', { qualified_name: 'checkPassword' });
  assert.match(snippet.source, /function checkPassword/);
  const adr = await knowledge.adr('p', repo, { mode: 'update', content: '# Decisions\n\n## Context\nA test.\n' });
  assert.ok(adr);
  const outline = await knowledge.adr('p', repo);
  assert.ok(JSON.stringify(outline).includes('Context'));

  await knowledge.deleteIndex('p', repo);
  const after = await knowledge.status('p');
  assert.equal(after.folders[0].indexed, false);
  name = null;
});

// One file, one graph, with the real CBM: the app's session makes no graph of
// where it starts; the project folder takes CBM's own name, so a session that
// starts there finds the same graph; a folder with a graph of its own is left
// out of the graph around it and taken back when its graph goes; the
// repositories inside a folder are in its graph unless its rules leave them out.
test('one file, one graph: the project folder, folders inside others, and repositories inside', { skip, timeout: 300000 }, async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kn-real-scope-')));
  const gitc = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'pipe' });
  const js = (dir, rel, fn) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), `function ${fn}(a) { return a; }\nmodule.exports = { ${fn} };\n`); };
  const mkrepo = (dir, files) => { for (const [rel, fn] of files) js(dir, rel, fn); gitc(dir, 'init', '-q'); gitc(dir, 'add', '.'); gitc(dir, 'commit', '-qm', 'init'); return dir; };
  const tag = `p${process.pid}`;
  const sb = path.join(root, 'sb');
  js(sb, 'tools/notes.js', `notes${tag}`);
  const api = mkrepo(path.join(root, 'api'), [['src/api.js', `apiMain${tag}`], ['libs/auth/auth.js', `authCheck${tag}`]]);
  const libSource = mkrepo(path.join(root, 'lib-source'), [['lib.js', `sharedLib${tag}`]]);
  fs.writeFileSync(path.join(api, '.gitignore'), 'vendor-tool/\n');
  gitc(api, 'submodule', 'add', '-q', libSource, 'libs/shared');
  gitc(api, 'add', '.');
  gitc(api, 'commit', '-qm', 'submodule');
  mkrepo(path.join(api, 'vendor-tool'), [['v.js', `vendorTool${tag}`]]);
  const child = path.join(api, 'libs', 'auth');

  const rows = { settings: new Map(), folders: [{ projectId: 'p', path: api, mode: 'in-place' }] };
  const db = {
    getSetting: (k) => rows.settings.get(k) ?? null,
    setSetting: (k, v) => rows.settings.set(k, JSON.parse(JSON.stringify(v))),
    deleteSetting: (k) => rows.settings.delete(k),
    listProjects: () => [{ id: 'p' }],
    getProject: (id) => (id === 'p' ? { id, root: sb } : null),
    listProjectFolders: () => rows.folders.slice(),
  };
  // As main.js starts it: in the home folder.
  const client = createCbmClient({ locate: () => found, env: () => buildPtyEnv(process.env), cwd: os.homedir(), log: console });
  knowledge.init({
    db, log: console, client,
    projects: { requireAttachedFolder: (id, p) => { const f = rows.folders.find(x => x.path === p); if (!f) throw new Error('not attached'); return f; } },
  });
  const graphsUnder = async () => ((await client.call('list_projects', { limit: 500 })).projects || []).filter(g => String(g.root_path).startsWith(root));
  t.after(async () => {
    for (const g of await graphsUnder().catch(() => [])) { try { await client.call('delete_project', { project: g.name }); } catch {} }
    // knowledge.js forgets its jobs and timers, so nothing calls (and restarts) the client after it stops.
    knowledge.init({ db: { getSetting: () => null, setSetting() {}, listProjects: () => [], getProject: () => null, listProjectFolders: () => [] }, log: console, client: { refresh: () => null, reset() {} }, projects: {} });
    client.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const files = async (folder) => {
    const name = knowledge.settingsFor('p').names[folder];
    const r = await client.call('query_graph', { project: name, query: 'MATCH (f:File) RETURN f.file_path LIMIT 500' });
    return (r.rows || []).map(x => (Array.isArray(x) ? x[0] : Object.values(x)[0])).sort();
  };

  const step = (what) => { if (process.env.KN_REAL_DEBUG) console.error(`[kn-real] ${what}`); };
  // The app's session started in the home folder: no graph of it.
  const home = ((await client.call('list_projects', { limit: 500 })).projects || []).filter(g => g.root_path === os.homedir());
  assert.deepEqual(home, []);

  // The project folder takes CBM's own name; a session that starts there finds that graph.
  step("await knowledge.index('p', sb, { wait: true, mode: 'fast' })");
  await knowledge.index('p', sb, { wait: true, mode: 'fast' });
  const sbName = knowledge.settingsFor('p').names[sb];
  assert.ok(sbName && sbName !== 'sb', sbName);
  const session = createCbmClient({ locate: () => found, env: () => buildPtyEnv(process.env), cwd: sb, log: console });
  await session.call('list_projects', { limit: 1 });
  await new Promise(r => setTimeout(r, 4000));
  session.stop();
  assert.deepEqual((await graphsUnder()).filter(g => g.root_path === sb).map(g => g.name), [sbName], 'one graph of the project folder');

  // The repositories inside: the submodule is in the graph, the clone its rules leave out is not.
  step("await knowledge.index('p', api, { wait: true, mode: 'fast' }");
  await knowledge.index('p', api, { wait: true, mode: 'fast' });
  assert.ok((await files(api)).includes('libs/shared/lib.js'));
  step("const mods = await knowledge.modules('p', api);");
  const mods = await knowledge.modules('p', api);
  const state = Object.fromEntries(mods.modules.map(m => [m.rel, m.state]));
  assert.equal(state['libs/shared'], 'in');
  assert.equal(state['vendor-tool'], 'out');

  // A folder inside, attached with a graph of its own, leaves the one around it; and comes back when its graph goes.
  assert.ok((await files(api)).includes('libs/auth/auth.js'));
  rows.folders.push({ projectId: 'p', path: child, mode: 'in-place' });
  step("await knowledge.index('p', child, { wait: true, mode: 'fast'");
  await knowledge.index('p', child, { wait: true, mode: 'fast' });
  await knowledge.reconcileExclusions();
  await knowledge.index('p', api, { wait: true, mode: 'fast', kind: 'refresh' });
  assert.ok(!(await files(api)).includes('libs/auth/auth.js'), 'left out of the parent');
  assert.ok((await files(child)).includes('auth.js'), 'in its own graph');
  step("await knowledge.deleteIndex('p', child);");
  await knowledge.deleteIndex('p', child);
  await knowledge.reconcileExclusions();
  await knowledge.index('p', api, { wait: true, mode: 'fast', kind: 'refresh' });
  assert.ok((await files(api)).includes('libs/auth/auth.js'), 'taken back');
});
