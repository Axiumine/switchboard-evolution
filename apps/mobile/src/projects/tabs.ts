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
