import { useCallback, useMemo } from 'react';

import {
  chooseRepos, selectionPatch, selectOnlyRepo, toggleRepoInSelection, type RepoRef, type RepoSelection,
} from '@/git/repo-choice';
import { useProjectUi } from '@/projects/ui-store';

/**
 * The repositories the Git tab's History, Pull Requests and Worktrees show (the
 * project remembers one selection for all three, as the desktop does): which
 * ones, which is the primary, and how to change them. `only` is a tap on a
 * repository's name, `toggle` its check. `selection.paths` keeps its identity
 * while the same repositories are shown, so queries and effects keyed on it
 * stay put.
 */
export function useRepoSelection(projectId: string, repos: readonly RepoRef[]) {
  const [gitRepo, patchUi] = useProjectUi(projectId, (ui) => ui.gitRepo);
  const [gitRepos] = useProjectUi(projectId, (ui) => ui.gitRepos);
  const available = useMemo(() => repos.map((repo) => repo.path), [repos]);
  const fresh = chooseRepos(repos, gitRepos, gitRepo);
  const key = `${fresh.primary ?? ''}\n${fresh.paths.join('\n')}`;
  // The same repositories in the same order are the same selection, whatever array they came in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selection: RepoSelection = useMemo(() => fresh, [key]);
  const only = useCallback((path: string) => patchUi(selectionPatch(selectOnlyRepo(path))), [patchUi]);
  const toggle = useCallback(
    (path: string) => patchUi(selectionPatch(toggleRepoInSelection(selection, path, available))),
    [patchUi, selection, available],
  );
  return { selection, only, toggle, patchUi };
}
