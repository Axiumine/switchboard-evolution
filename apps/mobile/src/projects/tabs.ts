export type ProjectTab = 'overview' | 'session' | 'plan' | 'files' | 'git' | 'settings';

/**
 * The project page's tabs, in the desktop's order. Session shows the session
 * opened in the project (its chat or terminal) and is there once one was.
 */
export const PROJECT_TABS: readonly { key: ProjectTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'session', label: 'Session' },
  { key: 'plan', label: 'Plan' },
  { key: 'files', label: 'Files' },
  { key: 'git', label: 'Git' },
  { key: 'settings', label: 'Settings' },
];

/** How far a sideways swipe on the project page must go to change tab, in dp; or how far at least, when fast. */
export const SWIPE_DISTANCE = 64;
export const SWIPE_MIN_DISTANCE = 28;
/** Fast enough (dp/s) for a short swipe to count. */
export const SWIPE_VELOCITY = 600;

/**
 * The tab a sideways swipe on the project page goes to: the next one for a
 * swipe to the left, the one before for a swipe to the right, as the tabs sit
 * in the bar. Null when it was short and slow, more up or down than sideways,
 * or there is no tab that way (no wrapping around).
 */
export function swipeTab(
  tabs: readonly { key: ProjectTab }[],
  active: ProjectTab,
  { dx, dy, vx }: { dx: number; dy: number; vx: number },
): ProjectTab | null {
  const distance = Math.abs(dx);
  const far = distance >= SWIPE_DISTANCE || (distance >= SWIPE_MIN_DISTANCE && Math.abs(vx) >= SWIPE_VELOCITY);
  if (!far || distance < Math.abs(dy) * 1.5) return null;
  const index = tabs.findIndex((tab) => tab.key === active);
  if (index < 0) return null;
  return tabs[index + (dx < 0 ? 1 : -1)]?.key ?? null;
}

/** The Git tab's views, as on the desktop: Changes | History | Worktrees. */
export type GitView = 'changes' | 'history' | 'worktrees';

export const GIT_VIEWS: readonly { key: GitView; label: string }[] = [
  { key: 'changes', label: 'Changes' },
  { key: 'history', label: 'History' },
  { key: 'worktrees', label: 'Worktrees' },
];

/** Tabs that became views of the Git tab, for links made before. */
const MOVED_TO_GIT: Record<string, GitView> = { gitgraph: 'history', worktrees: 'worktrees' };

/** A tab from a route param: anything unknown (missing, a list, a stale link) opens Overview. */
export function parseTab(value: unknown): ProjectTab {
  if (typeof value === 'string' && MOVED_TO_GIT[value]) return 'git';
  return PROJECT_TABS.find((tab) => tab.key === value)?.key ?? 'overview';
}

/** The Git view a route param asks for, if it names one (or one of the old tabs): else null. */
export function parseGitView(value: unknown): GitView | null {
  if (typeof value !== 'string') return null;
  return GIT_VIEWS.find((view) => view.key === value)?.key ?? MOVED_TO_GIT[value] ?? null;
}

/** What the Session tab shows of its session: the conversation or the live terminal. */
export type SessionView = 'chat' | 'terminal';

export function parseSessionView(value: unknown): SessionView | undefined {
  return value === 'chat' || value === 'terminal' ? value : undefined;
}

/** Each tab and Git view keeps its own scroll offset. */
export type ScrollKey = ProjectTab | GitView;
