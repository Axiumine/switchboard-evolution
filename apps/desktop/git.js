// git.js — the few git commands Switchboard runs itself, for project worktrees.
//
// Every call goes through execFile with an argv array and no shell, so a path
// or branch name can never be read as shell syntax. Errors carry git's stderr
// as their message. Nothing here is used unless a project attaches a folder
// "on a branch", opens the Git tab, or manages worktrees in the Worktrees tab.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_BUFFER = 4 * 1024 * 1024;

// Every git call: never hang on a credential prompt, never take the index
// lock just to refresh stat data (a status here must not collide with the
// user's own git add), and messages in English, since some errors are
// recognised by their text.
function gitEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
}
const MAX_DIFF_LENGTH = 256 * 1024;
const MAX_UNTRACKED_STAT_BYTES = 2 * 1024 * 1024;

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      env: gitEnv(),
    }, (err, stdout, stderr) => {
      if (err) {
        const error = new Error(String(stderr || err.message).trim() || `git ${args[0]} failed`);
        error.code = err.code;
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

/** Run git without trimming its output. Some machine-readable formats use NULs. */
function runRaw(args, cwd, { allowExitCodes = [] } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      env: gitEnv(),
    }, (err, stdout, stderr) => {
      if (!err || allowExitCodes.includes(err.code)) {
        resolve(String(stdout));
        return;
      }
      const error = new Error(String(stderr || err.message).trim() || `git ${args[0]} failed`);
      error.code = err.code;
      error.stderr = String(stderr || '');
      error.stdout = String(stdout || '');
      reject(error);
    });
  });
}

