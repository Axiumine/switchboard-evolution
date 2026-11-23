export type ProjectTab = 'overview' | 'session' | 'plan' | 'todos' | 'files' | 'git' | 'settings';

/**
 * The project page's tabs, in the desktop's order. Session shows the session
 * opened in the project (its chat or terminal) and is there once one was.
 */
export const PROJECT_TABS: readonly { key: ProjectTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'session', label: 'Session' },
  { key: 'plan', label: 'Plan' },
  { key: 'todos', label: 'Todos' },
  { key: 'files', label: 'Files' },
  { key: 'git', label: 'Git' },
  { key: 'settings', label: 'Settings' },
];

/**
 * The notes after the Plan and Todos tabs, as on the desktop: the phases done
 * of all (`3/7`) and the number of open todos. Nothing for a tab with nothing
 * to count, or while the plan is not there.
 */
export function planTabMeta(data: { error?: string; plan: { done: number; total: number }; todos: { done: boolean }[] } | undefined): Partial<Record<ProjectTab, string>> | undefined {
  if (!data || data.error) return undefined;
  const meta: Partial<Record<ProjectTab, string>> = {};
  if (data.plan.total) meta.plan = `${data.plan.done}/${data.plan.total}`;
  const open = data.todos.filter((t) => !t.done).length;
  if (open) meta.todos = String(open);
  return Object.keys(meta).length ? meta : undefined;
}

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

/**
 * The Git tab's views, as on the desktop: Changes | History | Worktrees | Pull
 * Requests. Pull Requests is "PRs" here, so the four fit across a phone.
 */
export type GitView = 'changes' | 'history' | 'worktrees' | 'pulls';

export const GIT_VIEWS: readonly { key: GitView; label: string; a11y?: string }[] = [
  { key: 'changes', label: 'Changes' },
  { key: 'history', label: 'History' },
  { key: 'worktrees', label: 'Worktrees' },
  { key: 'pulls', label: 'PRs', a11y: 'Pull Requests' },
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
