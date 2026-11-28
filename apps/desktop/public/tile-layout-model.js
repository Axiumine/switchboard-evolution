// The split layout model: a binary tree of panes, tiled the way Hyprland and
// bspwm do it (dwindle): each split halves the touched pane along its longer
// side. Pure functions with no DOM; the view (tile-view.js) is built on top of
// them, and createTileStore, at the end, keeps the layouts in the storage it is
// given.
//
// A tree is `{ split: 'row' | 'col', ratio, a, b }` with leaves `{ session: id }`
// and, for the Session Overview, one `{ cards: true }` leaf that stands for the
// cards area. `row` puts `a` left of `b`, `col` puts `a` above `b`; `ratio` is
// the share of `a`. A rect is `{ x, y, width, height }`; a path is an array of
// 'a' / 'b' steps from the root. Every operation returns a new tree and never
// changes the one it is given.

const TILE_RATIO_LIMITS = Object.freeze([0.15, 0.85]);
const TILE_CARDS = Object.freeze({ cards: true });
const TILE_MAX_DEPTH = 64;
const TILE_EPSILON = 1e-6;

function tileIsSplit(node) {
  return !!node && typeof node === 'object' && typeof node.split === 'string';
}

function tileIsCards(node) {
  return !!node && typeof node === 'object' && node.cards === true;
}

function tileClampRatio(ratio) {
  return Math.min(TILE_RATIO_LIMITS[1], Math.max(TILE_RATIO_LIMITS[0], ratio));
}

// A deep copy, so a new tree never shares a node with the one it came from.
function tileCopy(node) {
  if (tileIsSplit(node)) return { split: node.split, ratio: node.ratio, a: tileCopy(node.a), b: tileCopy(node.b) };
  if (tileIsCards(node)) return { cards: true };
  return { session: node.session };
}

function tileHasSession(node, id) {
  if (!node) return false;
  if (tileIsSplit(node)) return tileHasSession(node.a, id) || tileHasSession(node.b, id);
  return node.session === id;
}

function tileHasCards(node) {
  if (!node) return false;
  if (tileIsSplit(node)) return tileHasCards(node.a) || tileHasCards(node.b);
  return tileIsCards(node);
}

// How a pane splits. A forced direction wins; otherwise the longer side is
// halved (row cuts the width, col the height), and equal sides, or no rect,
// take the opposite of the parent's split (row at the root).
function tileSplitKind(rect, direction, parentSplit) {
  if (direction === 'right') return 'row';
  if (direction === 'down') return 'col';
  if (rect && rect.width > rect.height) return 'row';
  if (rect && rect.height > rect.width) return 'col';
  if (parentSplit === 'row') return 'col';
  return 'row';
}

// Replaces the first leaf for which `match` is true with `make(kind-of-parent)`;
// the result is null when no leaf matches.
function tileReplaceLeaf(node, match, make, parentSplit) {
  if (tileIsSplit(node)) {
    const a = tileReplaceLeaf(node.a, match, make, node.split);
    if (a) return { split: node.split, ratio: node.ratio, a, b: tileCopy(node.b) };
    const b = tileReplaceLeaf(node.b, match, make, node.split);
    if (b) return { split: node.split, ratio: node.ratio, a: tileCopy(node.a), b };
    return null;
  }
  return match(node) ? make(parentSplit) : null;
}

// Splits the pane `targetId`: the new session goes right of it (row) or below
// it (col). `rect` is the pane's own rect. A target that is not in the tree, or
// a new id that already is, changes nothing.
function splitTile(tree, targetId, newId, { rect, direction = 'auto' } = {}) {
  if (!tree || tileHasSession(tree, newId) || !tileHasSession(tree, targetId)) return tree && tileCopy(tree);
  return tileReplaceLeaf(
    tree,
    node => node.session === targetId,
    parentSplit => ({
      split: tileSplitKind(rect, direction, parentSplit),
      ratio: 0.5,
      a: { session: targetId },
      b: { session: newId },
    }),
    null
  );
}

