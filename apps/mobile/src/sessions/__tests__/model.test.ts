import { expect, test } from '@jest/globals';
import { applyLiveEvent, buildSections, cleanDisplayName, elapsedLabel, liveFromStates, noticesFrom, relativeTime, rowState, sessionState, sessionSubtitle, sessionTitle, shortProjectPath, type Folder, type LiveState } from '../model';

const now = Date.parse('2026-11-01T15:00:00Z');
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();

const folders: Folder[] = [
  { folder: 'a', projectPath: '/Users/alex/Code/switchboard', sessions: [
    { sessionId: 'old', projectPath: '/Users/alex/Code/switchboard', summary: 'Old work', modified: at(60 * 30) },
    { sessionId: 'new', projectPath: '/Users/alex/Code/switchboard', aiTitle: 'Tidy up', modified: at(5), starred: 1 },
    { sessionId: 'gone', projectPath: '/Users/alex/Code/switchboard', summary: 'Archived', modified: at(1), archived: 1 },
  ] },
  { folder: 'b', projectPath: '/Users/alex/work/api', sessions: [
    { sessionId: 'busy', projectPath: '/Users/alex/work/api', name: 'Pipeline', modified: at(90) },
  ] },
  { folder: 'c', projectPath: '/tmp/empty', sessions: [] },
];

test('titles follow name, then AI title, then summary, cleaned like the desktop', () => {
  expect(sessionTitle({ sessionId: 'x', projectPath: '/', name: 'Mine', aiTitle: 'AI', summary: 'S' })).toBe('Mine');
  expect(sessionTitle({ sessionId: 'x', projectPath: '/', aiTitle: 'AI', summary: 'S' })).toBe('AI');
  expect(sessionTitle({ sessionId: 'x', projectPath: '/' })).toBe('New session');
  expect(sessionTitle({ sessionId: 'x', projectPath: '/', type: 'terminal' })).toBe('Terminal');
  expect(cleanDisplayName('Implement the following plan:  <command>Fix</command>   it')).toBe('Fix it');
  expect(shortProjectPath('/Users/alex/Code/switchboard')).toBe('Code/switchboard');
});

const ids = (sections: ReturnType<typeof buildSections>) => sections.flatMap((s) => s.data.map((d) => d.sessionId));
const state = (over: Partial<LiveState>): LiveState => ({ busy: false, attention: false, exited: false, starting: false, ...over });

test('grouped by folders: a section each, newest session first, newest folder first', () => {
  const sections = buildSections(folders, { groupByFolders: true });
  expect(sections.map((s) => s.title)).toEqual(['Code/switchboard', 'work/api']);
  expect(sections[0].data.map((s) => s.sessionId)).toEqual(['new', 'old']);
});

test('not grouped (the default): one list without a header, all folders, newest first', () => {
  const sections = buildSections(folders);
  expect(sections).toHaveLength(1);
  expect(sections[0].title).toBe('');
  expect(ids(sections)).toEqual(['new', 'busy', 'old']);
  expect(buildSections([{ folder: 'c', projectPath: '/tmp/empty', sessions: [] }])).toEqual([]);
});

test('time only sorts: an old session is still listed, with no Today cut', () => {
  expect(ids(buildSections(folders, { groupByFolders: true }))).toEqual(['new', 'old', 'busy']);
  expect(ids(buildSections(folders))).toContain('old');
});

test('status filter: running, needs input, not running', () => {
  const live: Record<string, LiveState> = {
    busy: state({ busy: true }),
    old: state({ attention: true }),
    new: state({ exited: true }),
  };
  expect(ids(buildSections(folders, { status: 'running', live }))).toEqual(['busy', 'old']);
  expect(ids(buildSections(folders, { status: 'needsInput', live }))).toEqual(['old']);
  expect(ids(buildSections(folders, { status: 'notRunning', live }))).toEqual(['new']);
  expect(ids(buildSections(folders, { status: 'notRunning' }))).toEqual(['new', 'busy', 'old']);
  expect(ids(buildSections(folders, { status: 'all', live }))).toEqual(['new', 'busy', 'old']);
});

test('a session that is starting counts as running, as the old chip had it', () => {
  expect(ids(buildSections(folders, { status: 'running', live: { old: state({ starting: true }) } }))).toEqual(['old']);
});

