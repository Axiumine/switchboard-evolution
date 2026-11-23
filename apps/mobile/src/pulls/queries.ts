import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { queryClient } from '@/remote/query';
import { useConnection } from '@/store/connection';
import { ask } from '@/worktrees/queries';
import {
  DEFAULT_FILE_VIEW, PAGE_SIZE,
  type ActionAnswer, type BranchesAnswer, type CandidatesAnswer, type ChecksAnswer, type CommitFilesAnswer, type CommitsAnswer, type ConversationAnswer,
  type EditAnswer, type EditParams, type FileView, type FilesAnswer, type LogAnswer, type MarkdownAnswer, type MergeMethod, type Message, type OpenListing,
  type PageListing, type PageState, type PullRequestAction, type PullRequestHead, type ViewedAnswer,
} from './model';

// Every open pull request can take a few requests to GitHub, one per 100.
const LIST_TIMEOUT_MS = 120_000;
const FILES_TIMEOUT_MS = 75_000;
// The computer gives gh two minutes for an action.
const ACTION_TIMEOUT_MS = 150_000;
// Read again when the view comes back after this long, as the desktop does.
const STALE_MS = 60_000;

function remoteOpts(remote: string | undefined, extra: Record<string, unknown> = {}) {
  return remote ? { remote, ...extra } : { ...extra };
}

/** Every open pull request of a repository (drafts too), with its merge settings. */
export function useOpenPullRequests(projectId: string | undefined, folder: string | undefined, remote: string | undefined, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-requests', projectId, folder, remote ?? ''],
    queryFn: () => ask<OpenListing>('get-pull-requests', [projectId, folder, remoteOpts(remote)], LIST_TIMEOUT_MS),
    enabled: enabled && online && !!projectId && !!folder,
    staleTime: STALE_MS,
  });
}

/** Closed and/or merged pull requests, PAGE_SIZE at a time: fetchNextPage reads the next ones. */
export function usePagedPullRequests(projectId: string | undefined, folder: string | undefined, remote: string | undefined, states: PageState[], enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useInfiniteQuery({
    queryKey: ['pull-requests-page', projectId, folder, remote ?? '', states.join(',')],
    queryFn: async ({ pageParam }) => {
      const answer = await ask<PageListing>('get-pull-requests-page', [projectId, folder, remoteOpts(remote, { states, first: PAGE_SIZE, ...(pageParam ? { after: pageParam } : {}) })], LIST_TIMEOUT_MS);
      if (!answer.ok) throw new Error(answer.error || 'The pull requests could not be read.');
      return answer;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasNextPage && last.endCursor ? last.endCursor : undefined),
    enabled: enabled && online && !!projectId && !!folder && states.length > 0,
    staleTime: STALE_MS,
  });
}

/** A pull request's changed files with their patches; kept per head commit, which changes with every push. */
export function usePullRequestFiles(projectId: string, folder: string, remote: string | undefined, number: number, headOid: string, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-request-files', projectId, folder, remote ?? '', number, headOid],
    queryFn: () => ask<FilesAnswer>('get-pull-request-files', [projectId, folder, remoteOpts(remote, { number })], FILES_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: Infinity,
  });
}

/** Read the lists of a repository again; resolves once they are back. */
export function reloadPullRequests(projectId: string, folder: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['pull-requests', projectId, folder] }),
    queryClient.invalidateQueries({ queryKey: ['pull-requests-page', projectId, folder] }),
  ]);
}

// --- How every pull request's files are laid out, while the app runs ---

export const usePullFileView = create<{ view: FileView }>(() => ({ view: DEFAULT_FILE_VIEW }));

export function setPullFileView(view: FileView) {
  usePullFileView.setState({ view });
}

// --- What happened: the line over the list ---

export type Notice = { kind: 'busy' | 'ok' | 'error'; text: string };

export const usePullNotices = create<{ byProject: Record<string, Notice | null> }>(() => ({ byProject: {} }));

export function setPullNotice(projectId: string, notice: Notice | null) {
  usePullNotices.setState((state) => ({ byProject: { ...state.byProject, [projectId]: notice } }));
}

export function usePullNotice(projectId: string): Notice | null {
  return usePullNotices((s) => s.byProject[projectId] ?? null);
}

export type ActionParams = { number: number; action: PullRequestAction; method?: MergeMethod; deleteBranch?: boolean; headOid?: string };

/**
 * Merge, convert to draft, mark ready or close, then read the lists again.
 * Resolves the answer: { ok, message } or { error }.
 */
