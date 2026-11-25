// The Git tab's Pull Requests view, as on the desktop
// (apps/desktop/public/project-pull-requests-view.js): what the computer
// answers (apps/desktop/pull-requests.js, through gh) and the rules of the
// list, its filter and its actions. Keep the two in step.

import { treeRows, type TreeRow } from '@/git/model';
import { mergeRepoLists, repoPagePlan } from '@/shared/vendor/repo-selection';

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type MergeMethod = 'merge' | 'squash' | 'rebase';
export type PullRequestAction = 'merge' | 'draft' | 'ready' | 'close' | 'reopen';
/** Closed and merged pull requests come in pages; open ones all at once. */
export type PageState = 'CLOSED' | 'MERGED';

export type PullRequest = {
  /** GitHub's id of the pull request, what every change names (edit-pull-request). */
  id?: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  createdAt: string | null;
  /** When GitHub last changed it. From a newer desktop only. */
  updatedAt?: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  author: string;
  /** The author's avatar. From a newer desktop only. */
  authorAvatar?: string | null;
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
  /** GitHub lets this account change the title (and the description). From a newer desktop only. */
  viewerCanUpdate?: boolean;
  viewerCanReopen?: boolean;
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

/** One repository's side of the merged list: its open pull requests (all of them), the closed/merged pages read so far, whether GitHub has more pages. */
export type RepoPullRequests = { key: string; open: readonly PullRequest[]; pages: readonly PullRequest[]; hasMore: boolean };
export type RepoPullRequest = { key: string; pr: PullRequest };
export type MergedPullRequests = {
  items: RepoPullRequest[];
  /** Per repository, the closed/merged pull requests read but not shown yet (they wait for a repository that has more pages). */
  held: Record<string, number>;
  /** How many closed/merged ones are shown. */
  pageShown: number;
};

const created = (pr: PullRequest) => new Date(pr.createdAt || 0).getTime();

/**
 * Several repositories' pull requests as one list, the desktop's prMergeRepoViews:
 * every open one of every repository, and the closed/merged pages merged newest
 * first (each repository keeps its own order, and the merge stops where a
 * repository with more pages runs out, so nothing is shown out of place). Then
 * newest first, ties by the repositories' order, then by number. Within one
 * repository an open one hides the same number in a page. For one repository
 * this is mergeLists.
 */
export function mergeRepoPullRequests(repos: readonly RepoPullRequests[], filter: readonly PrFilterKey[]): MergedPullRequests {
  const order = new Map(repos.map((repo, index) => [repo.key, index]));
  const shown: RepoPullRequest[] = [];
  const lists = repos.map((repo) => {
    const seen = new Set<number>();
    for (const pr of repo.open) {
      if (seen.has(pr.number)) continue;
      seen.add(pr.number);
      if (prVisible(pr, filter)) shown.push({ key: repo.key, pr });
    }
    const items: PullRequest[] = [];
    for (const pr of repo.pages) {
      if (seen.has(pr.number)) continue;
      seen.add(pr.number);
      if (prVisible(pr, filter)) items.push(pr);
    }
    return { key: repo.key, items, hasMore: repo.hasMore };
  });
  const { merged, held } = mergeRepoLists(lists, (pr) => created(pr));
  for (const entry of merged) shown.push({ key: entry.key, pr: entry.item });
  shown.sort((a, b) => String(b.pr.createdAt || '').localeCompare(String(a.pr.createdAt || ''))
    || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0) || b.pr.number - a.pr.number);
  return { items: shown, held, pageShown: merged.length };
}

/** The repositories to read the next page of, for a "Load 10 more": those with more pages that hold fewer than a page not shown yet. */
export function morePages(repos: readonly RepoPullRequests[], merged: Pick<MergedPullRequests, 'held'>, want = PAGE_SIZE): string[] {
  return repoPagePlan(repos.map((repo) => ({ key: repo.key, hasMore: repo.hasMore })), merged.held, want);
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
  reopen: {
    menu: 'Reopen pull request…',
    title: 'Reopen pull request',
    confirm: 'Reopen pull request',
    text: 'It is open again, with its branch, its commits and its conversation as they were.',
  },
};

