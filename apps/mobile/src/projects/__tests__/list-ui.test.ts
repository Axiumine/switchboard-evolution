import { beforeEach, describe, expect, it } from '@jest/globals';

import { DEFAULT_LIST_UI } from '../drawer';
import { useListUi } from '../list-ui';

describe('reveal', () => {
  beforeEach(() => useListUi.setState({ ...DEFAULT_LIST_UI, selectedSession: null, revealCount: 0 }));

  it('highlights the session and opens its project’s drawer', () => {
    useListUi.getState().reveal({ sessionId: 's1', projectId: 'p1' });
    const state = useListUi.getState();
    expect(state.selectedSession).toBe('s1');
    expect(state.expanded).toEqual({ p1: true });
    expect(state.revealCount).toBe(1);
  });

  it('opens No project and the folder of a session of no project', () => {
    useListUi.getState().reveal({ sessionId: 's2', projectId: null, projectPath: '/code/loose' });
    const state = useListUi.getState();
    expect(state.otherOpen).toBe(true);
    expect(state.otherFolders).toEqual({ '/code/loose': true });
    expect(state.revealCount).toBe(1);
  });

  it('counts every reveal, so the Duo turns to Projects each time', () => {
    useListUi.getState().reveal({ sessionId: 's1', projectId: 'p1' });
    useListUi.getState().reveal({ sessionId: 's1', projectId: 'p1' });
    expect(useListUi.getState().revealCount).toBe(2);
  });
});
