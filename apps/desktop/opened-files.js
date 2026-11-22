// The files of the sidebar's Files tab that are not agent files: those opened
// by dropping them on the sidebar, most recent first. And the files pinned at
// the top of that tab, in the order the user gave them: any file of the tab,
// an opened one or an agent file (CLAUDE.md, AGENTS.md, memory…).
//
// Kept in the settings under `openedFiles` as
//   { opened: [{ filePath, openedAt }], pinned: [filePath, …] }
// The functions here only shape that value; main.js reads and writes it.

const fs = require('fs');
const path = require('path');

const OPENED_FILES_SETTING = 'openedFiles';
// Opened files the list keeps. Pinned ones are kept beyond it.
const MAX_OPENED_FILES = 200;
const MAX_PINNED_FILES = 200;
const MAX_PATH_LENGTH = 4096;

function isFilePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH && path.isAbsolute(value);
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Drop what the oldest opened files beyond the limit take, never a pinned one. */
function capOpened(opened, pinned) {
  if (opened.length <= MAX_OPENED_FILES) return opened;
  const keep = new Set(pinned);
  let room = MAX_OPENED_FILES - opened.filter(e => keep.has(e.filePath)).length;
  return opened.filter((entry) => {
    if (keep.has(entry.filePath)) return true;
    if (room <= 0) return false;
    room--;
    return true;
  });
}

/** The stored value as it should be: known fields, absolute paths, no repeats. */
function normalizeOpenedFiles(value) {
  const source = value && typeof value === 'object' ? value : {};
  const pinned = [];
  for (const filePath of Array.isArray(source.pinned) ? source.pinned : []) {
    if (!isFilePath(filePath) || pinned.includes(filePath)) continue;
    pinned.push(filePath);
    if (pinned.length >= MAX_PINNED_FILES) break;
  }
  const opened = [];
  const seen = new Set();
  for (const entry of Array.isArray(source.opened) ? source.opened : []) {
    const filePath = entry && entry.filePath;
    if (!isFilePath(filePath) || seen.has(filePath)) continue;
    seen.add(filePath);
    opened.push({ filePath, openedAt: validDate(entry.openedAt) ? entry.openedAt : new Date(0).toISOString() });
  }
  return { opened: capOpened(opened, pinned), pinned };
}

/** These files opened now: at the top of the list, in the order given. */
function addOpened(state, filePaths, now = new Date()) {
  const current = normalizeOpenedFiles(state);
  const fresh = [];
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    if (isFilePath(filePath) && !fresh.includes(filePath)) fresh.push(filePath);
  }
  if (!fresh.length) return current;
  const openedAt = now.toISOString();
  const rest = current.opened.filter(entry => !fresh.includes(entry.filePath));
  const opened = [...fresh.map(filePath => ({ filePath, openedAt })), ...rest];
  return { opened: capOpened(opened, current.pinned), pinned: current.pinned };
}

/** As if the file had never been opened in the app: out of the list and of the pins. */
function removeOpened(state, filePath) {
  const current = normalizeOpenedFiles(state);
  return {
    opened: current.opened.filter(entry => entry.filePath !== filePath),
    pinned: current.pinned.filter(p => p !== filePath),
  };
}

/** Pin a file (at the end of the pinned ones) or unpin it. */
function setPinned(state, filePath, pinned) {
  const current = normalizeOpenedFiles(state);
  if (!isFilePath(filePath)) return current;
  const without = current.pinned.filter(p => p !== filePath);
  if (!pinned) return { opened: current.opened, pinned: without };
  if (current.pinned.includes(filePath)) return current;
  if (current.pinned.length >= MAX_PINNED_FILES) return current;
  return { opened: current.opened, pinned: [...current.pinned, filePath] };
}

/** A pinned file moved to `toIndex` among the pinned ones (clamped). */
function movePinned(state, filePath, toIndex) {
  const current = normalizeOpenedFiles(state);
  const from = current.pinned.indexOf(filePath);
  const index = Number.isFinite(Number(toIndex)) ? Math.trunc(Number(toIndex)) : from;
  if (from < 0) return current;
  const to = Math.max(0, Math.min(current.pinned.length - 1, index));
  if (to === from) return current;
  const pinned = current.pinned.slice();
  pinned.splice(from, 1);
  pinned.splice(to, 0, filePath);
  return { opened: current.opened, pinned };
}

/** The folder a file is in, as the list shows it: under `~` when it is in the home folder. */
function displayFolder(filePath, home) {
  const dir = path.dirname(filePath);
  if (home && (dir === home || dir.startsWith(home + path.sep))) return '~' + dir.slice(home.length);
  return dir;
}

/** A file as a row of the list shows it, looked up on disk now. */
function describeFile(filePath, { home = '', statSync = fs.statSync } = {}) {
  let exists = false;
  let modified = null;
  try {
    const stat = statSync(filePath);
    exists = stat.isFile();
    modified = stat.mtime.toISOString();
  } catch {}
  return { filePath, filename: path.basename(filePath), displayPath: displayFolder(filePath, home), modified, exists };
}

/** What the renderer gets: every opened and pinned file described. */
function describeOpenedFiles(state, options = {}) {
  const current = normalizeOpenedFiles(state);
  return {
    opened: current.opened.map(entry => ({ ...describeFile(entry.filePath, options), openedAt: entry.openedAt })),
    pinned: current.pinned.map(filePath => describeFile(filePath, options)),
  };
}

/** `filePath` when it is an absolute path to an existing file, else null. */
function existingFilePath(filePath, { statSync = fs.statSync } = {}) {
  if (!isFilePath(filePath)) return null;
  try { return statSync(filePath).isFile() ? filePath : null; } catch { return null; }
}

/**
 * The dropped paths split into the files to open and the rest (folders,
 * missing paths), each with the reason it was left out.
 */
function checkDroppedPaths(paths, { statSync = fs.statSync } = {}) {
  const files = [];
  const rejected = [];
  for (const filePath of Array.isArray(paths) ? paths : []) {
    if (!isFilePath(filePath)) { rejected.push({ filePath: String(filePath || ''), reason: 'Not an absolute path' }); continue; }
    try {
      const stat = statSync(filePath);
      if (stat.isFile()) { if (!files.includes(filePath)) files.push(filePath); }
      else rejected.push({ filePath, reason: stat.isDirectory() ? 'Folders cannot be opened' : 'Not a file' });
    } catch {
      rejected.push({ filePath, reason: 'File not found' });
    }
  }
  return { files, rejected };
}

module.exports = {
  OPENED_FILES_SETTING,
  MAX_OPENED_FILES,
  MAX_PINNED_FILES,
  isFilePath,
  normalizeOpenedFiles,
  addOpened,
  removeOpened,
  setPinned,
  movePinned,
  displayFolder,
  describeFile,
  describeOpenedFiles,
  existingFilePath,
  checkDroppedPaths,
};
