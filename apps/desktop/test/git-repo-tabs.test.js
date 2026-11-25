const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/git-repo-tabs.js'), 'utf8');

function load() {
  const context = vm.createContext({
    RepoColors: require('../public/repo-colors'),
    RepoSelection: require('../public/repo-selection'),
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    escapeAttr: (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    pathBasename: (p) => String(p).split('/').filter(Boolean).pop() || '',
  });
  vm.runInContext(source, context);
  return context;
}

const repos = [{ path: '/code/api' }, { path: '/code/web' }, { path: '/code/docs' }];

test('one repository or none: no tabs', () => {
  const ctx = load();
  assert.equal(ctx.gitRepoTabsHtml([], { primary: null, paths: [] }, { multi: true }), '');
  assert.equal(ctx.gitRepoTabsHtml([repos[0]], { primary: '/code/api', paths: ['/code/api'] }, { multi: true }), '');
});

test('a view of one repository at a time has names only', () => {
  const ctx = load();
  const html = ctx.gitRepoTabsHtml(repos, { primary: '/code/web', paths: ['/code/web'] }, { multi: false });
  assert.doesNotMatch(html, /gg-repo-check/);
  assert.doesNotMatch(html, /gg-repo-picker--multi/);
  assert.equal([...html.matchAll(/class="gg-repo-name"/g)].length, 3);
  assert.match(html, /<div class="gg-repo-option active primary" data-index="1"><button type="button" class="gg-repo-name" data-index="1" role="tab" aria-selected="true" title="\/code\/web">web<\/button><\/div>/);
});

test('a view of several repositories puts a checkbox before each name, outside the button', () => {
  const ctx = load();
  const colors = ctx.gitRepoColors({ folders: repos }, repos);
  const html = ctx.gitRepoTabsHtml(repos, { primary: '/code/api', paths: ['/code/api', '/code/docs'] }, { multi: true, colors });
  assert.match(html, /class="gg-repo-picker gg-repo-picker--multi is-multi"/);
  assert.match(html, /aria-multiselectable="true"/);
  const tabs = html.split('<div class="gg-repo-option').slice(1);
  assert.equal(tabs.length, 3);
  assert.match(tabs[0], /^ active checked primary" data-index="0" style="--repo-color:#[0-9a-f]{6}"><input type="checkbox" class="gg-repo-check" data-index="0" checked aria-label="Hide api"/);
  assert.match(tabs[1], /^" data-index="1" style="--repo-color:#[0-9a-f]{6}"><input type="checkbox" class="gg-repo-check" data-index="1" aria-label="Also show web"/);
  assert.match(tabs[2], /^ active checked" data-index="2"/);
  for (const tab of tabs) assert.ok(tab.indexOf('gg-repo-check') < tab.indexOf('<button'), 'the checkbox is not in the button');
  assert.equal(new Set(Object.values(colors)).size, 3);
});

test('a name shows that repository alone; a checkbox adds or takes one away', () => {
  const ctx = load();
  const state = { selectedRepo: '/code/api', selectedRepos: ['/code/api'] };
  assert.equal(ctx.gitRepoToggle(state, repos, repos[2]), true);
  assert.deepEqual([...state.selectedRepos], ['/code/api', '/code/docs']);
  assert.equal(state.selectedRepo, '/code/api');
  assert.equal(ctx.gitIsMultiRepo(state, repos), true);
  assert.deepEqual(ctx.gitShownRepos(state, repos).map((r) => r.path), ['/code/api', '/code/docs']);
  assert.equal(ctx.gitRepoSelectOnly(state, repos, repos[1]), true);
  assert.deepEqual([...state.selectedRepos], ['/code/web']);
  assert.equal(state.selectedRepo, '/code/web');
  assert.equal(ctx.gitRepoSelectOnly(state, repos, repos[1]), false, 'already alone');
  assert.equal(ctx.gitRepoToggle(state, repos, repos[1]), false, 'the last one stays');
});

test('a view that never had a selection shows its primary, or the first repository', () => {
  const ctx = load();
  assert.deepEqual(ctx.gitShownRepos({ selectedRepo: '/code/web' }, repos).map((r) => r.path), ['/code/web']);
  assert.deepEqual(ctx.gitShownRepos({}, repos).map((r) => r.path), ['/code/api']);
});

test('the wiring calls onOnly for a name and onToggle for a checkbox, and puts back a refused tick', () => {
  const ctx = load();
  const names = [0, 1].map((i) => ({ dataset: { index: String(i) } }));
  const boxes = [0, 1].map((i) => ({ dataset: { index: String(i) }, checked: false }));
  const container = { querySelectorAll: (sel) => (sel === '.gg-repo-name' ? names : boxes) };
  const calls = [];
  ctx.gitWireRepoTabs(container, repos, {
    onOnly: (repo) => calls.push(['only', repo.path]),
    onToggle: (repo) => { calls.push(['toggle', repo.path]); return repo.path !== '/code/web'; },
  });
  names[1].onclick();
  let stopped = false;
  boxes[0].checked = true;
  boxes[0].onclick({ stopPropagation: () => { stopped = true; } });
  boxes[1].checked = false;
  boxes[1].onclick({ stopPropagation() {} });
  assert.deepEqual(calls, [['only', '/code/web'], ['toggle', '/code/api'], ['toggle', '/code/web']]);
  assert.equal(stopped, true);
  assert.equal(boxes[0].checked, true);
  assert.equal(boxes[1].checked, true, 'a refused untick is put back');
});
