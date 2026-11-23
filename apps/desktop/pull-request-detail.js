// pull-request-detail.js — what an open pull request shows in the Pull Requests
// view, as GitHub's own page does: its conversation (the description, the
// comments, the reviews and their threads, the events), its commits and their
// files, its checks and the log of a job, the files marked as viewed, and what
// the editors need (the branches for Change base, labels and people for the
// sidebar, a Markdown preview).
//
// Everything goes through pull-requests.js: the same gh, the same choice of
// remote, the same error words. Reads are GraphQL, the query and its variables
// as JSON on stdin; the REST calls (a commit's files, a job's log, the preview)
// put only validated numbers and hashes in their path, and the preview's text
// goes on stdin.

const pr = require('./pull-requests');

const TIMELINE_PAGE = 100;
const MAX_COMMIT_PAGES = 3; // GitHub lists at most 250 commits of a pull request
const MAX_CHECK_PAGES = 5;
const MAX_VIEWED_PAGES = 30; // 3000 files, as many as GitHub lists
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_MARKDOWN = 65536; // GitHub's own limit for a body
const MAX_QUERY = 200;

const TIMELINE_TYPES = [
  'ISSUE_COMMENT', 'PULL_REQUEST_REVIEW', 'PULL_REQUEST_COMMIT',
  'HEAD_REF_FORCE_PUSHED_EVENT', 'BASE_REF_CHANGED_EVENT', 'RENAMED_TITLE_EVENT',
  'CLOSED_EVENT', 'REOPENED_EVENT', 'MERGED_EVENT', 'READY_FOR_REVIEW_EVENT', 'CONVERT_TO_DRAFT_EVENT',
  'REVIEW_REQUESTED_EVENT', 'REVIEW_REQUEST_REMOVED_EVENT', 'REVIEW_DISMISSED_EVENT',
  'LABELED_EVENT', 'UNLABELED_EVENT', 'ASSIGNED_EVENT', 'UNASSIGNED_EVENT',
  'HEAD_REF_DELETED_EVENT', 'HEAD_REF_RESTORED_EVENT',
];

// --- Queries ---

const REACTIONS = 'reactionGroups { content viewerHasReacted reactors { totalCount } }';
const MESSAGE = `id url body bodyHTML createdAt lastEditedAt authorAssociation
          author { login avatarUrl }
          viewerCanUpdate viewerCanDelete viewerCanReact viewerDidAuthor
          ${REACTIONS}`;
const REVIEWER = '__typename ... on User { login avatarUrl } ... on Team { name slug } ... on Bot { login } ... on Mannequin { login }';
const ASSIGNEE = '... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Organization { login }';

const CONVERSATION_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String, $full: Boolean!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      ...Head @include(if: $full)
      timelineItems(first: ${TIMELINE_PAGE}, after: $after, itemTypes: [${TIMELINE_TYPES.join(', ')}]) {
        filteredCount
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on IssueComment { ${MESSAGE} viewerCanMinimize isMinimized minimizedReason }
          ... on PullRequestReview { ${MESSAGE} state submittedAt }
          ... on PullRequestCommit { url commit { oid abbreviatedOid messageHeadline committedDate author { name user { login } } statusCheckRollup { state } } }
          ... on HeadRefForcePushedEvent { createdAt actor { login } beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } }
          ... on BaseRefChangedEvent { createdAt actor { login } previousRefName currentRefName }
          ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
          ... on ClosedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
          ... on MergedEvent { createdAt actor { login } mergeRefName mergeCommit: commit { abbreviatedOid } }
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on ConvertToDraftEvent { createdAt actor { login } }
          ... on ReviewRequestedEvent { createdAt actor { login } requestedReviewer { ${REVIEWER} } }
          ... on ReviewRequestRemovedEvent { createdAt actor { login } requestedReviewer { ${REVIEWER} } }
          ... on ReviewDismissedEvent { createdAt actor { login } dismissalMessage review { author { login } } }
          ... on LabeledEvent { createdAt actor { login } label { name color } }
          ... on UnlabeledEvent { createdAt actor { login } label { name color } }
          ... on AssignedEvent { createdAt actor { login } assignee { ${ASSIGNEE} } }
          ... on UnassignedEvent { createdAt actor { login } assignee { ${ASSIGNEE} } }
          ... on HeadRefDeletedEvent { createdAt actor { login } headRefName }
          ... on HeadRefRestoredEvent { createdAt actor { login } }
        }
      }
      reviewThreads(first: 100) @include(if: $full) {
        nodes {
          id isResolved isOutdated path line originalLine
          resolvedBy { login }
          viewerCanResolve viewerCanUnresolve viewerCanReply
          comments(first: 100) {
            nodes {
              ${MESSAGE} viewerCanMinimize isMinimized minimizedReason
              diffHunk outdated replyTo { id } pullRequestReview { id }
            }
          }
        }
      }
    }
  }
}