test('pinned filter: pinned or not pinned', () => {
  expect(ids(buildSections(folders, { pinned: 'pinned' }))).toEqual(['new']);
  expect(ids(buildSections(folders, { pinned: 'notPinned' }))).toEqual(['busy', 'old']);
  expect(ids(buildSections(folders, { pinned: 'all' }))).toEqual(['new', 'busy', 'old']);
});

test('filters combine and the search matches narrow further', () => {
  const live: Record<string, LiveState> = { busy: state({ busy: true }), new: state({ busy: true }) };
  expect(ids(buildSections(folders, { status: 'running', pinned: 'notPinned', live }))).toEqual(['busy']);
  expect(ids(buildSections(folders, { matches: new Set(['old']) }))).toEqual(['old']);
  expect(ids(buildSections(folders, { matches: new Set(['old', 'busy']), pinned: 'notPinned' }))).toEqual(['busy', 'old']);
});

const mixed: Folder[] = [
  { folder: 'a', projectPath: '/w/alpha', sessions: [
    { sessionId: 'plain-new', projectPath: '/w/alpha', modified: at(1) },
    { sessionId: 'pin-old', projectPath: '/w/alpha', modified: at(500), starred: 1 },
    { sessionId: 'run-old', projectPath: '/w/alpha', modified: at(400) },
  ] },
  { folder: 'b', projectPath: '/w/beta', sessions: [
    { sessionId: 'pin-new', projectPath: '/w/beta', modified: at(10), starred: 1 },
    { sessionId: 'run-pin-old', projectPath: '/w/beta', modified: at(900), starred: 1 },
    { sessionId: 'run-new', projectPath: '/w/beta', modified: at(20), created: at(2000) },
    { sessionId: 'created-only', projectPath: '/w/beta', created: at(5) },
  ] },
];
const mixedLive: Record<string, LiveState> = {
  'run-old': state({ busy: true }),
  'run-pin-old': state({ attention: true }),
  'run-new': state({}),
};

test('"Most recent first" is pure time, modified else created, whatever runs or is pinned', () => {
  expect(ids(buildSections(mixed, { live: mixedLive }))).toEqual(
    ['plain-new', 'created-only', 'pin-new', 'run-new', 'run-old', 'pin-old', 'run-pin-old'],
  );
});

test('"Running & pinned first": running and pinned, then running, then pinned, then time', () => {
  expect(ids(buildSections(mixed, { live: mixedLive, order: 'runningPinned' }))).toEqual(
    ['run-pin-old', 'run-new', 'run-old', 'pin-new', 'pin-old', 'plain-new', 'created-only'],
  );
});

test('grouped, the order applies inside each folder and folders go by their newest session', () => {
  const sections = buildSections(mixed, { live: mixedLive, order: 'runningPinned', groupByFolders: true });
  expect(sections.map((s) => s.title)).toEqual(['w/alpha', 'w/beta']);
  expect(sections[0].data.map((s) => s.sessionId)).toEqual(['run-old', 'pin-old', 'plain-new']);
  expect(sections[1].data.map((s) => s.sessionId)).toEqual(['run-pin-old', 'run-new', 'pin-new', 'created-only']);
});

test('archived sessions are never listed', () => {
  expect(ids(buildSections(folders, { groupByFolders: true }))).not.toContain('gone');
  expect(ids(buildSections(folders))).not.toContain('gone');
});

test('relative times read like the desktop', () => {
  expect(relativeTime(at(0), now)).toBe('just now');
  expect(relativeTime(at(5), now)).toBe('5m ago');
  expect(relativeTime(at(180), now)).toBe('3h ago');
  expect(relativeTime(at(60 * 24 * 2), now)).toBe('2d ago');
  expect(relativeTime(null, now)).toBe('');
});

test('events move a session between working, waiting and stopped', () => {
  let live: Record<string, LiveState> = {};
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', true]);
  expect(sessionState(live.s1)).toBe('busy');
  live = applyLiveEvent(live, 'terminal-notification', ['s1', 'Claude needs your permission', 'attention']);
  expect(sessionState(live.s1)).toBe('attention');
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', true]);
  expect(sessionState(live.s1)).toBe('busy');
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', false]);
  expect(sessionState(live.s1)).toBe('running');
  const same = applyLiveEvent(live, 'terminal-notification', ['s1', 'done', 'idle']);
  expect(same).toBe(live);
  live = applyLiveEvent(live, 'session-forked', ['s1', 's2']);
  expect(live.s1).toBeUndefined();
  expect(sessionState(live.s2)).toBe('running');
  live = applyLiveEvent(live, 'process-exited', ['s2', 0, 0, false]);
  expect(sessionState(live.s2)).toBe('idle');
});

