// pull-request-edits.js — what the Pull Requests view changes on GitHub besides
// merging, drafting and closing (those stay in pull-requests.js): the title,
// the description and the base; comments, their edits, deletions and hiding;
// replies to review threads and resolving them; reactions; reviews; updating
// the branch with its base; files marked as viewed; reviewers, assignees and
// labels; and re-running GitHub Actions jobs.
//
// Each change is one `kind` from KINDS, which names the fields it takes, the
// check of each field and the GraphQL mutation it runs. The texts (titles,
// bodies, branch names, logins) travel only as GraphQL variables on stdin:
// gh's arguments are always the same fixed words. The re-runs are REST calls
// whose path holds nothing but a validated id.

const pr = require('./pull-requests');

const MAX_TITLE = 256;
const MAX_BODY = 65536; // GitHub's own limit for a body
const MAX_LIST = 100;

const REACTIONS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'];
const HIDE_REASONS = ['SPAM', 'ABUSE', 'OFF_TOPIC', 'OUTDATED', 'DUPLICATE', 'RESOLVED'];
const REVIEW_EVENTS = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];
const UPDATE_METHODS = ['MERGE', 'REBASE'];

// --- Checks of the fields ---

const isNodeId = v => typeof v === 'string' && /^[A-Za-z0-9_=+/-]{1,200}$/.test(v);
const isTitle = v => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TITLE && !/[\r\n]/.test(v);
const isBody = v => typeof v === 'string' && v.length <= MAX_BODY;
const isText = v => isBody(v) && v.trim().length > 0;
const isHash = v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const isPath = v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !v.includes('\0');
const isBool = v => typeof v === 'boolean';
const isJobId = v => Number.isSafeInteger(v) && v > 0;
const oneOf = (...values) => v => values.includes(v);
const listOf = check => v => Array.isArray(v) && v.length <= MAX_LIST && v.every(check);
// A GitHub login (a bot's ends in [bot]) and a team's slug.
const isLogin = v => typeof v === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(v);
const isTeamSlug = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(v);

/** A branch name git itself would take (git check-ref-format, for refs/heads/<name>). */
function isBranchName(v) {
  if (typeof v !== 'string' || !v || v.length > 255) return false;
  if (v === '@' || v.startsWith('-') || v.startsWith('/') || v.endsWith('/') || v.endsWith('.') || v.endsWith('.lock')) return false;
  if (v.includes('..') || v.includes('//') || v.includes('@{')) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(v)) return false;
  return v.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

// --- What may be changed ---

const ISSUE_COMMENT = 'issue';
const REVIEW_COMMENT = 'review-comment';
const REVIEW = 'review';

/**
 * Each kind: `fields` (name → check), `optional` field names, `repository`
 * when it runs one at a time with merges for the repository, and either
 * `mutation` + `variables` (GraphQL) or `rest` (a POST path from the fields).
 * `done` is the sentence shown afterwards ('' shows nothing).
 */
