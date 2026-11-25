import { PROJECT_TABS, type ProjectTab } from '@/projects/tabs';
import { inAppWebUrl } from '@/pulls/model';

// What a window of its own shows (WindowRoot), sent to it as JSON. The same
// as the desktop's pop-out windows: one tab of a project, Stats, the Task
// Manager, a project's note, a pull request's page on GitHub, and a session's
// Commands panel. Not the Session tab: as on the desktop the terminal stays
// in the main window.

export type WindowTab = Exclude<ProjectTab, 'session'>;

export const WINDOW_TABS: readonly WindowTab[] = PROJECT_TABS
  .map((t) => t.key)
  .filter((key): key is WindowTab => key !== 'session');

export type WindowSpec =
  | { kind: 'project'; projectId: string; tab: WindowTab }
  | { kind: 'note'; projectId: string }
  | { kind: 'stats' }
  | { kind: 'processes' }
  | { kind: 'web'; url: string; title: string }
  /** A session's command catalog (CommandsPanel 'window'): a pick types into that session. */
  | { kind: 'commands'; sessionId: string; runtime: string | null; type: string | null; title: string };

/** The spec in a window's JSON; null when it is not one this app shows. */
export function parseWindowSpec(json: string | undefined): WindowSpec | null {
  if (!json) return null;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const spec = value as Record<string, unknown>;
  if (spec.kind === 'stats' || spec.kind === 'processes') return { kind: spec.kind };
  if (spec.kind === 'web') {
    const url = inAppWebUrl(spec.url);
    return url ? { kind: 'web', url, title: typeof spec.title === 'string' ? spec.title.slice(0, 200) : '' } : null;
  }
  if (spec.kind === 'note' && typeof spec.projectId === 'string' && spec.projectId) return { kind: 'note', projectId: spec.projectId };
  if (spec.kind === 'commands' && typeof spec.sessionId === 'string' && spec.sessionId) {
    const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
    return { kind: 'commands', sessionId: spec.sessionId, runtime: text(spec.runtime, 40) || null, type: text(spec.type, 40) || null, title: text(spec.title, 200) };
  }
  if (spec.kind === 'project' && typeof spec.projectId === 'string' && spec.projectId
    && WINDOW_TABS.includes(spec.tab as WindowTab)) {
    return { kind: 'project', projectId: spec.projectId, tab: spec.tab as WindowTab };
  }
  return null;
}

/** A window's title (its caption in DeX, its name in Recents): the project and the tab, "Note", or the pull request. */
export function windowTitle(spec: WindowSpec, projectName?: string): string {
  if (spec.kind === 'web') return spec.title || 'Pull request';
  if (spec.kind === 'stats') return 'Stats';
  if (spec.kind === 'processes') return 'Task Manager';
  if (spec.kind === 'commands') return spec.title ? `Commands · ${spec.title}` : 'Commands';
  if (spec.kind === 'note') return projectName ? `${projectName} · Note` : 'Note';
  const tab = PROJECT_TABS.find((t) => t.key === spec.tab)?.label ?? spec.tab;
  return projectName ? `${projectName} · ${tab}` : tab;
}
