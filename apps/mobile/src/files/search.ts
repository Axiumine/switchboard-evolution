// Search and replace across a folder in the Files tab, as the desktop's and
// VS Code's Search view: the form, the results of search-project-files as
// rows (files, then their matches), what a replacement looks like, and the
// request of replace-in-project-files.

import { replacementFor, type SearchOptions } from '@/shared/vendor/text-search';

/** One match of search-project-files. `column` is a 0-based UTF-16 offset in the line. */
export type SearchMatch = {
  line: number;
  column: number;
  length: number;
  /** The matched text. */
  text: string;
  /** Up to 60 characters of the line before the match. */
  before: string;
  /** Up to 200 characters after it. */
  after: string;
};

export type SearchFile = { path: string; matches: SearchMatch[] };

export type SearchResult = {
  ok: boolean;
  error?: string;
  files?: SearchFile[];
  matchCount?: number;
  fileCount?: number;
  /** There are more matches than the ones sent. */
  limitHit?: boolean;
};

export type ReplaceResult = {
  ok: boolean;
  error?: string;
  replaced?: number;
  files?: number;
  skipped?: { path: string; reason: string }[];
};

/** What the search form holds. */
export type SearchForm = {
  query: string;
  isRegex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  /** Replace in the case of each match (VS Code's Preserve Case). */
  preserveCase: boolean;
  /** Comma-separated globs. */
  include: string;
  exclude: string;
  replace: string;
};

export const EMPTY_SEARCH: SearchForm = { query: '', isRegex: false, matchCase: false, wholeWord: false, preserveCase: false, include: '', exclude: '', replace: '' };

/** How many matches the phone asks for (the desktop allows up to 20000). */
export const MAX_RESULTS = 2000;

/** The options the query itself is made of: what both the search and a replace send. */
export function queryOptions(form: SearchForm): Required<SearchOptions> {
  return { query: form.query, isRegex: form.isRegex, matchCase: form.matchCase, wholeWord: form.wholeWord, preserveCase: form.preserveCase };
}

/** The `opts` of search-project-files, or null while there is nothing to search for. */
export function searchOpts(form: SearchForm): (Required<SearchOptions> & { include?: string; exclude?: string; maxResults: number }) | null {
  if (!form.query) return null;
  const include = form.include.trim();
  const exclude = form.exclude.trim();
  return { ...queryOptions(form), ...(include ? { include } : {}), ...(exclude ? { exclude } : {}), maxResults: MAX_RESULTS };
}

/** A match's identity within its file. */
export const matchKey = (match: Pick<SearchMatch, 'line' | 'column'>) => `${match.line}:${match.column}`;

/** What the user dismissed from the results: whole files, and single matches ("path\u0000line:column"). */
export type Dismissed = { files: ReadonlySet<string>; matches: ReadonlySet<string> };

export const NO_DISMISSED: Dismissed = { files: new Set(), matches: new Set() };

const matchId = (path: string, match: Pick<SearchMatch, 'line' | 'column'>) => `${path}\u0000${matchKey(match)}`;

export function dismissFile(dismissed: Dismissed, path: string): Dismissed {
  return { ...dismissed, files: new Set(dismissed.files).add(path) };
}

export function dismissMatch(dismissed: Dismissed, path: string, match: Pick<SearchMatch, 'line' | 'column'>): Dismissed {
  return { ...dismissed, matches: new Set(dismissed.matches).add(matchId(path, match)) };
}

/** The results without what was dismissed; a file left with no match goes too. */
export function visibleFiles(files: SearchFile[], dismissed: Dismissed): SearchFile[] {
  const out: SearchFile[] = [];
  for (const file of files) {
    if (dismissed.files.has(file.path)) continue;
    const matches = dismissed.matches.size ? file.matches.filter((m) => !dismissed.matches.has(matchId(file.path, m))) : file.matches;
    if (matches.length) out.push(matches === file.matches ? file : { ...file, matches });
  }
  return out;
}

export function countMatches(files: SearchFile[]): { matches: number; files: number } {
  return { matches: files.reduce((sum, f) => sum + f.matches.length, 0), files: files.length };
}