export async function runPullRequestAction(projectId: string, folder: string, remote: string | undefined, params: ActionParams): Promise<ActionAnswer> {
  const clean: Record<string, unknown> = { number: params.number, action: params.action };
  if (params.action === 'merge') {
    clean.method = params.method;
    clean.deleteBranch = !!params.deleteBranch;
    if (params.headOid && /^[0-9a-f]{40}$/.test(params.headOid)) clean.headOid = params.headOid;
  }
  const answer = await ask<ActionAnswer>('run-pull-request-action', [projectId, folder, remoteOpts(remote, clean)], ACTION_TIMEOUT_MS);
  // Refused or done, the list may be behind GitHub: read it again either way.
  reloadPullRequests(projectId, folder).catch(() => {});
  return answer;
}

// --- An open pull request's tabs (pull-request-detail.js on the computer) ---

const DETAIL_TIMEOUT_MS = 75_000;
// While a check runs, the Checks tab reads them again this often, as the desktop does.
const CHECKS_POLL_MS = 15_000;

/** Where a pull request is: the project, the folder of its repository, the remote chosen there. */
export type PullRef = { projectId: string; folder: string; remote: string | undefined; number: number };

function detailKey(name: string, ref: PullRef, ...rest: unknown[]) {
  return [name, ref.projectId, ref.folder, ref.remote ?? '', ref.number, ...rest];
}

/** The conversation, a page of its timeline at a time: the first page brings the pull request and its review threads. */
export function useConversation(ref: PullRef, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useInfiniteQuery({
    queryKey: detailKey('pull-request-conversation', ref),
    queryFn: async ({ pageParam }) => {
      const answer = await ask<ConversationAnswer>('get-pull-request-conversation', [ref.projectId, ref.folder, remoteOpts(ref.remote, { number: ref.number, ...(pageParam ? { after: pageParam } : {}) })], DETAIL_TIMEOUT_MS);
      if (!answer.ok) throw new Error(answer.error || 'The conversation could not be read.');
      return answer;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.timeline?.hasNextPage && last.timeline.endCursor ? last.timeline.endCursor : undefined),
    enabled: enabled && online,
    staleTime: STALE_MS,
  });
}

export function useCommits(ref: PullRef, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: detailKey('pull-request-commits', ref),
    queryFn: () => ask<CommitsAnswer>('get-pull-request-commits', [ref.projectId, ref.folder, remoteOpts(ref.remote, { number: ref.number })], DETAIL_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: STALE_MS,
  });
}

/** A commit's files with their patches: a commit never changes, so they are kept. */
export function useCommitFiles(ref: PullRef, sha: string, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-request-commit-files', ref.projectId, ref.folder, ref.remote ?? '', sha],
    queryFn: () => ask<CommitFilesAnswer>('get-pull-request-commit-files', [ref.projectId, ref.folder, remoteOpts(ref.remote, { sha })], FILES_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: Infinity,
  });
}

/** The last commit's checks; read again every 15 seconds while one of them runs. */
export function useChecks(ref: PullRef, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: detailKey('pull-request-checks', ref),
    queryFn: () => ask<ChecksAnswer>('get-pull-request-checks', [ref.projectId, ref.folder, remoteOpts(ref.remote, { number: ref.number })], DETAIL_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: STALE_MS,
    refetchInterval: (query) => (query.state.data?.checks?.some((check) => check.bucket === 'pending') ? CHECKS_POLL_MS : false),
  });
}

export function useJobLog(ref: PullRef, jobId: number | null, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-request-job-log', ref.projectId, ref.folder, ref.remote ?? '', jobId],
    queryFn: () => ask<LogAnswer>('get-pull-request-job-log', [ref.projectId, ref.folder, remoteOpts(ref.remote, { jobId })], DETAIL_TIMEOUT_MS),
    enabled: enabled && online && !!jobId,
    staleTime: STALE_MS,
  });
}

export function useViewed(ref: PullRef, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: detailKey('pull-request-viewed', ref),
    queryFn: () => ask<ViewedAnswer>('get-pull-request-viewed', [ref.projectId, ref.folder, remoteOpts(ref.remote, { number: ref.number })], DETAIL_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: STALE_MS,
  });
}

/** The repository's branches matching `query`, for Change base. */
export function useBranches(ref: Omit<PullRef, 'number'>, query: string, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-request-branches', ref.projectId, ref.folder, ref.remote ?? '', query],
    queryFn: () => ask<BranchesAnswer>('get-pull-request-branches', [ref.projectId, ref.folder, remoteOpts(ref.remote, query ? { query } : {})], DETAIL_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: STALE_MS,
  });
}

/** The labels, or the people who may be assigned or asked to review, matching `query`. */
export function useCandidates(ref: Omit<PullRef, 'number'>, kind: 'labels' | 'users', query: string, enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  return useQuery({
    queryKey: ['pull-request-candidates', ref.projectId, ref.folder, ref.remote ?? '', kind, query],
    queryFn: () => ask<CandidatesAnswer>('get-pull-request-candidates', [ref.projectId, ref.folder, remoteOpts(ref.remote, { kind, ...(query ? { query } : {}) })], DETAIL_TIMEOUT_MS),
    enabled: enabled && online,
    staleTime: STALE_MS,
  });
}

