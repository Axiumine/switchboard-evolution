// Types for text-search.js, next to this file. Only what the mobile app uses.

export type SearchOptions = {
  query: string;
  isRegex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  /** Replace in the case of the matched text (VS Code's Preserve Case). */
  preserveCase?: boolean;
};

/** A match in a document: [from, to) as offsets in its text. */
export type DocumentMatch = { from: number; to: number };

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
/** $1, $<name>, $&, \n, \t, \\ and \u \l \U \L expanded from a regular expression's match. */
export function expandReplacement(replace: string, match: RegExpExecArray): string;
/** The replacement in the case of the matched text (VS Code's Preserve Case). */
export function preserveCase(matched: string, replacement: string): string;
/** One test of a relative path ('/' separators) for a comma-separated glob list, or null for an empty list. */
export function globListMatcher(list: string): ((relPath: string) => boolean) | null;
/** The most matches a document search gives. */
export const MATCH_LIMIT: number;
/** The query as a RegExp for a whole document (global and multiline: ^ and $ at every line). */
export function documentRegExp(options: SearchOptions): RegExp;
/** The matches of a global RegExp in `text`, inside `scope` when given, at most `limit`; empty matches skipped. */
export function findAllMatches(text: string, regex: RegExp, scope?: DocumentMatch[] | null, limit?: number): DocumentMatch[];
/** The index of the first match that ends after `pos`. */
export function firstMatchAfter(matches: DocumentMatch[], pos: number): number;
/** The match to go to from the selection [from, to] in `direction` (1 or -1), round the end; -1 without matches. */
export function nextMatchIndex(matches: DocumentMatch[], from: number, to: number, direction: number): number;
/** What replaces `match` of `text`: groups expanded for a regular expression, Preserve Case applied. */
export function documentReplacement(regex: RegExp, options: SearchOptions, text: string, match: DocumentMatch, replace: string): string;
