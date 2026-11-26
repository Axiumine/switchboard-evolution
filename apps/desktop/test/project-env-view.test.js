const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Env tab's sidebar: the project folder and each attached folder with its
// local.env.sh, a + where there is none, a warning where Git would commit it,
// and the rules of what a session loads (env-files-model.js, shared with the phone).

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
// Arrays made inside the vm context have its prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `markers ${from} … ${to}`);
  return text.slice(start, end);
};

function loadTab() {
  const context = vm.createContext({
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    PICONS: { dashboard: () => '<svg data-icon="project"></svg>', folder: () => '<svg data-icon="folder"></svg>', plus: () => '<svg data-icon="plus"></svg>' },
    pathBasename: (p) => p.split('/').filter(Boolean).pop(),
    folderChipLabel: (project, folder) => folder.path.split('/').filter(Boolean).pop() + (folder.branch ? ` · ${folder.branch}` : ''),
    shortPathLabel: (p) => p.replace('/home/dev', '~'),
  });
  vm.runInContext(read('public/env-files-model.js'), context);
  vm.runInContext(between(read('public/utils.js'), 'function escapeAttr(', 'function shellEscape('), context);
  vm.runInContext(between(read('public/project-files-view.js'), 'function filesRoots(', 'function filesUi('), context);
  vm.runInContext(read('public/project-env-view.js'), context);
  return context;
}

const project = {
  id: 'p1', name: 'Demo', root: '/home/dev/Switchboard/demo',
  folders: [
    { path: '/home/dev/code/app', mode: 'in-place' },
    { path: '/home/dev/Switchboard/demo/repos/api', mode: 'worktree', branch: 'demo' },
    { path: '/home/dev/code/"odd" <name>', mode: 'in-place' },
  ],
};
const entries = [
  { path: project.root, kind: 'project', filePath: `${project.root}/local.env.sh`, exists: true, gitIgnored: null },
  { path: '/home/dev/code/app', kind: 'folder', filePath: '/home/dev/code/app/local.env.sh', exists: false, gitIgnored: false },
  { path: '/home/dev/Switchboard/demo/repos/api', kind: 'worktree', filePath: '/home/dev/Switchboard/demo/repos/api/local.env.sh', exists: true, gitIgnored: false },
  { path: '/home/dev/code/"odd" <name>', kind: 'folder', filePath: '/home/dev/code/"odd" <name>/local.env.sh', exists: true, gitIgnored: true },
];

test('the sidebar lists the project folder, then each attached folder in order, with the Files tab\'s labels', () => {
  const tab = loadTab();
  const rows = tab.envEntries(project, { entries });
  assert.deepEqual(plain(rows.map(r => [r.label, r.kind, r.exists])), [
    ['Project', 'project', true],
    ['app', 'folder', false],
    ['api · demo', 'worktree', true],
    ['"odd" <name>', 'folder', true],
  ]);
  assert.deepEqual(plain(tab.envEntries(project, { entries: null })), [], 'nothing before main answers');
  assert.deepEqual(plain(tab.envEntries(project, { entries: entries.slice(0, 1) }).map(r => r.label)), ['Project'], 'only what main knows');
});

test('a row: + where the file is missing, a warning where Git would commit it, quotes kept out of attributes', () => {
  const tab = loadTab();
  const [projectRow, missing, unignored, odd] = tab.envEntries(project, { entries }).map((entry, i) => tab.envRowHtml(entry, i === 0));

  assert.match(projectRow, /class="ws-env-row selected"/);
  assert.match(projectRow, /data-icon="project"/);
  assert.ok(!projectRow.includes('ws-env-create'), 'the project has its file: no +');
  assert.ok(!projectRow.includes('ws-env-warn'), 'not in a repository: no warning');

  assert.match(missing, /class="ws-env-row missing"/);
  assert.match(missing, /class="ws-env-create"[^>]*aria-label="Create local\.env\.sh in app"/);
  assert.match(missing, /No local\.env\.sh yet/);
  assert.match(missing, /class="ws-env-open"[^>]*disabled/);
  assert.ok(!missing.includes('ws-env-warn'), 'no file, nothing to commit');

  assert.match(unignored, /Not ignored by Git/);
  assert.match(unignored, /class="ws-env-exclude" data-path="\/home\/dev\/Switchboard\/demo\/repos\/api"/);

  assert.ok(!odd.includes('ws-env-warn'), 'ignored by Git: no warning');
  assert.ok(odd.includes('data-path="/home/dev/code/&quot;odd&quot; &lt;name&gt;"'), 'the path cannot end the attribute');
  assert.ok(odd.includes('&quot;odd&quot; &lt;name&gt;</span>') || odd.includes('"odd" &lt;name&gt;</span>'));
});

test('the rules at the top, and the load order above the editor, are the shared words', () => {
  const tab = loadTab();
  const rules = tab.envRulesHtml();
  assert.equal((rules.match(/<li>/g) || []).length, tab.EnvFilesModel.ENV_RULES.length);
  assert.match(rules, /loads only the project&#39;s file|loads only the project's file/);
  assert.match(rules, /the folder wins/);
  assert.match(rules, /sessions started after you save/);
  assert.equal(tab.EnvFilesModel.loadOrderText('project'), 'Sessions started here load only this file.');
  assert.equal(tab.EnvFilesModel.loadOrderText('folder'), "Sessions started here load the project's local.env.sh first, then this one.");
  assert.equal(tab.EnvFilesModel.loadOrderText('worktree'), tab.EnvFilesModel.loadOrderText('folder'));
});

test('the IPC of the tab is in the preload, in main, and Env opens in a window of its own', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  for (const channel of ['project-env-files', 'create-project-env-file', 'exclude-project-env-file']) {
    assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`), `preload calls ${channel}`);
    assert.ok(main.includes(`ipcMain.handle('${channel}'`), `main handles ${channel}`);
  }
  const html = read('public/index.html');
  assert.ok(html.indexOf('env-files-model.js') < html.indexOf('project-env-view.js'), 'the model loads before the tab');
  assert.ok(html.indexOf('project-files-view.js') < html.indexOf('project-env-view.js'), 'and after the Files tab it borrows from');
});