/** Run git and keep both streams: a few commands report on stderr even when they succeed. */
function runCapture(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      env: gitEnv(),
    }, (err, stdout, stderr) => {
      if (err) {
        const error = new Error(String(stderr || err.message).trim() || `git ${args[0]} failed`);
        error.code = err.code;
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function runOr(args, cwd, fallback = '') {
  try { return await runRaw(args, cwd); } catch { return fallback; }
}

async function version() {
  try { return await run(['--version']); } catch { return null; }
}

async function isGitRepo(dir) {
  try { return (await run(['rev-parse', '--is-inside-work-tree'], dir)) === 'true'; } catch { return false; }
}

/** Top-level directory of the checkout that contains dir. Rejects outside a repo. */
async function repoRoot(dir) {
  return run(['rev-parse', '--show-toplevel'], dir);
}

async function branchExists(repo, name) {
  try {
    await run(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], repo);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check the branch out at targetPath, creating the branch from HEAD if needed.
 *
 * Options, all optional, for the Worktrees tab:
 * - startPoint: the commit a new branch (or a detached checkout) starts from;
 * - createBranch: true or false to skip the "does the branch exist" check;
 * - track: the new branch tracks startPoint (a remote branch). Without it a new
 *   branch made from a start point does not track it, so a feature branch cut
 *   from origin/main does not push to main;
 * - detach: check startPoint out with no branch at all.
 */
async function worktreeAdd(repo, targetPath, branch, options = {}) {
  const { startPoint = '', createBranch, track = false, detach = false } = options;
  refuseOptionLike(startPoint, 'Start point');
  if (detach) {
    await run(['worktree', 'add', '--detach', targetPath, startPoint || 'HEAD'], repo);
    return;
  }
  refuseOptionLike(branch, 'Branch');
  const create = typeof createBranch === 'boolean' ? createBranch : !(await branchExists(repo, branch));
  if (!create) {
    await run(['worktree', 'add', targetPath, branch], repo);
    return;
  }
  const args = ['worktree', 'add'];
  if (track) args.push('--track');
  else if (startPoint) args.push('--no-track');
  args.push('-b', branch, targetPath);
  if (startPoint) args.push(startPoint);
  await run(args, repo);
}

// A value that git would read as an option instead of a name.
function refuseOptionLike(value, label) {
  if (typeof value === 'string' && value.startsWith('-')) throw new Error(`${label} cannot start with "-"`);
}

/**
 * Remove a worktree. Refuses a dirty one unless force; the branch always stays.
 * prune: false keeps the records of other worktrees whose folder is missing
 * (moved by hand, on a drive that is not mounted) instead of dropping them too.
 */
async function worktreeRemove(repo, targetPath, { force = false, prune = true } = {}) {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(targetPath);
  await run(args, repo);
  if (prune) try { await run(['worktree', 'prune'], repo); } catch {}
}

/** True when git refused to remove a worktree because it has local changes. */
function isDirtyWorktreeError(err) {
  return /modified or untracked|use --force|uncommitted|contains modified/i.test(String(err?.message || ''));
}

/**
 * Parse `git worktree list --porcelain -z`: one record per worktree, the
 * fields NUL-terminated and the records separated by an empty field. The first
 * record is always the main worktree (or the bare repository).
 */
function parseWorktreeList(output) {
  const worktrees = [];
  let current = null;
  for (const field of String(output || '').split('\0')) {
    if (!field) {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }
    const space = field.indexOf(' ');
    const key = space === -1 ? field : field.slice(0, space);
    const value = space === -1 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      if (current) worktrees.push(current);
      current = {
        path: value, head: '', branch: '', detached: false, bare: false,
        locked: false, lockReason: '', prunable: false, prunableReason: '',
      };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
    else if (key === 'locked') { current.locked = true; current.lockReason = value; }
    else if (key === 'prunable') { current.prunable = true; current.prunableReason = value; }
  }
  if (current) worktrees.push(current);
  worktrees.forEach((worktree, index) => { worktree.isMain = index === 0; });
  return worktrees;
}

/** Every worktree of the repository that contains dir, main worktree first. */
async function worktreeList(dir) {
  let output;
  try {
    output = await runRaw(['worktree', 'list', '--porcelain', '-z'], dir);
  } catch (err) {
    // -z arrived in git 2.36; older versions answer with their usage text.
    if (/unknown switch|usage: git worktree/i.test(err.message)) {
      throw new Error('Listing worktrees needs git 2.36 or newer');
    }
    throw err;
  }
  return parseWorktreeList(output).map(worktree => ({ ...worktree, path: path.resolve(worktree.path) }));
}

async function worktreeLock(repo, targetPath, reason = '') {
  const args = ['worktree', 'lock'];
  if (reason) args.push('--reason', String(reason));
  args.push(targetPath);
  await run(args, repo);
}

async function worktreeUnlock(repo, targetPath) {
  await run(['worktree', 'unlock', targetPath], repo);
}

/** Move a worktree. Git refuses a locked one and the main worktree. */
async function worktreeMove(repo, fromPath, toPath, { force = false } = {}) {
  const args = ['worktree', 'move'];
  if (force) args.push('--force');
  args.push(fromPath, toPath);
  await run(args, repo);
}

/**
 * Drop the records of worktrees whose folder is gone. With dryRun nothing
 * changes. Returns what git reported: [{ name, reason }], where name is the
 * worktree's entry under .git/worktrees. Git writes that report to stderr.
 */
async function worktreePrune(repo, { dryRun = false } = {}) {
  const args = ['worktree', 'prune', '--verbose'];
  if (dryRun) args.push('--dry-run');
  const { stderr } = await runCapture(args, repo);
  return stderr.split('\n').map(line => line.match(/^Removing worktrees\/(.+?): (.*)$/))
    .filter(Boolean)
    .map(match => ({ name: match[1], reason: match[2].trim() }));
}

/** Fix the links between the repository and its worktrees, e.g. after a manual move. */
async function worktreeRepair(repo, paths = []) {
  const { stdout, stderr } = await runCapture(['worktree', 'repair', ...paths], repo);
  return [stdout, stderr].map(text => text.trim()).filter(Boolean).join('\n');
}

/** Delete a local branch. Without force git refuses one that is not merged. */
async function deleteBranch(repo, name, { force = false } = {}) {
  refuseOptionLike(name, 'Branch');
  await run(['branch', force ? '-D' : '-d', name], repo);
}

/** True when git refused to delete a branch because it is not merged. */
function isUnmergedBranchError(err) {
  return /not fully merged/i.test(String(err?.message || ''));
}

/** True when git accepts name as a new branch name. */
async function isValidBranchName(repo, name) {
  if (typeof name !== 'string' || !name || name.startsWith('-')) return false;
  try {
    await run(['check-ref-format', '--branch', name], repo);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local and remote-tracking branches, for picking what a new worktree checks
 * out or starts from: { local: [{ name, head, upstream }], remote: [{ name, remote, head }] }.
 */
async function listBranches(repo) {
  const [output, remoteNames] = await Promise.all([
    runRaw([
      'for-each-ref', '--format=%(refname)%00%(objectname:short)%00%(upstream:short)%00%(symref)',
      'refs/heads', 'refs/remotes',
    ], repo),
    runOr(['remote'], repo, ''),
  ]);
  // A remote's name can hold a slash (team/fork), so match the longest one.
  const remotes = remoteNames.split('\n').map(name => name.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const local = [];
  const remote = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [ref, head, upstream, symref] = line.split('\0');
    if (symref) continue; // origin/HEAD only points at another branch
    if (ref.startsWith('refs/heads/')) local.push({ name: ref.slice('refs/heads/'.length), head, upstream: upstream || '' });
    else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length);
      remote.push({ name, remote: remotes.find(r => name.startsWith(r + '/')) || name.split('/')[0], head });
    }
  }
  return { local, remote };
}

/** Local branches whose tip is already contained in base. */
async function mergedBranches(repo, base) {
  refuseOptionLike(base, 'Base branch');
  const output = await run(['for-each-ref', '--format=%(refname:short)', '--merged', base, 'refs/heads'], repo);
  return output ? output.split('\n').filter(Boolean) : [];
}

/** The branch work is merged into: origin's default branch, else main or master. */
async function defaultBranch(repo) {
  try {
    const remoteHead = await run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], repo);
    if (remoteHead) return remoteHead;
  } catch {}
  for (const name of ['main', 'master']) {
    if (await branchExists(repo, name)) return name;
  }
  return '';
}

/** { hash, time (ms), subject } of the commit checked out in dir, or null. */
async function lastCommit(dir) {
  try {
    const out = await run(['log', '-1', '--format=%H%x00%ct%x00%s'], dir);
    if (!out) return null;
    const [hash, seconds, subject] = out.split('\0');
    return { hash, time: Number(seconds) * 1000, subject: subject || '' };
  } catch {
    return null;
  }
}

/** The repository's shared .git directory, absolute, from any of its worktrees. */
const UNPUSHED_LIST_LIMIT = 200;

/** One commit of `git log --format=%x1e%H%x00%h%x00%an%x00%at%x00%s --shortstat`. */
function parseLogWithStat(output) {
  return String(output || '').split('\x1e').filter(chunk => chunk.trim()).map((chunk) => {
    const newline = chunk.indexOf('\n');
    const head = newline === -1 ? chunk : chunk.slice(0, newline);
    const rest = newline === -1 ? '' : chunk.slice(newline + 1);
    const [hash, shortHash, author, seconds, subject] = head.split('\0');
    const files = Number(rest.match(/(\d+) files? changed/)?.[1] || 0);
    return { hash, shortHash, author, time: Number(seconds) * 1000, subject: subject || '', files, ...parseShortStat(rest) };
  });
}

/**
 * The commits checked out in dir that no remote has, for deciding whether a
 * worktree can go: { kind, base, total, commits, truncated }.
 *
 * kind 'upstream': the branch has an upstream; the commits it is ahead by.
 * kind 'remotes': no upstream (a new branch, a detached head); the commits on
 * no remote-tracking branch. kind 'local': the repository has no remote at
 * all; the commits not in `fallbackBase` (the main worktree's branch), when
 * given. kind 'none': nothing to compare with.
 */
async function unpushedCommits(dir, { fallbackBase = '', limit = UNPUSHED_LIST_LIMIT } = {}) {
  const empty = (kind, base = '') => ({ kind, base, total: 0, commits: [], truncated: false });
  // A repository without a commit yet has nothing to push.
  try { await run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], dir); } catch { return empty('none'); }
  let upstream = '';
  try { upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], dir); } catch {}
  const remotes = (await runOr(['remote'], dir, '')).split('\n').map(name => name.trim()).filter(Boolean);
  let range;
  let kind;
  let base = '';
  if (upstream) {
    kind = 'upstream';
    base = upstream;
    range = ['@{upstream}..HEAD'];
  } else if (remotes.length) {
    kind = 'remotes';
    range = ['HEAD', '--not', '--remotes'];
  } else if (fallbackBase && !fallbackBase.startsWith('-')) {
    kind = 'local';
    base = fallbackBase;
    range = ['HEAD', '--not', `refs/heads/${fallbackBase}`];
  } else {
    return empty('none');
  }
  const max = Math.max(1, Math.min(UNPUSHED_LIST_LIMIT, Number(limit) || UNPUSHED_LIST_LIMIT));
  const [count, log] = await Promise.all([
    runOr(['rev-list', '--count', ...range, '--'], dir, '0'),
    runOr(['log', `-${max}`, '--no-color', '--format=%x1e%H%x00%h%x00%an%x00%at%x00%s', '--shortstat', ...range, '--'], dir, ''),
  ]);
  const commits = parseLogWithStat(log);
  const total = Math.max(Number(count.trim()) || 0, commits.length);
  return { kind, base, total, commits, truncated: total > commits.length };
}

