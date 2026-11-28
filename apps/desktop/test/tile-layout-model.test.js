// The split layout model: a binary tree of panes (dwindle tiling, as in Hyprland
// and bspwm). public/tile-layout-model.js is pure: no DOM, no storage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
// Objects made inside the vm have its prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

// Constants declared with const are not properties of a vm context: read them with runInContext.
const lib = vm.createContext({});
vm.runInContext(read('tile-layout-model.js'), lib);
const fn = name => vm.runInContext(name, lib);
const constant = name => plain(vm.runInContext(name, lib));

const splitTile = (...args) => fn('splitTile')(...args);
const dockBesideCards = (...args) => fn('dockBesideCards')(...args);
const removeTile = (...args) => fn('removeTile')(...args);
const replaceTileId = (...args) => fn('replaceTileId')(...args);
const setTileRatio = (...args) => fn('setTileRatio')(...args);
const tileRects = (...args) => fn('tileRects')(...args);
const tileNeighbor = (...args) => fn('tileNeighbor')(...args);
const tileIds = (...args) => fn('tileIds')(...args);
const pruneTiles = (...args) => fn('pruneTiles')(...args);
const parseTileTree = (...args) => fn('parseTileTree')(...args);
const parseTileDock = (...args) => fn('parseTileDock')(...args);
const rekeyTileTree = (...args) => fn('rekeyTileTree')(...args);

const leaf = id => ({ session: id });
const CARDS = { cards: true };
const split = (kind, a, b, ratio = 0.5) => ({ split: kind, ratio, a, b });
const WIDE = { x: 0, y: 0, width: 1600, height: 900 };
const rectsOf = (tree, rect = WIDE) => Object.fromEntries(tileRects(tree, rect));
const depthOf = (tree, marker) => {
  if (tree.split) {
    const depths = [depthOf(tree.a, marker), depthOf(tree.b, marker)].filter(d => d >= 0);
    return depths.length ? 1 + Math.max(...depths) : -1;
  }
  return marker(tree) ? 0 : -1;
};

test('the constants', () => {
  assert.deepEqual(constant('TILE_RATIO_LIMITS'), [0.15, 0.85]);
  assert.deepEqual(constant('TILE_CARDS'), { cards: true });
});

test('a wide pane splits side by side and the touched half then stacks', () => {
  const first = splitTile(leaf('A'), 'A', 'B', { rect: WIDE });
  assert.equal(first.split, 'row');
  assert.equal(first.ratio, 0.5);
  assert.deepEqual(plain(first.a), leaf('A'));
  assert.deepEqual(plain(first.b), leaf('B'));
  const rectB = rectsOf(first).B;
  assert.deepEqual(plain(rectB), { x: 800, y: 0, width: 800, height: 900 });
  const second = splitTile(first, 'B', 'C', { rect: rectB });
  assert.deepEqual(plain(second), split('row', leaf('A'), split('col', leaf('B'), leaf('C'))));
  assert.deepEqual(plain(tileIds(second)), ['A', 'B', 'C']);
});

test('a tall pane splits one above the other', () => {
  const tree = splitTile(leaf('A'), 'A', 'B', { rect: { x: 0, y: 0, width: 500, height: 900 } });
  assert.equal(tree.split, 'col');
});

test('right and down force the direction', () => {
  const tall = { x: 0, y: 0, width: 500, height: 900 };
  assert.equal(splitTile(leaf('A'), 'A', 'B', { rect: tall, direction: 'right' }).split, 'row');
  assert.equal(splitTile(leaf('A'), 'A', 'B', { rect: WIDE, direction: 'down' }).split, 'col');
});

