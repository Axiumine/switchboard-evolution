import { describe, expect, it } from '@jest/globals';

import { GIT_VIEWS, PROJECT_TABS, parseGitView, parseSessionView, parseTab } from '../tabs';

describe('parseTab', () => {
  it('returns a known key as it is', () => {
    expect(parseTab('git')).toBe('git');
    expect(parseTab('plan')).toBe('plan');
    expect(parseTab('session')).toBe('session');
  });

  it('opens Git for the tabs that moved under it', () => {
    expect(parseTab('gitgraph')).toBe('git');
    expect(parseTab('worktrees')).toBe('git');
  });

  it('falls back to overview for anything else', () => {
    expect(parseTab('x')).toBe('overview');
    expect(parseTab('changes')).toBe('overview');
    expect(parseTab(undefined)).toBe('overview');
    expect(parseTab(['plan'])).toBe('overview');
    expect(parseTab(null)).toBe('overview');
  });
});

describe('parseGitView', () => {
  it('reads a view, or the old tab it replaces', () => {
    expect(parseGitView('worktrees')).toBe('worktrees');
    expect(parseGitView('history')).toBe('history');
    expect(parseGitView('gitgraph')).toBe('history');
    expect(parseGitView('git')).toBeNull();
    expect(parseGitView(undefined)).toBeNull();
  });
});

describe('PROJECT_TABS', () => {
  it('lists the six tabs in the desktop order', () => {
    expect(PROJECT_TABS.map((t) => t.label)).toEqual(['Overview', 'Session', 'Plan', 'Files', 'Git', 'Settings']);
  });

  it('puts Changes, History and Worktrees under Git', () => {
    expect(GIT_VIEWS.map((v) => v.label)).toEqual(['Changes', 'History', 'Worktrees']);
  });
});

describe('parseSessionView', () => {
  it('reads chat or terminal, nothing else', () => {
    expect(parseSessionView('terminal')).toBe('terminal');
    expect(parseSessionView('chat')).toBe('chat');
    expect(parseSessionView('x')).toBeUndefined();
    expect(parseSessionView(undefined)).toBeUndefined();
  });
});
