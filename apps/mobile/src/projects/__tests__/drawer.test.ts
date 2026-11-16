import { describe, expect, it } from '@jest/globals';

import type { Folder, Session } from '@/sessions/model';
import {
  DEFAULT_LIST_UI,
  drawerGroups,
  projectInitials,
  projectListRows,
  sessionsWithoutProject,
  timeBucket,
  trackTint,
  type DrawerState,
  type ListInput,
  type ListRow,
} from '../drawer';
import type { Project, Track } from '../model';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (time: number) => new Date(time).toISOString();

function session(id: string, ago: number, patch: Partial<Session> = {}): Session {
  return { sessionId: id, projectPath: '/code/app', modified: iso(NOW - ago), ...patch };
}

function track(id: string, sessions: Session[], patch: Partial<Track> = {}): Track {
  return { id, name: id.toUpperCase(), status: 'active', cwd: null, cli: null, sessions, ...patch };
}

function project(id: string, patch: Partial<Project> = {}): Project {
  return {
    id, name: id, root: `/code/${id}`, status: 'active', snoozedUntil: null, defaultCwd: null,
    folders: [], tracks: [], schedules: [], sessions: [], ...patch,
  };
}

const quiet = (): DrawerState => '';

describe('timeBucket', () => {
  it('sorts a time into today, yesterday, this week, this month or older', () => {
    expect(timeBucket(NOW - HOUR, NOW)).toBe('today');
    expect(timeBucket(NOW - DAY, NOW)).toBe('yesterday');
    expect(timeBucket(NOW - 4 * DAY, NOW)).toBe('week');
    expect(timeBucket(NOW - 20 * DAY, NOW)).toBe('month');
    expect(timeBucket(NOW - 60 * DAY, NOW)).toBe('older');
  });
});

describe('drawerGroups', () => {
  const p = project('app', {
    sessions: [session('a', HOUR), session('old', 40 * DAY), session('gone', HOUR, { archived: 1 })],
    tracks: [track('t1', [session('b', 2 * HOUR), session('c', DAY)]), track('t2', [], { status: 'done' })],
  });

  it('by time: what is live now, then today, yesterday… newest first, archived left out', () => {
    const groups = drawerGroups(p, 'time', (id) => (id === 'c' ? 'running' : ''), NOW);
    expect(groups.map((g) => [g.title, g.sessions.map((s) => s.sessionId)])).toEqual([
      ['Now', ['c']],
      ['Today', ['a', 'b']],
      ['Older', ['old']],
    ]);
    expect(groups[0].unlimited).toBe(true);
  });

  it('by track: each track, then General; an empty track keeps its heading', () => {
    const groups = drawerGroups(p, 'track', quiet, NOW);
    expect(groups.map((g) => [g.title, g.sessions.length, !!g.done])).toEqual([['T1', 2, false], ['T2', 0, true], ['General', 2, false]]);
    expect(groups[2].track).toBeNull();
    expect(drawerGroups(project('bare'), 'track', quiet, NOW).map((g) => g.title)).toEqual(['General']);
  });

  it('by state: needs input, running, idle, only those with sessions', () => {
    const groups = drawerGroups(p, 'state', (id) => (id === 'b' ? 'attention' : ''), NOW);
    expect(groups.map((g) => [g.title, g.tone, g.sessions.length])).toEqual([['Needs input', 'attention', 1], ['Idle', undefined, 3]]);
  });
});

describe('marks and tints', () => {
  it('takes two letters, from one word or two', () => {
    expect(projectInitials('switchboard')).toBe('SW');
    expect(projectInitials('Organization & SSO')).toBe('OS');
    expect(projectInitials('task-log_test')).toBe('TL');
    expect(projectInitials('  ')).toBe('?');
  });

  it('gives General grey and each track its own hue', () => {
    const p = project('app', { tracks: [track('t1', []), track('t2', [])] });
    expect(trackTint(p, null).fg).toBe('#9090a8');
    expect(trackTint(p, p.tracks[0]).fg).not.toBe(trackTint(p, p.tracks[1]).fg);
  });
});

describe('sessionsWithoutProject', () => {
  it('keeps the sessions no project claims, folders by their newest session', () => {
    const folders: Folder[] = [
      { folder: 'a', projectPath: '/a', sessions: [session('mine', HOUR), session('loose', 3 * DAY)] },
      { folder: 'b', projectPath: '/b', sessions: [session('fresh', HOUR / 2)] },
      { folder: 'c', projectPath: '/c', sessions: [session('mine2', HOUR)] },
    ];
    const projects = [project('p', { sessions: [session('mine', HOUR)], tracks: [track('t', [session('mine2', HOUR)])] })];
    expect(sessionsWithoutProject(folders, projects).map((f) => [f.projectPath, f.sessions.map((s) => s.sessionId)])).toEqual([
      ['/b', ['fresh']],
      ['/a', ['loose']],
    ]);
    expect(sessionsWithoutProject(folders, projects, (s) => s.sessionId === 'loose').map((f) => f.projectPath)).toEqual(['/a']);
  });
});