fragment Head on PullRequest {
  number title url state isDraft body bodyHTML createdAt lastEditedAt authorAssociation
  author { login avatarUrl }
  viewerCanUpdate viewerCanReact viewerCanClose viewerCanReopen viewerCanUpdateBranch viewerCanLabel viewerCanAssign viewerDidAuthor
  mergeStateStatus mergeable reviewDecision headRefName headRefOid baseRefName isCrossRepository
  totalCommentsCount allCommits: commits { totalCount }
  ${REACTIONS}
  reviewRequests(first: 50) { nodes { requestedReviewer { ${REVIEWER} } } }
  latestReviews(first: 50) { nodes { state submittedAt author { login avatarUrl } } }
  assignees(first: 50) { nodes { id login avatarUrl } }
  labels(first: 50) { nodes { id name color description } }
  pendingReviews: reviews(states: [PENDING], first: 1) { nodes { id } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

const COMMITS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          commit {
            oid abbreviatedOid messageHeadline messageBody committedDate url
            author { name user { login avatarUrl } }
            statusCheckRollup { state }
          }
        }
      }
    }
  }
}`;

const CHECKS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefOid
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 100, after: $after) {
                totalCount
                pageInfo { hasNextPage endCursor }
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId name status conclusion startedAt completedAt detailsUrl title
                    isRequired(pullRequestNumber: $number)
                    checkSuite { app { name } workflowRun { databaseId event url workflow { name } } }
                  }
                  ... on StatusContext {
                    context state description targetUrl createdAt
                    isRequired(pullRequestNumber: $number)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const VIEWED_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path viewerViewedState }
      }
    }
  }
}`;

const BRANCHES_QUERY = `query($owner: String!, $repo: String!, $query: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: 100, query: $query, orderBy: { field: ALPHABETICAL, direction: ASC }) {
      totalCount
      nodes { name }
    }
  }
}`;

const LABELS_QUERY = `query($owner: String!, $repo: String!, $query: String) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100, query: $query, orderBy: { field: NAME, direction: ASC }) {
      totalCount
      nodes { id name color description }
    }
  }
}`;

const USERS_QUERY = `query($owner: String!, $repo: String!, $query: String) {
  repository(owner: $owner, name: $repo) {
    assignableUsers(first: 100, query: $query) {
      totalCount
      nodes { id login name avatarUrl }
    }
  }
}`;

// --- Shapes ---

function login(actor) {
  return (actor && actor.login) || 'ghost';
}

/** GitHub's reaction groups that have someone in them, as { content, count, mine }. */
function reactions(groups) {
  return (groups || [])
    .filter(g => g && g.reactors && g.reactors.totalCount > 0)
    .map(g => ({ content: g.content, count: g.reactors.totalCount, mine: !!g.viewerHasReacted }));
}

