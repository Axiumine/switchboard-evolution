import { expect, test } from '@jest/globals';

import { keepOrder } from '../stable-order';

const row = (key: string) => ({ key, label: key.toUpperCase() });
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

test('nothing shown yet: the rows come as they are', () => {
  expect(keys(keepOrder([row('a'), row('b'), row('c')], []))).toEqual(['a', 'b', 'c']);
});

test('rows already shown keep their places when the computer sends them in another order', () => {
  // Starting a session moves its project to the top of the project tree.
  const shown = ['p:garden', 't:garden-docs', 'p:kiln', 'p:atlas'];
  const reread = [row('p:atlas'), row('p:garden'), row('t:garden-docs'), row('p:kiln')];
  expect(keys(keepOrder(reread, shown))).toEqual(shown);
});

test('new rows go after the ones shown, in the order they came', () => {
  const reread = [row('p:new-one'), row('p:garden'), row('f:/tmp/other'), row('p:kiln')];
  expect(keys(keepOrder(reread, ['p:garden', 'p:kiln']))).toEqual(['p:garden', 'p:kiln', 'p:new-one', 'f:/tmp/other']);
});

test('rows that are gone are left out', () => {
  expect(keys(keepOrder([row('p:kiln')], ['p:garden', 'p:kiln']))).toEqual(['p:kiln']);
});

test('the rows themselves are the new ones, not the ones shown before', () => {
  const fresh = { key: 'p:garden', label: 'Garden (renamed)' };
  expect(keepOrder([fresh], ['p:garden'])[0]).toBe(fresh);
});
