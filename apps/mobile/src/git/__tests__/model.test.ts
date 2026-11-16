import { expect, test } from '@jest/globals';

import { diffLines, statusLetter, treeRows, type Change, type TreeRow } from '../model';

const change = (path: string, status: Change['status'], extra: Partial<Change> = {}): Change => ({ path, status, staged: false, ...extra });

test('a unified diff becomes typed lines, headers apart from content', () => {
  const diff = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1b2c3d4..5e6f7a8 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,3 @@ export function main() {',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '\\ No newline at end of file',
  ].join('\n');
  expect(diffLines(diff).map((l) => l.kind)).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'del', 'add', 'meta']);
  expect(diffLines(diff)[6].text).toBe('-const b = 2;');
  expect(diffLines('')).toEqual([]);
});

const outline = (rows: TreeRow<{ path: string }>[]) =>
  rows.map((r) => `${'  '.repeat(r.depth)}${r.name}${r.kind === 'folder' ? `/ (${r.count})` : ''}`);

test('changes read as a tree: folders first, each file under its folder', () => {
  const rows = treeRows([change('src/app.ts', 'modified'), change('README.md', 'added'), change('src/lib/util.ts', 'untracked'), change('src/b.ts', 'deleted')]);
  expect(outline(rows)).toEqual([
    'src/ (3)', '  lib/ (1)', '    util.ts', '  app.ts', '  b.ts', 'README.md',
  ]);
  const util = rows[2];
  expect(util.kind === 'file' && util.item.path).toBe('src/lib/util.ts');
});

test('a folder whose only child is a folder shares its row when compact', () => {
  const files = [{ path: 'backend/src/analysis/a.py' }, { path: 'backend/src/analysis/deep/b.py' }, { path: 'backend/src/analysis/deep/c.py' }, { path: 'web/x.ts' }];
  expect(outline(treeRows(files, { compact: true }))).toEqual([
    'backend / src / analysis/ (3)', '  deep/ (2)', '    b.py', '    c.py', '  a.py', 'web/ (1)', '  x.ts',
  ]);
  // Not compact: one row per folder, as before.
  expect(outline(treeRows(files)).slice(0, 3)).toEqual(['backend/ (3)', '  src/ (3)', '    analysis/ (3)']);
  // The key is the folder's whole path, so collapsing it works either way.
  expect(treeRows(files, { compact: true })[0].key).toBe('backend/src/analysis');
});

test('a collapsed folder keeps its own row and still counts its files', () => {
  const files = [{ path: 'src/lib/a.ts' }, { path: 'src/lib/b.ts' }, { path: 'src/c.ts' }];
  const rows = treeRows(files, { collapsed: new Set(['src/lib']) });
  expect(outline(rows)).toEqual(['src/ (3)', '  lib/ (2)', '  c.ts']);
  expect(rows[1].kind === 'folder' && rows[1].collapsed).toBe(true);
});

test('names sort as numbers where they hold numbers', () => {
  const rows = treeRows([{ path: 'm10.sql' }, { path: 'm2.sql' }, { path: 'm1.sql' }]);
  expect(rows.map((r) => r.name)).toEqual(['m1.sql', 'm2.sql', 'm10.sql']);
});

test('each change has the letter the desktop shows', () => {
  expect(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted'].map((s) => statusLetter(change('x', s as Change['status'])))).toEqual(['M', 'A', 'D', 'R', 'U', '!']);
});
