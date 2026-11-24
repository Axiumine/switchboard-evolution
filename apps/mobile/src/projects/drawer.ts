// The Projects tab as the desktop's sidebar lays it out (public/projects-view.js
// in switchboard). A chevron before a project row opens a drawer under it with
// the project's sessions, grouped by time, track or state. Snoozed, Done and
// "No project" fold under chevrons of their own. These are pure functions:
// the screen only draws the rows they return.

import type { Folder, Session } from '@/sessions/model';
import { projectSessions, type Project, type Track } from './model';

export type GroupMode = 'time' | 'track' | 'state';

/** The grouping combo beside the search field, as on the desktop. */
export const GROUP_MODES: readonly { key: GroupMode; label: string }[] = [
  { key: 'time', label: 'Time' },
  { key: 'track', label: 'Track' },
  { key: 'state', label: 'State' },
];

/** Rows a group shows before "+ N older" (the desktop's PANE_GROUP_LIMIT). */
export const GROUP_LIMIT = 8;
/** In the Track view, and per "No project" folder: the desktop's default visible-session count. */
export const LIST_LIMIT = 10;
/** A "No project" folder starts closed once its newest session is older than this (the desktop's default age). */
export const FOLDER_FRESH_DAYS = 3;

const DAY = 86_400_000;

/** All a drawer needs of a session's live state: needs input, running, or neither. */
export type DrawerState = 'attention' | 'running' | '';

/** When a session last moved: its last message, else when it started. */
export function sessionEventTime(session: Pick<Session, 'modified' | 'created'>): number {
  const time = Date.parse(session.modified || session.created || '');
  return Number.isNaN(time) ? 0 : time;
}

const newestFirst = (a: Session, b: Session) => sessionEventTime(b) - sessionEventTime(a);

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export type TimeBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older';

/** Today, yesterday, earlier this week (6 days), earlier this month (29 days), older. */
export function timeBucket(time: number, now: number): TimeBucket {
  const today = startOfDay(now);
  if (time >= today) return 'today';
  if (time >= today - DAY) return 'yesterday';
  if (time >= today - 6 * DAY) return 'week';
  if (time >= today - 29 * DAY) return 'month';
  return 'older';
}

export type DrawerGroup = {
  key: string;
  title: string;
  /** Newest first, archived ones left out. */
  sessions: Session[];
  /** Track view: the group's track, null for General. Its heading has a + that starts a session in it. */
  track?: Track | null;
  /** State view: the colour of the heading. */
  tone?: 'attention' | 'running';
  done?: boolean;
  /** Shown whole, never cut at the limit (what is live now). */
  unlimited?: boolean;
};

/** A project's sessions grouped the three ways the desktop's drawers group them. */
export function drawerGroups(project: Project, mode: GroupMode, stateOf: (sessionId: string) => DrawerState, now: number): DrawerGroup[] {
  const shown = (list: Session[]) => list.filter((s) => !s.archived).sort(newestFirst);

  if (mode === 'track') {
    const groups: DrawerGroup[] = project.tracks.map((track) => ({
      key: track.id, title: track.name, track, sessions: shown(track.sessions), done: track.status === 'done',
    }));
    if (project.sessions.length || !groups.length) groups.push({ key: 'general', title: 'General', track: null, sessions: shown(project.sessions) });
    return groups;
  }

  const all = shown(projectSessions(project));
  if (mode === 'state') {
    const groups: DrawerGroup[] = [
      { key: 'attention', title: 'Needs input', tone: 'attention', sessions: all.filter((s) => stateOf(s.sessionId) === 'attention') },
      { key: 'running', title: 'Running', tone: 'running', sessions: all.filter((s) => stateOf(s.sessionId) === 'running') },
      { key: 'idle', title: 'Idle', sessions: all.filter((s) => !stateOf(s.sessionId)) },
    ];
    return groups.filter((g) => g.sessions.length);
  }

  const buckets: Record<TimeBucket, Session[]> = { today: [], yesterday: [], week: [], month: [], older: [] };
  for (const session of all) if (!stateOf(session.sessionId)) buckets[timeBucket(sessionEventTime(session), now)].push(session);
  const groups: DrawerGroup[] = [
    { key: 'now', title: 'Now', sessions: all.filter((s) => stateOf(s.sessionId)), unlimited: true },
    { key: 'today', title: 'Today', sessions: buckets.today },
    { key: 'yesterday', title: 'Yesterday', sessions: buckets.yesterday },
    { key: 'week', title: 'Earlier this week', sessions: buckets.week },
    { key: 'month', title: 'Earlier this month', sessions: buckets.month },
    { key: 'older', title: 'Older', sessions: buckets.older },
  ];
  return groups.filter((g) => g.sessions.length);
}

/** A hue from the project's id, the same one the desktop gives it. */
export function projectHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** A word counts when it starts with a letter or a digit ("Organization & SSO" is OS, not O&). */
function startsWord(word: string): boolean {
  const first = word.charAt(0);
  return /[0-9]/.test(first) || first.toLowerCase() !== first.toUpperCase() || /[぀-ヿ㐀-鿿가-힯]/.test(first);
}

