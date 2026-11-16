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
