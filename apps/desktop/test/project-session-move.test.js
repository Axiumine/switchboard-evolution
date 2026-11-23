const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/projects-view.js'), 'utf8');
const moveItems = source.slice(source.indexOf('function sessionMoveItems('), source.indexOf('function sessionMenuItems('));

const projects = [
  { id: 'p1', name: 'Alpha', status: 'active', tracks: [{ id: 't1', name: 'Build', status: 'active' }] },
  { id: 'p2', name: 'Beta', status: 'active', tracks: [] },
];

/** sessionMoveItems against stubs; `inProject` files the session under Alpha. */
function load({ inProject }) {
  const context = vm.createContext({
    window: { api: {} },
    PICONS: new Proxy({}, { get: () => () => '' }),
    cachedProjectTreeAll: { projects },
    projectForSession: () => (inProject ? { project: projects[0] } : null),
  });
  vm.runInContext(moveItems, context);
  return context;
}

// Copied into this realm: arrays made in the vm context are not deepEqual to ours.
const labels = (items) => [...items].filter(i => i.label).map(i => i.label);

test('a session in a project: its right-click menu moves it to another project under "Move to project"', () => {
  const context = load({ inProject: true });
  const items = context.sessionMoveItems({ sessionId: 's1', projectId: 'p1' }, { inMenu: true });
  const move = items.find(i => i.label === 'Move to project');
  assert.ok(move, labels(items).join(', '));
  assert.deepEqual(labels(move.submenu), ['Beta'], 'the other projects, not its own');
  assert.ok(!labels(items).includes('Move to another project'));
});

test('a session outside every project: its right-click menu has the same "Move to project" row, not every project', () => {
  const context = load({ inProject: false });
  const items = context.sessionMoveItems({ sessionId: 's1' }, { inMenu: true });
  assert.deepEqual(labels(items), ['Move to project']);
  assert.deepEqual(labels(items[0].submenu), ['Alpha', 'Beta']);
  assert.deepEqual(labels(items[0].submenu[0].submenu), ['General', 'Build']);
  assert.ok(!items.some(i => i.head), 'no "Move to project" heading over a flat list');
  assert.ok(!items[0].sep, 'no separator at the top');
});

test('the Sessions tab\'s Move to project… still lists the projects as the whole menu', () => {
  const context = load({ inProject: false });
  const items = context.sessionMoveItems({ sessionId: 's1' });
  assert.equal(items[0].head, 'Move to project', 'the heading first, without a separator above it');
  assert.deepEqual(labels(items), ['Alpha', 'Beta']);
});