const KINDS = {
  title: {
    fields: { pullRequestId: isNodeId, title: isTitle },
    mutation: 'mutation($pullRequestId: ID!, $title: String!) { updatePullRequest(input: { pullRequestId: $pullRequestId, title: $title }) { pullRequest { id } } }',
    variables: p => ({ pullRequestId: p.pullRequestId, title: p.title.trim() }),
    done: () => 'Title saved.',
  },
  body: {
    fields: { pullRequestId: isNodeId, body: isBody },
    mutation: 'mutation($pullRequestId: ID!, $body: String!) { updatePullRequest(input: { pullRequestId: $pullRequestId, body: $body }) { pullRequest { id } } }',
    done: () => 'Description saved.',
  },
  base: {
    fields: { pullRequestId: isNodeId, base: isBranchName },
    repository: true,
    mutation: 'mutation($pullRequestId: ID!, $base: String!) { updatePullRequest(input: { pullRequestId: $pullRequestId, baseRefName: $base }) { pullRequest { id } } }',
    done: p => `The base is ${p.base} now.`,
  },
  comment: {
    fields: { pullRequestId: isNodeId, body: isText },
    mutation: 'mutation($pullRequestId: ID!, $body: String!) { addComment(input: { subjectId: $pullRequestId, body: $body }) { clientMutationId } }',
    done: () => 'Comment added.',
  },
  'comment-edit': {
    // A review's own text may be emptied; a comment's may not.
    fields: { type: oneOf(ISSUE_COMMENT, REVIEW_COMMENT, REVIEW), id: isNodeId, body: isBody },
    check: p => (p.type === REVIEW || p.body.trim() ? null : 'A comment cannot be empty.'),
    mutation: p => ({
      [ISSUE_COMMENT]: 'mutation($id: ID!, $body: String!) { updateIssueComment(input: { id: $id, body: $body }) { clientMutationId } }',
      [REVIEW_COMMENT]: 'mutation($id: ID!, $body: String!) { updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) { clientMutationId } }',
      [REVIEW]: 'mutation($id: ID!, $body: String!) { updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body }) { clientMutationId } }',
    })[p.type],
    variables: p => ({ id: p.id, body: p.body }),
    done: () => 'Comment saved.',
  },
  'comment-delete': {
    fields: { type: oneOf(ISSUE_COMMENT, REVIEW_COMMENT), id: isNodeId },
    mutation: p => (p.type === ISSUE_COMMENT
      ? 'mutation($id: ID!) { deleteIssueComment(input: { id: $id }) { clientMutationId } }'
      : 'mutation($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }'),
    variables: p => ({ id: p.id }),
    done: () => 'Comment deleted.',
  },
  'comment-hide': {
    fields: { id: isNodeId, reason: oneOf(...HIDE_REASONS) },
    mutation: 'mutation($id: ID!, $reason: ReportedContentClassifiers!) { minimizeComment(input: { subjectId: $id, classifier: $reason }) { clientMutationId } }',
    done: () => 'Comment hidden.',
  },
  'comment-unhide': {
    fields: { id: isNodeId },
    mutation: 'mutation($id: ID!) { unminimizeComment(input: { subjectId: $id }) { clientMutationId } }',
    done: () => 'Comment shown again.',
  },
  'thread-reply': {
    fields: { threadId: isNodeId, body: isText },
    mutation: 'mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { clientMutationId } }',
    done: () => 'Reply added.',
  },
  'thread-resolve': {
    fields: { threadId: isNodeId },
    mutation: 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { clientMutationId } }',
    done: () => 'Conversation resolved.',
  },
  'thread-unresolve': {
    fields: { threadId: isNodeId },
    mutation: 'mutation($threadId: ID!) { unresolveReviewThread(input: { threadId: $threadId }) { clientMutationId } }',
    done: () => 'Conversation unresolved.',
  },
  react: {
    fields: { subjectId: isNodeId, content: oneOf(...REACTIONS) },
    mutation: 'mutation($subjectId: ID!, $content: ReactionContent!) { addReaction(input: { subjectId: $subjectId, content: $content }) { clientMutationId } }',
    done: () => '',
  },
  unreact: {
    fields: { subjectId: isNodeId, content: oneOf(...REACTIONS) },
    mutation: 'mutation($subjectId: ID!, $content: ReactionContent!) { removeReaction(input: { subjectId: $subjectId, content: $content }) { clientMutationId } }',
    done: () => '',
  },
  review: {
    // A review the account started on GitHub and left pending is the one submitted.
    fields: { pullRequestId: isNodeId, event: oneOf(...REVIEW_EVENTS), body: isBody, pendingReviewId: isNodeId },
    optional: ['body', 'pendingReviewId'],
    check: p => (p.event !== 'APPROVE' && !String(p.body || '').trim() ? 'Write what the review says.' : null),
    mutation: p => (p.pendingReviewId
      ? 'mutation($pendingReviewId: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: { pullRequestReviewId: $pendingReviewId, event: $event, body: $body }) { clientMutationId } }'
      : 'mutation($pullRequestId: ID!, $event: PullRequestReviewEvent!, $body: String) { addPullRequestReview(input: { pullRequestId: $pullRequestId, event: $event, body: $body }) { clientMutationId } }'),
    variables: p => (p.pendingReviewId
      ? { pendingReviewId: p.pendingReviewId, event: p.event, body: p.body || null }
      : { pullRequestId: p.pullRequestId, event: p.event, body: p.body || null }),
    done: p => ({ APPROVE: 'Review submitted: approved.', REQUEST_CHANGES: 'Review submitted: changes requested.', COMMENT: 'Review submitted.' })[p.event],
  },
  'update-branch': {
    fields: { pullRequestId: isNodeId, headOid: isHash, method: oneOf(...UPDATE_METHODS) },
    repository: true,
    mutation: 'mutation($pullRequestId: ID!, $headOid: GitObjectID!, $method: PullRequestBranchUpdateMethod!) { updatePullRequestBranch(input: { pullRequestId: $pullRequestId, expectedHeadOid: $headOid, updateMethod: $method }) { clientMutationId } }',
    done: p => (p.method === 'REBASE' ? 'The branch is rebased on its base.' : 'The base is merged into the branch.'),
  },
  viewed: {
    fields: { pullRequestId: isNodeId, path: isPath },
    mutation: 'mutation($pullRequestId: ID!, $path: String!) { markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId } }',
    done: () => '',
  },
  unviewed: {
    fields: { pullRequestId: isNodeId, path: isPath },
    mutation: 'mutation($pullRequestId: ID!, $path: String!) { unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId } }',
    done: () => '',
  },
  reviewers: {
    // The whole set, as the sidebar holds it: whoever is left out is no longer asked.
    fields: { pullRequestId: isNodeId, users: listOf(isLogin), teams: listOf(isTeamSlug) },
    mutation: 'mutation($pullRequestId: ID!, $users: [String!], $teams: [String!]) { requestReviewsByLogin(input: { pullRequestId: $pullRequestId, userLogins: $users, teamSlugs: $teams, union: false }) { clientMutationId } }',
    done: () => 'Reviewers saved.',
  },
  labels: {
    fields: { pullRequestId: isNodeId, add: listOf(isNodeId), remove: listOf(isNodeId) },
    check: p => (p.add.length || p.remove.length ? null : 'Nothing to change.'),
    mutation: `mutation($pullRequestId: ID!, $add: [ID!]!, $remove: [ID!]!, $adding: Boolean!, $removing: Boolean!) {
  added: addLabelsToLabelable(input: { labelableId: $pullRequestId, labelIds: $add }) @include(if: $adding) { clientMutationId }
  removed: removeLabelsFromLabelable(input: { labelableId: $pullRequestId, labelIds: $remove }) @include(if: $removing) { clientMutationId }
}`,
    variables: p => ({ pullRequestId: p.pullRequestId, add: p.add, remove: p.remove, adding: p.add.length > 0, removing: p.remove.length > 0 }),
    done: () => 'Labels saved.',
  },
  assignees: {
    fields: { pullRequestId: isNodeId, add: listOf(isNodeId), remove: listOf(isNodeId) },
    check: p => (p.add.length || p.remove.length ? null : 'Nothing to change.'),
    mutation: `mutation($pullRequestId: ID!, $add: [ID!]!, $remove: [ID!]!, $adding: Boolean!, $removing: Boolean!) {
  added: addAssigneesToAssignable(input: { assignableId: $pullRequestId, assigneeIds: $add }) @include(if: $adding) { clientMutationId }
  removed: removeAssigneesFromAssignable(input: { assignableId: $pullRequestId, assigneeIds: $remove }) @include(if: $removing) { clientMutationId }
}`,
    variables: p => ({ pullRequestId: p.pullRequestId, add: p.add, remove: p.remove, adding: p.add.length > 0, removing: p.remove.length > 0 }),
    done: () => 'Assignees saved.',
  },
  rerun: {
    // A workflow run: its failed jobs (and what depends on them), or all of it.
    fields: { runId: isJobId, failedOnly: isBool },
    optional: ['failedOnly'],
    rest: (p, repo) => `repos/${repo}/actions/runs/${p.runId}/${p.failedOnly === false ? 'rerun' : 'rerun-failed-jobs'}`,
    done: p => (p.failedOnly === false ? 'The workflow runs again.' : 'The failed jobs run again.'),
  },
  'rerun-job': {
    fields: { jobId: isJobId },
    rest: (p, repo) => `repos/${repo}/actions/jobs/${p.jobId}/rerun`,
    done: () => 'The job runs again.',
  },
};

