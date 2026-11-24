import { useQuery } from '@tanstack/react-query';

import { act } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import { useCapability, useConnection } from '@/store/connection';
import type { IndexJob } from '@/shared/vendor/knowledge-model';

// The computer's Node Knowledge tab, for the phone (remote-knowledge.js on the
// desktop): its status, the read-only tools of codebase-memory-mcp on one of
// the project's attached folders, and the actions on them.

/** A graph question can take a while on a big repository. */
export const QUERY_TIMEOUT_MS = 90_000;
/** Linking the folders cross-repo scans them all. */
export const SLOW_TIMEOUT_MS = 10 * 60_000;

export type KnowledgeFolder = {
  path: string;
  mode: string;
  /** A worktree's main checkout and branch (null for other folders; missing from older desktops). */
  sourcePath?: string | null;
  branch?: string | null;
  name: string | null;
  shared: boolean;
  indexed: boolean;
  index: Record<string, any> | null;
  job: IndexJob | null;
  error: string | null;
};

export type KnowledgeSettings = {
  enabled: boolean;
  mode: 'full' | 'moderate' | 'fast';
  toolProfile: 'all' | 'analysis' | 'scout';
  crossRepo: boolean;
  autoRefresh: boolean;
  names: Record<string, string>;
  share: Record<string, boolean>;
  /** The folders that were worktrees when named. */
  worktrees?: Record<string, boolean>;
  savedQueries: { name: string; query: string }[];
};

export type KnowledgeStatus = {
  ok: boolean;
  binary: {
    found: { path: string; version: string; source: string; ok: boolean } | null;
    minimum: string;
    pinned: string;
    latest: string | null;
    updateAvailable: boolean;
    canDownload: boolean;
    download: { step: string; error: string | null } | null;
  };
  client: { running: boolean; error: string | null; halted: boolean };
  agents: { claude: string | null; codex: string | null } | null;
  settings: KnowledgeSettings;
  folders: KnowledgeFolder[];
  error: string | null;
};

/** Whether the computer has the Node Knowledge tab at all (a desktop older than it does not). */
export function useKnowledgeSupported(): boolean {
  return useCapability('knowledge-query');
}

export function useKnowledgeStatus(projectId: string | undefined, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useKnowledgeSupported();
  return useQuery({
    queryKey: ['knowledge', projectId],
    queryFn: () => act<KnowledgeStatus>('get-knowledge-status', [projectId], { timeoutMs: QUERY_TIMEOUT_MS }),
    enabled: online && supported && enabled && !!projectId,
  });
}

/** One of codebase-memory-mcp's read-only tools on an attached folder. */
export function knowledgeQuery<T = any>(projectId: string, folder: string, tool: string, args: Record<string, unknown> = {}): Promise<T> {
  return act<T>('knowledge-query', [projectId, folder, tool, args], { timeoutMs: QUERY_TIMEOUT_MS });
}

/** A tool's answer, cached per project, folder, tool and arguments, and read again after the folder's graph moves. */
export function useKnowledgeQuery<T = any>(projectId: string, folder: string | null | undefined, tool: string, args: Record<string, unknown>, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['knowledge-data', projectId, folder, tool, JSON.stringify(args)],
    queryFn: () => knowledgeQuery<T>(projectId, folder as string, tool, args),
    enabled: online && enabled && !!folder,
  });
}

/** Read the project's status and its answers again (after an action, or knowledge-changed). */
export function reloadKnowledge(projectId?: string | null): Promise<void> {
  const status = projectId ? ['knowledge', projectId] : ['knowledge'];
  const data = projectId ? ['knowledge-data', projectId] : ['knowledge-data'];
  return Promise.all([queryClient.invalidateQueries({ queryKey: status }), queryClient.invalidateQueries({ queryKey: data })]).then(() => undefined);
}

/** An action on the computer, then the status read again. */
export async function knowledgeAction<T = any>(method: string, params: unknown[], options?: { timeoutMs?: number }): Promise<T> {
  const result = await act<T>(method, params, options);
  await reloadKnowledge(typeof params[0] === 'string' ? params[0] : null);
  return result;
}
