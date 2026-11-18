// The menu a long press opens on a file or folder of the Git tab's Changes
// list: stage or unstage, Discard Changes… (in "Changes" only), and the
// .gitignore entries the desktop's git-change-actions.js offers for it.

import { discardTargets, ignoreOptions, inTarget, type ChangeTarget } from '@/shared/vendor/git-change-actions';

import type { Change } from './model';
import type { Section } from './staging';

export type ChangeMenuAction = 'stage' | 'unstage' | 'discard' | 'ignore' | 'untrack';
export type ChangeMenuEntry = { action: ChangeMenuAction; label: string; destructive?: boolean };

/** What the computer can do: staging, discarding, editing .gitignore. */
export type ChangeMenuCan = { stage: boolean; discard: boolean; ignore: boolean };

/** The changes of `section` a row stands for: the file itself, or what a folder holds. */
export function sectionChangesIn(section: Section, target: ChangeTarget): Change[] {
  return section.changes.filter((change) => inTarget(change.path, target));
}

export function changeMenu(section: Section, target: ChangeTarget, all: Change[], can: ChangeMenuCan): ChangeMenuEntry[] {
  const entries: ChangeMenuEntry[] = [];
  if (can.stage && sectionChangesIn(section, target).length) {
    entries.push(section.stage
      ? { action: 'stage', label: section.key === 'merge' ? 'Stage (Mark as Resolved)' : 'Stage Changes' }
      : { action: 'unstage', label: 'Unstage Changes' });
  }
  if (section.key === 'changes' && can.discard && discardTargets(all, target).length) {
    entries.push({ action: 'discard', label: 'Discard Changes…', destructive: true });
  }
  if (can.ignore && section.key !== 'merge') {
    const options = ignoreOptions(all, target);
    if (options.ignore) entries.push({ action: 'ignore', label: 'Add to .gitignore' });
    if (options.untrack) entries.push({ action: 'untrack', label: 'Add to .gitignore and Remove from Git…', destructive: true });
  }
  return entries;
}
