// A project's tasks (tasks.json) for a paired phone: list them, see a run,
// start, stop and restart, and type into a running one. Only for the folders
// of a project (project roots and attached folders), whatever folder the
// phone names. Resizing is not offered: it would reflow the desktop's view.
// The phone asks per project, so list-tasks-for-projects is not offered
// either. Task output and state changes reach phones as events.

const { allow, allowEvent } = require('./remote-api');

const isString = (max) => (v) => typeof v === 'string' && v.length <= max;
const isPath = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096 && v.startsWith('/');
const isLabel = isString(200);

allow('list-project-tasks', [isPath], { local: true });
allow('get-task-run', [isPath, isLabel], { local: true });
allow('start-task', [isPath, isLabel], { local: true });
allow('stop-task', [isPath, isLabel], { local: true });
allow('restart-task', [isPath, isLabel], { local: true });
allow('stop-all-tasks', [isPath], { local: true });
allow('task-input', [isPath, isLabel, isString(65536)], { local: true });

allowEvent('task-output');
allowEvent('task-state-changed');

/**
 * The local methods for createRemoteApi, over `taskManager` (task-manager.js),
 * each answering { error: 'Not a folder of a project' } without calling it for
 * a folder `roots()` does not list.
 */
function createRemoteTasks({ roots, taskManager }) {
  const refused = { error: 'Not a folder of a project' };
  const inFolder = (call) => (_client, projectPath, ...rest) => (roots().includes(projectPath) ? call(projectPath, ...rest) : refused);
  return {
    methods: {
      'list-project-tasks': inFolder((projectPath) => taskManager.listTasks(projectPath)),
      'get-task-run': inFolder((projectPath, label) => taskManager.getRun(projectPath, label)),
      'start-task': inFolder((projectPath, label) => taskManager.startTask(projectPath, label)),
      'stop-task': inFolder((projectPath, label) => taskManager.stopTask(projectPath, label)),
      'restart-task': inFolder((projectPath, label) => taskManager.restartTask(projectPath, label)),
      'stop-all-tasks': inFolder((projectPath) => taskManager.stopAllTasks(projectPath)),
      // Not an IPC handler on the desktop (ipcMain.on): the task manager is called directly.
      'task-input': inFolder((projectPath, label, data) => taskManager.sendInput(projectPath, label, data)),
    },
  };
}

module.exports = { createRemoteTasks };
