import { expect, test } from '@jest/globals';

import type { Project } from '@/projects/model';
import { isLive, matchesWithTitles, projectSearchResults, runningAmong, stopQuestion, titleMatches } from '../search-stop';
import type { Session } from '../model';

const s = (sessionId: string, extra: Partial<Session> = {}): Session => ({ sessionId, projectPath: '/src/app', ...extra });

test('a title match finds sessions the index has not seen, case-insensitively', () => {
  expect(titleMatches(s('a', { name: 'npm run dev' }), 'RUN')).toBe(true);
  expect(titleMatches(s('b', { aiTitle: 'Deploy api' }), ' deploy ')).toBe(true);
  expect(titleMatches(s('c', { summary: 'Login page' }), 'login')).toBe(true);
  expect(titleMatches(s('d', { name: 'npm run dev' }), '')).toBe(false);
  const ids = matchesWithTitles(['x'], [s('a', { name: 'Fix login' }), s('b', { summary: 'other' })], 'login');
  expect([...ids].sort()).toEqual(['a', 'x']);
});

test('a session is live while its process runs, whatever it is doing', () => {
  expect(isLive(undefined)).toBe(false);
  expect(isLive({ busy: false, attention: false, exited: true, starting: false })).toBe(false);
  expect(isLive({ busy: true, attention: false, exited: false, starting: false })).toBe(true);
  expect(isLive({ busy: false, attention: false, exited: false, starting: false })).toBe(true);
});

const project = (id: string, name: string, sessions: Session[], trackSessions: Session[] = []): Project => ({
  id, name, root: `/p/${id}`, status: 'active', snoozedUntil: null, defaultCwd: null, folders: [], schedules: [],
  sessions, tracks: trackSessions.length ? [{ id: `${id}-t`, name: 'Track', status: 'active', cwd: null, cli: null, sessions: trackSessions }] : [],
});
const projects = [
  project('p1', 'Payments', [s('s1'), s('s2')], [s('s3')]),
  project('p2', 'Docs', [s('d1'), s('d2')]),
  project('p3', 'Website', [s('x1')]),
];
const running = new Set(['s2', 's3', 'd2']);
const find = (query: string, matchIds: string[], opts = {}) => projectSearchResults(projects, {
  query, matchIds: new Set(matchIds), isRunning: (id) => running.has(id), ...opts,
}).map((r) => [r.project.id, r.sessions.map((x) => x.sessionId)]);

test('the Projects tab lists matching sessions under their project, and the running ones of a project found by name', () => {
  expect(find('pay', ['d1'])).toEqual([['p1', ['s2', 's3']], ['p2', ['d1']]]);
  expect(find('zzz', ['s1'])).toEqual([['p1', ['s1']]]);
});

test('projects and sessions left out of the search are gone from it', () => {
  expect(find('pay', ['d1'], { excludedProjects: new Set(['p2']) })).toEqual([['p1', ['s2', 's3']]]);
  expect(find('pay', ['d1'], { excludedSessions: new Set(['s3', 'd1']) })).toEqual([['p1', ['s2']], ['p2', []]]);
});

test('Stop ends the running sessions shown, each once, after one question', () => {
  const shown = [s('s1', { name: 'One' }), s('s2', { name: 'Two' }), s('s2', { name: 'Two' }), s('d2', { name: 'Docs build' })];
  const toStop = runningAmong(shown, (id) => running.has(id));
  expect(toStop.map((x) => x.sessionId)).toEqual(['s2', 'd2']);
  const question = stopQuestion(toStop, new Set(['d2']), ' api ');
  expect(question.title).toBe('Stop 2 running sessions matching "api"?');
  expect(question.message).toBe('1 session is mid-turn; stopping interrupts work in progress.\n\nTwo\nDocs build  · working');
});
