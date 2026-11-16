import { describe, expect, it } from '@jest/globals';

import { changedLineIndices, parseUnifiedDiff } from '@/shared/vendor/git-diff-model';

import type { Change } from '../model';
import {
  diffRows, hunkPick, isStaged, isUnstaged, linesLabel, NO_PICKS, pathsToStage, pickedLines, sectionPaths, sideLetter, stageOutcome,
  stagingSections, toggleHunk, toggleLine, wholeFileOnlyReason,
} from '../staging';

const status = (code: string): Change['status'] => {
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)) return 'conflicted';
  if (code === '??') return 'untracked';
  if (/[RC]/.test(code)) return 'renamed';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
};
const change = (path: string, code: string, oldPath: string | null = null): Change => ({
  path, oldPath, code, status: status(code), indexStatus: code[0], worktreeStatus: code[1], staged: code[0] !== ' ' && code[0] !== '?',
});

describe('the lists', () => {
  const changes = [
    change('a.ts', ' M'), change('b.ts', 'M '), change('c.ts', 'MM'), change('d.txt', '??'), change('e.ts', 'A '),
    change('f.ts', 'UU'), change('g.ts', ' D'), change('new.ts', 'R ', 'old.ts'),
  ];

  it('splits into Merge, Staged and Changes, in that order', () => {
    const sections = stagingSections(changes);
    expect(sections.map((s) => s.title)).toEqual(['Merge Changes', 'Staged Changes', 'Changes']);
    expect(sections[0].changes.map((c) => c.path)).toEqual(['f.ts']);
    expect(sections[1].changes.map((c) => c.path)).toEqual(['b.ts', 'c.ts', 'e.ts', 'new.ts']);
    expect(sections[2].changes.map((c) => c.path)).toEqual(['a.ts', 'c.ts', 'd.txt', 'g.ts']);
  });

  it('lists a file staged and changed again on both sides', () => {
    const both = stagingSections([change('c.ts', 'MM')]);
    expect(both.map((s) => [s.key, s.side])).toEqual([['staged', 'staged'], ['changes', 'unstaged']]);
  });

  it('keeps a conflict out of Staged and Changes, whatever its letters', () => {
    const conflict = change('f.ts', 'AA');
    expect(isStaged(conflict)).toBe(false);
    expect(isUnstaged(conflict)).toBe(false);
    expect(stagingSections([conflict]).map((s) => [s.key, s.side])).toEqual([['merge', null]]);
  });

  it('puts an untracked file in Changes only', () => {
    expect(isUnstaged(change('d.txt', '??'))).toBe(true);
    expect(isStaged(change('d.txt', '??'))).toBe(false);
  });

  it('leaves out empty sections', () => {
    expect(stagingSections([])).toEqual([]);
    expect(stagingSections([change('a.ts', ' M')]).map((s) => s.key)).toEqual(['changes']);
  });

  it('reads an older computer that sends only `staged`', () => {
    const sections = stagingSections([{ path: 'a.ts', status: 'modified', staged: true }, { path: 'b.ts', status: 'modified', staged: false }]);
    expect(sections.map((s) => [s.key, s.changes[0].path])).toEqual([['staged', 'a.ts'], ['changes', 'b.ts']]);
  });

  it('names the letter of each side', () => {
    expect(sideLetter(change('c.ts', 'MM'), 'staged')).toBe('M');
    expect(sideLetter(change('e.ts', 'A '), 'staged')).toBe('A');
    expect(sideLetter(change('g.ts', ' D'), 'unstaged')).toBe('D');
    expect(sideLetter(change('d.txt', '??'), 'unstaged')).toBe('U');
    expect(sideLetter(change('f.ts', 'UU'), null)).toBe('!');
  });
});

describe('what staging sends', () => {
  it('names both ends of a rename when unstaging it, one when staging', () => {
    const renamed = change('new.ts', 'R ', 'old.ts');
    expect(pathsToStage([renamed, change('x.ts', 'M ')], false)).toEqual(['new.ts', 'old.ts', 'x.ts']);
    expect(pathsToStage([renamed], true)).toEqual(['new.ts']);
  });

  it('sends null for All when there is no conflict, and the section’s paths when there is one', () => {
    const plain = [change('a.ts', ' M'), change('b.ts', 'M ')];
    const [staged, changes] = stagingSections(plain);
    expect(sectionPaths(staged, plain)).toBeNull();
    expect(sectionPaths(changes, plain)).toBeNull();
    const withConflict = [...plain, change('f.ts', 'UU')];
    const sections = stagingSections(withConflict);
    expect(sectionPaths(sections[0], withConflict)).toEqual(['f.ts']);
    expect(sectionPaths(sections[1], withConflict)).toEqual(['b.ts']);
    expect(sectionPaths(sections[2], withConflict)).toEqual(['a.ts']);
  });

  it('stages what a Merge Changes section lists, even with no other conflict', () => {
    const all = [change('f.ts', 'UU')];
    expect(sectionPaths(stagingSections(all)[0], all)).toEqual(['f.ts']);
  });
});

