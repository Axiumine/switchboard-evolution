// The Worktrees tab as the desktop paints it (public/project-worktrees-view.js
// in switchboard): every git worktree of the project's repositories, grouped
// by repository, filtered, sorted, with the sessions running in each. Git
// runs on the computer (worktrees.js), through the channels remote-worktrees.js
// lets a phone call; this file only shapes what comes back and what goes out.

import type { LiveState, Session } from '@/sessions/model';

export type WorktreeKind = 'main' | 'switchboard' | 'claude' | 'codex' | 'classic' | 'other';

/** One worktree of get-project-worktrees. */
export type Worktree = {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string;
  prunable: boolean;
  prunableReason: string;
  isMain: boolean;
  exists: boolean;
  kind: WorktreeKind;
  attached: boolean;
  attachedMode: 'in-place' | 'worktree' | null;
  /** The path as the project stored it, when it differs from git's (a symlink). */
  attachedPath: string | null;
  /** Null when git could not tell (a missing folder, a bare repository). */
  dirty: boolean | null;
  ahead: number | null;
  behind: number | null;
  lastCommit: { hash: string; time: number; subject: string } | null;
  created: number | null;
};

export type WorktreeRepository = {
  /** git's common folder: the same for every worktree of the repository. */
  id: string;
  commonDir: string;
  name: string;
  mainPath: string;
  bare: boolean;
  /** Found inside an attached folder that is not itself the repository. */
  nested: boolean;
  error?: string;
  worktrees: Worktree[];
};

export type SortOrder = 'default' | 'nameAsc' | 'nameDesc' | 'createdDesc' | 'createdAsc';
export type StartAfter = 'none' | 'claude' | 'codex' | 'terminal';

export type WorktreeSettings = {
  pathTemplate: string;
  copyPatterns: string[];
  copyIgnores: string[];
  postCreateCmd: string;
  preRemoveCmd: string;
  startAfterCreate: StartAfter;
  sortOrder: SortOrder;
  collapsedGroups: string[];
};

export type WorktreeListing = { ok: true; repositories: WorktreeRepository[]; settings: WorktreeSettings; homeDir: string };

/** list-worktree-branches. */
export type Branches = {
  local: { name: string; head: string; upstream: string }[];
  remote: { name: string; remote: string; head: string }[];
  /** Branch → the worktree that has it checked out. */
  checkedOut: Record<string, string>;
  defaultBranch: string | null;
  mainBranch: string;
};

export type CreateMode = 'new' | 'existing' | 'remote' | 'detached';

/** worktree-create's spec, as remote-worktrees.js accepts it: no empty strings. */
export type CreateSpec = {
  repoPath: string;
  mode: CreateMode;
  branch?: string;
  startPoint?: string;
  remoteBranch?: string;
  path?: string;
  attach?: boolean;
  copyEnv?: string[];
};

export type CreateResult = {
  ok: true;
  worktree: { path: string; branch: string; mainPath: string };
  attached: boolean;
  copied: string[];
  warnings: string[];
  postCreateCmd: string;
};

/** worktree-remove answers with ok, or an error and why (dirty, locked, the pre-remove command failed). */
export type RemoveResult = {
  ok?: boolean;
  error?: string;
  dirty?: boolean;
  locked?: boolean;
  hookFailed?: boolean;
  output?: string;
  branch?: string;
  branchDeleted?: boolean;
  branchError?: string | null;
  unmerged?: boolean;
};

export type MergedWorktree = { path: string; branch: string; exists: boolean; dirty: boolean; locked: boolean; eligible: boolean; reason: string; fresh: boolean };
export type MergedList = { ok: true; base: string; worktrees: MergedWorktree[] };

export type PrunePreview = {
  ok: true;
  worktrees: { path: string; branch: string; reason: string }[];
  /** The project's worktree folders that are gone from disk. */
  staleFolders: { path: string; branch: string }[];
};

export const SORT_ORDERS: readonly { key: SortOrder; label: string }[] = [
  { key: 'default', label: 'Git order' },
  { key: 'nameAsc', label: 'Name, A to Z' },
  { key: 'nameDesc', label: 'Name, Z to A' },
  { key: 'createdDesc', label: 'Newest first' },
  { key: 'createdAsc', label: 'Oldest first' },
];