/** The "…" menu of an open pull request: Convert to draft or Ready for review, then Close; Reopen on a closed one. */
export function menuActions(pr: PullRequest): ConfirmAction[] {
  if (pr.state === 'CLOSED') return ['reopen'];
  if (pr.state !== 'OPEN') return [];
  return [pr.isDraft ? 'ready' : 'draft', 'close'];
}

/** The row's "…": the actions above, with Change base on an open one (a desktop that has edit-pull-request). */
export type RowMenuKey = ConfirmAction | 'base';
export function rowMenu(pr: PullRequest, { canChangeBase }: { canChangeBase: boolean }): RowMenuKey[] {
  const actions: RowMenuKey[] = menuActions(pr);
  if (pr.state === 'OPEN' && canChangeBase) actions.splice(1, 0, 'base');
  return actions;
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

/** "3 repositories · 12 open, 2 drafts"; for one repository, summaryText. Nothing until one has answered. */
export function summaryTextMany(listings: readonly (OpenListing | undefined)[]): string {
  if (listings.length === 1) return summaryText(listings[0]);
  const answered = listings.filter((listing): listing is OpenListing => !!listing?.ok);
  if (!answered.length) return '';
  const items = answered.flatMap((listing) => listing.items || []);
  const drafts = items.filter((pr) => pr.isDraft).length;
  return `${answered.length} ${answered.length === 1 ? 'repository' : 'repositories'} · ${items.length - drafts} open${drafts ? `, ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}`;
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

/**
 * An address the page may show inside the app (PullRequestWebPage, a window
 * of its own): https only and not too long, as on the desktop; null otherwise.
 * Other addresses still go to the browser.
 */
export function inAppWebUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048 || !/^https:\/\/[^/\s?#]+/i.test(url) || /\s/.test(url)) return null;
  return url;
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

// --- An open pull request, as GitHub's page shows it (pull-request-detail.js on the desktop) ---

export type DetailTab = 'conversation' | 'commits' | 'checks' | 'files';
export const DETAIL_TABS: readonly { key: DetailTab; label: string; short: string }[] = [
  { key: 'conversation', label: 'Conversation', short: 'Conversation' },
  { key: 'commits', label: 'Commits', short: 'Commits' },
  { key: 'checks', label: 'Checks', short: 'Checks' },
  { key: 'files', label: 'Files changed', short: 'Files' },
];

export type Reaction = { content: ReactionContent; count: number; mine: boolean };
export type ReactionContent = 'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';
export const REACTIONS: readonly { content: ReactionContent; emoji: string; label: string }[] = [
  { content: 'THUMBS_UP', emoji: '👍', label: 'Thumbs up' },
  { content: 'THUMBS_DOWN', emoji: '👎', label: 'Thumbs down' },
  { content: 'LAUGH', emoji: '😄', label: 'Laugh' },
  { content: 'HOORAY', emoji: '🎉', label: 'Hooray' },
  { content: 'CONFUSED', emoji: '😕', label: 'Confused' },
  { content: 'HEART', emoji: '❤️', label: 'Heart' },
  { content: 'ROCKET', emoji: '🚀', label: 'Rocket' },
  { content: 'EYES', emoji: '👀', label: 'Eyes' },
];

export type HideReason = 'OUTDATED' | 'RESOLVED' | 'DUPLICATE' | 'OFF_TOPIC' | 'SPAM' | 'ABUSE';
export const HIDE_REASONS: readonly { key: HideReason; label: string }[] = [
  { key: 'OUTDATED', label: 'Outdated' }, { key: 'RESOLVED', label: 'Resolved' }, { key: 'DUPLICATE', label: 'Duplicate' },
  { key: 'OFF_TOPIC', label: 'Off-topic' }, { key: 'SPAM', label: 'Spam' }, { key: 'ABUSE', label: 'Abuse' },
];

export type MessageKind = 'description' | 'comment' | 'review' | 'review-comment';

/** The description, a comment, a review or a review comment, with what this account may do with it. */
export type Message = {
  kind: MessageKind;
  id: string;
  url: string;
  author: string;
  avatar: string | null;
  association: string;
  body: string;
  bodyHtml: string;
  createdAt: string | null;
  editedAt: string | null;
  mine: boolean;
  can: { update: boolean; delete: boolean; minimize: boolean; react: boolean };
  /** Why it was hidden (lowercase), or null. */
  minimized: string | null;
  reactions: Reaction[];
  /** A review's decision. */
  state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt?: string | null;
  replyTo?: string | null;
};

export type TimelineCommit = { kind: 'commit'; oid: string; short: string; headline: string; author: string; createdAt: string | null; checks: string | null; url: string };
export type TimelineEvent = {
  kind: 'event';
  type: 'force-pushed' | 'base-changed' | 'renamed' | 'closed' | 'reopened' | 'merged' | 'ready' | 'draft' | 'review-requested'
    | 'review-request-removed' | 'review-dismissed' | 'labeled' | 'unlabeled' | 'assigned' | 'unassigned' | 'branch-deleted' | 'branch-restored';
  actor: string;
  createdAt: string | null;
  from?: string;
  to?: string;
  commit?: string;
  subject?: string;
  message?: string;
  label?: { name: string; color: string };
};
export type TimelineItem = Message | TimelineCommit | TimelineEvent;

export type ReviewThread = {
  id: string;
  path: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  resolvedBy: string | null;
  can: { resolve: boolean; unresolve: boolean; reply: boolean };
  reviewId: string | null;
  diffHunk: string;
  comments: Message[];
};

export type Reviewer = { kind: 'user' | 'team' | 'bot'; login: string; name: string; avatar?: string | null; state: string };
export type Label = { id: string; name: string; color: string; description: string };
export type Person = { id: string; login: string; avatar: string | null; name?: string };

/** The pull request as its conversation reads it: the description, the sidebar, what this account may do. */
export type PullRequestHead = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  body: string;
  bodyHtml: string;
  author: string;
  avatar: string | null;
  association: string;
  createdAt: string | null;
  editedAt: string | null;
  mine: boolean;
  can: { update: boolean; react: boolean; close: boolean; reopen: boolean; updateBranch: boolean; label: boolean; assign: boolean };
  mergeStateStatus: string;
  mergeable: PullRequest['mergeable'];
  reviewDecision: PullRequest['reviewDecision'];
  head: string;
  headOid: string;
  base: string;
  crossRepository: boolean;
  checks: string | null;
  comments?: number;
  commitCount?: number;
  reactions: Reaction[];
  reviewers: Reviewer[];
  assignees: Person[];
  labels: Label[];
  pendingReviewId: string | null;
};

export type ConversationAnswer = Answer & {
  number?: number;
  /** The first page only. */
  pr?: PullRequestHead;
  threads?: ReviewThread[];
  timeline?: { items: TimelineItem[]; totalCount: number; hasNextPage: boolean; endCursor: string | null };
};

export type Commit = { oid: string; short: string; headline: string; body: string; date: string | null; author: string; avatar: string | null; url: string; checks: string | null };
export type CommitsAnswer = Answer & { commits?: Commit[]; totalCount?: number; truncated?: boolean };
export type CommitFilesAnswer = Answer & { sha?: string; files?: PullRequestFile[]; truncated?: boolean };

export type CheckBucket = 'pass' | 'fail' | 'pending' | 'skipped' | 'cancelled';
export type Check = {
  kind: 'run' | 'status';
  id: number | null;
  name: string;
  title: string;
  group: string;
  app: string;
  runId: number | null;
  event: string;
  status: string;
  conclusion: string | null;
  bucket: CheckBucket;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  required: boolean;
  /** A GitHub Actions job: it has a log and can run again. */
  actions: boolean;
};
export type ChecksAnswer = Answer & { headOid?: string; rollup?: string | null; checks?: Check[]; summary?: Record<CheckBucket, number>; truncated?: boolean };
export type LogAnswer = Answer & { jobId?: number; text?: string; truncated?: boolean };
export type ViewedAnswer = Answer & { viewed?: Record<string, 'VIEWED' | 'DISMISSED'> };
export type BranchesAnswer = Answer & { defaultBranch?: string | null; branches?: string[]; totalCount?: number };
export type CandidatesAnswer = Answer & { kind?: 'labels' | 'users'; items?: (Label | Person)[]; totalCount?: number };
export type MarkdownAnswer = Answer & { html?: string };
export type EditAnswer = Answer & { kind?: string; message?: string };

/** One change to a pull request: the kinds pull-request-edits.js on the desktop takes. */
export type EditParams =
  | { kind: 'title'; pullRequestId: string; title: string }
  | { kind: 'body'; pullRequestId: string; body: string }
  | { kind: 'base'; pullRequestId: string; base: string }
  | { kind: 'comment'; pullRequestId: string; body: string }
  | { kind: 'comment-edit'; type: 'issue' | 'review-comment' | 'review'; id: string; body: string }
  | { kind: 'comment-delete'; type: 'issue' | 'review-comment'; id: string }
  | { kind: 'comment-hide'; id: string; reason: HideReason }
  | { kind: 'comment-unhide'; id: string }
  | { kind: 'thread-reply'; threadId: string; body: string }
  | { kind: 'thread-resolve' | 'thread-unresolve'; threadId: string }
  | { kind: 'react' | 'unreact'; subjectId: string; content: ReactionContent }
  | { kind: 'review'; pullRequestId: string; event: ReviewEvent; body?: string; pendingReviewId?: string }
  | { kind: 'update-branch'; pullRequestId: string; headOid: string; method: 'MERGE' | 'REBASE' }
  | { kind: 'viewed' | 'unviewed'; pullRequestId: string; path: string }
  | { kind: 'reviewers'; pullRequestId: string; users: string[]; teams: string[] }
  | { kind: 'labels' | 'assignees'; pullRequestId: string; add: string[]; remove: string[] }
  | { kind: 'rerun'; runId: number; failedOnly?: boolean }
  | { kind: 'rerun-job'; jobId: number };

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export const REVIEW_EVENTS: readonly { key: ReviewEvent; label: string; help: string }[] = [
  { key: 'COMMENT', label: 'Comment', help: 'General feedback, without approving.' },
  { key: 'APPROVE', label: 'Approve', help: 'Feedback, and approval to merge.' },
  { key: 'REQUEST_CHANGES', label: 'Request changes', help: 'Feedback that must be addressed before merging.' },
];

/** Which review choices are open: on one's own pull request GitHub takes only Comment. */
export function reviewChoices(mine: boolean): { key: ReviewEvent; label: string; help: string; disabled: boolean }[] {
  return REVIEW_EVENTS.map((event) => ({ ...event, disabled: mine && event.key !== 'COMMENT' }));
}

/** Why a review cannot be sent yet, or null. */
export function reviewProblem(event: ReviewEvent, body: string, mine: boolean): string | null {
  if (mine && event !== 'COMMENT') return 'GitHub does not let you approve or request changes on your own pull request.';
  if (event !== 'APPROVE' && !body.trim()) return 'Write what the review says.';
  return null;
}

/** Why a title cannot be saved, or null: as GitHub, not empty, one line, at most 256 characters. */
export function titleProblem(title: string): string | null {
  const text = title.trim();
  if (!text) return 'A title cannot be empty.';
  if (/[\r\n]/.test(title)) return 'A title is one line.';
  if (text.length > 256) return 'A title is at most 256 characters.';
  return null;
}

/** The tabs' counts: the conversation's own once read, else the list's; the checks once read. */
export function detailCounts(pr: Pick<PullRequest, 'changedFiles'> & { comments?: number; commitCount?: number }, head: PullRequestHead | undefined, commits: CommitsAnswer | undefined, checks: ChecksAnswer | undefined): Record<DetailTab, number | null> {
  return {
    conversation: head?.comments ?? pr.comments ?? null,
    commits: commits?.ok ? (commits.totalCount ?? commits.commits?.length ?? null) : (head?.commitCount ?? pr.commitCount ?? null),
    checks: checks?.ok ? (checks.checks?.length ?? 0) : null,
    files: pr.changedFiles ?? null,
  };
}

export function isMessage(item: TimelineItem): item is Message {
  return item.kind === 'comment' || item.kind === 'review' || item.kind === 'review-comment' || item.kind === 'description';
}

export type TimelineBlock =
  | { kind: 'message'; key: string; message: Message }
  | { kind: 'review-line'; key: string; message: Message }
  | { kind: 'commits'; key: string; commits: TimelineCommit[] }
  | { kind: 'event'; key: string; event: TimelineEvent }
  | { kind: 'thread'; key: string; thread: ReviewThread };

/**
 * The timeline as GitHub shows it: commits in a row grouped, each review with
 * its threads under it (a review that is only its threads as one line), and
 * the threads whose review is on a page not read yet at the end, once every
 * page is read.
 */
export function timelineBlocks(items: readonly TimelineItem[], threads: readonly ReviewThread[], hasNextPage: boolean): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  const byReview = new Map<string | null, ReviewThread[]>();
  for (const thread of threads) byReview.set(thread.reviewId, [...(byReview.get(thread.reviewId) || []), thread]);
  const shown = new Set<string>();
  let commits: TimelineCommit[] = [];
  const flush = () => {
    if (commits.length) blocks.push({ kind: 'commits', key: `c:${commits[0].oid}`, commits });
    commits = [];
  };
  items.forEach((item, index) => {
    if (item.kind === 'commit') { commits.push(item); return; }
    flush();
    if (item.kind === 'event') { blocks.push({ kind: 'event', key: `e:${index}`, event: item }); return; }
    const message = item as Message;
    const own = message.kind === 'review' ? byReview.get(message.id) || [] : [];
    if (message.kind === 'review' && !message.body.trim() && own.length && message.state === 'COMMENTED') blocks.push({ kind: 'review-line', key: `m:${message.id}`, message });
    else blocks.push({ kind: 'message', key: `m:${message.id}`, message });
    for (const thread of own) { shown.add(thread.id); blocks.push({ kind: 'thread', key: `t:${thread.id}`, thread }); }
  });
  flush();
  if (!hasNextPage) for (const thread of threads) if (!shown.has(thread.id)) blocks.push({ kind: 'thread', key: `t:${thread.id}`, thread });
  return blocks;
}

/** One event of the timeline as a sentence, as the desktop words it. */
export function eventText(event: TimelineEvent): string {
  const who = event.actor || 'ghost';
  switch (event.type) {
    case 'force-pushed': return `${who} force-pushed the branch from ${event.from} to ${event.to}`;
    case 'base-changed': return `${who} changed the base branch from ${event.from} to ${event.to}`;
    case 'renamed': return `${who} changed the title from “${event.from}” to “${event.to}”`;
    case 'closed': return `${who} closed this`;
    case 'reopened': return `${who} reopened this`;
    case 'merged': return `${who} merged commit ${event.commit} into ${event.to}`;
    case 'ready': return `${who} marked this pull request as ready for review`;
    case 'draft': return `${who} marked this pull request as draft`;
    case 'review-requested': return `${who} requested a review from ${event.subject || 'someone'}`;
    case 'review-request-removed': return `${who} removed the review request for ${event.subject || 'someone'}`;
    case 'review-dismissed': return `${who} dismissed ${event.subject || 'someone'}'s review${event.message ? `: ${event.message}` : ''}`;
    case 'labeled': return `${who} added the ${event.label?.name || ''} label`;
    case 'unlabeled': return `${who} removed the ${event.label?.name || ''} label`;
    case 'assigned': return event.subject === event.actor ? `${who} self-assigned this` : `${who} assigned ${event.subject || 'someone'}`;
    case 'unassigned': return `${who} unassigned ${event.subject || 'someone'}`;
    case 'branch-deleted': return `${who} deleted the ${event.to} branch`;
    case 'branch-restored': return `${who} restored the head branch`;
    default: return who;
  }
}

