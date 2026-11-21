const fs = require('fs');
const path = require('path');
const { resolveProjectEntry } = require('./project-files');
const { topLevelPicks } = require('./public/file-selection');

// Resolve the parent, not the leaf: renaming/trashing a symlink must act on
// the link itself. Parents still have to resolve inside the project.
function resolveManagedEntry(projectPath, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Invalid project-relative path');
  }
  const { root } = resolveProjectEntry(projectPath);
  const candidate = path.resolve(root, relativePath);
  if (candidate === root) throw new Error('The project folder itself cannot be changed');
  const { resolved: parent } = resolveProjectEntry(root, path.relative(root, path.dirname(candidate)));
  const filePath = path.join(parent, path.basename(candidate));
  const stat = fs.lstatSync(filePath);
  return { root, filePath, stat };
}

async function manageProjectEntry(projectPath, relativePath, action, newName, { shell, confirmTrash }) {
  const { filePath, stat } = resolveManagedEntry(projectPath, relativePath);
  const result = { action, projectPath, relativePath, filePath };
  if (action === 'reveal') {
    shell.showItemInFolder(filePath);
  } else if (action === 'open-folder') {
    if (!stat.isDirectory()) throw new Error('Not a folder');
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  } else if (action === 'rename') {
    if (typeof newName !== 'string' || !newName.trim() || newName === '.' || newName === '..' || /[/\\\0]/.test(newName)) {
      throw new Error('Enter a file or folder name without path separators');
    }
    const newFilePath = path.join(path.dirname(filePath), newName);
    if (newFilePath === filePath) return { ...result, cancelled: true };
    // lstat also catches dangling symlinks, which existsSync would miss.
    try {
      fs.lstatSync(newFilePath);
      throw new Error('A file or folder with that name already exists');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    fs.renameSync(filePath, newFilePath);
    result.newFilePath = newFilePath;
    result.newRelativePath = path.join(path.dirname(relativePath), newName);
  } else if (action === 'trash') {
    if (!await confirmTrash(filePath, stat.isDirectory())) return { ...result, cancelled: true };
    // A native confirmation is asynchronous. Recheck before acting in case
    // the item or one of its parents was replaced while the dialog was open.
    const current = resolveManagedEntry(projectPath, relativePath);
    if (current.filePath !== filePath || current.stat.ino !== stat.ino || current.stat.dev !== stat.dev) {
      throw new Error('The item changed while confirming. Refresh the files and try again.');
    }
    await shell.trashItem(filePath);
  } else {
    throw new Error('Unknown file action');
  }
  return result;
}

/**
 * Move several entries of a project folder to the Trash after one question.
 * A folder takes what is inside it, so ticked entries inside a ticked folder
 * are not trashed twice. Each entry is checked again after the question, as
 * manageProjectEntry does; one that cannot be moved does not stop the others.
 * Resolves { action: 'trash-many', projectPath, removed, failed, changes },
 * where `changes` are the single trash changes the views know how to follow.
 */
async function trashProjectEntries(projectPath, relativePaths, { shell, confirm }) {
  if (!Array.isArray(relativePaths) || !relativePaths.length) throw new Error('Nothing to move to the Trash');
  const result = { action: 'trash-many', projectPath, removed: [], failed: [], changes: [] };
  const entries = [];
  for (const rel of topLevelPicks(relativePaths)) {
    try {
      const { filePath, stat } = resolveManagedEntry(projectPath, rel);
      entries.push({ rel, filePath, stat });
    } catch (err) {
      result.failed.push({ rel, error: err.code === 'ENOENT' ? 'No longer exists' : err.message });
    }
  }
  if (!entries.length) return result;
  if (!await confirm(entries.map(({ rel, stat }) => ({ rel, isDir: stat.isDirectory() })))) return { ...result, cancelled: true };
  for (const { rel, filePath, stat } of entries) {
    try {
      const current = resolveManagedEntry(projectPath, rel);
      if (current.filePath !== filePath || current.stat.ino !== stat.ino || current.stat.dev !== stat.dev) {
        throw new Error('Changed while confirming');
      }
      await shell.trashItem(filePath);
      result.removed.push(rel);
      result.changes.push({ action: 'trash', projectPath, relativePath: rel, filePath });
    } catch (err) {
      result.failed.push({ rel, error: err.code === 'ENOENT' ? 'No longer exists' : err.message });
    }
  }
  return result;
}

// The viewer panels also open files outside any project (plans, memory), so
// this takes an absolute path rather than a project-relative one. It only
// shows the item in its folder, so a renderer value can never launch a file.
function revealFile(filePath, { shell }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path');
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error('File does not exist');
  shell.showItemInFolder(resolved);
  return { filePath: resolved };
}

// Hand a viewer panel's file to the system share menu. Takes an absolute path,
// since those panels also open files outside any project, and only shares a
// file that exists.
function shareFile(filePath, { share }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path');
  let resolved;
  try {
    resolved = fs.realpathSync(filePath);
  } catch {
    throw new Error('The file does not exist');
  }
  if (!fs.statSync(resolved).isFile()) throw new Error('Not a file');
  share(resolved);
  return { filePath: resolved };
}

// --- Explorer actions: new file or folder, duplicate, copy / cut and paste ---

function checkEntryName(name) {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new Error('Enter a file or folder name without path separators');
  }
}