// Docks a session beside the cards: the cards leaf is halved, the session on
// the `a` side and the cards on `b`. `tree` is null, the lone cards leaf or a
// tree that holds the cards leaf; `rect` is the cards leaf's own rect.
function dockBesideCards(tree, id, rect) {
  const dock = parentSplit => ({
    split: tileSplitKind(rect, 'auto', parentSplit),
    ratio: 0.5,
    a: { session: id },
    b: { cards: true },
  });
  if (!tree) return dock(null);
  if (tileHasSession(tree, id) || !tileHasCards(tree)) return tileCopy(tree);
  return tileReplaceLeaf(tree, tileIsCards, dock, null);
}

// Takes a session out: its sibling takes the parent's place. The last session
// of a tree leaves null, or the lone cards leaf when the cards are beside it.
function removeTile(tree, id) {
  if (!tree) return null;
  if (!tileIsSplit(tree)) return tree.session === id ? null : tileCopy(tree);
  const a = removeTile(tree.a, id);
  const b = removeTile(tree.b, id);
  if (!a) return b;
  if (!b) return a;
  return { split: tree.split, ratio: tree.ratio, a, b };
}

// Gives a pane another id (a session that was re-keyed keeps its place).
function replaceTileId(tree, oldId, newId) {
  if (!tree) return null;
  if (tileIsSplit(tree)) return { split: tree.split, ratio: tree.ratio, a: replaceTileId(tree.a, oldId, newId), b: replaceTileId(tree.b, oldId, newId) };
  if (tileIsCards(tree)) return { cards: true };
  return { session: tree.session === oldId ? newId : tree.session };
}

// A session that changed id keeps its place; when the tree holds the new id
// already, the old one leaves (an id is never in a tree twice).
function rekeyTileTree(tree, oldId, newId) {
  return tileHasSession(tree, newId) ? removeTile(tree, oldId) : replaceTileId(tree, oldId, newId);
}

// Puts `subtree` in the place of the pane `id`, which it holds: a session's own
// window closed, and its panes come back where its placeholder was. The other
// sessions of `subtree` leave the tree first (an id is never in a tree twice).
// A pane that is not in the tree, or a subtree without it, changes nothing.
function graftTile(tree, id, subtree) {
  if (!tree) return null;
  if (!subtree || !tileHasSession(tree, id) || !tileHasSession(subtree, id)) return tileCopy(tree);
  const incoming = new Set(tileIds(subtree));
  const kept = pruneTiles(tree, sid => sid === id || !incoming.has(sid));
  return tileReplaceLeaf(kept, node => node.session === id, () => tileCopy(subtree), null);
}

// Sets the ratio of the split at `path`, held within TILE_RATIO_LIMITS. A path
// that does not end on a split, or a ratio that is not a number, changes nothing.
function setTileRatio(tree, path, ratio) {
  if (!tree) return null;
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) return tileCopy(tree);
  const walk = (node, index) => {
    if (!tileIsSplit(node)) return null;
    if (index === path.length) return { split: node.split, ratio: tileClampRatio(ratio), a: tileCopy(node.a), b: tileCopy(node.b) };
    const step = path[index];
    if (step !== 'a' && step !== 'b') return null;
    const child = walk(node[step], index + 1);
    if (!child) return null;
    return step === 'a'
      ? { split: node.split, ratio: node.ratio, a: child, b: tileCopy(node.b) }
      : { split: node.split, ratio: node.ratio, a: tileCopy(node.a), b: child };
  };
  return walk(tree, 0) || tileCopy(tree);
}

// The rect of every leaf inside `rect`, keyed by session id or 'cards', in
// reading order (a before b).
function tileRects(tree, rect) {
  const rects = new Map();
  const walk = (node, r) => {
    if (!node) return;
    if (!tileIsSplit(node)) {
      rects.set(tileIsCards(node) ? 'cards' : node.session, { x: r.x, y: r.y, width: r.width, height: r.height });
      return;
    }
    if (node.split === 'row') {
      const width = r.width * node.ratio;
      walk(node.a, { x: r.x, y: r.y, width, height: r.height });
      walk(node.b, { x: r.x + width, y: r.y, width: r.width - width, height: r.height });
    } else {
      const height = r.height * node.ratio;
      walk(node.a, { x: r.x, y: r.y, width: r.width, height });
      walk(node.b, { x: r.x, y: r.y + height, width: r.width, height: r.height - height });
    }
  };
  walk(tree, rect);
  return rects;
}

