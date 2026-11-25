const test = require('node:test');
const assert = require('node:assert/strict');

const { REPO_COLORS, repoColorMap, repoColor } = require('../public/repo-colors');
const {
  normalizeRepoSelection, selectOnlyRepo, toggleRepoInSelection, isMultiRepo,
  carryRepoSelection, mergeRepoLists, repoPagePlan,
} = require('../public/repo-selection');
const { ACTION_ICONS, actionIconSvg } = require('../public/action-icons');

const A = '/work/alpha';
const B = '/work/beta';
const C = '/work/gamma';

// --- repo-colors ---

test('the repository palette has ten colors, all different, none a lane color', () => {
  assert.equal(REPO_COLORS.length, 10);
  assert.equal(new Set(REPO_COLORS).size, REPO_COLORS.length);
  const lanes = ['#69c47c', '#df7180', '#e0aa63', '#8992dc', '#5fb3d9', '#c77dd1', '#9fd15a', '#e08fb0', '#6fa8e0', '#d1a5e0', '#7fd1b8', '#e0c05f'];
  for (const color of REPO_COLORS) {
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.ok(!lanes.includes(color), color);
  }
});

test('every repository gets its own color, up to the palette size', () => {
  const paths = Array.from({ length: REPO_COLORS.length }, (_, i) => `/work/repo-${i}`);
  const map = repoColorMap(paths);
  assert.equal(new Set(Object.values(map)).size, REPO_COLORS.length);
});

test('attaching a folder later keeps the colors the others had', () => {
  const before = repoColorMap([A, B]);
  const after = repoColorMap([A, B, C]);
  assert.equal(after[A], before[A]);
  assert.equal(after[B], before[B]);
  assert.notEqual(after[C], after[A]);
  assert.notEqual(after[C], after[B]);
});

test('the same paths give the same colors, and repoColor agrees with the map', () => {
  assert.deepEqual(repoColorMap([A, B, C]), repoColorMap([A, B, C]));
  assert.equal(repoColor([A, B, C], B), repoColorMap([A, B, C])[B]);
  assert.ok(REPO_COLORS.includes(repoColor([A], '/elsewhere')));
});

// --- repo-selection ---

test('a selection is made valid for the repositories there are', () => {
  assert.deepEqual(normalizeRepoSelection([], { primary: A, paths: [A] }), { primary: null, paths: [] });
  assert.deepEqual(normalizeRepoSelection([A, B, C], null), { primary: A, paths: [A] });
  assert.deepEqual(normalizeRepoSelection([A, B, C], { primary: C, paths: [C, A, '/gone'] }), { primary: C, paths: [A, C] });
  assert.deepEqual(normalizeRepoSelection([A, B], { primary: '/gone', paths: ['/gone'] }), { primary: A, paths: [A] });
  // A primary that is not among the paths is shown too.
  assert.deepEqual(normalizeRepoSelection([A, B, C], { primary: B, paths: [C] }), { primary: B, paths: [B, C] });
});

test('a click on a name shows that repository alone', () => {
  assert.deepEqual(selectOnlyRepo(B), { primary: B, paths: [B] });
});

test('the checkbox adds a repository in the project order, and takes one away', () => {
  let sel = selectOnlyRepo(C);
  sel = toggleRepoInSelection(sel, A, [A, B, C]);
  assert.deepEqual(sel, { primary: C, paths: [A, C] });
  assert.ok(isMultiRepo(sel));
  sel = toggleRepoInSelection(sel, A, [A, B, C]);
  assert.deepEqual(sel, { primary: C, paths: [C] });
  assert.ok(!isMultiRepo(sel));
});

test('the last repository shown stays, and taking the primary away moves it', () => {
  assert.deepEqual(toggleRepoInSelection({ primary: A, paths: [A] }, A, [A, B]), { primary: A, paths: [A] });
  assert.deepEqual(toggleRepoInSelection({ primary: A, paths: [A, B, C] }, A, [A, B, C]), { primary: B, paths: [B, C] });
});

