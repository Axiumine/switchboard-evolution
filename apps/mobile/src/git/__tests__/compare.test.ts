import { expect, test } from '@jest/globals';

import {
  COMPARE_MAX, compareBase, compareLabel, compareMatrix, compareOrder, compareParams, compareSteps, compareTarget, diffRouteAfter, parseSubjects, type FileChange,
} from '../compare';

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

const rows = [
  { hash: '#uncommitted', kind: 'uncommitted' as const, shortHash: '', subject: 'Uncommitted Changes' },
  { hash: 'bbbbbbbb1', kind: 'commit' as const, shortHash: 'bbbbbbb', subject: 'fix(db): retry, then give up' },
  { hash: 'aaaaaaaa1', kind: 'commit' as const, shortHash: 'aaaaaaa', subject: 'Add "quotes" and, commas' },
];

test('the params of the compare screen keep the order and put the subjects in JSON', () => {
  const params = compareParams(rows, ['aaaaaaaa1', 'bbbbbbbb1', '#uncommitted']);
  expect(params.hashes).toBe('aaaaaaaa1,bbbbbbbb1,#uncommitted');
  expect(params.labels).toBe('aaaaaaa,bbbbbbb,Uncommitted');
  expect(parseSubjects(params.subjects)).toEqual(['Add "quotes" and, commas', 'fix(db): retry, then give up', 'Uncommitted Changes']);
});

test('the params skip a hash that is not in the rows', () => {
  const params = compareParams(rows, ['aaaaaaaa1', 'gone']);
  expect(params.hashes).toBe('aaaaaaaa1');
  expect(parseSubjects(params.subjects)).toHaveLength(1);
});

test('the subjects param is read defensively', () => {
  expect(parseSubjects(undefined)).toEqual([]);
  expect(parseSubjects('')).toEqual([]);
  expect(parseSubjects('not json')).toEqual([]);
  expect(parseSubjects('{"a":1}')).toEqual([]);
  expect(parseSubjects('["a",3,null,"b"]')).toEqual(['a', '', '', 'b']);
  expect(parseSubjects(['a'])).toEqual([]);
});

test('Compare with starts from the open row, else the only ticked one', () => {
  expect(compareBase('x', ['y'])).toBe('x');
  expect(compareBase(null, ['y'])).toBe('y');
  expect(compareBase(null, new Set(['y', 'z']))).toBeNull();
  expect(compareBase(null, [])).toBeNull();
});

test('only a diff screen right after the comparison is changed rather than pushed', () => {
  const routes = [{ key: 'h', name: 'graph' }, { key: 'c', name: 'compare' }, { key: 'd', name: 'compare-diff' }];
  expect(diffRouteAfter(routes, 'c')).toBe(routes[2]);
  expect(diffRouteAfter(routes, 'h')).toBeNull();
  expect(diffRouteAfter(routes, 'd')).toBeNull();
  expect(diffRouteAfter(routes, 'missing')).toBeNull();
  expect(diffRouteAfter(routes.slice(0, 2), 'c')).toBeNull();
});
