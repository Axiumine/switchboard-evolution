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

test('sections hold a folder each, newest session first, newest folder first', () => {
  const sections = buildSections(folders, { now });
  expect(sections.map((s) => s.title)).toEqual(['Code/switchboard', 'work/api']);
  expect(sections[0].data.map((s) => s.sessionId)).toEqual(['new', 'old']);
});

test('filters and search matches narrow the list', () => {
  const live: Record<string, LiveState> = { busy: { busy: true, attention: false, exited: false, starting: false } };
  expect(buildSections(folders, { now, filter: 'running', live }).flatMap((s) => s.data.map((d) => d.sessionId))).toEqual(['busy']);
  expect(buildSections(folders, { now, filter: 'starred' }).flatMap((s) => s.data.map((d) => d.sessionId))).toEqual(['new']);
  expect(buildSections(folders, { now, filter: 'today' }).flatMap((s) => s.data.map((d) => d.sessionId))).toEqual(['new', 'busy']);
  expect(buildSections(folders, { now, matches: new Set(['old']) }).flatMap((s) => s.data.map((d) => d.sessionId))).toEqual(['old']);
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
