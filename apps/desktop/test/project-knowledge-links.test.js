// project-knowledge-links.js: the Node Knowledge tab reached from the Git
// tab's History menus and Changes heading, only for attached folders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

function load(projects) {
  const opened = [];
  const context = vm.createContext({
    KnowledgeModel: require('../public/knowledge-model'),
    escapeHtml: (s) => String(s), escapeAttr: (s) => String(s),
    PICONS: new Proxy({}, { get: () => () => '' }),
    pathBasename: (p) => String(p).split('/').pop(),
    findTreeProject: (id) => projects.find(p => p.id === id) || null,
    window: {},
    console,
  });
  vm.runInContext(`${read('project-knowledge-links.js')}
    function knOpenImpact(project, folder, against, ref) { opened.push([project.id, folder, against, ref]); }
    this.api = { knGitMenuItems, knIsAttached, knImpactButtonHtml };`, Object.assign(context, { opened }));
  return { api: context.api, opened };
}

test('History offers the impact of a commit or of the uncommitted changes, for attached folders only', () => {
  const project = { id: 'p1', folders: [{ path: '/work/api' }] };
  const { api, opened } = load([project]);
  const [commitItem] = api.knGitMenuItems({ projectId: 'p1', folderPath: '/work/api' }, 'commit', { hash: 'abc123' });
  assert.equal(commitItem.id, 'knowledgeImpact');
  commitItem.onClick();
  const [uncommitted] = api.knGitMenuItems({ projectId: 'p1', folderPath: '/work/api' }, 'uncommitted');
  uncommitted.onClick();
  assert.equal(JSON.stringify(opened), JSON.stringify([['p1', '/work/api', 'since', 'abc123'], ['p1', '/work/api', 'uncommitted', null]]));
  assert.equal(api.knGitMenuItems({ projectId: 'p1', folderPath: '/work/api/nested' }, 'commit', { hash: 'x' }).length, 0, 'a repository inside a folder is not one of the tab\'s');
  assert.equal(api.knGitMenuItems({ projectId: 'gone', folderPath: '/work/api' }, 'uncommitted').length, 0);
});

test('the Changes heading\'s Impact button is not a list/tree toggle', () => {
  const { api } = load([]);
  assert.doesNotMatch(api.knImpactButtonHtml(), /git-view-btn/);
  assert.match(api.knImpactButtonHtml(), /data-kn-act="git-impact"/);
});
