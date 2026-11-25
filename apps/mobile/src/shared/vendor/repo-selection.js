// Copied from packages/shared/repo-selection.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// repo-selection.js — which repositories of a project the Git tab shows.
//
// History, Pull Requests and Worktrees show one repository or several at
// once. The selection is { primary, paths }: the paths shown, in the
// project's order, and the primary one, the repository last picked by its
// name. The views that work on one repository only (Changes, Actions, and
// the toolbar actions of History) use the primary.
//
// With several repositories shown, their lists (commits, pull requests) are
// merged into one: mergeRepoLists keeps each repository's own order and
// stops where a repository that has more to load runs out, so nothing older
// than what is loaded everywhere is shown out of place; repoPagePlan says
// which repositories to ask for more.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const unique = (list) => [...new Set((list || []).filter((p) => typeof p === 'string' && p))];

  /**
   * The selection made valid for the repositories there are: unknown paths
   * dropped, the project's order kept, a primary among the paths, and at
   * least one path while there is a repository.
   */
  function normalizeRepoSelection(available, selection) {
    const repos = unique(available);
    if (!repos.length) return { primary: null, paths: [] };
    const wanted = new Set(unique(selection && selection.paths));
    let primary = selection && selection.primary;
    if (primary && repos.includes(primary)) wanted.add(primary);
    let paths = repos.filter((p) => wanted.has(p));
    if (!paths.length) paths = [repos[0]];
    if (!primary || !paths.includes(primary)) primary = paths[0];
    return { primary, paths };
  }

  /** Only this repository, as a click on its name does. */
  function selectOnlyRepo(path) {
    return { primary: path, paths: [path] };
  }

  /**
   * This repository added to the ones shown, or taken away: the last one
   * shown stays, and taking the primary away makes the first one left primary.
   */
  function toggleRepoInSelection(selection, path, available) {
    const paths = unique(selection && selection.paths);
    let primary = selection && selection.primary;
    if (paths.includes(path)) {
      if (paths.length <= 1) return { primary: primary || path, paths };
      const rest = paths.filter((p) => p !== path);
      if (primary === path || !rest.includes(primary)) primary = rest[0];
      return { primary, paths: rest };
    }
    const added = [...paths, path];
    const order = unique(available);
    const sorted = order.length ? [...order.filter((p) => added.includes(p)), ...added.filter((p) => !order.includes(p))] : added;
    return { primary: primary || path, paths: sorted };
  }

  function isMultiRepo(selection) {
    return !!(selection && Array.isArray(selection.paths) && selection.paths.length > 1);
  }

  /**
   * The selection a view takes when another view hands it its repository:
   * the target's own selection when it already shows that repository, with
   * it as primary, otherwise that repository alone.
   */
  function carryRepoSelection(target, primary) {
    if (!primary) return target ? { primary: target.primary || null, paths: unique(target.paths) } : { primary: null, paths: [] };
    const paths = unique(target && target.paths);
    if (paths.includes(primary)) return { primary, paths };
    return { primary, paths: [primary] };
  }

  /**
   * One list out of several, each already in its own order (newest first):
   * at every step the head with the highest rank goes next (the earlier list
   * on a tie), and no list is ever reordered. A list that has more to load
   * and is used up stops the merge, as what it has not loaded yet could come
   * before anything left in the others.
   *
   * lists: [{ key, items, hasMore }]; rankOf(item, key) → number.
   * Returns { merged: [{ key, item }], held: { key: items not shown }, hasMore }.
   */
  function mergeRepoLists(lists, rankOf) {
    const entries = (lists || []).map((list) => ({ key: list.key, items: list.items || [], hasMore: !!list.hasMore, at: 0 }));
    const merged = [];
    const rank = (entry) => {
      const value = Number(rankOf(entry.items[entry.at], entry.key));
      return Number.isFinite(value) || value === Infinity ? value : -Infinity;
    };
    for (;;) {
      let best = null;
      let bestRank = -Infinity;
      let frontier = false;
      for (const entry of entries) {
        if (entry.at >= entry.items.length) {
          if (entry.hasMore) { frontier = true; break; }
          continue;
        }
        const value = rank(entry);
        if (!best || value > bestRank) { best = entry; bestRank = value; }
      }
      if (frontier || !best) break;
      merged.push({ key: best.key, item: best.items[best.at] });
      best.at++;
    }
    const held = {};
    for (const entry of entries) held[entry.key] = entry.items.length - entry.at;
    const hasMore = entries.some((entry) => entry.hasMore || entry.at < entry.items.length);
    return { merged, held, hasMore };
  }

  /**
   * The lists to load more of, for a "Load more": those that have more and
   * hold fewer than `want` items not shown yet. The list that stopped the
   * merge holds none, so every Load more moves the merge on.
   */
  function repoPagePlan(lists, held, want) {
    const need = Math.max(1, Number(want) || 1);
    return (lists || []).filter((list) => list.hasMore && ((held && held[list.key]) || 0) < need).map((list) => list.key);
  }

  const api = { normalizeRepoSelection, selectOnlyRepo, toggleRepoInSelection, isMultiRepo, carryRepoSelection, mergeRepoLists, repoPagePlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RepoSelection = api;
})(typeof window !== 'undefined' ? window : globalThis);
