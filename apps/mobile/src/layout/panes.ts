/**
 * How a page with a list and a detail lays them out: the list alone (the page
 * opens the detail itself), or the two side by side where there is room.
 */
export type PaneMode = 'single' | 'split';

export function paneMode({ width, minWidth }: { width: number; minWidth: number }): PaneMode {
  return width >= minWidth ? 'split' : 'single';
}
