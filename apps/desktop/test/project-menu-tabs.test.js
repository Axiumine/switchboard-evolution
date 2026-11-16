const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/projects-view.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const labels = between('const PROJECT_WINDOW_TAB_LABELS', '/** A tab of the strip with the button beside it');
const menu = between('/**\n * A row of the project menu that opens', 'function trackMenuItems(');

function projectMenu(project, opts) {
  const calls = { selected: [], windows: [] };
  const icon = name => () => `<${name}>`;
  const context = vm.createContext({
    window: { api: {
      openProjectWindow: (id, tab) => { calls.windows.push([id, tab]); return true; },
      openPath: () => {},
    } },
    selectProject: (id, options) => calls.selected.push([id, options.tab]),
    ICONS: { gear: icon('gear'), popOut: icon('popOut') },
    PICONS: new Proxy({}, { get: (_t, name) => icon(name) }),
    newSessionItems: () => [],
    snoozeMenuItems: () => [],
    stopAllMenuItems: () => [],
  });
  vm.runInContext(`${labels}\n${menu}\nthis.items = projectMenuItems;`, context);
  return { items: context.items(project, opts), calls };
}

test('the project menu has Files and Git just before Settings', () => {
  const { items } = projectMenu({ id: 'p1', root: '/p', status: 'active' });
  const labelsInOrder = items.filter(i => i.label).map(i => i.label);
  const at = labelsInOrder.indexOf('Settings');
  assert.deepEqual([...labelsInOrder.slice(at - 2, at + 2)], ['Files', 'Git', 'Settings', 'Open project folder']);
});

test('Files, Git and Settings open their tab on the project page, or in a window of its own from the button beside them', () => {
  const { items, calls } = projectMenu({ id: 'p1', root: '/p', status: 'active' });
  for (const tab of ['files', 'git', 'settings']) {
    const label = { files: 'Files', git: 'Git', settings: 'Settings' }[tab];
    const item = items.find(i => i.label === label);
    item.onClick();
    assert.equal(item.side.always, true, `${label}'s window button is always in sight`);
    assert.equal(item.side.icon, '<popOut>');
    assert.equal(item.side.title, `Open ${label} in a window of its own`);
    item.side.onClick();
  }
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), {
    selected: [['p1', 'files'], ['p1', 'git'], ['p1', 'settings']],
    windows: [['p1', 'files'], ['p1', 'git'], ['p1', 'settings']],
  });
});

test('the menu of the page itself has the three rows too', () => {
  const { items } = projectMenu({ id: 'p1', root: '/p', status: 'active' }, { fromPage: true });
  assert.ok(['Files', 'Git', 'Settings'].every(label => items.some(i => i.label === label)));
  assert.equal(items.some(i => i.label === 'Open overview'), false);
});
