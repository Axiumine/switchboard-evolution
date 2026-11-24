// actions.js — the Git tab's Actions view: GitHub Actions as the Actions tab
// of a repository on github.com shows it, read through the GitHub CLI.
//
// Everything goes through pull-requests.js: the same gh (the one installed on
// the computer, else the one the app carries), the same choice of remote, the
// same error words. What this module reads:
//
//   - the workflows (the sidebar) and the repository's permission for the
//     account, so the view offers only what GitHub would let it do;
//   - a page of runs, of every workflow or of one, with the search box's
//     qualifiers as the REST API's filters (actions-model.js parses them);
//   - one run (or one of its attempts): its jobs and their steps, artifacts,
//     annotations, the deployments waiting for a review and the concurrency
//     group it waits in, and the jobs of its workflow file at the run's commit
//     for the graph;
//   - one job with its annotations, the log of one of its steps (GitHub gives
//     a step's log as soon as the step has finished, while the job still
//     runs) and the log of the whole job;
//   - a workflow file at a commit or a branch, parsed: its jobs and needs, its
//     "Run workflow" inputs, its schedule; the branches and tags for "Use
//     workflow from", the environments for an environment input;
//   - Management: caches, the repository's self-hosted runners, deployments.
//
// REST reads run `gh api -i` and remember each answer's ETag: asked again,
// GitHub answers 304 Not Modified when nothing changed, which costs nothing
// from the account's hourly budget (gh exits 1 on a 304; the status line says
// what happened). The budget's headers are kept, so the view can slow down
// before GitHub stops answering. Only validated numbers, file names and
// encoded filter values reach gh's arguments; nothing else.

const yaml = require('js-yaml');
const pr = require('./pull-requests');
const detail = require('./pull-request-detail');
const AM = require('./public/actions-model');

const RUNS_PAGE = 25; // what GitHub's run list shows per page
const MAX_PER_PAGE = 100;
const MAX_PAGES = 10; // of 100: workflows, jobs, artifacts, caches
const MAX_RUN_PAGE = 1000;
const MAX_CACHED = 400; // answers kept with their ETag
const MAX_LOGS = 120; // finished step logs kept
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_QUERY = 200;
const ANNOTATIONS_PER_JOB = 50;

const GH_MISSING = 'The GitHub CLI (gh) is needed for the Actions view. Install it with "brew install gh", then sign in with "gh auth login".';
const NOT_FOUND = 'GitHub does not know this repository, or your account cannot see it.';

const cache = new Map(); // `${host} ${accept} ${path}` → { etag, body }
const logs = new Map(); // a finished step's log → { text, truncated }
const files = new Map(); // a workflow file at a commit → { text, parsed }
let rate = null; // the REST budget as GitHub last gave it

function resetCaches() {
  cache.clear();
  logs.clear();
  files.clear();
  rate = null;
}

