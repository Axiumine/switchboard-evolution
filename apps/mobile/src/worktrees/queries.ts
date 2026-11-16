import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { create } from 'zustand';

import { act } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import type { Folder } from '@/sessions/model';
import { fieldsFor } from '@/shared/vendor/session-config';
import { request, useConnection } from '@/store/connection';
import { createdText, sessionsByWorktree, type CreateResult, type WorktreeListing, type WorktreeRepository, type WorktreeSettings } from './model';

// Reading every worktree runs git status in each of them.
export const LIST_TIMEOUT_MS = 60_000;
// Adding, moving or pruning a worktree of a big repository.
export const SLOW_TIMEOUT_MS = 5 * 60_000;
// The computer gives a post-create or pre-remove command 15 minutes.
export const HOOK_TIMEOUT_MS = 16 * 60_000;

/** get-project-worktrees, shared by the tab and the screens it opens. */
export function useProjectWorktrees(projectId: string | undefined) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['worktrees', projectId],
    queryFn: () => act<WorktreeListing>('get-project-worktrees', [projectId], { timeoutMs: LIST_TIMEOUT_MS }),
    enabled: online && !!projectId,
    // A worktree made in a terminal sends no event: read them again each time.
    refetchOnMount: 'always',
  });
}

/** Read a project's worktrees again; resolves once they are back. */
export function reloadWorktrees(projectId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['worktrees', projectId] });
}

/** Change the settings in the cache at once, before the computer has them. */
export function patchCachedSettings(projectId: string, patch: Partial<WorktreeSettings>) {
  queryClient.setQueryData<WorktreeListing>(['worktrees', projectId], (old) => (old ? { ...old, settings: { ...old.settings, ...patch } } : old));
}

/** Running sessions by worktree path, from every session the computer knows and their live state. */
export function useRunningByWorktree(repositories: WorktreeRepository[] | undefined) {
  const online = useConnection((s) => s.status.state === 'online');
  const live = useConnection((s) => s.live);
  const folders = useQuery({ queryKey: ['projects'], queryFn: () => request<Folder[]>('get-projects', [false]), enabled: online });
  return useMemo(
    () => sessionsByWorktree(repositories || [], (folders.data || []).flatMap((f) => f.sessions), live),
    [repositories, folders.data, live],
  );
}

// --- What happened: the line over the list ---

export type Notice = { kind: 'busy' | 'ok' | 'error'; text: string; output?: string };

/** The last thing done in each project's Worktrees tab, from the tab or a screen it opened. */
export const useWorktreeNotices = create<{ byProject: Record<string, Notice | null> }>(() => ({ byProject: {} }));

export function setNotice(projectId: string, notice: Notice | null) {
  useWorktreeNotices.setState((state) => ({ byProject: { ...state.byProject, [projectId]: notice } }));
}

export function useNotice(projectId: string): Notice | null {
  return useWorktreeNotices((s) => s.byProject[projectId] ?? null);
}

/** What every worktree channel answers: ok, or an error, with what a command printed. */
export type Answer = { ok?: boolean; error?: string; output?: string };

/**
 * Call the computer the way the desktop's tab does (wtApi): a refused or lost
 * call comes back as { error } rather than a throw, so the extra fields of a
 * refusal (dirty, unmerged, output) are not lost.
 */
export async function ask<T extends Answer = Answer>(method: string, params: unknown[], timeoutMs?: number): Promise<T> {
  try {
    return (await request<T>(method, params, timeoutMs ? { timeoutMs } : undefined)) || ({ error: 'No answer from the computer.' } as T);
  } catch (err: any) {
    return { error: err?.message || String(err) } as T;
  }
}

/** Run an action, say what happened, read the worktrees again. Resolves the result, or null when it failed. */
export async function runAction<T extends Answer>(projectId: string, busyText: string, call: () => Promise<T>, okText: string | ((result: T) => string)): Promise<T | null> {
  setNotice(projectId, { kind: 'busy', text: busyText });
  const result = await call();
  if (!result?.ok) {
    setNotice(projectId, { kind: 'error', text: result?.error || 'That did not work.', output: result?.output });
    await reloadWorktrees(projectId);
    return null;
  }
  setNotice(projectId, { kind: 'ok', text: typeof okText === 'function' ? okText(result) : okText, output: result.output || '' });
  await reloadWorktrees(projectId);
  return result;
}

// --- Sessions in a worktree ---

/**
 * Start a session or a terminal in a worktree and open it. A worktree already
 * is a separate checkout, so Claude is never asked for another one on top.
 */
export async function startInWorktree(
  projectId: string, worktreePath: string, runtime: string,
  open: (sessionId: string) => void = (id) => router.push({ pathname: '/session/[id]', params: { id, tab: 'terminal' } }),
): Promise<void> {
  let spec: Record<string, unknown> = { mode: 'new', projectPath: worktreePath, projectId, runtime };
  if (runtime !== 'terminal') {
    // The folder's defaults, as the desktop resolves them, without a worktree of its own.
    const defaults = await request<Record<string, unknown>>('get-effective-settings', [worktreePath]).catch(() => ({}));
    const keys = new Set(fieldsFor(runtime).map((f) => f.key));
    const options = Object.fromEntries(Object.entries(defaults || {}).filter(([key]) => keys.has(key)));
    if (keys.has('worktree')) options.worktree = false;
    delete options.worktreeName;
    spec = { ...spec, options };
  }
  const result = await request<{ sessionId?: string; error?: string }>('launch-session', [spec]);
  if (result.error || !result.sessionId) throw new Error(result.error || 'Could not start the session');
  await useConnection.getState().refreshLive();
  open(result.sessionId);
}

/** After the create screen: say what was made, run the post-create command, open what was asked. */
export async function afterCreate(projectId: string, { result, runPost, after }: { result: CreateResult; runPost: boolean; after: string }) {
  const text = createdText(result);
  setNotice(projectId, { kind: result.warnings?.length ? 'error' : 'ok', text: [text, ...(result.warnings || [])].join('. ') });
  await reloadWorktrees(projectId);
  if (runPost && result.postCreateCmd) {
    setNotice(projectId, { kind: 'busy', text: `${text}. Running the post-create command…` });
    const ran = await ask('worktree-run-post-create', [projectId, result.worktree.path], HOOK_TIMEOUT_MS);
    if (ran.ok) setNotice(projectId, { kind: 'ok', text: `${text}. The post-create command finished.`, output: ran.output || '' });
    else setNotice(projectId, { kind: 'error', text: `${text}, but ${ran.error || 'the post-create command failed'}. The worktree is there.`, output: ran.output || '' });
    await reloadWorktrees(projectId);
  }
  if (after && after !== 'none') {
    try {
      await startInWorktree(projectId, result.worktree.path, after);
    } catch (err: any) {
      setNotice(projectId, { kind: 'error', text: `${text}, but the session did not start: ${err?.message || 'unknown error'}` });
    }
  }
}