test('equal sides alternate from the parent', () => {
  const square = { x: 0, y: 0, width: 600, height: 600 };
  // At the root there is no parent: row.
  assert.equal(splitTile(leaf('A'), 'A', 'B', { rect: square }).split, 'row');
  // Without a rect the sides count as equal too.
  assert.equal(splitTile(leaf('A'), 'A', 'B').split, 'row');
  // Under a row the opposite is col, under a col it is row.
  const underRow = splitTile(split('row', leaf('A'), leaf('B')), 'B', 'C', { rect: square });
  assert.deepEqual(plain(underRow.b), split('col', leaf('B'), leaf('C')));
  const underCol = splitTile(split('col', leaf('A'), leaf('B')), 'A', 'C', { rect: square });
  assert.deepEqual(plain(underCol.a), split('row', leaf('A'), leaf('C')));
  const noRect = splitTile(split('row', leaf('A'), leaf('B')), 'A', 'C');
  assert.equal(noRect.a.split, 'col');
});

test('removing a pane gives its space to the sibling and the last one leaves null', () => {
  const tree = split('row', leaf('A'), split('col', leaf('B'), leaf('C')));
  assert.deepEqual(plain(removeTile(tree, 'B')), split('row', leaf('A'), leaf('C')));
  assert.deepEqual(plain(removeTile(tree, 'A')), split('col', leaf('B'), leaf('C')));
  assert.deepEqual(plain(removeTile(split('row', leaf('A'), leaf('B')), 'A')), leaf('B'));
  assert.equal(removeTile(leaf('A'), 'A'), null);
  // Unknown ids change nothing.
  assert.deepEqual(plain(removeTile(tree, 'Z')), plain(tree));
  // The last session beside the cards leaves the lone cards leaf.
  assert.deepEqual(plain(removeTile(split('row', leaf('A'), CARDS), 'A')), CARDS);
});

test('docking beside the cards halves the cards area each time', () => {
  const first = dockBesideCards(null, 'A', WIDE);
  assert.deepEqual(plain(first), split('row', leaf('A'), CARDS));
  const cardsRect = rectsOf(first).cards;
  assert.deepEqual(plain(cardsRect), { x: 800, y: 0, width: 800, height: 900 });
  const second = dockBesideCards(first, 'B', cardsRect);
  assert.deepEqual(plain(tileIds(second)), ['A', 'B']);
  assert.deepEqual(plain(second), split('row', leaf('A'), split('col', leaf('B'), CARDS)));
  const isCards = l => l.cards === true;
  assert.equal(depthOf(second, isCards), 2);
  assert.equal(depthOf(second, l => l.session === 'A'), 1);
  assert.equal(depthOf(second, l => l.session === 'B'), 2);
  // The cards area keeps halving: a third session takes the top of what is left.
  const third = dockBesideCards(second, 'C', rectsOf(second).cards);
  assert.deepEqual(plain(tileIds(third)), ['A', 'B', 'C']);
  assert.equal(depthOf(third, isCards), 3);
  assert.equal(rectsOf(third).cards.width * rectsOf(third).cards.height, 800 * 450 / 2);
});

test('docking accepts a lone cards leaf and a missing rect', () => {
  assert.deepEqual(plain(dockBesideCards(CARDS, 'A', WIDE)), split('row', leaf('A'), CARDS));
  assert.deepEqual(plain(dockBesideCards(null, 'A')), split('row', leaf('A'), CARDS));
  assert.deepEqual(plain(dockBesideCards(null, 'A', { x: 0, y: 0, width: 400, height: 900 })), split('col', leaf('A'), CARDS));
});

test('ratios stay between 0.15 and 0.85', () => {
  const tree = split('row', leaf('A'), split('col', leaf('B'), leaf('C')));
  assert.equal(setTileRatio(tree, [], 0.3).ratio, 0.3);
  assert.equal(setTileRatio(tree, [], 0.01).ratio, 0.15);
  assert.equal(setTileRatio(tree, [], 5).ratio, 0.85);
  assert.equal(setTileRatio(tree, [], -1).ratio, 0.15);
  const nested = setTileRatio(tree, ['b'], 0.7);
  assert.equal(nested.ratio, 0.5);
  assert.equal(nested.b.ratio, 0.7);
  assert.equal(setTileRatio(tree, ['b'], 0.99).b.ratio, 0.85);
  // A path that does not reach a split changes nothing.
  assert.deepEqual(plain(setTileRatio(tree, ['a'], 0.3)), plain(tree));
  assert.deepEqual(plain(setTileRatio(tree, ['b', 'a', 'a'], 0.3)), plain(tree));
  assert.deepEqual(plain(setTileRatio(tree, [], NaN)), plain(tree));
  // The rects follow the ratio.
  assert.equal(rectsOf(setTileRatio(tree, [], 0.25)).A.width, 400);
});