function remember(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

// --- Validation ---

// A number, or a string of digits (what a URL or a data- attribute gives).
const numeric = v => (typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : NaN));
const validId = (v) => { const n = numeric(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const validInt = (v, min, max) => { const n = numeric(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const isWorkflowFile = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,200}\.ya?ml$/.test(v);
const isWorkflowPath = v => typeof v === 'string' && /^\.github\/workflows\/[A-Za-z0-9._-]{1,200}\.ya?ml$/.test(v);
const isSha = v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);

/** A workflow named by its id or its file name ("ci.yml"), as the REST API takes it, or null. */
function workflowArg(value) {
  if (validId(value)) return String(validId(value));
  return isWorkflowFile(value) ? value : null;
}

/** A branch or tag name git would take, or a commit. */
function isRef(v) {
  if (isSha(v)) return true;
  if (typeof v !== 'string' || !v || v.length > 255) return false;
  if (v === '@' || v.startsWith('-') || v.startsWith('/') || v.endsWith('/') || v.endsWith('.') || v.endsWith('.lock')) return false;
  if (v.includes('..') || v.includes('//') || v.includes('@{')) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(v)) return false;
  return v.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

const bad = error => ({ error, code: 'bad-request' });

// --- gh's answers ---

/** gh's words for the Actions view: the pull requests' missing-gh and not-found sentences, reworded. */
function reword(failure, notFound = NOT_FOUND) {
  if (!failure || failure.ok) return failure;
  if (failure.code === 'gh-missing') return { ...failure, error: GH_MISSING };
  if (failure.code === 'not-found') return { ...failure, error: notFound };
  return failure;
}

/** `gh api -i`'s output as { status, headers, body }, or null when it has no status line. */
function parseHttp(stdout) {
  const text = String(stdout || '');
  const first = /^HTTP\/[\d.]+ (\d{3})[^\n]*\n/.exec(text);
  if (!first) return null;
  const rest = text.slice(first[0].length);
  let head = rest;
  let body = '';
  const blank = /^\r?\n/.test(rest) ? { index: 0, 0: rest.match(/^\r?\n/)[0] } : /\r?\n\r?\n/.exec(rest);
  if (blank) {
    head = rest.slice(0, blank.index);
    body = rest.slice(blank.index + blank[0].length);
  }
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(first[1]), headers, body };
}

function noteRate(headers) {
  if (!headers || (headers['x-ratelimit-resource'] && headers['x-ratelimit-resource'] !== 'core')) return;
  const limit = Number(headers['x-ratelimit-limit']);
  const remaining = Number(headers['x-ratelimit-remaining']);
  const reset = Number(headers['x-ratelimit-reset']);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;
  rate = { limit, remaining, resetAt: Number.isFinite(reset) ? reset * 1000 : null };
}

function rateLimited(http) {
  const resetAt = Number(http.headers['x-ratelimit-reset']) * 1000;
  const retry = Number(http.headers['retry-after']);
  const when = Number.isFinite(retry) && retry > 0 ? Date.now() + retry * 1000 : (Number.isFinite(resetAt) ? resetAt : null);
  const at = when ? new Date(when).toTimeString().slice(0, 5) : null;
  return {
    error: at
      ? `GitHub's limit of requests for this hour is used up. It answers again at ${at}.`
      : 'GitHub is answering too many requests from this account. Try again in a minute.',
    code: 'rate-limited',
    resetAt: when,
  };
}

/**
 * One REST read with its ETag: { ok, body, fresh } (fresh: false when GitHub
 * answered 304 and the remembered answer stands), or an error result.
 */
async function restGet(target, apiPath, { accept = null, timeoutMs = pr.READ_TIMEOUT_MS } = {}) {
  const key = `${target.host} ${accept || ''} ${apiPath}`;
  const kept = cache.get(key);
  const args = ['api', '--hostname', target.host, '-i', apiPath];
  if (accept) args.push('-H', `Accept: ${accept}`);
  if (kept && kept.etag) args.push('-H', `If-None-Match: ${kept.etag}`);
  let result;
  try {
    result = await pr.run(args, { timeoutMs });
  } catch (err) {
    return reword(pr.thrownFailure(err));
  }
  const http = parseHttp(result.stdout);
  if (http) noteRate(http.headers);
  if (http && http.status === 304 && kept) {
    remember(cache, key, kept, MAX_CACHED);
    return { ok: true, body: kept.body, fresh: false };
  }
  if (http && http.status >= 200 && http.status < 300) {
    if (http.headers.etag) remember(cache, key, { etag: http.headers.etag, body: http.body }, MAX_CACHED);
    return { ok: true, body: http.body, fresh: true };
  }
  if (http && (http.status === 429 || (http.status === 403 && (http.headers['x-ratelimit-remaining'] === '0' || http.headers['retry-after'])))) {
    return rateLimited(http);
  }
  return pr.ghFailure({ ...result, code: result.code || 1 }, target);
}

async function restJson(target, apiPath, opts) {
  const answer = await restGet(target, apiPath, opts);
  if (!answer.ok) return answer;
  try {
    return { ok: true, json: JSON.parse(answer.body), fresh: answer.fresh };
  } catch {
    return { error: 'gh answered with something that is not GitHub data', code: 'gh-failed' };
  }
}

/** Every page of a list (up to MAX_PAGES of 100): { ok, items, total, truncated } or an error result. */
async function restPages(target, basePath, listKey, { max = MAX_PAGES } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= max; page++) {
    const answer = await restJson(target, `${basePath}${basePath.includes('?') ? '&' : '?'}per_page=${MAX_PER_PAGE}&page=${page}`);
    if (!answer.ok) return answer;
    const list = (Array.isArray(answer.json) ? answer.json : answer.json && answer.json[listKey]) || [];
    total = Number.isFinite(answer.json && answer.json.total_count) ? answer.json.total_count : items.length + list.length;
    items.push(...list);
    if (list.length < MAX_PER_PAGE || items.length >= total) break;
  }
  return { ok: true, items, total, truncated: items.length < total };
}

function repoPath(target) {
  return `repos/${target.owner}/${target.repo}`;
}

function rateNow() {
  return rate ? { ...rate } : null;
}

// --- The repository ---