function entryExists(filePath) {
  // lstat also catches dangling symlinks, which existsSync would miss.
  try { fs.lstatSync(filePath); return true; } catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

/** The folder a new or pasted entry goes into: the root itself for ''. */
function resolveTargetFolder(projectPath, folderRelative = '') {
  if (typeof folderRelative !== 'string' || path.isAbsolute(folderRelative)) throw new Error('Invalid project-relative path');
  const { root, resolved } = resolveProjectEntry(projectPath, folderRelative);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Not a folder');
  return { root, folder: resolved };
}

/**
 * Create an empty file or a folder inside `folderRelative`. The name may hold
 * "/" to create the folders on the way (as an editor's New File does), each
 * part checked like a rename; nothing that already exists is touched.
 */
function createProjectEntry(projectPath, folderRelative, name, kind) {
  if (kind !== 'file' && kind !== 'folder') throw new Error('Unknown kind of entry');
  if (typeof name !== 'string') throw new Error('Enter a name');
  const parts = name.split('/').map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Enter a name');
  parts.forEach(checkEntryName);
  const { root, folder } = resolveTargetFolder(projectPath, folderRelative);
  const filePath = path.join(folder, ...parts);
  if (entryExists(filePath)) throw new Error('A file or folder with that name already exists');
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  // The folders on the way must still be inside the root once created.
  resolveProjectEntry(root, path.relative(root, parent));
  if (kind === 'folder') fs.mkdirSync(filePath);
  else fs.writeFileSync(filePath, '', { flag: 'wx' });
  return { action: 'create', kind, projectPath, relativePath: path.relative(root, filePath), filePath };
}

/** "name copy.ext", then "name copy 2.ext", … in `folder`, as Finder and VS Code name a copy. */
function copyName(folder, name, isDirectory) {
  // extname is '' for ".env", so a dotfile keeps its whole name as the stem.
  const ext = isDirectory ? '' : path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 10000; n++) {
    const candidate = `${stem} copy${n === 1 ? '' : ' ' + n}${ext}`;
    if (!entryExists(path.join(folder, candidate))) return candidate;
  }
  throw new Error('Could not find a free name for the copy');
}

function copyEntry(from, to) {
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
}

/** A copy of a file or folder next to it. */
function duplicateProjectEntry(projectPath, relativePath) {
  const { root, filePath, stat } = resolveManagedEntry(projectPath, relativePath);
  const folder = path.dirname(filePath);
  const newFilePath = path.join(folder, copyName(folder, path.basename(filePath), stat.isDirectory()));
  copyEntry(filePath, newFilePath);
  return { action: 'duplicate', projectPath, relativePath, filePath, newFilePath, newRelativePath: path.relative(root, newFilePath) };
}

/**
 * Paste an entry copied or cut in the file explorer into a folder, possibly
 * of another root (the project folder or an attached folder). A copy that
 * lands next to its own name gets a "copy" name; a move never replaces
 * anything. The answer has the old and new paths, for open editors.
 */
function pasteProjectEntry(sourceProjectPath, sourceRelative, targetProjectPath, targetFolderRelative, mode) {
  if (mode !== 'copy' && mode !== 'move') throw new Error('Unknown paste mode');
  const source = resolveManagedEntry(sourceProjectPath, sourceRelative);
  const { root, folder } = resolveTargetFolder(targetProjectPath, targetFolderRelative);
  const name = path.basename(source.filePath);
  const realSource = source.stat.isSymbolicLink() ? source.filePath : fs.realpathSync(source.filePath);
  if (source.stat.isDirectory() && (folder === realSource || folder.startsWith(realSource + path.sep))) {
    throw new Error('A folder cannot be pasted inside itself');
  }
  const result = { action: mode, projectPath: sourceProjectPath, relativePath: sourceRelative, filePath: source.filePath, newProjectPath: targetProjectPath };
  let newFilePath = path.join(folder, name);
  if (mode === 'move') {
    if (newFilePath === source.filePath) return { ...result, cancelled: true };
    if (entryExists(newFilePath)) throw new Error(`"${name}" already exists in that folder`);
    try {
      fs.renameSync(source.filePath, newFilePath);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      // Another volume: copy, then remove the original only once the copy is whole.
      copyEntry(source.filePath, newFilePath);
      fs.rmSync(source.filePath, { recursive: true, force: true });
    }
  } else {
    if (entryExists(newFilePath)) newFilePath = path.join(folder, copyName(folder, name, source.stat.isDirectory()));
    copyEntry(source.filePath, newFilePath);
  }
  return { ...result, newFilePath, newRelativePath: path.relative(root, newFilePath) };
}

module.exports = {
  manageProjectEntry, trashProjectEntries, resolveManagedEntry, revealFile, shareFile,
  createProjectEntry, duplicateProjectEntry, pasteProjectEntry, copyName,
  checkEntryName, entryExists, resolveTargetFolder,
};
