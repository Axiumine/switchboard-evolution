import * as Device from 'expo-device';
import { Dimensions, PixelRatio, useWindowDimensions } from 'react-native';

import { sidebarSplit, useSidebar } from '@/layout/sidebar';
import { layoutClass } from '@/layout/size';

// Surface Duo and Duo 2 run one app across two screens, and the hinge between
// them hides a band in the middle of the window. Android says nothing about it
// there, so it is known by model. Microsoft's figures, in pixels so they hold
// at any display size: across both screens 2784 px on the Duo and 2754 px on
// the Duo 2, of which the hinge is 84 and 66 px.

/** The band the hinge hides, in dp from the window's left edge. */
export type Hinge = { x: number; width: number };

const DUOS: Record<string, { across: number; hinge: number }> = {
  'Surface Duo': { across: 2784, hinge: 84 },
  'Surface Duo 2': { across: 2754, hinge: 66 },
};

/**
 * The hinge of a Surface Duo whose app spans both screens side by side, from
 * the model, the window width in dp and the pixels per dp; null anywhere else.
 * With the screens one above the other the hinge runs across the window
 * instead, which is not handled yet.
 */
export function hingeFor(model: string | null, width: number, scale: number): Hinge | null {
  const duo = model ? DUOS[model] : undefined;
  if (!duo || Math.abs(width * scale - duo.across) > 2) return null;
  return { x: (duo.across - duo.hinge) / 2 / scale, width: duo.hinge / scale };
}

/** Whether this is a Surface Duo or Duo 2, open or not: it gets the two-screen carousel (AppStack). */
export function isDuoModel(model: string | null = Device.modelName): boolean {
  return !!model && model in DUOS;
}

/**
 * The band between the two panes: a Duo's hinge, or anywhere else the edge of
 * the sidebar in a wide window (sidebar.ts); null with one pane.
 */
export function splitFor(model: string | null, width: number, scale: number, sidebarWidth: number): Hinge | null {
  if (isDuoModel(model)) return hingeFor(model, width, scale);
  return sidebarSplit(width, sidebarWidth);
}

/** The band between the panes in this window now, or null. */
export function useHinge(): Hinge | null {
  const { width } = useWindowDimensions();
  const sidebar = useSidebar((s) => s.width);
  return splitFor(Device.modelName, width, PixelRatio.get(), sidebar);
}

/** The band between the panes for a window this wide, read outside React (a card's animation). */
export function splitNow(width: number): Hinge | null {
  return splitFor(Device.modelName, width, PixelRatio.get(), useSidebar.getState().width);
}

/** Whether the panes are a sidebar and a workspace (a wide window) rather than a Duo's two screens. */
export function hasSidebar(model: string | null = Device.modelName): boolean {
  return !isDuoModel(model);
}

/**
 * Whether the app is laid out in two panes, with the Duo's navigators
 * (DuoTabs, AppStack's carousel): on a Duo, and in a wide window anywhere else.
 */
export function useTwoPanes(): boolean {
  const { width } = useWindowDimensions();
  return isDuoModel() || layoutClass(width) === 'expanded';
}

/** useTwoPanes, read outside React. */
export function twoPanesNow(): boolean {
  return isDuoModel() || layoutClass(Dimensions.get('window').width) === 'expanded';
}