// The session pane next to `fromId` in a direction ('left', 'right', 'up',
// 'down'): of the panes that touch its edge on that side, the one that shares
// the most of it (the first in reading order on a tie). The cards area is not a
// pane to move to. Null when there is none.
function tileNeighbor(tree, rect, fromId, dir) {
  const rects = tileRects(tree, rect);
  const from = rects.get(fromId);
  if (!from || fromId === 'cards') return null;
  const horizontal = dir === 'left' || dir === 'right';
  if (!horizontal && dir !== 'up' && dir !== 'down') return null;
  const edge = { left: from.x, right: from.x + from.width, up: from.y, down: from.y + from.height }[dir];
  let best = null;
  let bestOverlap = TILE_EPSILON;
  for (const [id, r] of rects) {
    if (id === fromId || id === 'cards') continue;
    const touching = {
      left: r.x + r.width,
      right: r.x,
      up: r.y + r.height,
      down: r.y,
    }[dir];
    if (Math.abs(touching - edge) > TILE_EPSILON) continue;
    const overlap = horizontal
      ? Math.min(from.y + from.height, r.y + r.height) - Math.max(from.y, r.y)
      : Math.min(from.x + from.width, r.x + r.width) - Math.max(from.x, r.x);
    if (overlap > bestOverlap + TILE_EPSILON) {
      best = id;
      bestOverlap = overlap;
    }
  }
  return best;
}

// The session ids in reading order (the cards leaf has none).
function tileIds(tree) {
  if (!tree) return [];
  if (tileIsSplit(tree)) return [...tileIds(tree.a), ...tileIds(tree.b)];
  return tileIsCards(tree) ? [] : [tree.session];
}

// Drops the session leaves `keep(id)` rejects; the cards leaf always stays.
// A split that loses a side becomes the other side. A tree with nothing left
// is null; one that shrinks to the cards is the lone cards leaf.
function pruneTiles(tree, keep) {
  if (!tree) return null;
  if (!tileIsSplit(tree)) return tileIsCards(tree) || keep(tree.session) ? tileCopy(tree) : null;
  const a = pruneTiles(tree.a, keep);
  const b = pruneTiles(tree.b, keep);
  if (!a) return b;
  if (!b) return a;
  return { split: tree.split, ratio: tree.ratio, a, b };
}

// Reads a saved tree: a copy of it when the shape is right (known split kinds,
// ratios within the limits, session leaves with a non-empty id, no id twice, at
// most one cards leaf), null otherwise.
function parseTileTree(value) {
  const seen = new Set();
  let cards = 0;
  const read = (node, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > TILE_MAX_DEPTH) return null;
    if ('split' in node) {
      if (node.split !== 'row' && node.split !== 'col') return null;
      const { ratio } = node;
      if (typeof ratio !== 'number' || !(ratio >= TILE_RATIO_LIMITS[0] && ratio <= TILE_RATIO_LIMITS[1])) return null;
      const a = read(node.a, depth + 1);
      const b = a && read(node.b, depth + 1);
      return a && b ? { split: node.split, ratio, a, b } : null;
    }
    if ('cards' in node) {
      if (node.cards !== true || ++cards > 1) return null;
      return { cards: true };
    }
    if (typeof node.session !== 'string' || !node.session || seen.has(node.session)) return null;
    seen.add(node.session);
    return { session: node.session };
  };
  return read(value, 0);
}

// Reads the Session Overview's dock (overview.prefs.v1 `dock`): a copy of it
// when it is a valid tree that holds the cards leaf, without the sessions
// `keep(id)` rejects when it is given; null (no dock) for anything else, and
// for a dock left with the cards alone.
function parseTileDock(value, keep) {
  const tree = parseTileTree(value);
  if (!tree || !tileHasCards(tree)) return null;
  const kept = keep ? pruneTiles(tree, keep) : tree;
  return tileIds(kept).length > 0 ? kept : null;
}

