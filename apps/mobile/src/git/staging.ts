// Staging from the phone, as a Git client does it: the changed files split
// into Merge Changes, Staged Changes and Changes (as VS Code lists them), and
// in a diff the hunks and lines picked to stage or unstage. This is the pure
// part; the requests are in stage-requests.ts.

import { changedLineIndices, canPickLines, type ParsedDiff } from '@/shared/vendor/git-diff-model';
import { colors } from '@/theme';

import type { Change } from './model';

/** Which diff of a file: index → working tree ('unstaged', what Stage acts on) or HEAD → index ('staged', what Unstage acts on). */
export type Side = 'unstaged' | 'staged';

export type SectionKey = 'merge' | 'staged' | 'changes';

export type Section = {
  key: SectionKey;
  title: string;
  /** The diff a row opens, none for a conflict (shown as git shows it). */
  side: Side | null;
  /** What a row's button and the section's button do: stage, or (in Staged Changes) unstage. */
  stage: boolean;
  changes: Change[];
};

/** The index and working tree letters of a change; an older computer sends only `staged`. */
function letters(change: Change): { index: string; worktree: string } {
  return {
    index: change.indexStatus ?? (change.staged ? 'M' : ' '),
    worktree: change.worktreeStatus ?? (change.staged ? ' ' : 'M'),
  };
}

export const isConflicted = (change: Change) => change.status === 'conflicted';

/** In the index: its index letter is neither blank nor `?` (and a conflict is not staged yet). */
export function isStaged(change: Change): boolean {
  if (isConflicted(change)) return false;
  const { index } = letters(change);
  return index !== ' ' && index !== '?';
}

/** Changed in the working tree, or not tracked at all. */
export function isUnstaged(change: Change): boolean {
  if (isConflicted(change)) return false;
  const { worktree } = letters(change);
  return worktree !== ' ';
}

/**
 * The sections of the list, in VS Code's order: Merge Changes (conflicts),
 * Staged Changes, Changes (untracked files too). A file changed in the index
 * and again in the working tree is in both of the last two. Empty ones are left out.
 */
export function stagingSections(changes: Change[]): Section[] {
  const sections: Section[] = [
    { key: 'merge', title: 'Merge Changes', side: null, stage: true, changes: changes.filter(isConflicted) },
    { key: 'staged', title: 'Staged Changes', side: 'staged', stage: false, changes: changes.filter(isStaged) },
    { key: 'changes', title: 'Changes', side: 'unstaged', stage: true, changes: changes.filter(isUnstaged) },
  ];
  return sections.filter((section) => section.changes.length);
}

/**
 * The paths to give stage-project-git-files. Unstaging a rename names both
 * ends of it, or git would leave the deletion of the old name staged.
 */
export function pathsToStage(changes: Change[], stage: boolean): string[] {
  const paths: string[] = [];
  for (const change of changes) {
    paths.push(change.path);
    if (!stage && change.oldPath && /^[RC]$/.test(letters(change).index)) paths.push(change.oldPath);
  }
  return [...new Set(paths)];
}

/**
 * What a section's Stage All / Unstage All sends: null (every change) when
 * there is no conflict to touch, otherwise the section's own paths, so that
 * Changes does not mark conflicts resolved and Staged does not reset them.
 */
export function sectionPaths(section: Section, all: Change[]): string[] | null {
  if (section.key !== 'merge' && !all.some(isConflicted)) return null;
  return pathsToStage(section.changes, section.stage);
}

/** A change's letter on a side: M, A, D, R, C, T, or U for an untracked file. */
export function sideLetter(change: Change, side: Side | null): string {
  const { index, worktree } = letters(change);
  if (isConflicted(change)) return '!';
  const letter = side === 'staged' ? index : worktree;
  return letter === '?' ? 'U' : letter.trim() || '?';
}

const LETTER_COLORS: Record<string, string> = {
  M: colors.attention, T: colors.attention, A: colors.running, U: colors.running, D: colors.danger, R: colors.accent, C: colors.accent, '!': colors.danger,
};

export const letterColor = (letter: string) => LETTER_COLORS[letter] ?? colors.textDim;

// --- A diff, hunks and lines ---

/** The indices (lines of diff.split('\n')) of the lines picked to stage or unstage. */
export type Picked = ReadonlySet<number>;

