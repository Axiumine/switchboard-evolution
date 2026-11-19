// The session list, as the desktop's Sessions tab builds it (public/sidebar.js
// and public/utils.js in switchboard): one list, newest first, or grouped by
// the folder they run in, with each session's live state.

/** A session as get-projects returns it. */
export type Session = {
  sessionId: string;
  summary?: string | null;
  firstPrompt?: string | null;
  name?: string | null;
  aiTitle?: string | null;
  created?: string | null;
  modified?: string | null;
  messageCount?: number;
  projectPath: string;
  runtime?: string | null;
  type?: string;
  starred?: number;
  /** A pinned session's star color, an index into STAR_TINTS (star-tints.js); none from an older desktop. */
  starTint?: number | null;
  archived?: number;
  projectId?: string | null;
  trackId?: string | null;
};

/** A folder as get-projects returns it. */
export type Folder = { folder: string; projectPath: string; sessions: Session[] };

/**
 * A live PTY, from get-session-states and the events that follow.
 * `busySince` is when this phone saw it start working (ms); unknown when it
 * was already working when the phone connected.
 */
export type LiveState = { busy: boolean; attention: boolean; exited: boolean; starting: boolean; busySince?: number };

/** The status combo: running is any live session that has not exited, needs input is one asking for you. */
export type StatusFilter = 'all' | 'running' | 'needsInput' | 'notRunning';
/** The pinned combo. */
export type PinFilter = 'all' | 'pinned' | 'notPinned';
/** The order combo: pure time, or running and pinned sessions first. */
export type SessionOrder = 'recent' | 'runningPinned';

export const STATUS_FILTERS: readonly { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'needsInput', label: 'Needs input' },
  { key: 'notRunning', label: 'Not running' },
];

export const PIN_FILTERS: readonly { key: PinFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'notPinned', label: 'Not pinned' },
];

/** `short` is what the combo button reads on a narrow screen. */
export const SESSION_ORDERS: readonly { key: SessionOrder; label: string; short: string }[] = [
  { key: 'recent', label: 'Most recent first', short: 'Recent first' },
  { key: 'runningPinned', label: 'Running & pinned first', short: 'Running first' },
];

export type SessionState = 'attention' | 'busy' | 'running' | 'idle';

/**
 * Unread and needs-you marks, as the desktop window keeps them: a session that
 * finished, or asked for something, while nobody was looking. Opening it on
 * the desktop or on a phone clears them.
 */
export type Notices = { ready: Set<string>; attention: Set<string> };

/** What a row shows: the live states, plus finished and not yet read. */
export type RowState = SessionState | 'unread';

