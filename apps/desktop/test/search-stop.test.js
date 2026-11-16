const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
const flow = between('// --- Search results: leave some out, stop the rest ---', "document.getElementById('search-stop-btn')");
const helpers = fs.readFileSync(path.join(__dirname, '../public/search-results.js'), 'utf8');

/** The search bar's code against stubs: `shown` is what the visible tab rendered. */
function setup({ tab = 'sessions', shown = [], running = [], busy = [], confirm = true, query = 'api' } = {}) {
  const el = () => ({ hidden: false, disabled: false, textContent: '', title: '' });
  const parts = { '#search-actions-count': el(), '#search-restore-btn': el(), '#search-stop-btn': el() };
  const bar = { hidden: true, querySelector: sel => parts[sel] };
  const calls = { confirmed: [], stopped: [], refreshed: 0 };
  const context = vm.createContext({
    document: { getElementById: id => (id === 'search-actions' ? bar : null) },
    activeTab: tab,
    searchMatchIds: new Set(),
    searchExcluded: { query: null, sessions: new Set(), projects: new Set() },
    sidebarSearchShown: tab === 'sessions' ? shown : [],
    projectsUi: { searchShown: tab === 'projects' ? shown : [] },
    isSessionRunning: id => running.includes(id),
    sessionBusyState: new Map(busy.map(id => [id, true])),
    searchInput: { value: ` ${query} ` },
    confirmStopWork: async (project, work, opts) => { calls.confirmed.push({ project, ids: work.sessions.map(s => s.sessionId), busy: work.busy.length, where: opts.where }); return confirm; },
    stopRunningWork: async work => { calls.stopped.push(...work.sessions.map(s => s.sessionId)); },
    refreshSidebar: () => { calls.refreshed++; },
  });
  vm.runInContext(helpers + '\n' + flow, context);
  return { context, bar, parts, calls };
}

test('the bar shows only while a session or project search is on', () => {
  const { context, bar } = setup({ tab: 'plans' });
  context.updateSearchActions();
  assert.equal(bar.hidden, true);
  const other = setup();
  other.context.searchMatchIds = null;
  vm.runInContext('searchMatchIds = null', other.context);
  other.context.updateSearchActions();
  assert.equal(other.bar.hidden, true);
});

test('the bar counts what is shown and offers Stop only for running sessions', () => {
  const shown = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'b' }];
  const { context, bar, parts } = setup({ shown, running: ['b'] });
  context.updateSearchActions();
  assert.equal(bar.hidden, false);
  assert.equal(parts['#search-actions-count'].textContent, '2 sessions');
  assert.equal(parts['#search-stop-btn'].textContent, 'Stop 1 running');
  assert.equal(parts['#search-stop-btn'].disabled, false);
  assert.equal(parts['#search-restore-btn'].hidden, true);

  const idle = setup({ shown: [{ sessionId: 'a' }] });
  idle.context.updateSearchActions();
  assert.equal(idle.parts['#search-stop-btn'].disabled, true);
  assert.equal(idle.parts['#search-stop-btn'].textContent, 'None running');
});

test('the Projects tab counts its own rows', () => {
  const { context, parts } = setup({ tab: 'projects', shown: [{ sessionId: 'p' }], running: ['p'] });
  context.updateSearchActions();
  assert.equal(parts['#search-stop-btn'].textContent, 'Stop 1 running');
});

test('the X leaves a result out until the query changes', () => {
  const { context, parts, calls } = setup({ shown: [{ sessionId: 'a' }] });
  context.resetSearchExclusions('api');
  context.leaveOutOfSearch({ sessionId: 'a' });
  context.leaveOutOfSearch({ projectId: 'p1' });
  assert.equal(calls.refreshed, 2);
  context.updateSearchActions();
  assert.equal(parts['#search-restore-btn'].hidden, false);
  assert.equal(parts['#search-restore-btn'].textContent, '2 left out');
  // The same query again (the titles toggle re-runs it) keeps what was left out.
  context.resetSearchExclusions('api');
  assert.equal(context.searchExcluded.sessions.size, 1);
  context.resetSearchExclusions('apis');
  assert.equal(context.searchExcluded.sessions.size + context.searchExcluded.projects.size, 0);
  context.leaveOutOfSearch({ sessionId: 'a' });
  context.resetSearchExclusions();
  assert.equal(context.searchExcluded.sessions.size, 0);
});

test('Stop asks once, then stops the running sessions shown, and nothing else', async () => {
  const shown = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }];
  const { context, calls } = setup({ shown, running: ['a', 'c'], busy: ['c'] });
  await context.stopSearchResults();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.confirmed)), [{ project: null, ids: ['a', 'c'], busy: 1, where: 'matching "api"' }]);
  assert.deepEqual(calls.stopped, ['a', 'c']);
  assert.equal(calls.refreshed, 1);
});

test('Cancel stops nothing, and nothing running asks nothing', async () => {
  const cancelled = setup({ shown: [{ sessionId: 'a' }], running: ['a'], confirm: false });
  await cancelled.context.stopSearchResults();
  assert.equal(cancelled.calls.confirmed.length, 1);
  assert.deepEqual(cancelled.calls.stopped, []);

  const idle = setup({ shown: [{ sessionId: 'a' }] });
  await idle.context.stopSearchResults();
  assert.equal(idle.calls.confirmed.length, 0);
});
