// Types for text-search.js, next to this file. Only what the mobile app uses.

export type SearchOptions = {
  query: string;
  isRegex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
};

export type LineMatch = { column: number; length: number; text: string };

export function escapeRegExp(text: string): string;
/** A global RegExp for the options; throws an Error whose message says what is wrong with the pattern. */
export function buildSearchRegExp(options: SearchOptions): RegExp;
export function matchesInLine(regex: RegExp, line: string, limit?: number): LineMatch[];
/** What replaces one match: the replace text, with $1, $<name>, $& expanded for a regular expression. */
export function replacementFor(
  options: SearchOptions,
  matchText: string,
  replace: string,
  context?: { line: string; column: number } | null,
): string;
export function expandReplacement(replace: string, match: RegExpExecArray): string;
/** One test of a relative path ('/' separators) for a comma-separated glob list, or null for an empty list. */
export function globListMatcher(list: string): ((relPath: string) => boolean) | null;