test('the desktop\'s marks arrive as sets, whatever shape they come in', () => {
  const notices = noticesFrom({ ready: ['a', 'b'], attention: ['c'] });
  expect([...notices.ready]).toEqual(['a', 'b']);
  expect(notices.attention.has('c')).toBe(true);
  expect(noticesFrom(null).ready.size).toBe(0);
  expect(noticesFrom({ ready: 'a', attention: [1, 'd'] })).toEqual({ ready: new Set(), attention: new Set(['d']) });
});

test('a row shows needs-you, then working, then unread, then running', () => {
  const idle: LiveState = { busy: false, attention: false, exited: false, starting: false };
  const notices = noticesFrom({ ready: ['done', 'busy', 'asked'], attention: ['asked-on-desktop'] });
  expect(rowState('done', undefined, notices)).toBe('unread');
  expect(rowState('done', idle, notices)).toBe('unread');
  expect(rowState('busy', { ...idle, busy: true }, notices)).toBe('busy');
  expect(rowState('asked', { ...idle, attention: true }, notices)).toBe('attention');
  // Needs-you outlives the process on the desktop until someone opens the session.
  expect(rowState('asked-on-desktop', undefined, notices)).toBe('attention');
  expect(rowState('other', idle, notices)).toBe('running');
  expect(rowState('other', undefined, notices)).toBe('idle');
});

test('a live session remembers since when it works, while it works', () => {
  let live: Record<string, LiveState> = {};
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', true], 1_000);
  expect(live.s1.busySince).toBe(1_000);
  // Still working, or waiting for an answer in the middle: the same start.
  live = applyLiveEvent(live, 'terminal-notification', ['s1', 'Claude needs your permission', 'attention'], 4_000);
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', true], 5_000);
  expect(live.s1.busySince).toBe(1_000);
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', false], 9_000);
  expect(live.s1.busySince).toBeUndefined();
  live = applyLiveEvent(live, 'cli-busy-state', ['s1', true], 12_000);
  expect(live.s1.busySince).toBe(12_000);
  live = applyLiveEvent(live, 'process-exited', ['s1', 0], 13_000);
  expect(live.s1.busySince).toBeUndefined();
});

test('a fresh read of the states keeps the start of work it already knew, and does not invent one', () => {
  const previous: Record<string, LiveState> = { s1: { busy: true, attention: false, exited: false, starting: false, busySince: 1_000 } };
  const live = liveFromStates([
    { sessionId: 's1', busy: true, attention: false, exited: false, starting: false },
    { sessionId: 's2', busy: true, attention: false, exited: false, starting: false },
    { sessionId: 's3', busy: false, attention: true, exited: false, starting: false },
  ], previous);
  expect(live.s1.busySince).toBe(1_000);
  expect(live.s2.busySince).toBeUndefined();
  expect(sessionState(live.s3)).toBe('attention');
});

test('how long a session works, short', () => {
  expect(elapsedLabel(0)).toBe('0s');
  expect(elapsedLabel(44_400)).toBe('44s');
  expect(elapsedLabel(185_000)).toBe('3m 5s');
  expect(elapsedLabel(3_900_000)).toBe('1h 5m');
  expect(elapsedLabel(-5)).toBe('0s');
});

test("a session's subtitle: the CLI, its track, its folder and what it does", () => {
  const session = { sessionId: 's1', projectPath: '/Users/me/code/harbor-app', runtime: 'claude' };
  expect(sessionSubtitle(session, { track: 'Build', state: 'busy', working: '44s' })).toBe('Claude · Build · harbor-app · working 44s');
  expect(sessionSubtitle(session, { state: 'busy' })).toBe('Claude · harbor-app · working');
  expect(sessionSubtitle({ ...session, runtime: 'codex' }, { state: 'attention' })).toBe('Codex · harbor-app · waiting for you');
  expect(sessionSubtitle(session, { state: 'idle' })).toBe('Claude · harbor-app · not running');
  expect(sessionSubtitle(session, { state: 'running' })).toBe('Claude · harbor-app');
});
