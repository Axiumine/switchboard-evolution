import { describe, expect, it } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';

import { refreshSessionLists } from '../refresh';

describe('after an action on a session', () => {
  it('reads again the Sessions list and the project trees, the one with the archived too', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const keys = [['projects'], ['project-tree'], ['project-tree', 'all']];
    for (const key of keys) client.setQueryData(key, { at: 'before' });
    client.setQueryData(['worktrees', 'p'], { at: 'before' });
    await refreshSessionLists(client);
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    // Nothing else is read again.
    expect(client.getQueryState(['worktrees', 'p'])?.isInvalidated).toBe(false);
    client.clear();
  });
});
