import { describe, expect, it } from '@jest/globals';

import { backFromLeft, cardFrame, opensSplit, trimForLeftTouch } from '../carousel';

const hinge = { x: 540, width: 33.6 };
const W = 1113.6;

describe('cardFrame', () => {
  it('puts the last screen on the right and the one before on the left', () => {
    const right = cardFrame({ windowWidth: W, hinge, index: 2, top: true, full: false });
    expect(right.x).toBeCloseTo(573.6);
    expect(right.width).toBeCloseTo(540);
    expect(cardFrame({ windowWidth: W, hinge, index: 1, top: false, full: false })).toEqual({ x: 0, width: 540 });
  });

  it('gives the root both screens while it is alone', () => {
    expect(cardFrame({ windowWidth: W, hinge, index: 0, top: true, full: false })).toEqual({ x: 0, width: W });
    expect(cardFrame({ windowWidth: W, hinge, index: 0, top: false, full: false })).toEqual({ x: 0, width: 540 });
  });

  it('gives a split screen both screens', () => {
    expect(cardFrame({ windowWidth: W, hinge, index: 3, top: true, full: true })).toEqual({ x: 0, width: W });
  });

  it('is the whole window without a hinge', () => {
    expect(cardFrame({ windowWidth: 540, hinge: null, index: 2, top: true, full: false })).toEqual({ x: 0, width: 540 });
  });
});

describe('trimForLeftTouch', () => {
  const state = { index: 2, routes: [{ key: 'tabs' }, { key: 'project' }, { key: 'file' }] };

  it('lets what the left screen opens replace the right one', () => {
    expect(trimForLeftTouch(state, 'PUSH', 'project')).toEqual({ index: 1, routes: [{ key: 'tabs' }, { key: 'project' }] });
    expect(trimForLeftTouch(state, 'NAVIGATE', 'project').routes.map((r) => r.key)).toEqual(['tabs', 'project']);
  });

  it('leaves the stack alone for a touch on the right, an unknown screen or another action', () => {
    expect(trimForLeftTouch(state, 'PUSH', 'file')).toBe(state);
    expect(trimForLeftTouch(state, 'PUSH', 'gone')).toBe(state);
    expect(trimForLeftTouch(state, 'PUSH', null)).toBe(state);
    expect(trimForLeftTouch(state, 'GO_BACK', 'project')).toBe(state);
  });

  it('keeps the right screen when the left one only changes its params (a project tab)', () => {
    expect(trimForLeftTouch(state, 'SET_PARAMS', 'project')).toBe(state);
  });
});

describe('opensSplit', () => {
  it('takes both screens only when asked to (Split screen)', () => {
    expect(opensSplit({})).toBe(false);
    expect(opensSplit({ split: '0' })).toBe(false);
    expect(opensSplit({ split: '1' })).toBe(true);
  });
});

describe('backFromLeft', () => {
  const state = { index: 2, routes: [{ key: 'tabs' }, { key: 'project' }, { key: 'file' }] };

  it('takes back from the left screen past both screens', () => {
    expect(backFromLeft(state, { type: 'GO_BACK', source: 'project' })).toEqual({ index: 0, routes: [{ key: 'tabs' }] });
  });

  it('leaves back from the right screen, or from nowhere in particular, to the stack', () => {
    expect(backFromLeft(state, { type: 'GO_BACK', source: 'file' })).toBeNull();
    expect(backFromLeft(state, { type: 'GO_BACK' })).toBeNull();
    expect(backFromLeft(state, { type: 'PUSH', source: 'project' })).toBeNull();
    expect(backFromLeft(state, { type: 'SET_PARAMS', source: 'project' })).toBeNull();
  });

  it('cannot go back from the root', () => {
    expect(backFromLeft({ index: 1, routes: [{ key: 'tabs' }, { key: 'project' }] }, { type: 'GO_BACK', source: 'tabs' })).toBeNull();
  });
});
