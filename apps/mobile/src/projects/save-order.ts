import { Alert } from 'react-native';

import { queryClient } from '@/remote/query';
import type { Project } from './model';
import { pinnedProjectId, withPinnedOrder, withStarredOrder, type OrderGroup } from './order';
import { act } from './queries';

type Tree = { projects: Project[] };

/**
 * Keep the order a drag gave (order.ts): the phone's project trees show it at
 * once, then the desktop keeps it and every screen reads the trees again.
 */
export async function saveOrder(group: OrderGroup, ids: string[]): Promise<void> {
  const projectId = pinnedProjectId(group);
  const apply = (tree: Tree | undefined) => tree && (projectId ? withPinnedOrder(tree, projectId, ids) : withStarredOrder(tree, ids));
  // The tree without the archived and the one with them (an open drawer reads it).
  queryClient.setQueryData<Tree>(['project-tree'], apply);
  queryClient.setQueryData<Tree>(['project-tree', 'all'], apply);
  try {
    await act(projectId ? 'set-pinned-order' : 'set-starred-order', [ids]);
  } catch (err: any) {
    Alert.alert('Could not change the order', err?.message || String(err));
  } finally {
    queryClient.invalidateQueries({ queryKey: ['project-tree'] });
  }
}
