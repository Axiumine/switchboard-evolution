import { expect, test } from '@jest/globals';

import { cleanText, toolSummary, Transcript } from '../transcript';

const user = (uuid: string, content: any, extra: object = {}) => ({ type: 'user', uuid, message: { role: 'user', content }, ...extra });
const assistant = (uuid: string, content: any) => ({ type: 'assistant', uuid, message: { role: 'assistant', content } });

test('user and assistant text become chat items; other entries are skipped', () => {
  const t = new Transcript();
  const items = t.add([
    { type: 'file-history-snapshot' },
    user('u1', 'Fix the login page'),
    user('meta', 'Caveat: internal', { isMeta: true }),
    assistant('a1', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking at **login.ts**.' }]),
  ]);
  expect(items.map((i) => [i.kind, 'text' in i ? i.text : ''])).toEqual([
    ['user', 'Fix the login page'],
    ['assistant', 'Looking at **login.ts**.'],
  ]);
});

test('a tool call gets its result when the result arrives, even in a later read', () => {
  const t = new Transcript();
  t.add([assistant('a1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test\n--verbose', description: 'Run tests' } }])]);
  expect(t.items[0]).toMatchObject({ kind: 'tool', name: 'Bash', summary: 'npm test' });
  expect(t.items[0]).not.toHaveProperty('result');
  const before = t.items;
  const after = t.add([user('u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '3 passed' }], is_error: false }])]);
  expect(after).not.toBe(before);
  expect(after[0]).toMatchObject({ kind: 'tool', result: '3 passed', error: false });
  expect(after).toHaveLength(1);
});

test('slash commands and their output read as one item', () => {
  const t = new Transcript();
  const items = t.add([
    user('c1', '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the plan</command-args>'),
    user('c2', '<local-command-stdout>Compacted.</local-command-stdout>'),
  ]);
  expect(items).toEqual([{ kind: 'command', id: 'c1:0', text: '/compact keep the plan', output: 'Compacted.', time: undefined }]);
});

test('nothing new keeps the same array, so the list does not re-render', () => {
  const t = new Transcript();
  const first = t.add([user('u1', 'hi')]);
  expect(t.add([{ type: 'summary' }])).toBe(first);
});

test('text loses Claude Code wrappers; tool summaries stay one short line', () => {
  expect(cleanText('Do it<system-reminder>secret context</system-reminder> <b>now</b>')).toBe('Do it now');
  expect(toolSummary('Read', { file_path: '/src/app.ts' })).toBe('/src/app.ts');
  expect(toolSummary('Grep', { pattern: 'TODO', path: '/src' })).toBe('TODO');
  expect(toolSummary('Custom', { anything: 'x'.repeat(200) })).toHaveLength(161);
  expect(toolSummary('None', null)).toBe('');
});

test('terminal colour codes are taken out of command output and tool results', () => {
  const t = new Transcript();
  const items = t.add([
    user('c1', '<command-name>/model</command-name>'),
    user('c2', '<local-command-stdout>Set model to \x1b[1mSonnet\x1b[22m\x1b[2m and saved\x1b[22m</local-command-stdout>'),
    assistant('a1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    user('u1', [{ type: 'tool_result', tool_use_id: 't1', content: '\x1b[34mdir\x1b[0m file\x1b]8;;http://x\x07' }]),
  ]);
  expect(items[0]).toMatchObject({ kind: 'command', output: 'Set model to Sonnet and saved' });
  expect(items[1]).toMatchObject({ kind: 'tool', result: 'dir file' });
});

const png = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });

test('a user message with images is one item with its text and the images as data URIs', () => {
  const t = new Transcript();
  const items = t.add([user('u1', [png('aGVsbG8='), { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'd29ybGQ=' } }, { type: 'text', text: 'What is wrong here?' }])]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    kind: 'user',
    text: 'What is wrong here?',
    images: [
      { uri: 'data:image/png;base64,aGVsbG8=', mediaType: 'image/png' },
      { uri: 'data:image/jpeg;base64,d29ybGQ=', mediaType: 'image/jpeg' },
    ],
  });
  expect(JSON.stringify(items)).not.toContain('[image]');
});

test('images without text still make an item; images that are not inline data are left out', () => {
  const t = new Transcript();
  const items = t.add([
    user('u1', [png('aGk=')]),
    user('u2', [{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }, { type: 'text', text: 'and this' }]),
  ]);
  expect(items).toEqual([
    { kind: 'user', id: 'u1:0', text: '', images: [{ uri: 'data:image/png;base64,aGk=', mediaType: 'image/png' }], time: undefined },
    { kind: 'user', id: 'u2:1', text: 'and this', time: undefined },
  ]);
});

test('a tool result with a screenshot gives the tool item that image', () => {
  const t = new Transcript();
  const items = t.add([
    assistant('a1', [{ type: 'tool_use', id: 't1', name: 'mcp__browser__screenshot', input: { fullPage: true } }]),
    user('u1', [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Took a screenshot' }, png('c2hvdA==')] }]),
  ]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ kind: 'tool', result: 'Took a screenshot', images: [{ uri: 'data:image/png;base64,c2hvdA==', mediaType: 'image/png' }] });
});

test('a tool call keeps its input, for the details of Edit, Write and Bash', () => {
  const t = new Transcript();
  const input = { file_path: '/src/app.ts', old_string: 'let a = 1;', new_string: 'const a = 1;' };
  const items = t.add([assistant('a1', [{ type: 'tool_use', id: 't1', name: 'Edit', input }])]);
  expect(items[0]).toMatchObject({ kind: 'tool', name: 'Edit', summary: '/src/app.ts', input });
});

test('with thinking on, Claude\'s thinking is an item of its own (empty thinking is not)', () => {
  const t = new Transcript({ thinking: true });
  const items = t.add([
    assistant('a1', [{ type: 'thinking', thinking: 'Check the header first.' }]),
    assistant('a2', [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: 'The header is fine.' }]),
  ]);
  expect(items.map((i) => [i.kind, 'text' in i ? i.text : ''])).toEqual([
    ['thinking', 'Check the header first.'],
    ['assistant', 'The header is fine.'],
  ]);
});

test('a tool result counts its lines before it is cut short', () => {
  const t = new Transcript();
  const file = Array.from({ length: 300 }, (_, i) => `${String(i + 1).padStart(6)}\tconst line${i} = ${i};`).join('\n');
  const items = t.add([
    assistant('a1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/src/big.ts' } }]),
    user('u1', [{ type: 'tool_result', tool_use_id: 't1', content: `${file}\n\n<system-reminder>Whenever you read a file…</system-reminder>\n` }]),
  ]);
  expect(items[0]).toMatchObject({ kind: 'tool', lines: 300 });
  expect((items[0] as any).result.length).toBeLessThan(2100);
});

test('the output of a slash command is a new item, so the list shows it', () => {
  const t = new Transcript();
  const first = t.add([user('c1', '<command-name>/cost</command-name>')]);
  const command = first[0];
  const after = t.add([user('c2', '<local-command-stdout>$0.12</local-command-stdout>')]);
  expect(after[0]).not.toBe(command);
  expect(after[0]).toMatchObject({ kind: 'command', output: '$0.12' });
});