const REPO_QUERY = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    nameWithOwner url viewerPermission isArchived isFork
    defaultBranchRef { name }
  }
}`;

function repoInfo(repository, target) {
  const info = pr.repositoryInfo(repository);
  return {
    nameWithOwner: info.nameWithOwner,
    url: info.url,
    host: target.host,
    owner: target.owner,
    repo: target.repo,
    permission: info.permission,
    canWrite: info.canWrite && !repository.isArchived,
    isAdmin: info.permission === 'ADMIN',
    archived: !!repository.isArchived,
    fork: !!repository.isFork,
    defaultBranch: (repository.defaultBranchRef && repository.defaultBranchRef.name) || null,
  };
}

async function readRepo(target) {
  const answer = await pr.graphql(target, REPO_QUERY, { owner: target.owner, repo: target.repo });
  if (!answer.ok) return reword(answer);
  return { ok: true, repo: repoInfo(answer.data.repository, target) };
}

async function withTarget(dir, remote) {
  const { target, failure } = await pr.targetFor(dir, remote || null);
  return failure ? { failure: reword(failure) } : { target };
}

// --- Workflows ---

function normalizeWorkflow(w) {
  const path = w.path || '';
  return {
    id: w.id,
    name: w.name || AM.fileName(path) || String(w.id),
    path,
    file: AM.fileName(path),
    state: w.state || 'active',
    url: w.html_url || '',
    badgeUrl: w.badge_url || '',
    // Copilot, Dependabot and code scanning runs: no file in the repository.
    dynamic: !path.startsWith('.github/workflows/'),
    createdAt: w.created_at || null,
    updatedAt: w.updated_at || null,
  };
}

/** The sidebar: every workflow of the repository, and what the account may do there. */
async function workflows(dir, { remote = null } = {}) {
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const [info, list, lockfile] = await Promise.all([
    readRepo(target),
    restPages(target, `${repoPath(target)}/actions/workflows`, 'workflows'),
    // Management's Lockfile, when the repository has one (workflow lockfiles, GitHub 2026-10).
    restGet(target, `${repoPath(target)}/contents/.github/workflows/actions.lock`, { accept: 'application/vnd.github.object' }),
  ]);
  if (!info.ok) return { ...info, ...pr.targetSummary(target) };
  if (!list.ok) return { ...reword(list), ...pr.targetSummary(target) };
  return {
    ok: true,
    ...pr.targetSummary(target),
    repo: info.repo,
    workflows: AM.sortWorkflows(list.items.map(normalizeWorkflow).filter(w => w.state !== 'deleted')),
    lockfile: !!lockfile.ok,
    totalCount: list.total,
    truncated: list.truncated,
    rate: rateNow(),
  };
}

// --- Runs ---

const login = user => (user && user.login) || '';

function firstLine(text) {
  return String(text || '').split('\n')[0];
}

function normalizeRun(r, target) {
  // A run's pull_requests also lists pull requests of other repositories (forks
  // that took the branch): only the repository's own count.
  const own = `/repos/${target.owner}/${target.repo}`.toLowerCase();
  const pullRequests = (r.pull_requests || [])
    .filter(p => p && p.base && p.base.repo && String(p.base.repo.url || '').toLowerCase().endsWith(own))
    .map(p => ({ number: p.number, head: (p.head && p.head.ref) || '', base: (p.base && p.base.ref) || '' }));
  const commit = r.head_commit || null;
  const headRepo = (r.head_repository && r.head_repository.full_name) || '';
  const baseRepo = (r.repository && r.repository.full_name) || '';
  return {
    id: r.id,
    number: r.run_number || 0,
    attempt: r.run_attempt || 1,
    title: r.display_title || r.name || '',
    workflowId: r.workflow_id || null,
    workflow: r.name || '',
    path: r.path || '',
    event: r.event || '',
    status: r.status || null,
    conclusion: r.conclusion || null,
    branch: r.head_branch || '',
    sha: r.head_sha || '',
    actor: login(r.actor),
    actorAvatar: (r.actor && r.actor.avatar_url) || null,
    triggeringActor: login(r.triggering_actor),
    headRepository: headRepo,
    fromFork: !!(headRepo && baseRepo && headRepo.toLowerCase() !== baseRepo.toLowerCase()),
    pullRequests,
    commit: commit ? { id: commit.id || '', message: firstLine(commit.message), author: (commit.author && commit.author.name) || '' } : null,
    createdAt: r.created_at || null,
    startedAt: r.run_started_at || null,
    updatedAt: r.updated_at || null,
    url: r.html_url || '',
    checkSuiteId: r.check_suite_id || null,
    checkSuiteNodeId: r.check_suite_node_id || null,
    referencedWorkflows: (r.referenced_workflows || []).map(w => ({ path: w.path || '', sha: w.sha || '', ref: w.ref || '' })),
  };
}

/**
 * The workflow `workflow:` names, by name or file, from the sidebar's list;
 * null when there is none.
 */
async function workflowNamed(target, name) {
  const list = await restPages(target, `${repoPath(target)}/actions/workflows`, 'workflows');
  if (!list.ok) return list;
  const wanted = String(name).toLowerCase();
  const found = list.items.find(w => String(w.name || '').toLowerCase() === wanted)
    || list.items.find(w => AM.fileName(w.path).toLowerCase() === wanted);
  return { ok: true, id: found ? found.id : null };
}

/**
 * One page of runs, newest first: of the workflow `workflowId` (an id or a
 * file name) or of all of them, filtered by the search box's qualifiers.
 * The free words are left to the view (`text`): the API has no text search.
 */
async function runs(dir, { remote = null, workflowId = null, page = 1, perPage = RUNS_PAGE, query = '' } = {}) {
  const pageNo = validInt(page, 1, MAX_RUN_PAGE);
  if (!pageNo) return bad('Not a page');
  const size = validInt(perPage, 1, MAX_PER_PAGE);
  if (!size) return bad('A page holds 1 to 100 runs');
  if (typeof query !== 'string' || query.length > MAX_QUERY) return bad('Not a search');
  let workflow = workflowId === null || workflowId === undefined || workflowId === '' ? null : workflowArg(workflowId);
  if (workflowId && !workflow) return bad('Not a workflow');
  const parsed = AM.parseQuery(query);
  const filters = AM.runFilters(parsed);
  if (filters.error) return bad(filters.error);
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const summary = pr.targetSummary(target);
  if (!workflow && filters.workflow) {
    const named = await workflowNamed(target, filters.workflow);
    if (!named.ok) return { ...reword(named), ...summary };
    if (!named.id) return { ok: true, ...summary, page: pageNo, perPage: size, total: 0, runs: [], text: parsed.text, notice: `No workflow is named "${filters.workflow}".`, rate: rateNow() };
    workflow = String(named.id);
  }
  const params = [`per_page=${size}`, `page=${pageNo}`];
  for (const [key, value] of Object.entries(filters.params)) params.push(`${key}=${encodeURIComponent(value)}`);
  const base = workflow ? `${repoPath(target)}/actions/workflows/${encodeURIComponent(workflow)}/runs` : `${repoPath(target)}/actions/runs`;
  const answer = await restJson(target, `${base}?${params.join('&')}`);
  if (!answer.ok) return { ...reword(answer, workflow ? 'GitHub does not know this workflow, or your account cannot see it.' : NOT_FOUND), ...summary };
  const list = (answer.json && answer.json.workflow_runs) || [];
  return {
    ok: true,
    ...summary,
    workflowId: workflow ? (validId(workflow) || workflow) : null,
    page: pageNo,
    perPage: size,
    total: (answer.json && answer.json.total_count) || 0,
    runs: list.map(r => normalizeRun(r, target)),
    text: parsed.text,
    fresh: answer.fresh,
    rate: rateNow(),
  };
}

// --- One run ---

function normalizeStep(s) {
  return {
    number: s.number,
    name: s.name || '',
    status: s.status || null,
    conclusion: s.conclusion || null,
    startedAt: s.started_at || null,
    completedAt: s.completed_at || null,
  };
}

function normalizeJob(j) {
  return {
    id: j.id,
    name: j.name || '',
    status: j.status || null,
    conclusion: j.conclusion || null,
    createdAt: j.created_at || null,
    startedAt: j.started_at || null,
    completedAt: j.completed_at || null,
    url: j.html_url || '',
    runId: j.run_id || null,
    attempt: j.run_attempt || 1,
    runnerName: j.runner_name || '',
    runnerGroup: j.runner_group_name || '',
    labels: Array.isArray(j.labels) ? j.labels : [],
    workflow: j.workflow_name || '',
    branch: j.head_branch || '',
    sha: j.head_sha || '',
    steps: (j.steps || []).filter(Boolean).map(normalizeStep),
  };
}

function normalizeArtifact(a) {
  return {
    id: a.id,
    name: a.name || '',
    size: a.size_in_bytes || 0,
    digest: a.digest || null,
    expired: !!a.expired,
    createdAt: a.created_at || null,
    updatedAt: a.updated_at || null,
    expiresAt: a.expires_at || null,
  };
}

function normalizePending(p) {
  const env = p.environment || {};
  return {
    environment: { id: env.id || null, name: env.name || '', url: env.html_url || '' },
    waitTimer: p.wait_timer || 0,
    waitTimerStartedAt: p.wait_timer_started_at || null,
    canApprove: !!p.current_user_can_approve,
    reviewers: (p.reviewers || []).filter(Boolean).map(r => ({
      type: r.type || '',
      name: (r.reviewer && (r.reviewer.login || r.reviewer.slug || r.reviewer.name)) || '',
    })),
  };
}

function normalizeApproval(a) {
  return {
    state: a.state || '',
    user: login(a.user),
    comment: a.comment || '',
    environments: (a.environments || []).filter(Boolean).map(e => e.name || ''),
  };
}

function normalizeConcurrency(json) {
  const groups = (json && (json.concurrency_groups || json.groups)) || [];
  return groups.filter(Boolean).map(g => ({
    name: g.group_name || g.name || '',
    members: (g.group_members || g.members || []).filter(Boolean).map(m => ({
      runId: m.run_id || null, jobId: m.job_id || null, status: m.status || '', position: Number.isFinite(m.position) ? m.position : null,
    })),
  }));
}

function normalizeAnnotation(a) {
  return {
    path: a.path || '',
    startLine: a.start_line || null,
    endLine: a.end_line || null,
    startColumn: a.start_column || null,
    endColumn: a.end_column || null,
    level: String(a.annotation_level || 'notice').toLowerCase(), // notice | warning | failure
    title: a.title || '',
    message: a.message || '',
    details: a.raw_details || '',
    url: a.blob_href || '',
  };
}

const ANNOTATIONS_QUERY = `query($id: ID!, $after: String) {
  node(id: $id) {
    ... on CheckSuite {
      checkRuns(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          databaseId
          annotations(first: ${ANNOTATIONS_PER_JOB}) {
            totalCount
            nodes { path title message rawDetails annotationLevel location { start { line column } end { line column } } }
          }
        }
      }
    }
  }
}`;

/**
 * The annotations of a run's jobs, by job id, in one GraphQL read of the run's
 * check suite (a job is a check run) instead of one REST read per job.
 */
async function runAnnotations(target, nodeId) {
  if (typeof nodeId !== 'string' || !/^[A-Za-z0-9_=+/-]{4,200}$/.test(nodeId)) return {};
  const byJob = {};
  let after = null;
  for (let page = 0; page < 5; page++) {
    const answer = await pr.graphql(target, ANNOTATIONS_QUERY, { id: nodeId, after }, pr.READ_TIMEOUT_MS, { repository: false });
    if (!answer.ok) return byJob;
    const connection = answer.data && answer.data.node && answer.data.node.checkRuns;
    if (!connection) return byJob;
    for (const run of connection.nodes || []) {
      if (!run || !run.databaseId) continue;
      const list = ((run.annotations && run.annotations.nodes) || []).filter(Boolean).map(a => ({
        path: a.path || '',
        startLine: (a.location && a.location.start && a.location.start.line) || null,
        endLine: (a.location && a.location.end && a.location.end.line) || null,
        startColumn: (a.location && a.location.start && a.location.start.column) || null,
        endColumn: (a.location && a.location.end && a.location.end.column) || null,
        level: String(a.annotationLevel || 'NOTICE').toLowerCase(),
        title: a.title || '',
        message: a.message || '',
        details: a.rawDetails || '',
        url: '',
      }));
      if (list.length) byJob[run.databaseId] = { items: list, total: (run.annotations && run.annotations.totalCount) || list.length };
    }
    if (!connection.pageInfo || !connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  return byJob;
}

// A run "Run workflow" has just started can be a 404 for a moment even after
// GitHub has answered 200 for it (its copies catch up): a 404 is tried again
// before the view says "Not found" (the tests shorten this).
const RUN_RETRY = { tries: 3, delayMs: 1500 };

/**
 * One run as its summary page shows it. With `attempt`, that attempt and its
 * jobs; `attempts` says how many there are.
 */
async function run(dir, { remote = null, runId, attempt = null } = {}) {
  const id = validId(runId);
  if (!id) return bad('Not a workflow run');
  const attemptNo = attempt === null || attempt === undefined ? null : validInt(attempt, 1, 100);
  if (attempt !== null && attempt !== undefined && !attemptNo) return bad('Not an attempt');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const summary = pr.targetSummary(target);
  const base = `${repoPath(target)}/actions/runs/${id}`;
  const runPath = attemptNo ? `${base}/attempts/${attemptNo}` : base;
  const jobsPath = attemptNo ? `${base}/attempts/${attemptNo}/jobs` : `${base}/jobs?filter=latest`;
  let runAnswer, latest, jobs, artifacts;
  for (let i = 0; i < RUN_RETRY.tries; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, RUN_RETRY.delayMs));
    [runAnswer, latest, jobs, artifacts] = await Promise.all([
      restJson(target, runPath),
      attemptNo ? restJson(target, base) : null,
      restPages(target, jobsPath, 'jobs'),
      restPages(target, `${base}/artifacts`, 'artifacts', { max: 3 }),
    ]);
    if (runAnswer.code !== 'not-found' && jobs.code !== 'not-found') break;
  }
  const notFound = 'GitHub does not know this workflow run, or your account cannot see it.';
  if (!runAnswer.ok) return { ...reword(runAnswer, notFound), ...summary };
  if (!jobs.ok) return { ...reword(jobs, notFound), ...summary };
  const theRun = normalizeRun(runAnswer.json, target);
  const result = {
    ok: true,
    ...summary,
    run: theRun,
    attempt: attemptNo || theRun.attempt,
    attempts: latest && latest.ok ? (latest.json.run_attempt || theRun.attempt) : theRun.attempt,
    jobs: jobs.items.map(normalizeJob),
    jobsTruncated: jobs.truncated,
    artifacts: artifacts.ok ? artifacts.items.map(normalizeArtifact).filter(a => !a.expired) : [],
    pendingDeployments: [],
    approvals: [],
    concurrency: [],
    annotations: {},
    workflow: { jobs: [], error: null, dynamic: !isWorkflowPath(theRun.path) },
  };
  const extra = [];
  if (theRun.status === 'waiting') {
    extra.push(restJson(target, `${base}/pending_deployments`).then((a) => {
      if (a.ok && Array.isArray(a.json)) result.pendingDeployments = a.json.filter(Boolean).map(normalizePending);
    }));
    extra.push(restJson(target, `${base}/approvals`).then((a) => {
      if (a.ok && Array.isArray(a.json)) result.approvals = a.json.filter(Boolean).map(normalizeApproval);
    }));
  }
  if (theRun.status === 'pending' || theRun.status === 'queued') {
    extra.push(restJson(target, `${base}/concurrency_groups`).then((a) => {
      if (a.ok) result.concurrency = normalizeConcurrency(a.json);
    }));
  }
  if (result.jobs.some(j => j.status === 'completed')) {
    extra.push(runAnnotations(target, theRun.checkSuiteNodeId).then((byJob) => {
      const ids = new Set(result.jobs.map(j => j.id));
      for (const [jobId, list] of Object.entries(byJob)) if (ids.has(Number(jobId))) result.annotations[jobId] = list;
    }));
  }
  if (!result.workflow.dynamic && isSha(theRun.sha)) {
    extra.push(workflowFileAt(target, theRun.path, theRun.sha).then((file) => {
      if (file.ok) result.workflow.jobs = file.parsed.jobs;
      else result.workflow.error = file.error;
    }));
  }
  await Promise.all(extra);
  result.rate = rateNow();
  return result;
}

// --- One job ---

/** A job with its steps and annotations, as its page shows it. */
async function job(dir, { remote = null, jobId } = {}) {
  const id = validId(jobId);
  if (!id) return bad('Not a job');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const [jobAnswer, annotations] = await Promise.all([
    restJson(target, `${repoPath(target)}/actions/jobs/${id}`),
    restPages(target, `${repoPath(target)}/check-runs/${id}/annotations`, null, { max: 3 }),
  ]);
  if (!jobAnswer.ok) return { ...reword(jobAnswer, 'GitHub does not know this job, or your account cannot see it.'), ...pr.targetSummary(target) };
  return {
    ok: true,
    ...pr.targetSummary(target),
    job: normalizeJob(jobAnswer.json),
    annotations: annotations.ok ? annotations.items.filter(Boolean).map(normalizeAnnotation) : [],
    rate: rateNow(),
  };
}

/**
 * The log of one step of a job, with its timestamps: GitHub gives it once the
 * step has finished, even while later steps still run. A finished step's log
 * does not change, so it is kept.
 */
async function stepLog(dir, { remote = null, jobId, step } = {}) {
  const id = validId(jobId);
  if (!id) return bad('Not a job');
  const number = validInt(step, 1, 1000);
  if (!number) return bad('Not a step');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const key = `${target.host}/${target.owner}/${target.repo}/${id}/${number}`;
  const kept = logs.get(key);
  if (kept) return { ok: true, jobId: id, step: number, ...kept };
  let result;
  try {
    result = await detail.readLog(target, `${repoPath(target)}/actions/jobs/${id}/steps/${number}/logs`);
  } catch (err) {
    return reword(pr.thrownFailure(err));
  }
  if (result.code !== 0) {
    const failed = pr.ghFailure(result, target);
    if (failed.code === 'not-found') return { error: 'This step has not finished yet: GitHub gives its log once it has.', code: 'not-found', pending: true };
    return reword(failed);
  }
  const log = detail.cleanLog(result.stdout, detail.MAX_LOG_BYTES, { timestamps: true });
  remember(logs, key, log, MAX_LOGS);
  return { ok: true, jobId: id, step: number, ...log };
}

/** The log of a whole job, with its timestamps (for Download log and the raw view). */
async function jobLog(dir, { remote = null, jobId } = {}) {
  const answer = await detail.jobLog(dir, { remote, jobId, timestamps: true });
  return reword(answer, 'GitHub has no log of this job, or not yet: a log comes once the job has finished.');
}

// --- Workflow files ---

function needsOf(value) {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
}

function scalar(value) {
  return value === undefined || value === null || typeof value === 'object' ? '' : String(value);
}

/**
 * What the view needs of a workflow file: its name, the events it runs on,
 * the "Run workflow" fields (null without workflow_dispatch), its schedule and
 * its jobs with their needs. A file YAML cannot read gives { error }.
 */
function parseWorkflow(text) {
  let doc;
  try {
    doc = yaml.load(String(text || ''), { json: true });
  } catch (err) {
    return { error: `The workflow file is not valid YAML: ${String(err.reason || err.message || err).split('\n')[0]}` };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'The workflow file has no workflow in it.' };
  const on = doc.on === undefined ? doc.true : doc.on; // YAML 1.1 readers turn `on` into true
  let events = [];
  let triggers = {};
  if (typeof on === 'string') events = [on];
  else if (Array.isArray(on)) events = on.filter(e => typeof e === 'string');
  else if (on && typeof on === 'object') { triggers = on; events = Object.keys(on); }
  const dispatch = events.includes('workflow_dispatch')
    ? AM.dispatchFields(triggers.workflow_dispatch && triggers.workflow_dispatch.inputs)
    : null;
  const schedule = Array.isArray(triggers.schedule)
    ? triggers.schedule.filter(s => s && typeof s.cron === 'string').map(s => ({ cron: s.cron, timezone: scalar(s.timezone) }))
    : [];
  const jobsDoc = doc.jobs && typeof doc.jobs === 'object' && !Array.isArray(doc.jobs) ? doc.jobs : {};
  const jobs = Object.keys(jobsDoc).map((key) => {
    const def = jobsDoc[key] && typeof jobsDoc[key] === 'object' ? jobsDoc[key] : {};
    return {
      key,
      name: scalar(def.name) || key,
      needs: needsOf(def.needs),
      matrix: !!(def.strategy && typeof def.strategy === 'object' && def.strategy.matrix),
      uses: typeof def.uses === 'string' ? def.uses : null,
      environment: typeof def.environment === 'string' ? def.environment : scalar(def.environment && def.environment.name),
    };
  });
  return { name: scalar(doc.name), runName: scalar(doc['run-name']), events, dispatch, schedule, jobs };
}

/** A workflow file at a commit (kept: it cannot change) or a branch (with its ETag), parsed. */
async function workflowFileAt(target, filePath, ref) {
  const key = `${target.host}/${target.owner}/${target.repo}/${filePath}@${ref}`;
  if (isSha(ref) && files.has(key)) return { ok: true, ...files.get(key) };
  const answer = await restGet(target, `${repoPath(target)}/contents/${filePath}?ref=${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.raw' });
  if (!answer.ok) return reword(answer, `There is no ${filePath} at ${isSha(ref) ? AM.shortSha(ref) : ref}.`);
  if (Buffer.byteLength(answer.body) > MAX_FILE_BYTES) return { error: 'The workflow file is larger than the app reads.', code: 'gh-failed' };
  const parsed = parseWorkflow(answer.body);
  if (parsed.error) return { error: parsed.error, code: 'bad-workflow', text: answer.body };
  const entry = { text: answer.body, parsed };
  if (isSha(ref)) remember(files, key, entry, 100);
  return { ok: true, ...entry };
}

