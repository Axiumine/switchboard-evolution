import { describe, expect, it } from '@jest/globals';

import {
  ACTION_COPY, badges, canEdit, DEFAULT_FILTER, emptyText, errorTitle, fileBudget, filterLabel, isDefaultFilter, menuActions, mergeBlock,
  mergeLists, mergeWarnings, noPatchText, pagedWords, pageStates, prStatus, summaryText, toggleFilter, whenText,
  type PullRequest, type PullRequestFile, type PullRequestRepo,
} from '../model';

const HEAD = 'c'.repeat(40);

function pr(number: number, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number, title: `Change ${number}`, url: '', state: 'OPEN', isDraft: false,
    createdAt: `2026-03-${String(number).padStart(2, '0')}T09:00:00Z`, closedAt: null, mergedAt: null,
    author: 'dev-one', head: `feature-${number}`, headOid: HEAD, base: 'main', crossRepository: false,
    additions: 4, deletions: 2, changedFiles: 3, mergeable: 'MERGEABLE', reviewDecision: null, checks: null,
    viewerDidAuthor: false, ...extra,
  };
}

const REPO: PullRequestRepo = { nameWithOwner: 'acme/widgets', url: '', permission: 'WRITE', canWrite: true, mergeMethods: ['merge', 'squash'], defaultMethod: 'squash', deleteBranchOnMerge: true };

describe('the list and its filter', () => {
  it('knows open, draft, closed and merged, and shows open and drafts at first', () => {
    expect(prStatus(pr(1))).toBe('open');
    expect(prStatus(pr(1, { isDraft: true }))).toBe('draft');
    expect(prStatus(pr(1, { state: 'CLOSED' }))).toBe('closed');
    expect(prStatus(pr(1, { state: 'MERGED' }))).toBe('merged');
    expect(DEFAULT_FILTER).toEqual(['open', 'draft']);
    expect(pageStates(DEFAULT_FILTER)).toEqual([]);
    expect(pageStates(['merged', 'open', 'closed'])).toEqual(['CLOSED', 'MERGED']);
  });

  it('makes one list of the open ones and the pages, newest first, as the filter shows them', () => {
    const open = [pr(3), pr(9, { isDraft: true }), pr(1)];
    const page = [pr(7, { state: 'MERGED' }), pr(5, { state: 'CLOSED' }), pr(3)];
    expect(mergeLists(open, page, ['open', 'draft', 'closed', 'merged']).map((p) => p.number)).toEqual([9, 7, 5, 3, 1]);
    expect(mergeLists(open, page, ['open']).map((p) => p.number)).toEqual([3, 1]);
    expect(mergeLists(open, page, ['merged']).map((p) => p.number)).toEqual([7]);
  });

  it('keeps at least one choice, in a fixed order, and says what it shows', () => {
    let filter = [...DEFAULT_FILTER];
    expect(filterLabel(filter)).toBe('Open, Draft');
    expect(isDefaultFilter(filter)).toBe(true);
    filter = toggleFilter(toggleFilter(filter, 'merged'), 'closed');
    expect(filter).toEqual(['open', 'draft', 'closed', 'merged']);
    expect(filterLabel(filter)).toBe('All');
    filter = toggleFilter(toggleFilter(toggleFilter(filter, 'open'), 'draft'), 'closed');
    expect(filter).toEqual(['merged']);
    expect(toggleFilter(filter, 'merged')).toEqual(['merged']);
    expect(emptyText(['open', 'draft'])).toBe('No open or draft pull requests');
    expect(pagedWords(['CLOSED', 'MERGED'])).toBe('closed and merged');
  });
});