/**
 * The fields of a change once checked, or { error }. Only the kind's own
 * fields (and `remote`, `kind`) may be there; all but the optional ones must.
 */
function checkParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { error: 'Nothing to change' };
  const spec = Object.hasOwn(KINDS, params.kind) ? KINDS[params.kind] : null;
  if (!spec) return { error: `Unknown pull request change: ${params.kind}` };
  const fields = {};
  for (const key of Object.keys(params)) {
    if (key === 'kind' || key === 'remote') continue;
    if (!Object.hasOwn(spec.fields, key)) return { error: `A ${params.kind} change takes no ${key}` };
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (!spec.fields[key](value)) return { error: `Not a valid ${key}` };
    fields[key] = value;
  }
  for (const key of Object.keys(spec.fields)) {
    if (fields[key] === undefined && !(spec.optional || []).includes(key)) return { error: `A ${params.kind} change needs ${key}` };
  }
  const refused = spec.check ? spec.check(fields) : null;
  if (refused) return { error: refused };
  return { spec, fields };
}

/** GitHub's refusals worth putting in plainer words; the rest are shown as GitHub words them. */
function editFailure(failure) {
  const text = String((failure && failure.error) || '');
  if (/approve your own pull request/i.test(text)) return { ...failure, error: 'You cannot approve your own pull request.' };
  if (/request changes on your own pull request/i.test(text)) return { ...failure, error: 'You cannot request changes on your own pull request.' };
  if (/one pending review/i.test(text)) return { ...failure, error: 'You have a pending review on GitHub: submit or delete it there first.' };
  if (/Could not resolve to a node/i.test(text)) return { error: 'GitHub no longer has it: it may have been deleted meanwhile. Refresh to see the pull request as it is now.', code: 'not-found' };
  if (/expected head oid|head branch was modified|head sha/i.test(text)) return { ...failure, error: 'New commits reached the branch since it was read. Look at them, then try again.' };
  return failure;
}

