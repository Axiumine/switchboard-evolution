import { expect, test } from '@jest/globals';

import { COMPARE_MAX, compareLabel, compareMatrix, compareOrder, compareSteps, compareTarget, type FileChange } from '../compare';

// Newest first, the Uncommitted Changes row on top, as the History lists them.
const history = [{ hash: '#uncommitted' }, { hash: 'e' }, { hash: 'd' }, { hash: 'c' }, { hash: 'b' }, { hash: 'a' }];

test('the selection goes oldest to newest, whatever the order it was ticked in', () => {
  expect(compareOrder(history, ['d', 'a', 'e'])).toEqual(['a', 'd', 'e']);
  expect(compareOrder(history, new Set(['b', 'c']))).toEqual(['b', 'c']);
});

test('Uncommitted Changes is always the last', () => {
  expect(compareOrder(history, ['#uncommitted', 'b', 'e'])).toEqual(['b', 'e', '#uncommitted']);
});

test('hashes that are not in the history are dropped', () => {
  expect(compareOrder(history, ['c', 'gone', 'a'])).toEqual(['a', 'c']);
  expect(compareOrder(history, [])).toEqual([]);
});

test('the steps are the consecutive pairs', () => {
  expect(compareSteps(['a', 'c', 'e'])).toEqual([{ from: 'a', to: 'c' }, { from: 'c', to: 'e' }]);
  expect(compareSteps(['a', 'b'])).toEqual([{ from: 'a', to: 'b' }]);
  expect(compareSteps(['a'])).toEqual([]);
  expect(compareSteps([])).toEqual([]);
});

test('at most four commits make three steps', () => {
  expect(COMPARE_MAX).toBe(4);
  expect(compareSteps(['a', 'b', 'c', 'd'])).toHaveLength(COMPARE_MAX - 1);
});

test('the working tree is asked for as null', () => {
  expect(compareTarget('#uncommitted')).toBeNull();
  expect(compareTarget('abc')).toBe('abc');
});

test('labels: the short hash, Uncommitted, or the stash', () => {
  expect(compareLabel({ kind: 'commit', shortHash: 'a1b2c3d' })).toBe('a1b2c3d');
  expect(compareLabel({ kind: 'uncommitted', shortHash: '' })).toBe('Uncommitted');
  expect(compareLabel({ kind: 'stash', shortHash: 'deadbeef', stashIndex: 2 })).toBe('stash@{2}');
  expect(compareLabel({ kind: 'stash', shortHash: 'deadbeef', stashIndex: null })).toBe('deadbeef');
});

const file = (path: string, status: FileChange['status'] = 'modified', insertions = 1, deletions = 0, oldPath: string | null = null): FileChange => ({ path, oldPath, status, insertions, deletions });

test('the table is the union of the paths, sorted, with null where a step left the file alone', () => {
  const one = [file('src/b.ts'), file('db/schema.sql', 'added', 40)];
  const two = [file('src/b.ts', 'modified', 4, 1), file('src/a.ts')];
  const rows = compareMatrix([one, two]);
  expect(rows.map((r) => r.path)).toEqual(['db/schema.sql', 'src/a.ts', 'src/b.ts']);
  expect(rows[0].cells).toEqual([one[1], null]);
  expect(rows[1].cells).toEqual([null, two[1]]);
  expect(rows[2].cells).toEqual([one[0], two[0]]);
});

test('a renamed file is listed under its new path', () => {
  const renamed = file('src/new.ts', 'renamed', 0, 0, 'src/old.ts');
  const rows = compareMatrix([[renamed], []]);
  expect(rows).toEqual([{ path: 'src/new.ts', cells: [renamed, null] }]);
});

test('no steps or no files make an empty table', () => {
  expect(compareMatrix([])).toEqual([]);
  expect(compareMatrix([[], []])).toEqual([]);
});
