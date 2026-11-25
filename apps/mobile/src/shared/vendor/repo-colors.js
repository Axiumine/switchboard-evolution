// Copied from packages/shared/repo-colors.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// repo-colors.js — the color of each repository of a project in the Git tab.
// With several repositories shown together (History, Pull Requests,
// Worktrees), a repository's name is painted in its color, so a row is told
// apart at a glance even when the name is cut short.
//
// The colors are picked from the attached folders' paths, in the project's
// order: each path prefers a slot from its own hash and takes the next free
// one when it is taken. The same project gives the same colors on the
// desktop and on the phone, and attaching a folder later leaves the others'
// colors as they were.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  // Saturated hues that read as text on the dark theme, none of them one of
  // the graph's lane colors (git-graph-service.js, DEFAULT_GRAPH_COLOURS).
  const REPO_COLORS = [
    '#4fb3ff', // blue
    '#ff8a5c', // orange
    '#b78cff', // violet
    '#3fd0a4', // jade
    '#ff6f91', // rose
    '#e3b341', // amber
    '#6ad6f0', // cyan
    '#e07be0', // magenta
    '#a8d64f', // lime
    '#f0a3a3', // salmon
  ];

  /** The same slot for the same path, every time (FNV-1a). */
  function preferredSlot(path) {
    let hash = 0x811c9dc5;
    const text = String(path || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % REPO_COLORS.length;
  }

  /**
   * { path: color } for the given paths, in their order: all different up to
   * the palette's size, then the colors come round again.
   */
  function repoColorMap(paths) {
    const map = {};
    const taken = new Set();
    for (const path of paths || []) {
      if (!path || Object.prototype.hasOwnProperty.call(map, path)) continue;
      const start = preferredSlot(path);
      let slot = start;
      if (taken.size < REPO_COLORS.length) {
        while (taken.has(slot)) slot = (slot + 1) % REPO_COLORS.length;
      }
      taken.add(slot);
      map[path] = REPO_COLORS[slot];
    }
    return map;
  }

  /** One path's color among the project's paths (its own hash when it is not one of them). */
  function repoColor(paths, path) {
    const map = repoColorMap(paths);
    return map[path] || REPO_COLORS[preferredSlot(path)];
  }

  const api = { REPO_COLORS, repoColorMap, repoColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RepoColors = api;
})(typeof window !== 'undefined' ? window : globalThis);
