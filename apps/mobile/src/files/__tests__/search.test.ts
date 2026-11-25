import { describe, expect, it } from '@jest/globals';

import {
  countMatches, dismissFile, dismissMatch, EMPTY_SEARCH, matchParts, NO_DISMISSED, replaceOpts, replaceReport, replacementText, replaceTargets,
  resultRows, searchOpts, splitPath, summaryText, visibleFiles, type SearchFile, type SearchForm, type SearchMatch,
} from '../search';

const match = (line: number, column: number, text: string, before = '', after = ''): SearchMatch => ({ line, column, length: text.length, text, before, after });
const files: SearchFile[] = [
  { path: 'src/widget.ts', matches: [match(3, 6, 'color', 'const ', ' = red;'), match(9, 10, 'color', '  return ', ';')] },
  { path: 'README.md', matches: [match(1, 2, 'Color', '# ', ' picker')] },
];
const form = (patch: Partial<SearchForm> = {}): SearchForm => ({ ...EMPTY_SEARCH, ...patch });

describe('search options', () => {
  it('sends nothing while the query is empty', () => {
    expect(searchOpts(form())).toBeNull();
  });

  it('sends the toggles, the globs that are filled in, and the phone limit', () => {
    expect(searchOpts(form({ query: 'color', matchCase: true, include: ' src, *.ts ' }))).toEqual({
      query: 'color', isRegex: false, matchCase: true, wholeWord: false, preserveCase: false, include: 'src, *.ts', maxResults: 2000,
    });
    expect(searchOpts(form({ query: 'a.c', isRegex: true, wholeWord: true, exclude: 'dist' }))).toEqual({
      query: 'a.c', isRegex: true, matchCase: false, wholeWord: true, preserveCase: false, exclude: 'dist', maxResults: 2000,
    });
  });

  it('leaves the replace text out of the search', () => {
    expect(searchOpts(form({ query: 'x', replace: 'y' }))).not.toHaveProperty('replace');
  });
});

describe('dismissing results', () => {
  it('drops one match, and a file left with none', () => {
    const one = visibleFiles(files, dismissMatch(NO_DISMISSED, 'README.md', files[1].matches[0]));
    expect(one.map((f) => f.path)).toEqual(['src/widget.ts']);
    const two = visibleFiles(files, dismissMatch(NO_DISMISSED, 'src/widget.ts', files[0].matches[1]));
    expect(two[0].matches.map((m) => m.line)).toEqual([3]);
    expect(two).toHaveLength(2);
  });

  it('drops a whole file, and does not touch the input', () => {
    const dismissed = dismissFile(NO_DISMISSED, 'src/widget.ts');
    expect(visibleFiles(files, dismissed).map((f) => f.path)).toEqual(['README.md']);
    expect(files[0].matches).toHaveLength(2);
    expect(NO_DISMISSED.files.size).toBe(0);
  });

  it('keeps the same object when nothing is dismissed', () => {
    expect(visibleFiles(files, NO_DISMISSED)[0]).toBe(files[0]);
  });
});

