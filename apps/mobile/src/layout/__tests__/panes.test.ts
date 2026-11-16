import { describe, expect, it } from '@jest/globals';

import { paneMode } from '../panes';

describe('paneMode', () => {
  it('shows only the list where the detail does not fit beside it', () => {
    expect(paneMode({ width: 390, minWidth: 600 })).toBe('single');
    expect(paneMode({ width: 599, minWidth: 600 })).toBe('single');
  });

  it('puts the detail beside the list from the page minimum up', () => {
    expect(paneMode({ width: 600, minWidth: 600 })).toBe('split');
    expect(paneMode({ width: 1194, minWidth: 600 })).toBe('split');
  });
});
