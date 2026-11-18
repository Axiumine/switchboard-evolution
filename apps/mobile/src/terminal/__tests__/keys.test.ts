import { describe, expect, it } from '@jest/globals';

import { encode, holdsAny, insertedText, parseAction, spoken, type Action, type Modifiers } from '../keys';
import { TERMINAL_BUTTONS } from '../terminal-buttons.generated';

const { rows, more, fn, repeat } = TERMINAL_BUTTONS;
const send = (action: string, held: Modifiers = {}) => encode(parseAction(action) as Action, held, fn);
const type = (char: string, held: Modifiers) => encode({ kind: 'text', text: char, mods: {} }, held, fn);

describe('the bar of terminal-buttons.yml', () => {
  it('has two rows of eight keys, every key with a swipe up', () => {
    expect(rows.map((row) => row.map((key) => key.label))).toEqual([
      ['ESC', 'FN', 'PASTE', '/', '~', '↑', '⌫', 'DEL'],
      ['⇥', 'CTRL', 'ALT', '⌘', '←', '↓', '→', '↵'],
    ]);
    expect(rows.map((row) => row.map((key) => key.up?.label))).toEqual([
      ['UNDO', '^A', 'COPY', '$', '|', 'PGUP', 'INS', '⋯'],
      ['⇧⇥', '^C', '`', 'REDO', 'HOME', 'PGDN', 'END', '⇧↵'],
    ]);
    expect(more.map((key) => key.label)).toEqual(['^D', '^L', '^R', '^Z', '\\', '//']);
  });

  it('names a real action everywhere', () => {
    const actions = [
      ...rows.flat().flatMap((key) => [key.action, key.up?.action ?? 'Esc']),
      ...more.map((key) => key.action),
      ...Object.values(fn),
      ...repeat,
    ];
    for (const action of actions) expect([action, parseAction(action)]).not.toEqual([action, null]);
  });

  it('turns a word that names nothing away', () => {
    expect(parseAction('Escape')).toBeNull();
    expect(parseAction('pastee')).toBeNull();
    expect(parseAction('')).toBeNull();
  });
});

describe('what a key sends', () => {
  it('sends the sequences a terminal expects', () => {
    expect(send('Esc')).toBe('\x1b');
    expect(send('Tab')).toBe('\t');
    expect(send('Shift+Tab')).toBe('\x1b[Z');
    expect(send('Enter')).toBe('\r');
    expect(send('Shift+Enter')).toBe('\x1b[13;2u');
    expect(send('Backspace')).toBe('\x7f');
    expect(send('Delete')).toBe('\x1b[3~');
    expect(send('Insert')).toBe('\x1b[2~');
    expect(send('Up')).toBe('\x1b[A');
    expect(send('Left')).toBe('\x1b[D');
    expect(send('Home')).toBe('\x1b[H');
    expect(send('End')).toBe('\x1b[F');
    expect(send('PgUp')).toBe('\x1b[5~');
    expect(send('PgDn')).toBe('\x1b[6~');
    expect(send('F1')).toBe('\x1bOP');
    expect(send('F11')).toBe('\x1b[23~');
    expect(send('F12')).toBe('\x1b[24~');
  });

  it('sends control codes, Undo and Redo', () => {
    expect(send('Ctrl+C')).toBe('\x03');
    expect(send('Ctrl+D')).toBe('\x04');
    expect(send('Ctrl+Z')).toBe('\x1a');
    expect(send('Undo')).toBe('\x1f');
    expect(send('Redo')).toBe('\x1b[122;6u');
    expect(send('//')).toBe('//');
    expect(send('~')).toBe('~');
  });

  it('adds the modifiers lit in the bar', () => {
    expect(send('Left', { ctrl: true })).toBe('\x1b[1;5D');
    expect(send('Delete', { ctrl: true })).toBe('\x1b[3;5~');
    expect(send('Enter', { ctrl: true })).toBe('\x1b[13;5u');
    expect(send('Backspace', { alt: true })).toBe('\x1b\x7f');
    expect(send('Backspace', { ctrl: true })).toBe('\x08');
    expect(send('Esc', { alt: true })).toBe('\x1b\x1b');
    expect(send('/', { ctrl: true })).toBe('\x1b[47;5u');
    expect(send('Up', { super: true })).toBe('\x1b[1;9A');
  });

  it('applies them to a character typed in the field', () => {
    expect(type('c', { ctrl: true })).toBe('\x03');
    expect(type('C', { ctrl: true })).toBe('\x03');
    expect(type('b', { alt: true })).toBe('\x1bb');
    expect(type('x', { ctrl: true, alt: true })).toBe('\x1b\x18');
    expect(type('k', { super: true })).toBe('\x1b[107;9u');
    expect(type('K', { super: true })).toBe('\x1b[107;10u');
  });

  it('makes FN and a digit, A, B or an arrow another key', () => {
    expect(type('1', { fn: true })).toBe('\x1bOP');
    expect(type('5', { fn: true })).toBe('\x1b[15~');
    expect(type('0', { fn: true })).toBe('\x1b[21~');
    expect(type('a', { fn: true })).toBe('\x1b[23~');
    expect(type('B', { fn: true })).toBe('\x1b[24~');
    expect(send('Up', { fn: true })).toBe('\x1b[5~');
    expect(send('Down', { fn: true })).toBe('\x1b[6~');
    expect(send('Left', { fn: true })).toBe('\x1b[H');
    expect(send('Right', { fn: true })).toBe('\x1b[F');
    expect(send('Up', { fn: true, ctrl: true })).toBe('\x1b[5;5~');
    expect(type('x', { fn: true })).toBe('x');
  });

  it('sends nothing for modifiers and commands', () => {
    expect(send('Ctrl')).toBe('');
    expect(send('paste')).toBe('');
  });
});

describe('the field and the bar', () => {
  it('finds the one character typed', () => {
    expect(insertedText('', 'c')).toBe('c');
    expect(insertedText('ls', 'ls ')).toBe(' ');
    expect(insertedText('ab', 'axb')).toBe('x');
    expect(insertedText('aa', 'aaa')).toBe('a');
    expect(insertedText('', '😀')).toBe('😀');
    expect(insertedText('a', 'abc')).toBeNull();
    expect(insertedText('abc', 'ab')).toBeNull();
    expect(insertedText('the', 'The')).toBeNull();
  });

  it('knows when a modifier is lit', () => {
    expect(holdsAny({})).toBe(false);
    expect(holdsAny({ ctrl: false })).toBe(false);
    expect(holdsAny({ fn: true })).toBe(true);
  });

  it('names every key for screen readers', () => {
    for (const key of [...rows.flat(), ...more]) {
      expect(spoken(key.action)).toBeTruthy();
      if (key.up) expect(spoken(key.up.action)).toBeTruthy();
    }
    expect(spoken('Ctrl+C')).toBe('Control C');
    expect(spoken('Shift+Tab')).toBe('Shift Tab');
    expect(spoken('PgUp')).toBe('Page up');
    expect(spoken('Super')).toBe('Command');
    expect(spoken('select-all')).toBe('Select all');
    expect(spoken('Undo')).toBe('Undo');
    expect(spoken('$')).toBe('Dollar');
  });
});