/** The two letters on a project's mark: the first two of one word, or the first of two. */
export function projectInitials(name: string): string {
  const words = String(name || '').trim().split(/[\s_-]+/).filter((w) => w && startsWord(w));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export type Tint = { fg: string; bg: string };

/** The project mark's colours. */
export function markTint(projectId: string): Tint {
  const h = projectHue(projectId);
  return { fg: `hsl(${h}, 80%, 72%)`, bg: `hsla(${h}, 70%, 60%, 0.18)` };
}

/** One colour per track, spread around the wheel from the project's hue; General is grey. */
export function trackTint(project: Pick<Project, 'id' | 'tracks'>, track: Pick<Track, 'id'> | null | undefined): Tint {
  if (!track) return { fg: '#9090a8', bg: 'rgba(255,255,255,0.08)' };
  const index = Math.max(0, project.tracks.findIndex((t) => t.id === track.id));
  const h = Math.round((projectHue(project.id) + 40 + index * 137.5) % 360);
  return { fg: `hsl(${h}, 78%, 72%)`, bg: `hsla(${h}, 70%, 60%, 0.16)` };
}

export type OtherFolder = { projectPath: string; sessions: Session[] };

/**
 * The sessions no project claims, by folder like the Sessions tab: folders by
 * their newest session, sessions newest first. `keep` narrows them (a search).
 */
export function sessionsWithoutProject(folders: Folder[], projects: Project[], keep: (session: Session) => boolean = () => true): OtherFolder[] {
  const claimed = new Set(projects.flatMap(projectSessions).map((s) => s.sessionId));
  const out: OtherFolder[] = [];
  for (const folder of folders) {
    const sessions = folder.sessions.filter((s) => !claimed.has(s.sessionId) && keep(s)).sort(newestFirst);
    if (sessions.length) out.push({ projectPath: folder.projectPath, sessions });
  }
  return out.sort((a, b) => sessionEventTime(b.sessions[0]) - sessionEventTime(a.sessions[0]));
}

/** What the list remembers while the app runs, as the desktop keeps it per window. */
export type ListUi = {
  groupMode: GroupMode;
  /** projectId → its drawer is open. */
  expanded: Record<string, boolean>;
  /** While a search runs: a chevron's choice for a project (or 'other'), over the search's own. */
  searchOverride: Record<string, boolean>;
  snoozedOpen: boolean;
  doneOpen: boolean;
  otherOpen: boolean;
  /** "No project" folders the user folded (false) or unfolded (true). */
  otherFolders: Record<string, boolean>;
  /** Groups shown whole after "+ N older". */
  expandedLists: Record<string, boolean>;
  /** projectId → its Archived section is open. */
  archivedOpen: Record<string, boolean>;
};

export const DEFAULT_LIST_UI: ListUi = {
  groupMode: 'time', expanded: {}, searchOverride: {}, snoozedOpen: false, doneOpen: false, otherOpen: false,
  otherFolders: {}, expandedLists: {}, archivedOpen: {},
};

export type ListRow =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'toggle'; key: string; section: 'snoozed' | 'done' | 'other'; title: string; count: number; open: boolean }
  | { kind: 'project'; key: string; project: Project; open: boolean }
  /** A drawer's group heading. `plus` starts a session in the group's track (the project's own + is on its row). */
  | { kind: 'head'; key: string; project: Project; group: DrawerGroup; plus: 'track' | null }
  | { kind: 'session'; key: string; project: Project | null; session: Session; showTrack: boolean; archived?: boolean }
  | { kind: 'more'; key: string; listKey: string; label: string }
  | { kind: 'none'; key: string }
  | { kind: 'archived'; key: string; project: Project; count: number; open: boolean }
  | { kind: 'folder'; key: string; projectPath: string; count: number; open: boolean }
  /** The bottom edge of a drawer's card. */
  | { kind: 'end'; key: string }
  /** A search match listed under its project row. */
  | { kind: 'found'; key: string; project: Project; session: Session }
  | { kind: 'empty'; key: string; text: string };

export type ListInput = {
  groups: { starred?: Project[]; active: Project[]; snoozed: Project[]; done: Project[] };
  /** While searching: the projects found, with the sessions to list under each. Null otherwise. */
  found: Map<string, Session[]> | null;
  /** The sessions no project claims, already narrowed to the search's while searching. */
  other: OtherFolder[];
  ui: ListUi;
  stateOf: (sessionId: string) => DrawerState;
  /** A project's archived sessions, newest first ([] until they are known). */
  archivedOf: (projectId: string) => Session[];
  now: number;
};

/** Whether a project's drawer is open: its chevron decides; while searching, only a chevron touched during it. */
export function drawerOpen(ui: ListUi, projectId: string, searching: boolean): boolean {
  return searching ? ui.searchOverride[projectId] === true : !!ui.expanded[projectId];
}

/** "No project" opens by its own toggle, or while a search finds sessions under it. */
export function otherOpen(ui: ListUi, searching: boolean): boolean {
  return searching ? ui.searchOverride.other ?? true : ui.otherOpen;
}