async function gitCommonDir(dir) {
  const out = await run(['rev-parse', '--git-common-dir'], dir);
  return path.resolve(dir, out);
}

/**
 * Branch, whether anything is modified or untracked, and ahead/behind
 * upstream. With `withPaths`, also `changed`: the changed paths, relative to
 * the worktree's root (an untracked folder as one).
 */
async function status(dir, { withPaths = false } = {}) {
  const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  // -z keeps unusual names whole, and runRaw the leading space of the first record.
  const porcelain = withPaths
    ? await runRaw(['status', '--porcelain=v1', '-z'], dir)
    : await run(['status', '--porcelain'], dir);
  let ahead = null;
  let behind = null;
  try {
    const counts = await run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], dir);
    const [b, a] = counts.split(/\s+/).map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) { ahead = a; behind = b; }
  } catch {}
  const result = { branch, dirty: porcelain.length > 0, ahead, behind };
  if (withPaths) result.changed = parsePorcelain(porcelain).map(change => change.path);
  return result;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Parse `git status --porcelain=v1 -z` without losing unusual filenames. */
function parsePorcelain(output) {
  const records = String(output || '').split('\0');
  const changes = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record || record.length < 3) continue;
    const code = record.slice(0, 2);
    const indexStatus = code[0];
    const worktreeStatus = code[1];
    const filePath = record.slice(3);
    let oldPath = null;
    // With -z, a rename/copy is the destination followed by a second,
    // NUL-terminated source pathname.
    if (/[RC]/.test(code) && i + 1 < records.length) oldPath = records[++i] || null;

    let statusName = 'modified';
    if (CONFLICT_CODES.has(code)) statusName = 'conflicted';
    else if (code === '??') statusName = 'untracked';
    else if (/[RC]/.test(code)) statusName = 'renamed';
    else if (code.includes('D')) statusName = 'deleted';
    else if (code.includes('A')) statusName = 'added';

    changes.push({
      path: filePath,
      oldPath,
      code,
      status: statusName,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
    });
  }
  return changes;
}

function parseShortStat(output) {
  const text = String(output || '');
  const insertions = Number(text.match(/(\d+) insertion/)?.[1] || 0);
  const deletions = Number(text.match(/(\d+) deletion/)?.[1] || 0);
  return { insertions, deletions };
}

function countUntrackedInsertions(dir, changes) {
  let insertions = 0;
  for (const change of changes) {
    if (change.status !== 'untracked') continue;
    const absolute = path.resolve(dir, change.path);
    const relative = path.relative(dir, absolute);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_UNTRACKED_STAT_BYTES) continue;
      const content = fs.readFileSync(absolute);
      if (content.includes(0)) continue;
      if (content.length) insertions += content.toString('utf8').split('\n').length - (content.at(-1) === 10 ? 1 : 0);
    } catch {}
  }
  return insertions;
}

function parseCommits(output) {
  return String(output || '')
    .split('\x1e')
    .map(record => record.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, date, subject] = record.split('\0');
      return { hash, shortHash, author, date, subject };
    });
}

function gitOperation(gitDir) {
  const exists = (name) => fs.existsSync(path.join(gitDir, name));
  if (exists('rebase-merge') || exists('rebase-apply')) return 'rebase';
  if (exists('MERGE_HEAD')) return 'merge';
  if (exists('CHERRY_PICK_HEAD')) return 'cherry-pick';
  if (exists('REVERT_HEAD')) return 'revert';
  if (exists('BISECT_LOG')) return 'bisect';
  return null;
}

