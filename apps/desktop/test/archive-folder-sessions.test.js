// "Archive all sessions" of a folder (public/sidebar.js archiveFolderSessions),
// which the Sessions list's folder header and the Session Overview's folder
// groups share: it asks first, then stops the running sessions and archives
// each one. The function is cut out of sidebar.js and run in a vm, with the
// confirmation, window.api and loadProjects stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sidebar = fs.readFileSync(path.join(__dirname, '../public/sidebar.js'), 'utf8');

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}

const FOLDER = '/work/demo-app';

function harness({ answer = true, folders = null, running = [] } = {}) {
  const log = [];
  const sessions = [
    { sessionId: 'a', archived: 0 },
    { sessionId: 'b', archived: 0 },
    { sessionId: 'c', archived: 1 },
  ];
  const context = vm.createContext({
    Promise,
    cachedAllProjects: folders || [
      { projectPath: '/work/other', sessions: [{ sessionId: 'x', archived: 0 }] },
      { projectPath: FOLDER, sessions },
    ],
    cachedProjects: [],
    activePtyIds: new Set(running),
    shortProjectPath: projectPath => projectPath.split('/').slice(-2).join('/'),
    confirm: message => { log.push(`confirm: ${message}`); return answer; },
    window: { api: {
      stopSession: async id => { log.push(`stop ${id}`); },
      archiveSession: async (id, value) => { log.push(`archive ${id} ${value}`); },
    } },
    forgetTerminalHistory: id => log.push(`forget ${id}`),
    pollActiveSessions: () => log.push('poll'),
    loadProjects: () => log.push('loadProjects'),
  });
  vm.runInContext(body(sidebar, 'async function archiveFolderSessions('), context);
  return { context, log, sessions };
}

test('archiving a folder asks first, stops the running sessions and archives each one', async () => {
  // No: nothing is stopped or archived.
  const refused = harness({ answer: false, running: ['a'] });
  assert.equal(await refused.context.archiveFolderSessions(FOLDER), false);
  assert.deepEqual(refused.log, ['confirm: Archive all 2 sessions in work/demo-app?']);
  assert.deepEqual(refused.sessions.map(s => s.archived), [0, 0, 1]);

  // Yes: the running one is stopped before it is archived, the archived one is left alone.
  const { context, log, sessions } = harness({ running: ['a'] });
  assert.equal(await context.archiveFolderSessions(FOLDER), true);
  assert.deepEqual(log, [
    'confirm: Archive all 2 sessions in work/demo-app?',
    'stop a', 'archive a 1', 'forget a',
    'archive b 1', 'forget b',
    'poll', 'loadProjects',
  ]);
  assert.deepEqual(sessions.map(s => s.archived), [1, 1, 1]);
});

test('a folder with nothing to archive asks nothing', async () => {
  const { context, log } = harness({ folders: [{ projectPath: FOLDER, sessions: [{ sessionId: 'c', archived: 1 }] }] });
  assert.equal(await context.archiveFolderSessions(FOLDER), false);
  assert.equal(await context.archiveFolderSessions('/work/unknown'), false);
  assert.deepEqual(log, []);
});

test('the sessions given are the ones archived, and one alone is "1 session"', async () => {
  // The Sessions list hands over the ones it shows (during a search, the ones found).
  const { context, log, sessions } = harness();
  assert.equal(await context.archiveFolderSessions(FOLDER, [sessions[1]]), true);
  assert.deepEqual(log, ['confirm: Archive all 1 session in work/demo-app?', 'archive b 1', 'forget b', 'poll', 'loadProjects']);
  assert.deepEqual(sessions.map(s => s.archived), [0, 1, 1]);
});

test("the folder header's buttons are Folder settings and Archive all sessions, through archiveFolderSessions", () => {
  assert.ok(sidebar.includes("settingsBtn.title = 'Folder settings';"), 'the gear is titled Folder settings');
  assert.ok(!sidebar.includes("'Project settings'"), 'no title says Project settings');
  const rebind = body(sidebar, 'function rebindSidebarEvents(');
  assert.ok(rebind.includes('archiveFolderSessions(project.projectPath, project.sessions)'), 'the button calls archiveFolderSessions');
  assert.ok(!rebind.includes('confirm(`Archive all'), 'the button asks nothing itself');
});
