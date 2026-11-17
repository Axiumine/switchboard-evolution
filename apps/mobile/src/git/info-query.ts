import { useQuery } from '@tanstack/react-query';

import { request, useConnection } from '@/store/connection';

import type { Repository } from './model';

type GitInfo = { ok?: boolean; repositories?: Repository[]; error?: string };

/**
 * The branch, changes and latest commits of each of a project's repositories.
 * No event says a working tree changed, so by default it is read again each
 * time the screen appears; pass `refetchOnMount: false` to reuse what is cached.
 */
export function useGitInfo(projectId: string | undefined, refetchOnMount: 'always' | false = 'always') {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['git-info', projectId],
    queryFn: () => request<GitInfo>('get-project-git-info', [projectId]),
    enabled: online && !!projectId,
    refetchOnMount,
  });
}
