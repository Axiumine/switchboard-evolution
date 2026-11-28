// The Session Overview's closed cards (public/session-overview-closed.js): the
// labels, the previews kept until a session's `modified` changes, an empty
// preview as "none yet", the batches getSessionPreviews is asked in, and the
// places closed cards and "+ N older" take on the pages. The parts a vm can
// reach run here; the cards themselves are checked in the app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const closedSource = read('session-overview-closed.js');

/** session-overview-closed.js alone, with `extra` globals. Its timer never fires: the tests flush. */
function closedModule(extra = {}) {
  const context = vm.createContext({ Map, Set, Promise, Date, setTimeout: () => 1, clearTimeout() {}, ...extra });
  context.window = context;
  vm.runInContext(closedSource, context);
  return { context, run: code => vm.runInContext(code, context) };
}

test('the labels are the agreed ones', () => {
  const { context } = closedModule();
  assert.equal(context.overviewOlderLabel(3), '+ 3 older');
  assert.equal(context.overviewEarlierLabel(2), '+2 earlier');
  assert.equal(context.overviewMessagesLabel(12), '12 messages');
  assert.equal(context.overviewMessagesLabel(1), '1 message');
  assert.match(closedSource, /<span>Resume<\/span>/);
  assert.match(closedSource, /label: 'Resume'/);
});

test('the page loads the closed cards after the overview', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('session-overview-closed.js') > scripts.indexOf('session-overview.js'));
  assert.ok(scripts.indexOf('session-overview.js') !== -1);
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.indexOf('<link rel="stylesheet" href="session-overview-closed.css">') > head.indexOf('href="session-overview.css"'));
});

test('a preview is kept until the session changes', () => {
  const { context } = closedModule();
  const previews = new Map();
  const session = { sessionId: 'a', modified: '2026-06-15T10:00:00.000Z' };
  assert.equal(context.closedPreviewWanted(previews, session, 0), true);
  assert.equal(context.closedPreviewText(previews, session), null);

  context.keepClosedPreviews(previews, [{ id: 'a', modified: session.modified }], { a: 'Done: the tests pass.' }, 0);
  assert.equal(context.closedPreviewText(previews, session), 'Done: the tests pass.');
  // However long ago it was asked.
  assert.equal(context.closedPreviewWanted(previews, session, 3600000), false);

  // The session moved on: what was kept is stale.
  const changed = { ...session, modified: '2026-06-15T11:00:00.000Z' };
  assert.equal(context.closedPreviewText(previews, changed), null);
  assert.equal(context.closedPreviewWanted(previews, changed, 0), true);
});

test('an empty preview is no preview yet, asked for again a while later', () => {
  const { context, run } = closedModule();
  const retry = run('OVC_EMPTY_RETRY_MS');
  const previews = new Map();
  const session = { sessionId: 'b', modified: '2026-06-15T10:00:00.000Z' };
  // The index has not read the session yet: '' is no text, not an empty message.
  context.keepClosedPreviews(previews, [{ id: 'b', modified: session.modified }], { b: '' }, 1000);
  assert.equal(context.closedPreviewText(previews, session), null);
  assert.equal(context.closedPreviewWanted(previews, session, 1000 + retry - 1), false);
  assert.equal(context.closedPreviewWanted(previews, session, 1000 + retry), true);
  // No answer for it, or no answer at all (the call failed), is the same.
  const other = { sessionId: 'c', modified: 'm' };
  context.keepClosedPreviews(previews, [{ id: 'c', modified: 'm' }], { b: 'not c' }, 0);
  assert.equal(context.closedPreviewText(previews, other), null);
  context.keepClosedPreviews(previews, [{ id: 'c', modified: 'm' }], null, 0);
  assert.equal(context.closedPreviewText(previews, other), null);
  assert.equal(context.closedPreviewWanted(previews, other, retry), true);
});