/** A workflow file as the run's "Workflow file" page or "View workflow file" shows it. */
async function workflowFile(dir, { remote = null, path: filePath, ref } = {}) {
  if (!isWorkflowPath(filePath)) return bad('Not a workflow file');
  if (!isRef(ref)) return bad('Not a branch, tag or commit');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const file = await workflowFileAt(target, filePath, ref);
  if (!file.ok && file.code !== 'bad-workflow') return file;
  return { ok: true, path: filePath, ref, text: file.text || '', parsed: file.ok ? file.parsed : null, error: file.ok ? null : file.error };
}

/**
 * What "Run workflow" offers for a workflow at a branch or tag: its fields,
 * the environments for an environment input, and whether it can run at all
 * (workflow_dispatch in the file, the workflow active).
 */
async function dispatchForm(dir, { remote = null, workflowId, ref = null } = {}) {
  const workflow = workflowArg(workflowId);
  if (!workflow) return bad('Not a workflow');
  if (ref !== null && ref !== undefined && !isRef(ref)) return bad('Not a branch or tag');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const [info, wf] = await Promise.all([readRepo(target), restJson(target, `${repoPath(target)}/actions/workflows/${encodeURIComponent(workflow)}`)]);
  if (!info.ok) return info;
  if (!wf.ok) return reword(wf, 'GitHub does not know this workflow, or your account cannot see it.');
  const meta = normalizeWorkflow(wf.json);
  const chosen = ref || info.repo.defaultBranch;
  const answer = { ok: true, workflow: meta, ref: chosen, defaultBranch: info.repo.defaultBranch, canWrite: info.repo.canWrite, fields: [], environments: [], events: [], schedule: [], available: false, reason: '' };
  if (meta.dynamic) return { ...answer, reason: 'GitHub runs this workflow itself: it has no file to run by hand.' };
  if (!chosen) return { ...answer, reason: 'The repository has no default branch.' };
  const file = await workflowFileAt(target, meta.path, chosen);
  if (!file.ok) return { ...answer, reason: file.error };
  answer.events = file.parsed.events;
  answer.schedule = file.parsed.schedule;
  if (!file.parsed.dispatch) return { ...answer, reason: `${meta.file} at ${chosen} has no workflow_dispatch trigger.` };
  answer.fields = file.parsed.dispatch;
  answer.available = meta.state === 'active';
  if (!answer.available) answer.reason = 'The workflow is disabled: enable it to run it.';
  if (answer.fields.some(f => f.type === 'environment')) {
    const envs = await restJson(target, `${repoPath(target)}/environments?per_page=100`);
    if (envs.ok) answer.environments = ((envs.json && envs.json.environments) || []).filter(Boolean).map(e => e.name).filter(Boolean);
  }
  return answer;
}