test('rects fill the area and carry the offset', () => {
  const tree = split('row', leaf('A'), split('col', leaf('B'), CARDS, 0.25), 0.4);
  const rects = tileRects(tree, { x: 10, y: 20, width: 1000, height: 800 });
  assert.deepEqual([...rects.keys()], ['A', 'B', 'cards']);
  assert.deepEqual(plain(rects.get('A')), { x: 10, y: 20, width: 400, height: 800 });
  assert.deepEqual(plain(rects.get('B')), { x: 410, y: 20, width: 600, height: 200 });
  assert.deepEqual(plain(rects.get('cards')), { x: 410, y: 220, width: 600, height: 600 });
  assert.equal(tileRects(null, WIDE).size, 0);
});

test('a saved tree that is not valid reads as null', () => {
  const good = split('row', leaf('A'), split('col', leaf('B'), CARDS, 0.3), 0.6);
  assert.deepEqual(plain(parseTileTree(good)), plain(good));
  assert.deepEqual(plain(parseTileTree(leaf('A'))), leaf('A'));
  // A lone cards leaf is valid.
  assert.deepEqual(plain(parseTileTree(CARDS)), CARDS);
  assert.equal(parseTileTree(split('row', leaf('A'), leaf('B'), 2)), null);
  assert.equal(parseTileTree(split('row', leaf('A'), leaf('B'), 0.1)), null);
  assert.equal(parseTileTree(split('row', leaf('A'), leaf('B'), 'x')), null);
  assert.equal(parseTileTree(split('row', {}, leaf('B'))), null);
  assert.equal(parseTileTree(split('row', leaf('A'), leaf(''))), null);
  assert.equal(parseTileTree(split('row', leaf('A'), leaf('A'))), null);
  assert.equal(parseTileTree(split('row', leaf('A'), split('col', leaf('B'), leaf('A')))), null);
  assert.equal(parseTileTree(split('diagonal', leaf('A'), leaf('B'))), null);
  assert.equal(parseTileTree(split('row', leaf('A'), null)), null);
  assert.equal(parseTileTree(split('row', CARDS, split('col', leaf('A'), CARDS))), null);
  assert.equal(parseTileTree({ cards: false }), null);
  assert.equal(parseTileTree({ session: 7 }), null);
  assert.equal(parseTileTree('{"session":"A"}'), null);
  assert.equal(parseTileTree('row'), null);
  assert.equal(parseTileTree(null), null);
  assert.equal(parseTileTree(undefined), null);
  assert.equal(parseTileTree(42), null);
  assert.equal(parseTileTree([]), null);
  assert.equal(parseTileTree({}), null);
  // The result is a copy, not the saved object.
  assert.notEqual(parseTileTree(good), good);
});

test('replace follows a re-key and prune drops unknown ids', () => {
  const tree = split('row', leaf('A'), split('col', leaf('B'), CARDS));
  const replaced = replaceTileId(tree, 'B', 'B2');
  assert.deepEqual(plain(replaced), split('row', leaf('A'), split('col', leaf('B2'), CARDS)));
  assert.deepEqual(plain(replaceTileId(tree, 'Z', 'Z2')), plain(tree));

  assert.deepEqual(plain(pruneTiles(tree, id => id !== 'B')), split('row', leaf('A'), CARDS));
  assert.deepEqual(plain(pruneTiles(tree, id => id === 'B')), split('col', leaf('B'), CARDS));
  assert.deepEqual(plain(pruneTiles(tree, () => true)), plain(tree));
  // The cards leaf is always kept: the tree can shrink to it, never below.
  assert.deepEqual(plain(pruneTiles(tree, () => false)), CARDS);
  // A tree with no cards and no session left is null.
  assert.equal(pruneTiles(split('row', leaf('A'), leaf('B')), () => false), null);
  assert.equal(pruneTiles(null, () => true), null);
  const known = new Set(['A']);
  assert.deepEqual(plain(pruneTiles(split('row', leaf('A'), leaf('B')), id => known.has(id))), leaf('A'));
});

