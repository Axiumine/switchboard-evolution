// project-knowledge-view.js: which folder the tab shows, its states (no CBM,
// a folder without a graph, a job running), file paths for the Files tab, and
// hostile names in the markup. The file runs in a vm context with the shared
// KnowledgeModel, the app's escapeAttr and an escapeHtml like the app's
// (text only: quotes stay as they are).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/project-knowledge-view.js'), 'utf8');
const utils = fs.readFileSync(path.join(__dirname, '../public/utils.js'), 'utf8');
const escapeAttrSource = utils.slice(utils.indexOf('function escapeAttr('), utils.indexOf('\n}\n', utils.indexOf('function escapeAttr(')) + 3);
const KnowledgeModel = require('../public/knowledge-model');

function load() {
  const icon = (name) => () => `<i:${name}>`;
  const context = vm.createContext({
    KnowledgeModel,
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    PICONS: new Proxy({}, { get: (_t, name) => icon(String(name)) }),
    pathBasename: (p) => String(p).split('/').filter(Boolean).pop() || p,
    window: {},
    console,
  });
  vm.runInContext(`${escapeAttrSource}\n${source}\nthis.api = { knState, knFolder, knFolders, knRelPath, knGateHtml, knGateSignature, knSubnavHtml, knTableHtml, knFolderCardHtml, knStatusSignature, knowledgeTabs };`, context);
  return context.api;
}

const project = (folders) => ({ id: 'p1', root: '/work/proj', folders: folders.map(p => ({ path: p, mode: 'in-place' })) });
const BIN = { found: { path: '/opt/cbm', version: '0.12.1', source: 'agents', ok: true }, minimum: '0.12.1', pinned: '0.12.1', canDownload: true, installDir: '/home/u/.local/bin' };
const ready = (p, name, nodes = 10) => ({ path: p, name, indexed: true, index: { status: 'ready', nodes, edges: nodes * 2, indexed_at: '2026-01-02T03:04:05Z' }, job: null });

test('the tab shows the folder picked, else the first indexed one, else the first', () => {
  const api = load();
  const proj = project(['/work/api', '/work/web']);
  const s = api.knState(proj);
  assert.equal(api.knFolder(proj, s), '/work/api');
  s.status = { binary: BIN, folders: [{ path: '/work/api', indexed: false }, ready('/work/web', 'web')] };
  assert.equal(api.knFolder(proj, s), '/work/web');
  s.folder = '/work/api';
  assert.equal(api.knFolder(proj, s), '/work/api');
  s.folder = '/gone';
  assert.equal(api.knFolder(proj, s), '/work/web', 'a detached folder falls back');
  const empty = { id: 'p-empty', root: '/work/proj', folders: [] };
  assert.equal(api.knFolder(empty, api.knState(empty)), '/work/proj', 'nothing attached: the project folder');
  const bare = { id: 'p-bare', folders: [] };
  assert.equal(api.knFolder(bare, api.knState(bare)), null);
});

test('paths for the Files tab are relative to the folder; other absolute paths are refused', () => {
  const api = load();
  assert.equal(api.knRelPath('/work/api', 'src/a.js'), 'src/a.js');
  assert.equal(api.knRelPath('/work/api/', '/work/api/src/a.js'), 'src/a.js');
  assert.equal(api.knRelPath('/work/api', '/etc/passwd'), null);
  assert.equal(api.knRelPath('/work/api', '/work/api-other/x.js'), null);
  assert.equal(api.knRelPath('/work/api', ''), null);
});

test('without codebase-memory-mcp the tab offers the download, the program and the releases', () => {
  const api = load();
  const proj = project(['/work/api']);
  const s = api.knState(proj);
  assert.match(api.knGateHtml(proj, s, '/work/api'), /Looking for codebase-memory-mcp/);
  s.status = { binary: { ...BIN, found: null }, folders: [] };
  const html = api.knGateHtml(proj, s, '/work/api');
  assert.match(html, /needs codebase-memory-mcp/);
  assert.match(html, /data-kn-act="download"/);
  assert.match(html, /Download and install 0\.12\.1/);
  assert.match(html, /data-kn-act="pick-binary"/);
  s.status = { binary: { ...BIN, found: { ...BIN.found, version: '0.11.0', ok: false } }, folders: [] };
  assert.match(api.knGateHtml(proj, s, '/work/api'), /0\.11\.0 is too old/);
  s.status = { binary: { ...BIN, found: null, download: { step: 'verify', error: null } }, folders: [] };
  const busy = api.knGateHtml(proj, s, '/work/api');
  assert.match(busy, /Checking the download/);
  assert.doesNotMatch(busy, /data-kn-act="download"/, 'no second download while one runs');
});