const REFS_QUERY = `query($owner: String!, $repo: String!, $query: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    heads: refs(refPrefix: "refs/heads/", first: 50, query: $query, orderBy: { field: ALPHABETICAL, direction: ASC }) { totalCount nodes { name } }
    tags: refs(refPrefix: "refs/tags/", first: 50, query: $query, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { totalCount nodes { name } }
  }
}`;

/** The branches and tags matching `query`, for "Use workflow from" and the Branch filter. */
async function refs(dir, { remote = null, query = null } = {}) {
  if (query !== null && query !== undefined && (typeof query !== 'string' || query.length > MAX_QUERY)) return bad('Not a search');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const answer = await pr.graphql(target, REFS_QUERY, { owner: target.owner, repo: target.repo, query: query || null });
  if (!answer.ok) return reword(answer);
  const repository = answer.data.repository;
  const names = connection => ((connection && connection.nodes) || []).filter(Boolean).map(n => n.name).filter(Boolean);
  const defaultBranch = (repository.defaultBranchRef && repository.defaultBranchRef.name) || null;
  const branches = names(repository.heads);
  if (defaultBranch && !branches.includes(defaultBranch) && (!query || defaultBranch.toLowerCase().includes(String(query).toLowerCase()))) branches.unshift(defaultBranch);
  return { ok: true, defaultBranch, branches, tags: names(repository.tags) };
}