export const START_OPTIONS: readonly { key: StartAfter; label: string }[] = [
  { key: 'none', label: 'Nothing' },
  { key: 'claude', label: 'A Claude session' },
  { key: 'codex', label: 'A Codex session' },
  { key: 'terminal', label: 'A terminal' },
];

export const CREATE_MODES: readonly { key: CreateMode; label: string }[] = [
  { key: 'new', label: 'New branch' },
  { key: 'existing', label: 'Existing branch' },
  { key: 'remote', label: 'Remote branch' },
  { key: 'detached', label: 'Detached' },
];

/** Badge text for where a worktree came from; the side-by-side default and anything else get none. */
export const KIND_LABELS: Record<WorktreeKind, string> = { main: 'Main', switchboard: 'Project', claude: 'Claude', codex: 'Codex', classic: '', other: '' };

export const KIND_HELP: Record<WorktreeKind, string> = {
  main: 'The repository\'s main checkout',
  switchboard: 'A worktree of this Switchboard project',
  claude: 'Made by claude --worktree, in .claude/worktrees',
  codex: 'Made by Codex, in its worktrees folder',
  classic: 'Next to the repository, in <repo>.worktrees',
  other: 'A worktree somewhere else',
};

export const DEFAULT_PATH_TEMPLATE = '$BASE_PATH.worktrees/$REF_NAME';

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function basename(p: string): string {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function isPathInside(child: string, root: string): boolean {
  if (!child || !root) return false;
  if (child === root) return true;
  return child.startsWith(`${root}/`) || child.startsWith(`${root}\\`);
}

/** What a row is called: the branch, the short hash when detached, or the folder. */
export function worktreeLabel(wt: Pick<Worktree, 'path'> & Partial<Pick<Worktree, 'bare' | 'branch' | 'detached' | 'head'>>): string {
  if (wt.bare) return 'bare repository';
  if (wt.branch) return wt.branch;
  if (wt.detached && wt.head) return wt.head.slice(0, 8);
  return basename(wt.path);
}

/** A path with the computer's home folder as "~". */
export function shortPath(p: string, homeDir: string): string {
  const text = String(p || '');
  if (homeDir && isPathInside(text, homeDir)) return `~${text.slice(homeDir.length)}`;
  return text;
}

/**
 * Where a worktree sits, short: relative to the folder that holds its
 * repository (app.worktrees/feat, app/.claude/worktrees/fix), else with ~.
 */
export function rowPath(wt: Pick<Worktree, 'path'>, repo: Pick<WorktreeRepository, 'mainPath'> | null, homeDir: string): string {
  const base = String(repo?.mainPath || '').replace(/\.git$/i, '');
  const parent = base.split(/[\\/]/).slice(0, -1).join('/');
  if (parent && isPathInside(wt.path, parent) && wt.path !== parent) return wt.path.slice(parent.length + 1);
  return shortPath(wt.path, homeDir);
}

/** The main worktree stays first; the rest follow the chosen order. Missing times sort last. */
export function sortWorktrees(worktrees: Worktree[], order: SortOrder): Worktree[] {
  const main = worktrees.filter((wt) => wt.isMain);
  const rest = worktrees.filter((wt) => !wt.isMain);
  const byName = (a: Worktree, b: Worktree) => worktreeLabel(a).localeCompare(worktreeLabel(b), undefined, { numeric: true, sensitivity: 'base' });
  const byCreated = (direction: number) => (a: Worktree, b: Worktree) => {
    if (a.created == null && b.created == null) return 0;
    if (a.created == null) return 1;
    if (b.created == null) return -1;
    return direction * (a.created - b.created);
  };
  if (order === 'nameAsc') rest.sort(byName);
  else if (order === 'nameDesc') rest.sort((a, b) => byName(b, a));
  else if (order === 'createdDesc') rest.sort(byCreated(-1));
  else if (order === 'createdAsc') rest.sort(byCreated(1));
  return [...main, ...rest];
}

export function worktreeMatches(wt: Worktree, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [wt.branch, wt.path, wt.head, KIND_LABELS[wt.kind], wt.lockReason, wt.locked ? 'locked' : '', wt.exists ? '' : 'missing']
    .some((value) => String(value || '').toLowerCase().includes(q));
}

/**
 * The repositories to show, each with its worktrees filtered and sorted. A
 * query that names a repository keeps all its worktrees; a repository with
 * nothing left is hidden while filtering.
 */
export function visibleRepositories(repositories: WorktreeRepository[], query: string, order: SortOrder): { repo: WorktreeRepository; worktrees: Worktree[] }[] {
  const q = String(query || '').trim().toLowerCase();
  return (repositories || []).map((repo) => {
    const repoMatches = !!q && (repo.name.toLowerCase().includes(q) || repo.mainPath.toLowerCase().includes(q));
    const worktrees = (repo.worktrees || []).filter((wt) => !q || repoMatches || worktreeMatches(wt, q));
    return { repo, worktrees: sortWorktrees(worktrees, order) };
  }).filter((group) => !q || group.worktrees.length || group.repo.name.toLowerCase().includes(q));
}

/** "2 repositories · 5 worktrees". */
export function summaryText(repositories: WorktreeRepository[] | null | undefined): string {
  const repos = (repositories || []).length;
  const count = (repositories || []).reduce((n, repo) => n + (repo.worktrees || []).length, 0);
  return `${repos} ${repos === 1 ? 'repository' : 'repositories'} · ${plural(count, 'worktree')}`;
}

/**
 * Running sessions by worktree path. A session counts for the deepest
 * worktree it runs in, so one in .claude/worktrees/x is not also counted for
 * the main checkout around it.
 */
export function sessionsByWorktree(repositories: WorktreeRepository[], sessions: Session[], live: Record<string, LiveState>): Map<string, Session[]> {
  const byPath = new Map<string, Session[]>();
  // Each worktree under git's path and, when the project stored it another
  // way (a symlink), under that path too; counts go to git's path.
  const paths: [string, string][] = [];
  for (const repo of repositories || []) {
    for (const wt of repo.worktrees || []) {
      paths.push([wt.path, wt.path]);
      if (wt.attachedPath) paths.push([wt.attachedPath, wt.path]);
    }
  }
  paths.sort((a, b) => b[0].length - a[0].length);
  const seen = new Set<string>();
  for (const session of sessions) {
    const state = live[session.sessionId];
    if (!state || state.exited || seen.has(session.sessionId) || !session.projectPath) continue;
    seen.add(session.sessionId);
    const home = paths.find(([p]) => isPathInside(session.projectPath, p));
    if (!home) continue;
    if (!byPath.has(home[1])) byPath.set(home[1], []);
    byPath.get(home[1])!.push(session);
  }
  return byPath;
}

export type Badge = { label: string; tone: 'kind' | 'project' | 'plain' | 'locked' | 'missing'; help: string };

/** The badges after a row's name, in the desktop's order. */
export function worktreeBadges(wt: Worktree): Badge[] {
  const badges: Badge[] = [];
  const kind = KIND_LABELS[wt.kind];
  if (kind) badges.push({ label: kind, tone: wt.kind === 'switchboard' ? 'project' : 'kind', help: KIND_HELP[wt.kind] });
  if (wt.attached && wt.kind !== 'switchboard') badges.push({ label: 'In project', tone: 'project', help: 'Attached to this project' });
  if (wt.detached) badges.push({ label: 'Detached', tone: 'plain', help: 'No branch checked out' });
  if (wt.locked) badges.push({ label: 'Locked', tone: 'locked', help: wt.lockReason ? `Locked: ${wt.lockReason}` : 'Locked' });
  if (!wt.exists) badges.push({ label: 'Missing', tone: 'missing', help: wt.prunableReason || 'The folder is gone' });
  return badges;
}

/** A branch name as a folder name, the same way the computer does it. */
export function refFolderName(ref: string): string {
  return String(ref || '').replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 80);
}

