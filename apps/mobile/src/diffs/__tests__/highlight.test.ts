import { expect, test } from '@jest/globals';

import { diffCodeLines, highlightCodeLines, languageOf, type CodePiece } from '../highlight';

const KEYWORD = '#FF79C6';
const STRING = '#F1FA8C';
const COMMENT = '#6272A4';
const TYPE = '#8BE9FD';

/** The colour of the first piece that reads `text`, on a line. */
const colourOf = (line: CodePiece[] | null | undefined, text: string) => line?.find((piece) => piece.text === text)?.style?.color;
const textOf = (line: CodePiece[] | null | undefined) => (line || []).map((piece) => piece.text).join('');

test('a file\'s language comes from its name, then its extension', () => {
  expect(languageOf('src/app/index.tsx')?.name).toBe('TSX');
  expect(languageOf('README.MD')?.name).toBe('Markdown');
  expect(languageOf('locales/de.json')?.name).toBe('JSON');
  // The editor reads these with stream modes: no colours here.
  expect(languageOf('scripts/build.sh')).toBeNull();
  expect(languageOf('Makefile')).toBeNull();
});

test('code is coloured as the editor colours it, line by line', () => {
  const lines = highlightCodeLines('const name: string = "x"; // why\nexport type A = B;', 'a.ts');
  expect(lines).toHaveLength(2);
  expect(colourOf(lines![0], 'const')).toBe(KEYWORD);
  expect(colourOf(lines![0], ': string')).toBeUndefined();
  expect(colourOf(lines![0], 'string')).toBe(TYPE);
  expect(colourOf(lines![0], '"x"')).toBe(STRING);
  expect(colourOf(lines![0], '// why')).toBe(COMMENT);
  // Nothing is lost: the pieces make the line.
  expect(textOf(lines![0])).toBe('const name: string = "x"; // why');
  expect(textOf(lines![1])).toBe('export type A = B;');
});

test('other languages: JSON, Python, YAML, Markdown with a code block', () => {
  expect(colourOf(highlightCodeLines('{ "a": "b" }', 'x.json')![0], '"b"')).toBe(STRING);
  expect(colourOf(highlightCodeLines('def go():\n  return 1', 'x.py')![0], 'def')).toBe(KEYWORD);
  expect(highlightCodeLines('key: value # note', 'x.yml')![0].some((piece) => piece.style?.color === COMMENT)).toBe(true);
  const md = highlightCodeLines('# Title\n```ts\nconst x = 1\n```', 'README.md')!;
  expect(md[0][0].style).toMatchObject({ fontWeight: 'bold' });
  expect(colourOf(md[2], 'const')).toBe(KEYWORD);
});

test('a language that is not highlighted, or code too long, gives null', () => {
  expect(highlightCodeLines('echo hi', 'run.sh')).toBeNull();
  expect(highlightCodeLines('x'.repeat(600 * 1024), 'a.js')).toBeNull();
});

test('a piece of a file that starts inside a /* */ comment reads as the comment', () => {
  const lines = highlightCodeLines(' * still the comment\n */\nconst a = 1;', 'a.js')!;
  expect(lines).toHaveLength(3);
  expect(lines[0][0]).toEqual({ text: ' * still the comment', style: { color: COMMENT } });
  expect(colourOf(lines[2], 'const')).toBe(KEYWORD);
});

test('a diff\'s hunks are coloured side by side, the sign and the headers left out', () => {
  const diff = [
    '@@ -1,4 +1,4 @@',
    ' /* a comment',
    '-   over lines */',
    '+   over two lines */',
    ' const a = "s";',
    '',
    '\\ No newline at end of file',
  ];
  const code = diffCodeLines(diff, 'a.js')!;
  expect(code[0]).toBeNull();
  expect(code[6]).toBeNull();
  // The comment goes on over the removed line on the old side, over the added one on the new side.
  expect(code[2]).toEqual([{ text: '   over lines */', style: { color: COMMENT } }]);
  expect(code[3]).toEqual([{ text: '   over two lines */', style: { color: COMMENT } }]);
  expect(colourOf(code[4], 'const')).toBe(KEYWORD);
  expect(colourOf(code[4], '"s"')).toBe(STRING);
  expect(code[5]).toEqual([]);
});

test('a diff of a file whose language is not highlighted gives null', () => {
  expect(diffCodeLines(['@@ -1 +1 @@', '-a', '+b'], 'notes.txt')).toBeNull();
});
