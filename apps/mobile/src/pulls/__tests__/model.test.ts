import { describe, expect, it } from '@jest/globals';

import {
  ACTION_COPY, badges, canEdit, DEFAULT_FILE_VIEW, DEFAULT_FILTER, emptyText, errorTitle, FILE_TOOLS, fileRows, filterLabel, isDefaultFilter, menuActions, mergeBlock,
  mergeLists, mergeRepoPullRequests, mergeWarnings, morePages, summaryTextMany, noPatchText, pagedWords, pageStates, prStatus, summaryText, toggleFilter, webUrl, whenText, inAppWebUrl,
  baseChoices, checkDuration, checkFinishedJob, checkGroups, checksSummaryText, commentType, commitDays, detailCounts, eventText, hunkTail, labelColor,
  logLines, messageActions, messageVerb, quoteText, reviewChoices, reviewProblem, rowMenu, sideChange, statusRows, timelineBlocks, titleProblem, toggleReaction,
  type Check, type Message, type PullRequest, type PullRequestFile, type PullRequestHead, type PullRequestRepo, type ReviewThread, type TimelineItem,
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

describe('the pull requests of several repositories', () => {
  const day = (n: number, extra: Partial<PullRequest> = {}) => pr(n, { createdAt: `2026-03-${String(n).padStart(2, '0')}T09:00:00Z`, ...extra });
  const all = ['open', 'draft', 'closed', 'merged'] as const;
  const keys = (merged: ReturnType<typeof mergeRepoPullRequests>) => merged.items.map((e) => `${e.key}#${e.pr.number}`);

  it('is mergeLists for one repository', () => {
    const open = [pr(3), pr(9, { isDraft: true }), pr(1)];
    const page = [pr(7, { state: 'MERGED' }), pr(5, { state: 'CLOSED' }), pr(3)];
    const merged = mergeRepoPullRequests([{ key: 'app', open, pages: page, hasMore: true }], all);
    expect(merged.items.map((e) => e.pr.number)).toEqual(mergeLists(open, page, all).map((p) => p.number));
    expect(merged.pageShown).toBe(2);
  });

  it('lists every open one of every repository, newest first, ties by repository then number', () => {
    const merged = mergeRepoPullRequests([
      { key: 'app', open: [day(4), day(2)], pages: [], hasMore: false },
      { key: 'lib', open: [day(3), day(2, { number: 12 })], pages: [], hasMore: false },
    ], all);
    // lib's #12 is made the same moment as app's #2: the first repository goes first.
    expect(keys(merged)).toEqual(['app#4', 'lib#3', 'app#2', 'lib#12']);
  });

  it('keeps the same number of two repositories apart', () => {
    const merged = mergeRepoPullRequests([
      { key: 'app', open: [day(5)], pages: [], hasMore: false },
      { key: 'lib', open: [day(5, { title: 'Other' })], pages: [], hasMore: false },
    ], all);
    expect(keys(merged)).toEqual(['app#5', 'lib#5']);
    expect(merged.items[1].pr.title).toBe('Other');
  });

  it('stops the closed and merged pages where a repository with more pages runs out', () => {
    // The app's page ends at March 6 and GitHub has older ones: the lib's March 4 and 2 could come after one of them.
    const repos = [
      { key: 'app', open: [], pages: [day(8, { state: 'MERGED' }), day(6, { state: 'CLOSED' })], hasMore: true },
      { key: 'lib', open: [], pages: [day(7, { state: 'MERGED' }), day(4, { state: 'MERGED' }), day(2, { state: 'CLOSED' })], hasMore: false },
    ];
    const merged = mergeRepoPullRequests(repos, all);
    expect(keys(merged)).toEqual(['app#8', 'lib#7', 'app#6']);
    expect(merged.held).toEqual({ app: 0, lib: 2 });
    expect(merged.pageShown).toBe(3);
    // The next page is asked of the app, the one that stopped it.
    expect(morePages(repos, merged)).toEqual(['app']);
  });

  it('shows open ones even where a repository has more pages to load', () => {
    const merged = mergeRepoPullRequests([
      { key: 'app', open: [day(9)], pages: [], hasMore: true },
      { key: 'lib', open: [day(8)], pages: [day(3, { state: 'MERGED' })], hasMore: false },
    ], all);
    expect(keys(merged)).toEqual(['app#9', 'lib#8']);
  });

  it('asks every repository with more pages that holds fewer than a page', () => {
    const repos = [
      { key: 'app', open: [], pages: [day(8, { state: 'MERGED' })], hasMore: true },
      { key: 'lib', open: [], pages: [day(7, { state: 'MERGED' })], hasMore: true },
      { key: 'docs', open: [], pages: [], hasMore: false },
    ];
    expect(morePages(repos, mergeRepoPullRequests(repos, all))).toEqual(['app', 'lib']);
  });

  it('applies the filter, and an open one hides its number in a page', () => {
    const merged = mergeRepoPullRequests([
      { key: 'app', open: [day(3), day(2, { isDraft: true })], pages: [day(3, { state: 'CLOSED' }), day(1, { state: 'CLOSED' })], hasMore: false },
    ], ['open']);
    expect(keys(merged)).toEqual(['app#3']);
  });

  it('says how many repositories and pull requests there are', () => {
    const listing = (items: PullRequest[]) => ({ ok: true, repo: REPO, items });
    expect(summaryTextMany([listing([pr(1), pr(2, { isDraft: true })])])).toBe('acme/widgets · 1 open, 1 draft');
    expect(summaryTextMany([listing([pr(1), pr(2)]), listing([pr(3, { isDraft: true })]), { ok: false }])).toBe('2 repositories · 2 open, 1 draft');
    expect(summaryTextMany([{ ok: false }, undefined])).toBe('');
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

  it('offers Convert to draft or Ready for review, then Close, each with its question; Reopen on a closed one', () => {
    expect(menuActions(pr(1))).toEqual(['draft', 'close']);
    expect(menuActions(pr(1, { isDraft: true }))).toEqual(['ready', 'close']);
    expect(menuActions(pr(1, { state: 'CLOSED' }))).toEqual(['reopen']);
    expect(menuActions(pr(1, { state: 'MERGED' }))).toEqual([]);
    expect(rowMenu(pr(1), { canChangeBase: true })).toEqual(['draft', 'base', 'close']);
    expect(rowMenu(pr(1), { canChangeBase: false })).toEqual(['draft', 'close']);
    expect(rowMenu(pr(1, { state: 'CLOSED' }), { canChangeBase: true })).toEqual(['reopen']);
    expect(ACTION_COPY.reopen.confirm).toBe('Reopen pull request');
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

  it('opens on GitHub only from a web address', () => {
    expect(webUrl(pr(4, { url: 'https://github.com/acme/widgets/pull/4' }))).toBe('https://github.com/acme/widgets/pull/4');
    expect(webUrl(pr(4))).toBeNull();
    expect(webUrl(pr(4, { url: 'javascript:alert(1)' }))).toBeNull();
  });

  it('shows its page inside the app only over https, as the desktop', () => {
    expect(inAppWebUrl('https://github.com/acme/widgets/pull/4')).toBe('https://github.com/acme/widgets/pull/4');
    expect(inAppWebUrl('https://git.example.com/acme/widgets/pull/4/files#diff-1')).toBe('https://git.example.com/acme/widgets/pull/4/files#diff-1');
    for (const url of ['http://github.com/acme/widgets/pull/4', 'javascript:alert(1)', 'file:///etc/hosts', 'https://', 'https:// github.com', '', undefined, 42, `https://github.com/${'a'.repeat(2048)}`]) {
      expect(inAppWebUrl(url)).toBeNull();
    }
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

  it('shows them as a tree at first, folders first and a chain of single folders on one row', () => {
    expect(DEFAULT_FILE_VIEW).toBe('tree');
    const files = [file('README.md', 1), file('apps/web/src/b.js', 1), file('apps/web/src/a.js', 1), file('apps/api/x.js', 1)];
    const show = (rows: ReturnType<typeof fileRows>) => rows.map((row) => (row.kind === 'folder'
      ? `${'  '.repeat(row.depth)}${row.name}/ (${row.count})${row.collapsed ? ' closed' : ''}`
      : `${'  '.repeat(row.depth)}${row.item.path}`));
    expect(show(fileRows(files, 'tree'))).toEqual([
      'apps/ (3)', '  api/ (1)', '    apps/api/x.js', '  web / src/ (2)', '    apps/web/src/a.js', '    apps/web/src/b.js', 'README.md',
    ]);
    expect(show(fileRows(files, 'tree', new Set(['apps/web/src'])))).toEqual(['apps/ (3)', '  api/ (1)', '    apps/api/x.js', '  web / src/ (2) closed', 'README.md']);
  });

  it('as a list, keeps GitHub\'s order, every file at the top level', () => {
    const files = [file('b/two.js', 1), file('a/one.js', 1)];
    expect(fileRows(files, 'list').map((row) => [row.kind, row.depth, row.name])).toEqual([['file', 0, 'two.js'], ['file', 0, 'one.js']]);
  });

  it('names its four tools for their long press', () => {
    expect(Object.values(FILE_TOOLS)).toEqual(['Expand all', 'Collapse all', 'View as tree', 'View as list']);
  });

  it('says why a file has no diff', () => {
    expect(noPatchText(file('x', null, { tooLarge: true }))).toMatch(/too large/);
    expect(noPatchText(file('x', null, { status: 'renamed', insertions: 0, deletions: 0 }))).toMatch(/Renamed/);
    expect(noPatchText(file('x', null))).toMatch(/binary/);
  });
});

// --- An open pull request ---

function message(extra: Partial<Message> = {}): Message {
  return {
    kind: 'comment', id: 'IC_1', url: 'https://github.com/acme/widgets/pull/7#issuecomment-1', author: 'dev-two', avatar: null, association: 'MEMBER',
    body: 'Looks good', bodyHtml: '<p>Looks good</p>', createdAt: '2026-03-02T09:00:00Z', editedAt: null, mine: true,
    can: { update: true, delete: true, minimize: false, react: true }, minimized: null, reactions: [], ...extra,
  };
}

function head(extra: Partial<PullRequestHead> = {}): PullRequestHead {
  return {
    id: 'PR_7', number: 7, title: 'Add widgets', url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN', isDraft: false, body: '', bodyHtml: '',
    author: 'dev-one', avatar: null, association: 'OWNER', createdAt: null, editedAt: null, mine: true,
    can: { update: true, react: true, close: true, reopen: false, updateBranch: true, label: true, assign: true },
    mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', reviewDecision: null, head: 'feature', headOid: HEAD, base: 'main', crossRepository: false,
    checks: null, comments: 4, commitCount: 2, reactions: [], reviewers: [], assignees: [], labels: [], pendingReviewId: null, ...extra,
  };
}

function thread(id: string, reviewId: string | null): ReviewThread {
  return { id, path: 'src/a.ts', line: 3, resolved: false, outdated: false, resolvedBy: null, can: { resolve: true, unresolve: false, reply: true }, reviewId, diffHunk: '', comments: [] };
}

describe('an open pull request', () => {
  it('counts its tabs from the conversation once read, the checks once read, the files from the list', () => {
    expect(detailCounts({ changedFiles: 3 }, undefined, undefined, undefined)).toEqual({ conversation: null, commits: null, checks: null, files: 3 });
    expect(detailCounts({ changedFiles: 3 }, head(), undefined, { ok: true, checks: [] })).toEqual({ conversation: 4, commits: 2, checks: 0, files: 3 });
    expect(detailCounts({ changedFiles: 3 }, head(), { ok: true, totalCount: 9, commits: [] }, undefined).commits).toBe(9);
  });

  it('lays the timeline out as GitHub: commits grouped, each review with its threads, unread reviews\' threads last', () => {
    const commit = (n: number): TimelineItem => ({ kind: 'commit', oid: String(n).repeat(40), short: String(n).repeat(7), headline: `Step ${n}`, author: 'dev-one', createdAt: null, checks: null, url: '' });
    const items: TimelineItem[] = [
      commit(1), commit(2),
      message({ kind: 'review', id: 'PRR_1', state: 'COMMENTED', body: '' }),
      { kind: 'event', type: 'closed', actor: 'dev-one', createdAt: null },
      message({ kind: 'review', id: 'PRR_2', state: 'APPROVED', body: 'Nice' }),
    ];
    const threads = [thread('T1', 'PRR_1'), thread('T2', 'PRR_9')];
    expect(timelineBlocks(items, threads, true).map((b) => b.kind)).toEqual(['commits', 'review-line', 'thread', 'event', 'message']);
    expect(timelineBlocks(items, threads, false).map((b) => b.key).slice(-1)).toEqual(['t:T2']);
  });

  it('words events and messages as the desktop does', () => {
    expect(eventText({ kind: 'event', type: 'base-changed', actor: 'dev-one', createdAt: null, from: 'develop', to: 'main' })).toBe('dev-one changed the base branch from develop to main');
    expect(eventText({ kind: 'event', type: 'assigned', actor: 'dev-one', createdAt: null, subject: 'dev-one' })).toBe('dev-one self-assigned this');
    expect(eventText({ kind: 'event', type: 'labeled', actor: 'bot', createdAt: null, label: { name: 'bug', color: 'd73a4a' } })).toBe('bot added the bug label');
    expect(messageVerb({ kind: 'review', state: 'CHANGES_REQUESTED' })).toBe('requested changes');
    expect(messageVerb({ kind: 'description' })).toBe('opened this');
  });

  it('offers on a message what GitHub lets this account do with it', () => {
    expect(messageActions(message())).toEqual(['copy', 'quote', 'edit', 'web', 'delete']);
    expect(messageActions(message({ can: { update: false, delete: false, minimize: true, react: true } }))).toEqual(['copy', 'quote', 'hide', 'web']);
    expect(messageActions(message({ minimized: 'spam', can: { update: false, delete: false, minimize: true, react: true } }))).toEqual(['copy', 'quote', 'unhide', 'web']);
    expect(messageActions(message({ kind: 'review', id: 'PRR_1' }))).toEqual(['copy', 'quote', 'edit', 'web']);
    expect(commentType(message({ kind: 'review-comment' }))).toBe('review-comment');
    expect(commentType(message())).toBe('issue');
    expect(quoteText('a\n\nb')).toBe('> a\n>\n> b\n\n');
  });

  it('turns a reaction on and off before GitHub answers', () => {
    expect(toggleReaction([], 'HEART')).toEqual([{ content: 'HEART', count: 1, mine: true }]);
    expect(toggleReaction([{ content: 'HEART', count: 2, mine: false }], 'HEART')).toEqual([{ content: 'HEART', count: 3, mine: true }]);
    expect(toggleReaction([{ content: 'HEART', count: 1, mine: true }], 'HEART')).toEqual([]);
  });

  it('checks a title and a review before they go', () => {
    expect(titleProblem('  ')).toMatch(/empty/);
    expect(titleProblem('a\nb')).toMatch(/one line/);
    expect(titleProblem('x'.repeat(257))).toMatch(/256/);
    expect(titleProblem('Fine')).toBeNull();
    expect(reviewChoices(true).map((c) => [c.key, c.disabled])).toEqual([['COMMENT', false], ['APPROVE', true], ['REQUEST_CHANGES', true]]);
    expect(reviewProblem('APPROVE', '', false)).toBeNull();
    expect(reviewProblem('COMMENT', ' ', false)).toMatch(/Write/);
    expect(reviewProblem('APPROVE', 'ok', true)).toMatch(/own pull request/);
  });

  it('says what the box at the end shows, Update branch only when behind and allowed', () => {
    const behind = statusRows(head({ checks: 'SUCCESS', reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BEHIND' }));
    expect(behind.rows.map((r) => r.text)).toEqual(['All checks have passed', 'Review required', 'This branch is out-of-date with the base branch']);
    expect(behind.canUpdateBranch).toBe(true);
    expect(statusRows(head({ mergeStateStatus: 'BEHIND', can: { ...head().can, updateBranch: false } })).canUpdateBranch).toBe(false);
    expect(statusRows(head({ state: 'MERGED' })).rows).toEqual([]);
  });

  it('keeps the end of a hunk, groups commits by day', () => {
    expect(hunkTail('@@ -1,9 +1,9 @@\n1\n2\n3\n4\n5\n6\n7', 3)).toBe('@@ -1,9 +1,9 @@\n5\n6\n7');
    const days = commitDays([
      { oid: 'a', short: 'a', headline: '', body: '', date: '2026-03-02T10:00:00Z', author: '', avatar: null, url: '', checks: null },
      { oid: 'b', short: 'b', headline: '', body: '', date: '2026-03-02T11:00:00Z', author: '', avatar: null, url: '', checks: null },
      { oid: 'c', short: 'c', headline: '', body: '', date: '2026-03-04T10:00:00Z', author: '', avatar: null, url: '', checks: null },
    ]);
    expect(days.map((d) => [d.day, d.commits.length])).toEqual([['2 Mar 2026', 2], ['4 Mar 2026', 1]]);
  });

  it('sorts checks by workflow, with the failed runs to start again and the finished jobs with a log', () => {
    const check = (extra: Partial<Check>): Check => ({ kind: 'run', id: 1, name: 'test', title: '', group: 'CI', app: '', runId: 5, event: '', status: 'COMPLETED', conclusion: 'FAILURE', bucket: 'fail', startedAt: '2026-03-02T10:00:00Z', completedAt: '2026-03-02T10:01:05Z', url: '', required: false, actions: true, ...extra });
    const groups = checkGroups([check({}), check({ id: 2, bucket: 'pass' }), check({ kind: 'status', id: null, group: '', runId: null, actions: false, bucket: 'pass' })]);
    expect(groups.map((g) => [g.name, g.checks.length, g.failedRuns])).toEqual([['CI', 2, [5]], ['Other checks', 1, []]]);
    expect(checkFinishedJob(check({}))).toBe(true);
    expect(checkFinishedJob(check({ status: 'IN_PROGRESS' }))).toBe(false);
    expect(checkDuration('2026-03-02T10:00:00Z', '2026-03-02T10:01:05Z')).toBe('1m 5s');
    expect(checksSummaryText({ fail: 1, pass: 2, pending: 0, skipped: 3, cancelled: 0 })).toBe('1 failing, 3 skipped, 2 successful');
  });

  it('shows the end of a log with GitHub Actions\' marks read', () => {
    const shown = logLines('##[group]Run\nok\n##[endgroup]\n##[error]boom', 2);
    expect(shown.cut).toBe(true);
    expect(shown.lines).toEqual([{ text: 'ok', tone: 'plain' }, { text: 'boom', tone: 'error' }]);
    expect(logLines('##[group]Run').lines).toEqual([{ text: '▸ Run', tone: 'group' }]);
  });

  it('offers branches for Change base and works out what a sidebar picker saves', () => {
    expect(baseChoices({ ok: true, branches: ['develop', 'feature', 'main', 'release'], defaultBranch: 'release' }, { head: 'feature', base: 'main' })).toEqual(['release', 'develop']);
    const h = head({
      reviewers: [{ kind: 'user', login: 'dev-two', name: 'dev-two', state: 'APPROVED' }, { kind: 'team', login: 'core', name: 'Core', state: 'REQUESTED' }],
      labels: [{ id: 'L_1', name: 'bug', color: 'd73a4a', description: '' }],
    });
    expect(sideChange('reviewers', h, new Set(['dev-two']))).toBeNull();
    expect(sideChange('reviewers', h, new Set(['dev-two', 'dev-three']))).toEqual({ kind: 'reviewers', pullRequestId: 'PR_7', users: ['dev-two', 'dev-three'], teams: ['core'] });
    expect(sideChange('labels', h, new Set(['L_2']))).toEqual({ kind: 'labels', pullRequestId: 'PR_7', add: ['L_2'], remove: ['L_1'] });
    expect(sideChange('labels', h, new Set(['L_1']))).toBeNull();
    expect(labelColor('d73a4a')).toBe('#d73a4a');
    expect(labelColor('nope')).toBe('#8a8aa0');
  });
});