test('a view handed a repository keeps its own selection only when it shows it', () => {
  assert.deepEqual(carryRepoSelection({ primary: A, paths: [A, B] }, B), { primary: B, paths: [A, B] });
  assert.deepEqual(carryRepoSelection({ primary: A, paths: [A, B] }, C), { primary: C, paths: [C] });
  assert.deepEqual(carryRepoSelection(null, C), { primary: C, paths: [C] });
});

test('lists merge by rank, each keeping its own order', () => {
  const { merged, held, hasMore } = mergeRepoLists([
    { key: 'a', items: [{ t: 9 }, { t: 5 }, { t: 1 }] },
    { key: 'b', items: [{ t: 8 }, { t: 7 }, { t: 2 }] },
  ], (item) => item.t);
  assert.deepEqual(merged.map((m) => `${m.key}${m.item.t}`), ['a9', 'b8', 'b7', 'a5', 'b2', 'a1']);
  assert.deepEqual(held, { a: 0, b: 0 });
  assert.equal(hasMore, false);
});

test('a list out of rank order is never reordered', () => {
  const { merged } = mergeRepoLists([
    { key: 'a', items: [{ t: 3 }, { t: 9 }] },
    { key: 'b', items: [{ t: 5 }] },
  ], (item) => item.t);
  assert.deepEqual(merged.map((m) => `${m.key}${m.item.t}`), ['b5', 'a3', 'a9']);
});

test('a tie goes to the earlier list, and Infinity ranks first', () => {
  const { merged } = mergeRepoLists([
    { key: 'a', items: [{ t: 4 }] },
    { key: 'b', items: [{ t: Infinity }, { t: 4 }] },
  ], (item) => item.t);
  assert.deepEqual(merged.map((m) => m.key), ['b', 'a', 'b']);
});

test('the merge stops where a list with more to load runs out', () => {
  const lists = [
    { key: 'a', items: [{ t: 10 }, { t: 6 }], hasMore: true },
    { key: 'b', items: [{ t: 9 }, { t: 8 }, { t: 3 }, { t: 2 }], hasMore: false },
  ];
  const { merged, held, hasMore } = mergeRepoLists(lists, (item) => item.t);
  assert.deepEqual(merged.map((m) => `${m.key}${m.item.t}`), ['a10', 'b9', 'b8', 'a6']);
  assert.deepEqual(held, { a: 0, b: 2 });
  assert.equal(hasMore, true);
  // Load more asks the list that stopped the merge, not the one holding rows back.
  assert.deepEqual(repoPagePlan(lists, held, 100), ['a']);
  assert.deepEqual(repoPagePlan(lists, held, 1), ['a']);
});

test('the page plan skips lists that have nothing more, or enough held back', () => {
  const lists = [{ key: 'a', hasMore: true }, { key: 'b', hasMore: true }, { key: 'c', hasMore: false }];
  assert.deepEqual(repoPagePlan(lists, { a: 0, b: 50, c: 0 }, 10), ['a']);
  assert.deepEqual(repoPagePlan(lists, { a: 0, b: 5, c: 0 }, 10), ['a', 'b']);
});

// --- action-icons ---

test('the four action icons are different drawings, as SVG strings', () => {
  const names = ['folderSearch', 'folderOpen', 'fileOutput', 'newWindow'];
  assert.deepEqual(Object.keys(ACTION_ICONS).sort(), [...names].sort());
  const svgs = names.map((name) => actionIconSvg(name, 12));
  assert.equal(new Set(svgs.map((svg) => svg.replace(/data-action-icon="[^"]*"/, ''))).size, names.length);
  for (const [i, svg] of svgs.entries()) {
    assert.match(svg, /^<svg width="12" height="12" viewBox="0 0 24 24"/);
    assert.ok(svg.includes(`data-action-icon="${names[i]}"`));
  }
  assert.equal(actionIconSvg('nope'), '');
});