/** A comment, a review or a review comment: who, when, the text both as Markdown and as GitHub's HTML, and what may be done to it. */
function message(node, kind) {
  return {
    kind,
    id: node.id,
    url: node.url || '',
    author: login(node.author),
    avatar: (node.author && node.author.avatarUrl) || null,
    association: node.authorAssociation || 'NONE',
    body: node.body || '',
    bodyHtml: node.bodyHTML || '',
    createdAt: node.createdAt || null,
    editedAt: node.lastEditedAt || null,
    mine: !!node.viewerDidAuthor,
    can: {
      update: !!node.viewerCanUpdate,
      delete: !!node.viewerCanDelete,
      minimize: !!node.viewerCanMinimize,
      react: !!node.viewerCanReact,
    },
    minimized: node.isMinimized ? String(node.minimizedReason || 'hidden').toLowerCase() : null,
    reactions: reactions(node.reactionGroups),
  };
}

function reviewerOf(node) {
  if (!node) return null;
  if (node.__typename === 'Team') return { kind: 'team', login: node.slug || '', name: node.name || node.slug || '' };
  return { kind: node.__typename === 'Bot' ? 'bot' : 'user', login: node.login || 'ghost', name: node.login || 'ghost', avatar: node.avatarUrl || null };
}

const EVENT_TYPES = {
  HeadRefForcePushedEvent: 'force-pushed',
  BaseRefChangedEvent: 'base-changed',
  RenamedTitleEvent: 'renamed',
  ClosedEvent: 'closed',
  ReopenedEvent: 'reopened',
  MergedEvent: 'merged',
  ReadyForReviewEvent: 'ready',
  ConvertToDraftEvent: 'draft',
  ReviewRequestedEvent: 'review-requested',
  ReviewRequestRemovedEvent: 'review-request-removed',
  ReviewDismissedEvent: 'review-dismissed',
  LabeledEvent: 'labeled',
  UnlabeledEvent: 'unlabeled',
  AssignedEvent: 'assigned',
  UnassignedEvent: 'unassigned',
  HeadRefDeletedEvent: 'branch-deleted',
  HeadRefRestoredEvent: 'branch-restored',
};

/** One item of the timeline in the view's shape, or null for a kind the view does not show. */
function timelineItem(node) {
  if (!node || !node.__typename) return null;
  if (node.__typename === 'IssueComment') return message(node, 'comment');
  if (node.__typename === 'PullRequestReview') {
    return { ...message(node, 'review'), state: node.state || 'COMMENTED', submittedAt: node.submittedAt || node.createdAt || null };
  }
  if (node.__typename === 'PullRequestCommit') {
    const c = node.commit || {};
    return {
      kind: 'commit',
      oid: c.oid || '',
      short: c.abbreviatedOid || String(c.oid || '').slice(0, 7),
      headline: c.messageHeadline || '',
      author: (c.author && ((c.author.user && c.author.user.login) || c.author.name)) || 'unknown',
      createdAt: c.committedDate || null,
      checks: (c.statusCheckRollup && c.statusCheckRollup.state) || null,
      url: node.url || '',
    };
  }
  const type = EVENT_TYPES[node.__typename];
  if (!type) return null;
  const event = { kind: 'event', type, actor: login(node.actor), createdAt: node.createdAt || null };
  if (type === 'force-pushed') {
    event.from = (node.beforeCommit && node.beforeCommit.abbreviatedOid) || '';
    event.to = (node.afterCommit && node.afterCommit.abbreviatedOid) || '';
  } else if (type === 'base-changed') {
    event.from = node.previousRefName || '';
    event.to = node.currentRefName || '';
  } else if (type === 'renamed') {
    event.from = node.previousTitle || '';
    event.to = node.currentTitle || '';
  } else if (type === 'merged') {
    event.commit = (node.mergeCommit && node.mergeCommit.abbreviatedOid) || '';
    event.to = node.mergeRefName || '';
  } else if (type === 'review-requested' || type === 'review-request-removed') {
    const reviewer = reviewerOf(node.requestedReviewer);
    event.subject = reviewer ? reviewer.name : 'someone';
  } else if (type === 'review-dismissed') {
    event.subject = login(node.review && node.review.author);
    event.message = node.dismissalMessage || '';
  } else if (type === 'labeled' || type === 'unlabeled') {
    event.label = { name: (node.label && node.label.name) || '', color: (node.label && node.label.color) || '' };
  } else if (type === 'assigned' || type === 'unassigned') {
    event.subject = login(node.assignee);
  } else if (type === 'branch-deleted') {
    event.to = node.headRefName || '';
  }
  return event;
}