const REVIEW_WORDS: Record<string, string> = {
  APPROVED: 'approved these changes', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed', DISMISSED: 'reviewed (dismissed)', PENDING: 'started a review',
};

/** "commented", "approved these changes"… */
export function messageVerb(message: Pick<Message, 'kind' | 'state'>): string {
  if (message.kind === 'description') return 'opened this';
  if (message.kind === 'review') return REVIEW_WORDS[message.state || 'COMMENTED'] || 'reviewed';
  return 'commented';
}

export type MessageAction = 'copy' | 'quote' | 'edit' | 'hide' | 'unhide' | 'web' | 'delete';

/** The "…" of a message: what GitHub lets this account do with it, as on the desktop. */
export function messageActions(message: Pick<Message, 'kind' | 'url' | 'can' | 'minimized' | 'id'>): MessageAction[] {
  const actions: MessageAction[] = [];
  if (message.url) actions.push('copy');
  actions.push('quote');
  if (message.can.update) actions.push('edit');
  if (message.can.minimize && message.id && message.kind !== 'description' && message.kind !== 'review') actions.push(message.minimized ? 'unhide' : 'hide');
  if (message.url) actions.push('web');
  if (message.can.delete && (message.kind === 'comment' || message.kind === 'review-comment')) actions.push('delete');
  return actions;
}

