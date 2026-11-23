// pull-request-search.js — what the Pull Requests view's search looks through
// beyond what a row already has (its title and number): each pull request's
// description, its comments (the conversation's, the reviews' and the review
// threads'), and the paths of its changed files. Never the code: no diff is
// read here.
//
// The view asks for the pull requests it shows and has not read yet (or that
// changed since), a few at a time: one GraphQL request through gh reads up to
// MAX_NUMBERS of them, one alias each, and a pull request with more than 100
// files reads the rest of their paths 100 at a time, up to the 3000 GitHub
// lists. Like pull-request-detail.js it goes through pull-requests.js (its
// runner and its repository), so a test's fake gh answers here too.

const pr = require('./pull-requests');

const MAX_NUMBERS = 20;
const FILES_PAGE = 100;
const MAX_FILE_PAGES = 30; // 3000 files, as many as GitHub lists
const COMMENTS = 100;
const REVIEWS = 50;
const THREADS = 50;
const THREAD_COMMENTS = 30;

const TEXT_FIELDS = `number updatedAt body
  comments(first: ${COMMENTS}) { totalCount nodes { body } }
  reviews(first: ${REVIEWS}) { totalCount nodes { body } }
  reviewThreads(first: ${THREADS}) { totalCount nodes { comments(first: ${THREAD_COMMENTS}) { totalCount nodes { body } } } }
  files(first: ${FILES_PAGE}) { totalCount pageInfo { hasNextPage endCursor } nodes { path } }`;

/** One request for `count` pull requests: $n0…$nX, aliased p0…pX. */
function textsQuery(count) {
  const vars = Array.from({ length: count }, (_, i) => `$n${i}: Int!`).join(', ');
  const fields = Array.from({ length: count }, (_, i) => `p${i}: pullRequest(number: $n${i}) { ...Texts }`).join('\n    ');
  return `query($owner: String!, $repo: String!, ${vars}) {
  repository(owner: $owner, name: $repo) {
    ${fields}
  }
}

fragment Texts on PullRequest {
  ${TEXT_FIELDS}
}`;
}

const FILES_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      files(first: ${FILES_PAGE}, after: $after) { pageInfo { hasNextPage endCursor } nodes { path } }
    }
  }
}`;

function bodies(connection) {
  return ((connection && connection.nodes) || [])
    .map(node => node && node.body)
    .filter(body => typeof body === 'string' && body.trim());
}

function more(connection) {
  return !!connection && (connection.totalCount || 0) > ((connection.nodes || []).length);
}

/**
 * One pull request's texts: { number, updatedAt, body, comments, files,
 * truncated }. `comments` holds every message's text, empty ones left out;
 * `truncated` says some comments or files were beyond what was read.
 */
function textsOf(node) {
  const comments = [...bodies(node.comments), ...bodies(node.reviews)];
  let truncated = more(node.comments) || more(node.reviews) || more(node.reviewThreads);
  for (const thread of (node.reviewThreads && node.reviewThreads.nodes) || []) {
    if (!thread) continue;
    comments.push(...bodies(thread.comments));
    if (more(thread.comments)) truncated = true;
  }
  const files = ((node.files && node.files.nodes) || []).map(f => f && f.path).filter(p => typeof p === 'string' && p);
  return {
    number: node.number,
    updatedAt: node.updatedAt || null,
    body: typeof node.body === 'string' ? node.body : '',
    comments,
    files,
    truncated,
  };
}

/** The numbers asked for, each a pull request number, once; null when the list is not one. */
function validNumbers(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_NUMBERS) return null;
  const numbers = [];
  for (const item of value) {
    const n = pr.validNumber(item);
    if (!n) return null;
    if (!numbers.includes(n)) numbers.push(n);
  }
  return numbers;
}

/** The paths after the first 100 of a pull request with more files. */
async function restOfFiles(target, number, after) {
  const paths = [];
  let cursor = after;
  for (let page = 1; page < MAX_FILE_PAGES && cursor; page++) {
    const answer = await pr.graphql(target, FILES_QUERY, { owner: target.owner, repo: target.repo, number, after: cursor });
    if (!answer.ok) return { paths, failure: answer };
    const files = answer.data.repository.pullRequest && answer.data.repository.pullRequest.files;
    if (!files) break;
    for (const f of files.nodes || []) if (f && typeof f.path === 'string' && f.path) paths.push(f.path);
    cursor = files.pageInfo && files.pageInfo.hasNextPage ? files.pageInfo.endCursor : null;
  }
  return { paths, more: !!cursor };
}

/**
 * The texts of up to MAX_NUMBERS pull requests: { ok, items } in the order
 * asked, or an error result.
 */
async function texts(dir, { remote = null, numbers } = {}) {
  const wanted = validNumbers(numbers);
  if (!wanted) return { error: `Ask for 1 to ${MAX_NUMBERS} pull request numbers`, code: 'bad-request' };
  const { target, failure } = await pr.targetFor(dir, remote || null);
  if (failure) return failure;
  const variables = { owner: target.owner, repo: target.repo };
  wanted.forEach((n, i) => { variables[`n${i}`] = n; });
  const answer = await pr.graphql(target, textsQuery(wanted.length), variables);
  if (!answer.ok) return answer;
  const items = [];
  for (let i = 0; i < wanted.length; i++) {
    const node = answer.data.repository[`p${i}`];
    if (!node) continue;
    const item = textsOf(node);
    const pageInfo = node.files && node.files.pageInfo;
    if (pageInfo && pageInfo.hasNextPage && pageInfo.endCursor) {
      const rest = await restOfFiles(target, item.number, pageInfo.endCursor);
      if (rest.failure) return rest.failure;
      item.files.push(...rest.paths);
      if (rest.more) item.truncated = true;
    }
    items.push(item);
  }
  return { ok: true, items };
}

module.exports = { texts, textsQuery, textsOf, validNumbers, MAX_NUMBERS, FILES_QUERY };