function thread(node) {
  const comments = ((node.comments && node.comments.nodes) || []).filter(Boolean);
  const first = comments[0] || {};
  return {
    id: node.id,
    path: node.path || '',
    line: node.line != null ? node.line : (node.originalLine != null ? node.originalLine : null),
    resolved: !!node.isResolved,
    outdated: !!node.isOutdated,
    resolvedBy: node.resolvedBy ? login(node.resolvedBy) : null,
    can: { resolve: !!node.viewerCanResolve, unresolve: !!node.viewerCanUnresolve, reply: !!node.viewerCanReply },
    reviewId: (first.pullRequestReview && first.pullRequestReview.id) || null,
    diffHunk: first.diffHunk || '',
    comments: comments.map(c => ({ ...message(c, 'review-comment'), replyTo: (c.replyTo && c.replyTo.id) || null })),
  };
}

/**
 * The people on the sidebar's Reviewers: those who reviewed, with their latest
 * review's state, and those asked to, as REQUESTED (asking again after a
 * review counts as asked).
 */
function reviewers(head) {
  const byKey = new Map();
  for (const review of (head.latestReviews && head.latestReviews.nodes) || []) {
    if (!review || !review.author) continue;
    const who = reviewerOf({ __typename: 'User', ...review.author });
    byKey.set(`user:${who.login}`, { ...who, state: review.state || 'COMMENTED' });
  }
  for (const request of (head.reviewRequests && head.reviewRequests.nodes) || []) {
    const who = reviewerOf(request && request.requestedReviewer);
    if (!who) continue;
    const key = `${who.kind === 'team' ? 'team' : 'user'}:${who.login}`;
    byKey.set(key, { ...(byKey.get(key) || who), ...who, state: 'REQUESTED' });
  }
  return [...byKey.values()];
}

function pullRequestHead(node) {
  const commit = node.commits && node.commits.nodes && node.commits.nodes[0] && node.commits.nodes[0].commit;
  const pending = node.pendingReviews && node.pendingReviews.nodes && node.pendingReviews.nodes[0];
  return {
    id: node.id,
    number: node.number,
    title: node.title || '',
    url: node.url || '',
    state: node.state,
    isDraft: !!node.isDraft,
    body: node.body || '',
    bodyHtml: node.bodyHTML || '',
    author: login(node.author),
    avatar: (node.author && node.author.avatarUrl) || null,
    association: node.authorAssociation || 'NONE',
    createdAt: node.createdAt || null,
    editedAt: node.lastEditedAt || null,
    mine: !!node.viewerDidAuthor,
    can: {
      update: !!node.viewerCanUpdate,
      react: !!node.viewerCanReact,
      close: !!node.viewerCanClose,
      reopen: !!node.viewerCanReopen,
      updateBranch: !!node.viewerCanUpdateBranch,
      label: !!node.viewerCanLabel,
      assign: !!node.viewerCanAssign,
    },
    mergeStateStatus: node.mergeStateStatus || 'UNKNOWN', // BEHIND | BLOCKED | CLEAN | DIRTY | DRAFT | HAS_HOOKS | UNSTABLE | UNKNOWN
    mergeable: node.mergeable || 'UNKNOWN',
    comments: node.totalCommentsCount || 0,
    commitCount: (node.allCommits && node.allCommits.totalCount) || 0,
    reviewDecision: node.reviewDecision || null,
    head: node.headRefName || '',
    headOid: node.headRefOid || '',
    base: node.baseRefName || '',
    crossRepository: !!node.isCrossRepository,
    checks: (commit && commit.statusCheckRollup && commit.statusCheckRollup.state) || null,
    reactions: reactions(node.reactionGroups),
    reviewers: reviewers(node),
    assignees: ((node.assignees && node.assignees.nodes) || []).filter(Boolean).map(a => ({ id: a.id, login: a.login, avatar: a.avatarUrl || null })),
    labels: ((node.labels && node.labels.nodes) || []).filter(Boolean).map(l => ({ id: l.id, name: l.name, color: l.color || '', description: l.description || '' })),
    pendingReviewId: (pending && pending.id) || null,
  };
}

