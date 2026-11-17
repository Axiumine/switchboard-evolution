import { useState } from 'react';

// Rows that stay where they were first shown. The computer sends projects
// newest first, so starting a session moves its project to the top: on a
// screen that is closing that move crashes the app on Android. react-native-
// screens holds a leaving screen's views for its exit animation, and Fabric
// cannot insert a held view anywhere else ("addViewAt: failed to insert view
// … The specified child already has a parent"; fixed upstream in
// react/react-native#59776, not in 0.88). Rows that are only added or removed
// are safe.

/** `items` in the order of `shown`; items not shown yet after them, in their own order; items gone left out. */
export function keepOrder<T extends { key: string }>(items: readonly T[], shown: readonly string[]): T[] {
  const place = new Map(shown.map((key, index) => [key, index]));
  const known = items.filter((item) => place.has(item.key)).sort((a, b) => place.get(a.key)! - place.get(b.key)!);
  const added = items.filter((item) => !place.has(item.key));
  return [...known, ...added];
}

/**
 * `items` keeping the order they were first shown in, for as long as the
 * screen is open. Until `ready` (the first reads back) they come as they are,
 * and no order is kept yet.
 */
export function useStableOrder<T extends { key: string }>(items: readonly T[], ready = true): readonly T[] {
  const [shown, setShown] = useState<readonly string[]>([]);
  if (!ready) return items;
  const ordered = keepOrder(items, shown);
  const keys = ordered.map((item) => item.key);
  // Set while rendering, so the first frame already has the order kept.
  if (keys.length !== shown.length || keys.some((key, index) => key !== shown[index])) setShown(keys);
  return ordered;
}
