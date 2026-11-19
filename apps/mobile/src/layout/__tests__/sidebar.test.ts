import { describe, expect, it } from '@jest/globals';

import { clampSidebar, DIVIDER, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, sidebarSplit, WORKSPACE_MIN } from '../sidebar';

describe('sidebarSplit', () => {
  it('is there only in a wide window (expanded, from 744 dp)', () => {
    expect(sidebarSplit(743, SIDEBAR_DEFAULT)).toBeNull();
    expect(sidebarSplit(744, SIDEBAR_DEFAULT)).toEqual({ x: SIDEBAR_DEFAULT, width: DIVIDER });
    expect(sidebarSplit(1920, SIDEBAR_DEFAULT)).toEqual({ x: SIDEBAR_DEFAULT, width: DIVIDER });
  });

  it('keeps the sidebar between its narrowest and widest', () => {
    expect(sidebarSplit(1920, 100)?.x).toBe(SIDEBAR_MIN);
    expect(sidebarSplit(1920, 2000)?.x).toBe(SIDEBAR_MAX);
  });

  it('always leaves the workspace room on the right', () => {
    const split = sidebarSplit(800, SIDEBAR_MAX)!;
    expect(800 - split.x - split.width).toBeGreaterThanOrEqual(WORKSPACE_MIN);
  });
});

describe('clampSidebar', () => {
  it('rounds to whole dp', () => {
    expect(clampSidebar(400.6, 1920)).toBe(401);
  });

  it('never goes under its narrowest, even in a window too small for both', () => {
    expect(clampSidebar(500, 600)).toBe(SIDEBAR_MIN);
  });
});
