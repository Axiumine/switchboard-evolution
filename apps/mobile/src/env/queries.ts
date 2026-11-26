import { useQuery } from '@tanstack/react-query';

import { request, useCapability, useConnection } from '@/store/connection';
import type { EnvFilesState } from './model';

/** Whether the computer has the Env tab (a desktop older than it does not). */
export function useEnvSupported(): boolean {
  return useCapability('project-env-files');
}

/** The local.env.sh of the project folder and of each attached folder. */
export function useEnvFiles(projectId: string | undefined, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useEnvSupported();
  return useQuery({
    queryKey: ['project-env-files', projectId],
    queryFn: () => request<EnvFilesState & { error?: string }>('project-env-files', [projectId]),
    enabled: online && supported && enabled && !!projectId,
  });
}