function drawerRows(project: Project, { ui, stateOf, archivedOf, now }: ListInput): ListRow[] {
  const mode = ui.groupMode;
  const base = `d:${project.id}`;
  const rows: ListRow[] = [];
  const groups = drawerGroups(project, mode, stateOf, now);
  if (!groups.length) rows.push({ kind: 'none', key: `${base}:none` });
  groups.forEach((group) => {
    const plus = mode === 'track' ? 'track' : null;
    rows.push({ kind: 'head', key: `${base}:h:${group.key}`, project, group, plus });
    const listKey = `${project.id}:${mode}:${group.key}`;
    const limit = group.unlimited || ui.expandedLists[listKey] ? Infinity : mode === 'track' ? LIST_LIMIT : GROUP_LIMIT;
    for (const session of group.sessions.slice(0, limit)) {
      rows.push({ kind: 'session', key: `${base}:${group.key}:${session.sessionId}`, project, session, showTrack: mode !== 'track' });
    }
    if (!group.sessions.length) rows.push({ kind: 'none', key: `${base}:none:${group.key}` });
    if (group.sessions.length > limit) {
      rows.push({ kind: 'more', key: `${base}:more:${group.key}`, listKey, label: `+ ${group.sessions.length - limit} ${mode === 'time' ? 'older' : 'more'}` });
    }
  });
  const archived = archivedOf(project.id);
  if (archived.length) {
    const open = !!ui.archivedOpen[project.id];
    rows.push({ kind: 'archived', key: `${base}:archived`, project, count: archived.length, open });
    if (open) for (const session of archived) rows.push({ kind: 'session', key: `${base}:a:${session.sessionId}`, project, session, showTrack: true, archived: true });
  }
  rows.push({ kind: 'end', key: `${base}:end` });
  return rows;
}

/** Every row of the Projects tab, top to bottom. */
export function projectListRows(input: ListInput): ListRow[] {
  const { found, ui, other } = input;
  const searching = found !== null;
  const keep = (list: Project[]) => (found ? list.filter((p) => found.has(p.id)) : list);
  const starred = keep(input.groups.starred || []);
  const active = keep(input.groups.active);
  const snoozed = keep(input.groups.snoozed);
  const done = keep(input.groups.done);
  const rows: ListRow[] = [];

  const project = (p: Project) => {
    const open = drawerOpen(ui, p.id, searching);
    rows.push({ kind: 'project', key: `p:${p.id}`, project: p, open });
    if (open) rows.push(...drawerRows(p, input));
    for (const session of found?.get(p.id) || []) rows.push({ kind: 'found', key: `f:${p.id}:${session.sessionId}`, project: p, session });
  };

  if (!starred.length && !active.length && !snoozed.length && !done.length) {
    rows.push({ kind: 'empty', key: 'empty', text: searching ? 'No project matches.' : 'No projects yet.' });
  }
  if (starred.length) {
    rows.push({ kind: 'section', key: 's:starred', title: 'Starred' });
    starred.forEach(project);
  }
  if (active.length) {
    rows.push({ kind: 'section', key: 's:active', title: 'Active' });
    active.forEach(project);
  }
  if (snoozed.length) {
    rows.push({ kind: 'toggle', key: 's:snoozed', section: 'snoozed', title: 'Snoozed', count: snoozed.length, open: ui.snoozedOpen });
    if (ui.snoozedOpen) snoozed.forEach(project);
  }
  if (done.length) {
    rows.push({ kind: 'toggle', key: 's:done', section: 'done', title: 'Done', count: done.length, open: ui.doneOpen });
    if (ui.doneOpen) done.forEach(project);
  }

  const otherCount = other.reduce((n, folder) => n + folder.sessions.length, 0);
  if (otherCount) {
    const open = otherOpen(ui, searching);
    rows.push({ kind: 'toggle', key: 's:other', section: 'other', title: 'No project', count: otherCount, open });
    if (open) {
      for (const folder of other) {
        const newest = sessionEventTime(folder.sessions[0]);
        const fresh = !newest || input.now - newest <= FOLDER_FRESH_DAYS * DAY;
        const folderOpen = searching || (ui.otherFolders[folder.projectPath] ?? fresh);
        rows.push({ kind: 'folder', key: `o:${folder.projectPath}`, projectPath: folder.projectPath, count: folder.sessions.length, open: folderOpen });
        if (!folderOpen) continue;
        const listKey = `other:${folder.projectPath}`;
        const limit = searching || ui.expandedLists[listKey] ? Infinity : LIST_LIMIT;
        for (const session of folder.sessions.slice(0, limit)) {
          rows.push({ kind: 'session', key: `o:${folder.projectPath}:${session.sessionId}`, project: null, session, showTrack: false });
        }
        if (folder.sessions.length > limit) rows.push({ kind: 'more', key: `o:${folder.projectPath}:more`, listKey, label: `+ ${folder.sessions.length - limit} older` });
      }
      rows.push({ kind: 'end', key: 'o:end' });
    }
  }
  return rows;
}
