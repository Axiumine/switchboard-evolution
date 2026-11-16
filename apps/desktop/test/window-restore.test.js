const test = require('node:test');
const assert = require('node:assert/strict');

const { describeOpenWindows, windowsToRestore, MAX_WINDOWS } = require('../window-restore');

function fakeWindow(bounds, { destroyed = false, minimized = false, normal = null } = {}) {
  return {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...(normal || bounds) }),
  };
}

const options = {
  toolKinds: new Set(['task-manager', 'stats']),
  projectTabs: new Set(['overview', 'plan', 'files', 'git', 'settings']),
  projectExists: id => id !== 'gone',
};

test('the open windows are kept with their place and size; closed ones are not', () => {
  const tools = new Map([
    ['task-manager', fakeWindow({ x: 10, y: 20, width: 640, height: 560 })],
    ['stats', fakeWindow({ x: 0, y: 0, width: 500, height: 500 }, { destroyed: true })],
  ]);
  const projects = new Map([
    ['p1\ngit', fakeWindow({ x: 100, y: 120, width: 1000, height: 760 })],
    ['p2\nfiles', fakeWindow({ x: 0, y: 0, width: 300, height: 300 }, { minimized: true, normal: { x: 40, y: 50, width: 900, height: 700 } })],
  ]);
  assert.deepEqual(describeOpenWindows(tools, projects), [
    { kind: 'task-manager', bounds: { x: 10, y: 20, width: 640, height: 560 } },
    { kind: 'project', projectId: 'p1', tab: 'git', bounds: { x: 100, y: 120, width: 1000, height: 760 } },
    { kind: 'project', projectId: 'p2', tab: 'files', bounds: { x: 40, y: 50, width: 900, height: 700 } },
  ]);
});

test('the saved list opens again what still can be, each window once', () => {
  const saved = [
    { kind: 'task-manager', bounds: { x: 10, y: 20, width: 640, height: 560 } },
    { kind: 'task-manager' },
    { kind: 'project', projectId: 'p1', tab: 'git', bounds: { x: 100.4, y: 120, width: 1000, height: 760 } },
    { kind: 'project', projectId: 'p1', tab: 'files' },
    { kind: 'project', projectId: 'p1', tab: 'git' },
    { kind: 'project', projectId: 'gone', tab: 'git' },
    { kind: 'project', projectId: 'p1', tab: 'session' },
    { kind: 'something-else' },
    { kind: 'project', projectId: '', tab: 'plan' },
    null,
    'stats',
  ];
  assert.deepEqual(windowsToRestore(saved, options), [
    { kind: 'task-manager', bounds: { x: 10, y: 20, width: 640, height: 560 } },
    { kind: 'project', projectId: 'p1', tab: 'git', bounds: { x: 100, y: 120, width: 1000, height: 760 } },
    { kind: 'project', projectId: 'p1', tab: 'files' },
  ]);
});

test('bounds that make no sense are dropped, the window itself is kept', () => {
  const saved = [
    { kind: 'stats', bounds: { x: 0, y: 0, width: 20, height: 500 } },
    { kind: 'project', projectId: 'p1', tab: 'plan', bounds: { x: 'a', y: 0, width: 800, height: 600 } },
  ];
  assert.deepEqual(windowsToRestore(saved, options), [
    { kind: 'stats' },
    { kind: 'project', projectId: 'p1', tab: 'plan' },
  ]);
});

test('nothing saved, or something that is not a list, opens nothing; the list has a limit', () => {
  assert.deepEqual(windowsToRestore(undefined, options), []);
  assert.deepEqual(windowsToRestore({ kind: 'stats' }, options), []);
  const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'project', projectId: `p${i}`, tab: 'git' }));
  assert.equal(windowsToRestore(many, options).length, MAX_WINDOWS);
  const lookupFails = { ...options, projectExists: () => { throw new Error('db closed'); } };
  assert.deepEqual(windowsToRestore([{ kind: 'project', projectId: 'p1', tab: 'git' }], lookupFails), []);
});
