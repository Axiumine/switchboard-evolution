const { test } = require('node:test');
const assert = require('node:assert/strict');

const { compareByRank, moveId, dropIndex } = require('../public/pinned-order');

const newestFirst = (a, b) => b.time - a.time;
const ids = list => list.map(item => item.id);

test('the ranked ones come first in their order, the others after them, newest first', () => {
  const items = [
    { id: 'old', time: 1, rank: null },
    { id: 'second', time: 2, rank: 1 },
    { id: 'new', time: 9, rank: undefined },
    { id: 'first', time: 3, rank: 0 },
  ];
  assert.deepEqual(ids([...items].sort(compareByRank(i => i.rank, newestFirst))), ['first', 'second', 'new', 'old']);
});

test('with no rank at all the order is the one it was before', () => {
  const items = [{ id: 'a', time: 1 }, { id: 'b', time: 3 }, { id: 'c', time: 2 }];
  assert.deepEqual(ids([...items].sort(compareByRank(i => i.rank, newestFirst))), ['b', 'c', 'a']);
});

test('the same rank twice falls back to time', () => {
  const items = [{ id: 'a', time: 1, rank: 0 }, { id: 'b', time: 2, rank: 0 }];
  assert.deepEqual(ids([...items].sort(compareByRank(i => i.rank, newestFirst))), ['b', 'a']);
});

test('moveId moves one id, clamped to the ends, and leaves the list alone otherwise', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveId(list, 'a', 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveId(list, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveId(list, 'b', 99), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveId(list, 'c', -5), ['c', 'a', 'b', 'd']);
  assert.equal(moveId(list, 'b', 1), list);
  assert.equal(moveId(list, 'x', 0), list);
  assert.deepEqual(list, ['a', 'b', 'c', 'd'], 'never changed in place');
});

test('a row dropped on the top or bottom half of another goes before or after it', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(dropIndex(list, 'a', 'c', false), 1);
  assert.equal(dropIndex(list, 'a', 'c', true), 2);
  assert.equal(dropIndex(list, 'd', 'b', false), 1);
  assert.equal(dropIndex(list, 'd', 'b', true), 2);
  assert.equal(dropIndex(list, 'b', 'c', false), null, 'already there');
  assert.equal(dropIndex(list, 'b', 'b', true), null);
  assert.equal(dropIndex(list, 'x', 'b', true), null);
  const index = dropIndex(list, 'a', 'd', true);
  assert.deepEqual(moveId(list, 'a', index), ['b', 'c', 'd', 'a']);
});
