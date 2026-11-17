// Which repository the Git tab's Changes and History views show, and how its chips are named.

import { basename } from '@/worktrees/model';

/** What the choice needs of a repository: its folder, and whether it is a git repository (unknown: undefined). */
export type RepoRef = { path: string; git?: boolean };

/** The chip's label, as on the desktop: the folder's name, or the whole path when it has none. */
export function repoLabel(path: string): string {
  return basename(path) || path;
}

/**
 * The repositories History offers: the desktop leaves out those that are not git
 * repositories, unless that would leave none. Changes offers all of them.
 */
export function historyRepos<T extends RepoRef>(repos: readonly T[]): T[] {
  const gits = repos.filter((repo) => repo.git !== false);
  return gits.length ? gits : [...repos];
}

/**
 * The repository to show: the one remembered if it is still among `repos`, else
 * the first git repository, else the first one (the desktop's Changes rule).
 * Null when there is none.
 */
export function chooseRepo<T extends RepoRef>(repos: readonly T[], saved: string | undefined): T | null {
  return repos.find((repo) => repo.path === saved) ?? repos.find((repo) => repo.git) ?? repos[0] ?? null;
}

/** The chips are only worth showing with a choice to make (the desktop hides its picker for one repository). */
export function showRepoChips(repos: readonly unknown[]): boolean {
  return repos.length > 1;
}
