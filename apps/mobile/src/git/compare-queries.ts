import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { compareMatrix, compareSteps, compareTarget, UNCOMMITTED_HASH, type CompareStep, type FileChange } from '@/git/compare';
import { request, useConnection } from '@/store/connection';

type StepDetail = { ok?: boolean; error?: string; files?: FileChange[] };

/** The route params of the comparison screens are comma-separated lists. */
export function splitParam(raw: string | undefined): string[] {
  return raw ? raw.split(',').filter(Boolean) : [];
}

/** The header of a step's column or page: "a1b2→c3d4". */
export function stepTitle(labels: string[], step: number): string {
  return `${labels[step] ?? '?'}→${labels[step + 1] ?? '?'}`;
}

/**
 * The files each step changed, from the computer. The compare screen and the
 * diff screen call it with the same arguments, so the second finds the answers
 * of the first in the cache.
 */
export function useCompareSteps(projectId: string, folder: string, hashes: string) {
  const online = useConnection((s) => s.status.state === 'online');
  const steps: CompareStep[] = useMemo(() => compareSteps(splitParam(hashes)), [hashes]);
  const results = useQueries({
    queries: steps.map((step) => ({
      queryKey: ['git-graph-compare', projectId, folder, step.from, step.to],
      queryFn: () => request<StepDetail>('get-git-graph-compare-detail', [projectId, folder, step.from, compareTarget(step.to)]),
      enabled: online && !!projectId && !!folder,
      // A commit never changes; the working tree does.
      staleTime: step.to === UNCOMMITTED_HASH ? 0 : Infinity,
    })),
  });

  // Pending, not just loading: while the phone is offline the queries wait, disabled, with nothing to show yet.
  const loading = results.some((r) => r.isPending);
  const failed = results.find((r) => r.error || r.data?.error || (r.data && !r.data.ok));
  const error = failed ? failed.error?.message || failed.data?.error || 'Could not load the changes.' : null;
  const stepFiles = results.map((r) => r.data?.files || []);
  // Each render makes a new array of results: key the table on what is in it.
  const signature = results.map((r) => r.dataUpdatedAt).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matrix = useMemo(() => compareMatrix(stepFiles), [signature]);
  return { steps, matrix, loading, error };
}