describe('projectListRows', () => {
  const app = project('app', { sessions: Array.from({ length: 10 }, (_, i) => session(`s${i}`, (i + 1) * 60_000)) });
  const later = project('later', { snoozedUntil: iso(NOW + DAY) });
  const shipped = project('shipped', { status: 'done' });
  const input = (patch: Partial<ListInput> = {}): ListInput => ({
    groups: { active: [app], snoozed: [later], done: [shipped] },
    found: null,
    other: [],
    ui: DEFAULT_LIST_UI,
    stateOf: quiet,
    archivedOf: () => [],
    now: NOW,
    ...patch,
  });
  const kinds = (rows: ListRow[]) => rows.map((r) => (r.kind === 'project' ? `project:${r.project.id}` : r.kind === 'toggle' ? `toggle:${r.section}:${r.open}` : r.kind));

  it('starts with every drawer, Snoozed and Done closed', () => {
    expect(kinds(projectListRows(input()))).toEqual(['section', 'project:app', 'toggle:snoozed:false', 'toggle:done:false']);
  });

  it('opens a drawer under its row: headings, eight rows, then "+ N older"', () => {
    const rows = projectListRows(input({ ui: { ...DEFAULT_LIST_UI, expanded: { app: true } } }));
    const drawer = rows.slice(2, rows.findIndex((r) => r.kind === 'end') + 1);
    expect(drawer.map((r) => r.kind)).toEqual(['head', ...Array(8).fill('session'), 'more', 'end']);
    expect(drawer[0]).toMatchObject({ plus: 'project' });
    expect(drawer[9]).toMatchObject({ label: '+ 2 older', listKey: 'app:time:today' });
  });

  it('shows the whole group once "+ N older" was tapped', () => {
    const rows = projectListRows(input({ ui: { ...DEFAULT_LIST_UI, expanded: { app: true }, expandedLists: { 'app:time:today': true } } }));
    expect(rows.filter((r) => r.kind === 'session')).toHaveLength(10);
  });

  it('puts a + on every track heading in the Track view', () => {
    const tracked = project('tracked', { tracks: [track('t1', [session('x', HOUR)])] });
    const rows = projectListRows(input({ groups: { active: [tracked], snoozed: [], done: [] }, ui: { ...DEFAULT_LIST_UI, groupMode: 'track', expanded: { tracked: true } } }));
    expect(rows.filter((r) => r.kind === 'head').map((r) => (r.kind === 'head' ? r.plus : null))).toEqual(['track']);
    expect(rows.find((r) => r.kind === 'session')).toMatchObject({ showTrack: false });
  });

  it('says an empty project has no sessions, with its +', () => {
    const rows = projectListRows(input({ groups: { active: [project('empty')], snoozed: [], done: [] }, ui: { ...DEFAULT_LIST_UI, expanded: { empty: true } } }));
    expect(rows.slice(2).map((r) => r.kind)).toEqual(['none', 'end']);
    expect(rows[2]).toMatchObject({ plus: true });
  });

  it('adds Archived · N at the foot of a drawer, its rows when open', () => {
    const archived = [session('z', DAY, { archived: 1 })];
    const ui = { ...DEFAULT_LIST_UI, groupMode: 'state' as const, expanded: { app: true } };
    const closed = projectListRows(input({ ui, archivedOf: () => archived }));
    expect(closed.find((r) => r.kind === 'archived')).toMatchObject({ count: 1, open: false });
    const open = projectListRows(input({ ui: { ...ui, archivedOpen: { app: true } }, archivedOf: () => archived }));
    expect(open.filter((r) => r.kind === 'session' && r.archived)).toHaveLength(1);
  });

  it('lists the snoozed and done projects once their toggle is open', () => {
    const rows = projectListRows(input({ ui: { ...DEFAULT_LIST_UI, snoozedOpen: true, doneOpen: true } }));
    expect(kinds(rows)).toEqual(['section', 'project:app', 'toggle:snoozed:true', 'project:later', 'toggle:done:true', 'project:shipped']);
  });

  it('while searching: only the projects found, their matches under them, drawers closed', () => {
    const found = new Map([['app', [app.sessions[0]]]]);
    const rows = projectListRows(input({ found, ui: { ...DEFAULT_LIST_UI, expanded: { app: true } } }));
    expect(kinds(rows)).toEqual(['section', 'project:app', 'found']);
    const opened = projectListRows(input({ found, ui: { ...DEFAULT_LIST_UI, searchOverride: { app: true } } }));
    expect(opened.some((r) => r.kind === 'head')).toBe(true);
    expect(kinds(projectListRows(input({ found: new Map() })))).toEqual(['empty']);
  });

  it('ends with No project, by folder; an old folder starts closed', () => {
    const other = [
      { projectPath: '/fresh', sessions: [session('n1', HOUR)] },
      { projectPath: '/stale', sessions: [session('n2', 10 * DAY)] },
    ];
    const closed = projectListRows(input({ other }));
    expect(closed.at(-1)).toMatchObject({ kind: 'toggle', section: 'other', count: 2, open: false });
    const open = projectListRows(input({ other, ui: { ...DEFAULT_LIST_UI, otherOpen: true } }));
    expect(open.slice(-4).map((r) => (r.kind === 'folder' ? `folder:${r.projectPath}:${r.open}` : r.kind))).toEqual(['folder:/fresh:true', 'session', 'folder:/stale:false', 'end']);
  });
});