/** Which kind of comment a change names (comment-edit, comment-delete). */
export function commentType(message: Pick<Message, 'kind'>): 'issue' | 'review-comment' | 'review' {
  if (message.kind === 'review') return 'review';
  if (message.kind === 'review-comment') return 'review-comment';
  return 'issue';
}

/** A quote reply: every line behind "> ", then an empty line. */
export function quoteText(body: string): string {
  const lines = String(body || '').replace(/\r\n/g, '\n').trimEnd().split('\n');
  return `${lines.map((line) => (line ? `> ${line}` : '>')).join('\n')}\n\n`;
}

/** A reaction on or off in a list of reactions, as it shows before GitHub answers. */
export function toggleReaction(reactions: readonly Reaction[], content: ReactionContent): Reaction[] {
  const existing = reactions.find((r) => r.content === content);
  if (!existing) return [...reactions, { content, count: 1, mine: true }];
  if (!existing.mine) return reactions.map((r) => (r === existing ? { ...r, count: r.count + 1, mine: true } : r));
  return reactions.map((r) => (r === existing ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
}

/** The end of a review thread's diff hunk: its header and the last lines, where the comment was made. */
export function hunkTail(hunk: string, lines = 5): string {
  const all = String(hunk || '').split('\n');
  const head = all[0]?.startsWith('@@') ? [all[0]] : [];
  return [...head, ...all.slice(head.length).slice(-lines)].join('\n');
}

/** What the status box at the end of an open conversation says, and whether Update branch is there. */
export function statusRows(head: PullRequestHead): { rows: { tone: 'good' | 'bad' | 'warn' | 'muted'; text: string }[]; canUpdateBranch: boolean } {
  const rows: { tone: 'good' | 'bad' | 'warn' | 'muted'; text: string }[] = [];
  if (head.state !== 'OPEN') return { rows, canUpdateBranch: false };
  if (head.checks === 'SUCCESS') rows.push({ tone: 'good', text: 'All checks have passed' });
  else if (head.checks === 'FAILURE' || head.checks === 'ERROR') rows.push({ tone: 'bad', text: 'Some checks were not successful' });
  else if (head.checks === 'PENDING' || head.checks === 'EXPECTED') rows.push({ tone: 'warn', text: 'Some checks haven’t completed yet' });
  if (head.reviewDecision === 'APPROVED') rows.push({ tone: 'good', text: 'Changes approved' });
  else if (head.reviewDecision === 'CHANGES_REQUESTED') rows.push({ tone: 'bad', text: 'Changes requested' });
  else if (head.reviewDecision === 'REVIEW_REQUIRED') rows.push({ tone: 'warn', text: 'Review required' });
  if (head.mergeable === 'CONFLICTING') rows.push({ tone: 'bad', text: `This branch has conflicts with ${head.base} that must be resolved` });
  if (head.isDraft) rows.push({ tone: 'muted', text: 'This pull request is still a work in progress' });
  const behind = head.mergeStateStatus === 'BEHIND';
  if (behind) rows.push({ tone: 'warn', text: 'This branch is out-of-date with the base branch' });
  return { rows, canUpdateBranch: behind && head.can.updateBranch };
}

/** Commits by the day they were made, as GitHub's Commits tab lists them. */
export function commitDays(commits: readonly Commit[]): { day: string; commits: Commit[] }[] {
  const days: { day: string; commits: Commit[] }[] = [];
  for (const commit of commits) {
    const date = new Date(commit.date || '');
    const day = Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, commits: [] });
    days[days.length - 1].commits.push(commit);
  }
  return days;
}