// --- Management ---

const CACHE_SORTS = ['last_accessed_at', 'created_at', 'size_in_bytes'];
const CACHES_PAGE = 30;
const isCacheRef = v => typeof v === 'string' && /^refs\/(heads|tags|pull)\/\S{1,250}$/.test(v) && !/[\x00-\x20\x7f]/.test(v);

function normalizeCache(c) {
  return {
    id: c.id,
    key: c.key || '',
    ref: c.ref || '',
    version: c.version || '',
    size: c.size_in_bytes || 0,
    createdAt: c.created_at || null,
    lastAccessedAt: c.last_accessed_at || null,
  };
}

/** One page of the repository's caches, with what they take together, as the Caches page lists them. */
async function caches(dir, { remote = null, ref = null, key = null, sort = 'last_accessed_at', direction = 'desc', page = 1 } = {}) {
  if (!CACHE_SORTS.includes(sort)) return bad('Not a way to sort caches');
  if (direction !== 'asc' && direction !== 'desc') return bad('Not a direction');
  const pageNo = validInt(page, 1, 1000);
  if (!pageNo) return bad('Not a page');
  if (ref !== null && ref !== undefined && ref !== '' && !isCacheRef(ref)) return bad('Not a branch (refs/heads/…)');
  if (key !== null && key !== undefined && (typeof key !== 'string' || key.length > 512 || /[\x00-\x1f\x7f]/.test(key))) return bad('Not a cache key');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const params = [`per_page=${CACHES_PAGE}`, `page=${pageNo}`, `sort=${sort}`, `direction=${direction}`];
  if (ref) params.push(`ref=${encodeURIComponent(ref)}`);
  if (key) params.push(`key=${encodeURIComponent(key)}`);
  const [list, usage] = await Promise.all([
    restJson(target, `${repoPath(target)}/actions/caches?${params.join('&')}`),
    restJson(target, `${repoPath(target)}/actions/cache/usage`),
  ]);
  if (!list.ok) return { ...reword(list), ...pr.targetSummary(target) };
  return {
    ok: true,
    ...pr.targetSummary(target),
    caches: ((list.json && list.json.actions_caches) || []).filter(Boolean).map(normalizeCache),
    total: (list.json && list.json.total_count) || 0,
    page: pageNo,
    perPage: CACHES_PAGE,
    usage: usage.ok && usage.json ? { count: usage.json.active_caches_count || 0, size: usage.json.active_caches_size_in_bytes || 0 } : null,
    rate: rateNow(),
  };
}

