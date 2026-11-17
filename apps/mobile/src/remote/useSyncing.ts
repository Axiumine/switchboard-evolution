import { useIsFetching, type Query } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

/** A reload shorter than this shows nothing: the line would only flash. */
export const SHOW_AFTER_MS = 300;
/** Once shown, the line stays at least this long, so it never blinks. */
export const SHOW_AT_LEAST_MS = 600;

/**
 * A reload of something already on screen. First loads have their own
 * spinner, and queries marked `meta: { quiet: true }` (the ones that poll)
 * would keep the line on for good.
 */
export function isBackgroundReload(query: Query): boolean {
  return query.state.data !== undefined && !query.meta?.quiet;
}

/**
 * The next change of the line, and how long to wait for it, given whether a
 * reload is going on and when the line was shown; null when nothing changes.
 */
export function syncChange(busy: boolean, shown: boolean, shownAt: number, now: number): { to: boolean; in: number } | null {
  if (busy) return shown ? null : { to: true, in: SHOW_AFTER_MS };
  if (!shown) return null;
  return { to: false, in: Math.max(0, SHOW_AT_LEAST_MS - (now - shownAt)) };
}

/** Whether the app is reloading something in the background, worth a quiet sign (SyncBar). */
export function useSyncing(): boolean {
  const busy = useIsFetching({ predicate: isBackgroundReload }) > 0;
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    const change = syncChange(busy, shown, shownAt.current, Date.now());
    if (!change) return;
    // A change of `busy` before the timer fires cancels it and plans again.
    const timer = setTimeout(() => {
      if (change.to) shownAt.current = Date.now();
      setShown(change.to);
    }, change.in);
    return () => clearTimeout(timer);
  }, [busy, shown]);

  return shown;
}
