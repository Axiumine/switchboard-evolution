const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validFilesFilter, loadFilesFilter, saveFilesFilter, FILES_FILTER_KEY,
  buildFilesSections, filesSectionsEmpty, pinnedStep, pinnedDropIndex,
} = require('../public/files-list');

const file = (filePath, extra = {}) => ({ filePath, filename: filePath.split('/').pop(), ...extra });

const agents = {
  global: { files: [file('/demo/.claude/CLAUDE.md', { displayPath: '~/.claude' })] },
  projects: [
    { folder: '-demo-app', shortName: 'demo/app', files: [file('/demo/app/CLAUDE.md', { displayPath: 'demo/app/' }), file('/demo/app/AGENTS.md')] },
    { folder: '-demo-site', shortName: 'demo/site', files: [file('/demo/site/CLAUDE.md')] },
  ],
};
const opened = {
  opened: [file('/demo/notes/todo.txt'), file('/demo/app/CLAUDE.md'), file('/demo/notes/plan.ts')],
  pinned: [],
};

const paths = (list) => list.map(f => f.filePath);
const groupPaths = (groups) => groups.map(g => [g.key, paths(g.files)]);

test('the filter is one of the three, All when unknown', () => {
  assert.equal(validFilesFilter('agents'), 'agents');
  assert.equal(validFilesFilter('opened'), 'opened');
  assert.equal(validFilesFilter('pinned'), 'all');
  assert.equal(validFilesFilter(undefined), 'all');
});

test('the filter is kept in storage, and a broken storage means All', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(loadFilesFilter(storage), 'all');
  saveFilesFilter(storage, 'opened');
  assert.equal(store.get(FILES_FILTER_KEY), 'opened');
  assert.equal(loadFilesFilter(storage), 'opened');
  saveFilesFilter(storage, 'nonsense');
  assert.equal(loadFilesFilter(storage), 'all');
  assert.equal(loadFilesFilter({ getItem: () => { throw new Error('denied'); } }), 'all');
  assert.equal(loadFilesFilter(null), 'all');
});

test('All shows the opened files and the agent files, each once', () => {
  const sections = buildFilesSections({ agents, opened, filter: 'all' });
  assert.deepEqual(sections.pinned, []);
  // The dropped CLAUDE.md stays in its agent group.
  assert.deepEqual(paths(sections.opened), ['/demo/notes/todo.txt', '/demo/notes/plan.ts']);
  assert.deepEqual(groupPaths(sections.groups), [
    ['__global__', ['/demo/.claude/CLAUDE.md']],
    ['-demo-app', ['/demo/app/CLAUDE.md', '/demo/app/AGENTS.md']],
    ['-demo-site', ['/demo/site/CLAUDE.md']],
  ]);
});

test('Agent files shows only the agent groups, as the tab did before', () => {
  const sections = buildFilesSections({ agents, opened, filter: 'agents' });
  assert.deepEqual(sections.opened, []);
  assert.equal(sections.groups.length, 3);
});

test('Opened shows every opened file, agent files too, and no group', () => {
  const sections = buildFilesSections({ agents, opened, filter: 'opened' });
  assert.deepEqual(paths(sections.opened), ['/demo/notes/todo.txt', '/demo/app/CLAUDE.md', '/demo/notes/plan.ts']);
  assert.deepEqual(sections.groups, []);
});

test('pinned files show with every filter, in their order, and nowhere else', () => {
  const withPins = { ...opened, pinned: [file('/demo/notes/plan.ts'), file('/demo/site/CLAUDE.md'), file('/demo/elsewhere/x.md')] };
  for (const filter of ['all', 'agents', 'opened']) {
    const sections = buildFilesSections({ agents, opened: withPins, filter });
    assert.deepEqual(sections.pinned.map(p => p.file.filePath), ['/demo/notes/plan.ts', '/demo/site/CLAUDE.md', '/demo/elsewhere/x.md'], filter);
    assert.ok(!paths(sections.opened).includes('/demo/notes/plan.ts'), filter);
    assert.ok(!sections.groups.some(g => paths(g.files).includes('/demo/site/CLAUDE.md')), filter);
  }
  const [plan, site, other] = buildFilesSections({ agents, opened: withPins, filter: 'all' }).pinned;
  assert.deepEqual([plan.opened, plan.agent], [true, false]);
  assert.deepEqual([site.opened, site.agent], [false, true]);
  assert.deepEqual([other.opened, other.agent], [false, false]);
  // The project whose only file is pinned has no group left.
  assert.ok(!buildFilesSections({ agents, opened: withPins, filter: 'all' }).groups.some(g => g.key === '-demo-site'));
});

test('a pinned agent file keeps the place its group shows', () => {
  const withPins = { opened: [], pinned: [file('/demo/.claude/CLAUDE.md', { displayPath: '/demo/.claude' })] };
  const [pin] = buildFilesSections({ agents, opened: withPins, filter: 'all' }).pinned;
  assert.equal(pin.file.displayPath, '~/.claude');
});

test('a search narrows every section, the pinned one too', () => {
  const withPins = { ...opened, pinned: [file('/demo/notes/plan.ts'), file('/demo/site/CLAUDE.md')] };
  const matchIds = new Set(['/demo/notes/plan.ts', '/demo/app/AGENTS.md']);
  const sections = buildFilesSections({ agents, opened: withPins, filter: 'all', matchIds });
  assert.deepEqual(sections.pinned.map(p => p.file.filePath), ['/demo/notes/plan.ts']);
  assert.deepEqual(sections.opened, []);
  assert.deepEqual(groupPaths(sections.groups), [['-demo-app', ['/demo/app/AGENTS.md']]]);
  assert.equal(filesSectionsEmpty(buildFilesSections({ agents, opened: withPins, matchIds: new Set() })), true);
});

test('nothing loaded yet is an empty tab', () => {
  const sections = buildFilesSections({});
  assert.equal(sections.filter, 'all');
  assert.equal(filesSectionsEmpty(sections), true);
});

test('pinnedStep moves one place up or down, not past the ends', () => {
  const pinned = ['/a', '/b', '/c'];
  assert.equal(pinnedStep(pinned, '/b', -1), 0);
  assert.equal(pinnedStep(pinned, '/b', 1), 2);
  assert.equal(pinnedStep(pinned, '/a', -1), null);
  assert.equal(pinnedStep(pinned, '/c', 1), null);
  assert.equal(pinnedStep(pinned, '/x', 1), null);
});

test('pinnedDropIndex places the dragged file before or after the one it is dropped on', () => {
  const pinned = ['/a', '/b', '/c', '/d'];
  assert.equal(pinnedDropIndex(pinned, '/d', '/a', false), 0);
  assert.equal(pinnedDropIndex(pinned, '/a', '/c', true), 2);
  assert.equal(pinnedDropIndex(pinned, '/a', '/c', false), 1);
  assert.equal(pinnedDropIndex(pinned, '/c', '/a', true), 1);
  assert.equal(pinnedDropIndex(pinned, '/a', '/d', true), 3);
  // Dropped where it already is.
  assert.equal(pinnedDropIndex(pinned, '/b', '/a', true), null);
  assert.equal(pinnedDropIndex(pinned, '/b', '/c', false), null);
  assert.equal(pinnedDropIndex(pinned, '/b', '/b', true), null);
  assert.equal(pinnedDropIndex(pinned, '/x', '/a', true), null);
});