// --- Reading ---

/** The repository the folder's remote names, then one GraphQL read with owner and name filled in. */
async function read(dir, remote, query, variables = {}, timeoutMs = pr.READ_TIMEOUT_MS) {
  const { target, failure } = await pr.targetFor(dir, remote || null);
  if (failure) return { failure };
  const answer = await pr.graphql(target, query, { owner: target.owner, repo: target.repo, ...variables }, timeoutMs);
  if (!answer.ok) return { failure: answer, target };
  return { target, data: answer.data };
}

function pullRequestOf(data) {
  return data && data.repository && data.repository.pullRequest;
}

const NOT_FOUND = { error: 'GitHub does not know this repository or pull request, or your account cannot see it.', code: 'not-found' };
const BAD_NUMBER = { error: 'Not a pull request number', code: 'bad-request' };

function validQuery(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= MAX_QUERY);
}

/**
 * The conversation: the pull request itself (description, sidebar, what the
 * account may do), one page of its timeline, oldest first, and its review
 * threads. With `after` only the next page of the timeline comes.
 */
async function conversation(dir, { remote = null, number, after = null } = {}) {
  const n = pr.validNumber(number);
  if (!n) return BAD_NUMBER;
  if (!pr.validCursor(after)) return { error: 'Not a page cursor', code: 'bad-request' };
  const full = !after;
  const { failure, data } = await read(dir, remote, CONVERSATION_QUERY, { number: n, after: after || null, full });
  if (failure) return failure;
  const node = pullRequestOf(data);
  if (!node) return NOT_FOUND;
  const connection = node.timelineItems || {};
  const result = {
    ok: true,
    number: n,
    timeline: {
      items: (connection.nodes || []).map(timelineItem).filter(Boolean),
      // totalCount counts every kind of event, filteredCount only the kinds asked for.
      totalCount: connection.filteredCount || 0,
      hasNextPage: !!(connection.pageInfo && connection.pageInfo.hasNextPage),
      endCursor: (connection.pageInfo && connection.pageInfo.endCursor) || null,
    },
  };
  if (full) {
    result.pr = pullRequestHead(node);
    result.threads = ((node.reviewThreads && node.reviewThreads.nodes) || []).filter(Boolean).map(thread);
  }
  return result;
}

/** The pull request's commits, oldest first: at most the 250 GitHub lists. */
async function commits(dir, { remote = null, number } = {}) {
  const n = pr.validNumber(number);
  if (!n) return BAD_NUMBER;
  const list = [];
  let after = null;
  let totalCount = 0;
  let hasNextPage = false;
  for (let page = 0; page < MAX_COMMIT_PAGES; page++) {
    const { failure, data } = await read(dir, remote, COMMITS_QUERY, { number: n, after });
    if (failure) return failure;
    const node = pullRequestOf(data);
    if (!node) return NOT_FOUND;
    const connection = node.commits || {};
    totalCount = connection.totalCount || 0;
    for (const item of connection.nodes || []) {
      const c = item && item.commit;
      if (!c) continue;
      list.push({
        oid: c.oid,
        short: c.abbreviatedOid || String(c.oid || '').slice(0, 7),
        headline: c.messageHeadline || '',
        body: c.messageBody || '',
        date: c.committedDate || null,
        author: (c.author && ((c.author.user && c.author.user.login) || c.author.name)) || 'unknown',
        avatar: (c.author && c.author.user && c.author.user.avatarUrl) || null,
        url: c.url || '',
        checks: (c.statusCheckRollup && c.statusCheckRollup.state) || null,
      });
    }
    hasNextPage = !!(connection.pageInfo && connection.pageInfo.hasNextPage);
    after = connection.pageInfo && connection.pageInfo.endCursor;
    if (!hasNextPage || !after) break;
  }
  return { ok: true, number: n, commits: list, totalCount, truncated: hasNextPage };
}

