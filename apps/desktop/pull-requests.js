// pull-requests.js — the Git tab's Pull Requests view, through the GitHub CLI.
//
// The app keeps no GitHub credentials: `gh` already holds the user's login
// (github.com and Enterprise hosts alike), so every read and every action is a
// `gh` command. A gh installed on the computer comes first; without one the
// view runs the gh the app carries (resources/bin, scripts/after-pack-gh.js),
// which reads the same login (~/.config/gh and the system keychain):
//
//   - the list: `gh api graphql`, with the query and its variables as JSON on
//     stdin. GraphQL gives real cursors (`gh pr list` has no offset), so the
//     closed and merged pull requests come 10 at a time while the open ones are
//     all read, 100 per request;
//   - a pull request's files, each with its own patch: the REST endpoint
//     `pulls/{n}/files`, one JSON object per line through `--jq`;
//   - the actions: `gh pr merge | ready [--undo] | close | reopen`; every other
//     change (title, comments, reviews…) is in pull-request-edits.js.
//
// Every command names the repository with `-R` (or `--hostname` and the
// owner/name in the query) and runs outside the repository's folder, so `gh`
// never touches the local checkout: with `-R`, `gh pr merge --delete-branch`
// deletes the remote branch only, never the local one, and never checks out
// another branch under a running session. That also keeps `gh` from asking
// which of several remotes it should use.
//
// Only fixed arguments reach `gh`: actions and merge methods come from
// whitelists, the pull request number must be a positive integer and the head
// commit a full hash. Like git-graph-service.js this is a singleton set up with
// init(ctx), so tests can hand it a fake `runGh` and a fake `git`.

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findBinary, pathWithHomebrew } = require('./find-binary');
const { buildPtyEnv } = require('./pty-env');

const READ_TIMEOUT_MS = 30_000;
const FILES_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const OPEN_PAGE_SIZE = 100;
const MIN_OPEN_PAGE_SIZE = 25;
const MAX_OPEN = 1000; // open pull requests listed at most
const MAX_OPEN_REQUESTS = 40; // 1000 in pages of 25, the smallest
const MAX_PAGE_SIZE = 100;
const MAX_PATCH_BYTES = 4 * 1024 * 1024; // all the patches of one pull request together
const MAX_FILES = 3000; // what GitHub itself lists at most
const MERGE_METHODS = ['merge', 'squash', 'rebase'];
const ACTIONS = ['merge', 'draft', 'ready', 'close', 'reopen'];
const PAGE_STATES = ['CLOSED', 'MERGED'];
const WRITE_PERMISSIONS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

const GH_MISSING = 'The GitHub CLI (gh) is needed to list pull requests. Install it with "brew install gh", then sign in with "gh auth login".';
const NO_GITHUB_REMOTE = 'This repository has no GitHub remote.';

let log = { info() {}, error() {} };
let git = null;
let runGh = defaultRunGh;
let find = findBinary;
const inFlight = new Set(); // repository folders with an action running

function init(ctx = {}) {
  if (ctx.log) log = ctx.log;
  git = ctx.git || null;
  runGh = ctx.runGh || defaultRunGh;
  find = ctx.findBinary || findBinary;
  inFlight.clear();
}

function loadGit() {
  if (!git) git = require('./git');
  return git;
}

// --- Running gh ---

function ghEnv(source = process.env) {
  return {
    ...buildPtyEnv(source),
    PATH: pathWithHomebrew(source.PATH || ''),
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GH_SPINNER_DISABLED: '1',
    NO_COLOR: '1',
    CLICOLOR: '0',
    GH_PAGER: '',
    PAGER: 'cat',
  };
}

/**
 * The gh the view runs, as { path, source }: SWITCHBOARD_GH when it names one,
 * then a gh installed on the computer (PATH, then Homebrew's folders), then
 * the one in the app (resources/bin). Null when there is none.
 */
function locateGh({ override = process.env.SWITCHBOARD_GH, finder = find, resourcesPath = process.resourcesPath, exists = fs.existsSync, platform = process.platform } = {}) {
  const exe = platform === 'win32' ? 'gh.exe' : 'gh';
  if (override && exists(override)) return { path: override, source: 'override' };
  const installed = finder(exe);
  if (installed) return { path: installed, source: 'installed' };
  const bundled = resourcesPath ? path.join(resourcesPath, 'bin', exe) : null;
  if (bundled && exists(bundled)) return { path: bundled, source: 'bundled' };
  return null;
}