/** "3 results in 2 files". */
export function summaryText(files: SearchFile[], limitHit: boolean): string {
  const { matches, files: fileCount } = countMatches(files);
  if (!matches) return 'No results';
  const text = `${matches} ${matches === 1 ? 'result' : 'results'} in ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
  return limitHit ? `${text} (there are more results than shown)` : text;
}

export type ResultRow =
  | { kind: 'file'; key: string; file: SearchFile; collapsed: boolean }
  | { kind: 'match'; key: string; path: string; match: SearchMatch };

/** The rows of the results list: each file, and under it its matches unless it is collapsed. */
export function resultRows(files: SearchFile[], collapsed: ReadonlySet<string>): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const file of files) {
    const isCollapsed = collapsed.has(file.path);
    rows.push({ kind: 'file', key: `f:${file.path}`, file, collapsed: isCollapsed });
    if (isCollapsed) continue;
    for (const match of file.matches) rows.push({ kind: 'match', key: `m:${file.path}\u0000${matchKey(match)}`, path: file.path, match });
  }
  return rows;
}

/** A file path as its name and the folder it is in. */
export function splitPath(path: string): { name: string; folder: string } {
  const index = path.lastIndexOf('/');
  return index < 0 ? { name: path, folder: '' } : { name: path.slice(index + 1), folder: path.slice(0, index) };
}

/** How much of the line before a match a row keeps, so that the match is not pushed off a narrow screen. */
const CONTEXT_BEFORE = 24;

/** What a match's row shows: the line around it, with leading whitespace dropped as VS Code does and a long start cut. */
export function matchParts(match: SearchMatch): { before: string; text: string; after: string } {
  let before = match.before.trimStart();
  if (before.length > CONTEXT_BEFORE) before = `\u2026${before.slice(-CONTEXT_BEFORE)}`;
  return { before, text: match.text, after: match.after };
}

/**
 * The text that replaces a match: the replace text, with $1, $& and the like
 * worked out when the query is a regular expression. The row has only part of
 * the line, so the whole line is given to the regex only when it holds all of
 * what is before the match.
 */
export function replacementText(form: SearchForm, match: SearchMatch): string {
  try {
    const context = match.before.length === match.column ? { line: match.before + match.text + match.after, column: match.column } : null;
    return replacementFor(queryOptions(form), match.text, form.replace, context);
  } catch {
    // An invalid pattern has no results to show a replacement on; keep the text as typed.
    return form.replace;
  }
}

export type ReplaceTarget = { path: string; matches: { line: number; column: number; length: number; text: string }[] };

/** The files and matches a replace goes to: every match shown, or those of one file, or one match. */
export function replaceTargets(files: SearchFile[], scope: { path?: string; match?: Pick<SearchMatch, 'line' | 'column'> } = {}): ReplaceTarget[] {
  const out: ReplaceTarget[] = [];
  for (const file of files) {
    if (scope.path !== undefined && file.path !== scope.path) continue;
    const matches = file.matches
      .filter((m) => !scope.match || matchKey(m) === matchKey(scope.match))
      .map(({ line, column, length, text }) => ({ line, column, length, text }));
    if (matches.length) out.push({ path: file.path, matches });
  }
  return out;
}

/** The `opts` of replace-in-project-files. */
export function replaceOpts(form: SearchForm, targets: ReplaceTarget[]) {
  return { ...queryOptions(form), replace: form.replace, files: targets };
}

/** What a finished replace tells: how many, and which files were left alone and why. */
export function replaceReport(result: ReplaceResult): { title: string; message: string } {
  const replaced = result.replaced ?? 0;
  const skipped = result.skipped ?? [];
  const title = replaced === 0 ? 'Nothing was replaced' : `Replaced ${replaced} ${replaced === 1 ? 'match' : 'matches'} in ${result.files ?? 0} ${result.files === 1 ? 'file' : 'files'}`;
  if (!skipped.length) return { title, message: '' };
  const shown = skipped.slice(0, 5).map((s) => `${s.path}: ${s.reason}`);
  const more = skipped.length > shown.length ? [`and ${skipped.length - shown.length} more`] : [];
  return { title, message: ['Left alone:', ...shown, ...more].join('\n') };
}