/** One commit's files, each with its patch, in the shape of a pull request's files. */
async function commitFiles(dir, { remote = null, sha } = {}) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) return { error: 'Not a commit hash', code: 'bad-request' };
  const { target, failure } = await pr.targetFor(dir, remote || null);
  if (failure) return failure;
  let result;
  try {
    result = await pr.run([
      'api', '--hostname', target.host, '--paginate',
      `repos/${target.owner}/${target.repo}/commits/${sha}?per_page=100`,
      '--jq', '.files[] | {filename, previous_filename, status, additions, deletions, patch}',
    ], { timeoutMs: pr.FILES_TIMEOUT_MS });
  } catch (err) {
    return pr.thrownFailure(err);
  }
  if (result.code !== 0) return pr.ghFailure(result, target);
  return { ok: true, sha, ...pr.parseFileLines(result.stdout) };
}

/**
 * pass, fail, pending, skipped or cancelled, the way gh pr checks sorts them:
 * a neutral conclusion passes, a required action or a timeout fails.
 */
function checkBucket(kind, status, conclusion) {
  if (kind === 'status') {
    if (status === 'SUCCESS') return 'pass';
    if (status === 'FAILURE' || status === 'ERROR') return 'fail';
    return 'pending';
  }
  if (status !== 'COMPLETED') return 'pending';
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') return 'pass';
  if (conclusion === 'SKIPPED') return 'skipped';
  if (conclusion === 'CANCELLED') return 'cancelled';
  if (conclusion === 'STALE') return 'pending';
  return 'fail';
}

function checkOf(node) {
  if (!node) return null;
  if (node.__typename === 'CheckRun') {
    const suite = node.checkSuite || {};
    const run = suite.workflowRun || null;
    const status = node.status || 'QUEUED';
    const conclusion = node.conclusion || null;
    return {
      kind: 'run',
      // A GitHub Actions check run's id is its job's id.
      id: node.databaseId || null,
      name: node.name || '',
      title: node.title || '',
      group: (run && run.workflow && run.workflow.name) || (suite.app && suite.app.name) || '',
      app: (suite.app && suite.app.name) || '',
      runId: (run && run.databaseId) || null,
      event: (run && run.event) || '',
      status,
      conclusion,
      bucket: checkBucket('run', status, conclusion),
      startedAt: node.startedAt || null,
      completedAt: node.completedAt || null,
      url: node.detailsUrl || '',
      required: !!node.isRequired,
      // The log and the re-runs are GitHub Actions' only.
      actions: !!(run && run.databaseId),
    };
  }
  if (node.__typename === 'StatusContext') {
    const state = node.state || 'PENDING';
    return {
      kind: 'status',
      id: null,
      name: node.context || '',
      title: node.description || '',
      group: '',
      app: '',
      runId: null,
      event: '',
      status: state,
      conclusion: null,
      bucket: checkBucket('status', state, null),
      startedAt: node.createdAt || null,
      completedAt: null,
      url: node.targetUrl || '',
      required: !!node.isRequired,
      actions: false,
    };
  }
  return null;
}

function checksSummary(list) {
  const summary = { pass: 0, fail: 0, pending: 0, skipped: 0, cancelled: 0 };
  for (const check of list) summary[check.bucket] = (summary[check.bucket] || 0) + 1;
  return summary;
}

