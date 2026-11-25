// The editor's find bar (components/files/FindBar.tsx): its options and what
// it says about the matches, as the desktop's find bar says it.

import type { FindOptions, FindResult } from '@/editor/bridge';

export const FIND_DEFAULTS: FindOptions = { matchCase: false, wholeWord: false, isRegex: false, preserveCase: false };

/** Past this many characters a search waits for the typing to pause longer. */
const LARGE_TEXT = 1024 * 1024;

/** How long the bar waits after a keystroke before it searches. */
export function findDelay(textLength: number): number {
  return textLength > LARGE_TEXT ? 400 : 150;
}

/** "3 of 12", "No results", "20000+": what the bar shows next to the field. */
export function findCountText(result: FindResult | null, query: string): string {
  if (!query) return '';
  if (!result) return '';
  if (result.error && result.error !== 'read-only') return result.error.replace(/^Invalid regular expression: /, '');
  if (result.replaced !== undefined) return `Replaced ${result.replaced}`;
  if (!result.count) return 'No results';
  const total = result.limited ? `${result.count}+` : String(result.count);
  return result.current ? `${result.current} of ${total}` : `? of ${total}`;
}
