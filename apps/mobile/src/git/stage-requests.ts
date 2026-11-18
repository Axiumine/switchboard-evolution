// The requests that stage and unstage, and the refresh after them.

import type { QueryClient } from '@tanstack/react-query';

import { request, useCapability } from '@/store/connection';

import { stageOutcome, type Side, type StageOutcome } from './staging';

/** Whether the computer can stage files and lines; an older one keeps the read-only list and diff. */
export function useCanStage(): boolean {
  const files = useCapability('stage-project-git-files');
  const lines = useCapability('stage-project-git-lines');
  return files && lines;
}

/** The most paths one stage-project-git-files takes. */
export const MAX_PATHS = 5000;

/**
 * Stage (or unstage) files: `paths` null is every change of the folder.
 * Throws with the computer's message when it says no.
 */
export async function stageFiles(projectId: string, folder: string, paths: string[] | null, stage: boolean): Promise<void> {
  const batches: (string[] | null)[] = paths === null ? [null] : [];
  if (paths) for (let i = 0; i < paths.length; i += MAX_PATHS) batches.push(paths.slice(i, i + MAX_PATHS));
  for (const batch of batches) {
    const outcome = stageOutcome(await request('stage-project-git-files', [projectId, folder, batch, stage]));
    if (!outcome.ok) throw new Error(outcome.error);
  }
}

/**
 * Stage the picked lines of a file's diff (side 'unstaged'), or unstage them
 * (side 'staged'). `diffId` names the diff the line numbers come from; when the
 * file has changed since, the outcome is `stale`.
 */
export async function stageLines(projectId: string, folder: string, path: string, side: Side, diffId: string, lines: number[]): Promise<StageOutcome> {
  try {
    return stageOutcome(await request('stage-project-git-lines', [projectId, folder, path, side, diffId, lines]));
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err), stale: false };
  }
}

/** Read the changes and the open diffs again, after something was staged. */
export function refreshGit(queryClient: QueryClient, projectId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['git-info', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['diff'] }),
  ]);
}

// --- Discard and .gitignore (the row menu of the Changes list) ---

/** Whether the computer can discard changes; an older one only stages. */
export function useCanDiscard(): boolean {
  return useCapability('discard-project-git-files');
}

/** Whether the computer can add paths to .gitignore (and take them out of Git). */
export function useCanIgnore(): boolean {
  return useCapability('ignore-project-git-paths');
}

/** A file the computer could not move to the Trash, and why. */
export type DiscardFailure = { path: string; error: string };

/**
 * Discard the working-tree changes of these files (null: all of them); the
 * untracked ones go to the Trash on the computer. Resolves what could not go
 * there; throws with the computer's message when it says no.
 */
export async function discardFiles(projectId: string, folder: string, paths: string[] | null): Promise<DiscardFailure[]> {
  const batches: (string[] | null)[] = paths === null ? [null] : [];
  if (paths) for (let i = 0; i < paths.length; i += MAX_PATHS) batches.push(paths.slice(i, i + MAX_PATHS));
  const failed: DiscardFailure[] = [];
  for (const batch of batches) {
    const result = await request<{ ok?: boolean; error?: string; failed?: DiscardFailure[] } | null>('discard-project-git-files', [projectId, folder, batch]);
    if (!result || result.error || result.ok === false) throw new Error(result?.error || 'Git could not discard these changes');
    failed.push(...(result.failed ?? []));
  }
  return failed;
}

/** Add files or folders to the repository's .gitignore; with `untrack`, take them out of Git too. */
export async function ignorePaths(projectId: string, folder: string, paths: string[], untrack: boolean): Promise<void> {
  const result = await request<{ ok?: boolean; error?: string } | null>('ignore-project-git-paths', [projectId, folder, paths, untrack]);
  if (!result || result.error || result.ok === false) throw new Error(result?.error || 'Git could not add this to .gitignore');
}
