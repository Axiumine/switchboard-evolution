// Which repository the Git tab's Changes and History views show, and how its chips are named.

import { repoColorMap } from '@/shared/vendor/repo-colors';
import {
  carryRepoSelection, isMultiRepo, normalizeRepoSelection, selectOnlyRepo, toggleRepoInSelection, type RepoSelection,
} from '@/shared/vendor/repo-selection';
import { basename } from '@/worktrees/model';

export { carryRepoSelection, isMultiRepo, normalizeRepoSelection, selectOnlyRepo, toggleRepoInSelection };
export type { RepoSelection };

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

/**
 * The repositories History, Pull Requests and Worktrees show: the remembered
 * selection made valid for `repos` (unknown paths dropped, the project's order
 * kept, the primary among them). Nothing remembered that is still there: the
 * one `chooseRepo` would show, alone.
 */
export function chooseRepos<T extends RepoRef>(repos: readonly T[], gitRepos: readonly string[] | undefined, gitRepo: string | undefined): RepoSelection {
  const available = repos.map((repo) => repo.path);
  if (![...(gitRepos ?? []), gitRepo].some((path) => !!path && available.includes(path))) {
    const first = chooseRepo(repos, undefined);
    return first ? selectOnlyRepo(first.path) : { primary: null, paths: [] };
  }
  return normalizeRepoSelection(available, { primary: gitRepo ?? null, paths: gitRepos ? [...gitRepos] : [] });
}

/** What the project's UI state remembers of the selection. */
export type RepoUi = { gitRepo?: string; gitRepos?: string[] };

/** The state to remember for a selection: its primary is `gitRepo`, all of it `gitRepos`. */
export function selectionPatch(selection: RepoSelection): RepoUi {
  return selection.primary ? { gitRepo: selection.primary, gitRepos: [...selection.paths] } : { gitRepos: [...selection.paths] };
}

/**
 * The state to remember when a view that works on one repository (Changes,
 * Actions) takes `path`, or History opens it from Changes: the multi selection
 * stays when it already shows `path` (with it as primary), else `path` alone.
 */
export function carryRepoPatch(ui: RepoUi, path: string): Required<RepoUi> {
  const carried = carryRepoSelection({ primary: ui.gitRepo ?? null, paths: ui.gitRepos ?? [] }, path);
  return { gitRepo: carried.primary ?? path, gitRepos: carried.paths };
}

/**
 * The color of each repository of a project, the desktop's: repoColorMap over
 * the attached folders in their order, then the project folder and any `extra`
 * path (a repository found inside a folder), so a color never depends on what
 * is shown and matches the desktop's.
 */
export function repoColors(project: { root?: string; folders?: readonly { path: string }[] }, extra: readonly string[] = []): Record<string, string> {
  const paths: string[] = [];
  for (const path of [...(project.folders ?? []).map((folder) => folder.path), project.root ?? '', ...extra]) {
    if (path && !paths.includes(path)) paths.push(path);
  }
  return repoColorMap(paths);
}

/** The chips are only worth showing with a choice to make (the desktop hides its picker for one repository). */
export function showRepoChips(repos: readonly unknown[]): boolean {
  return repos.length > 1;
}