/** The folder template filled in for a preview; the computer adds a number when the folder is taken. */
export function previewTemplate(template: string, repo: Pick<WorktreeRepository, 'mainPath'> | null, ref: string, projectRoot: string): string {
  const base = String(repo?.mainPath || '').replace(/\.git$/i, '');
  const parts = base.split(/[\\/]/);
  const vars: Record<string, string> = {
    BASE_PATH: base,
    BASE_ROOT: parts.slice(0, -1).join('/') || '/',
    BASE_NAME: parts[parts.length - 1] || '',
    REF_NAME: refFolderName(ref) || 'worktree',
    INDEX: '1',
    PROJECT_ROOT: projectRoot || '',
  };
  return String(template || '').replace(/\$(BASE_PATH|BASE_ROOT|BASE_NAME|REF_NAME|INDEX|PROJECT_ROOT)/g, (_m, name: string) => vars[name] ?? '');
}

export type Choice = { key: string; label: string; disabled?: boolean };

/** Start points for a new branch or a detached checkout: HEAD (''), then local and remote branches. */
export function startPointChoices(branches: Branches | null, detached = false): Choice[] {
  const head = branches?.mainBranch ? `HEAD of the main worktree (${branches.mainBranch})` : 'HEAD of the main worktree';
  return [
    { key: '', label: detached ? head.replace('HEAD of', 'The HEAD of') : head },
    ...(branches?.local || []).map((b) => ({ key: b.name, label: b.name })),
    ...(branches?.remote || []).map((b) => ({ key: b.name, label: b.name })),
  ];
}