/** Same cleanup as the desktop's cleanDisplayName. */
export function cleanDisplayName(name: string | null | undefined): string {
  if (!name) return '';
  let text = name;
  const prefix = 'Implement the following plan:';
  if (text.startsWith(prefix)) text = text.slice(prefix.length).trim();
  text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\/?>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Name, then the CLI's title, then the summary, as the desktop shows it. */
export function sessionTitle(session: Session): string {
  if (session.type === 'terminal') return cleanDisplayName(session.name) || 'Terminal';
  return cleanDisplayName(session.name || session.aiTitle || session.summary) || 'New session';
}

/** The last two parts of a path: "Switchboard/contributions". */
export function shortProjectPath(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

export function cliLabel(session: Pick<Session, 'type' | 'runtime'>): string {
  if (session.type === 'terminal') return 'Terminal';
  return session.runtime === 'codex' ? 'Codex' : 'Claude';
}

function sessionTime(session: Session): number {
  const time = Date.parse(session.modified || session.created || '');
  return Number.isNaN(time) ? 0 : time;
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const time = Date.parse(iso || '');
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(time);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** What a row shows: waiting for you first, then working, then just running. */
export function sessionState(live: LiveState | undefined): SessionState {
  if (!live || live.exited) return 'idle';
  if (live.attention) return 'attention';
  if (live.busy) return 'busy';
  return 'running';
}

/** The marks from get-session-notices or its event. */
export function noticesFrom(raw: unknown): Notices {
  const ids = (list: unknown) => new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  const value = (raw && typeof raw === 'object' ? raw : {}) as { ready?: unknown; attention?: unknown };
  return { ready: ids(value.ready), attention: ids(value.attention) };
}

/** Needs-you first (live, or kept by the desktop), then working, then unread, as the desktop orders them. */
export function rowState(sessionId: string, live: LiveState | undefined, notices: Notices): RowState {
  const state = sessionState(live);
  if (state === 'attention' || notices.attention.has(sessionId)) return 'attention';
  if (state === 'busy') return 'busy';
  if (notices.ready.has(sessionId)) return 'unread';
  return state;
}

export type Section = { title: string; projectPath: string; data: Session[] };

export type SessionListOptions = {
  status?: StatusFilter;
  pinned?: PinFilter;
  order?: SessionOrder;
  /** One section per folder; off (the default) is a single list with an empty title. */
  groupByFolders?: boolean;
  live?: Record<string, LiveState>;
  matches?: Set<string> | null;
};

/** Running and pinned first, then running, then pinned, then the rest; time breaks ties. */
function runningPinnedRank(session: Session, live: Record<string, LiveState>): number {
  const running = sessionState(live[session.sessionId]) !== 'idle';
  const pinned = !!session.starred;
  return running && pinned ? 0 : running ? 1 : pinned ? 2 : 3;
}

/**
 * The sessions after the status and pinned filters and an optional set of
 * search matches, in the chosen order: one list, or one section per folder
 * (newest session first among folders). Archived sessions and empty folders
 * are left out. Time only sorts, it never filters.
 */
export function buildSections(
  folders: Folder[],
  { status = 'all', pinned = 'all', order = 'recent', groupByFolders = false, live = {}, matches = null }: SessionListOptions = {},
): Section[] {
  const keep = (session: Session) => {
    if (session.archived) return false;
    if (matches && !matches.has(session.sessionId)) return false;
    const state = sessionState(live[session.sessionId]);
    if (status === 'running' && state === 'idle') return false;
    if (status === 'needsInput' && state !== 'attention') return false;
    if (status === 'notRunning' && state !== 'idle') return false;
    if (pinned === 'pinned' && !session.starred) return false;
    if (pinned === 'notPinned' && session.starred) return false;
    return true;
  };
  const compare = (a: Session, b: Session) => {
    if (order === 'runningPinned') {
      const rank = runningPinnedRank(a, live) - runningPinnedRank(b, live);
      if (rank) return rank;
    }
    return sessionTime(b) - sessionTime(a);
  };
  if (!groupByFolders) {
    const data = folders.flatMap((folder) => folder.sessions.filter(keep)).sort(compare);
    return data.length ? [{ title: '', projectPath: '', data }] : [];
  }
  return folders
    .map((folder) => ({
      title: shortProjectPath(folder.projectPath),
      projectPath: folder.projectPath,
      data: folder.sessions.filter(keep).sort(compare),
    }))
    .filter((section) => section.data.length > 0)
    .sort((a, b) => Math.max(...b.data.map(sessionTime)) - Math.max(...a.data.map(sessionTime)));
}

/**
 * The live states from get-session-states. A session that was working and
 * still is keeps the start the phone saw; one found working has none.
 */
export function liveFromStates(states: any[], previous: Record<string, LiveState> = {}): Record<string, LiveState> {
  const live: Record<string, LiveState> = {};
  for (const s of states) {
    const state: LiveState = { busy: !!s.busy, attention: !!s.attention, exited: !!s.exited, starting: !!s.starting };
    const before = previous[s.sessionId];
    if (state.busy && before?.busy && before.busySince !== undefined) state.busySince = before.busySince;
    live[s.sessionId] = state;
  }
  return live;
}

/** Apply one event from the desktop to the live states. Returns a new map, or the same one if nothing changed. */
export function applyLiveEvent(live: Record<string, LiveState>, event: string, args: any[], now = Date.now()): Record<string, LiveState> {
  const [id] = args;
  if (typeof id !== 'string') return live;
  const current = live[id] || { busy: false, attention: false, exited: false, starting: false };
  switch (event) {
    case 'cli-busy-state': {
      const busy = !!args[1];
      const busySince = busy ? (current.busy ? current.busySince : now) : undefined;
      // Working again means the question was answered.
      return { ...live, [id]: { ...current, exited: false, busy, attention: busy ? false : current.attention, busySince } };
    }
    case 'terminal-notification':
      return args[2] === 'attention' ? { ...live, [id]: { ...current, attention: true } } : live;
    case 'process-exited':
      return { ...live, [id]: { ...current, exited: true, busy: false, attention: false, busySince: undefined } };
    case 'session-detected':
    case 'session-forked': {
      const [oldId, newId] = args;
      if (typeof newId !== 'string' || !live[oldId]) return live;
      const { [oldId]: moved, ...rest } = live;
      return { ...rest, [newId]: moved };
    }
    default:
      return live;
  }
}

/** How long something has run: "44s", "3m 5s", "1h 5m". */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The line under a session's title: "Claude · Build · harbor-app · working 44s".
 * `working` is how long it has worked, when known.
 */
export function sessionSubtitle(session: Pick<Session, 'type' | 'runtime' | 'projectPath'>, { track, state, working }: { track?: string | null; state: SessionState; working?: string }): string {
  const folder = session.projectPath.split(/[\\/]/).filter(Boolean).pop();
  const doing = state === 'busy' ? (working ? `working ${working}` : 'working')
    : state === 'attention' ? 'waiting for you'
      : state === 'idle' ? 'not running' : '';
  return [cliLabel(session), track, folder, doing].filter(Boolean).join(' · ');
}
