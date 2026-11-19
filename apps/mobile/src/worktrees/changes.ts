// What a worktree holds that is nowhere else, as the desktop's panel shows it
// (wtChangesVerdict and the sections around it in
// public/project-worktrees-view.js): its uncommitted files and the commits no
// remote has, read with worktree-changes; one file's diff with
// worktree-file-diff. Both are read-only.

import type { Change } from '@/git/model';
import { plural, type Worktree } from './model';

/** One commit of worktree-changes' unpushed list (git.js parseLogWithStat). */
export type UnpushedCommit = {
  hash: string;
  shortHash: string;
  author: string;
  /** Milliseconds. */
  time: number;
  subject: string;
  files: number;
  insertions: number;
  deletions: number;
};

/**
 * What the commits were compared with: the branch's upstream, every remote
 * branch (no upstream), the main worktree's branch (no remote at all), or
 * nothing.
 */
export type UnpushedKind = 'upstream' | 'remotes' | 'local' | 'none';

export type Unpushed = { kind: UnpushedKind; base: string; total: number; commits: UnpushedCommit[]; truncated: boolean };

/** worktree-changes (worktrees.js worktreeChanges). */
export type WorktreeChanges = {
  ok: true;
  path: string;
  isMain: boolean;
  branch: string;
  detached: boolean;
  head: string;
  locked: boolean;
  operation: string | null;
  ahead: number | null;
  behind: number | null;
  changes: Change[];
  /** Every changed file; `changes` holds the first 2000. */
  changesTotal: number;
  stats: { insertions: number; deletions: number } | null;
  lastCommit: { hash: string; shortHash: string; author: string; date: string; subject: string } | null;
  unpushed: Unpushed;
};

export type FileDiff = { ok: true; path: string; diff: string; truncated: boolean };

/** Whether a row offers the panel: a checkout on disk. */
export function canShowChanges(wt: Pick<Worktree, 'exists' | 'bare'>): boolean {
  return !!wt.exists && !wt.bare;
}

/** Whether the list already knows of work not committed or not pushed (the button is lit). */
export function hasPendingWork(wt: Pick<Worktree, 'dirty' | 'ahead'>): boolean {
  return wt.dirty === true || (wt.ahead || 0) > 0;
}

/** Staged, unstaged, both, untracked or conflicted, in words. */
export function changeState(change: Pick<Change, 'status' | 'indexStatus' | 'worktreeStatus'>): string {
  if (change.status === 'untracked') return 'Untracked';
  if (change.status === 'conflicted') return 'Conflicted';
  const staged = !!change.indexStatus && change.indexStatus !== ' ' && change.indexStatus !== '?';
  const unstaged = !!change.worktreeStatus && change.worktreeStatus !== ' ' && change.worktreeStatus !== '?';
  if (staged && unstaged) return 'Staged + unstaged';
  return staged ? 'Staged' : 'Unstaged';
}

export function statsText(stats: { insertions?: number; deletions?: number } | null | undefined): string {
  if (!stats || (!stats.insertions && !stats.deletions)) return '';
  return `+${stats.insertions || 0} −${stats.deletions || 0}`;
}

/** Where the commits were compared, in words: "origin/feat", "any remote branch", "main". */
export function unpushedBase(unpushed: Pick<Unpushed, 'kind' | 'base'> | null | undefined): string {
  if (!unpushed) return '';
  if (unpushed.kind === 'upstream' || unpushed.kind === 'local') return unpushed.base;
  if (unpushed.kind === 'remotes') return 'any remote branch';
  return '';
}

type VerdictInput = Pick<WorktreeChanges, 'branch' | 'detached' | 'operation' | 'behind' | 'changesTotal' | 'unpushed'>;

/**
 * Whether the worktree can go without losing work, as { safe, lines }: what
 * is uncommitted, what is not pushed, and what removing it does to each.
 */
export function changesVerdict(info: VerdictInput): { safe: boolean; lines: string[] } {
  const lines: string[] = [];
  const files = info.changesTotal || 0;
  const unpushed = info.unpushed || { kind: 'none', base: '', total: 0, commits: [], truncated: false };
  const commits = unpushed.total || 0;
  if (info.operation) lines.push(`A ${info.operation} is in progress here.`);
  if (files) lines.push(`${plural(files, 'uncommitted file')}: removing the worktree loses ${files === 1 ? 'it' : 'them'}.`);
  if (commits) {
    const these = commits === 1 ? 'it' : 'them';
    if (unpushed.kind === 'local') {
      lines.push(`${plural(commits, 'commit')} not in ${unpushed.base} (the repository has no remote).${info.detached ? ` On no branch: removing the worktree leaves ${these} only in git's reflog.` : ` The branch ${info.branch} keeps ${these} unless you delete it.`}`);
    } else if (info.detached) {
      lines.push(`${plural(commits, 'commit')} on no branch and no remote: removing the worktree leaves ${these} only in git's reflog.`);
    } else {
      const where = unpushed.kind === 'upstream' ? `pushed to ${unpushed.base}` : 'on any remote (the branch has no upstream)';
      lines.push(`${plural(commits, 'commit')} not ${where}. Removing the worktree keeps the branch ${info.branch}; deleting the branch too loses ${these}.`);
    }
  }
  const safe = !files && !commits && !info.operation;
  if (safe) {
    if (unpushed.kind === 'none') lines.push('Nothing uncommitted. There is no remote to check the commits against.');
    else if (unpushed.kind === 'local') lines.push(`Nothing uncommitted, and every commit is in ${unpushed.base}: removing it loses no work.`);
    else lines.push(`Nothing uncommitted, and every commit is on ${unpushed.kind === 'upstream' ? unpushed.base : 'a remote branch'}: removing it loses no work.`);
  }
  if (info.behind) lines.push(`${plural(info.behind, 'commit')} behind ${unpushed.base || 'its upstream'}.`);
  return { safe, lines };
}

/** The unpushed section's heading note and what it says when there is nothing to list. */
export function unpushedSummary(info: Pick<WorktreeChanges, 'behind' | 'unpushed'>): { meta: string; empty: string } {
  const unpushed = info.unpushed;
  const base = unpushedBase(unpushed);
  let meta: string;
  let empty: string;
  if (!unpushed || unpushed.kind === 'none') {
    meta = 'no remote';
    empty = 'There is no remote to compare with.';
  } else {
    meta = unpushed.total ? `${unpushed.total} not on ${base}` : `all on ${base}`;
    if (unpushed.kind === 'upstream') empty = `Everything is pushed to ${base}.`;
    else if (unpushed.kind === 'remotes') empty = 'No upstream branch, but every commit is on a remote branch.';
    else empty = `No remote. Every commit is in ${base}.`;
  }
  if (info.behind) meta += ` · ${info.behind} behind`;
  return { meta, empty };
}

/** "3 files · +12 −4" for the uncommitted section. */
export function changesMeta(info: Pick<WorktreeChanges, 'changesTotal' | 'stats'>): string {
  return [info.changesTotal ? plural(info.changesTotal, 'file') : '', statsText(info.stats)].filter(Boolean).join(' · ');
}

/** "2 files +3 −0" for a commit. */
export function commitStat(commit: Pick<UnpushedCommit, 'files' | 'insertions' | 'deletions'>): string {
  return [commit.files ? plural(commit.files, 'file') : '', statsText(commit)].filter(Boolean).join(' ');
}