/** Read-only state used by the project Git tab. */
async function snapshot(dir, { commitLimit = 20 } = {}) {
  if (!await isGitRepo(dir)) return { git: false };

  const [branchName, head, porcelain, counts, logOutput, statOutput, gitDirOutput] = await Promise.all([
    runOr(['rev-parse', '--abbrev-ref', 'HEAD'], dir),
    runOr(['rev-parse', '--short', 'HEAD'], dir),
    runRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], dir),
    runOr(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], dir, ''),
    runOr(['log', `-${Math.max(1, Math.min(100, Number(commitLimit) || 20))}`, '--date=iso-strict', '--pretty=format:%H%x00%h%x00%an%x00%aI%x00%s%x1e'], dir, ''),
    runOr(['diff', '--no-color', '--shortstat', 'HEAD', '--'], dir, ''),
    runOr(['rev-parse', '--git-dir'], dir, ''),
  ]);

  const changes = parsePorcelain(porcelain);
  const [behindRaw, aheadRaw] = counts.trim().split(/\s+/);
  const ahead = counts ? Number(aheadRaw) : null;
  const behind = counts ? Number(behindRaw) : null;
  const stats = parseShortStat(statOutput);
  stats.insertions += countUntrackedInsertions(dir, changes);
  const gitDir = gitDirOutput ? path.resolve(dir, gitDirOutput.trim()) : null;
  const detached = branchName.trim() === 'HEAD';

  return {
    git: true,
    branch: detached ? '' : branchName.trim(),
    detached,
    head: head.trim(),
    dirty: changes.length > 0,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
    operation: gitDir ? gitOperation(gitDir) : null,
    changes,
    stats,
    commits: parseCommits(logOutput),
  };
}

function safeRelativePath(dir, filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('File path is required');
  const absolute = path.resolve(dir, filePath);
  const relative = path.relative(dir, absolute);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('File is outside the repository');
  }
  return { absolute, relative };
}

/** Return a read-only unified diff for one currently changed file. */
async function fileDiff(dir, filePath) {
  const { absolute, relative } = safeRelativePath(dir, filePath);
  const changes = parsePorcelain(await runRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], dir));
  const change = changes.find(item => item.path === relative || item.path === filePath);
  if (!change) throw new Error('File is not currently changed');

  let diff = '';
  if (change.status === 'untracked') {
    const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
    diff = await runRaw(['diff', '--no-color', '--no-index', '--no-ext-diff', '--unified=3', '--', nullPath, absolute], dir, { allowExitCodes: [1] });
  } else {
    try {
      diff = await runRaw(['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', relative], dir);
    } catch {
      const [staged, unstaged] = await Promise.all([
        runOr(['diff', '--no-color', '--cached', '--no-ext-diff', '--unified=3', '--', relative], dir, ''),
        runOr(['diff', '--no-color', '--no-ext-diff', '--unified=3', '--', relative], dir, ''),
      ]);
      diff = [staged, unstaged].filter(Boolean).join('\n');
    }
  }

  const truncated = diff.length > MAX_DIFF_LENGTH;
  if (truncated) diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n\n… diff truncated by Switchboard …\n';
  return { path: relative, diff, truncated };
}

// --- Staging: files, hunks and lines -----------------------------------------
// The Git tab stages and unstages like a Git client: whole files with git add /
// git reset, and the lines picked in a diff with a patch of those lines that
// git apply writes to the index (git-diff-model.js builds it). Everything runs
// at the top of the checkout, where git status paths and diff paths start.

const crypto = require('crypto');
const { spawn } = require('child_process');
const diffModel = require('./public/git-diff-model');
const changeActions = require('./public/git-change-actions');

/** Run git with `input` on its standard input. */
function runWithInput(args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: gitEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const error = new Error(String(stderr).trim() || `git ${args[0]} failed`);
      error.code = code;
      error.stderr = stderr;
      reject(error);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** The top of the checkout that holds dir, and a repository path checked to stay inside it. */
async function stagingTarget(dir, filePath) {
  const top = await repoRoot(dir);
  if (filePath === undefined) return { top };
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) throw new Error('File path is required');
  const absolute = path.resolve(top, filePath);
  const relative = path.relative(top, absolute);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('File is outside the repository');
  }
  return { top, relative: relative.split(path.sep).join('/') };
}

const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3'];

function diffId(diff) {
  return crypto.createHash('sha1').update(diff).digest('hex');
}

/**
 * One side of a changed file's diff: 'unstaged' (index → working tree; an
 * untracked file shows as new) or 'staged' (HEAD → index; a staged rename with
 * its old path). `diffId` names the exact text, so lines picked in it can be
 * staged only while the file still has that diff.
 */
async function sideDiff(dir, filePath, side) {
  if (side !== 'unstaged' && side !== 'staged') throw new Error('Unknown side of the diff');
  const { top, relative } = await stagingTarget(dir, filePath);
  const changes = parsePorcelain(await runRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], top));
  const change = changes.find(item => item.path === relative);
  if (!change) throw new Error('File is not currently changed');
  let diff;
  if (side === 'unstaged' && change.status === 'untracked') {
    const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
    diff = await runRaw([...DIFF_ARGS, '--no-index', '--', nullPath, relative], top, { allowExitCodes: [1] });
  } else if (side === 'unstaged') {
    diff = await runRaw([...DIFF_ARGS, '--', relative], top);
  } else {
    const paths = change.oldPath ? [change.oldPath, relative] : [relative];
    diff = await runRaw([...DIFF_ARGS, '--cached', '-M', '--', ...paths], top);
  }
  const truncated = diff.length > MAX_DIFF_LENGTH;
  if (truncated) diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n\n… diff truncated by Switchboard …\n';
  return { path: relative, side, diff, truncated, diffId: diffId(diff), change };
}

