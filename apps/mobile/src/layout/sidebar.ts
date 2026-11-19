import { create } from 'zustand';

import type { Hinge } from '@/layout/hinge';
import { layoutClass } from '@/layout/size';
import { loadPrefs, savePrefs } from '@/store/prefs';

// A wide window (Samsung DeX, a tablet) is laid out as the desktop is: the
// sidebar on the left, the workspace on the right. It is the Surface Duo's
// two screens (DuoTabs, AppStack) with the sidebar where the hinge was, and a
// divider the user drags to make the sidebar wider or narrower.

export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_DEFAULT = 360;
/** The band between the sidebar and the workspace: the divider's line. */
export const DIVIDER = 1;
/** The workspace is never narrower than this, whatever the sidebar asks. */
export const WORKSPACE_MIN = 360;

/** A sidebar width that fits: whole dp, between its narrowest and widest, leaving the workspace its room. */
export function clampSidebar(width: number, windowWidth: number): number {
  const widest = Math.min(SIDEBAR_MAX, windowWidth - DIVIDER - WORKSPACE_MIN);
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(width, widest)));
}

/** Where the sidebar ends in a window this wide, in dp; null when the window is not wide (under 744 dp). */
export function sidebarSplit(windowWidth: number, sidebarWidth: number): Hinge | null {
  if (layoutClass(windowWidth) !== 'expanded') return null;
  return { x: clampSidebar(sidebarWidth, windowWidth), width: DIVIDER };
}

const saved = loadPrefs().sidebarWidth;

/** The width the user gave the sidebar, kept between runs. */
export const useSidebar = create<{ width: number; setWidth(width: number): void; save(): void }>((set, get) => ({
  width: typeof saved === 'number' && Number.isFinite(saved) ? saved : SIDEBAR_DEFAULT,
  setWidth: (width) => set({ width }),
  save: () => savePrefs({ sidebarWidth: get().width }),
}));