test('previews are asked for in batches, once per session', async () => {
  const calls = [];
  let answer = null;
  const api = {
    getSessionPreviews: ids => {
      calls.push([...ids]);
      return new Promise(resolve => {
        answer = () => resolve(Object.fromEntries(ids.map(id => [id, id === 's3' ? '' : `last of ${id}`])));
      });
    },
  };
  const { context, run } = closedModule({ api });
  const previews = () => run('ovClosed.previews');
  const sessions = Array.from({ length: 45 }, (_, i) => ({ sessionId: `s${i}`, modified: 'm1' }));
  for (const session of sessions) context.wantClosedPreview(session);
  context.wantClosedPreview(sessions[0]);
  const flushed = context.flushClosedPreviews();
  assert.deepEqual(calls.map(ids => ids.length), [40]);
  // While a batch is out, its sessions are not asked again.
  context.wantClosedPreview(sessions[1]);
  assert.equal(run('ovClosed.queue.size'), 0);
  answer();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(ids => ids.length), [40, 5]);
  answer();
  await flushed;
  assert.equal(new Set(calls.flat()).size, 45);
  assert.equal(context.closedPreviewText(previews(), sessions[4]), 'last of s4');
  assert.equal(context.closedPreviewText(previews(), sessions[3]), null);

  // Kept: nothing goes out again, the empty one included (until its retry).
  for (const session of sessions) context.wantClosedPreview(session);
  await context.flushClosedPreviews();
  assert.equal(calls.length, 2);

  // A session that changed is asked for alone.
  context.wantClosedPreview({ sessionId: 's4', modified: 'm2' });
  const again = context.flushClosedPreviews();
  answer();
  await again;
  assert.deepEqual(calls[2], ['s4']);
});

test('closed cards and "+ N older" take places on the pages, and the keys skip "+ N older"', () => {
  const now = Date.now();
  const at = hours => new Date(now - hours * 3600000).toISOString();
  const app = '/Users/demo/app';
  const sessions = [
    { sessionId: 'live', projectPath: app, modified: at(1) },
    ...[2, 3, 4, 5, 6].map(h => ({ sessionId: `c${h}`, projectPath: app, modified: at(h) })),
  ];
  const prefs = { includeClosed: true, layout: { mode: 'grid-fit', cols: 2, rows: 2 } };
  const context = vm.createContext({
    console, Map, Set, WeakSet, Promise, JSON, Date, Math, Number, Object, Array, String,
    setTimeout, clearTimeout,
    document: { addEventListener() {} },
    localStorage: { getItem: key => (key === 'overview.prefs.v1' ? JSON.stringify(prefs) : null), setItem() {} },
    cachedAllProjects: [{ projectPath: app, sessions }],
    sessionMap: new Map(sessions.map(session => [session.sessionId, session])),
    openSessions: new Map([['live', { session: sessions[0], element: {} }]]),
    isSessionRunning: id => id === 'live',
    attentionSessions: new Set(), responseReadySessions: new Set(), sessionBusyState: new Map(),
    sessionEventTime: session => Date.parse(session.modified),
    visibleSessionCount: 3, sessionMaxAgeDays: 30,
    updateRunningIndicators() {},
  });
  context.window = context;
  vm.runInContext([read('session-list.js'), read('session-overview-model.js'), read('session-overview.js'), closedSource].join('\n'), context);
  // The page as open, its drawing stubbed: what it would draw is ovState.layout.
  context.drawOverviewHeader = () => {};
  context.drawOverviewCards = () => {};
  context.layoutSessionOverview = () => {};
  const run = code => vm.runInContext(code, context);
  const drawn = () => JSON.parse(run('JSON.stringify(ovState.layout.shown.map(item => item.cards.map(card => card.id || `${card.kind}:${card.count}`)))'));
  run('ovState.root = {}');

  // Three closed places (visibleSessionCount), the rest behind "+ 2 older": five places, two pages of four.
  run('renderSessionOverview()');
  assert.deepEqual(drawn(), [['live', 'c2', 'c3', 'c4']]);
  assert.equal(run('ovState.pages'), 2);
  assert.deepEqual(run('JSON.stringify(ovState.order)'), JSON.stringify(['live', 'c2', 'c3', 'c4']));
  assert.deepEqual(run('JSON.stringify([...ovState.pageOf])'), JSON.stringify([['live', 0], ['c2', 0], ['c3', 0], ['c4', 0]]));
  run('ovState.page = 1; renderSessionOverview()');
  assert.deepEqual(drawn(), [['older:2']]);

  // "+ N older" shows them all, after the others, and the keys reach them.
  run('overviewExpanded.add("__all__"); ovState.page = 0; renderSessionOverview()');
  assert.deepEqual(run('JSON.stringify(ovState.order)'), JSON.stringify(['live', 'c2', 'c3', 'c4', 'c5', 'c6']));
  assert.equal(run('ovState.pageOf.get("c6")'), 1);
  run('ovState.page = 1; renderSessionOverview()');
  assert.deepEqual(drawn(), [['c5', 'c6']]);
});

