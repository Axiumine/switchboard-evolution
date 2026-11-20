import { describe, expect, it } from '@jest/globals';

import { clampFontSize, FONT_DEFAULT, FONT_MAX, FONT_MIN, scaleTextStyles, useEditorFont } from '../font';

describe('the editor font size', () => {
  it('stays between its smallest and largest, in whole px', () => {
    expect(clampFontSize(2)).toBe(FONT_MIN);
    expect(clampFontSize(80)).toBe(FONT_MAX);
    expect(clampFontSize(13.4)).toBe(13);
    expect(clampFontSize(NaN)).toBe(FONT_DEFAULT);
  });

  it('steps by one and stops at the bounds', () => {
    const { bigger, smaller } = useEditorFont.getState();
    expect(useEditorFont.getState().size).toBe(FONT_DEFAULT);
    bigger();
    expect(useEditorFont.getState().size).toBe(FONT_DEFAULT + 1);
    smaller();
    smaller();
    expect(useEditorFont.getState().size).toBe(FONT_DEFAULT - 1);
    for (let i = 0; i < 40; i++) smaller();
    expect(useEditorFont.getState().size).toBe(FONT_MIN);
    for (let i = 0; i < 40; i++) bigger();
    expect(useEditorFont.getState().size).toBe(FONT_MAX);
  });
});

describe('scaleTextStyles', () => {
  const base = { body: { color: 'red', fontSize: 15, lineHeight: 22 }, h: { fontSize: 24, marginTop: 8, marginBottom: 4 }, link: { color: 'blue' } };

  it('multiplies sizes and leaves the rest', () => {
    expect(scaleTextStyles(base, 2)).toEqual({
      body: { color: 'red', fontSize: 30, lineHeight: 44 },
      h: { fontSize: 48, marginTop: 16, marginBottom: 8 },
      link: { color: 'blue' },
    });
  });

  it('is the same styles at 1, and does not change the ones it was given', () => {
    expect(scaleTextStyles(base, 1)).toEqual(base);
    scaleTextStyles(base, 3);
    expect(base.body.fontSize).toBe(15);
  });
});
