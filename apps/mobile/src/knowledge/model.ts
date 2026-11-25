// What the phone's Node Knowledge tab works out itself; the rest of the
// reading of codebase-memory-mcp's answers is the shared knowledge-model.js.

export type ImpactAgainst = 'uncommitted' | 'branch' | 'since';

/**
 * detect_changes' arguments, as the desktop sends them: uncommitted work
 * against HEAD, a branch against its base (CBM picks it when none is given),
 * or the commits since a ref; each changed symbol's callers two steps out.
 */
export function impactArgs({ against, ref = '', scope = 'impact', depth = 2 }: { against: ImpactAgainst; ref?: string; scope?: 'impact' | 'files' | 'tests'; depth?: number }): Record<string, unknown> {
  const args: Record<string, unknown> = { scope, direction: 'inbound', depth: Math.max(1, Math.min(8, depth)), via: true, limit: 100, changed_limit: 100 };
  const r = ref.trim();
  if (against === 'uncommitted') args.since = 'HEAD';
  else if (against === 'since' && r) args.since = r;
  else if (against === 'branch' && r) args.base_branch = r;
  return args;
}

/**
 * The folder the tab shows: the one picked if still there, else the first
 * attached folder with a graph (the code), else the project folder's graph,
 * else the first attached folder, else the first.
 */
export function chooseFolder(folders: { path: string; indexed?: boolean; mode?: string }[], picked: string | undefined): string | null {
  if (picked && folders.some((f) => f.path === picked)) return picked;
  const attached = folders.filter((f) => f.mode !== 'project');
  return (attached.find((f) => f.indexed) ?? folders.find((f) => f.indexed) ?? attached[0] ?? folders[0])?.path ?? null;
}

type FolderLike = { path: string; mode?: string; sourcePath?: string | null; branch?: string | null };

const lastPart = (p: string) => p.split('/').filter(Boolean).pop() || p;

/** A folder's name in the tab: "Project folder" for the project's own, else its last part, and "worktree" for a worktree. */
export function folderLabel(f: FolderLike): string {
  if (f.mode === 'project') return 'Project folder';
  return `${lastPart(f.path)}${f.mode === 'worktree' ? ' · worktree' : ''}`;
}

/** The folders "Link now" links: the attached ones, not the project folder. */
export function linkableFolders<T extends FolderLike>(folders: T[]): T[] {
  return folders.filter((f) => f.mode !== 'project');
}

/** What a worktree is a checkout of, and what happens to its graph; null for any other folder. */
export function worktreeNote(f: FolderLike): string | null {
  if (f.mode !== 'worktree') return null;
  const of = f.sourcePath ? ` of ${lastPart(f.sourcePath)}` : '';
  const branch = f.branch ? `, branch ${f.branch}` : '';
  return `Worktree${of}${branch}. Its code graph is its own, deleted when it leaves the project.`;
}
