import { describe, expect, it } from '@jest/globals';

import { clampRect, moveRect, NOTE_MIN, parseRect, resizeRect, saveOutcome, startRect, type Bounds } from '../model';

const screen: Bounds = { left: 0, top: 40, right: 800, bottom: 600 };

describe('clampRect', () => {
  it('leaves a rect inside the screen as it is', () => {
    expect(clampRect({ x: 100, y: 100, width: 400, height: 300 }, screen)).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  });

  it('moves one that sticks out back in, keeping its size', () => {
    expect(clampRect({ x: 700, y: 500, width: 400, height: 300 }, screen)).toEqual({ x: 400, y: 300, width: 400, height: 300 });
    expect(clampRect({ x: -50, y: 0, width: 400, height: 300 }, screen)).toEqual({ x: 0, y: 40, width: 400, height: 300 });
  });

  it('keeps the minimum size, and the screen when that is smaller', () => {
    expect(clampRect({ x: 0, y: 40, width: 10, height: 10 }, screen)).toMatchObject(NOTE_MIN);
    const small: Bounds = { left: 0, top: 0, right: 300, bottom: 200 };
    expect(clampRect({ x: 0, y: 0, width: 900, height: 900 }, small)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('moving and resizing', () => {
  const start = { x: 100, y: 100, width: 400, height: 300 };

  it('moves by the drag and stops at the screen edge', () => {
    expect(moveRect(start, 20, -10, screen)).toEqual({ x: 120, y: 90, width: 400, height: 300 });
    expect(moveRect(start, 5000, 5000, screen)).toEqual({ x: 400, y: 300, width: 400, height: 300 });
    expect(moveRect(start, -5000, -5000, screen)).toEqual({ x: 0, y: 40, width: 400, height: 300 });
  });

  it('resizes from the bottom right: the top left stays', () => {
    expect(resizeRect(start, 50, 30, screen)).toEqual({ x: 100, y: 100, width: 450, height: 330 });
  });

  it('does not get smaller than the minimum nor go past the screen', () => {
    expect(resizeRect(start, -1000, -1000, screen)).toEqual({ x: 100, y: 100, ...NOTE_MIN });
    expect(resizeRect(start, 5000, 5000, screen)).toEqual({ x: 100, y: 100, width: 700, height: 500 });
  });
});

describe('startRect', () => {
  it('is bottom right, inside the screen', () => {
    const rect = startRect(screen);
    expect(clampRect(rect, screen)).toEqual(rect);
    expect(rect.x + rect.width).toBeLessThan(screen.right);
    expect(rect.y + rect.height).toBeLessThan(screen.bottom);
  });

  it('fits a small phone', () => {
    expect(startRect({ left: 0, top: 30, right: 360, bottom: 700 })).toMatchObject({ width: 360 - 12 - 12 > 420 ? 420 : 360, height: 360 });
  });
});

describe('parseRect', () => {
  it('reads what was saved and nothing else', () => {
    expect(parseRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    for (const value of [null, undefined, 'x', {}, { x: 1, y: 2, width: 3 }, { x: 1, y: 2, width: 0, height: 4 }, { x: '1', y: 2, width: 3, height: 4 }, { x: NaN, y: 2, width: 3, height: 4 }]) {
      expect(parseRect(value)).toBeNull();
    }
  });
});

describe('saveOutcome', () => {
  it('is saved with the new version', () => {
    expect(saveOutcome({ ok: true, version: 'v2' })).toEqual({ kind: 'saved', version: 'v2' });
  });

  it('is changed when the file changed on the computer, with the version now there', () => {
    expect(saveOutcome({ ok: false, code: 'CHANGED', error: 'The file changed on the computer', version: 'v3' })).toEqual({ kind: 'changed', version: 'v3' });
  });

  it('is failed with the computer\'s reason, or a plain one', () => {
    expect(saveOutcome({ ok: false, error: 'Disk full' })).toEqual({ kind: 'failed', message: 'Disk full' });
    expect(saveOutcome(undefined)).toEqual({ kind: 'failed', message: 'That did not work' });
    expect(saveOutcome({ ok: false })).toEqual({ kind: 'failed', message: 'That did not work' });
  });
});
