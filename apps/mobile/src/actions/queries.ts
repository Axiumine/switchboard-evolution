import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { queryClient } from '@/remote/query';
import { useConnection } from '@/store/connection';
import { ask } from '@/worktrees/queries';
import {
  isActive, pollDelay, runStillGoing,
  type CachesAnswer, type DeploymentsAnswer, type DispatchAnswer, type EditAnswer, type EditParams, type FileAnswer, type JobAnswer,
  type LogAnswer, type RefsAnswer, type RunAnswer, type RunnersAnswer, type RunsAnswer, type WorkflowsAnswer,
} from './model';

// GitHub through gh on the computer: a run with its jobs, artifacts and annotations is a few requests.
const READ_TIMEOUT_MS = 75_000;
// The computer gives gh two minutes for a change.
const ACTION_TIMEOUT_MS = 150_000;
const STALE_MS = 60_000;

/** Where the Actions view reads: the project, the folder of its repository, the remote chosen there. */
export type ActionsRef = { projectId: string; folder: string; remote: string | undefined };

function opts(ref: ActionsRef, extra: Record<string, unknown> = {}) {
  return ref.remote ? { remote: ref.remote, ...extra } : { ...extra };
}

function key(name: string, ref: ActionsRef, ...rest: unknown[]) {
  return ['actions', name, ref.projectId, ref.folder, ref.remote ?? '', ...rest];
}

function useOnline() {
  return useConnection((s) => s.status.state === 'online');
}

/** The workflows (the desktop's sidebar) and what the account may do in the repository. */
export function useWorkflows(ref: ActionsRef | null, enabled = true) {
  const online = useOnline();
  return useQuery({
    queryKey: ref ? key('workflows', ref) : ['actions', 'workflows', 'none'],
    queryFn: () => ask<WorkflowsAnswer>('get-actions-workflows', [ref!.projectId, ref!.folder, opts(ref!)], READ_TIMEOUT_MS),
    enabled: enabled && online && !!ref,
    staleTime: 5 * STALE_MS,
  });
}

/** A page of runs, of every workflow or of one, filtered by the search's qualifiers; read again every 30 s while shown. */
export function useRuns(ref: ActionsRef | null, workflowId: number | null, query: string, page: number, active: boolean) {
  const online = useOnline();
  return useQuery({
    queryKey: ref ? key('runs', ref, workflowId ?? '', query, page) : ['actions', 'runs', 'none'],
    queryFn: () => ask<RunsAnswer>('get-actions-runs', [ref!.projectId, ref!.folder, opts(ref!, { ...(workflowId ? { workflowId } : {}), page, perPage: 25, query })], READ_TIMEOUT_MS),
    enabled: online && !!ref,
    staleTime: 20_000,
    refetchInterval: (q) => (active ? pollDelay(q.state.data, false, true) : false),
  });
}

/** One run (or one of its attempts); read again every 5 s while it runs. */
export function useRun(ref: ActionsRef, runId: number, attempt: number | null) {
  const online = useOnline();
  return useQuery({
    queryKey: key('run', ref, runId, attempt ?? ''),
    queryFn: () => ask<RunAnswer>('get-actions-run', [ref.projectId, ref.folder, opts(ref, { runId, ...(attempt ? { attempt } : {}) })], READ_TIMEOUT_MS),
    enabled: online && runId > 0,
    staleTime: 10_000,
    refetchInterval: (q) => {
      const data = q.state.data;
      return pollDelay(data, !!(data && data.ok && runStillGoing(data.run, data.jobs)));
    },
  });
}

/** One job with its steps and annotations; read again every 5 s while it runs. */
export function useJob(ref: ActionsRef, jobId: number) {
  const online = useOnline();
  return useQuery({
    queryKey: key('job', ref, jobId),
    queryFn: () => ask<JobAnswer>('get-actions-job', [ref.projectId, ref.folder, opts(ref, { jobId })], READ_TIMEOUT_MS),
    enabled: online && jobId > 0,
    staleTime: 10_000,
    refetchInterval: (q) => {
      const data = q.state.data;
      return pollDelay(data, !!(data && data.ok && isActive(data.job.status)));
    },
  });
}