/** The checks of the pull request's last commit, as GitHub's Checks tab lists them, with a count per state. */
async function checks(dir, { remote = null, number } = {}) {
  const n = pr.validNumber(number);
  if (!n) return BAD_NUMBER;
  const list = [];
  let after = null;
  let rollup = null;
  let headOid = '';
  let hasNextPage = false;
  for (let page = 0; page < MAX_CHECK_PAGES; page++) {
    const { failure, data } = await read(dir, remote, CHECKS_QUERY, { number: n, after });
    if (failure) return failure;
    const node = pullRequestOf(data);
    if (!node) return NOT_FOUND;
    headOid = node.headRefOid || headOid;
    const commit = node.commits && node.commits.nodes && node.commits.nodes[0] && node.commits.nodes[0].commit;
    const status = commit && commit.statusCheckRollup;
    if (!status) break;
    rollup = status.state || null;
    const connection = status.contexts || {};
    for (const item of connection.nodes || []) {
      const check = checkOf(item);
      if (check) list.push(check);
    }
    hasNextPage = !!(connection.pageInfo && connection.pageInfo.hasNextPage);
    after = connection.pageInfo && connection.pageInfo.endCursor;
    if (!hasNextPage || !after) break;
  }
  return { ok: true, number: n, headOid, rollup, checks: list, summary: checksSummary(list), truncated: hasNextPage };
}

/** A job's log as plain lines: no colours, no timestamp in front of each line, at most the last MAX_LOG_BYTES. */
function cleanLog(text, maxBytes = MAX_LOG_BYTES) {
  let log = String(text || '').replace(/^\uFEFF/, '');
  let truncated = false;
  if (Buffer.byteLength(log) > maxBytes) {
    const buffer = Buffer.from(log);
    log = buffer.subarray(buffer.length - maxBytes).toString('utf8');
    const newline = log.indexOf('\n');
    if (newline >= 0) log = log.slice(newline + 1);
    truncated = true;
  }
  log = log
    .replace(/\r\n/g, '\n')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map(line => line.replace(/^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/, ''))
    .join('\n');
  return { text: log, truncated };
}

function validJobId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The log of one GitHub Actions job (once it has finished: GitHub keeps none of a running one). */
async function jobLog(dir, { remote = null, jobId } = {}) {
  const id = validJobId(jobId);
  if (!id) return { error: 'Not a job', code: 'bad-request' };
  const { target, failure } = await pr.targetFor(dir, remote || null);
  if (failure) return failure;
  const args = ['api', '--hostname', target.host, `repos/${target.owner}/${target.repo}/actions/jobs/${id}/logs`];
  let result;
  try {
    result = await pr.run(args, { timeoutMs: pr.FILES_TIMEOUT_MS });
    // A recent gh holds back an answer with terminal escapes (a log's colours)
    // unless told to let them through, and an older one knows no such flag: so
    // it is asked for only when gh names it. cleanLog takes the escapes off.
    if (result.code !== 0 && /--allow-escape-sequences/.test(`${result.stderr || ''}${result.stdout || ''}`)) {
      result = await pr.run([...args, '--allow-escape-sequences'], { timeoutMs: pr.FILES_TIMEOUT_MS });
    }
  } catch (err) {
    return pr.thrownFailure(err);
  }
  if (result.code !== 0) {
    const failed = pr.ghFailure(result, target);
    if (failed.code === 'not-found') return { error: 'GitHub has no log of this job, or not yet: a log comes once the job has finished.', code: 'not-found' };
    return failed;
  }
  return { ok: true, jobId: id, ...cleanLog(result.stdout) };
}