test('the operations return new trees and never touch the input', () => {
  const tree = split('row', leaf('A'), split('col', leaf('B'), CARDS));
  const snapshot = plain(tree);
  const frozen = value => {
    Object.freeze(value);
    if (value && typeof value === 'object') Object.values(value).forEach(frozen);
    return value;
  };
  frozen(tree);
  splitTile(tree, 'A', 'N', { rect: WIDE });
  dockBesideCards(tree, 'N', WIDE);
  removeTile(tree, 'B');
  replaceTileId(tree, 'A', 'A2');
  setTileRatio(tree, ['b'], 0.7);
  pruneTiles(tree, () => false);
  parseTileTree(tree);
  assert.deepEqual(plain(tree), snapshot);
  assert.notEqual(splitTile(tree, 'A', 'N'), tree);
  assert.notEqual(setTileRatio(tree, [], 0.3), tree);
});

test('the neighbour in each direction', () => {
  // A | (B over (C | D)), on 1600x900:
  // A 0..800; B 800..1600 x 0..450; C 800..1200 x 450..900; D 1200..1600 x 450..900.
  const tree = split('row', leaf('A'), split('col', leaf('B'), split('row', leaf('C'), leaf('D'))));
  const near = (id, dir) => tileNeighbor(tree, WIDE, id, dir);
  assert.equal(near('A', 'right'), 'B'); // B and C overlap A's right edge: B first in order on a tie
  assert.equal(near('A', 'left'), null);
  assert.equal(near('A', 'up'), null);
  assert.equal(near('A', 'down'), null);
  assert.equal(near('B', 'left'), 'A');
  assert.equal(near('B', 'down'), 'C');
  assert.equal(near('B', 'up'), null);
  assert.equal(near('B', 'right'), null);
  assert.equal(near('C', 'up'), 'B');
  assert.equal(near('C', 'right'), 'D');
  assert.equal(near('C', 'left'), 'A');
  assert.equal(near('D', 'left'), 'C');
  assert.equal(near('D', 'up'), 'B');
  assert.equal(near('D', 'down'), null);
  assert.equal(near('Z', 'left'), null);
});

test('the neighbour is the adjacent pane with the most overlap', () => {
  // A on the left, B top right (a third of the height), C bottom right (the rest).
  const tree = split('row', leaf('A'), split('col', leaf('B'), leaf('C'), 1 / 3));
  assert.equal(tileNeighbor(tree, WIDE, 'A', 'right'), 'C');
  assert.equal(tileNeighbor(tree, WIDE, 'B', 'left'), 'A');
  assert.equal(tileNeighbor(tree, WIDE, 'C', 'left'), 'A');
  // Panes that only touch at a corner are not neighbours.
  const corner = split('row', split('col', leaf('A'), leaf('B')), split('col', leaf('C'), leaf('D')));
  assert.equal(tileNeighbor(corner, WIDE, 'A', 'right'), 'C');
  assert.equal(tileNeighbor(corner, WIDE, 'A', 'down'), 'B');
  assert.equal(tileNeighbor(corner, WIDE, 'A', 'up'), null);
});

test('the neighbour is never the cards area', () => {
  const tree = split('row', leaf('A'), split('col', CARDS, leaf('B'), 0.7));
  assert.equal(tileNeighbor(tree, WIDE, 'A', 'right'), 'B');
  assert.equal(tileNeighbor(split('row', leaf('A'), CARDS), WIDE, 'A', 'right'), null);
});

