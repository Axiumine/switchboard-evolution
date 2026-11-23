// The Git tab's Pull Requests view, as on the desktop
// (apps/desktop/public/project-pull-requests-view.js): what the computer
// answers (apps/desktop/pull-requests.js, through gh) and the rules of the
// list, its filter and its actions. Keep the two in step.

import { treeRows, type TreeRow } from '@/git/model';

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type MergeMethod = 'merge' | 'squash' | 'rebase';
export type PullRequestAction = 'merge' | 'draft' | 'ready' | 'close';
/** Closed and merged pull requests come in pages; open ones all at once. */
export type PageState = 'CLOSED' | 'MERGED';

export type PullRequest = {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  createdAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  author: string;
  head: string;
  headOid: string;
  base: string;
  /** From a fork: its branch cannot be deleted from here. */
  crossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** The last commit's checks: SUCCESS, FAILURE, ERROR, PENDING, EXPECTED, or none. */
  checks: string | null;
  viewerDidAuthor: boolean;
};

export type PullRequestRepo = {
  nameWithOwner: string;
  url: string;
  permission: string | null;
  canWrite: boolean;
  mergeMethods: MergeMethod[];
  defaultMethod: MergeMethod | null;
  deleteBranchOnMerge: boolean;
};

export type GitHubRemote = { name: string; host: string; slug: string };

export type ErrorCode = 'gh-missing' | 'gh-auth' | 'no-github-remote' | 'not-found' | 'gh-failed' | 'bad-request' | 'busy' | 'git-failed';

type Answer = { ok?: boolean; error?: string; code?: ErrorCode };

/** get-pull-requests: every open pull request, drafts too, newest first. */
export type OpenListing = Answer & {
  remote?: string;
  remotes?: GitHubRemote[];
  repo?: PullRequestRepo;
  items?: PullRequest[];
  totalCount?: number;
  /** More than 1000 open: only the newest 1000 are listed. */
  truncated?: boolean;
};

/** get-pull-requests-page: one page of closed and/or merged pull requests. */
export type PageListing = Answer & {
  remote?: string;
  remotes?: GitHubRemote[];
  states?: PageState[];
  items?: PullRequest[];
  totalCount?: number;
  hasNextPage?: boolean;
  endCursor?: string | null;
};

export type PullRequestFile = {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  insertions: number;
  deletions: number;
  /** The file's hunks; null for a binary file or a diff GitHub does not show. */
  patch: string | null;
  tooLarge?: boolean;
};

export type FilesAnswer = Answer & { number?: number; files?: PullRequestFile[]; truncated?: boolean };
export type ActionAnswer = Answer & { message?: string };

// --- The list and its filter ---

export type PrFilterKey = 'open' | 'draft' | 'closed' | 'merged';
export type PrStatus = PrFilterKey;

export const PR_FILTERS: readonly { key: PrFilterKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'draft', label: 'Draft' },
  { key: 'closed', label: 'Closed' },
  { key: 'merged', label: 'Merged' },
];

/** What the list shows at first: every open pull request, drafts included. */
export const DEFAULT_FILTER: readonly PrFilterKey[] = ['open', 'draft'];
export const PAGE_SIZE = 10;

export function prStatus(pr: Pick<PullRequest, 'state' | 'isDraft'>): PrStatus {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  return pr.isDraft ? 'draft' : 'open';
}

export function prVisible(pr: PullRequest, filter: readonly PrFilterKey[]): boolean {
  return filter.includes(prStatus(pr));
}

/** The states the filter asks the computer for, a page at a time. */
export function pageStates(filter: readonly PrFilterKey[]): PageState[] {
  const states: PageState[] = [];
  if (filter.includes('closed')) states.push('CLOSED');
  if (filter.includes('merged')) states.push('MERGED');
  return states;
}

/** All open ones and the pages read so far, as the filter shows them: newest first. */
export function mergeLists(open: readonly PullRequest[], pages: readonly PullRequest[], filter: readonly PrFilterKey[]): PullRequest[] {
  const byNumber = new Map<number, PullRequest>();
  for (const pr of [...open, ...pages]) if (!byNumber.has(pr.number)) byNumber.set(pr.number, pr);
  return [...byNumber.values()]
    .filter((pr) => prVisible(pr, filter))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.number - a.number);
}

