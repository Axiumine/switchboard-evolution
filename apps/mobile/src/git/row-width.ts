import type { HistoryRow } from '@/git/history';

// The history list scrolls sideways as far as its widest row, so a long subject
// and every branch name on it can always be read. The list is virtualized: the
// rows not drawn yet are guessed from their text, generously (a row drawn wider
// than its guess widens the list anyway, a guess too wide only leaves room).

export const SUBJECT_SIZE = 14;
export const BADGE_SIZE = 10;
export const META_SIZE = 11;
/** A badge's padding on both sides, and the gap after it. */
export const BADGE_PADDING = 5;
export const BADGE_GAP = 4;
// The widest a character of the app's sans-serif usually is, as a share of the font size.
const CHAR = 0.62;
// The relative time at the end of the line under the subject, at its longest ("11 months ago").
const RELATIVE_TIME = 13;

/** Every ref on a row, in full: its branches, its remote branches (remote/name), its tags. */
export function badgeTexts(row: Pick<HistoryRow, 'refs'>): string[] {
  const refs = row.refs || { heads: [], remotes: [], tags: [] };
  return [...refs.heads, ...refs.remotes.map((r) => `${r.remote}/${r.name}`), ...refs.tags];
}

/** About how wide a row's text is in dp, badges and subject on one line, the hash and author under them. */
export function estimateTextWidth(row: HistoryRow): number {
  const badges = badgeTexts(row).reduce((sum, text) => sum + text.length * BADGE_SIZE * CHAR + 2 * BADGE_PADDING + BADGE_GAP, 0);
  const subject = badges + row.subject.length * SUBJECT_SIZE * CHAR;
  const meta = row.kind === 'commit'
    ? (row.shortHash.length + row.authorName.length + RELATIVE_TIME + 6) * META_SIZE * CHAR
    : 0;
  return Math.ceil(Math.max(subject, meta));
}
