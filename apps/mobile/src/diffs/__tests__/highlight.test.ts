import { expect, test } from '@jest/globals';

import { diffCodeLines, highlightCodeLines, languageOf, type CodePiece } from '../highlight';

const KEYWORD = '#FF79C6';
const STRING = '#F1FA8C';
const COMMENT = '#6272A4';
const TYPE = '#8BE9FD';
const NUMBER = '#BD93F9';

/** The colour of the first piece that reads `text`, on a line. */
const colourOf = (line: CodePiece[] | null | undefined, text: string) => line?.find((piece) => piece.text === text)?.style?.color;
const textOf = (line: CodePiece[] | null | undefined) => (line || []).map((piece) => piece.text).join('');

test('a file\'s language comes from its name, then its extension', () => {
  expect(languageOf('src/app/index.tsx')?.name).toBe('TSX');
  expect(languageOf('README.MD')?.name).toBe('Markdown');
  expect(languageOf('locales/de.json')?.name).toBe('JSON');
  expect(languageOf('scripts/build.sh')?.name).toBe('Shell');
  expect(languageOf('docker/Dockerfile')?.name).toBe('Dockerfile');
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

test('Shell, TOML and Dockerfile are coloured by their stream modes, as in the editor', () => {
  const sh = highlightCodeLines('# build\nif [ -n "$NAME" ]; then\n  echo "hi $USER"\nfi', 'run.sh')!;
  expect(sh[0]).toEqual([{ text: '# build', style: { color: COMMENT } }]);
  expect(colourOf(sh[1], 'if')).toBe(KEYWORD);
  expect(textOf(sh[2])).toBe('  echo "hi $USER"');
  expect(sh[2].some((piece) => piece.style?.color === STRING)).toBe(true);
  const toml = highlightCodeLines('[server]\nport = 8080 # web\nhost = "x"', 'config.toml')!;
  expect(toml[1].some((piece) => piece.style?.color === NUMBER)).toBe(true);
  expect(colourOf(toml[2], '"x"')).toBe(STRING);
  const docker = highlightCodeLines('FROM node:20\nRUN npm ci', 'Dockerfile')!;
  expect(colourOf(docker[0], 'FROM')).toBe(KEYWORD);
  expect(colourOf(docker[1], 'RUN')).toBe(KEYWORD);
});

test('SQL takes the editor\'s words: keywords, types, a table\'s column left plain', () => {
  const lines = highlightCodeLines("SELECT u.id FROM users u\nLEFT JOIN t ON t.id = u.id WHERE x IS NOT NULL AND d > DATE '2024-01-01'", 'q.sql')!;
  expect(colourOf(lines[0], 'SELECT')).toBe(KEYWORD);
  // CodeMirror 5's SQL would make ".id" a type; the editor's leaves it plain.
  expect(lines[0].some((piece) => piece.text.includes('.id') && piece.style)).toBe(false);
  expect(colourOf(lines[1], 'LEFT')).toBe(KEYWORD);
  expect(colourOf(lines[1], 'NULL')).toBe(KEYWORD);
  expect(colourOf(lines[1], 'DATE')).toBe(TYPE);
  expect(colourOf(lines[1], "'2024-01-01'")).toBe(STRING);
});

test('a stream mode goes on from line to line, and from a diff\'s context into its removed and added lines', () => {
  const code = diffCodeLines(['@@ -1,3 +1,3 @@', ' /* a', '-old */', '+new */', ' SELECT 1;'], 'q.sql')!;
  expect(code[2]).toEqual([{ text: 'old */', style: { color: COMMENT } }]);
  expect(code[3]).toEqual([{ text: 'new */', style: { color: COMMENT } }]);
  expect(colourOf(code[4], 'SELECT')).toBe(KEYWORD);
});

test('a language that is not highlighted, or code too long, gives null', () => {
  expect(highlightCodeLines('all: build', 'Makefile')).toBeNull();
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
