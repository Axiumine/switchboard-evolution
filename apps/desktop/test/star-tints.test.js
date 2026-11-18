const test = require('node:test');
const assert = require('node:assert/strict');

const { STAR_TINTS, pickStarTint, starTintColor } = require('../public/star-tints');

test('the palette has ten colors, all different', () => {
  assert.equal(STAR_TINTS.length, 10);
  assert.equal(new Set(STAR_TINTS).size, STAR_TINTS.length);
  for (const color of STAR_TINTS) assert.match(color, /^#[0-9a-f]{6}$/);
});

test('a pin takes a color no other pinned session has', () => {
  const used = [0, 1, 2, 3, 4, 5, 6, 8, 9];
  // Whatever the draw, the one free color.
  assert.equal(pickStarTint(used, () => 0), 7);
  assert.equal(pickStarTint(used, () => 0.999), 7);
});

test('the first pins are all different', () => {
  const used = [];
  for (let i = 0; i < STAR_TINTS.length; i++) used.push(pickStarTint(used));
  assert.equal(new Set(used).size, STAR_TINTS.length);
});

test('once every color is taken, a pin takes one of the least used', () => {
  const used = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7];
  assert.equal(pickStarTint(used, () => 0), 8);
  assert.equal(pickStarTint(used, () => 0.99), 9);
});

test('the draw is random among the free colors', () => {
  assert.equal(pickStarTint([], () => 0), 0);
  assert.equal(pickStarTint([], () => 0.55), 5);
  assert.equal(pickStarTint([], () => 0.999), 9);
});

test('tints outside the palette do not count', () => {
  assert.equal(pickStarTint([null, undefined, -1, 10, 2.5, 'x', 0], () => 0), 1);
});

test('a session shows its own tint', () => {
  assert.equal(starTintColor(3, 'any'), STAR_TINTS[3]);
  assert.equal(starTintColor(0, 'any'), STAR_TINTS[0]);
});

test('a session without one (an older Switchboard) gets the same color every time from its id', () => {
  const color = starTintColor(null, '6f1c2a90-0000-4000-8000-000000000000');
  assert.ok(STAR_TINTS.includes(color));
  assert.equal(starTintColor(undefined, '6f1c2a90-0000-4000-8000-000000000000'), color);
  assert.equal(starTintColor(42, '6f1c2a90-0000-4000-8000-000000000000'), color);
  // Different ids spread over the palette.
  const spread = new Set(Array.from({ length: 50 }, (_, i) => starTintColor(null, `session-${i}`)));
  assert.ok(spread.size >= 6);
});