function missingError() {
  const err = new Error(GH_MISSING);
  err.code = 'gh-missing';
  return err;
}

/**
 * Run gh with `args`, `input` on stdin; resolves to { stdout, stderr, code, gh }
 * whatever the exit code, `gh` being which one ran (locateGh).
 */
function defaultRunGh(args, { input = null, timeoutMs = READ_TIMEOUT_MS } = {}) {
  const gh = locateGh();
  if (!gh) return Promise.reject(missingError());
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = cp.spawn(gh.path, args, { cwd: os.tmpdir(), env: ghEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err.code === 'ENOENT' ? missingError() : err);
      return;
    }
    const out = [];
    const errOut = [];
    let size = 0;
    let failure = null;
    const stop = (err) => { if (!failure) failure = err; try { child.kill('SIGTERM'); } catch {} };
    const timer = setTimeout(() => stop(new Error(`gh did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) stop(new Error('gh answered with more data than the app reads'));
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk) => { if (errOut.length < 256) errOut.push(chunk); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? missingError() : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) { reject(failure); return; }
      resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8'), code, gh });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? '' : input);
  });
}

/** gh's own words, without colours, the ✓/X/! it puts in front, or the GraphQL wrapping of an API error. */
function cleanGhText(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map(line => line
      .replace(/^\s*(?:[✓✔✗✘!X]|gh:)\s+/u, '')
      // "GraphQL: Head branch was modified. (mergePullRequest)"
      .replace(/^GraphQL:\s*/, '')
      .replace(/\s*\([a-z]+[A-Z][A-Za-z]*\)$/, '')
      .trim())
    .filter(Boolean)
    .join('\n');
}

/** An error result for a gh run that failed, in words the view can show as they are. */
function ghFailure(result, target) {
  const text = cleanGhText(`${result.stderr || ''}\n${result.code ? '' : result.stdout || ''}`);
  if (result.code === 4 || /gh auth login|not logged in|authentication required|HTTP 401|Bad credentials/i.test(text)) {
    const host = target && target.host && target.host !== 'github.com' ? ` --hostname ${target.host}` : '';
    // The gh in the app is not on PATH: the command names it in full.
    const error = result.gh && result.gh.source === 'bundled'
      ? `Sign in to GitHub: in a terminal, run "${result.gh.path}" auth login${host}, then try again.`
      : `Sign in to GitHub with "gh auth login${host}" in a terminal, then try again.`;
    return { error, code: 'gh-auth' };
  }
  // --match-head-commit: the branch moved on since the list was read.
  if (/Head branch was modified/i.test(text)) {
    return { error: 'New commits reached the branch since the list was read. Look at them, then merge again.', code: 'gh-failed' };
  }
  if (/Could not resolve to a (Repository|PullRequest)|HTTP 404/i.test(text)) {
    return { error: 'GitHub does not know this repository or pull request, or your account cannot see it.', code: 'not-found' };
  }
  return { error: text || `gh stopped with exit code ${result.code}`, code: 'gh-failed' };
}

/** A thrown error (gh missing, timed out, could not start) as a result. */
function thrownFailure(err) {
  if (err && err.code === 'gh-missing') return { error: GH_MISSING, code: 'gh-missing' };
  return { error: (err && err.message) || String(err), code: 'gh-failed' };
}

// --- Which repository ---

/** { host, owner, repo } from an https://, ssh:// or scp-like (git@host:owner/repo) URL, or null. */
function parseGitHubRemote(url) {
  if (!url || typeof url !== 'string') return null;
  const text = url.trim();
  let m = /^[a-zA-Z][\w+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(text);
  if (!m) m = /^(?:[^@\s/]+@)?([^:\s/]{2,}):(?!\/)(.+?)(?:\.git)?\/?$/.exec(text);
  if (!m) return null;
  let host = m[1].toLowerCase();
  // An ssh alias for a second account (Host github.com-work in ~/.ssh/config)
  // and GitHub's ssh-over-443 host are github.com to gh.
  if (host === 'ssh.github.com' || host.startsWith('github.com-')) host = 'github.com';
  const parts = m[2].split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { host, owner, repo };
}

/** github.com, GitHub Enterprise Cloud (*.ghe.com), and Enterprise servers with "github" in their name. */
function isGitHubHost(host) {
  if (!host) return false;
  return host === 'github.com' || host.endsWith('.ghe.com') || /(^|[.-])github([.-]|$)/.test(host);
}

/** -R's value: OWNER/REPO on github.com, HOST/OWNER/REPO elsewhere. */
function repoArg(target) {
  return target.host === 'github.com' ? `${target.owner}/${target.repo}` : `${target.host}/${target.owner}/${target.repo}`;
}

/**
 * The GitHub remotes of a repository and the one to use: `remoteName` when it
 * is one of them, else the one `gh repo set-default` marked, else origin, else
 * upstream, else the first. Null when no remote is on GitHub.
 */
async function resolveRepo(dir, remoteName) {
  const g = loadGit();
  const list = await g.remoteList(dir);
  const remotes = [];
  for (const remote of list) {
    const parsed = parseGitHubRemote(remote.url);
    if (parsed && isGitHubHost(parsed.host)) remotes.push({ name: remote.name, ...parsed });
  }
  if (!remotes.length) return null;
  let chosen = remoteName ? remotes.find(r => r.name === remoteName) : null;
  if (!chosen) {
    const config = await Promise.resolve(g.configListIncludes(dir)).catch(() => []);
    for (const entry of config || []) {
      const m = /^remote\.(.+)\.gh-resolved$/.exec(entry.key || '');
      if (!m) continue;
      const remote = remotes.find(r => r.name === m[1]);
      if (!remote) continue;
      const value = String(entry.value || '').trim();
      if (value === 'base') { chosen = remote; break; }
      // gh repo set-default can also name another repository on that host.
      const other = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
      if (other) { chosen = { ...remote, owner: other[1], repo: other[2] }; break; }
    }
  }
  if (!chosen) chosen = remotes.find(r => r.name === 'origin') || remotes.find(r => r.name === 'upstream') || remotes[0];
  return {
    remote: chosen.name,
    host: chosen.host,
    owner: chosen.owner,
    repo: chosen.repo,
    remotes: remotes.map(r => ({ name: r.name, host: r.host, slug: `${r.owner}/${r.repo}` })),
  };
}

// --- Listing ---

const PR_FIELDS = `id number title url state isDraft createdAt updatedAt closedAt mergedAt
        author { login }
        headRefName headRefOid baseRefName isCrossRepository
        additions deletions changedFiles mergeable reviewDecision viewerDidAuthor
        viewerCanUpdate viewerCanReopen
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

const LIST_QUERY = `query($owner: String!, $repo: String!, $states: [PullRequestState!], $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    nameWithOwner url viewerPermission
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod deleteBranchOnMerge
    pullRequests(states: $states, first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ${PR_FIELDS}
      }
    }
  }
}`;

/**
 * One GraphQL request through gh, `{ ok, data }` or an error result. A read
 * starts at `repository` and fails without one; a mutation passes
 * `{ repository: false }`.
 */
async function graphql(target, query, variables, timeoutMs = READ_TIMEOUT_MS, { repository = true } = {}) {
  let result;
  try {
    result = await runGh(['api', 'graphql', '--hostname', target.host, '--input', '-'], {
      input: JSON.stringify({ query, variables }),
      timeoutMs,
    });
  } catch (err) {
    return thrownFailure(err);
  }
  let json = null;
  try { json = JSON.parse(result.stdout); } catch {}
  if (json && Array.isArray(json.errors) && json.errors.length) {
    return ghFailure({ code: 1, stderr: json.errors.map(e => e && e.message).filter(Boolean).join('\n') }, target);
  }
  if (result.code !== 0) return ghFailure(result, target);
  if (!json || !json.data) return { error: 'gh answered with something that is not GitHub data', code: 'gh-failed' };
  if (repository && !json.data.repository) return ghFailure({ code: 1, stderr: 'Could not resolve to a Repository' }, target);
  return { ok: true, data: json.data };
}

function normalizePullRequest(node) {
  const commit = node.commits && node.commits.nodes && node.commits.nodes[0] && node.commits.nodes[0].commit;
  return {
    id: node.id || '',
    number: node.number,
    title: node.title || '',
    url: node.url || '',
    state: node.state, // OPEN | CLOSED | MERGED
    isDraft: !!node.isDraft,
    createdAt: node.createdAt || null,
    // What the search has read of it is read again once this moves on (pull-request-search.js).
    updatedAt: node.updatedAt || null,
    closedAt: node.closedAt || null,
    mergedAt: node.mergedAt || null,
    author: (node.author && node.author.login) || 'ghost',
    head: node.headRefName || '',
    headOid: node.headRefOid || '',
    base: node.baseRefName || '',
    crossRepository: !!node.isCrossRepository,
    additions: node.additions || 0,
    deletions: node.deletions || 0,
    changedFiles: node.changedFiles || 0,
    mergeable: node.mergeable || 'UNKNOWN', // MERGEABLE | CONFLICTING | UNKNOWN
    reviewDecision: node.reviewDecision || null, // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
    checks: (commit && commit.statusCheckRollup && commit.statusCheckRollup.state) || null,
    viewerDidAuthor: !!node.viewerDidAuthor,
    // The pencil beside the title, Reopen in the "…" menu. The rest of what an
    // open pull request needs (merge state, counts) comes with its
    // conversation (pull-request-detail.js): computed by GitHub for each pull
    // request, it would make a page of 100 too slow for GitHub's time limit.
    viewerCanUpdate: !!node.viewerCanUpdate,
    viewerCanReopen: !!node.viewerCanReopen,
  };
}

function repositoryInfo(repository) {
  const mergeMethods = [];
  if (repository.mergeCommitAllowed) mergeMethods.push('merge');
  if (repository.squashMergeAllowed) mergeMethods.push('squash');
  if (repository.rebaseMergeAllowed) mergeMethods.push('rebase');
  const preferred = String(repository.viewerDefaultMergeMethod || '').toLowerCase();
  const permission = repository.viewerPermission || null;
  return {
    nameWithOwner: repository.nameWithOwner || '',
    url: repository.url || '',
    permission,
    canWrite: WRITE_PERMISSIONS.has(permission),
    mergeMethods,
    defaultMethod: mergeMethods.includes(preferred) ? preferred : (mergeMethods[0] || null),
    deleteBranchOnMerge: !!repository.deleteBranchOnMerge,
  };
}

function targetSummary(target) {
  return { remote: target.remote, remotes: target.remotes };
}

async function targetFor(dir, remote) {
  try {
    const target = await resolveRepo(dir, remote || null);
    return target ? { target } : { failure: { error: NO_GITHUB_REMOTE, code: 'no-github-remote' } };
  } catch (err) {
    return { failure: { error: err.message || String(err), code: 'git-failed' } };
  }
}

/** Every open pull request (drafts too), newest first, with the repository's merge settings. */
async function listOpen(dir, { remote = null } = {}) {
  const { target, failure } = await targetFor(dir, remote);
  if (failure) return failure;
  const items = [];
  let after = null;
  let info = null;
  let totalCount = 0;
  let hasNextPage = false;
  let size = OPEN_PAGE_SIZE;
  for (let request = 0; request < MAX_OPEN_REQUESTS && items.length < MAX_OPEN; request++) {
    const answer = await graphql(target, LIST_QUERY, {
      owner: target.owner, repo: target.repo, states: ['OPEN'], first: Math.min(size, MAX_OPEN - items.length), after,
    });
    // A busy repository can make GitHub give up on 100 at once (a 502 or 504
    // after about ten seconds): the same page again, in smaller ones.
    if (!answer.ok && size > MIN_OPEN_PAGE_SIZE && isGitHubTimeout(answer.error)) {
      size = Math.max(MIN_OPEN_PAGE_SIZE, Math.floor(size / 2));
      continue;
    }
    if (!answer.ok) return { ...answer, ...targetSummary(target) };
    const repository = answer.data.repository;
    if (!info) info = repositoryInfo(repository);
    const connection = repository.pullRequests || {};
    totalCount = connection.totalCount || 0;
    for (const node of connection.nodes || []) if (node) items.push(normalizePullRequest(node));
    hasNextPage = !!(connection.pageInfo && connection.pageInfo.hasNextPage);
    after = connection.pageInfo && connection.pageInfo.endCursor;
    if (!hasNextPage || !after) break;
  }
  return { ok: true, ...targetSummary(target), repo: info, items, totalCount, truncated: hasNextPage };
}

/** GitHub, or gh, gave up waiting: worth asking again for less. */
function isGitHubTimeout(error) {
  return /HTTP 50[234]|Bad Gateway|Gateway Time-?out|did not answer within|timed? ?out|Something went wrong while executing your query/i.test(String(error || ''));
}

function validCursor(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 500);
}

/** One page of closed and/or merged pull requests, newest first. */
async function listPage(dir, { remote = null, states = PAGE_STATES, first = 10, after = null } = {}) {
  const wanted = Array.isArray(states) ? [...new Set(states.map(s => String(s).toUpperCase()))] : [];
  if (!wanted.length || !wanted.every(s => PAGE_STATES.includes(s))) return { error: 'Only closed and merged pull requests come in pages', code: 'bad-request' };
  const size = Number(first);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) return { error: 'A page holds 1 to 100 pull requests', code: 'bad-request' };
  if (!validCursor(after)) return { error: 'Not a page cursor', code: 'bad-request' };
  const { target, failure } = await targetFor(dir, remote);
  if (failure) return failure;
  const answer = await graphql(target, LIST_QUERY, {
    owner: target.owner, repo: target.repo, states: wanted, first: size, after: after || null,
  });
  if (!answer.ok) return { ...answer, ...targetSummary(target) };
  const connection = answer.data.repository.pullRequests || {};
  return {
    ok: true,
    ...targetSummary(target),
    states: wanted,
    items: (connection.nodes || []).filter(Boolean).map(normalizePullRequest),
    totalCount: connection.totalCount || 0,
    hasNextPage: !!(connection.pageInfo && connection.pageInfo.hasNextPage),
    endCursor: (connection.pageInfo && connection.pageInfo.endCursor) || null,
  };
}

// --- Files ---

const FILE_STATUS = { added: 'added', removed: 'deleted', modified: 'modified', renamed: 'renamed', copied: 'added', changed: 'modified', unchanged: 'modified' };

function validNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1e9 ? n : null;
}

/** A pull request's changed files, each with its patch (null for binary files and very large diffs). */
async function files(dir, { remote = null, number } = {}) {
  const n = validNumber(number);
  if (!n) return { error: 'Not a pull request number', code: 'bad-request' };
  const { target, failure } = await targetFor(dir, remote);
  if (failure) return failure;
  let result;
  try {
    result = await runGh([
      'api', '--hostname', target.host, '--paginate',
      `repos/${target.owner}/${target.repo}/pulls/${n}/files?per_page=100`,
      '--jq', '.[] | {filename, previous_filename, status, additions, deletions, patch}',
    ], { timeoutMs: FILES_TIMEOUT_MS });
  } catch (err) {
    return thrownFailure(err);
  }
  if (result.code !== 0) return ghFailure(result, target);
  return { ok: true, number: n, ...parseFileLines(result.stdout) };
}

/**
 * The files of a REST answer, one JSON object per line ({filename,
 * previous_filename, status, additions, deletions, patch}), in History's shape.
 * The patches stop at MAX_PATCH_BYTES all together, the files at MAX_FILES.
 */
function parseFileLines(stdout) {
  const list = [];
  let patchBytes = 0;
  let truncated = false;
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    if (list.length >= MAX_FILES) { truncated = true; break; }
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry.filename !== 'string') continue;
    let patch = typeof entry.patch === 'string' ? entry.patch : null;
    let tooLarge = false;
    if (patch !== null) {
      patchBytes += Buffer.byteLength(patch);
      if (patchBytes > MAX_PATCH_BYTES) { patch = null; tooLarge = true; }
    }
    list.push({
      path: entry.filename,
      oldPath: typeof entry.previous_filename === 'string' ? entry.previous_filename : null,
      status: FILE_STATUS[entry.status] || 'modified',
      insertions: entry.additions || 0,
      deletions: entry.deletions || 0,
      patch,
      tooLarge,
    });
  }
  return { files: list, truncated };
}

