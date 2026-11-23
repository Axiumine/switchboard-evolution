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
  const client = createCbmClient({ locate: () => found, env: () => buildPtyEnv(process.env), cwd: root, log: console });
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
