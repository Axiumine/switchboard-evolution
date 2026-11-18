// star-tints.js — the color of a pinned session's star. Each pin gets its own
// tint, so several pinned sessions tell apart at a glance: db.js picks one
// when a session is pinned (pickStarTint, among the colors the other pinned
// sessions use least) and stores its index; every view paints the star with
// starTintColor. A session with no stored tint, as an older Switchboard sends
// them to the phone, gets one from its id.
//
// Shared with the phone app (scripts/sync-shared.mjs there) and required by
// db.js in main: no DOM, no Node.
(function (root) {
  // Soft colors that read on the dark theme, the first being the gold the star had before.
  const STAR_TINTS = [
    '#f5be3c', // gold
    '#f59a4a', // orange
    '#f27d72', // coral
    '#ec7fb8', // pink
    '#b98cff', // violet
    '#8a9cff', // periwinkle
    '#5cbff0', // sky
    '#4fd1b8', // teal
    '#8fd46a', // green
    '#d8d55a', // lime
  ];

  const isTint = (tint) => Number.isInteger(tint) && tint >= 0 && tint < STAR_TINTS.length;

  /** A tint for a new pin: one the fewest pinned sessions have, drawn at random among those. */
  function pickStarTint(usedTints, random = Math.random) {
    const counts = STAR_TINTS.map(() => 0);
    for (const tint of usedTints || []) if (isTint(tint)) counts[tint]++;
    const least = Math.min(...counts);
    const candidates = counts.flatMap((count, tint) => (count === least ? [tint] : []));
    const draw = Math.floor(Number(random()) * candidates.length);
    return candidates[Math.min(Math.max(draw, 0), candidates.length - 1)] || 0;
  }

  /** The same index for the same id, every time (FNV-1a). */
  function tintFromId(id) {
    let hash = 0x811c9dc5;
    const text = String(id || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % STAR_TINTS.length;
  }

  /** The star's color: the session's tint, or one from its id when it has none. */
  function starTintColor(tint, sessionId) {
    return STAR_TINTS[isTint(tint) ? tint : tintFromId(sessionId)];
  }

  const api = { STAR_TINTS, pickStarTint, starTintColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StarTints = api;
})(typeof window !== 'undefined' ? window : globalThis);
