// The Timeline of a file in the Files tab: the commits that changed it,
// newest first, following renames, and the file before and after each one.
// Every path comes in relative to a folder Switchboard shows (a project root
// or an attached folder) and is checked to stay inside it; git runs in the
// repository that holds the file, which may be that folder or one above it.

const fs = require('fs');
const path = require('path');
const git = require('./git');
const { resolveProjectEntry } = require('./project-files');

const MAX_ENTRIES = 200;
const HASH = /^[0-9a-f]{7,64}$/i;
// Fields of one commit; a record starts with RS so the --name-status lines that follow stay with it.
const FORMAT = '%x1e%H%x00%P%x00%an%x00%ae%x00%at%x00%s';

/** The repository that holds a file or folder inside `projectPath`, and its path there. */
async function locate(projectPath, relativePath) {
  const { resolved } = resolveProjectEntry(projectPath, relativePath);
  const stat = fs.statSync(resolved);
  const dir = stat.isDirectory() ? resolved : path.dirname(resolved);
  if (!await git.isGitRepo(dir)) return null;
  const top = fs.realpathSync(await git.repoRoot(dir));
  const repoPath = git.toGitPath(path.relative(top, resolved));
  return { repoRoot: top, repoPath, isDirectory: stat.isDirectory() };
}

function parseLog(output) {
  const entries = [];
  for (const record of output.split('\x1e')) {
    if (!record.trim()) continue;
    const [head, ...rest] = record.split('\n');
    const [hash, parents, authorName, authorEmail, at, ...subject] = head.split('\x00');
    if (!HASH.test(hash || '')) continue;
    // With --follow and --name-status a commit lists the file once, under its name
    // there: "M\tpath", "A\tpath" or "R100\told\tnew".
    let status = 'M';
    let filePath = null;
    let oldPath = null;
    for (const line of rest) {
      if (!line.trim()) continue;
      const fields = line.split('\t');
      status = fields[0][0] || 'M';
      if ((status === 'R' || status === 'C') && fields.length >= 3) { oldPath = fields[1]; filePath = fields[2]; }
      else filePath = fields[1] || null;
      break;
    }
    entries.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName,
      authorEmail,
      date: Number(at) * 1000,
      subject: subject.join('\x00'),
      status,
      path: filePath,
      oldPath,
    });
  }
  return entries;
}

/**
 * { ok, repoRoot, repoPath, uncommitted, entries } for a file or folder, or
 * { ok: true, repoRoot: null } outside a repository. Folders are listed
 * without following renames, which git only does for one file.
 */
async function getFileTimeline(projectPath, relativePath) {
  const where = await locate(projectPath, relativePath);
  if (!where) return { ok: true, repoRoot: null, entries: [] };
  const { repoRoot, repoPath, isDirectory } = where;
  const args = ['--no-optional-locks', 'log', `--max-count=${MAX_ENTRIES}`, '--no-color', `--format=${FORMAT}`, '--name-status', '-M'];
  if (!isDirectory) args.push('--follow');
  args.push('--', repoPath || '.');
  let output = '';
  try { output = await git.run(args, repoRoot); } catch (err) {
    // A repository without commits has no history yet.
    if (!/does not have any commits|bad default revision|unknown revision/i.test(err.message)) throw err;
  }
  const entries = parseLog(output);
  // Folders get every file of theirs in --name-status; keep the folder as the path.
  if (isDirectory) for (const entry of entries) { entry.path = repoPath; entry.oldPath = null; }
  const status = await git.run(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', repoPath || '.'], repoRoot).catch(() => '');
  return { ok: true, repoRoot, repoPath, isDirectory, uncommitted: !!status.trim(), entries };
}

function checkRepoPath(repoRoot, value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Invalid path');
  return git.safeRelativePath(repoRoot, value).relative;
}

/**
 * The file before and after one commit of its timeline (`hash` null: the
 * working copy against HEAD). `repoPath` is its name in that commit and
 * `oldPath` the name it had before, for a rename.
 */
async function getFileTimelineDiff(projectPath, relativePath, hash, repoPath, oldPath) {
  const where = await locate(projectPath, relativePath);
  if (!where) throw new Error('This file is not in a Git repository');
  const { repoRoot } = where;
  const current = checkRepoPath(repoRoot, repoPath || where.repoPath);
  const before = oldPath ? checkRepoPath(repoRoot, oldPath) : current;
  const show = (rev, file) => git.blobAtRevision(repoRoot, rev, file).catch(() => '');
  if (hash === null || hash === undefined) {
    let newContent = '';
    try { newContent = fs.readFileSync(path.join(repoRoot, current), 'utf8'); } catch {}
    return { ok: true, oldContent: await show('HEAD', current), newContent, path: git.toGitPath(current) };
  }
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invalid commit');
  const parents = (await git.run(['--no-optional-locks', 'rev-list', '--parents', '-n', '1', hash], repoRoot)).split(' ').slice(1);
  return {
    ok: true,
    oldContent: parents.length ? await show(parents[0], before) : '',
    newContent: await show(hash, current),
    path: git.toGitPath(current),
  };
}

/** The file as it was in one commit. */
async function getFileAtCommit(projectPath, relativePath, hash, repoPath) {
  const where = await locate(projectPath, relativePath);
  if (!where) throw new Error('This file is not in a Git repository');
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invalid commit');
  const file = checkRepoPath(where.repoRoot, repoPath || where.repoPath);
  return { ok: true, content: await git.blobAtRevision(where.repoRoot, hash, file), path: git.toGitPath(file) };
}

module.exports = { getFileTimeline, getFileTimelineDiff, getFileAtCommit, parseLog };
