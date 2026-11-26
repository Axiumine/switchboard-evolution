import type { Project } from '@/projects/model';
import { filesRoots, type FilesRoot } from '@/files/model';

/**
 * One row of the Env tab, as the desktop's project-env-files gives it
 * (projects.js envFilesState): the project folder or an attached folder, its
 * local.env.sh, whether that exists, and whether Git ignores it (null outside
 * a repository).
 */
export type EnvFileEntry = {
  path: string;
  kind: 'project' | 'folder' | 'worktree';
  filePath: string;
  exists: boolean;
  gitIgnored: boolean | null;
};

export type EnvFilesState = { ok: true; fileName: string; entries: EnvFileEntry[] };

export type EnvRow = EnvFileEntry & { label: string };

/**
 * The tab's rows: the project folder, then each attached folder in the
 * project's order, with the Files tab's labels; only the folders the
 * computer listed.
 */
export function envRows(project: Pick<Project, 'root' | 'folders'>, entries: readonly EnvFileEntry[] | undefined): EnvRow[] {
  const known = new Map((entries || []).map((entry) => [entry.path, entry]));
  return filesRoots(project)
    .filter((root: FilesRoot) => known.has(root.path))
    .map((root: FilesRoot) => ({ ...(known.get(root.path) as EnvFileEntry), label: root.label }));
}

/** Whether a row warns that Git would commit its file. */
export function envNeedsIgnore(row: Pick<EnvFileEntry, 'exists' | 'gitIgnored'>): boolean {
  return row.exists && row.gitIgnored === false;
}