/** GitHub's rendering of a text, for an editor's Preview (the phone shows the Markdown itself; this checks it reaches GitHub as meant). */
export function renderMarkdown(ref: Omit<PullRef, 'number'>, text: string): Promise<MarkdownAnswer> {
  return ask<MarkdownAnswer>('render-pull-request-markdown', [ref.projectId, ref.folder, remoteOpts(ref.remote, { text })], DETAIL_TIMEOUT_MS);
}

/** What each change reads again once done: the tabs it touched, and the list for what shows on a row. */
function touched(kind: EditParams['kind']): { tabs: string[]; list: boolean } {
  switch (kind) {
    case 'title': case 'base': return { tabs: ['pull-request-conversation', 'pull-request-commits', 'pull-request-checks'], list: true };
    case 'update-branch': return { tabs: ['pull-request-conversation', 'pull-request-commits', 'pull-request-checks'], list: true };
    case 'viewed': case 'unviewed': return { tabs: ['pull-request-viewed'], list: false };
    case 'rerun': case 'rerun-job': return { tabs: ['pull-request-checks'], list: false };
    case 'review': case 'reviewers': case 'labels': return { tabs: ['pull-request-conversation'], list: true };
    default: return { tabs: ['pull-request-conversation'], list: kind === 'comment' };
  }
}

/** One change to a pull request on GitHub (edit-pull-request), then what it touched read again. Resolves { ok, message } or { error }. */
export async function editPullRequest(ref: PullRef, params: EditParams): Promise<EditAnswer> {
  const answer = await ask<EditAnswer>('edit-pull-request', [ref.projectId, ref.folder, remoteOpts(ref.remote, params as Record<string, unknown>)], ACTION_TIMEOUT_MS);
  const { tabs, list } = touched(params.kind);
  if (answer.ok || params.kind === 'base' || params.kind === 'update-branch') {
    for (const name of tabs) queryClient.invalidateQueries({ queryKey: [name, ref.projectId, ref.folder, ref.remote ?? '', ref.number] }).catch(() => {});
    if (list) reloadPullRequests(ref.projectId, ref.folder).catch(() => {});
  }
  return answer;
}

/** Read every tab of a pull request again (pull to refresh). */
export function reloadPullRequestDetail(ref: PullRef): Promise<unknown> {
  return Promise.all(['pull-request-conversation', 'pull-request-commits', 'pull-request-checks', 'pull-request-viewed']
    .map((name) => queryClient.invalidateQueries({ queryKey: [name, ref.projectId, ref.folder, ref.remote ?? '', ref.number] })));
}

// --- A text being written on another screen (an edit, a reply, a comment) ---

/** The text an editor screen starts from, handed over before it opens (too long for a route's params). */
export const usePullDraft = create<{ drafts: Record<string, string> }>(() => ({ drafts: {} }));

export function setPullDraft(key: string, text: string | null) {
  usePullDraft.setState((state) => {
    const drafts = { ...state.drafts };
    if (text === null) delete drafts[key]; else drafts[key] = text;
    return { drafts };
  });
}

// --- Shown at once, before GitHub answers ---

type ConversationPages = { pages: ConversationAnswer[]; pageParams: unknown[] };

/** Change one message (the description, a comment, a review, a review comment) where the conversation keeps it. */
export function patchConversationMessage(ref: PullRef, id: string, change: (message: Message | PullRequestHead) => Message | PullRequestHead) {
  queryClient.setQueryData<ConversationPages>(detailKey('pull-request-conversation', ref), (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        pr: page.pr && page.pr.id === id ? (change(page.pr) as PullRequestHead) : page.pr,
        timeline: page.timeline && {
          ...page.timeline,
          items: page.timeline.items.map((item) => (item.kind !== 'commit' && item.kind !== 'event' && item.id === id ? (change(item) as Message) : item)),
        },
        threads: page.threads?.map((thread) => ({ ...thread, comments: thread.comments.map((c) => (c.id === id ? (change(c) as Message) : c)) })),
      })),
    };
  });
}

/** Mark a file viewed or not where the Files tab keeps it. */
export function setViewedState(ref: PullRef, path: string, viewed: boolean) {
  queryClient.setQueryData<ViewedAnswer>(detailKey('pull-request-viewed', ref), (data) => {
    const map = { ...(data?.viewed || {}) };
    if (viewed) map[path] = 'VIEWED'; else delete map[path];
    return { ...(data || { ok: true }), viewed: map };
  });
}

/** Read one tab of a pull request again (after a change shown at once was refused). */
export function reloadPullRequestTab(ref: PullRef, name: 'pull-request-conversation' | 'pull-request-viewed' | 'pull-request-checks') {
  return queryClient.invalidateQueries({ queryKey: detailKey(name, ref) });
}