test('a folder without a graph asks to index it; a running job says so; an indexed one opens the view', () => {
  const api = load();
  const proj = project(['/work/api', '/work/web']);
  const s = api.knState(proj);
  s.status = { binary: BIN, settings: { mode: 'moderate' }, folders: [{ path: '/work/api', indexed: false, job: null }, ready('/work/web', 'web')] };
  const ask = api.knGateHtml(proj, s, '/work/api');
  assert.match(ask, /has no code graph yet/);
  assert.match(ask, /<option value="moderate" selected>/);
  assert.match(ask, /Index every folder/);
  s.status.folders[0].job = { state: 'running', kind: 'index' };
  assert.match(api.knGateHtml(proj, s, '/work/api'), /Indexing…/);
  s.status.folders[0].job = { state: 'failed', error: 'disk full' };
  assert.match(api.knGateHtml(proj, s, '/work/api'), /Indexing failed: disk full/);
  assert.equal(api.knGateHtml(proj, s, '/work/web'), null);
  s.status.folders[1].job = { state: 'running', kind: 'refresh' };
  assert.equal(api.knGateHtml(proj, s, '/work/web'), null, 'a refresh of a graph there leaves the view on screen');
  s.status.folders[1].job = null;
  s.view = 'settings';
  assert.equal(api.knGateHtml(proj, s, '/work/api'), null, 'Settings opens even before a first index');
  // A project with no attached folder still has its project folder to index.
  const none = { id: 'p-none', root: '/work/proj', folders: [] };
  const sn = api.knState(none);
  sn.status = { binary: BIN, folders: [{ path: '/work/proj', mode: 'project', indexed: false, job: null }] };
  assert.match(api.knGateHtml(none, sn, '/work/proj'), /has no code graph yet/);
  // An old project row without a folder of its own and nothing attached has none.
  const bare = { id: 'p9', folders: [] };
  const sb = api.knState(bare);
  sb.status = { binary: BIN, folders: [] };
  assert.match(api.knGateHtml(bare, sb, null), /No folders to index/);
});

test('the project folder is listed first as "Project folder", but the tab opens on the code', () => {
  const api = load();
  const proj = project(['/work/api', '/work/web']);
  const s = api.knState(proj);
  // Before the status comes: the project folder, then the attached ones; the first attached one shown.
  assert.deepEqual(JSON.parse(JSON.stringify(api.knFolders(proj).map(f => [f.path, f.mode]))), [['/work/proj', 'project'], ['/work/api', 'in-place'], ['/work/web', 'in-place']]);
  assert.equal(api.knFolder(proj, s), '/work/api');
  s.status = { binary: BIN, folders: [{ ...ready('/work/proj', 'work-proj'), mode: 'project' }, { path: '/work/api', mode: 'in-place', indexed: false }, { ...ready('/work/web', 'web'), mode: 'in-place' }] };
  assert.equal(api.knFolder(proj, s), '/work/web', 'the first attached folder with a graph');
  s.status.folders[2].indexed = false;
  assert.equal(api.knFolder(proj, s), '/work/proj', 'else the project folder\'s graph');
  const bar = api.knSubnavHtml(proj, s);
  assert.match(bar, /<option value="\/work\/proj"[^>]*>Project folder<\/option>/);
  const card = api.knFolderCardHtml(proj, s, s.status.folders[0]);
  assert.match(card, /<span class="ws-card-title" title="\/work\/proj">Project folder<\/span>/);
  assert.match(card, />project folder<\/span>/);
  s.status.folders[0].inner = [{ name: 'work-proj-tools', path: '/work/proj/tools', rel: 'tools' }];
  assert.match(api.knFolderCardHtml(proj, s, s.status.folders[0]), /1 other graph of folders inside it repeats part of this one/);
});