test('closed or archived sessions switched on take their places by the sort', () => {
  const overview = read('session-overview.js');
  const body = header => {
    const start = overview.indexOf(header);
    assert.ok(start !== -1, `${header} not found`);
    return overview.slice(start, overview.indexOf('\n}\n', start) + 2);
  };
  const refreshed = [];
  const context = vm.createContext({
    localStorage: {},
    overviewPrefs: null,
    ovState: { page: 0 },
    ensureOverviewPrefs: () => context.overviewPrefs,
    normalizeOverviewPrefs: prefs => prefs,
    saveOverviewPrefs() {},
    refreshSessionOverview: ({ resort }) => refreshed.push(resort),
  });
  context.overviewPrefs = { includeClosed: false, showArchived: false, group: { by: 'none' }, layout: { mode: 'grid-fit' } };
  vm.runInContext(body('function setOverviewPrefs(') + body('function mergeOverviewPrefs('), context);
  const set = patch => vm.runInContext(`setOverviewPrefs(${JSON.stringify(patch)})`, context);
  // On: the page changes as a whole and re-sorts. Off, or anything else: places kept.
  set({ includeClosed: true });
  set({ showArchived: true });
  set({ includeClosed: false });
  set({ showArchived: false });
  set({ layout: { mode: 'rows' } });
  assert.deepEqual(refreshed, [true, true, false, false, false]);
});

test('a preview call that fails is logged, and asked again only after the retry time', async () => {
  const warns = [];
  let calls = 0;
  let clock = 1000;
  class FakeDate extends Date { static now() { return clock; } }
  const api = { getSessionPreviews: () => { calls++; return Promise.reject(new Error('no handler')); } };
  const { context, run } = closedModule({ api, Date: FakeDate, console: { warn: (...args) => warns.push(args.map(String).join(' ')) } });
  const session = { sessionId: 'f', modified: 'm' };
  context.wantClosedPreview(session);
  await context.flushClosedPreviews();
  assert.equal(calls, 1);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /^\[overview\] Could not read session previews: Error: no handler/);
  assert.equal(context.closedPreviewText(run('ovClosed.previews'), session), null);
  // A render or the card coming back into view does not ask again at once...
  clock += run('OVC_EMPTY_RETRY_MS') - 1;
  context.wantClosedPreview(session);
  assert.equal(run('ovClosed.queue.size'), 0);
  // ...only once the retry time has passed.
  clock += 1;
  context.wantClosedPreview(session);
  await context.flushClosedPreviews();
  assert.equal(calls, 2);
  assert.equal(warns.length, 2);
});

test('a Resume that fails is logged, and the card can be resumed again', async () => {
  const warns = [];
  const adopted = new Set();
  const opened = [];
  const { context, run } = closedModule({
    console: { warn: (...args) => warns.push(args.map(String).join(' ')) },
    sessionMap: new Map([['r', { sessionId: 'r' }]]),
    isSessionOverviewOpen: () => true,
    overviewAdopt: id => adopted.add(id),
    ovState: { adopted },
    openSession: session => { opened.push(session.sessionId); throw new Error('spawn failed'); },
  });
  context.resumeOverviewSession('r');
  assert.equal(run('ovClosed.resuming.has("r")'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['r']);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /^\[overview\] Could not resume the session r: Error: spawn failed/);
  assert.equal(adopted.has('r'), false);
  assert.equal(run('ovClosed.resuming.has("r")'), false);
  context.resumeOverviewSession('r');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['r', 'r']);
});
