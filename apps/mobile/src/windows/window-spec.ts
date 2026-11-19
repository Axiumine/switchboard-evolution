import { PROJECT_TABS, type ProjectTab } from '@/projects/tabs';

// What a window of its own shows (WindowRoot), sent to it as JSON. The same
// as the desktop's pop-out windows: one tab of a project, Stats, the Task
// Manager. Not the Session tab: as on the desktop the terminal stays in the
// main window.

export type WindowTab = Exclude<ProjectTab, 'session'>;

export const WINDOW_TABS: readonly WindowTab[] = PROJECT_TABS
  .map((t) => t.key)
  .filter((key): key is WindowTab => key !== 'session');

export type WindowSpec =
  | { kind: 'project'; projectId: string; tab: WindowTab }
  | { kind: 'stats' }
  | { kind: 'processes' };

/** The spec in a window's JSON; null when it is not one this app shows. */
export function parseWindowSpec(json: string | undefined): WindowSpec | null {
  if (!json) return null;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const spec = value as Record<string, unknown>;
  if (spec.kind === 'stats' || spec.kind === 'processes') return { kind: spec.kind };
  if (spec.kind === 'project' && typeof spec.projectId === 'string' && spec.projectId
    && WINDOW_TABS.includes(spec.tab as WindowTab)) {
    return { kind: 'project', projectId: spec.projectId, tab: spec.tab as WindowTab };
  }
  return null;
}

/** A window's title (its caption in DeX, its name in Recents): the project and the tab. */
export function windowTitle(spec: WindowSpec, projectName?: string): string {
  if (spec.kind === 'stats') return 'Stats';
  if (spec.kind === 'processes') return 'Task Manager';
  const tab = PROJECT_TABS.find((t) => t.key === spec.tab)?.label ?? spec.tab;
  return projectName ? `${projectName} · ${tab}` : tab;
}
