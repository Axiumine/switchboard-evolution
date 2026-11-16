const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ platform = 'darwin', running = [] } = {}) {
  const calls = [];
  const project = {
    id: 'p1', name: 'Demo', root: '/work/demo',
    folders: [{ path: '/code/app', mode: 'in-place' }, { path: '/code/app.worktrees/feature', mode: 'worktree' }],
    sessions: running.map((s, i) => ({ sessionId: `s${i}`, projectPath: '/work/demo', ...s })),
    tracks: [],
  };
  const context = vm.createContext({
    window: { api: { platform, writeClipboard: v => calls.push(['copy', v]), sendInput: (id, text) => calls.push(['input', id, text]) } },
    localStorage: { getItem: () => null, setItem: () => {} },
    PICONS: new Proxy({}, { get: () => () => '' }),
    ICONS: new Proxy({}, { get: () => () => '' }),
    projectsUi: { files: new Map() },
    activePtyIds: new Set(running.map((_, i) => `s${i}`)),
    projectSessionsAll: p => p.sessions,
    sessionTitle: s => s.title || 'Chat',
    cliIcon: () => '',
    openSession: s => calls.push(['open', s.sessionId]),
    pathBasename: p => String(p).split('/').filter(Boolean).pop(),
    folderChipLabel: (_p, f) => f.path.split('/').pop(),
    shellEscape: p => "'" + p.replace(/'/g, "'\\''") + "'",
    escapeHtml: s => String(s),
    alert: m => calls.push(['alert', m]),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/file-actions.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/project-files-view.js'), 'utf8'), context);
  return { context, calls, project };
}

// Arrays made inside the vm context have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
const labels = items => plain(items.filter(i => i.label).map(i => i.label));

test('the Files tab has the project folder first, then one tab per attached folder', () => {
  const { context, project } = setup();
  const roots = context.filesRoots(project);
  assert.deepEqual(plain(roots.map(r => [r.label, r.path, r.kind])), [
    ['Project', '/work/demo', 'project'],
    ['app', '/code/app', 'folder'],
    ['feature', '/code/app.worktrees/feature', 'worktree'],
  ]);
  // A detached folder falls back to the project tab.
  context.filesUi(project).root = '/gone';
  assert.equal(context.currentFilesRoot(project), '/work/demo');
  assert.equal(context.filesRootFor(project, '/code/app.worktrees/feature/src/a.js'), '/code/app.worktrees/feature');
  assert.equal(context.filesRootFor(project, '/code/app/src/a.js'), '/code/app');
  assert.equal(context.filesRootFor(project, '/elsewhere/a.js'), null);
});

test('a file has the explorer menu of a code editor, without test runners or build tools', () => {
  const { context, project } = setup();
  const file = { name: 'notes.md', relativePath: 'docs/notes.md', type: 'file', viewable: true };
  const items = labels(context.explorerMenuItems(project, '/code/app', file));
  assert.deepEqual(items, [
    'Open to the Side', 'Open With…', 'Reveal in Finder', 'Open in Integrated Terminal',
    'Select for Compare', 'Add File to Chat', 'Add File to New Chat', 'Open Timeline',
    'Cut', 'Copy', 'Paste', 'Copy Path', 'Copy Relative Path', 'Rename…', 'Delete', 'Duplicate',
  ]);
  for (const missing of ['Run Tests', 'Debug Tests', 'Run Tests with Coverage', 'Maven']) assert.ok(!items.includes(missing));
  assert.ok(!items.some(l => /cursor/i.test(l)));

  const folder = labels(context.explorerMenuItems(project, '/code/app', { name: 'docs', relativePath: 'docs', type: 'directory' }));
  assert.deepEqual(folder.slice(0, 2), ['New File…', 'New Folder…']);
  assert.ok(folder.includes('Add Folder to Chat') && !folder.includes('Open to the Side'));
  const empty = labels(context.explorerMenuItems(project, '/code/app', null));
  assert.deepEqual(empty, ['New File…', 'New Folder…', 'Open in Finder', 'Open in Integrated Terminal', 'Paste', 'Copy Path']);
});

test('select for compare offers the comparison on another file only', () => {
  const { context, project } = setup();
  const a = { name: 'a.md', relativePath: 'a.md', type: 'file', viewable: true };
  const b = { name: 'b.md', relativePath: 'b.md', type: 'file', viewable: true };
  context.explorerMenuItems(project, '/code/app', a).find(i => i.label === 'Select for Compare').onClick();
  assert.ok(!labels(context.explorerMenuItems(project, '/code/app', a)).includes('Compare with Selected'));
  const compare = context.explorerMenuItems(project, '/code/app', b).find(i => i.label === 'Compare with Selected');
  assert.equal(compare.hint, 'a.md');
});

test('paste is offered once something was cut or copied', () => {
  const { context, project } = setup();
  const file = { name: 'a.md', relativePath: 'a.md', type: 'file', viewable: true };
  assert.equal(context.explorerMenuItems(project, '/code/app', file).find(i => i.label === 'Paste').disabled, true);
  context.filesClipboard = null;
  vm.runInContext("filesClipboard = { mode: 'cut', root: '/code/app', rel: 'a.md', name: 'a.md' }", context);
  assert.equal(context.explorerMenuItems(project, '/code/app', file).find(i => i.label === 'Paste').disabled, false);
});

test('adding to a chat types a mention into the running chat and opens it', () => {
  const none = setup();
  const file = { name: 'a b.md', relativePath: 'docs/a b.md', type: 'file', viewable: true };
  assert.equal(none.context.explorerMenuItems(none.project, '/work/demo', file).find(i => i.label === 'Add File to Chat').disabled, true);

  const { context, calls, project } = setup({ running: [{ runtime: 'claude', title: 'Fix it' }] });
  const add = context.explorerMenuItems(project, '/work/demo', file).find(i => i.label === 'Add File to Chat');
  add.onClick();
  assert.deepEqual(plain(calls), [['input', 's0', '@"docs/a b.md" '], ['open', 's0']]);

  assert.equal(context.chatMentionFor('claude', '/work/demo', '/code/app/src/x.ts'), '@/code/app/src/x.ts ');
  assert.equal(context.chatMentionFor('claude', '/code/app', '/code/app/src/x.ts'), '@src/x.ts ');
  assert.equal(context.chatMentionFor('codex', '/code/app', '/code/app/src/x.ts'), 'src/x.ts ');
  assert.equal(context.chatMentionFor('codex', '/code/app', '/code/app/my file.ts'), "'my file.ts' ");

  const two = setup({ running: [{ runtime: 'claude', title: 'One' }, { runtime: 'codex', title: 'Two' }, { type: 'terminal', title: 'Shell' }] });
  const pick = two.context.explorerMenuItems(two.project, '/work/demo', file).find(i => i.label === 'Add File to Chat');
  assert.deepEqual(plain(pick.submenu.map(i => i.label).sort()), ['One', 'Two']);
});

test('shortcut hints follow the platform', () => {
  const { context, project } = setup({ platform: 'linux' });
  const items = context.explorerMenuItems(project, '/code/app', { name: 'a.md', relativePath: 'a.md', type: 'file', viewable: true });
  assert.equal(items.find(i => i.label === 'Copy').hint, 'Ctrl+C');
  assert.equal(items.find(i => i.label === 'Rename…').hint, 'F2');
  assert.ok(items.some(i => i.label === 'Reveal in File Manager'));
});
