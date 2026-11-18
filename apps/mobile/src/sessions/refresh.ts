import type { QueryClient } from '@tanstack/react-query';

import { queryClient } from '@/remote/query';

/**
 * Read again every list a session shows in after a pin, rename, move or
 * archive from its sheet: the Sessions tab (get-projects) and the Projects
 * tab and project pages (get-project-tree, with or without the archived).
 */
export function refreshSessionLists(client: QueryClient = queryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['projects'] }),
    client.invalidateQueries({ queryKey: ['project-tree'] }),
  ]);
}
