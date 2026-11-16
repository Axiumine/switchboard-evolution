const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/search-results.js'), 'utf8'), context);
const {
  sessionTitleMatches, searchMatchesWithTitles, filterFoldersForSearch, projectSearchResults, runningAmong, uniqueSessions,
} = context;
// Objects made inside the vm have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
const ids = sessions => sessions.map(s => s.sessionId);

const folders = [
  { projectPath: '/src/api', sessions: [
    { sessionId: 'a1', name: 'Fix login' },
    { sessionId: 'a2', aiTitle: 'Deploy api' },
    { sessionId: 'a3', type: 'terminal', name: 'npm run dev' },
  ] },
  { projectPath: '/src/web', sessions: [{ sessionId: 'w1', summary: 'Login page' }] },
];

test('a title match finds sessions the index has not seen, case-insensitively', () => {
  assert.equal(sessionTitleMatches({ name: 'npm run dev' }, 'RUN'), true);
  assert.equal(sessionTitleMatches({ aiTitle: 'Deploy api' }, 'deploy'), true);
  assert.equal(sessionTitleMatches({ summary: 'Login page' }, '  login '), true);
  assert.equal(sessionTitleMatches({ name: 'npm run dev' }, ''), false);
  assert.equal(sessionTitleMatches({}, 'x'), false);
  assert.deepEqual([...searchMatchesWithTitles(['a2'], folders, 'login')].sort(), ['a1', 'a2', 'w1']);
});

test('the Sessions tab keeps matching sessions, minus those left out', () => {
  const shown = filterFoldersForSearch(folders, { matchIds: new Set(['a1', 'a3', 'w1']), excluded: new Set(['w1']) });
  assert.deepEqual(plain(shown.map(f => [f.projectPath, ids(f.sessions), f._projectMatchedOnly])), [['/src/api', ['a1', 'a3'], false]]);
});

test('a folder matched by name stays even when its sessions are all left out', () => {
  const shown = filterFoldersForSearch(folders, {
    matchIds: new Set(['w1']), projectPaths: new Set(['/src/web']), excluded: new Set(['w1']),
  });
  assert.deepEqual(plain(shown.map(f => [f.projectPath, ids(f.sessions), f._projectMatchedOnly])), [['/src/web', [], true]]);
});

const projects = [
  { id: 'p1', name: 'Payments', sessions: [{ sessionId: 's1' }, { sessionId: 's2' }], tracks: [{ sessions: [{ sessionId: 's3' }] }] },
  { id: 'p2', name: 'Docs', sessions: [{ sessionId: 'd1' }, { sessionId: 'd2' }], tracks: [] },
  { id: 'p3', name: 'Website', sessions: [{ sessionId: 'x1' }], tracks: [] },
];
const sessionsOf = p => [...p.sessions, ...p.tracks.flatMap(t => t.sessions)];
const running = new Set(['s2', 's3', 'd2']);
const find = (query, matchIds, opts = {}) => plain(projectSearchResults(projects, {
  query, matchIds: new Set(matchIds), sessionsOf, isRunning: id => running.has(id), ...opts,
}).map(r => [r.project.id, ids(r.sessions)]));

test('the Projects tab lists matching sessions under their project, and the running ones of a project found by name', () => {
  // "pay" names p1: its running sessions show; d1 matched by content shows under Docs.
  assert.deepEqual(find('pay', ['d1']), [['p1', ['s2', 's3']], ['p2', ['d1']]]);
  // A project found only through its sessions lists just those.
  assert.deepEqual(find('zzz', ['s1']), [['p1', ['s1']]]);
});

test('projects and sessions left out of the search are gone from it', () => {
  assert.deepEqual(find('pay', ['d1'], { excludedProjects: new Set(['p2']) }), [['p1', ['s2', 's3']]]);
  assert.deepEqual(find('pay', ['d1'], { excludedSessions: new Set(['s3', 'd1']) }), [['p1', ['s2']], ['p2', []]]);
});

test('Stop ends the running sessions shown, each once', () => {
  const shown = [{ sessionId: 's1' }, { sessionId: 's2' }, { sessionId: 's2' }, { sessionId: 'd2' }];
  assert.deepEqual(plain(ids(runningAmong(shown, id => running.has(id)))), ['s2', 'd2']);
  assert.deepEqual(plain(ids(uniqueSessions(shown))), ['s1', 's2', 'd2']);
});