describe('summary and rows', () => {
  it('counts what is shown', () => {
    expect(countMatches(files)).toEqual({ matches: 3, files: 2 });
    expect(summaryText(files, false)).toBe('3 results in 2 files');
    expect(summaryText([files[1]], false)).toBe('1 result in 1 file');
    expect(summaryText([], false)).toBe('No results');
    expect(summaryText(files, true)).toBe('3 results in 2 files (there are more results than shown)');
  });

  it('lists each file with its matches, unless it is collapsed', () => {
    expect(resultRows(files, new Set()).map((r) => r.kind)).toEqual(['file', 'match', 'match', 'file', 'match']);
    const rows = resultRows(files, new Set(['src/widget.ts']));
    expect(rows.map((r) => r.kind)).toEqual(['file', 'file', 'match']);
    expect(rows[0]).toMatchObject({ kind: 'file', collapsed: true });
    expect(new Set(resultRows(files, new Set()).map((r) => r.key)).size).toBe(5);
  });

  it('splits a path into name and folder', () => {
    expect(splitPath('src/ui/button.tsx')).toEqual({ name: 'button.tsx', folder: 'src/ui' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', folder: '' });
  });

  it('shows a line without its leading whitespace', () => {
    expect(matchParts(match(2, 4, 'x', '    foo(', ')'))).toEqual({ before: 'foo(', text: 'x', after: ')' });
  });

  it('cuts a long start short', () => {
    const before = 'const something = anotherFunctionWithALongName(';
    const parts = matchParts(match(2, before.length, 'x', before, ')'));
    expect(parts.before).toBe('\u2026' + before.slice(-24));
  });
});

describe('what a match is replaced with', () => {
  it('is the replace text as typed for a plain query', () => {
    expect(replacementText(form({ query: 'color', replace: 'colour $1' }), files[0].matches[0])).toBe('colour $1');
  });

  it('keeps the case of the match with Preserve Case, as the desktop does', () => {
    const f = form({ query: 'color', replace: 'shade', preserveCase: true });
    expect(replacementText(f, match(1, 0, 'Color', '', ' x'))).toBe('Shade');
    expect(replacementText(f, match(1, 0, 'COLOR', '', ''))).toBe('SHADE');
  });

  it('expands $1 and $& for a regular expression', () => {
    const f = form({ query: '(\\w+)@(\\w+)', isRegex: true, replace: '$2:$1' });
    expect(replacementText(f, match(1, 6, 'ann@lab', 'mail: ', '!'))).toBe('lab:ann');
    expect(replacementText(form({ query: 'a+', isRegex: true, replace: '[$&]' }), match(1, 0, 'aaa', '', ' b'))).toBe('[aaa]');
  });

  it('lets a lookbehind see the line when the row has all of it', () => {
    const f = form({ query: '(?<=price: )\\d+', isRegex: true, replace: '<$&>' });
    expect(replacementText(f, match(1, 7, '42', 'price: ', ' usd'))).toBe('<42>');
  });

  it('keeps the replace text when the pattern is invalid', () => {
    expect(replacementText(form({ query: '(', isRegex: true, replace: 'z' }), match(1, 0, '(', '', ''))).toBe('z');
  });
});

describe('replacing', () => {
  it('targets every match shown, with only what the desktop checks', () => {
    expect(replaceTargets(files)).toEqual([
      { path: 'src/widget.ts', matches: [{ line: 3, column: 6, length: 5, text: 'color' }, { line: 9, column: 10, length: 5, text: 'color' }] },
      { path: 'README.md', matches: [{ line: 1, column: 2, length: 5, text: 'Color' }] },
    ]);
  });

  it('targets one file or one match', () => {
    expect(replaceTargets(files, { path: 'README.md' }).map((t) => t.path)).toEqual(['README.md']);
    expect(replaceTargets(files, { path: 'src/widget.ts', match: files[0].matches[1] })).toEqual([
      { path: 'src/widget.ts', matches: [{ line: 9, column: 10, length: 5, text: 'color' }] },
    ]);
  });

  it('leaves out what was dismissed', () => {
    const shown = visibleFiles(files, dismissMatch(NO_DISMISSED, 'src/widget.ts', files[0].matches[0]));
    expect(replaceTargets(shown).flatMap((t) => t.matches.map((m) => m.line))).toEqual([9, 1]);
  });

  it('builds the request', () => {
    const f = form({ query: 'color', matchCase: true, replace: 'colour', include: 'src' });
    expect(replaceOpts(f, replaceTargets(files, { path: 'README.md' }))).toEqual({
      query: 'color', isRegex: false, matchCase: true, wholeWord: false, preserveCase: false, replace: 'colour',
      files: [{ path: 'README.md', matches: [{ line: 1, column: 2, length: 5, text: 'Color' }] }],
    });
  });

  it('reports what was replaced and what was left alone', () => {
    expect(replaceReport({ ok: true, replaced: 3, files: 2, skipped: [] })).toEqual({ title: 'Replaced 3 matches in 2 files', message: '' });
    expect(replaceReport({ ok: true, replaced: 1, files: 1 }).title).toBe('Replaced 1 match in 1 file');
    expect(replaceReport({ ok: true, replaced: 0, files: 0, skipped: [{ path: 'a.ts', reason: 'changed since the search' }] })).toEqual({
      title: 'Nothing was replaced', message: 'Left alone:\na.ts: changed since the search',
    });
    const many = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}.ts`, reason: 'busy' }));
    expect(replaceReport({ ok: true, replaced: 2, files: 2, skipped: many }).message.split('\n').slice(-1)[0]).toBe('and 2 more');
  });
});
