// Types for file-selection.js, next to this file.

export const LIST_MAX: number;

/** Whether `rel` is `parent` or inside it. */
export function isWithin(rel: string, parent: string): boolean;
export function selectAll(visible: string[]): Set<string>;
/** The visible rows that were not ticked; ticks on hidden rows go. */
export function invertSelection(visible: string[], picked: Iterable<string>): Set<string>;
export function togglePicked(picked: Iterable<string>, rel: string): Set<string>;
/** What to trash for these ticks: each once, nothing inside a ticked folder. */
export function topLevelPicks(rels: Iterable<string>): string[];
export function trashQuestion(
  entries: { rel: string; isDir: boolean }[],
  options?: { platform?: string; max?: number },
): { title: string; detail: string; confirm: string };
export function remapAfterTrash(rels: Iterable<string>, removed: Iterable<string>): string[];
export function failuresText(failed: { rel: string; error: string }[], max?: number): string;