/** Local branches; one checked out in a worktree already cannot be picked. */
export function existingChoices(branches: Branches | null): Choice[] {
  return (branches?.local || []).map((b) => {
    const holder = branches?.checkedOut[b.name];
    return { key: b.name, label: holder ? `${b.name} (in ${basename(holder)})` : b.name, disabled: !!holder };
  });
}

/** The local branch a remote branch becomes: origin/feat → feat. */
export function remoteLocalName(branches: Branches | null, remoteName: string): string {
  const remote = branches?.remote.find((b) => b.name === remoteName);
  return remote ? remoteName.slice(remote.remote.length + 1) : '';
}

export type CreateForm = {
  repoPath: string;
  mode: CreateMode;
  /** The new branch's name (new). */
  branch: string;
  /** Where a new branch or a detached checkout starts; '' is the main worktree's HEAD. */
  startPoint: string;
  /** The local branch to check out (existing). */
  existing: string;
  remoteBranch: string;
  /** The local branch made from the remote one; '' takes the remote's name. */
  localBranch: string;
  path: string;
  attach: boolean;
  copyEnv: string[];
};

/** The ref a new worktree's folder is named after, as the form stands. */
export function formRef(form: CreateForm, branches: Branches | null): string {
  if (form.mode === 'new') return form.branch.trim();
  if (form.mode === 'existing') return form.existing;
  if (form.mode === 'remote') return form.localBranch.trim() || form.remoteBranch;
  return form.startPoint || branches?.mainBranch || 'detached';
}

/**
 * worktree-create's spec from the form, or what is missing. Empty values are
 * left out: the phone's channel refuses an empty string where the window's
 * would read it as "none".
 */
export function createSpec(form: CreateForm): { spec: CreateSpec; error?: undefined } | { error: string; spec?: undefined } {
  const spec: CreateSpec = { repoPath: form.repoPath, mode: form.mode, attach: form.attach };
  const path = form.path.trim();
  if (path) spec.path = path;
  if (form.mode === 'new') {
    const branch = form.branch.trim();
    if (!branch) return { error: 'Name the new branch.' };
    spec.branch = branch;
    if (form.startPoint) spec.startPoint = form.startPoint;
  } else if (form.mode === 'existing') {
    if (!form.existing) return { error: 'Pick a branch.' };
    spec.branch = form.existing;
  } else if (form.mode === 'remote') {
    if (!form.remoteBranch) return { error: 'Pick a remote branch.' };
    spec.remoteBranch = form.remoteBranch;
    const local = form.localBranch.trim();
    if (local) spec.branch = local;
  } else if (form.startPoint) {
    spec.startPoint = form.startPoint;
  }
  const copyEnv = form.copyEnv.filter(Boolean);
  if (copyEnv.length) spec.copyEnv = copyEnv;
  return { spec };
}