test('ids come in reading order and skip the cards', () => {
  assert.deepEqual(plain(tileIds(null)), []);
  assert.deepEqual(plain(tileIds(CARDS)), []);
  assert.deepEqual(plain(tileIds(leaf('A'))), ['A']);
  assert.deepEqual(plain(tileIds(split('row', split('col', leaf('A'), CARDS), leaf('B')))), ['A', 'B']);
});

test('a split that targets an unknown or repeated id changes nothing', () => {
  const tree = split('row', leaf('A'), leaf('B'));
  assert.deepEqual(plain(splitTile(tree, 'Z', 'C', { rect: WIDE })), plain(tree));
  assert.deepEqual(plain(splitTile(tree, 'A', 'B', { rect: WIDE })), plain(tree));
  assert.deepEqual(plain(dockBesideCards(tree, 'C', WIDE)), plain(tree));
  assert.deepEqual(plain(dockBesideCards(split('row', leaf('A'), CARDS), 'A', WIDE)), split('row', leaf('A'), CARDS));
});

test('the overview dock reads as a tree with the cards and one session at least', () => {
  const dock = split('row', leaf('A'), split('col', leaf('B'), CARDS));
  assert.deepEqual(plain(parseTileDock(dock)), dock);
  assert.notEqual(parseTileDock(dock), dock);
  // Nothing saved, something else, or a tree the overview cannot draw: no dock.
  const none = [null, undefined, 'row', { side: 'right' }, CARDS, split('row', leaf('A'), leaf('B')), split('row', leaf('A'), CARDS, 0.95)];
  for (const value of none) assert.equal(parseTileDock(value), null, JSON.stringify(value));
  // Sessions that are not open any more leave; a dock left with the cards alone is none.
  assert.deepEqual(plain(parseTileDock(dock, id => id === 'B')), split('col', leaf('B'), CARDS));
  assert.equal(parseTileDock(dock, () => false), null);
  assert.deepEqual(plain(parseTileDock(dock, () => true)), dock);
});

test('a re-keyed session keeps its place, or leaves when the new id is there already', () => {
  const tree = split('row', leaf('A'), split('col', leaf('B'), CARDS));
  assert.deepEqual(plain(rekeyTileTree(tree, 'A', 'A2')), split('row', leaf('A2'), split('col', leaf('B'), CARDS)));
  assert.deepEqual(plain(rekeyTileTree(tree, 'A', 'B')), split('col', leaf('B'), CARDS));
  assert.deepEqual(plain(rekeyTileTree(tree, 'Z', 'Z2')), plain(tree));
  assert.equal(rekeyTileTree(null, 'A', 'A2'), null);
});

// ---- The store of the Session tab's layouts (tileLayouts.v1) ----

