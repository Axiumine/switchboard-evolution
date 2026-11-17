import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/** Window size classes, aligned with Material's: phones, small tablets and split screens, full tablets. */
export type LayoutClass = 'compact' | 'medium' | 'expanded';

/** The class of a window `width` in dp: < 600 compact, 600 to 743 medium, >= 744 expanded. */
export function layoutClass(width: number): LayoutClass {
  if (width < 600) return 'compact';
  if (width < 744) return 'medium';
  return 'expanded';
}

/**
 * The width of the area a view lives in, when it is not the whole window: one
 * screen of a Surface Duo (AppStack sets it per screen). Read it through the hooks
 * below, never from the window: lint keeps useWindowDimensions in this folder.
 */
export const AreaWidth = createContext<number | null>(null);

/** The width the app has where this view is: the window, or one screen of a Surface Duo. */
export function useAreaWidth(): number {
  const area = useContext(AreaWidth);
  const { width } = useWindowDimensions();
  return area ?? width;
}

/** The height of the window (a Surface Duo's two screens share it). */
export function useWindowHeight(): number {
  return useWindowDimensions().height;
}

/** The class of the area now (it follows rotation, Split View, multi-window and a Surface Duo's screens). */
export function useLayoutClass(): LayoutClass {
  return layoutClass(useAreaWidth());
}

/**
 * The width the project workspace has. For now the whole area; once the
 * desktop shell has a sidebar this subtracts it, and every tab reads this.
 */
export function useWorkspaceWidth(): number {
  return useAreaWidth();
}