/** "Created feat (copied .env; attached to the project)", with any warnings after. */
export function createdText(result: CreateResult): string {
  const label = result.worktree.branch || basename(result.worktree.path);
  const details: string[] = [];
  if (result.copied?.length) details.push(`copied ${result.copied.join(', ')}`);
  if (result.attached) details.push('attached to the project');
  return `Created ${label}${details.length ? ` (${details.join('; ')})` : ''}`;
}

/** Whether Remove can go ahead: a locked one must be unlocked, a dirty one must lose its changes. */
export function removeReady(wt: Pick<Worktree, 'locked' | 'dirty'>, { unlock, force }: { unlock: boolean; force: boolean }): boolean {
  return (!wt.locked || unlock) && (!wt.dirty || force);
}

export type MergedChoice = MergedWorktree & { notes: string; ticked: boolean };

/**
 * The merged worktrees as choices. One that cannot go is not offered, with the
 * reason. One with running sessions, or with no commits of its own yet (just
 * made), can go but is not ticked for you.
 */
export function mergedChoices(result: Pick<MergedList, 'worktrees'>, repo: Pick<WorktreeRepository, 'mainPath'>, homeDir: string, running: Map<string, Session[]>): MergedChoice[] {
  return result.worktrees.map((item) => {
    const count = (running.get(item.path) || []).length;
    const notes = [rowPath(item, repo, homeDir), item.reason, item.fresh ? 'no commits of its own yet' : '', count ? `${count} running` : ''].filter(Boolean).join(' · ');
    return { ...item, notes, ticked: item.eligible && !count && !item.fresh };
  });
}

/** Branches to measure "merged" against: the local ones, then the remote ones, with `base` first if it is neither. */
export function baseChoices(branches: Branches | null, base: string): string[] {
  const names = [...(branches?.local || []), ...(branches?.remote || [])].map((b) => b.name);
  return base && !names.includes(base) ? [base, ...names] : names;
}

/** "Pruned 2 worktree records, detached 1 folder". */
export function prunedText(result: { pruned: number; detached: number }): string {
  const parts = [`Pruned ${plural(result.pruned, 'worktree record')}`];
  if (result.detached) parts.push(`detached ${plural(result.detached, 'folder')}`);
  return parts.join(', ');
}

/** One pattern per line, as the settings show them. */
export function patternsText(list: string[] | null | undefined): string {
  return (list || []).join('\n');
}

/** Lines of patterns back to the list set-worktree-settings takes. */
export function patternsList(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text || '').split('\n')) {
    const pattern = line.trim();
    if (pattern && !out.includes(pattern)) out.push(pattern);
  }
  return out;
}

/** Collapse or open a repository's group: the new list for collapsedGroups. */
export function toggleGroup(collapsed: string[] | null | undefined, repoId: string): string[] {
  const list = collapsed || [];
  return list.includes(repoId) ? list.filter((id) => id !== repoId) : [...list, repoId];
}

/** The folder that holds a path: /a/b/c → /a/b. */
export function parentFolder(p: string): string {
  const trimmed = String(p || '').replace(/[\\/]+$/, '');
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return at > 0 ? trimmed.slice(0, at) : '/';
}

/** A worktree of the listing by its path (git's, or the one the project stored), with its repository. */
export function findWorktree(repositories: WorktreeRepository[] | null | undefined, path: string | null | undefined): { repo: WorktreeRepository; wt: Worktree } | null {
  if (!path) return null;
  for (const repo of repositories || []) {
    const wt = (repo.worktrees || []).find((item) => item.path === path || item.attachedPath === path);
    if (wt) return { repo, wt };
  }
  return null;
}

/** The project folder a worktree is attached as, matched by git's path or the one the project stored. */
export function folderFor<F extends { path: string }>(folders: F[], wt: Pick<Worktree, 'path' | 'attachedPath'>): F | null {
  return folders.find((f) => f.path === wt.path || (!!wt.attachedPath && f.path === wt.attachedPath)) || null;
}
