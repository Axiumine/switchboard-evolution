import { describe, expect, test } from '@jest/globals';

import { isBackgroundReload, SHOW_AFTER_MS, SHOW_AT_LEAST_MS, syncChange } from '../useSyncing';

/**
 * Plays useSyncing's effect over time: `busy` lists the [from, to) intervals of
 * reloads, and the result the [from, to) intervals of the line on screen.
 */
function play(busy: [number, number][], until = 3000): [number, number][] {
  const busyAt = (t: number) => busy.some(([from, to]) => t >= from && t < to);
  let shown = false;
  let shownAt = 0;
  let timer: { at: number; to: boolean } | null = null;
  let last: { busy: boolean; shown: boolean } | null = null;
  const seen: [number, number][] = [];
  for (let t = 0; t <= until; t += 10) {
    // Until nothing more happens at this instant: a timer of 0 ms fires now.
    for (;;) {
      if (timer && t >= timer.at) {
        if (timer.to) { shownAt = t; seen.push([t, until]); } else seen[seen.length - 1][1] = t;
        shown = timer.to;
        timer = null;
      }
      const now = { busy: busyAt(t), shown };
      if (last && now.busy === last.busy && now.shown === last.shown) break;
      const change = syncChange(now.busy, now.shown, shownAt, t);
      timer = change ? { at: t + change.in, to: change.to } : null;
      last = now;
    }
  }
  return seen;
}

describe('syncChange', () => {
  test('a quick reload shows nothing', () => {
    expect(play([[100, 100 + SHOW_AFTER_MS - 50]])).toEqual([]);
  });

  test('a slow reload shows the line after the delay, at least for the minimum', () => {
    expect(play([[100, 500]])).toEqual([[100 + SHOW_AFTER_MS, 100 + SHOW_AFTER_MS + SHOW_AT_LEAST_MS]]);
  });

  test('a long reload keeps the line until it ends', () => {
    expect(play([[0, 2000]])).toEqual([[SHOW_AFTER_MS, 2000]]);
  });

  test('a reload starting while the line holds keeps it on, without a blink', () => {
    expect(play([[0, 400], [700, 1500]])).toEqual([[SHOW_AFTER_MS, 1500]]);
  });

  test('nothing changes while idle or while shown and still busy', () => {
    expect(syncChange(false, false, 0, 1000)).toBeNull();
    expect(syncChange(true, true, 0, 1000)).toBeNull();
  });
});

describe('isBackgroundReload', () => {
  const query = (data: unknown, meta?: Record<string, unknown>) => ({ state: { data }, meta }) as any;

  test('counts reloads of data already on screen', () => {
    expect(isBackgroundReload(query([]))).toBe(true);
  });

  test('leaves out first loads and quiet (polling) queries', () => {
    expect(isBackgroundReload(query(undefined))).toBe(false);
    expect(isBackgroundReload(query({}, { quiet: true }))).toBe(false);
  });
});
