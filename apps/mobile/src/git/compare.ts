// Comparing 2 to 4 commits of the Git Graph, step by step: A→B, B→C, C→D.
// The desktop answers one pair at a time (get-git-graph-compare-detail), so the
// phone asks for each step and lays the answers out as a table of files × steps.

import type { Change } from './model';

/** Never more than this many commits: 3 steps. */
export const COMPARE_MAX = 4;
/** The Uncommitted Changes row of the history: the working tree. */
export const UNCOMMITTED_HASH = '#uncommitted';

/** One changed file of a step, as get-git-graph-compare-detail sends it. */
export type FileChange = { path: string; oldPath: string | null; status: Change['status']; insertions: number; deletions: number };
export type CompareStep = { from: string; to: string };

/**
 * The selected commits, oldest first. The history is newest first (the
 * Uncommitted Changes row on top), so the oldest has the highest index. A hash
 * that is not in the history any more is dropped.
 */
export function compareOrder(history: { hash: string }[], hashes: Iterable<string>): string[] {
  const wanted = new Set(hashes);
  const picked: { hash: string; index: number }[] = [];
  history.forEach((row, index) => { if (wanted.has(row.hash)) picked.push({ hash: row.hash, index }); });
  return picked.sort((a, b) => b.index - a.index).map((p) => p.hash);
}

/** Consecutive pairs of the ordered commits. */
export function compareSteps(ordered: string[]): CompareStep[] {
  const steps: CompareStep[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) steps.push({ from: ordered[i], to: ordered[i + 1] });
  return steps;
}

/** What the desktop is asked for: the working tree is `null`, not a hash. Only a `to` can be it. */
export function compareTarget(hash: string): string | null {
  return hash === UNCOMMITTED_HASH ? null : hash;
}

/** The short name of a history row in the headers of the comparison. */
export function compareLabel(row: { kind: 'commit' | 'stash' | 'uncommitted'; shortHash: string; stashIndex?: number | null }): string {
  if (row.kind === 'uncommitted') return 'Uncommitted';
  if (row.kind === 'stash' && row.stashIndex != null) return `stash@{${row.stashIndex}}`;
  return row.shortHash;
}

export type MatrixRow<F> = { path: string; cells: (F | null)[] };

/**
 * Every path any step touched, sorted, with that step's entry for it, or null
 * where the file did not change in the step. A renamed file is listed under its
 * new path, which is the one the desktop sends.
 */
export function compareMatrix<F extends { path: string }>(stepFiles: F[][]): MatrixRow<F>[] {
  const byPath = new Map<string, (F | null)[]>();
  stepFiles.forEach((files, step) => {
    for (const file of files) {
      let cells = byPath.get(file.path);
      if (!cells) { cells = stepFiles.map(() => null); byPath.set(file.path, cells); }
      cells[step] = file;
    }
  });
  return [...byPath.keys()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((path) => ({ path, cells: byPath.get(path)! }));
}