const DIFF = [
  'diff --git a/app.ts b/app.ts',
  'index 1111111..2222222 100644',
  '--- a/app.ts',
  '+++ b/app.ts',
  '@@ -1,4 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  '+extra',
  ' three',
  '@@ -20,3 +21,3 @@ function tail() {',
  ' a',
  '-b',
  '+B',
  ' c',
].join('\n') + '\n';

describe('picking lines in a diff', () => {
  const parsed = parseUnifiedDiff(DIFF);
  const first = changedLineIndices(parsed, 0);
  const second = changedLineIndices(parsed, 1);

  it('has the changed lines of each hunk to pick', () => {
    expect(first).toEqual([6, 7, 8]);
    expect(second).toEqual([12, 13]);
  });

  it('picks a line and unpicks it on a second tap', () => {
    const one = toggleLine(NO_PICKS, 7);
    expect([...one]).toEqual([7]);
    expect(toggleLine(one, 7).size).toBe(0);
    expect(NO_PICKS.size).toBe(0);
  });

  it('knows how much of a hunk is picked', () => {
    expect(hunkPick(parsed, 0, NO_PICKS)).toBe('none');
    expect(hunkPick(parsed, 0, new Set([7]))).toBe('some');
    expect(hunkPick(parsed, 0, new Set(first))).toBe('all');
    expect(hunkPick(parsed, 1, new Set(first))).toBe('none');
  });

  it('selects a hunk, completing a part-picked one, and clears it when all is picked', () => {
    const partly = toggleLine(NO_PICKS, 7);
    const all = toggleHunk(parsed, 0, partly);
    expect([...all].sort()).toEqual(first);
    expect(toggleHunk(parsed, 0, all).size).toBe(0);
    const both = toggleHunk(parsed, 1, all);
    expect(both.size).toBe(5);
    expect([...toggleHunk(parsed, 0, both)].sort()).toEqual(second);
  });

  it('lists the picked lines in order', () => {
    expect(pickedLines(parsed, new Set([13, 7, 99]))).toEqual([7, 13]);
  });

  it('labels the actions', () => {
    expect(linesLabel('unstaged', 3)).toBe('Stage 3 lines');
    expect(linesLabel('staged', 1)).toBe('Unstage 1 line');
  });
});

describe('the rows of a diff', () => {
  it('tells header lines, hunk lines and changed lines apart, in order', () => {
    const rows = diffRows(parseUnifiedDiff(DIFF));
    expect(rows.map((r) => (r.kind === 'line' ? r.lineKind : r.kind))).toEqual([
      'meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'remove', 'add', 'add', 'context', 'hunk', 'context', 'remove', 'add', 'context',
    ]);
    expect(rows[4]).toMatchObject({ kind: 'hunk', hunk: 0, text: '@@ -1,4 +1,5 @@' });
    expect(rows[10]).toMatchObject({ kind: 'hunk', hunk: 1 });
    expect(rows[6]).toMatchObject({ kind: 'line', hunk: 0, index: 6, text: '-two' });
    expect(rows[13]).toMatchObject({ kind: 'line', hunk: 1, index: 13, text: '+B' });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('keeps the no-newline note with its hunk, and has no row for what follows the last newline', () => {
    const rows = diffRows(parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n'));
    expect(rows.map((r) => (r.kind === 'line' ? r.lineKind : r.kind))).toEqual(['meta', 'meta', 'hunk', 'remove', 'add', 'eof']);
  });

  it('has no rows for no diff', () => {
    expect(diffRows(parseUnifiedDiff(''))).toEqual([]);
  });
});

describe('when only the whole file can go', () => {
  it('allows lines in an ordinary diff', () => {
    expect(wholeFileOnlyReason(parseUnifiedDiff(DIFF), false)).toBeNull();
  });

  it('says so for a cut-short diff, a binary file, a rename and a mode change', () => {
    expect(wholeFileOnlyReason(parseUnifiedDiff(DIFF), true)).toMatch(/cut short/);
    expect(wholeFileOnlyReason(parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n'), false)).toMatch(/binary/i);
    expect(wholeFileOnlyReason(parseUnifiedDiff('diff --git a/a b/b\nsimilarity index 100%\nrename from a\nrename to b\n'), false)).toMatch(/renamed/);
    expect(wholeFileOnlyReason(parseUnifiedDiff('diff --git a/a b/a\nold mode 100644\nnew mode 100755\n'), false)).toMatch(/mode/);
  });
});

describe('the answer of a stage request', () => {
  it('is ok, or says why not', () => {
    expect(stageOutcome({ ok: true })).toEqual({ ok: true });
    expect(stageOutcome({ ok: false, error: 'index.lock exists' })).toEqual({ ok: false, error: 'index.lock exists', stale: false });
  });

  it('tells a changed file (STALE) from other failures', () => {
    expect(stageOutcome({ ok: false, error: 'The file changed', code: 'STALE' })).toEqual({ ok: false, error: 'The file changed', stale: true });
  });

  it('does not take nothing for success', () => {
    expect(stageOutcome(undefined).ok).toBe(false);
    expect(stageOutcome(null).ok).toBe(false);
  });
});
