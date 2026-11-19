import type { Hinge } from '@/layout/hinge';

// On a Surface Duo open across both screens the stack of screens is shown two
// at a time, like a carousel: the last screen on the right, the one before it
// on the left. Opening something slides the right screen to the left; going
// back slides everything one step the other way. The root has both screens
// while it is alone, and so does a session split into chat and terminal.
// A screen changing its own params (a project switching tab on the left)
// leaves the other screen where it is. These are the rules; AppStack draws them.

/**
 * Where a screen of the stack sits once it has arrived, in dp. Beside a
 * sidebar (`sidebar`, a wide window that is not a Duo) the root keeps the
 * sidebar and everything opened after it stays on the right, as on the
 * desktop: nothing slides into the sidebar.
 */
export function cardFrame({ windowWidth, hinge, index, top, full, sidebar = false }: {
  windowWidth: number;
  hinge: Hinge | null;
  /** Its place in the stack: 0 is the root. */
  index: number;
  /** Whether it is the last screen. */
  top: boolean;
  /** Whether it wants both screens (a split session). */
  full: boolean;
  /** Whether the band is a sidebar's edge rather than a Duo's hinge. */
  sidebar?: boolean;
}): { x: number; width: number } {
  if (!hinge) return { x: 0, width: windowWidth };
  if (sidebar) {
    if (index === 0) return { x: 0, width: top ? windowWidth : hinge.x };
    return { x: hinge.x + hinge.width, width: windowWidth - hinge.x - hinge.width };
  }
  if (top && (index === 0 || full)) return { x: 0, width: windowWidth };
  if (top) return { x: hinge.x + hinge.width, width: windowWidth - hinge.x - hinge.width };
  return { x: 0, width: hinge.x };
}

type StackState = { index: number; routes: { key: string }[] };

/**
 * What a screen on the left opens replaces the screens to its right: picking
 * another project in the list on the left swaps the project on the right,
 * instead of piling up behind it. `touched` is the screen the user last
 * touched; a touch on the right one, or none, changes nothing.
 */
export function trimForLeftTouch<S extends StackState>(state: S, actionType: string, touched: string | null): S {
  if (!touched || (actionType !== 'PUSH' && actionType !== 'NAVIGATE')) return state;
  const at = state.routes.findIndex((route) => route.key === touched);
  if (at < 0 || at >= state.index) return state;
  return { ...state, routes: state.routes.slice(0, at + 1), index: at };
}

/**
 * Back from the screen on the left takes both screens away: the stack goes
 * back to before that screen, and the one before it comes to the right. Back
 * from the right screen (or from the system) is the stack's own. Null when
 * the stack should handle the action itself.
 */
export function backFromLeft<S extends StackState>(state: S, action: { type: string; source?: string }): S | null {
  if ((action.type !== 'GO_BACK' && action.type !== 'POP') || !action.source) return null;
  const at = state.routes.findIndex((route) => route.key === action.source);
  if (at < 1 || at >= state.index) return null;
  return { ...state, routes: state.routes.slice(0, at), index: at - 1 };
}

/**
 * Whether a session takes both screens, chat on the left and terminal on the
 * right: only when asked to (Split screen in its menu sets `split=1`). Opened
 * from any list it goes on the right screen, the list staying on the left.
 */
export function opensSplit(params: { split?: string }): boolean {
  return params.split === '1';
}
