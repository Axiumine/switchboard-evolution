import { describe, expect, it } from '@jest/globals';

import { GIT_VIEWS, PROJECT_TABS, parseGitView, parseSessionView, parseTab, swipeTab } from '../tabs';

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

describe('swipeTab', () => {
  // The bar without Session: no session opened in the project yet.
  const tabs = PROJECT_TABS.filter(({ key }) => key !== 'session');
  const swipe = (dx: number, { dy = 0, vx = 0 } = {}) => ({ dx, dy, vx });

  it('goes to the next tab for a swipe to the left and to the one before for a swipe to the right', () => {
    expect(swipeTab(tabs, 'plan', swipe(-80))).toBe('files');
    expect(swipeTab(tabs, 'plan', swipe(80))).toBe('overview');
    // Session is skipped when it is not in the bar, and taken when it is.
    expect(swipeTab(tabs, 'overview', swipe(-80))).toBe('plan');
    expect(swipeTab(PROJECT_TABS, 'overview', swipe(-80))).toBe('session');
  });

  it('stops at the first and the last tab', () => {
    expect(swipeTab(tabs, 'overview', swipe(80))).toBeNull();
    expect(swipeTab(tabs, 'settings', swipe(-80))).toBeNull();
  });

  it('takes a short swipe only when it is fast', () => {
    expect(swipeTab(tabs, 'plan', swipe(-40))).toBeNull();
    expect(swipeTab(tabs, 'plan', swipe(-40, { vx: -900 }))).toBe('files');
    expect(swipeTab(tabs, 'plan', swipe(-20, { vx: -2000 }))).toBeNull();
  });

  it('leaves a move that went more up or down than sideways', () => {
    expect(swipeTab(tabs, 'plan', swipe(-80, { dy: 70 }))).toBeNull();
    expect(swipeTab(tabs, 'plan', swipe(-80, { dy: 40 }))).toBe('files');
  });

  it('does nothing for a tab that is not in the bar', () => {
    expect(swipeTab(tabs, 'session', swipe(-80))).toBeNull();
  });
});
