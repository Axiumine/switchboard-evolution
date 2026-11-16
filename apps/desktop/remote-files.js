// Folders and files for a phone. Choosing a folder, where the window would
// open the system's folder picker (browse-folder): the subfolders of one
// folder at a time. Listing, reading and saving files only inside a project's
// folder or a folder attached to one, with the same path checks as the
// window's file browser (project-files.js); the window's own save
// (save-file-for-panel) writes any path and stays off the phone.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { manageProjectEntry, createProjectEntry, duplicateProjectEntry, pasteProjectEntry } = require('./file-management');
const fileTimeline = require('./file-timeline');
const { resolveProjectEntry, isViewableFile, previewType, readProjectFile, listProjectDirectory, MAX_PREVIEW_BYTES } = require('./project-files');

// A phone gets the whole file in one message.
const MAX_PHONE_MEDIA_BYTES = 8 * 1024 * 1024;

/** { path, parent, folders: [{ name, path }] } for an absolute path (home by default), or { error }. */
function listFolders(dir = os.homedir(), { hidden = false } = {}) {
  if (!path.isAbsolute(dir)) return { error: 'The path must be absolute' };
  const resolved = path.resolve(dir);
  let entries;
  try {
    if (!fs.statSync(resolved).isDirectory()) return { error: 'Not a folder' };
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'Folder not found' : err.message };
  }
  const folders = [];
  for (const entry of entries) {
    if (!hidden && entry.name.startsWith('.')) continue;
    const full = path.join(resolved, entry.name);
    let isFolder = entry.isDirectory();
    // A link to a folder is a folder you can pick.
    if (!isFolder && entry.isSymbolicLink()) {
      try { isFolder = fs.statSync(full).isDirectory(); } catch {}
    }
    if (isFolder) folders.push({ name: entry.name, path: full });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const parent = path.dirname(resolved);
  return { path: resolved, parent: parent === resolved ? null : parent, folders };
}

/**
 * A new empty folder `name` inside `dir`, the folder the phone's picker shows,
 * as New Folder does in the system's picker: { ok: true, path } or
 * { ok: false, error }. One name, not a path; nothing that exists is replaced.
 */
function createFolder(dir, name) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, error: 'The path must be absolute' };
  const folderName = typeof name === 'string' ? name.trim() : '';
  if (!folderName || folderName === '.' || folderName === '..' || /[/\\\0]/.test(folderName)) {
    return { ok: false, error: 'Enter a folder name without slashes' };
  }
  const parent = path.resolve(dir);
  try {
    if (!fs.statSync(parent).isDirectory()) return { ok: false, error: 'Not a folder' };
    const created = path.join(parent, folderName);
    fs.mkdirSync(created);
    return { ok: true, path: created };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, error: 'Folder not found' };
    if (err.code === 'EEXIST') return { ok: false, error: 'A file or folder with that name already exists' };
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, error: 'No permission to create a folder here' };
    return { ok: false, error: err.message };
  }
}

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

/**
 * Replace the text of a file that already exists inside the project. With
 * `expectedVersion` (the sha1 the phone got when it read the file) the save
 * happens only if the file still has those bytes; otherwise nothing is
 * written and the answer says CHANGED, with the version now on disk.
 */
