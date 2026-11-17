// Ticked files and folders of the Files tab, moved to the Trash on the
// computer together. The ticking itself (Select All, Invert, which entries to
// trash, the question) comes from the desktop's file-selection.js.

import { isWithin, topLevelPicks } from '@/shared/vendor/file-selection';

import { remapExpanded } from './model';

export type TrashOutcome = { removed: string[]; failed: { rel: string; error: string }[] };

type Call = <T>(method: string, params: unknown[], options?: { timeoutMs?: number }) => Promise<T>;

/** Several entries can take a while: the computer checks and trashes each. */
const TRASH_MANY_TIMEOUT_MS = 120000;

/**
 * Move the ticked entries of `root` to the Trash: in one call when the
 * computer has trash-project-entries, otherwise one entry at a time with
 * manage-project-entry (an older Switchboard Evolution). Never throws for one
 * entry: what could not go is in `failed`.
 */
export async function trashPicked(
  { root, picked, canTrashMany, call }: { root: string; picked: Iterable<string>; canTrashMany: boolean; call: Call },
): Promise<TrashOutcome> {
  const rels = topLevelPicks(picked);
  if (!rels.length) return { removed: [], failed: [] };
  if (canTrashMany) {
    const result = await call<{ removed?: string[]; failed?: { rel: string; error: string }[] }>(
      'trash-project-entries', [root, rels], { timeoutMs: TRASH_MANY_TIMEOUT_MS },
    );
    return { removed: result.removed ?? [], failed: result.failed ?? [] };
  }
  const outcome: TrashOutcome = { removed: [], failed: [] };
  for (const rel of rels) {
    try {
      await call('manage-project-entry', [root, rel, 'trash']);
      outcome.removed.push(rel);
    } catch (err: any) {
      outcome.failed.push({ rel, error: err?.message || String(err) });
    }
  }
  return outcome;
}

/** The open folders and the open file once `removed` went to the Trash. */
export function afterTrash(expanded: string[], selected: string | null, removed: string[]): { expanded: string[]; selected: string | null } {
  let next = expanded;
  for (const rel of removed) next = remapExpanded(next, rel, null);
  const gone = !!selected && removed.some((rel) => isWithin(selected, rel));
  return { expanded: next, selected: gone ? null : selected };
}
