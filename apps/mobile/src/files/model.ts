// The Files tab's explorer, as the desktop's (public/project-files-view.js in
// switchboard): a tab for the project folder and one for each attached
// folder, each a tree of list-project-directory listings.

import type { Project } from '@/projects/model';

/** An entry of list-project-directory. */
export type FileEntry = { name: string; relativePath: string; type: 'directory' | 'file' | 'other'; size: number; viewable: boolean; previewType: string | null };

export type FilesRoot = { path: string; label: string; kind: 'project' | 'folder' | 'worktree' };

/** Hidden from the tree, as a code editor's explorer hides them by default. */
export const HIDDEN_NAMES = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db']);

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** The project folder first, then every attached folder ("name · branch" for a worktree on one). */
export function filesRoots(project: Pick<Project, 'root' | 'folders'>): FilesRoot[] {
  const roots: FilesRoot[] = [{ path: project.root, label: 'Project', kind: 'project' }];
  for (const folder of project.folders || []) {
    if (!folder?.path || roots.some((r) => r.path === folder.path)) continue;
    const name = basename(folder.path);
    roots.push({
      path: folder.path,
      label: folder.branch && folder.branch !== name ? `${name} · ${folder.branch}` : name,
      kind: folder.mode === 'worktree' ? 'worktree' : 'folder',
    });
  }
  return roots;
}

export type TreeRow = { entry: FileEntry; depth: number };

/**
 * The rows of a tree: each folder's entries (listings by folder, '' the
 * root), the entries of open folders under them. A folder not listed yet
 * shows nothing under it.
 */
export function treeRows(listings: Record<string, FileEntry[] | undefined>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (rel: string, depth: number) => {
    for (const entry of listings[rel] || []) {
      if (HIDDEN_NAMES.has(entry.name)) continue;
      rows.push({ entry, depth });
      if (entry.type === 'directory' && expanded.has(entry.relativePath)) walk(entry.relativePath, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}

/** The folders whose listings the tree needs: the root, and every open folder whose parents are open too. */
export function foldersToList(expanded: ReadonlySet<string>): string[] {
  const open = [...expanded].filter((rel) => {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) if (!expanded.has(parts.slice(0, i).join('/'))) return false;
    return true;
  });
  return ['', ...open.sort()];
}

/** "512 B", "34 KB", "2.5 MB". */
export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function parentRelative(rel: string): string {
  const index = rel.lastIndexOf('/');
  return index < 0 ? '' : rel.slice(0, index);
}

export function joinPath(root: string, rel: string): string {
  return rel ? `${root.replace(/\/$/, '')}/${rel}` : root;
}

/** What to type into a chat for a file: an @-mention for Claude, the path for Codex. */
export function chatMention(runtime: string | null | undefined, cwd: string | null | undefined, filePath: string): string {
  let ref = filePath;
  if (cwd && filePath.startsWith(cwd + '/')) ref = filePath.slice(cwd.length + 1);
  if (runtime === 'codex') return (/\s/.test(ref) ? `'${ref.replace(/'/g, "'\\''")}'` : ref) + ' ';
  return (/\s/.test(ref) ? `@"${ref}"` : `@${ref}`) + ' ';
}

/** A draft with a mention added: on a new line after text that does not end in a space. */
export function appendMention(text: string, mention: string): string {
  if (!text) return mention;
  return /\s$/.test(text) ? text + mention : `${text} ${mention}`;
}

/** Where a paste goes: into a folder, next to a file, or into the root. */
export function pasteTarget(entry: Pick<FileEntry, 'relativePath' | 'type'> | null): string {
  if (!entry) return '';
  return entry.type === 'directory' ? entry.relativePath : parentRelative(entry.relativePath);
}

/** An open folder renamed, moved or deleted: the open folders under their new names (or gone). */
export function remapExpanded(expanded: string[], from: string, to: string | null): string[] {
  const out: string[] = [];
  for (const rel of expanded) {
    if (rel === from || rel.startsWith(from + '/')) {
      if (to !== null) out.push(to + rel.slice(from.length));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** One commit of get-file-timeline. */
export type TimelineEntry = {
  hash: string; shortHash: string; parents: string[]; authorName: string; authorEmail: string;
  date: number; subject: string; status: string; path: string | null; oldPath: string | null;
};

export type Timeline = { ok: boolean; error?: string; repoRoot: string | null; repoPath?: string; isDirectory?: boolean; uncommitted?: boolean; entries: TimelineEntry[] };