export const NO_PICKS: Picked = new Set();

export function toggleLine(picked: Picked, index: number): Picked {
  const next = new Set(picked);
  if (!next.delete(index)) next.add(index);
  return next;
}

export type HunkPick = 'none' | 'some' | 'all';

/** How much of a hunk (by its position in `parsed.hunks`) is picked. */
export function hunkPick(parsed: ParsedDiff, hunk: number, picked: Picked): HunkPick {
  const lines = changedLineIndices(parsed, hunk);
  const count = lines.filter((index) => picked.has(index)).length;
  return count === 0 ? 'none' : count === lines.length ? 'all' : 'some';
}

/** Pick all of a hunk's changed lines, or, when they all are, none of them. */
export function toggleHunk(parsed: ParsedDiff, hunk: number, picked: Picked): Picked {
  const lines = changedLineIndices(parsed, hunk);
  const next = new Set(picked);
  if (hunkPick(parsed, hunk, picked) === 'all') for (const index of lines) next.delete(index);
  else for (const index of lines) next.add(index);
  return next;
}

/** The picked lines in order, as stage-project-git-lines takes them. */
export function pickedLines(parsed: ParsedDiff, picked: Picked): number[] {
  return changedLineIndices(parsed).filter((index) => picked.has(index));
}

export type DiffRow =
  | { kind: 'meta'; key: string; text: string }
  | { kind: 'hunk'; key: string; /** Position in `parsed.hunks`. */ hunk: number; text: string }
  | { kind: 'line'; key: string; hunk: number; /** Index in diff.split('\n'). */ index: number; lineKind: 'context' | 'add' | 'remove' | 'eof'; text: string };

/** The diff's lines in order, each as what it is: a header line, a hunk's `@@` line or a line of a hunk. */
export function diffRows(parsed: ParsedDiff): DiffRow[] {
  const hunkAt = new Map<number, number>();
  const lineAt = new Map<number, { hunk: number; kind: 'context' | 'add' | 'remove' | 'eof' }>();
  parsed.hunks.forEach((hunk, position) => {
    hunkAt.set(hunk.index, position);
    for (const line of hunk.lines) lineAt.set(line.index, { hunk: position, kind: line.kind });
  });
  const rows: DiffRow[] = [];
  parsed.lines.forEach((text, index) => {
    if (index === parsed.lines.length - 1 && text === '') return; // what follows the last newline
    const hunk = hunkAt.get(index);
    if (hunk !== undefined) { rows.push({ kind: 'hunk', key: `h${index}`, hunk, text }); return; }
    const line = lineAt.get(index);
    if (line) rows.push({ kind: 'line', key: `l${index}`, hunk: line.hunk, index, lineKind: line.kind, text });
    else rows.push({ kind: 'meta', key: `m${index}`, text });
  });
  return rows;
}

/** Why only the whole file can be staged, or null when hunks and lines can be. */
export function wholeFileOnlyReason(parsed: ParsedDiff, truncated: boolean): string | null {
  if (truncated) return 'This diff is cut short, so only the whole file can be staged.';
  if (canPickLines(parsed)) return null;
  if (parsed.binary) return 'A binary file can only be staged whole.';
  if (parsed.combined) return 'A file in conflict can only be staged whole.';
  if (parsed.isRename) return 'A renamed file can only be staged whole.';
  if (parsed.hasModeChange) return 'A change of file mode can only be staged whole.';
  return 'Only the whole file can be staged.';
}

export const stageVerb = (side: Side) => (side === 'unstaged' ? 'Stage' : 'Unstage');

/** "Stage 3 lines", "Unstage 1 line". */
export function linesLabel(side: Side, count: number): string {
  return `${stageVerb(side)} ${count} ${count === 1 ? 'line' : 'lines'}`;
}

/** What an answer of stage-project-git-lines or -files means. `stale`: the file changed since the diff was read. */
export type StageOutcome = { ok: true } | { ok: false; error: string; stale: boolean };

export function stageOutcome(result: unknown): StageOutcome {
  const r = result as { ok?: boolean; error?: string; code?: string } | null | undefined;
  if (r && typeof r === 'object' && r.ok === true && !r.error) return { ok: true };
  return { ok: false, error: r?.error || 'That did not work', stale: r?.code === 'STALE' };
}