/** Which files of the pull request this account marked as viewed (or whose viewed mark a new change dismissed). */
async function viewed(dir, { remote = null, number } = {}) {
  const n = pr.validNumber(number);
  if (!n) return BAD_NUMBER;
  const states = {};
  let after = null;
  for (let page = 0; page < MAX_VIEWED_PAGES; page++) {
    const { failure, data } = await read(dir, remote, VIEWED_QUERY, { number: n, after });
    if (failure) return failure;
    const node = pullRequestOf(data);
    if (!node) return NOT_FOUND;
    const connection = node.files || {};
    for (const file of connection.nodes || []) {
      if (file && file.path && file.viewerViewedState && file.viewerViewedState !== 'UNVIEWED') states[file.path] = file.viewerViewedState;
    }
    const more = !!(connection.pageInfo && connection.pageInfo.hasNextPage);
    after = connection.pageInfo && connection.pageInfo.endCursor;
    if (!more || !after) break;
  }
  return { ok: true, number: n, viewed: states };
}

/** The repository's branches matching `query` (at most 100, by name) and its default branch, for Change base. */
async function branches(dir, { remote = null, query = null } = {}) {
  if (!validQuery(query)) return { error: 'Not a branch search', code: 'bad-request' };
  const { failure, data } = await read(dir, remote, BRANCHES_QUERY, { query: query || null });
  if (failure) return failure;
  const repository = data.repository;
  const refs = repository.refs || {};
  const defaultBranch = (repository.defaultBranchRef && repository.defaultBranchRef.name) || null;
  const names = (refs.nodes || []).filter(Boolean).map(r => r.name).filter(Boolean);
  // The default branch is offered even when it is not among the first 100 by name.
  if (defaultBranch && !names.includes(defaultBranch) && (!query || defaultBranch.toLowerCase().includes(String(query).toLowerCase()))) names.unshift(defaultBranch);
  return { ok: true, defaultBranch, branches: names, totalCount: refs.totalCount || 0 };
}

/** What the sidebar can add: the repository's labels, or the people who may be assigned or asked to review. */
async function candidates(dir, { remote = null, kind, query = null } = {}) {
  if (kind !== 'labels' && kind !== 'users') return { error: 'Only labels and users are offered', code: 'bad-request' };
  if (!validQuery(query)) return { error: 'Not a search', code: 'bad-request' };
  const { failure, data } = await read(dir, remote, kind === 'labels' ? LABELS_QUERY : USERS_QUERY, { query: query || null });
  if (failure) return failure;
  const connection = (kind === 'labels' ? data.repository.labels : data.repository.assignableUsers) || {};
  const items = (connection.nodes || []).filter(Boolean).map(node => (kind === 'labels'
    ? { id: node.id, name: node.name, color: node.color || '', description: node.description || '' }
    : { id: node.id, login: node.login, name: node.name || '', avatar: node.avatarUrl || null }));
  return { ok: true, kind, items, totalCount: connection.totalCount || 0 };
}

/** GitHub's own HTML for a text being written, for the editor's Preview: mentions and #references as on GitHub. */
async function renderMarkdown(dir, { remote = null, text } = {}) {
  if (typeof text !== 'string' || text.length > MAX_MARKDOWN) return { error: 'The text is longer than GitHub allows', code: 'bad-request' };
  if (!text.trim()) return { ok: true, html: '' };
  const { target, failure } = await pr.targetFor(dir, remote || null);
  if (failure) return failure;
  let result;
  try {
    result = await pr.run(['api', '--hostname', target.host, '--method', 'POST', 'markdown', '--input', '-'], {
      input: JSON.stringify({ text, mode: 'gfm', context: `${target.owner}/${target.repo}` }),
    });
  } catch (err) {
    return pr.thrownFailure(err);
  }
  if (result.code !== 0) return pr.ghFailure(result, target);
  return { ok: true, html: result.stdout };
}

module.exports = {
  conversation, commits, commitFiles, checks, jobLog, viewed, branches, candidates, renderMarkdown,
  // exported for tests
  timelineItem, thread, pullRequestHead, reviewers, checkOf, checkBucket, cleanLog, reactions,
  CONVERSATION_QUERY, COMMITS_QUERY, CHECKS_QUERY, TIMELINE_TYPES, MAX_LOG_BYTES, MAX_MARKDOWN,
};