function normalizeRunner(r) {
  const online = r.status === 'online';
  return {
    id: r.id,
    name: r.name || '',
    os: r.os || '',
    // Idle, Active (running a job) or Offline, as GitHub's Runners page says.
    status: !online ? 'offline' : (r.busy ? 'active' : 'idle'),
    busy: !!r.busy,
    ephemeral: !!r.ephemeral,
    labels: (r.labels || []).filter(Boolean).map(l => ({ name: l.name || '', custom: l.type === 'custom' })),
  };
}

/** The repository's self-hosted runners: GitHub shows them to its admins only. */
async function runners(dir, { remote = null } = {}) {
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const info = await readRepo(target);
  if (!info.ok) return info;
  if (!info.repo.isAdmin) return { ok: true, ...pr.targetSummary(target), admin: false, runners: [], total: 0, repo: info.repo };
  const list = await restPages(target, `${repoPath(target)}/actions/runners`, 'runners', { max: 3 });
  if (!list.ok) return { ...reword(list), ...pr.targetSummary(target) };
  return { ok: true, ...pr.targetSummary(target), admin: true, runners: list.items.filter(Boolean).map(normalizeRunner), total: list.total, repo: info.repo, rate: rateNow() };
}

const DEPLOYMENTS_QUERY = `query($owner: String!, $repo: String!, $envs: [String!], $after: String) {
  repository(owner: $owner, name: $repo) {
    environments(first: 100) { totalCount nodes { databaseId name } }
    deployments(first: 30, after: $after, environments: $envs, orderBy: { field: CREATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        databaseId environment state task description commitOid createdAt updatedAt
        ref { name }
        creator { login }
        latestStatus { state description logUrl environmentUrl createdAt }
      }
    }
  }
}`;