/** A localStorage stand-in; `fail` makes every read and write throw. */
function memoryStorage(initial = {}, { fail = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => { if (fail) throw new Error('storage off'); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { if (fail) throw new Error('storage off'); data.set(key, String(value)); },
    removeItem: key => { if (fail) throw new Error('storage off'); data.delete(key); },
  };
}
const createTileStore = storage => fn('createTileStore')(storage);
const idsOf = layout => layout && plain(tileIds(layout.tree));

test('a session belongs to one layout per scope and follows a re-key', () => {
  assert.equal(constant('TILE_LAYOUTS_KEY'), 'tileLayouts.v1');
  const storage = memoryStorage();
  const store = createTileStore(storage);
  store.set('L1', split('row', leaf('A'), leaf('B')), 'main');
  assert.equal(store.layoutOf('A', 'main').id, 'L1');
  // The scope is 'main' unless said.
  assert.deepEqual(idsOf(store.layoutOf('B')), ['A', 'B']);
  assert.equal(store.layoutOf('A', 'window:w1'), null);
  // No id is in no layout, not even the cards' (whose leaf has no session).
  assert.equal(store.layoutOf(undefined), null);
  assert.equal(store.layoutOf(''), null);

  // A second main layout that takes B takes it out of L1, which is left with
  // one session and goes: a layout holds two sessions at least.
  store.set('L2', split('col', leaf('B'), leaf('C')), 'main');
  assert.equal(store.layoutOf('B', 'main').id, 'L2');
  assert.equal(store.layoutOf('A', 'main'), null);
  // A layout in another scope keeps its own copy of B.
  store.set('W1', split('row', leaf('B'), leaf('D')), 'window:w1');
  assert.equal(store.layoutOf('B', 'main').id, 'L2');
  assert.equal(store.layoutOf('B', 'window:w1').id, 'W1');

  // A re-key (Codex's real id, a fork) replaces the id in every layout, and is saved.
  store.rekey('B', 'B2');
  const again = createTileStore(storage);
  assert.deepEqual(plain(again.layoutOf('B2', 'main').tree), split('col', leaf('B2'), leaf('C')));
  assert.equal(again.layoutOf('B', 'main'), null);
  assert.deepEqual(idsOf(again.layoutOf('B2', 'window:w1')), ['B2', 'D']);
  // A layout that already holds the new id just loses the old one.
  again.set('L3', split('row', leaf('E'), split('col', leaf('F'), leaf('G'))), 'main');
  again.rekey('F', 'G');
  assert.deepEqual(plain(again.layoutOf('G', 'main').tree), split('row', leaf('E'), leaf('G')));

  // forget takes a session out everywhere; a layout left with one session goes.
  again.forget('C');
  assert.equal(again.layoutOf('B2', 'main'), null);
  assert.deepEqual(plain(again.all().map(l => l.id).sort()), ['L3', 'W1']);
  const w1 = again.all().find(l => l.id === 'W1');
  assert.equal(w1.scope, 'window:w1');
  assert.equal(typeof w1.updatedAt, 'number');
  // set with less than two sessions drops the layout.
  again.set('L3', leaf('E'), 'main');
  again.drop('W1');
  assert.deepEqual(plain(again.all()), []);

  // The saved shape: { v, layouts: { id: { tree, scope, updatedAt } } }.
  again.set('L4', split('row', leaf('A'), leaf('B')), 'main');
  const saved = JSON.parse(storage.getItem('tileLayouts.v1'));
  assert.equal(saved.v, 1);
  assert.deepEqual(Object.keys(saved.layouts), ['L4']);
  assert.deepEqual(saved.layouts.L4.tree, split('row', leaf('A'), leaf('B')));
  assert.equal(saved.layouts.L4.scope, 'main');
});

test('unreadable, invalid or unavailable saved layouts read as none', () => {
  const bad = ratio => JSON.stringify({ v: 1, layouts: { X: { tree: split('row', leaf('A'), leaf('B'), ratio), scope: 'main', updatedAt: 1 } } });
  for (const raw of ['{nope', 'null', '[]', '{"v":1,"layouts":[]}', bad(0.95), JSON.stringify({ v: 1, layouts: { X: { tree: leaf('A'), scope: 'main' } } })]) {
    const store = createTileStore(memoryStorage({ 'tileLayouts.v1': raw }));
    assert.deepEqual(plain(store.all()), [], raw);
    assert.equal(store.layoutOf('A'), null, raw);
  }
  // A good layout next to a bad one is kept.
  const mixed = JSON.stringify({ v: 1, layouts: {
    X: { tree: split('row', leaf('A'), leaf('B'), 0.95), scope: 'main', updatedAt: 1 },
    Y: { tree: split('row', leaf('C'), leaf('D'), 0.6), scope: 'main', updatedAt: 2 },
    Z: { tree: split('row', leaf('E'), leaf('F')), scope: '', updatedAt: 3 },
  } });
  assert.deepEqual(plain(createTileStore(memoryStorage({ 'tileLayouts.v1': mixed })).all().map(l => l.id)), ['Y']);
  // Storage that throws: nothing is kept and nothing throws.
  const off = createTileStore(memoryStorage({}, { fail: true }));
  off.set('L', split('row', leaf('A'), leaf('B')), 'main');
  off.rekey('A', 'A2');
  off.forget('B');
  off.drop('L');
  assert.equal(off.layoutOf('A'), null);
  assert.deepEqual(plain(off.all()), []);
});
