import { describe, expect, it } from '@jest/globals';

import { FIT_BY_DEFAULT, fitNote, sizeLabel } from '../defaults';

describe('terminal defaults', () => {
  it('opens at the computer size: Fit to phone starts off', () => {
    expect(FIT_BY_DEFAULT).toBe(false);
  });

  it('says which computer a fit resizes', () => {
    expect(fitNote('Test Mac')).toBe('Also resizes the terminal on Test Mac');
    expect(fitNote(undefined)).toBe('Also resizes the terminal on the computer');
  });

  it('labels a size as columns by rows', () => {
    expect(sizeLabel(100, 36)).toBe('100×36');
    expect(sizeLabel(0, 0)).toBe('');
  });
});
