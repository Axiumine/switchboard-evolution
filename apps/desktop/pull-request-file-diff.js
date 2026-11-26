// pull-request-file-diff.js — the diff of one file of a pull request, or of
// one of its commits, when GitHub gives none.
//
// GitHub leaves out the patch of a file git takes for binary (a NUL byte near
// its start), and it does not follow a `.gitattributes` that gives the file a
// text diff: a prompt template that uses NULs as delimiters is text all the
// same. When the view opens such a file, its two versions come from GitHub
// (the contents API, which gives a file's bytes up to 1 MB) and, when both are
// UTF-8 text, git compares them: `git diff --no-index --text` on two temporary
// files, never in the repository. The patch comes back in GitHub's shape, the
// hunks only, with each NUL shown as ␀.
//
// The two versions: for a pull request, the merge base of its base and its
// head, what GitHub compares; for a commit, its first parent and itself.
// Everything goes through pull-requests.js (the same gh, remote and error
// words), and only validated numbers, hashes and paths reach gh.

const fs = require('fs');
const os = require('os');
const path = require('path');
const pr = require('./pull-requests');
const git = require('./git');
const { BINARY_EXTENSIONS } = require('./project-files');

const MAX_TEXT_BYTES = 1024 * 1024; // the contents API gives a file's bytes up to 1 MB
const MAX_PATH = 4096;
const STATUSES = ['added', 'deleted', 'modified', 'renamed'];
const NUL_SHOWN = '\u2400'; // ␀

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

/** A path as GitHub lists it: relative, no empty, `.` or `..` part, no NUL. */
function validPath(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_PATH || value.includes('\0')) return null;
  const parts = value.split('/');
  return parts.every(part => part && part !== '.' && part !== '..') ? value : null;
}

/** The contents API's path for a file at a commit, each part of its path encoded. */
function contentsPath(target, filePath, ref) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return `repos/${target.owner}/${target.repo}/contents/${encoded}?ref=${ref}`;
}

/** Run `gh api` for one JSON answer: { json } or { failure }. */
async function ghJson(target, endpoint, jq) {
  let result;
  try {
    result = await pr.run(['api', '--hostname', target.host, endpoint, '--jq', jq], { timeoutMs: pr.READ_TIMEOUT_MS });
  } catch (err) {
    return { failure: pr.thrownFailure(err) };
  }
  if (result.code !== 0) return { failure: pr.ghFailure(result, target) };
  try {
    return { json: JSON.parse(result.stdout) };
  } catch {
    return { failure: { error: 'gh answered with something that is not GitHub data', code: 'gh-failed' } };
  }
}

/**
 * The commits to compare, { from, to }: `from` null for a commit with no
 * parent. A pull request's merge base comes from its comparison's second
 * page, which leaves out the commits and the files.
 */
async function versionsOf(target, { number, sha }) {
  const repo = `repos/${target.owner}/${target.repo}`;
  if (sha) {
    const commit = await ghJson(target, `${repo}/git/commits/${sha}`, '{parent: .parents[0].sha}');
    if (commit.failure) return commit;
    return { from: validSha(commit.json.parent), to: sha };
  }
  const pull = await ghJson(target, `${repo}/pulls/${number}`, '{base: .base.sha, head: .head.sha}');
  if (pull.failure) return pull;
  const base = validSha(pull.json.base);
  const head = validSha(pull.json.head);
  if (!base || !head) return { failure: { error: 'GitHub did not say which commits the pull request compares', code: 'gh-failed' } };
  const compare = await ghJson(target, `${repo}/compare/${base}...${head}?per_page=1&page=2`, '{base: .merge_base_commit.sha}');
  if (compare.failure) return compare;
  const mergeBase = validSha(compare.json.base);
  if (!mergeBase) return { failure: { error: 'GitHub did not give the pull request\'s merge base', code: 'gh-failed' } };
  return { from: mergeBase, to: head };
}

/** One version of a file: { bytes }, { tooLarge }, { notFile } (a submodule, a link) or { failure }. */
async function versionAt(target, filePath, ref) {
  const answer = await ghJson(target, contentsPath(target, filePath, ref), '{type, encoding, size, content}');
  if (answer.failure) return answer;
  const { type, encoding, size, content } = answer.json || {};
  if (type !== 'file') return { notFile: true };
  if (!(size <= MAX_TEXT_BYTES) || encoding !== 'base64' || typeof content !== 'string') return { tooLarge: true };
  return { bytes: Buffer.from(content, 'base64') };
}

/** True for bytes that read as UTF-8 text: valid UTF-8, NULs at most a tenth of them (UTF-16 is half NULs). */
function isText(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  let nuls = 0;
  for (const byte of bytes) if (byte === 0) nuls++;
  return nuls * 10 <= bytes.length;
}

/** git's diff output in GitHub's shape: from the first hunk on, without the last newline, NULs shown as ␀. */
function hunksOf(output) {
  const text = String(output || '');
  const first = /^@@/m.exec(text);
  if (!first) return '';
  return text.slice(first.index).replace(/\n$/, '').split('\0').join(NUL_SHOWN);
}

/** The hunks between two versions' bytes, git comparing them as text. */
async function diffBytes(before, after) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'switchboard-pr-diff-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    await Promise.all([fs.promises.writeFile(a, before), fs.promises.writeFile(b, after)]);
    const output = await git.runRaw(
      ['diff', '--no-index', '--text', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', '--', 'a', 'b'],
      dir,
      { allowExitCodes: [1] },
    );
    return hunksOf(output);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The diff of one file GitHub gave no patch for: { ok, patch } (empty when
 * its text did not change), { ok, binary } or { ok, tooLarge }, or { error }.
 * `number` names a pull request, `sha` one of its commits.
 */
async function textDiff(dir, { remote = null, number = null, sha = null, path: filePath, oldPath = null, status = 'modified' } = {}) {
  const n = number == null ? null : pr.validNumber(number);
  const commit = sha == null ? null : validSha(sha);
  const file = validPath(filePath);
  const previous = oldPath == null ? null : validPath(oldPath);
  if ((n ? 1 : 0) + (commit ? 1 : 0) !== 1 || !file || (oldPath != null && !previous) || !STATUSES.includes(status)) {
    return { error: 'Not a file of a pull request or commit', code: 'bad-request' };
  }
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) return { ok: true, binary: true };
  const { target, failure } = await pr.targetFor(dir, remote);
  if (failure) return failure;
  const versions = await versionsOf(target, { number: n, sha: commit });
  if (versions.failure) return versions.failure;
  const empty = { bytes: Buffer.alloc(0) };
  const [before, after] = await Promise.all([
    status === 'added' || !versions.from ? empty : versionAt(target, previous || file, versions.from),
    status === 'deleted' ? empty : versionAt(target, file, versions.to),
  ]);
  if (before.failure) return before.failure;
  if (after.failure) return after.failure;
  if (before.tooLarge || after.tooLarge) return { ok: true, tooLarge: true };
  if (before.notFile || after.notFile || !isText(before.bytes) || !isText(after.bytes)) return { ok: true, binary: true };
  try {
    return { ok: true, patch: await diffBytes(before.bytes, after.bytes) };
  } catch (err) {
    return { error: (err && err.message) || String(err), code: 'git-failed' };
  }
}

module.exports = {
  textDiff,
  // exported for tests
  validPath, contentsPath, isText, hunksOf, diffBytes, MAX_TEXT_BYTES,
};
