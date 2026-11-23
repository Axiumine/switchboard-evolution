import { describe, expect, it } from '@jest/globals';

import { parseWindowSpec, windowTitle, WINDOW_TABS } from '../window-spec';

describe('a window spec', () => {
  it('reads a project tab, Stats and the Task Manager back from their JSON', () => {
    expect(parseWindowSpec(JSON.stringify({ kind: 'project', projectId: 'p1', tab: 'git' }))).toEqual({ kind: 'project', projectId: 'p1', tab: 'git' });
    expect(parseWindowSpec('{"kind":"stats"}')).toEqual({ kind: 'stats' });
    expect(parseWindowSpec('{"kind":"processes"}')).toEqual({ kind: 'processes' });
  });

  it('reads a project\'s note back, which needs the project', () => {
    expect(parseWindowSpec(JSON.stringify({ kind: 'note', projectId: 'p1' }))).toEqual({ kind: 'note', projectId: 'p1' });
    expect(parseWindowSpec('{"kind":"note"}')).toBeNull();
    expect(parseWindowSpec('{"kind":"note","projectId":""}')).toBeNull();
  });

  it('reads a pull request\'s page back, over https only', () => {
    const url = 'https://github.com/acme/widgets/pull/4';
    expect(parseWindowSpec(JSON.stringify({ kind: 'web', url, title: '#4 Add filters' }))).toEqual({ kind: 'web', url, title: '#4 Add filters' });
    expect(parseWindowSpec(JSON.stringify({ kind: 'web', url }))).toEqual({ kind: 'web', url, title: '' });
    expect(parseWindowSpec(JSON.stringify({ kind: 'web', url: 'http://github.com/acme/widgets/pull/4' }))).toBeNull();
    expect(parseWindowSpec(JSON.stringify({ kind: 'web', url: 'javascript:alert(1)' }))).toBeNull();
    expect(parseWindowSpec('{"kind":"web"}')).toBeNull();
  });

  it('is nothing for what it does not know: no window then, rather than a broken one', () => {
    expect(parseWindowSpec(undefined)).toBeNull();
    expect(parseWindowSpec('not json')).toBeNull();
    expect(parseWindowSpec('{"kind":"project","projectId":"p1","tab":"session"}')).toBeNull();
    expect(parseWindowSpec('{"kind":"project","tab":"git"}')).toBeNull();
    expect(parseWindowSpec('{"kind":"terminal"}')).toBeNull();
  });

  it('offers the tabs the desktop pops out: not the Session tab, whose terminal stays in the main window', () => {
    expect(WINDOW_TABS).toEqual(['overview', 'plan', 'todos', 'files', 'git', 'knowledge', 'settings']);
  });

  it('is titled as the desktop titles its windows', () => {
    expect(windowTitle({ kind: 'project', projectId: 'p1', tab: 'files' }, 'Demo')).toBe('Demo · Files');
    expect(windowTitle({ kind: 'project', projectId: 'p1', tab: 'files' }, undefined)).toBe('Files');
    expect(windowTitle({ kind: 'note', projectId: 'p1' }, 'Demo')).toBe('Demo · Note');
    expect(windowTitle({ kind: 'note', projectId: 'p1' })).toBe('Note');
    expect(windowTitle({ kind: 'stats' })).toBe('Stats');
    expect(windowTitle({ kind: 'processes' })).toBe('Task Manager');
    expect(windowTitle({ kind: 'web', url: 'https://github.com/acme/widgets/pull/4', title: '#4 Add filters' })).toBe('#4 Add filters');
    expect(windowTitle({ kind: 'web', url: 'https://github.com/acme/widgets/pull/4', title: '' })).toBe('Pull request');
  });
});
