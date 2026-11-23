import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { queryClient } from '@/remote/query';
import { useConnection } from '@/store/connection';
import { ask } from '@/worktrees/queries';
import { PAGE_SIZE, type ActionAnswer, type FilesAnswer, type MergeMethod, type OpenListing, type PageListing, type PageState, type PullRequestAction } from './model';

// Every open pull request can take a few requests to GitHub, one per 100.
const LIST_TIMEOUT_MS = 120_000;
const FILES_TIMEOUT_MS = 75_000;
// The computer gives gh two minutes for an action.
const ACTION_TIMEOUT_MS = 150_000;
// Read again when the view comes back after this long, as the desktop does.
const STALE_MS = 60_000;

function remoteOpts(remote: string | undefined, extra: Record<string, unknown> = {}) {
  return remote ? { remote, ...extra } : { ...extra };
}

/** Every open pull request of a repository (drafts too), with its merge settings. */
export function useOpenPullRequests(projectId: string | undefined, folder: string | undefined, remote: string | undefined, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-requests', projectId, folder, remote ?? ''],
    queryFn: () => ask<OpenListing>('get-pull-requests', [projectId, folder, remoteOpts(remote)], LIST_TIMEOUT_MS),
    enabled: enabled && online && !!projectId && !!folder,
    staleTime: STALE_MS,
  });
}

/** Closed and/or merged pull requests, PAGE_SIZE at a time: fetchNextPage reads the next ones. */
export function usePagedPullRequests(projectId: string | undefined, folder: string | undefined, remote: string | undefined, states: PageState[], enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useInfiniteQuery({
    queryKey: ['pull-requests-page', projectId, folder, remote ?? '', states.join(',')],
    queryFn: async ({ pageParam }) => {
      const answer = await ask<PageListing>('get-pull-requests-page', [projectId, folder, remoteOpts(remote, { states, first: PAGE_SIZE, ...(pageParam ? { after: pageParam } : {}) })], LIST_TIMEOUT_MS);
      if (!answer.ok) throw new Error(answer.error || 'The pull requests could not be read.');
      return answer;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasNextPage && last.endCursor ? last.endCursor : undefined),
    enabled: enabled && online && !!projectId && !!folder && states.length > 0,
    staleTime: STALE_MS,
  });
}

/** A pull request's changed files with their patches; kept per head commit, which changes with every push. */
export function usePullRequestFiles(projectId: string, folder: string, remote: string | undefined, number: number, headOid: string, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-request-files', projectId, folder, remote ?? '', number, headOid],
    queryFn: () => ask<FilesAnswer>('get-pull-request-files', [projectId, folder, remoteOpts(remote, { number })], FILES_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: Infinity,
  });
}

/** Read the lists of a repository again; resolves once they are back. */
export function reloadPullRequests(projectId: string, folder: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['pull-requests', projectId, folder] }),
    queryClient.invalidateQueries({ queryKey: ['pull-requests-page', projectId, folder] }),
  ]);
}

// --- What happened: the line over the list ---

export type Notice = { kind: 'busy' | 'ok' | 'error'; text: string };

export const usePullNotices = create<{ byProject: Record<string, Notice | null> }>(() => ({ byProject: {} }));

export function setPullNotice(projectId: string, notice: Notice | null) {
  usePullNotices.setState((state) => ({ byProject: { ...state.byProject, [projectId]: notice } }));
}

export function usePullNotice(projectId: string): Notice | null {
  return usePullNotices((s) => s.byProject[projectId] ?? null);
}

export type ActionParams = { number: number; action: PullRequestAction; method?: MergeMethod; deleteBranch?: boolean; headOid?: string };

/**
 * Merge, convert to draft, mark ready or close, then read the lists again.
 * Resolves the answer: { ok, message } or { error }.
 */
export async function runPullRequestAction(projectId: string, folder: string, remote: string | undefined, params: ActionParams): Promise<ActionAnswer> {
  const clean: Record<string, unknown> = { number: params.number, action: params.action };
  if (params.action === 'merge') {
    clean.method = params.method;
    clean.deleteBranch = !!params.deleteBranch;
    if (params.headOid && /^[0-9a-f]{40}$/.test(params.headOid)) clean.headOid = params.headOid;
  }
  const answer = await ask<ActionAnswer>('run-pull-request-action', [projectId, folder, remoteOpts(remote, clean)], ACTION_TIMEOUT_MS);
  // Refused or done, the list may be behind GitHub: read it again either way.
  reloadPullRequests(projectId, folder).catch(() => {});
  return answer;
}