/** The log of one finished step (GitHub gives it once the step has finished): it does not change after. */
export function useStepLog(ref: ActionsRef, jobId: number, step: number, enabled: boolean) {
  const online = useOnline();
  return useQuery({
    queryKey: key('step-log', ref, jobId, step),
    queryFn: () => ask<LogAnswer>('get-actions-step-log', [ref.projectId, ref.folder, opts(ref, { jobId, step })], READ_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: Infinity,
  });
}

export function useWorkflowFile(ref: ActionsRef, path: string, gitRef: string, enabled = true) {
  const online = useOnline();
  return useQuery({
    queryKey: key('file', ref, path, gitRef),
    queryFn: () => ask<FileAnswer>('get-actions-workflow-file', [ref.projectId, ref.folder, opts(ref, { path, ref: gitRef })], READ_TIMEOUT_MS),
    enabled: enabled && online && !!path && !!gitRef,
    staleTime: /^[0-9a-f]{40}$/.test(gitRef) ? Infinity : STALE_MS,
  });
}

/** "Run workflow": the inputs of the workflow file at a branch or tag, and whether it can run. */
export function useDispatchForm(ref: ActionsRef, workflowId: number | string, gitRef: string | null, enabled = true) {
  const online = useOnline();
  return useQuery({
    queryKey: key('dispatch', ref, workflowId, gitRef ?? ''),
    queryFn: () => ask<DispatchAnswer>('get-actions-dispatch-form', [ref.projectId, ref.folder, opts(ref, { workflowId, ...(gitRef ? { ref: gitRef } : {}) })], READ_TIMEOUT_MS),
    enabled: enabled && online && !!workflowId,
    staleTime: STALE_MS,
  });
}

export function useRefs(ref: ActionsRef, query: string, enabled = true) {
  const online = useOnline();
  return useQuery({
    queryKey: key('refs', ref, query),
    queryFn: () => ask<RefsAnswer>('get-actions-refs', [ref.projectId, ref.folder, opts(ref, query ? { query } : {})], READ_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: STALE_MS,
  });
}

export type CacheOpts = { ref?: string; key?: string; sort?: 'last_accessed_at' | 'created_at' | 'size_in_bytes'; direction?: 'asc' | 'desc'; page?: number };

export function useCaches(ref: ActionsRef, cacheOpts: CacheOpts) {
  const online = useOnline();
  const clean = Object.fromEntries(Object.entries(cacheOpts).filter(([, v]) => v !== undefined && v !== ''));
  return useQuery({
    queryKey: key('caches', ref, JSON.stringify(clean)),
    queryFn: () => ask<CachesAnswer>('get-actions-caches', [ref.projectId, ref.folder, opts(ref, clean)], READ_TIMEOUT_MS),
    enabled: online,
    staleTime: STALE_MS,
  });
}

export function useRunners(ref: ActionsRef) {
  const online = useOnline();
  return useQuery({
    queryKey: key('runners', ref),
    queryFn: () => ask<RunnersAnswer>('get-actions-runners', [ref.projectId, ref.folder, opts(ref)], READ_TIMEOUT_MS),
    enabled: online,
    staleTime: STALE_MS,
  });
}

export function useDeployments(ref: ActionsRef, environment: string | null) {
  const online = useOnline();
  return useQuery({
    queryKey: key('deployments', ref, environment ?? ''),
    queryFn: () => ask<DeploymentsAnswer>('get-actions-deployments', [ref.projectId, ref.folder, opts(ref, environment ? { environment } : {})], READ_TIMEOUT_MS),
    enabled: online,
    staleTime: STALE_MS,
  });
}

/** Read everything the Actions view holds for a repository again. */
export function reloadActions(ref: Pick<ActionsRef, 'projectId' | 'folder'>): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: ['actions'], predicate: (q) => q.queryKey[2] === ref.projectId && q.queryKey[3] === ref.folder });
}

const AFTER_CHANGE_MS = [2500, 8000];

/**
 * One change to GitHub Actions (edit-actions), then what it touched read
 * again: at once, and twice more over the next seconds, when GitHub shows a
 * new, cancelled or re-run run (with ETags, a read that finds nothing new is free). Resolves { ok, message, runId? } or { error }.
 */
export async function editActions(ref: ActionsRef, params: EditParams): Promise<EditAnswer> {
  const answer = await ask<EditAnswer>('edit-actions', [ref.projectId, ref.folder, opts(ref, params as Record<string, unknown>)], ACTION_TIMEOUT_MS);
  reloadActions(ref).catch(() => {});
  // GitHub's copies catch up in a few seconds: a read soon after can still give the old state.
  for (const ms of AFTER_CHANGE_MS) setTimeout(() => { reloadActions(ref).catch(() => {}); }, ms);
  return answer;
}

// --- What happened: the line over the list ---

export type Notice = { kind: 'busy' | 'ok' | 'error'; text: string };

export const useActionsNotices = create<{ byProject: Record<string, Notice | null> }>(() => ({ byProject: {} }));

export function setActionsNotice(projectId: string, notice: Notice | null) {
  useActionsNotices.setState((state) => ({ byProject: { ...state.byProject, [projectId]: notice } }));
}

export function useActionsNotice(projectId: string): Notice | null {
  return useActionsNotices((s) => s.byProject[projectId] ?? null);
}