test('the view bar lists the views drawn, the folders and the folder\'s size', () => {
  const api = load();
  const proj = project(['/work/api', '/work/web']);
  const s = api.knState(proj);
  s.status = { binary: BIN, folders: [ready('/work/api', 'api', 1234), { path: '/work/web', indexed: false }] };
  const html = api.knSubnavHtml(proj, s);
  assert.match(html, /data-kn-view="overview"/);
  assert.match(html, /data-kn-view="settings"/);
  assert.match(html, /<select class="ws-select kn-folder-select"/);
  assert.match(html, /web \(not indexed\)/);
  assert.match(html, /1,234 nodes · 2,468 links/);
  assert.match(html, /data-kn-act="reindex"/);
});

test('hostile names stay text, in content and in attributes', () => {
  const api = load();
  const evil = '/work/"><img src=x onerror=alert(1)>';
  const proj = project([evil]);
  const s = api.knState(proj);
  s.status = { binary: BIN, folders: [{ ...ready(evil, 'x"><b>'), path: evil }] };
  for (const html of [api.knSubnavHtml(proj, s), api.knFolderCardHtml(proj, s, proj.folders[0])]) {
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /<b>/);
    assert.doesNotMatch(html, /="[^"]*"><img/);
  }
  const table = api.knTableHtml(['qn', 'file'], [{ qn: 'shop.x.\'<script>\'', file: '"><svg onload=1>' }], { qnColumn: 'qn' });
  assert.doesNotMatch(table, /<script>|<svg/);
  assert.match(table, /&lt;script&gt;/);
});

test('the status signature moves with what the tab shows, not with the rest', () => {
  const api = load();
  const a = { binary: BIN, client: { running: true }, settings: { mode: 'full' }, folders: [ready('/work/api', 'api')] };
  const same = JSON.parse(JSON.stringify(a));
  same.folders[0].index.extra = 'ignored';
  assert.equal(api.knStatusSignature(a), api.knStatusSignature(same));
  const moved = JSON.parse(JSON.stringify(a));
  moved.folders[0].job = { state: 'running' };
  assert.notEqual(api.knStatusSignature(a), api.knStatusSignature(moved));
});


test('a refresh of an indexed folder changes the bar, not what decides the view', () => {
  const api = load();
  const proj = project(['/work/api']);
  const s = api.knState(proj);
  s.view = 'search';
  s.status = { binary: BIN, folders: [ready('/work/api', 'api')] };
  const before = api.knGateSignature(proj, s);
  s.status.folders[0].job = { state: 'running', kind: 'refresh', mode: 'full' };
  assert.equal(api.knGateSignature(proj, s), before);
  assert.match(api.knSubnavHtml(proj, s), /kn-busy/);
  s.status.folders[0].indexed = false;
  assert.notEqual(api.knGateSignature(proj, s), before, 'a graph gone is a new page');
});

test('a worktree folder is marked as one, with its repository and branch, in the picker and on its card', () => {
  const api = load();
  const proj = { id: 'p1', root: '/work/proj', folders: [
    { path: '/work/api', mode: 'in-place' },
    { path: '/work/api.worktrees/feat-login', mode: 'worktree', sourcePath: '/work/api', branch: 'feat/"login"' },
  ] };
  const s = api.knState(proj);
  s.status = { binary: BIN, folders: [ready('/work/api', 'api'), ready('/work/api.worktrees/feat-login', 'api-wt-feat-login')] };
  const nav = api.knSubnavHtml(proj, s);
  assert.match(nav, /<option value="\/work\/api\.worktrees\/feat-login">feat-login · worktree<\/option>/);
  assert.match(nav, /<option value="\/work\/api" selected>api<\/option>/);
  const card = api.knFolderCardHtml(proj, s, proj.folders[1]);
  assert.match(card, /<span class="kn-label kn-label--muted" title="Worktree of \/work\/api, branch feat\/&quot;login&quot;\. Its code graph is its own[^"]*">worktree<\/span>/);
  assert.doesNotMatch(api.knFolderCardHtml(proj, s, proj.folders[0]), />worktree</);
});
