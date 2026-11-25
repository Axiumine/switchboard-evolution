// The Git Graph of several repositories at once (the desktop's gitGraphMultiRows,
// public/project-git-graph-view.js): each repository's rows, namespaced so the
// same commit or the Uncommitted Changes of two repositories never collide,
// merged into one list newest first, and the paging of it. Pure: the view asks
// get-project-git-graph once per folder (the computer's API is per folder).
//
// With one repository nothing is namespaced and the rows are the ones it sent.

import { mergeRepoLists, repoPagePlan } from '@/shared/vendor/repo-selection';

import { buildLayoutInput, type GraphCommit, type HistoryRow, type Stash, type Uncommitted } from './history';

/** What get-project-git-graph answers for a folder. */
export type GraphData = {
  ok?: boolean; error?: string; hasMore: boolean;
  commits: GraphCommit[]; stashes: Stash[]; uncommitted: Uncommitted | null;
  refs: { heads: { name: string; hash: string; isHead: boolean; upstream: string | null }[] } | null;
};

/** The commits one folder is asked for first, and each time Load more asks for more of it. */
export const PAGE = 300;
export const MORE = 100;
/** The most the computer sends at once, per folder. */
export const MAX_COMMITS = 5000;
/** With several folders each is asked for a share of PAGE, but never fewer than this. */
const MIN_PER_FOLDER = 100;

/** How many commits each folder is asked for first: all of PAGE for one, a share of it for several. */
export function initialLimit(folders: number): number {
  return folders <= 1 ? PAGE : Math.max(MIN_PER_FOLDER, Math.ceil(PAGE / folders));
}

/** A row of the merged list: `hash` is namespaced with several folders, `sha` is git's; `folder` is where it comes from. */
export type RepoRow = HistoryRow & { folder: string; sha: string };

/** One folder of the merged history: its answer so far, and how many commits it was asked for. */
export type Slice = { folder: string; data: GraphData | undefined; limit: number };

const TAG = /^(r\d+):/;

/** `r1:abc123`: a hash under its folder's tag; without a tag (one folder) the hash itself. */
export function repoKey(tag: string | null, sha: string): string {
  return tag ? `${tag}:${sha}` : sha;
}

/** A key back into its tag and git's hash. A plain hash (or '#uncommitted') has no tag. */
export function splitKey(key: string): { tag: string | null; sha: string } {
  const match = TAG.exec(key);
  return match ? { tag: match[1], sha: key.slice(match[0].length) } : { tag: null, sha: key };
}

/** The tag of the folder at `index` of `count`: none for a single folder. */
export function sliceTag(index: number, count: number): string | null {
  return count > 1 ? `r${index}` : null;
}

/** Whether the folder has more to load: it says so and was not asked for the most there is. */
export function sliceHasMore(slice: Slice): boolean {
  return !!slice.data && !slice.data.error && slice.data.hasMore && slice.limit < MAX_COMMITS;
}

/** The folder's rows as the desktop lays them out (commits, stashes, uncommitted on top), under its tag. */
export function sliceRows(slice: Slice, tag: string | null): RepoRow[] {
  const data = slice.data;
  if (!data || data.error) return [];
  const headHash = data.commits.find((commit) => commit.isHead)?.hash || null;
  return buildLayoutInput(data.commits, data.stashes, data.uncommitted, headHash).map((row) => ({
    ...row,
    sha: row.hash,
    folder: slice.folder,
    hash: repoKey(tag, row.hash),
    parents: row.parents.map((parent) => repoKey(tag, parent)),
  }));
}

const time = (row: { commitDate?: string; authorDate?: string }) => new Date(row.commitDate || row.authorDate || 0).getTime();

/** What the merge ranks a row by, the highest first: the Uncommitted Changes above everything, then the commit date. */
export function rankOf(row: Pick<HistoryRow, 'kind' | 'commitDate' | 'authorDate'>): number {
  return row.kind === 'uncommitted' ? Infinity : time(row);
}

export type Merged = { rows: RepoRow[]; hasMore: boolean; held: Record<string, number> };

/**
 * The slices' rows as one list, newest first; each folder keeps its own order.
 * The list stops where a folder that has more to load runs out (what it has not
 * loaded could come before anything left in the others): `held` says how many
 * rows of each folder wait below, `hasMore` whether anything is left to load or show.
 */
export function mergeSlices(slices: readonly Slice[]): Merged {
  if (slices.length === 1) {
    const rows = sliceRows(slices[0], null);
    return { rows, hasMore: sliceHasMore(slices[0]), held: { [slices[0].folder]: 0 } };
  }
  const lists = slices.map((slice, index) => {
    const rows = sliceRows(slice, sliceTag(index, slices.length));
    return { key: slice.folder, items: rows, hasMore: sliceHasMore(slice) };
  });
  const { merged, held, hasMore } = mergeRepoLists(lists, (row) => rankOf(row));
  return { rows: merged.map((entry) => entry.item), hasMore, held };
}

/** The folders to ask for more commits: those with more that hold fewer than `want` rows not shown yet. */
export function morePlan(slices: readonly Slice[], held: Record<string, number>, want = MORE): string[] {
  if (slices.length === 1) return sliceHasMore(slices[0]) ? [slices[0].folder] : [];
  return repoPagePlan(slices.map((slice) => ({ key: slice.folder, hasMore: sliceHasMore(slice) })), held, want);
}

/** The limits after a Load more for the `plan` folders. */
export function grownLimits(limits: Record<string, number>, plan: readonly string[], initial: number, step = MORE): Record<string, number> {
  const next = { ...limits };
  for (const folder of plan) next[folder] = Math.min(MAX_COMMITS, (limits[folder] ?? initial) + step);
  return next;
}

/** A row as git and the computer know it: git's hash, and its parents' (what every request to the computer takes). */
export function plainRow<T extends RepoRow>(row: T): T {
  return { ...row, hash: row.sha, parents: row.parents.map((parent) => splitKey(parent).sha) };
}

/** The folder every one of these rows belongs to, or null when they are from several (or there are none). */
export function commonFolder(rows: readonly { folder: string }[]): string | null {
  if (!rows.length) return null;
  return rows.every((row) => row.folder === rows[0].folder) ? rows[0].folder : null;
}

/** The branch checked out in a folder's answer, its upstreams, and its HEAD commit. */
export function sliceInfo(data: GraphData | undefined): { headHash: string | null; currentBranch: string | null; upstreams: Record<string, string | null> } {
  const heads = data?.refs?.heads || [];
  return {
    headHash: data?.commits.find((commit) => commit.isHead)?.hash || null,
    currentBranch: heads.find((head) => head.isHead)?.name || null,
    upstreams: Object.fromEntries(heads.map((head) => [head.name, head.upstream])),
  };
}