/** "2 failing, 1 in progress, 10 successful" */
export function checksSummaryText(summary: Partial<Record<CheckBucket, number>> | undefined): string {
  const s = summary || {};
  const parts: string[] = [];
  if (s.fail) parts.push(`${s.fail} failing`);
  if (s.pending) parts.push(`${s.pending} in progress`);
  if (s.cancelled) parts.push(`${s.cancelled} cancelled`);
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  if (s.pass) parts.push(`${s.pass} successful`);
  return parts.join(', ');
}

/** Checks by workflow (or app), each group with the runs whose failed jobs can run again. */
export function checkGroups(checks: readonly Check[]): { name: string; checks: Check[]; failedRuns: number[] }[] {
  const groups: { name: string; checks: Check[]; failedRuns: number[] }[] = [];
  for (const check of checks) {
    const name = check.group || 'Other checks';
    let group = groups.find((g) => g.name === name);
    if (!group) { group = { name, checks: [], failedRuns: [] }; groups.push(group); }
    group.checks.push(check);
    if (check.actions && check.runId && check.bucket === 'fail' && !group.failedRuns.includes(check.runId)) group.failedRuns.push(check.runId);
  }
  return groups;
}

/** A finished GitHub Actions job: it has a log and can run again. */
export function checkFinishedJob(check: Check): boolean {
  return check.actions && !!check.id && check.status === 'COMPLETED';
}