export function filterLabel(filter: readonly PrFilterKey[]): string {
  const chosen = PR_FILTERS.filter(({ key }) => filter.includes(key));
  if (chosen.length === PR_FILTERS.length) return 'All';
  return chosen.map(({ label }) => label).join(', ');
}

export function isDefaultFilter(filter: readonly PrFilterKey[]): boolean {
  return filter.length === DEFAULT_FILTER.length && DEFAULT_FILTER.every((key) => filter.includes(key));
}

/** The filter with `key` turned on or off; the last choice left stays on. */
export function toggleFilter(filter: readonly PrFilterKey[], key: PrFilterKey): PrFilterKey[] {
  const on = filter.includes(key);
  if (on && filter.length === 1) return [...filter];
  const next = on ? filter.filter((k) => k !== key) : [...filter, key];
  return PR_FILTERS.map(({ key: k }) => k).filter((k) => next.includes(k));
}

function wordList(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : (words[0] || '');
}

export function emptyText(filter: readonly PrFilterKey[]): string {
  return `No ${wordList(PR_FILTERS.filter(({ key }) => filter.includes(key)).map(({ label }) => label.toLowerCase()))} pull requests`;
}

/** "closed", "merged" or "closed and merged", for the pages' footer. */
export function pagedWords(states: readonly PageState[]): string {
  return states.map((s) => s.toLowerCase()).join(' and ');
}

// --- What may be done ---

/** The author, and anyone who may write to the repository, may change a pull request. */
export function canEdit(pr: PullRequest, repo: PullRequestRepo | null | undefined): boolean {
  return !!repo?.canWrite || pr.viewerDidAuthor;
}

/** Why Merge is off for this pull request, or null when it may be merged. */
export function mergeBlock(pr: PullRequest, repo: PullRequestRepo | null | undefined): string | null {
  if (pr.state === 'OPEN' && pr.isDraft) return 'A draft cannot be merged. Mark it ready for review first.';
  if (pr.state !== 'OPEN') return 'Only an open pull request can be merged.';
  if (!repo?.canWrite) return 'Your GitHub account cannot merge in this repository.';
  if (!repo.mergeMethods.length) return 'The repository allows no merge method.';
  if (pr.mergeable === 'CONFLICTING') return `It has conflicts with ${pr.base}. Resolve them first.`;
  return null;
}

export type ConfirmAction = Exclude<PullRequestAction, 'merge'>;

/** What each action other than Merge asks before it runs, as the desktop's dialogs. */
export const ACTION_COPY: Record<ConfirmAction, { menu: string; title: string; confirm: string; text: string; destructive?: boolean }> = {
  draft: {
    menu: 'Convert to draft…',
    title: 'Convert to draft',
    confirm: 'Convert to draft',
    text: 'A draft cannot be merged, and reviewers are not asked to review it. You can mark it ready for review again at any time.',
  },
  ready: {
    menu: 'Ready for review…',
    title: 'Ready for review',
    confirm: 'Mark as ready',
    text: 'Reviewers are asked to review it, and it can be merged when the repository\'s rules allow it.',
  },
  close: {
    menu: 'Close pull request…',
    title: 'Close pull request',
    confirm: 'Close pull request',
    text: 'It is closed without merging. Its branch stays, and the pull request can be reopened on GitHub.',
    destructive: true,
  },
};

/** The "…" menu of an open pull request: Convert to draft or Ready for review, then Close. */
export function menuActions(pr: PullRequest): ConfirmAction[] {
  if (pr.state !== 'OPEN') return [];
  return [pr.isDraft ? 'ready' : 'draft', 'close'];
}

