import { describe, expect, it } from '@jest/globals';

import { KEY_GROUPS, MORE_KEYS } from '../keys';

const all = [...KEY_GROUPS.flat(), ...MORE_KEYS];

describe('terminal keys', () => {
  it('sends the control code for every ^ key', () => {
    for (const key of all.filter((k) => /^\^[A-Z]$/.test(k.label))) {
      expect(key.data).toBe(String.fromCharCode(key.label.charCodeAt(1) - 64));
    }
  });

  it('has the keys of the row and of the More keys sheet', () => {
    expect(KEY_GROUPS.map((group) => group.map((k) => k.label))).toEqual([['Esc', 'Tab', '⇧Tab', '^C'], ['←', '↓', '↑', '→'], ['⏎', '⇧⏎']]);
    expect(MORE_KEYS.map((k) => k.label)).toEqual(['Home', 'End', 'PgUp', 'PgDn', '^D', '^L', '^R', '^Z', '|', '~', '/', '-', '\\', '`', '$', 'F1']);
  });

  it('sends the escape sequences a terminal expects', () => {
    const data = Object.fromEntries(all.map((k) => [k.label, k.data]));
    expect(data['⇧Tab']).toBe('\x1b[Z');
    expect(data['↑']).toBe('\x1b[A');
    expect(data['⇧⏎']).toBe('\x1b[13;2u');
    expect(data.Home).toBe('\x1b[H');
    expect(data.PgDn).toBe('\x1b[6~');
    expect(data.F1).toBe('\x1bOP');
  });

  it('labels every key for screen readers', () => {
    for (const key of all) expect(key.hint).toBeTruthy();
  });
});