/** "3m 12s", "45s", "1h 2m". */
export function checkDuration(start: string | null, end: string | null): string {
  const a = Date.parse(start || '');
  const b = Date.parse(end || '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '';
  const secs = Math.round((b - a) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * A job's log for a phone: GitHub Actions' marks read (a group's title kept,
 * its end gone), and only the last `lines`, as a long text is slow to draw.
 */
export function logLines(text: string, lines = 400): { lines: { text: string; tone: 'group' | 'error' | 'warning' | 'plain' }[]; cut: boolean } {
  const all = String(text || '').split('\n').filter((line) => !line.startsWith('##[endgroup]'));
  const shown = all.slice(-lines);
  return {
    cut: all.length > shown.length,
    lines: shown.map((line) => {
      const group = /^##\[group\](.*)$/.exec(line);
      if (group) return { text: `▸ ${group[1]}`, tone: 'group' };
      const mark = /^##\[(error|warning|notice|command|debug)\](.*)$/.exec(line);
      if (mark) return { text: mark[2], tone: mark[1] === 'error' ? 'error' : mark[1] === 'warning' ? 'warning' : 'plain' };
      return { text: line, tone: 'plain' };
    }),
  };
}

/** The branches Change base offers: the default first, never the head or the current base. */
export function baseChoices(answer: BranchesAnswer | undefined, pr: Pick<PullRequest, 'head' | 'base'>): string[] {
  const names = (answer?.branches || []).filter((name) => name !== pr.head && name !== pr.base);
  const def = answer?.defaultBranch;
  if (def && names.includes(def)) return [def, ...names.filter((n) => n !== def)];
  return names;
}

/** What a sidebar picker saves: the whole set for reviewers (team requests kept), additions and removals for the rest. */
export function sideChange(side: 'reviewers' | 'assignees' | 'labels', head: PullRequestHead, chosen: ReadonlySet<string>): EditParams | null {
  if (side === 'reviewers') {
    const before = head.reviewers.filter((r) => r.kind !== 'team').map((r) => r.login);
    const same = before.length === chosen.size && before.every((login) => chosen.has(login));
    if (same) return null;
    return { kind: 'reviewers', pullRequestId: head.id, users: [...chosen], teams: head.reviewers.filter((r) => r.kind === 'team' && r.state === 'REQUESTED').map((r) => r.login) };
  }
  const before = new Set((side === 'labels' ? head.labels : head.assignees).map((x) => x.id));
  const add = [...chosen].filter((id) => !before.has(id));
  const remove = [...before].filter((id) => !chosen.has(id));
  if (!add.length && !remove.length) return null;
  return { kind: side, pullRequestId: head.id, add, remove };
}

/** A label's colour as GitHub gives it (six hex digits), or a grey. */
export function labelColor(color: string): string {
  return /^[0-9a-f]{6}$/i.test(color || '') ? `#${color}` : '#8a8aa0';
}