function normalizeDeployment(d) {
  const status = d.latestStatus || {};
  return {
    id: d.databaseId,
    environment: d.environment || '',
    state: String(d.state || '').toLowerCase(), // active, inactive, in_progress, queued, pending, waiting, success, failure, error, destroyed, abandoned
    task: d.task || '',
    description: d.description || '',
    sha: d.commitOid || '',
    ref: (d.ref && d.ref.name) || '',
    creator: login(d.creator),
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
    status: String(status.state || '').toLowerCase(),
    statusDescription: status.description || '',
    logUrl: status.logUrl || '',
    environmentUrl: status.environmentUrl || '',
    // A log on GitHub Actions opens in the Actions view itself.
    actions: AM.parseActionsUrl(status.logUrl || ''),
  };
}

/**
 * The Deployments page: the environments, each with its latest active
 * deployment among those read, and the deployments newest first (of one
 * environment, or all), 30 at a time.
 */
async function deployments(dir, { remote = null, environment = null, after = null } = {}) {
  if (environment !== null && environment !== undefined && (typeof environment !== 'string' || !environment || environment.length > 255)) return bad('Not an environment');
  if (!pr.validCursor(after)) return bad('Not a page cursor');
  const { target, failure } = await withTarget(dir, remote);
  if (failure) return failure;
  const answer = await pr.graphql(target, DEPLOYMENTS_QUERY, { owner: target.owner, repo: target.repo, envs: environment ? [environment] : null, after: after || null });
  if (!answer.ok) return { ...reword(answer), ...pr.targetSummary(target) };
  const repository = answer.data.repository;
  const connection = repository.deployments || {};
  const list = (connection.nodes || []).filter(Boolean).map(normalizeDeployment);
  const environments = ((repository.environments && repository.environments.nodes) || []).filter(Boolean).map(e => ({
    id: e.databaseId,
    name: e.name,
    active: list.find(d => d.environment === e.name && d.state === 'active') || null,
  }));
  return {
    ok: true,
    ...pr.targetSummary(target),
    environments,
    deployments: list,
    totalCount: connection.totalCount || 0,
    hasNextPage: !!(connection.pageInfo && connection.pageInfo.hasNextPage),
    endCursor: (connection.pageInfo && connection.pageInfo.endCursor) || null,
  };
}

module.exports = {
  workflows, runs, run, job, stepLog, jobLog, workflowFile, dispatchForm, refs, caches, runners, deployments,
  // for actions-edits.js and the Management reads
  restGet, restJson, restPages, withTarget, readRepo, reword, repoPath, rateNow, normalizeRun, workflowArg, isRef, validId, validInt,
  // exported for tests
  RUN_RETRY, parseHttp, parseWorkflow, normalizeJob, normalizeArtifact, normalizePending, normalizeAnnotation, resetCaches,
  RUNS_PAGE, ANNOTATIONS_QUERY, REPO_QUERY, REFS_QUERY, DEPLOYMENTS_QUERY, normalizeCache, normalizeRunner, normalizeDeployment,
};
