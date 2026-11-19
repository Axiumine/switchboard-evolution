import { expect, test } from '@jest/globals';

import {
  canShowChanges, changesMeta, changeState, changesVerdict, commitStat, hasPendingWork, unpushedBase, unpushedSummary, type Unpushed, type WorktreeChanges,
} from '../changes';

// The same cases as the desktop's test (test/project-worktrees-view.test.js).
const none: Unpushed = { kind: 'none', base: '', total: 0, commits: [], truncated: false };
const upstream = (total: number): Unpushed => ({ kind: 'upstream', base: 'origin/feat', total, commits: [], truncated: false });
const base: Pick<WorktreeChanges, 'branch' | 'detached' | 'operation' | 'behind' | 'changesTotal' | 'unpushed'> = {
  branch: 'feat', detached: false, operation: null, behind: null, changesTotal: 0, unpushed: none,
};

test('a row offers the panel for a checkout on disk, lit when there is work not committed or not pushed', () => {
  expect(canShowChanges({ exists: true, bare: false })).toBe(true);
  expect(canShowChanges({ exists: false, bare: false })).toBe(false);
  expect(canShowChanges({ exists: true, bare: true })).toBe(false);
  expect(hasPendingWork({ dirty: true, ahead: null })).toBe(true);
  expect(hasPendingWork({ dirty: false, ahead: 2 })).toBe(true);
  expect(hasPendingWork({ dirty: false, ahead: 0 })).toBe(false);
  expect(hasPendingWork({ dirty: null, ahead: null })).toBe(false);
});

test('the verdict says what removing a worktree would lose', () => {
  const safe = changesVerdict({ ...base, unpushed: upstream(0) });
  expect(safe.safe).toBe(true);
  expect(safe.lines.join('\n')).toMatch(/every commit is on origin\/feat: removing it loses no work/);

  const dirty = changesVerdict({ ...base, changesTotal: 3, unpushed: upstream(2), behind: 1 });
  expect(dirty.safe).toBe(false);
  expect(dirty.lines).toEqual([
    '3 uncommitted files: removing the worktree loses them.',
    '2 commits not pushed to origin/feat. Removing the worktree keeps the branch feat; deleting the branch too loses them.',
    '1 commit behind origin/feat.',
  ]);

  const noUpstream = changesVerdict({ ...base, unpushed: { ...none, kind: 'remotes', total: 1 } });
  expect(noUpstream.lines.join('\n')).toMatch(/1 commit not on any remote \(the branch has no upstream\)/);

  const detached = changesVerdict({ ...base, branch: '', detached: true, unpushed: { ...none, kind: 'remotes', total: 2 } });
  expect(detached.lines.join('\n')).toMatch(/on no branch and no remote: removing the worktree leaves them only in git's reflog/);

  expect(changesVerdict({ ...base, unpushed: { ...none, kind: 'local', base: 'main' } }).lines.join('\n')).toMatch(/every commit is in main/);
  expect(changesVerdict({ ...base, unpushed: { ...none, kind: 'local', base: 'main', total: 1 } }).lines.join('\n'))
    .toMatch(/1 commit not in main \(the repository has no remote\)\. The branch feat keeps it unless you delete it/);
  expect(changesVerdict(base).lines).toEqual(['Nothing uncommitted. There is no remote to check the commits against.']);
  expect(changesVerdict({ ...base, operation: 'rebase', unpushed: upstream(0) })).toEqual({ safe: false, lines: ['A rebase is in progress here.'] });
});

test('files say whether they are staged, and the sections their totals', () => {
  expect(changeState({ status: 'modified', indexStatus: 'M', worktreeStatus: 'M' })).toBe('Staged + unstaged');
  expect(changeState({ status: 'added', indexStatus: 'A', worktreeStatus: ' ' })).toBe('Staged');
  expect(changeState({ status: 'modified', indexStatus: ' ', worktreeStatus: 'M' })).toBe('Unstaged');
  expect(changeState({ status: 'untracked', indexStatus: '?', worktreeStatus: '?' })).toBe('Untracked');
  expect(changeState({ status: 'conflicted', indexStatus: 'U', worktreeStatus: 'U' })).toBe('Conflicted');
  expect(changesMeta({ changesTotal: 2, stats: { insertions: 4, deletions: 1 } })).toBe('2 files · +4 −1');
  expect(changesMeta({ changesTotal: 0, stats: { insertions: 0, deletions: 0 } })).toBe('');
  expect(commitStat({ files: 2, insertions: 3, deletions: 0 })).toBe('2 files +3 −0');
});

test('the unpushed section names what it compared with', () => {
  expect(unpushedBase({ kind: 'remotes', base: '' })).toBe('any remote branch');
  expect(unpushedSummary({ behind: null, unpushed: upstream(1) })).toEqual({ meta: '1 not on origin/feat', empty: 'Everything is pushed to origin/feat.' });
  expect(unpushedSummary({ behind: 2, unpushed: upstream(0) }).meta).toBe('all on origin/feat · 2 behind');
  expect(unpushedSummary({ behind: null, unpushed: { ...none, kind: 'remotes' } }).empty).toBe('No upstream branch, but every commit is on a remote branch.');
  expect(unpushedSummary({ behind: null, unpushed: { ...none, kind: 'local', base: 'main' } }).empty).toBe('No remote. Every commit is in main.');
  expect(unpushedSummary({ behind: null, unpushed: none })).toEqual({ meta: 'no remote', empty: 'There is no remote to compare with.' });
});
