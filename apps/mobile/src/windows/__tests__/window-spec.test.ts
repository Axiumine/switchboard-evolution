import { describe, expect, it } from '@jest/globals';

import { parseWindowSpec, windowTitle, WINDOW_TABS } from '../window-spec';

describe('a window spec', () => {
  it('reads a project tab, Stats and the Task Manager back from their JSON', () => {
    expect(parseWindowSpec(JSON.stringify({ kind: 'project', projectId: 'p1', tab: 'git' }))).toEqual({ kind: 'project', projectId: 'p1', tab: 'git' });
    expect(parseWindowSpec('{"kind":"stats"}')).toEqual({ kind: 'stats' });
    expect(parseWindowSpec('{"kind":"processes"}')).toEqual({ kind: 'processes' });
  });

  it('is nothing for what it does not know: no window then, rather than a broken one', () => {
    expect(parseWindowSpec(undefined)).toBeNull();
    expect(parseWindowSpec('not json')).toBeNull();
    expect(parseWindowSpec('{"kind":"project","projectId":"p1","tab":"session"}')).toBeNull();
    expect(parseWindowSpec('{"kind":"project","tab":"git"}')).toBeNull();
    expect(parseWindowSpec('{"kind":"terminal"}')).toBeNull();
  });

  it('offers the tabs the desktop pops out: not the Session tab, whose terminal stays in the main window', () => {
    expect(WINDOW_TABS).toEqual(['overview', 'plan', 'files', 'git', 'settings']);
  });

  it('is titled as the desktop titles its windows', () => {
    expect(windowTitle({ kind: 'project', projectId: 'p1', tab: 'files' }, 'Demo')).toBe('Demo · Files');
    expect(windowTitle({ kind: 'project', projectId: 'p1', tab: 'files' }, undefined)).toBe('Files');
    expect(windowTitle({ kind: 'stats' })).toBe('Stats');
    expect(windowTitle({ kind: 'processes' })).toBe('Task Manager');
  });
});
