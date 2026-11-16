import { expect, test } from '@jest/globals';

import type { Project, Schedule, Track } from '../model';
import {
  branchHelp, busyNote, cliChoices, detachQuestion, folderDetail, listLines, markDoneQuestion, projectBranchName, projectCwdChoices, projectHue,
  runningWorkLines, trackColor, trackCwdChoices, trackDoneQuestion, type RunningWork,
} from '../settings';

const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, name: id, status: 'active', cwd: null, cli: null, sessions: [], ...extra });

const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Web', root: '/Users/alex/Switchboard/web', status: 'active', snoozedUntil: null, defaultCwd: null,
  folders: [
    { path: '/code/app', mode: 'in-place' },
    { path: '/Users/alex/Switchboard/web/repos/api', mode: 'worktree', sourcePath: '/code/api', branch: 'web' },
  ],
  tracks: [], schedules: [], sessions: [], ...extra,
});

const schedule = (name: string, extra: Partial<Schedule> = {}): Schedule => ({
  id: name, name, prompt: 'x', projectId: 'p1', trackId: null, cwd: null, every: 'day',
  atHour: 9, atMinute: 0, weekday: null, cron: null, cli: null, enabled: true, lastRunAt: null, ...extra,
});

const nothing: RunningWork = { sessions: [], tasks: [] };

test('sessions start in the project folder, an attached folder, or a folder set elsewhere', () => {
  expect(projectCwdChoices(project())).toEqual([
    { key: '', label: 'Project folder (web)' },
    { key: '/code/app', label: 'app' },
    { key: '/Users/alex/Switchboard/web/repos/api', label: 'api' },
  ]);
  expect(projectCwdChoices(project({ defaultCwd: '/code/app/src' })).map((c) => c.key)).toContain('/code/app/src');
});

test('a track starts where the project does, or in the project folder when the default is elsewhere', () => {
  expect(trackCwdChoices(project(), track('t1')).slice(0, 2)).toEqual([
    { key: '', label: 'Project default (web)' },
    { key: '/code/app', label: 'app' },
  ]);
  expect(trackCwdChoices(project({ defaultCwd: '/code/app' }), track('t1')).slice(0, 3)).toEqual([
    { key: '', label: 'Project default (app)' },
    { key: '/Users/alex/Switchboard/web', label: 'Project folder (web)' },
    { key: '/code/app', label: 'app' },
  ]);
});

test('a track\'s CLI: ask each time, the enabled ones, and one that is gone', () => {
  const harnesses = [{ id: 'claude', label: 'Claude', enabled: true }, { id: 'codex', label: 'Codex', enabled: false }];
  expect(cliChoices(harnesses, null)).toEqual([{ key: '', label: 'Ask each time' }, { key: 'claude', label: 'Claude' }]);
  expect(cliChoices(harnesses, 'codex').map((c) => c.key)).toEqual(['', 'claude', 'codex']);
  expect(cliChoices(undefined, null).map((c) => c.key)).toEqual(['', 'claude']);
});

test('tracks of a project get different colors, from the project\'s hue', () => {
  const p = project({ tracks: [track('a'), track('b')] });
  expect(projectHue('p1')).toBe(projectHue('p1'));
  expect(trackColor(p, p.tracks[0])).not.toBe(trackColor(p, p.tracks[1]));
  expect(trackColor(p, p.tracks[0])).toMatch(/^hsl\(\d+, 78%, 72%\)$/);
});

test('the worktree branch is the shared name, else the slug, unless each worktree names its own', () => {
  expect(projectBranchName({ slug: 'web' })).toBe('web');
  expect(projectBranchName({ slug: 'web', branchName: 'feat/web' })).toBe('feat/web');
  expect(projectBranchName({ slug: 'web', sharedBranch: false, branchName: 'feat/web' })).toBeNull();
  expect(branchHelp(true)).toBe('Every new worktree checks out this branch.');
  expect(branchHelp(false)).toBe('Each worktree names its own branch when you attach it.');
});

test('a folder says its branch and state, then where it lives or came from', () => {
  const [inPlace, worktree] = project().folders;
  expect(folderDetail(inPlace, { git: true, branch: 'main', dirty: true })).toBe('on main · modified · /code/app');
  expect(folderDetail(inPlace, { git: false })).toBe('/code/app');
  expect(folderDetail(inPlace, null)).toBe('/code/app');
  expect(folderDetail(worktree, { git: true, branch: 'web', dirty: false })).toBe('on web · from /code/api');
});

test('marking done asks only when something stops, pauses or can be deleted', () => {
  expect(markDoneQuestion(project(), { running: nothing, schedules: [], worktrees: [] })).toBeNull();

  const running: RunningWork = { sessions: [{ sessionId: 's1', title: 'Fix login', busy: true }, { sessionId: 's2', title: 'Docs', busy: false }], tasks: [{ projectPath: '/code/app', label: 'dev' }] };
  expect(runningWorkLines(running)).toEqual(['Fix login · working', 'Docs', 'dev']);
  expect(busyNote(running)).toBe('1 session is mid-turn; stopping interrupts work in progress.');

  const q = markDoneQuestion(project(), {
    running,
    schedules: [schedule('Nightly')],
    worktrees: [{ path: '/Users/alex/Switchboard/web/repos/api', branch: 'web', dirty: true }],
  })!;
  expect(q.title).toBe('Mark Web as done?');
  expect(q.deleteLabel).toBe('Mark as done and delete worktree');
  expect(q.message).toContain('Stops now:\n1 session is mid-turn');
  expect(q.message).toContain('• Fix login · working');
  expect(q.message).toContain('Pauses until reopened:\n• Nightly');
  expect(q.message).toContain('Worktree:\n• api · web · uncommitted changes');
  expect(q.message).toContain('It has uncommitted changes. Deleting loses them.');

  const two = markDoneQuestion(project(), { running: nothing, schedules: [], worktrees: [{ path: '/a', branch: '', dirty: false }, { path: '/b', branch: 'x', dirty: true }] })!;
  expect(two.deleteLabel).toBe('Mark as done and delete worktrees');
  expect(two.message).toContain('1 of them has uncommitted changes.');
  expect(two.message).not.toContain('Stops now');
});

test('long lists are cut, and the questions for tracks and folders say what stays', () => {
  expect(listLines(['a', 'b', 'c'], 2)).toBe('• a\n• b\n+ 1 more');
  expect(trackDoneQuestion(track('t1', { name: 'API' }), [schedule('a', { trackId: 't1' }), schedule('b', { trackId: 't1', enabled: false }), schedule('c')]))
    .toBe('1 scheduled task in it will pause until the track is reopened.');
  expect(trackDoneQuestion(track('t2'), [schedule('a', { trackId: 't1' })])).toBeNull();
  const [inPlace, worktree] = project().folders;
  expect(detachQuestion(project(), inPlace)).toEqual({
    title: 'Detach app from Web?',
    message: 'New sessions of the project stop working in it. Nothing on disk changes.\n\n/code/app',
  });
  expect(detachQuestion(project(), worktree).message).toContain('the branch web and its commits stay');
});
