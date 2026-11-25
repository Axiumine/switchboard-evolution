// pinned-order.js — the order you give your starred projects, and each
// project's pinned sessions, by dragging them. db.js keeps a rank for each
// (projects.starRank, session_meta.pinRank): 0 is the first. One starred or
// pinned since the last drag has no rank yet and comes after the ranked ones,
// in the order it had before (newest first); so until the first drag nothing
// moves. Unstarring or unpinning drops the rank, so starring or pinning again
// puts it at the end.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const isRank = (rank) => typeof rank === 'number' && Number.isFinite(rank);

  /**
   * A comparator: the ranked items first, lowest rank first, then the others.
   * `fallback` orders the ones without a rank and breaks ties.
   */
  function compareByRank(rankOf, fallback) {
    return (a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      const ha = isRank(ra);
      const hb = isRank(rb);
      if (ha !== hb) return ha ? -1 : 1;
      if (ha && ra !== rb) return ra - rb;
      return fallback(a, b);
    };
  }

  /**
   * `ids` with `id` moved to `toIndex`, counted in the list as it is now
   * (clamped to its ends). The same array when `id` is not in it or does not move.
   */
  function moveId(ids, id, toIndex) {
    const from = ids.indexOf(id);
    if (from < 0) return ids;
    const index = Number.isFinite(Number(toIndex)) ? Math.trunc(Number(toIndex)) : from;
    const to = Math.max(0, Math.min(ids.length - 1, index));
    if (to === from) return ids;
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    return next;
  }

  /**
   * Where a row dragged onto another one goes: before it, or after it when
   * dropped on its lower half. The index is the one it takes once moved
   * (moveId); null when nothing moves.
   */
  function dropIndex(ids, fromId, targetId, after) {
    const from = ids.indexOf(fromId);
    const target = ids.indexOf(targetId);
    if (from < 0 || target < 0 || from === target) return null;
    let to = after ? target + 1 : target;
    if (from < to) to -= 1;
    return to === from ? null : to;
  }

  const api = { compareByRank, moveId, dropIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinnedOrder = api;
})(typeof window !== 'undefined' ? window : globalThis);
