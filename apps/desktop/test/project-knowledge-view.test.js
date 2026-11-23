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
  vm.runInContext(`${escapeAttrSource}\n${source}\nthis.api = { knState, knFolder, knRelPath, knGateHtml, knGateSignature, knSubnavHtml, knTableHtml, knFolderCardHtml, knStatusSignature, knowledgeTabs };`, context);
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
  assert.equal(api.knFolder(project([]), api.knState(project([]))), null);
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
  const none = project([]);
  const sn = api.knState(none);
  sn.status = { binary: BIN, folders: [] };
  assert.match(api.knGateHtml(none, sn, null), /No folders to index/);
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
