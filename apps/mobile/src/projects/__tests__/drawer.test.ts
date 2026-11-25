import { describe, expect, it } from '@jest/globals';

import type { Folder, Session } from '@/sessions/model';
import {
  DEFAULT_LIST_UI,
  drawerGroups,
  pinnedSessions,
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

  it('lists the starred projects under Starred, above Active', () => {
    const fav = project('fav', { starred: true });
    const rows = projectListRows(input({ groups: { starred: [fav], active: [app], snoozed: [later], done: [shipped] } }));
    expect(kinds(rows)).toEqual(['section', 'project:fav', 'section', 'project:app', 'toggle:snoozed:false', 'toggle:done:false']);
    expect(rows.filter((r) => r.kind === 'section').map((r) => (r.kind === 'section' ? r.title : ''))).toEqual(['Starred', 'Active']);
  });

  it('opens a drawer under its row: headings, eight rows, then "+ N older"', () => {
    const rows = projectListRows(input({ ui: { ...DEFAULT_LIST_UI, expanded: { app: true } } }));
    const drawer = rows.slice(2, rows.findIndex((r) => r.kind === 'end') + 1);
    expect(drawer.map((r) => r.kind)).toEqual(['head', ...Array(8).fill('session'), 'more', 'end']);
    // The project's own + is on its row, not on the first heading.
    expect(drawer[0]).toMatchObject({ plus: null });
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

  it('says an empty project has no sessions', () => {
    const rows = projectListRows(input({ groups: { active: [project('empty')], snoozed: [], done: [] }, ui: { ...DEFAULT_LIST_UI, expanded: { empty: true } } }));
    expect(rows.slice(2).map((r) => r.kind)).toEqual(['none', 'end']);
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

describe('the pinned sessions of a project', () => {
  const pinnedProject = () => project('app', {
    sessions: [session('loose', HOUR), session('pin-b', HOUR, { starred: 1, pinRank: 1 }), session('old-pin', 40 * DAY, { starred: 1 })],
    tracks: [track('api', [session('pin-a', 2 * HOUR, { starred: 1, pinRank: 0 }), session('api-1', HOUR), session('gone', HOUR, { starred: 1, archived: 1 })])],
  });

  it('lists them in their order, then the ones without a place newest first, without the archived', () => {
    expect(pinnedSessions(pinnedProject()).map((s) => s.sessionId)).toEqual(['pin-a', 'pin-b', 'old-pin']);
  });

  it('come first in every grouping, in a Pinned group, and nowhere else', () => {
    for (const mode of ['time', 'track', 'state'] as const) {
      const groups = drawerGroups(pinnedProject(), mode, (id) => (id === 'api-1' ? 'running' : ''), NOW);
      expect(groups[0]).toMatchObject({ key: 'pinned', title: 'Pinned', unlimited: true, ordered: true });
      expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['pin-a', 'pin-b', 'old-pin']);
      const below = groups.slice(1).flatMap((g) => g.sessions.map((s) => s.sessionId));
      expect(below.filter((id) => id.includes('pin') || id === 'gone')).toEqual([]);
    }
  });

  it('leave no Pinned group when there are none', () => {
    const groups = drawerGroups(project('app', { sessions: [session('loose', HOUR)] }), 'time', quiet, NOW);
    expect(groups.map((g) => g.key)).not.toContain('pinned');
  });

  it('show their track in the drawer, as in the other groups but Track', () => {
    const rows = projectListRows({
      groups: { active: [pinnedProject()], snoozed: [], done: [] }, found: null, other: [],
      ui: { ...DEFAULT_LIST_UI, groupMode: 'track', expanded: { app: true } }, stateOf: quiet, archivedOf: () => [], now: NOW,
    });
    const pinRows = rows.filter((r): r is Extract<ListRow, { kind: 'session' }> => r.kind === 'session' && r.key.includes(':pinned:'));
    expect(pinRows.map((r) => r.session.sessionId)).toEqual(['pin-a', 'pin-b', 'old-pin']);
    expect(pinRows.every((r) => r.showTrack && r.ordered)).toBe(true);
    const others = rows.filter((r) => r.kind === 'session' && !r.key.includes(':pinned:'));
    expect(others.every((r) => r.kind === 'session' && !r.ordered)).toBe(true);
  });
});

describe('the rows ordered by dragging', () => {
  const input = (found: ListInput['found']): ListInput => ({
    groups: { starred: [project('s1', { starred: true }), project('s2', { starred: true })], active: [project('a1'), project('a2'), project('a3')], snoozed: [], done: [] },
    found, other: [], ui: DEFAULT_LIST_UI, stateOf: quiet, archivedOf: () => [], now: NOW,
  });
  const ordered = (rows: ListRow[]) => rows.filter((r) => r.kind === 'project' && r.ordered).map((r) => r.key);

  it('are the Starred section, and only it', () => {
    expect(ordered(projectListRows(input(null)))).toEqual(['p:s1', 'p:s2']);
  });

  it('are none while a search shows only some', () => {
    expect(ordered(projectListRows(input(new Map([['s1', []], ['s2', []], ['a2', []]]))))).toEqual([]);
  });
});