// --- Actions ---

/** gh's arguments for an action, or { error } when anything in it is not allowed. */
function actionArgs(target, { number, action, method, deleteBranch, headOid } = {}) {
  const n = validNumber(number);
  if (!n) return { error: 'Not a pull request number' };
  if (!ACTIONS.includes(action)) return { error: `Unknown pull request action: ${action}` };
  const repo = ['-R', repoArg(target)];
  if (action === 'draft') return { args: ['pr', 'ready', String(n), ...repo, '--undo'] };
  if (action === 'ready') return { args: ['pr', 'ready', String(n), ...repo] };
  if (action === 'close') return { args: ['pr', 'close', String(n), ...repo] };
  if (action === 'reopen') return { args: ['pr', 'reopen', String(n), ...repo] };
  if (!MERGE_METHODS.includes(method)) return { error: `Unknown merge method: ${method}` };
  if (headOid != null && !/^[0-9a-f]{40}$/.test(String(headOid))) return { error: 'Not a commit hash' };
  const args = ['pr', 'merge', String(n), ...repo, `--${method}`];
  if (deleteBranch === true) args.push('--delete-branch');
  if (headOid) args.push('--match-head-commit', String(headOid));
  return { args };
}

function doneMessage(action, n, ghText) {
  // Without a terminal gh says little; when it does say something worth
  // reading (a merge queue, auto-merge) that is what the user sees.
  if (/queue|auto-merge|automatically/i.test(ghText)) return ghText;
  if (action === 'merge') return `Merged pull request #${n}.`;
  if (action === 'draft') return `Pull request #${n} is a draft now.`;
  if (action === 'ready') return `Pull request #${n} is ready for review.`;
  if (action === 'reopen') return `Reopened pull request #${n}.`;
  return `Closed pull request #${n}.`;
}

