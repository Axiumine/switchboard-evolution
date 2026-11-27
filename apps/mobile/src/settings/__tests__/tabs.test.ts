import { describe, expect, it } from '@jest/globals';

import { settingsTabs } from '../tabs';

const keys = (caps: { global: boolean; knowledge: boolean; improver: boolean }) => settingsTabs(caps).map((t) => t.key);

describe('settingsTabs', () => {
  it('an old computer: only Computer', () => {
    expect(keys({ global: false, knowledge: false, improver: false })).toEqual(['computer']);
  });

  it('an old computer with the improver: Computer and Prompt Improver', () => {
    expect(keys({ global: false, knowledge: false, improver: true })).toEqual(['computer', 'improver']);
  });

  it('a computer with everything: the six, in order', () => {
    expect(keys({ global: true, knowledge: true, improver: true }))
      .toEqual(['computer', 'application', 'agents', 'editor', 'knowledge', 'improver']);
  });

  it('without the knowledge config: no Node Knowledge', () => {
    expect(keys({ global: true, knowledge: false, improver: true })).toEqual(['computer', 'application', 'agents', 'editor', 'improver']);
  });

  it('labels come from the shared model', () => {
    expect(settingsTabs({ global: true, knowledge: true, improver: true }).map((t) => t.label))
      .toEqual(['Computer', 'Application', 'Agents', 'Editor', 'Node Knowledge', 'Prompt Improver']);
  });
});
