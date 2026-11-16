// Types for git-diff-model.js, next to this file. Only what the mobile app uses.

export type DiffLineKind = 'context' | 'add' | 'remove' | 'eof';

export type DiffLine = {
  /** The line's index in diff.split('\n'). */
  index: number;
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type DiffHunk = {
  /** Index of the hunk's `@@` line in diff.split('\n'). */
  index: number;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  section: string;
  lines: DiffLine[];
};

export type ParsedDiff = {
  lines: string[];
  /** Indices of the lines before and between hunks (file header lines). */
  header: number[];
  hunks: DiffHunk[];
  binary: boolean;
  files: number;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  hasModeChange: boolean;
  combined?: boolean;
};

export function parseUnifiedDiff(text: string): ParsedDiff;
/** The indices of every added or removed line, or of those of one hunk (by position in `hunks`). */
export function changedLineIndices(parsed: ParsedDiff, hunkIndex?: number | null): number[];
export function canPickLines(parsed: ParsedDiff | null | undefined): boolean;
