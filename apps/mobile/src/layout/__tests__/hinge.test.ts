import { describe, expect, it } from '@jest/globals';

import { hingeFor } from '../hinge';

describe('hingeFor', () => {
  it('finds the Surface Duo hinge with the app across both screens', () => {
    // 2784 px at 2.5: two screens of 1350 px around 84 px of hinge.
    expect(hingeFor('Surface Duo', 1113.6, 2.5)).toEqual({ x: 540, width: 33.6 });
  });

  it('finds the Surface Duo 2 hinge with the app across both screens', () => {
    // 2754 px at 2.5: two screens of 1344 px around 66 px of hinge.
    const hinge = hingeFor('Surface Duo 2', 1101.6, 2.5);
    expect(hinge?.x).toBeCloseTo(537.6);
    expect(hinge?.width).toBeCloseTo(26.4);
  });

  it('follows a display size other than the default, since it counts in pixels', () => {
    const hinge = hingeFor('Surface Duo', 2784 / 3, 3);
    expect(hinge?.x).toBeCloseTo(450);
    expect(hinge?.width).toBeCloseTo(28);
  });

  it('finds none with the app on one screen', () => {
    expect(hingeFor('Surface Duo', 540, 2.5)).toBeNull();
    expect(hingeFor('Surface Duo', 720, 2.5)).toBeNull();
    expect(hingeFor('Surface Duo 2', 537.6, 2.5)).toBeNull();
  });

  it('finds none with the screens one above the other, which is not handled yet', () => {
    // Stacked, the window is as wide as one screen held sideways.
    expect(hingeFor('Surface Duo', 1800 / 2.5, 2.5)).toBeNull();
  });

  it('finds none on any other device, whatever its width', () => {
    expect(hingeFor('Pixel 9', 1113.6, 2.5)).toBeNull();
    expect(hingeFor('iPad Pro', 1113.6, 2.5)).toBeNull();
    expect(hingeFor(null, 1113.6, 2.5)).toBeNull();
  });
});
