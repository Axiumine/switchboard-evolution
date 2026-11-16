import { describe, expect, it } from '@jest/globals';

import { layoutClass } from '../size';

describe('layoutClass', () => {
  it('is compact below 600', () => {
    expect(layoutClass(0)).toBe('compact');
    expect(layoutClass(599)).toBe('compact');
  });

  it('is medium from 600 to 743', () => {
    expect(layoutClass(600)).toBe('medium');
    expect(layoutClass(743)).toBe('medium');
  });

  it('is expanded from 744', () => {
    expect(layoutClass(744)).toBe('expanded');
    expect(layoutClass(1194)).toBe('expanded');
  });
});
