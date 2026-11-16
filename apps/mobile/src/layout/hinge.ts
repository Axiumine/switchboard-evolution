import * as Device from 'expo-device';
import { PixelRatio, useWindowDimensions } from 'react-native';

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

/** The hinge in this window now, or null. */
export function useHinge(): Hinge | null {
  const { width } = useWindowDimensions();
  return hingeFor(Device.modelName, width, PixelRatio.get());
}