// ---- The saved layouts ----

// The Session tab's layouts (and, later, those of a session's own window):
// { v, layouts: { id: { tree, scope, updatedAt } } }, with `scope` 'main' or
// 'window:<id>'. The overview's dock is not kept here.
const TILE_LAYOUTS_KEY = 'tileLayouts.v1';

// A layout holds two sessions at least: a set, a re-key or a forget that leaves
// it with fewer drops it. A session is in one layout per scope at most: a set
// takes its sessions out of the scope's other layouts. Every call reads the
// storage again (another window may have written it), and a storage that throws
// or holds something unreadable counts as empty.
function createTileStore(storage) {
  const isId = id => typeof id === 'string' && id !== '';
  const read = () => {
    let saved;
    try { saved = JSON.parse(storage.getItem(TILE_LAYOUTS_KEY) || 'null'); } catch { return {}; }
    const layouts = saved && typeof saved === 'object' && saved.layouts;
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
    const valid = {};
    for (const [id, layout] of Object.entries(layouts)) {
      const tree = parseTileTree(layout?.tree);
      if (!tree || tileIds(tree).length < 2 || !isId(layout.scope)) continue;
      valid[id] = { tree, scope: layout.scope, updatedAt: Number(layout.updatedAt) || 0 };
    }
    return valid;
  };
  const write = layouts => {
    try { storage.setItem(TILE_LAYOUTS_KEY, JSON.stringify({ v: 1, layouts })); } catch {}
  };
  // A layout given a new tree: kept with two sessions or more, dropped below.
  const put = (layouts, id, tree, scope) => {
    const valid = parseTileTree(tree);
    if (valid && tileIds(valid).length >= 2) layouts[id] = { tree: valid, scope, updatedAt: Date.now() };
    else delete layouts[id];
  };
  const entry = (id, layout) => ({ id, tree: tileCopy(layout.tree), scope: layout.scope, updatedAt: layout.updatedAt });
  // Applies `change(tree)` to every layout that holds `id`, and saves when one changed.
  const each = (id, change) => {
    const layouts = read();
    const touched = Object.entries(layouts).filter(([, layout]) => tileHasSession(layout.tree, id));
    for (const [layoutId, layout] of touched) put(layouts, layoutId, change(layout.tree), layout.scope);
    if (touched.length) write(layouts);
  };

  return {
    /** The layout of `scope` that holds session `id`: { id, tree, scope, updatedAt }, or null. */
    layoutOf(id, scope = 'main') {
      if (!isId(id)) return null;
      const found = Object.entries(read()).find(([, layout]) => layout.scope === scope && tileHasSession(layout.tree, id));
      return found ? entry(...found) : null;
    },
    /** Saves a layout's tree; its sessions leave the scope's other layouts. */
    set(layoutId, tree, scope = 'main') {
      if (!isId(layoutId) || !isId(scope)) return;
      const layouts = read();
      const valid = parseTileTree(tree);
      const ids = new Set(valid ? tileIds(valid) : []);
      for (const [id, layout] of Object.entries(layouts)) {
        if (id === layoutId || layout.scope !== scope || !tileIds(layout.tree).some(sid => ids.has(sid))) continue;
        put(layouts, id, pruneTiles(layout.tree, sid => !ids.has(sid)), scope);
      }
      put(layouts, layoutId, valid, scope);
      write(layouts);
    },
    drop(layoutId) {
      const layouts = read();
      if (!Object.prototype.hasOwnProperty.call(layouts, layoutId)) return;
      delete layouts[layoutId];
      write(layouts);
    },
    /** A session that changed id keeps its places; a layout that holds both ids keeps the new one only. */
    rekey(oldId, newId) {
      if (!isId(oldId) || !isId(newId) || oldId === newId) return;
      each(oldId, tree => rekeyTileTree(tree, oldId, newId));
    },
    /** Takes a session out of every layout. */
    forget(id) {
      if (isId(id)) each(id, tree => removeTile(tree, id));
    },
    /** Every saved layout, as layoutOf gives one. */
    all() {
      return Object.entries(read()).map(([id, layout]) => entry(id, layout));
    },
  };
}