/** Stage (git add) or unstage (git reset) whole files; `paths` null for every change. */
async function stageFiles(dir, paths, stage) {
  const { top } = await stagingTarget(dir);
  let relatives = null;
  if (paths !== null) {
    if (!Array.isArray(paths) || !paths.length) throw new Error('No files to stage');
    relatives = [];
    for (const p of paths) relatives.push((await stagingTarget(top, p)).relative);
  }
  if (stage) {
    // -A: a deleted file is staged as deleted, a conflicted one marked resolved.
    await run(['add', '-A', '--', ...(relatives || ['.'])], top);
    return;
  }
  const hasHead = await runOr(['rev-parse', '--verify', '-q', 'HEAD'], top, '');
  if (hasHead.trim()) {
    await run(['reset', '-q', '--', ...(relatives || ['.'])], top);
  } else {
    // Before the first commit there is nothing to reset to: take the files out of the index.
    await run(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...(relatives || ['.'])], top);
  }
}

/**
 * Stage the picked lines of the unstaged diff, or unstage the picked lines
 * of the staged diff. `lines` are indices in diff.split('\n') of the diff
 * named by `expectedDiffId`; when the file's diff is no longer that one the
 * call fails with code 'STALE' and nothing changes.
 */
async function stageLines(dir, filePath, side, expectedDiffId, lines) {
  const current = await sideDiff(dir, filePath, side);
  if (current.diffId !== expectedDiffId) {
    const error = new Error('The file changed since its diff was shown. Look at it again and pick the lines again.');
    error.code = 'STALE';
    throw error;
  }
  if (current.truncated) throw new Error('This diff is too long to stage in parts: stage the whole file');
  const parsed = diffModel.parseUnifiedDiff(current.diff);
  if (!diffModel.canPickLines(parsed)) throw new Error('This change can only be staged as a whole file');
  const changed = diffModel.changedLineIndices(parsed);
  const picked = new Set((Array.isArray(lines) ? lines : []).filter(i => Number.isInteger(i)));
  const chosen = changed.filter(i => picked.has(i));
  if (!chosen.length) throw new Error('Pick the lines to stage first');
  const { top } = await stagingTarget(dir);
  const reverse = side === 'staged';
  if (chosen.length === changed.length) {
    // Every line: the same as the whole file, and git add / reset handle it best.
    await stageFiles(top, [current.path, ...(current.change.oldPath ? [current.change.oldPath] : [])], !reverse);
    return { whole: true };
  }
  const patch = diffModel.buildPartialPatch(parsed, new Set(chosen), { reverse });
  const args = ['apply', '--cached', '--recount', '--whitespace=nowarn'];
  if (reverse) args.push('--reverse');
  args.push('-');
  try {
    await runWithInput(args, top, patch);
  } catch (err) {
    throw new Error(`Could not ${reverse ? 'unstage' : 'stage'} these lines: ${err.message}`);
  }
  return { whole: false };
}

// --- Discard and .gitignore (the Changes list's row menu) ------------------
// Paths are pathspecs read literally (--literal-pathspecs), so a file named
// "a*.txt" never takes "ab.txt" with it.

async function workingChanges(top) {
  return parsePorcelain(await runRaw(['status', '--porcelain=v1', '-z', '--untracked-files=all'], top));
}

/** Remove the folders between `abs` and `top` that are now empty, nearest first. */
async function pruneEmptyFolders(abs, top) {
  let dir = path.dirname(abs);
  while (dir !== top && dir.startsWith(top + path.sep)) {
    try { await fs.promises.rmdir(dir); } catch { return; }
    dir = path.dirname(dir);
  }
}

/**
 * Discard the working-tree changes ("Changes" in the list) of files and
 * folders, `paths` null for every one: a tracked file goes back to its index
 * version (HEAD's when nothing is staged), an untracked file goes to `trash`
 * (shell.trashItem in main) and the folders it leaves empty go too. What is
 * staged stays staged; conflicts are left alone.
 */
