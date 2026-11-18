// What the terminal's key bar sends. The bar itself (which keys, in which
// place, what a swipe up does) is src/terminal/terminal-buttons.yml; this file
// turns its actions into the bytes a terminal expects.
//
// Keys with modifiers follow xterm (ESC[1;5D is Ctrl+Left, ESC[3;5~ is
// Ctrl+Delete). Keys xterm has no sequence for, and anything with Super, take
// the CSI u form of kitty's keyboard protocol: Shift+Enter is ESC[13;2u, the
// same as the desktop sends (public/terminal-manager.js), which Claude Code
// reads as a new line in the prompt.

/** One key of the bar, as terminal-buttons.yml has it. */
export type BarButton = { label: string; action: string; up?: { label: string; action: string } };

/** terminal-buttons.yml, as terminal-buttons.generated.ts holds it. */
export type TerminalButtons = {
  look: { height: number; keyText: number; swipeText: { size: number; opacity: number } };
  rows: BarButton[][];
  /** With Fn on: a key or a character → the key it becomes. */
  fn: Record<string, string>;
  /** The actions that repeat while their key is held down. */
  repeat: string[];
  /** The More keys sheet. */
  more: BarButton[];
};

/** The keys of the bar that change the next key instead of sending one. */
export type Modifier = 'ctrl' | 'alt' | 'fn' | 'super';
export type Modifiers = { shift?: boolean; ctrl?: boolean; alt?: boolean; super?: boolean; fn?: boolean };
export type Command = 'paste' | 'copy' | 'select-all' | 'more';

export const KEY_NAMES = [
  'Esc', 'Tab', 'Enter', 'Backspace', 'Delete', 'Insert',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PgUp', 'PgDn',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

export type Action =
  | { kind: 'modifier'; modifier: Modifier }
  | { kind: 'command'; command: Command }
  | { kind: 'key'; key: KeyName; mods: Modifiers }
  | { kind: 'text'; text: string; mods: Modifiers };

const MODIFIERS: Record<string, Modifier> = { Ctrl: 'ctrl', Alt: 'alt', Fn: 'fn', Super: 'super' };
const COMMANDS: readonly string[] = ['paste', 'copy', 'select-all', 'more'];
// Undo is Claude Code's, bash's and zsh's; Claude Code has no redo, so Redo
// is the usual Ctrl+Shift+Z for the programs that have one.
const NAMED: Record<string, string> = { Undo: 'Ctrl+_', Redo: 'Ctrl+Shift+Z' };
const PREFIX = /^(Shift|Ctrl|Alt|Super)\+(.+)$/;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** An action of terminal-buttons.yml; null when it names nothing. */
export function parseAction(action: string): Action | null {
  if (!action) return null;
  if (own(MODIFIERS, action)) return { kind: 'modifier', modifier: MODIFIERS[action] };
  if (COMMANDS.includes(action)) return { kind: 'command', command: action as Command };
  let rest = own(NAMED, action) ? NAMED[action] : action;
  const mods: Modifiers = {};
  for (let match = PREFIX.exec(rest); match; match = PREFIX.exec(rest)) {
    mods[match[1].toLowerCase() as 'shift' | 'ctrl' | 'alt' | 'super'] = true;
    rest = match[2];
  }
  if ((KEY_NAMES as readonly string[]).includes(rest)) return { kind: 'key', key: rest as KeyName, mods };
  // A word that names no key is a mistake in the file, not text to type.
  if (/^[A-Za-z][A-Za-z-]+$/.test(rest)) return null;
  return { kind: 'text', text: rest, mods };
}

/** True when any modifier is on. */
export const holdsAny = (mods: Modifiers) => !!(mods.shift || mods.ctrl || mods.alt || mods.super || mods.fn);
const anyModifier = (mods: Modifiers) => !!(mods.shift || mods.alt || mods.ctrl || mods.super);
const only = (mods: Modifiers, name: 'shift' | 'alt' | 'ctrl') =>
  !!mods[name] && (['shift', 'alt', 'ctrl', 'super'] as const).every((other) => other === name || !mods[other]);
// xterm's and kitty's modifier number: 1 plus Shift 1, Alt 2, Ctrl 4, Super 8.
const modifierParam = (mods: Modifiers) => 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0) + (mods.super ? 8 : 0);

const CURSOR: Partial<Record<KeyName, string>> = { Up: 'A', Down: 'B', Right: 'C', Left: 'D', Home: 'H', End: 'F' };
const SS3: Partial<Record<KeyName, string>> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' };
const TILDE: Partial<Record<KeyName, number>> = { Insert: 2, Delete: 3, PgUp: 5, PgDn: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24 };
const PLAIN: Partial<Record<KeyName, string>> = { Esc: '\x1b', Tab: '\t', Enter: '\r', Backspace: '\x7f' };
// Ctrl with a character that has a control code of its own.
const CONTROL: Record<string, string> = { '@': '\x00', ' ': '\x00', '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', '_': '\x1f', '?': '\x7f' };

