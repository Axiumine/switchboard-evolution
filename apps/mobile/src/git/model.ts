// A project's repositories as the desktop's Git tab shows them: what changed,
// as a list or a tree, and the diff of one file.

import { colors } from '@/theme';

/** One changed file, from the porcelain status (git.js parsePorcelain). */
export type Change = {
  path: string;
  oldPath?: string | null;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
};

export type Commit = { hash: string; shortHash: string; author: string; date: string; subject: string };

/** A repository attached to a project (get-project-git-info). */
export type Repository = {
  path: string;
  mode: 'in-place' | 'worktree';
  git: boolean;
  branch?: string;
  detached?: boolean;
  head?: string;
  dirty?: boolean;
  ahead?: number | null;
  behind?: number | null;
  operation?: string | null;
  changes?: Change[];
  stats?: { insertions: number; deletions: number };
  commits?: Commit[];
};

export type DiffLine = { kind: 'meta' | 'hunk' | 'add' | 'del' | 'context'; text: string };

/** A unified diff, line by line, with what each line is. */
export function diffLines(diff: string): DiffLine[] {
  if (!diff) return [];
  let inHunk = false;
  return diff.replace(/\n$/, '').split('\n').map((text) => {
    if (text.startsWith('@@')) { inHunk = true; return { kind: 'hunk', text }; }
    if (text.startsWith('diff ')) inHunk = false;
    if (!inHunk || text.startsWith('\\')) return { kind: 'meta', text };
    if (text.startsWith('+')) return { kind: 'add', text };
    if (text.startsWith('-')) return { kind: 'del', text };
    return { kind: 'context', text };
  });
}

export type TreeRow<T> =
  | { kind: 'folder'; key: string; depth: number; name: string; count: number; collapsed: boolean }
  | { kind: 'file'; key: string; depth: number; name: string; item: T };

type TreeNode<T> = { folders: Map<string, TreeNode<T>>; files: T[] };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function fileCount<T>(node: TreeNode<T>): number {
  let count = node.files.length;
  for (const child of node.folders.values()) count += fileCount(child);
  return count;
}

/**
 * Paths as a tree, as the desktop's buildGitChangeTree/gitTreeRows
 * (public/project-git-view.js) show them: each folder with how many files it
 * holds, then what is inside it, folders before files. A collapsed folder
 * keeps only its own row. With `compact`, a folder whose only child is a
 * folder shares its row ("src / lib"), as the desktop's compactFolders does.
 */
export function treeRows<T extends { path: string }>(items: T[], options: { collapsed?: ReadonlySet<string>; compact?: boolean } = {}): TreeRow<T>[] {
  const root: TreeNode<T> = { folders: new Map(), files: [] };
  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean);
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part)!;
    }
    node.files.push(item);
  }
  const rows: TreeRow<T>[] = [];
  const visit = (node: TreeNode<T>, depth: number, prefix: string) => {
    for (const [first, start] of [...node.folders].sort(([a], [b]) => byName(a, b))) {
      const names = [first];
      let child = start;
      while (options.compact && !child.files.length && child.folders.size === 1) {
        const [[name, next]] = [...child.folders];
        names.push(name);
        child = next;
      }
      const key = `${prefix}${names.join('/')}`;
      const collapsed = !!options.collapsed?.has(key);
      rows.push({ kind: 'folder', key, depth, name: names.join(' / '), count: fileCount(child), collapsed });
      if (!collapsed) visit(child, depth + 1, `${key}/`);
    }
    for (const item of [...node.files].sort((a, b) => byName(a.path, b.path))) {
      rows.push({ kind: 'file', key: item.path, depth, name: item.path.split('/').pop() || item.path, item });
    }
  };
  visit(root, 0, '');
  return rows;
}

/** The colour of each kind of change, in every list of changed files. */
export const STATUS_COLORS: Record<Change['status'], string> = {
  modified: colors.attention, added: colors.running, untracked: colors.running, deleted: colors.danger, renamed: colors.accent, conflicted: colors.danger,
};

const LETTERS: Record<Change['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!' };

export function statusLetter(change: Pick<Change, 'status'>): string {
  return LETTERS[change.status] || '?';
}