describe('what may be done', () => {
  it('turns Merge off for drafts, conflicts, readers and closed ones, and says why', () => {
    expect(mergeBlock(pr(1), REPO)).toBeNull();
    expect(mergeBlock(pr(1, { isDraft: true }), REPO)).toMatch(/ready for review/);
    expect(mergeBlock(pr(1, { mergeable: 'CONFLICTING' }), REPO)).toMatch(/conflicts with main/);
    expect(mergeBlock(pr(1), { ...REPO, canWrite: false })).toMatch(/cannot merge/);
    expect(mergeBlock(pr(1), { ...REPO, mergeMethods: [] })).toMatch(/no merge method/);
    expect(mergeBlock(pr(1, { state: 'MERGED' }), REPO)).toMatch(/Only an open/);
  });

  it('offers Convert to draft or Ready for review, then Close, each with its question', () => {
    expect(menuActions(pr(1))).toEqual(['draft', 'close']);
    expect(menuActions(pr(1, { isDraft: true }))).toEqual(['ready', 'close']);
    expect(menuActions(pr(1, { state: 'CLOSED' }))).toEqual([]);
    expect(ACTION_COPY.close.destructive).toBe(true);
    expect(ACTION_COPY.draft.text).toMatch(/cannot be merged/);
    expect(canEdit(pr(1), { ...REPO, canWrite: false })).toBe(false);
    expect(canEdit(pr(1, { viewerDidAuthor: true }), { ...REPO, canWrite: false })).toBe(true);
  });

  it('warns before merging about checks, the review and an unknown mergeability', () => {
    expect(mergeWarnings(pr(1))).toEqual([]);
    expect(mergeWarnings(pr(1, { checks: 'FAILURE', reviewDecision: 'CHANGES_REQUESTED', mergeable: 'UNKNOWN' }))).toEqual([
      'Its checks failed.', 'A reviewer asked for changes.', 'GitHub has not worked out yet whether it can be merged.',
    ]);
  });
});

describe('rows', () => {
  it('badges an open pull request, not a merged one', () => {
    expect(badges(pr(1, { isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'APPROVED', checks: 'PENDING' })).map((b) => b.text))
      .toEqual(['Draft', 'Conflicts', 'Approved', 'Checks running']);
    expect(badges(pr(1, { state: 'MERGED', checks: 'FAILURE' }))).toEqual([]);
  });

  it('says when it was opened, merged or closed', () => {
    const when = (iso: string | null) => `at ${iso?.slice(0, 10)}`;
    expect(whenText(pr(4), when)).toBe('opened at 2026-03-04');
    expect(whenText(pr(4, { state: 'MERGED', mergedAt: '2026-04-01T00:00:00Z' }), when)).toBe('merged at 2026-04-01');
    expect(whenText(pr(4, { state: 'CLOSED', closedAt: '2026-04-02T00:00:00Z' }), when)).toBe('closed at 2026-04-02');
  });

  it('sums up the open ones and names the errors', () => {
    expect(summaryText({ ok: true, repo: REPO, items: [pr(1), pr(2, { isDraft: true })] })).toBe('acme/widgets · 1 open, 1 draft');
    expect(summaryText({ error: 'x' })).toBe('');
    expect(errorTitle('gh-auth')).toMatch(/Sign in/);
    expect(errorTitle('no-github-remote')).toBe('No GitHub remote');
    expect(errorTitle(undefined)).toMatch(/could not be read/);
  });
});

describe('files', () => {
  const file = (path: string, lines: number | null, extra: Partial<PullRequestFile> = {}): PullRequestFile => ({
    path, oldPath: null, status: 'modified', insertions: 1, deletions: 0,
    patch: lines === null ? null : Array.from({ length: lines }, () => '+x').join('\n'), ...extra,
  });

  it('opens the first files while their diffs stay within the budget', () => {
    const files = [file('a', 300), file('bin.png', null), file('b', 90), file('c', 50)];
    expect([...fileBudget(files)]).toEqual(['a', 'b']);
    expect([...fileBudget(files, 100)]).toEqual([]);
  });

  it('says why a file has no diff', () => {
    expect(noPatchText(file('x', null, { tooLarge: true }))).toMatch(/too large/);
    expect(noPatchText(file('x', null, { status: 'renamed', insertions: 0, deletions: 0 }))).toMatch(/Renamed/);
    expect(noPatchText(file('x', null))).toMatch(/binary/);
  });
});
