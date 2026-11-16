const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createRemoteApi } = require('../remote-api');
const { createRemoteTasks } = require('../remote-tasks');

const KNOWN = '/work/project';
const OTHER = '/work/elsewhere';

/** A task manager that records every call, and an API over the methods remote-tasks.js gives main.js. */
function setup() {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return { named: name }; };
  const taskManager = Object.fromEntries(
    ['listTasks', 'getRun', 'startTask', 'stopTask', 'restartTask', 'stopAllTasks', 'sendInput', 'resize', 'listTasksForProjects']
      .map(name => [name, record(name)]));
  const tasks = createRemoteTasks({ roots: () => [KNOWN, '/work/attached'], taskManager });
  const api = createRemoteApi({ getHandler: () => null, localMethods: tasks.methods });
  return { api, calls };
}

test('each task method reaches the task manager for a known folder', async () => {
  const { api, calls } = setup();
  const cases = [
    ['list-project-tasks', [KNOWN], ['listTasks', KNOWN]],
    ['get-task-run', [KNOWN, 'dev'], ['getRun', KNOWN, 'dev']],
    ['start-task', [KNOWN, 'dev'], ['startTask', KNOWN, 'dev']],
    ['stop-task', [KNOWN, 'dev'], ['stopTask', KNOWN, 'dev']],
    ['restart-task', [KNOWN, 'dev'], ['restartTask', KNOWN, 'dev']],
    ['stop-all-tasks', ['/work/attached'], ['stopAllTasks', '/work/attached']],
    ['task-input', [KNOWN, 'dev', 'y\r'], ['sendInput', KNOWN, 'dev', 'y\r']],
  ];
  for (const [method, params, call] of cases) {
    calls.length = 0;
    const reply = await api.call(method, params);
    assert.equal(reply.error, undefined, method);
    assert.deepEqual(calls, [call], method);
  }
  assert.deepEqual(await api.call('start-task', [KNOWN, 'dev']), { result: { named: 'startTask' } });
});

test('a folder that is not a project folder is refused before the task manager is called', async () => {
  const { api, calls } = setup();
  for (const [method, params] of [
    ['list-project-tasks', [OTHER]], ['get-task-run', [OTHER, 'dev']], ['start-task', [OTHER, 'dev']],
    ['stop-task', [OTHER, 'dev']], ['restart-task', [OTHER, 'dev']], ['stop-all-tasks', [OTHER]],
    ['task-input', [OTHER, 'dev', 'x']],
    // A sub-folder or a relative spelling of a known folder is not a known folder either.
    ['start-task', [KNOWN + '/sub', 'dev']], ['start-task', [KNOWN + '/../elsewhere', 'dev']],
  ]) {
    assert.deepEqual(await api.call(method, params), { result: { error: 'Not a folder of a project' } }, method);
  }
  assert.deepEqual(calls, []);
});

test('task parameters are checked', async () => {
  const { api, calls } = setup();
  assert.match((await api.call('start-task', ['relative', 'dev'])).error, /Wrong parameter 1/);
  assert.match((await api.call('start-task', [KNOWN, 'x'.repeat(201)])).error, /Wrong parameter 2/);
  assert.match((await api.call('task-input', [KNOWN, 'dev', 'x'.repeat(65537)])).error, /Wrong parameter 3/);
  assert.match((await api.call('stop-all-tasks', [KNOWN, 'dev'])).error, /Wrong parameters/);
  assert.deepEqual(calls, []);
});

test('resizing and the many-projects listing are not available to phones', async () => {
  const { api, calls } = setup();
  assert.match((await api.call('task-resize', [KNOWN, 'dev', 80, 24])).error, /Not available remotely/);
  assert.match((await api.call('list-tasks-for-projects', [[KNOWN]])).error, /Not available remotely/);
  assert.equal(calls.length, 0);
});

test('phones hear when a task prints or changes state', () => {
  const { api } = setup();
  assert.equal(api.forwardsEvent('task-output'), true);
  assert.equal(api.forwardsEvent('task-state-changed'), true);
  assert.equal(api.forwardsEvent('task-resized'), false);
});