function encodeKey(key: KeyName, mods: Modifiers): string {
  const m = modifierParam(mods);
  const cursor = CURSOR[key];
  if (cursor) return m === 1 ? `\x1b[${cursor}` : `\x1b[1;${m}${cursor}`;
  const ss3 = SS3[key];
  if (ss3) return m === 1 ? `\x1bO${ss3}` : `\x1b[1;${m}${ss3}`;
  const tilde = TILDE[key];
  if (tilde) return m === 1 ? `\x1b[${tilde}~` : `\x1b[${tilde};${m}~`;
  const plain = PLAIN[key] as string;
  if (m === 1) return plain;
  if (only(mods, 'alt')) return `\x1b${plain}`;
  if (key === 'Tab' && only(mods, 'shift')) return '\x1b[Z';
  if (key === 'Backspace' && only(mods, 'ctrl')) return '\x08';
  return `\x1b[${plain.charCodeAt(0)};${m}u`;
}

function controlCode(char: string): string | undefined {
  const lower = char.toLowerCase();
  if (lower.length === 1 && lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 96);
  return CONTROL[char];
}

function encodeChar(char: string, mods: Modifiers): string {
  if (!anyModifier(mods)) return char;
  const upper = char.length === 1 && char >= 'A' && char <= 'Z';
  if (mods.super || (mods.ctrl && mods.shift) || (mods.ctrl && controlCode(char) === undefined)) {
    // kitty: the unshifted key, with Shift among the modifiers.
    const code = (upper ? char.toLowerCase() : char).codePointAt(0) as number;
    return `\x1b[${code};${modifierParam({ ...mods, shift: mods.shift || upper })}u`;
  }
  let out = mods.ctrl ? (controlCode(char) as string) : char;
  if (mods.shift && !mods.ctrl) out = out.toUpperCase();
  return mods.alt ? `\x1b${out}` : out;
}

/**
 * The bytes for a key or text action, with the modifiers turned on in the
 * bar. With Fn on, `fn` may make it another key first.
 */
export function encode(action: Action, held: Modifiers, fn: Record<string, string>): string {
  if (action.kind !== 'key' && action.kind !== 'text') return '';
  let target: Action = action;
  let mods: Modifiers = { ...held, ...action.mods };
  if (mods.fn) {
    const name = action.kind === 'key' ? action.key : action.text;
    const to = fn[name] ?? fn[name.toUpperCase()];
    const mapped = to ? parseAction(to) : null;
    if (mapped && (mapped.kind === 'key' || mapped.kind === 'text')) {
      target = mapped;
      mods = { ...mods, ...mapped.mods };
    }
    mods = { ...mods, fn: false };
  }
  if (target.kind === 'key') return encodeKey(target.key, mods);
  if (target.kind !== 'text') return '';
  return Array.from(target.text, (char) => encodeChar(char, mods)).join('');
}

/** The one character typed into `before` to make `after`, or null when the change is anything else. */
export function insertedText(before: string, after: string): string | null {
  if (after.length <= before.length) return null;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  const tail = before.length - start;
  if (after.slice(after.length - tail) !== before.slice(start)) return null;
  const inserted = after.slice(start, after.length - tail);
  return Array.from(inserted).length === 1 ? inserted : null;
}

const SPOKEN_KEYS: Partial<Record<KeyName, string>> = {
  Esc: 'Escape', Up: 'Up arrow', Down: 'Down arrow', Left: 'Left arrow', Right: 'Right arrow', PgUp: 'Page up', PgDn: 'Page down',
};
const SPOKEN_TEXT: Record<string, string> = {
  '/': 'Slash', '//': 'Two slashes', '~': 'Tilde', $: 'Dollar', '|': 'Pipe', '`': 'Backtick', '\\': 'Backslash', '-': 'Dash', '@': 'At sign', _: 'Underscore',
};
const SPOKEN_MODIFIERS: Record<Modifier, string> = { ctrl: 'Control', alt: 'Alt', fn: 'Function', super: 'Command' };
const SPOKEN_COMMANDS: Record<Command, string> = { paste: 'Paste', copy: 'Copy', 'select-all': 'Select all', more: 'More keys' };

/** What a screen reader says for an action. */
export function spoken(action: string): string {
  if (own(NAMED, action)) return action;
  const parsed = parseAction(action);
  if (!parsed) return action;
  if (parsed.kind === 'modifier') return SPOKEN_MODIFIERS[parsed.modifier];
  if (parsed.kind === 'command') return SPOKEN_COMMANDS[parsed.command];
  const mods = (['shift', 'ctrl', 'alt', 'super'] as const).filter((m) => parsed.mods[m]).map((m) => (m === 'ctrl' || m === 'super' ? SPOKEN_MODIFIERS[m] : m === 'alt' ? 'Alt' : 'Shift'));
  const base = parsed.kind === 'key' ? SPOKEN_KEYS[parsed.key] ?? parsed.key : SPOKEN_TEXT[parsed.text] ?? parsed.text;
  return [...mods, base].join(' ');
}
