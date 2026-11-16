import { expect, test } from '@jest/globals';

import { commandOf, diffLines } from '../tool-details';

test('an Edit shows the old lines as removed and the new ones as added', () => {
  expect(diffLines('Edit', { file_path: '/a.ts', old_string: 'let a = 1;\nlet b;', new_string: 'const a = 1;' })).toEqual({
    lines: [{ sign: '-', text: 'let a = 1;' }, { sign: '-', text: 'let b;' }, { sign: '+', text: 'const a = 1;' }],
    more: 0,
  });
  expect(diffLines('MultiEdit', { edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }] }).lines.map((l) => l.sign + l.text))
    .toEqual(['-x', '+y', '-p', '+q']);
});

test('a Write shows its content as added, cut short after the limit', () => {
  const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const { lines, more } = diffLines('Write', { file_path: '/b.md', content }, 40);
  expect(lines).toHaveLength(40);
  expect(lines[0]).toEqual({ sign: '+', text: 'line 0' });
  expect(more).toBe(10);
});

test("a Codex patch keeps its own + and - lines", () => {
  const patch = '*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n context\n*** End Patch';
  expect(diffLines('apply_patch', patch).lines).toEqual([{ sign: '-', text: 'old' }, { sign: '+', text: 'new' }]);
  expect(diffLines('Read', { file_path: '/a.ts' })).toEqual({ lines: [], more: 0 });
});

test('the command of a shell tool, from Claude or Codex', () => {
  expect(commandOf({ command: 'npm test', description: 'Run' })).toBe('npm test');
  expect(commandOf('{"cmd":"ls -la","workdir":"/tmp"}')).toBe('ls -la');
  expect(commandOf({ command: ['bash', '-lc', 'git status'] })).toBe('git status');
  expect(commandOf(null)).toBe('');
});
