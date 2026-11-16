// How the phone shows a session's terminal before the user changes anything.

/**
 * "Fit to phone" starts off. The computer has one PTY per session: fitting
 * it to the phone also shrinks the terminal on the computer (and Claude's
 * status line cuts itself to the narrow width), so the phone opens the
 * terminal at the computer's size and scrolls sideways instead.
 */
export const FIT_BY_DEFAULT = false;

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 18;
export const DEFAULT_FONT_SIZE = 12;

/** The line shown while the terminal is fitted to the phone. */
export function fitNote(computerName: string | undefined): string {
  return `Also resizes the terminal on ${computerName || 'the computer'}`;
}

/** "100×36": a terminal's columns by rows, or nothing before the size is known. */
export function sizeLabel(cols: number, rows: number): string {
  return cols && rows ? `${cols}×${rows}` : '';
}