async function discardFiles(dir, paths, { trash } = {}) {
  const { top } = await stagingTarget(dir);
  const changes = await workingChanges(top);
  let targets;
  if (paths === null) {
    targets = changeActions.discardTargets(changes, null);
  } else {
    if (!Array.isArray(paths) || !paths.length) throw new Error('No files to discard');
    const picked = new Map();
    for (const p of paths) {
      const { relative } = await stagingTarget(top, p);
      for (const change of changeActions.discardTargets(changes, { path: relative, dir: true })) picked.set(change.path, change);
    }
    targets = [...picked.values()];
  }
  if (!targets.length) throw new Error('There are no changes to discard here');
  const tracked = targets.filter(change => change.status !== 'untracked').map(change => change.path);
  const untracked = targets.filter(change => change.status === 'untracked').map(change => change.path);
  if (untracked.length && typeof trash !== 'function') throw new Error('Untracked files cannot be moved to the Trash here');
  if (tracked.length) {
    await runWithInput(['--literal-pathspecs', 'restore', '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], top, tracked.join('\0'));
  }
  const failed = [];
  let trashed = 0;
  for (const rel of untracked) {
    const abs = path.join(top, ...rel.split('/'));
    try {
      await trash(abs);
      trashed += 1;
      await pruneEmptyFolders(abs, top);
    } catch (err) {
      failed.push({ path: rel, error: err?.message || String(err) });
    }
  }
  return { restored: tracked.length, trashed, failed };
}

// ── Editing a changed file from the diff ─────────────────────────────

const MAX_EDIT_BYTES = 2_000_000;
const fileVersion = (buffer) => crypto.createHash('sha1').update(buffer).digest('hex');
const codedError = (message, code) => Object.assign(new Error(message), { code });

/** A file of the checkout that may be written: on disk, a plain file, not a link out of it. */
async function editablePath(dir, filePath) {
  const { top, relative } = await stagingTarget(dir, filePath);
  const abs = path.join(top, ...relative.split('/'));
  let stat;
  try { stat = await fs.promises.lstat(abs); } catch (err) {
    if (err.code === 'ENOENT') throw codedError('The file is not on disk', 'MISSING');
    throw err;
  }
  if (stat.isSymbolicLink()) throw codedError('A link cannot be edited here', 'LINK');
  if (!stat.isFile()) throw codedError('Only a file can be edited', 'NOT_FILE');
  return { top, relative, abs };
}

/**
 * A changed file to edit in the Git tab: its text on disk, the version to save
 * it against, and `base`, what its unstaged changes are measured from while it
 * is edited: the staged copy (as checkout would write it, line endings
 * included), nothing for an untracked file, the text itself for a file in
 * conflict, which has no staged copy.
 */
async function readEditableFile(dir, filePath) {
  const { top, relative, abs } = await editablePath(dir, filePath);
  const buffer = await fs.promises.readFile(abs);
  if (buffer.length > MAX_EDIT_BYTES) throw codedError('The file is too big to edit here', 'TOO_BIG');
  if (buffer.subarray(0, 8000).includes(0)) throw codedError('A binary file cannot be edited', 'BINARY');
  const content = buffer.toString('utf8');
  const change = (await workingChanges(top)).find(item => item.path === relative);
  let base;
  if (change?.status === 'untracked') base = '';
  else if (change?.status === 'conflicted') base = content;
  else {
    try { base = await runRaw(['cat-file', '--filters', `:${relative}`], top); } catch { base = ''; }
  }
  return { content, version: fileVersion(buffer), base };
}

/**
 * Write an edited file to the working tree; the index is left as it is, so
 * the edit shows as a change to stage. With `expectedVersion` (from
 * readEditableFile) a file changed on disk since is not overwritten: the
 * answer says CHANGED, with the version now on disk.
 */
async function saveEditedFile(dir, filePath, content, expectedVersion) {
  if (typeof content !== 'string') throw new Error('No text to save');
  const { abs } = await editablePath(dir, filePath);
  if (expectedVersion) {
    const current = fileVersion(await fs.promises.readFile(abs));
    if (current !== expectedVersion) return { ok: false, code: 'CHANGED', error: 'The file changed on disk after it was opened', version: current };
  }
  const buffer = Buffer.from(content, 'utf8');
  await fs.promises.writeFile(abs, buffer);
  return { ok: true, version: fileVersion(buffer) };
}

/**
 * Add files and folders to the .gitignore at the top of the checkout, one
 * anchored line each (git-change-actions.js ignorePattern), never twice. With
 * `untrack`, what Git tracks under them first leaves the index (git rm
 * --cached): the files stay on disk and the removal is staged.
 */
async function ignorePaths(dir, paths, { untrack = false } = {}) {
  const { top } = await stagingTarget(dir);
  if (!Array.isArray(paths) || !paths.length) throw new Error('No files to add to .gitignore');
  const relatives = [];
  for (const p of paths) relatives.push((await stagingTarget(top, p)).relative);
  const changes = await workingChanges(top);
  const wanted = [];
  for (const rel of relatives) {
    let isDir;
    try { isDir = (await fs.promises.stat(path.join(top, ...rel.split('/')))).isDirectory(); } catch { isDir = changes.some(change => change.path.startsWith(`${rel}/`)); }
    wanted.push(changeActions.ignorePattern(rel, isDir));
  }
  let untracked = 0;
  if (untrack) {
    const listed = await runRaw(['--literal-pathspecs', 'ls-files', '-z', '--', ...relatives], top);
    untracked = listed.split('\0').filter(Boolean).length;
    if (untracked) await run(['--literal-pathspecs', 'rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...relatives], top);
  }
  const file = path.join(top, '.gitignore');
  let text = '';
  try { text = await fs.promises.readFile(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const present = new Set(text.split('\n').map(line => line.replace(/\r$/, '')));
  const patterns = [...new Set(wanted)].filter(line => !present.has(line));
  if (patterns.length) {
    const lead = text && !text.endsWith('\n') ? '\n' : '';
    await fs.promises.writeFile(file, `${text}${lead}${patterns.join('\n')}\n`);
  }
  return { patterns, untracked };
}

// --- Git Graph read functions ---------------------------------------------
// Everything below is read-only (git-actions.js is where mutation lives).
// Every call adds --no-optional-locks (never contend with a write in
// flight elsewhere) and, for anything that formats human-readable output,
// --no-color/--no-show-signature, so a user's own color.ui=always or a
// slow/missing gpg can never leak into text this code goes on to parse.
// Multi-field
// records use NUL between fields and, for git-log output, \x1e between
// records, the same convention parseCommits() already uses above.

async function tagExists(repo, name) {
  try {
    await run(['--no-optional-locks', 'rev-parse', '--verify', '--quiet', `refs/tags/${name}`], repo);
    return true;
  } catch {
    return false;
  }
}

/** Normalize a path for use inside a git argv element (git wants '/' even on Windows). */
function toGitPath(relPath) {
  return String(relPath).split(path.sep).join('/').split('\\').join('/');
}

// Node's execFile refuses any argv string containing an actual NUL byte
// ("must be a string without null bytes") — so the *format strings* below
// use git's own textual escape for one (`%x00` for git-log/stash-list's
// pretty-format engine, `%00` for for-each-ref's own, different, format
// language), and only the *parsed output* (which genuinely does contain
// raw NUL/RS bytes, written by git itself, safe for Node to read back) is
// split on the real characters.
const GG_FIELD_SEP = '\x00';
const GG_RECORD_SEP = '\x1e';
const LOG_FIELD_ESCAPE = '%x00';
const LOG_RECORD_ESCAPE = '%x1e';
const FOR_EACH_REF_FIELD_ESCAPE = '%00';

const LOG_ORDER_FLAGS = { date: '--date-order', 'author-date': '--author-date-order', topo: '--topo-order' };

// A revspec entry starting with '-' is only ever accepted from this fixed
// list (or one of the prefixes below) — anything else risks being read as
// a flag rather than a ref/branch-glob, the same class of bug git-actions.js
// closes for mutating commands with assertSafePositionalArg.
const REVSPEC_FLAGS = new Set(['--all', '--branches', '--tags', '--remotes', '--first-parent', '--reflog']);
const REVSPEC_FLAG_PREFIXES = ['--glob=', '--branches=', '--tags=', '--remotes=', '--exclude='];

function assertSafeRevspecEntry(entry) {
  if (typeof entry !== 'string' || !entry || entry.includes('\0')) throw new Error('Invalid revision specifier');
  if (!entry.startsWith('-')) return entry;
  if (REVSPEC_FLAGS.has(entry) || REVSPEC_FLAG_PREFIXES.some(prefix => entry.startsWith(prefix))) return entry;
  throw new Error(`Revision specifier '${entry}' is not on the allowed flag list`);
}

function logPrettyFormat(useMailmap) {
  const an = useMailmap ? '%aN' : '%an';
  const ae = useMailmap ? '%aE' : '%ae';
  const cn = useMailmap ? '%cN' : '%cn';
  const ce = useMailmap ? '%cE' : '%ce';
  return ['%H', '%h', '%P', an, ae, '%aI', cn, ce, '%cI', '%s'].join(LOG_FIELD_ESCAPE) + LOG_RECORD_ESCAPE;
}

function parseLogWithParents(output) {
  return String(output || '')
    .split(GG_RECORD_SEP)
    .map(record => record.replace(/^\n+|\n+$/g, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, parentField, authorName, authorEmail, authorDate,
        committerName, committerEmail, commitDate, subject] = record.split(GG_FIELD_SEP);
      return {
        hash, shortHash,
        parents: parentField ? parentField.split(' ').filter(Boolean) : [],
        authorName, authorEmail, authorDate,
        committerName, committerEmail, commitDate,
        subject: subject || '',
      };
    });
}

/**
 * Commit list with parent hashes, for graph layout. `order` selects
 * `--date-order` (default) / `--author-date-order` / `--topo-order`.
 * `revspec` is a ref/hash or array of them (default `['HEAD']`); a leading
 * '-' entry must be on the fixed allow-list above. `useMailmap` swaps the
 * author/committer placeholders for their mailmap-aware forms — %an/%ae
 * never consult .mailmap regardless, so this is a format-string choice, not
 * a flag. Degrades to `[]` on an unborn HEAD rather than throwing.
 */
async function logWithParents(dir, { revspec, order = 'date', skip, limit, useMailmap = false } = {}) {
  const orderFlag = LOG_ORDER_FLAGS[order] || LOG_ORDER_FLAGS.date;
  const revArgs = [].concat(revspec == null ? ['HEAD'] : revspec).map(assertSafeRevspecEntry);
  const args = ['--no-optional-locks', 'log', '--no-color', '--no-show-signature', orderFlag];
  if (Number(skip) > 0) args.push(`--skip=${Math.floor(Number(skip))}`);
  if (Number(limit) > 0) args.push(`--max-count=${Math.floor(Number(limit))}`);
  args.push(`--pretty=format:${logPrettyFormat(useMailmap)}`, ...revArgs);
  return parseLogWithParents(await runOr(args, dir, ''));
}

const FOR_EACH_REF_FORMAT = ['%(HEAD)', '%(refname)', '%(objectname)', '%(*objectname)', '%(objecttype)', '%(upstream)'].join(FOR_EACH_REF_FIELD_ESCAPE);

/**
 * Local branches, remote-tracking branches, and tags, via `for-each-ref`.
 * Each head carries `isHead` (this is "which head is HEAD" — an addition
 * beyond the plan's minimal {name,hash,upstream} so that fact isn't lost).
 * Degrades to empty arrays on a repo with no refs at all rather than throwing.
 */
async function forEachRef(dir) {
  const output = await runOr(['--no-optional-locks', 'for-each-ref', '--no-color', `--format=${FOR_EACH_REF_FORMAT}`,
    'refs/heads', 'refs/remotes', 'refs/tags'], dir, '');
  const heads = [];
  const remotes = [];
  const tags = [];
  for (const line of String(output).split('\n')) {
    if (!line) continue;
    const [headMarker, refname, objectName, peeledObjectName, objectType, upstream] = line.split(GG_FIELD_SEP);
    if (refname.startsWith('refs/heads/')) {
      heads.push({
        name: refname.slice('refs/heads/'.length),
        hash: objectName,
        isHead: headMarker === '*',
        upstream: upstream ? upstream.replace(/^refs\/remotes\//, '') : null,
      });
    } else if (refname.startsWith('refs/remotes/')) {
      const rest = refname.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) continue;
      const name = rest.slice(slash + 1);
      if (name === 'HEAD') continue; // the remote's own default-branch pointer, not a real branch
      remotes.push({ remote: rest.slice(0, slash), name, hash: objectName });
    } else if (refname.startsWith('refs/tags/')) {
      const annotated = objectType === 'tag';
      tags.push({ name: refname.slice('refs/tags/'.length), hash: annotated ? (peeledObjectName || objectName) : objectName, annotated });
    }
  }
  return { heads, remotes, tags };
}

const STASH_FORMAT = ['%H', '%gd', '%gs', '%aI'].join(LOG_FIELD_ESCAPE);
const STASH_MESSAGE_BRANCH_RE = /^(?:WIP on|On) (.+):/;

/**
 * Stashes, each with `baseCommitHash` — the commit it was taken from,
 * resolved as `<stashHash>^1` (its own first parent) so a stash can be laid
 * into the graph as a pseudo-commit attached to that commit.
 */
async function stashList(dir) {
  const output = await runOr(['--no-optional-locks', 'stash', 'list', '--no-color', `--format=${STASH_FORMAT}`], dir, '');
  const entries = String(output).split('\n').filter(Boolean).map((line) => {
    const [hash, gd, message, date] = line.split(GG_FIELD_SEP);
    const indexMatch = /stash@\{(\d+)\}/.exec(gd || '');
    const branchMatch = STASH_MESSAGE_BRANCH_RE.exec(message || '');
    return { hash, index: indexMatch ? Number(indexMatch[1]) : null, branch: branchMatch ? branchMatch[1] : null, message: message || '', date };
  });
  const bases = await Promise.all(entries.map(entry => runOr(['--no-optional-locks', 'rev-parse', `${entry.hash}^1`], dir, '')));
  return entries.map((entry, i) => ({ ...entry, baseCommitHash: bases[i].trim() || null }));
}

const REMOTE_V_LINE_RE = /^(\S+)\t(.+) \((fetch|push)\)$/;

/** Configured remotes, with distinct fetch/push URLs when they differ. */
async function remoteList(dir) {
  const output = await runOr(['--no-optional-locks', 'remote', '-v'], dir, '');
  const byName = new Map();
  for (const line of String(output).split('\n')) {
    const match = REMOTE_V_LINE_RE.exec(line);
    if (!match) continue;
    const [, name, url, kind] = match;
    const entry = byName.get(name) || { name, url: null, pushUrl: null };
    if (kind === 'fetch') entry.url = url; else entry.pushUrl = url;
    byName.set(name, entry);
  }
  return [...byName.values()].map(entry => ({ ...entry, pushUrl: entry.pushUrl || entry.url }));
}

/** Effective config across all scopes with [include]/[includeIf] expanded, as {key, value} pairs. */
async function configListIncludes(dir) {
  const output = await runOr(['--no-optional-locks', 'config', '--list', '--includes', '-z'], dir, '');
  return String(output).split('\0').filter(Boolean).map((entry) => {
    const nl = entry.indexOf('\n');
    return nl === -1 ? { key: entry, value: '' } : { key: entry.slice(0, nl), value: entry.slice(nl + 1) };
  });
}

/**
 * File content at a revision (a blob, via `git show <rev>:<path>`), for the
 * diff viewer. `--no-textconv` so a repo's own .gitattributes filter can't
 * substitute different bytes than what's actually stored. `relPath` goes
 * through the same containment check as fileDiff(), then is normalized to
 * '/'-separated (git's pathspec syntax wants that even on Windows).
 */
async function blobAtRevision(dir, rev, relPath) {
  if (typeof rev !== 'string' || !rev || rev.includes('\0') || rev.startsWith('-')) throw new Error('Invalid revision');
  const { relative } = safeRelativePath(dir, relPath);
  return runRaw(['--no-optional-locks', 'show', '--no-color', '--no-textconv', `${rev}:${toGitPath(relative)}`], dir);
}

/** Whether dir is a shallow clone (`git clone --depth=N`). */
async function isShallowRepo(dir) {
  return (await run(['--no-optional-locks', 'rev-parse', '--is-shallow-repository'], dir)) === 'true';
}

/** The repo's root commit hash(es) — a cheap repo-identity signal (a path can be reused by a
 * different repo across a worktree remove/add cycle). Degrades to [] on an unborn HEAD. */
async function rootCommitHashes(dir) {
  const output = await runOr(['--no-optional-locks', 'rev-list', '--max-parents=0', 'HEAD'], dir, '');
  return String(output).split(/\s+/).filter(Boolean);
}

/**
 * The repository's committer identity at the local (this repo only) and
 * global (this user, every repo) config scopes, read separately and never
 * merged — `--local`/`--global` each report exactly what's set at that one
 * scope, unlike a plain `git config user.name` (or configListIncludes()'s
 * effective, --includes-expanded view used elsewhere) which would silently
 * fall back through global/system config and hide whether a local override
 * even exists. A scope with nothing set reads back as null, not an error
 * (`git config --get` exits 1 for a missing key, which runOr's fallback
 * already treats as "no value").
 */
async function userDetails(dir) {
  const readOne = async (scope, key) => {
    const value = await runOr(['--no-optional-locks', 'config', `--${scope}`, '--get', key], dir, '');
    const trimmed = value.trim();
    return trimmed || null;
  };
  const [localName, localEmail, globalName, globalEmail] = await Promise.all([
    readOne('local', 'user.name'), readOne('local', 'user.email'),
    readOne('global', 'user.name'), readOne('global', 'user.email'),
  ]);
  return {
    local: { name: localName, email: localEmail },
    global: { name: globalName, email: globalEmail },
  };
}

module.exports = {
  run, runRaw, version, isGitRepo, repoRoot, branchExists,
  parseWorktreeList, worktreeList, worktreeLock, worktreeUnlock, worktreeMove, worktreePrune, worktreeRepair,
  deleteBranch, isUnmergedBranchError, isValidBranchName, listBranches, mergedBranches, defaultBranch, lastCommit,
  worktreeAdd, worktreeRemove, isDirtyWorktreeError, gitCommonDir, status, unpushedCommits, parseLogWithStat,
  parsePorcelain, snapshot, fileDiff, sideDiff, stageFiles, stageLines, discardFiles, ignorePaths, readEditableFile, saveEditedFile,
  tagExists, toGitPath, safeRelativePath,
  logWithParents, forEachRef, stashList, remoteList, configListIncludes,
  blobAtRevision, isShallowRepo, rootCommitHashes, userDetails,
};
