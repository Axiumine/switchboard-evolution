import { expect, test } from '@jest/globals';

import { optionFields } from '../options';

const keys = (fields: { key: string }[]) => fields.map((f) => f.key);

test('a new Claude session offers a worktree, a resumed one does not', () => {
  expect(keys(optionFields('claude', {}).fields)).toEqual(expect.arrayContaining(['worktree', 'worktreeName']));
  const resumed = optionFields('claude', { worktree: true, worktreeName: 'spike' }, { resume: true });
  expect(keys(resumed.fields)).not.toContain('worktree');
  expect(keys(resumed.fields)).not.toContain('worktreeName');
  expect(keys(resumed.fields)).toContain('permissionMode');
});

test('custom arguments wait behind More options until they have a value', () => {
  expect(optionFields('claude', {}).behindMore.has('customArgs')).toBe(true);
  const typed = optionFields('claude', { customArgs: "--settings '{}'" });
  expect(keys(typed.fields)).toContain('customArgs');
  expect(typed.behindMore.has('customArgs')).toBe(false);
});

test('only shown fields count as behind More options', () => {
  for (const resume of [false, true]) {
    const { fields, behindMore } = optionFields('claude', {}, { resume });
    const shown = new Set(keys(fields));
    expect([...behindMore].every((key) => shown.has(key))).toBe(true);
  }
});