/** Merge, convert to draft, mark ready for review, close or reopen one pull request. */
async function runAction(dir, params = {}) {
  const { target, failure } = await targetFor(dir, params.remote || null);
  if (failure) return failure;
  const built = actionArgs(target, params);
  if (built.error) return { error: built.error, code: 'bad-request' };
  if (inFlight.has(dir)) return { error: 'Another pull request action is still running for this repository.', code: 'busy' };
  inFlight.add(dir);
  try {
    const result = await runGh(built.args, { timeoutMs: ACTION_TIMEOUT_MS });
    if (result.code !== 0) return ghFailure(result, target);
    const text = cleanGhText(`${result.stderr || ''}\n${result.stdout || ''}`);
    log.info('[pull-requests]', params.action, `#${validNumber(params.number)}`, repoArg(target));
    return { ok: true, message: doneMessage(params.action, validNumber(params.number), text) };
  } catch (err) {
    return thrownFailure(err);
  } finally {
    inFlight.delete(dir);
  }
}

// --- For the sibling modules (pull-request-detail.js, pull-request-edits.js) ---

/** Run gh through the runner init() set, so a test's fake gh answers for every module. */
function run(args, opts) {
  return runGh(args, opts);
}

/** One write at a time per key: a repository folder, as runAction uses it. False when one is running. */
function claim(key) {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

function release(key) {
  inFlight.delete(key);
}

function info(...args) {
  log.info(...args);
}

module.exports = {
  init,
  listOpen, listPage, files, runAction,
  // for pull-request-detail.js and pull-request-edits.js
  run, graphql, targetFor, ghFailure, thrownFailure, validNumber, validCursor, parseFileLines, claim, release, info,
  READ_TIMEOUT_MS, FILES_TIMEOUT_MS, ACTION_TIMEOUT_MS,
  // exported for tests
  parseGitHubRemote, isGitHubHost, resolveRepo, repoArg, actionArgs, cleanGhText, ghEnv, locateGh,
  normalizePullRequest, repositoryInfo, LIST_QUERY, MERGE_METHODS, ACTIONS,
};
