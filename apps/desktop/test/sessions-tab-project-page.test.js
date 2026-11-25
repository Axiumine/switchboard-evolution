const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// onSessionShown and onMessagesShown (projects-view.js): what opens a project's
// Session tab around a session shown from the sidebar.
const projects = fs.readFileSync(path.join(__dirname, '../public/projects-view.js'), 'utf8');
const hooks = projects.slice(projects.indexOf('/**\n * Called at the end of showSession().'), projects.indexOf('/** Called by showTaskLog.'));

function run(activeTab) {
  const calls = [];
  const sessions = new Map([
    ['in-project', { sessionId: 'in-project', projectPath: '/work/demo' }],
    ['loose', { sessionId: 'loose', projectPath: '/tmp/elsewhere' }],
  ]);
  const context = vm.createContext({
    activeTab,
    gridViewActive: false,
    sessionMap: sessions,
    projectForSession: session => (session?.projectPath === '/work/demo' ? { project: { id: 'demo' } } : null),
    enterWorking: (project, session) => calls.push(['enter', project.id, session.sessionId]),
    leaveWorking: () => calls.push(['leave']),
  });
  vm.runInContext(hooks, context);
  return { context, calls, sessions };
}

test('from the Sessions tab a project\'s session opens on its project\'s Session tab', () => {
  const { context, calls, sessions } = run('sessions');
  context.onSessionShown('in-project');
  context.onSessionShown('loose');
  context.onMessagesShown(sessions.get('in-project'));
  assert.deepEqual(calls, [['enter', 'demo', 'in-project'], ['leave'], ['enter', 'demo', 'in-project']]);
});

test('the Projects tab keeps doing so, and the other tabs leave the main area alone', () => {
  assert.deepEqual(run('projects').calls, []);
  const projectsTab = run('projects');
  projectsTab.context.onSessionShown('in-project');
  assert.deepEqual(projectsTab.calls, [['enter', 'demo', 'in-project']]);
  for (const tab of ['plans', 'memory', 'stats']) {
    const other = run(tab);
    other.context.onSessionShown('in-project');
    other.context.onMessagesShown(other.sessions.get('in-project'));
    assert.deepEqual(other.calls, [], tab);
  }
});

test('the grid keeps sessions out of a project page', () => {
  const { context, calls } = run('sessions');
  context.gridViewActive = true;
  context.onSessionShown('in-project');
  assert.deepEqual(calls, [['leave']]);
});