function saveProjectFile(projectPath, relativePath, content, expectedVersion) {
  try {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_PREVIEW_BYTES) return { ok: false, error: 'The text is too long' };
    let resolved;
    try {
      ({ resolved } = resolveProjectEntry(projectPath, relativePath));
    } catch (err) {
      return { ok: false, error: err.code === 'ENOENT' ? 'The file does not exist' : err.message };
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, error: 'This is not a file' };
    if (!isViewableFile(resolved, stat) || !['text', 'html'].includes(previewType(resolved))) return { ok: false, error: 'This is not a text file' };
    if (typeof expectedVersion === 'string') {
      const current = sha1(fs.readFileSync(resolved));
      if (current !== expectedVersion) return { ok: false, code: 'CHANGED', error: 'The file changed on the computer', version: current };
    }
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true, version: sha1(Buffer.from(content, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** read-project-file without the desktop's own URLs, and with media small enough to send. */
function readProjectFileForPhone(projectPath, relativePath, { maxMediaBytes = MAX_PHONE_MEDIA_BYTES } = {}) {
  try {
    const { filePath, fileUrl, previewUrl, ...file } = readProjectFile(projectPath, relativePath, { withVersion: true });
    if (file.base64 && file.base64.length * 0.75 > maxMediaBytes) {
      return { ok: false, error: 'File is too large to send to the phone', code: 'PREVIEW_UNAVAILABLE' };
    }
    return { ok: true, ...file };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
}

// A download to the phone comes in pieces this big: one message each, well
// under the protocol's 16 MB frame limit once in base64.
const DOWNLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * A piece of any file inside the project, from byte `offset`, for a phone
 * that downloads it: { ok, size, modified, base64 }. The phone asks for the
 * next piece at the offset it got to, and stops if `size` or `modified`
 * change on the way (the file changed while it downloaded).
 */
function readProjectFileChunk(projectPath, relativePath, offset = 0, { chunkBytes = DOWNLOAD_CHUNK_BYTES } = {}) {
  try {
    let resolved;
    try {
      ({ resolved } = resolveProjectEntry(projectPath, relativePath));
    } catch (err) {
      return { ok: false, error: err.code === 'ENOENT' ? 'The file does not exist' : err.message };
    }
    // Checked before opening: opening a named pipe would wait for a writer.
    if (!fs.statSync(resolved).isFile()) return { ok: false, error: 'This is not a file' };
    const fd = fs.openSync(resolved, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (!Number.isInteger(offset) || offset < 0 || offset > stat.size) return { ok: false, error: 'The file changed on the computer' };
      const buffer = Buffer.alloc(Math.min(chunkBytes, stat.size - offset));
      const read = buffer.length ? fs.readSync(fd, buffer, 0, buffer.length, offset) : 0;
      return { ok: true, size: stat.size, modified: stat.mtimeMs, base64: buffer.subarray(0, read).toString('base64') };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** `child` is `folder` or inside it (both real paths). */
const isInside = (folder, child) => child === folder || child.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep);

/**
 * File access for a phone, inside the folders `roots()` lists (project roots
 * and attached folders) and nowhere else, whatever root the phone names.
 * `readRoots()` are folders whose files a phone may also open and save,
 * without managing them (Claude's plans folder). `shell` (Electron's) moves
 * an item to the Trash.
 */
function createPhoneFiles({ roots, readRoots = () => [], shell }) {
  const refused = { ok: false, error: 'Not a folder of a project' };
  const known = (projectPath) => typeof projectPath === 'string' && roots().includes(projectPath);
  const readable = (projectPath) => known(projectPath) || (typeof projectPath === 'string' && readRoots().includes(projectPath));
  return {
    list(projectPath, relativePath) {
      if (!known(projectPath)) return refused;
      try { return { ok: true, entries: listProjectDirectory(projectPath, relativePath) }; } catch (err) { return { ok: false, error: err.message }; }
    },
    read: (projectPath, relativePath) => (readable(projectPath) ? readProjectFileForPhone(projectPath, relativePath) : refused),
    /** Any file, not only one the phone can show: a piece of it, to download. */
    chunk: (projectPath, relativePath, offset) => (readable(projectPath) ? readProjectFileChunk(projectPath, relativePath, offset) : refused),
    save: (projectPath, relativePath, content, expectedVersion) => (readable(projectPath)
      ? saveProjectFile(projectPath, relativePath, content, expectedVersion) : refused),
    /**
     * Where a path a session mentions is, for a phone to open it: { ok, root,
     * relativePath, type } with `root` one of the folders above, as they are
     * listed. An absolute or ~/ path is taken as is; a relative one is looked
     * for in the session's folder (`cwd`), then in each folder.
     */
    locate(filePath, cwd) {
      if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, error: 'No path' };
      const home = os.homedir();
      const wanted = filePath === '~' ? home : filePath.startsWith('~/') ? path.join(home, filePath.slice(2)) : filePath;
      const folders = [];
      for (const folder of [...roots(), ...readRoots()]) {
        try { folders.push({ folder, real: fs.realpathSync(folder) }); } catch {}
      }
      // The deepest folder first: a file of an attached folder inside the project opens there.
      folders.sort((a, b) => b.real.length - a.real.length);
      const candidates = path.isAbsolute(wanted) ? [wanted] : [
        ...(typeof cwd === 'string' && path.isAbsolute(cwd) ? [path.resolve(cwd, wanted)] : []),
        ...folders.map(({ folder }) => path.resolve(folder, wanted)),
      ];
      let outside = false;
      for (const candidate of candidates) {
        let real;
        try { real = fs.realpathSync(candidate); } catch { continue; }
        const match = folders.find(({ real: folder }) => isInside(folder, real));
        if (!match) { outside = true; continue; }
        const type = fs.statSync(real).isDirectory() ? 'directory' : 'file';
        return { ok: true, root: match.folder, relativePath: path.relative(match.real, real), type };
      }
      return { ok: false, error: outside ? 'This file is outside the folders of your projects' : `${filePath} was not found` };
    },
    /**
     * Rename or move to the Trash. Revealing in Finder or opening a folder
     * would act on the Mac's screen, so they are not offered. The phone has
     * asked its user about the Trash already, so there is no dialog here.
     */
    async manage(projectPath, relativePath, action, newName) {
      if (!known(projectPath)) return refused;
      if (action !== 'rename' && action !== 'trash') return { ok: false, error: 'Unknown file action' };
      try {
        const result = await manageProjectEntry(projectPath, relativePath, action, newName, { shell, confirmTrash: async () => true });
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    // The explorer's other actions, as in the window's Files tab.
    create: (projectPath, folderRelative, name, kind) => guard([projectPath], () => createProjectEntry(projectPath, folderRelative, name, kind)),
    duplicate: (projectPath, relativePath) => guard([projectPath], () => duplicateProjectEntry(projectPath, relativePath)),
    paste: (sourcePath, sourceRelative, targetPath, targetRelative, mode) => guard([sourcePath, targetPath],
      () => pasteProjectEntry(sourcePath, sourceRelative, targetPath, targetRelative, mode)),
    timeline: (projectPath, relativePath) => guard([projectPath], () => fileTimeline.getFileTimeline(projectPath, relativePath)),
    timelineDiff: (projectPath, relativePath, hash, repoPath, oldPath) => guard([projectPath],
      () => fileTimeline.getFileTimelineDiff(projectPath, relativePath, hash, repoPath, oldPath)),
  };

  async function guard(paths, fn) {
    if (!paths.every(known)) return refused;
    try {
      return { ok: true, ...await fn() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = { listFolders, createFolder, saveProjectFile, readProjectFileForPhone, readProjectFileChunk, createPhoneFiles };
