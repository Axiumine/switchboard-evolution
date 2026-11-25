import { describe, expect, it } from '@jest/globals';

import { FIND_DEFAULTS, findCountText, findDelay } from '../find';

describe('what the find bar says', () => {
  it('counts as the desktop does', () => {
    expect(findCountText({ count: 12, current: 3, limited: false }, 'x')).toBe('3 of 12');
    expect(findCountText({ count: 12, current: 0, limited: false }, 'x')).toBe('? of 12');
    expect(findCountText({ count: 20000, current: 1, limited: true }, 'x')).toBe('1 of 20000+');
    expect(findCountText({ count: 0, current: 0, limited: false }, 'x')).toBe('No results');
  });

  it('says nothing without a query, and what is wrong with a pattern', () => {
    expect(findCountText({ count: 3, current: 1, limited: false }, '')).toBe('');
    expect(findCountText(null, 'x')).toBe('');
    expect(findCountText({ count: 0, current: 0, limited: false, error: 'Invalid regular expression: /(/: Unterminated group' }, '(')).toBe('/(/: Unterminated group');
    expect(findCountText({ count: 4, current: 0, limited: false, replaced: 4 }, 'x')).toBe('Replaced 4');
  });

  it('waits longer in a large text, and starts with every option off', () => {
    expect(findDelay(10)).toBeLessThan(findDelay(2 * 1024 * 1024));
    expect(Object.values(FIND_DEFAULTS).every((on) => on === false)).toBe(true);
  });
});