export const METHOD_LABELS: Record<MergeMethod, string> = {
  merge: 'Create a merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

/** What to know before merging: checks, review, whether GitHub knows it can be merged. */
export function mergeWarnings(pr: PullRequest): string[] {
  const warnings: string[] = [];
  if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') warnings.push('Its checks failed.');
  else if (pr.checks === 'PENDING' || pr.checks === 'EXPECTED') warnings.push('Its checks are still running.');
  if (pr.reviewDecision === 'CHANGES_REQUESTED') warnings.push('A reviewer asked for changes.');
  else if (pr.reviewDecision === 'REVIEW_REQUIRED') warnings.push('It has not been approved yet.');
  if (pr.mergeable === 'UNKNOWN') warnings.push('GitHub has not worked out yet whether it can be merged.');
  return warnings;
}

export type Badge = { text: string; tone: 'draft' | 'bad' | 'good' | 'warn' };

/** A row's badges: draft, conflicts, the review and the checks. */
export function badges(pr: PullRequest): Badge[] {
  const list: Badge[] = [];
  if (prStatus(pr) === 'draft') list.push({ text: 'Draft', tone: 'draft' });
  if (pr.state !== 'OPEN') return list;
  if (pr.mergeable === 'CONFLICTING') list.push({ text: 'Conflicts', tone: 'bad' });
  if (pr.reviewDecision === 'APPROVED') list.push({ text: 'Approved', tone: 'good' });
  else if (pr.reviewDecision === 'CHANGES_REQUESTED') list.push({ text: 'Changes requested', tone: 'warn' });
  if (pr.checks === 'SUCCESS') list.push({ text: 'Checks passed', tone: 'good' });
  else if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') list.push({ text: 'Checks failed', tone: 'bad' });
  else if (pr.checks === 'PENDING' || pr.checks === 'EXPECTED') list.push({ text: 'Checks running', tone: 'warn' });
  return list;
}

/** "opened …", "merged …" or "closed …", with `when` turning a date into words. */
export function whenText(pr: PullRequest, when: (iso: string | null) => string): string {
  const status = prStatus(pr);
  if (status === 'merged') return `merged ${when(pr.mergedAt || pr.closedAt)}`;
  if (status === 'closed') return `closed ${when(pr.closedAt)}`;
  return `opened ${when(pr.createdAt)}`;
}

/** The title of the view when the pull requests cannot be read. */
export function errorTitle(code: ErrorCode | undefined): string {
  switch (code) {
    case 'gh-missing': return 'The GitHub CLI is needed on the computer';
    case 'gh-auth': return 'Sign in to GitHub on the computer';
    case 'no-github-remote': return 'No GitHub remote';
    case 'not-found': return 'Repository not found on GitHub';
    default: return 'The pull requests could not be read';
  }
}

/** "owner/repo · 3 open, 1 draft" */
export function summaryText(listing: OpenListing | undefined): string {
  if (!listing?.ok) return '';
  const items = listing.items || [];
  const drafts = items.filter((pr) => pr.isDraft).length;
  return `${listing.repo?.nameWithOwner || ''} · ${items.length - drafts} open${drafts ? `, ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}`;
}

const LETTERS: Record<PullRequestFile['status'], string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

export function fileLetter(file: Pick<PullRequestFile, 'status'>): string {
  return LETTERS[file.status] || 'M';
}

/** Why a file shows no diff. */
export function noPatchText(file: PullRequestFile): string {
  if (file.tooLarge) return 'This pull request\'s diffs are too large to show them all here.';
  if (file.status === 'renamed' && !file.insertions && !file.deletions) return 'Renamed, nothing else changed.';
  return 'A binary file, or a diff GitHub does not show.';
}

/** The pull request's page on GitHub, for the browser button before Merge; null when gh gave no web address. */
export function webUrl(pr: Pick<PullRequest, 'url'>): string | null {
  return typeof pr.url === 'string' && /^https?:\/\//i.test(pr.url) ? pr.url : null;
}

// --- An open pull request's files ---

/** How the files are laid out; a tree at first, as on the desktop. Every diff starts closed. */
export type FileView = 'tree' | 'list';
export const DEFAULT_FILE_VIEW: FileView = 'tree';

/** The four tools over the files, icons whose names these are (shown on a long press). */
export const FILE_TOOLS = {
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  tree: 'View as tree',
  list: 'View as list',
} as const;

/**
 * The files as rows: a tree as the Git tab draws one (folders first, a chain of
 * single folders on one row, a collapsed folder keeping only its own row), or
 * the list in GitHub's order.
 */
export function fileRows(files: readonly PullRequestFile[], view: FileView, collapsed: ReadonlySet<string> = new Set()): TreeRow<PullRequestFile>[] {
  if (view === 'tree') return treeRows([...files], { collapsed, compact: true });
  return files.map((file) => ({ kind: 'file', key: file.path, depth: 0, name: file.path.split('/').pop() || file.path, item: file }));
}