async function runRest(target, path) {
  let result;
  try {
    result = await pr.run(['api', '--hostname', target.host, '--method', 'POST', path], { timeoutMs: pr.ACTION_TIMEOUT_MS });
  } catch (err) {
    return pr.thrownFailure(err);
  }
  if (result.code !== 0) return pr.ghFailure(result, target);
  return { ok: true };
}

/** One change to a pull request on GitHub: { ok, message } or { error, code }. */
async function edit(dir, params = {}) {
  const checked = checkParams(params);
  if (checked.error) return { error: checked.error, code: 'bad-request' };
  const { spec, fields } = checked;
  const { target, failure } = await pr.targetFor(dir, params.remote || null);
  if (failure) return failure;
  if (spec.repository && !pr.claim(dir)) return { error: 'Another pull request action is still running for this repository.', code: 'busy' };
  try {
    let answer;
    if (spec.rest) {
      answer = await runRest(target, spec.rest(fields, `${target.owner}/${target.repo}`));
    } else {
      const mutation = typeof spec.mutation === 'function' ? spec.mutation(fields) : spec.mutation;
      const variables = spec.variables ? spec.variables(fields) : fields;
      answer = await pr.graphql(target, mutation, variables, pr.ACTION_TIMEOUT_MS, { repository: false });
    }
    if (!answer.ok) return editFailure(answer);
    pr.info('[pull-requests]', params.kind, `${target.owner}/${target.repo}`);
    return { ok: true, kind: params.kind, message: spec.done(fields) };
  } finally {
    if (spec.repository) pr.release(dir);
  }
}

module.exports = {
  edit,
  // exported for tests
  KINDS, checkParams, isBranchName, editFailure, REACTIONS, HIDE_REASONS, REVIEW_EVENTS, UPDATE_METHODS, MAX_TITLE, MAX_BODY,
};
