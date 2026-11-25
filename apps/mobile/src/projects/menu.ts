import { projectSnoozed } from '@/shared/vendor/snooze';
import type { Project } from './model';

export type ProjectMenuAction =
  | 'new-session' | 'rename' | 'new-track' | 'note' | 'attach-folder' | 'star' | 'wake' | 'snooze' | 'done' | 'settings' | 'remove';
export type ProjectMenuEntry = { action: ProjectMenuAction; label: string; destructive?: boolean };

/**
 * A project's actions, in the order of its menu: the sheet the ⋯ of the
 * project page opens, and a long press on the project in the Projects list.
 * A snoozed project wakes instead of snoozing; a done one has neither.
 */
export function projectMenu(project: Pick<Project, 'status' | 'snoozedUntil' | 'starred'>, now: number): ProjectMenuEntry[] {
  const done = project.status === 'done';
  const entries: ProjectMenuEntry[] = [
    { action: 'new-session', label: 'New session…' },
    { action: 'rename', label: 'Rename…' },
    { action: 'new-track', label: 'New track…' },
    { action: 'note', label: 'Note' },
    { action: 'attach-folder', label: 'Attach a folder…' },
    { action: 'star', label: project.starred ? 'Unstar' : 'Star' },
  ];
  if (!done) entries.push(projectSnoozed(project, now) ? { action: 'wake', label: 'Wake now' } : { action: 'snooze', label: 'Snooze…' });
  entries.push(
    { action: 'done', label: done ? 'Reopen' : 'Mark as done' },
    { action: 'settings', label: 'Settings' },
    { action: 'remove', label: 'Remove project…', destructive: true },
  );
  return entries;
}
