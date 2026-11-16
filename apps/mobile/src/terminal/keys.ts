// Keys a phone keyboard lacks or hides, as the bytes a terminal expects.
// Shift+Enter is the same CSI u sequence the desktop sends (public/terminal-manager.js),
// which Claude Code reads as a new line in the prompt.

export type TerminalKey = { label: string; data: string; hint: string };

/** The key row above the field, in groups. */
export const KEY_GROUPS: TerminalKey[][] = [
  [
    { label: 'Esc', data: '\x1b', hint: 'Escape' },
    { label: 'Tab', data: '\t', hint: 'Tab' },
    { label: '⇧Tab', data: '\x1b[Z', hint: 'Shift Tab' },
    { label: '^C', data: '\x03', hint: 'Control C' },
  ],
  [
    { label: '←', data: '\x1b[D', hint: 'Left' },
    { label: '↓', data: '\x1b[B', hint: 'Down' },
    { label: '↑', data: '\x1b[A', hint: 'Up' },
    { label: '→', data: '\x1b[C', hint: 'Right' },
  ],
  [
    { label: '⏎', data: '\r', hint: 'Enter' },
    { label: '⇧⏎', data: '\x1b[13;2u', hint: 'Shift Enter' },
  ],
];

/** The More keys sheet: four to a row. */
export const MORE_KEYS: TerminalKey[] = [
  { label: 'Home', data: '\x1b[H', hint: 'Home' },
  { label: 'End', data: '\x1b[F', hint: 'End' },
  { label: 'PgUp', data: '\x1b[5~', hint: 'Page up' },
  { label: 'PgDn', data: '\x1b[6~', hint: 'Page down' },
  { label: '^D', data: '\x04', hint: 'Control D' },
  { label: '^L', data: '\x0c', hint: 'Control L' },
  { label: '^R', data: '\x12', hint: 'Control R' },
  { label: '^Z', data: '\x1a', hint: 'Control Z' },
  { label: '|', data: '|', hint: 'Pipe' },
  { label: '~', data: '~', hint: 'Tilde' },
  { label: '/', data: '/', hint: 'Slash' },
  { label: '-', data: '-', hint: 'Dash' },
  { label: '\\', data: '\\', hint: 'Backslash' },
  { label: '`', data: '`', hint: 'Backtick' },
  { label: '$', data: '$', hint: 'Dollar' },
  { label: 'F1', data: '\x1bOP', hint: 'F1' },
];
