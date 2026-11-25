// Copied from packages/shared/repo-selection.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for repo-selection.js, next to this file.

export type RepoSelection = { primary: string | null; paths: string[] };
export type RepoList<T> = { key: string; items: readonly T[]; hasMore?: boolean };
export type RepoMerge<T> = { merged: { key: string; item: T }[]; held: Record<string, number>; hasMore: boolean };

export function normalizeRepoSelection(available: readonly string[], selection?: Partial<RepoSelection> | null): RepoSelection;
export function selectOnlyRepo(path: string): RepoSelection;
export function toggleRepoInSelection(selection: Partial<RepoSelection> | null | undefined, path: string, available?: readonly string[]): RepoSelection;
export function isMultiRepo(selection?: Partial<RepoSelection> | null): boolean;
export function carryRepoSelection(target: Partial<RepoSelection> | null | undefined, primary: string | null | undefined): RepoSelection;
export function mergeRepoLists<T>(lists: readonly RepoList<T>[], rankOf: (item: T, key: string) => number): RepoMerge<T>;
export function repoPagePlan(lists: readonly { key: string; hasMore?: boolean }[], held: Record<string, number> | null | undefined, want?: number): string[];
