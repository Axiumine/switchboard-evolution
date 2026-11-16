// Files a paired phone puts on this computer for a session: a photo or file
// from the phone's attach button. They are stored under
// <dir>/<session id>/ and the absolute path goes back to the phone, which
// pastes it into the session (Claude Code turns a pasted image path into an
// attachment; any CLI can read a path). Files older than a week are removed
// whenever one is saved.

const fs = require('fs');
const path = require('path');

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/;
// Bytes, not characters: a file name is at most 255 bytes. This leaves room for a "-2" counter.
const MAX_STORED_NAME_BYTES = 200;
const MAX_EXTENSION_BYTES = 16;
const bytes = (text) => Buffer.byteLength(text);

/** The start of `text` that fits in `limit` bytes of UTF-8, without cutting a character. */
function fitBytes(text, limit) {
  let out = '';
  let used = 0;
  for (const char of text) {
    used += bytes(char);
    if (used > limit) break;
    out += char;
  }
  return out;
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** YYYYMMDD-HHMMSS in the computer's time. */
function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isBaseName(name) {
  return typeof name === 'string'
    && name.trim() !== ''
    && name !== '.' && name !== '..'
    && !name.includes('\\')
    // A newline in a pasted path would press Enter in a terminal.
    && !/[\x00-\x1f\x7f]/.test(name)
    && path.basename(name) === name;
}

/** The path is a real folder here, not a link to somewhere else. */
function isRealDirectory(p) {
  try {
    const stat = fs.lstatSync(p);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The folder for the session, created if needed; null when it or `dir` is a link or not a folder. */
function sessionFolder(dir, sessionId) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!isRealDirectory(dir)) return null;
  const folder = path.join(dir, sessionId);
  if (!fs.lstatSync(folder, { throwIfNoEntry: false })) fs.mkdirSync(folder, { mode: 0o700 });
  return isRealDirectory(folder) ? folder : null;
}

/** Remove files older than a week from every session folder. Best effort. */
function prune(dir, now) {
  let sessions;
  try { sessions = fs.readdirSync(dir); } catch { return; }
  for (const session of sessions) {
    const folder = path.join(dir, session);
    if (!isRealDirectory(folder)) continue;
    try {
      for (const file of fs.readdirSync(folder)) {
        try {
          const target = path.join(folder, file);
          const stat = fs.lstatSync(target);
          if (stat.isFile() && now - stat.mtimeMs > KEEP_MS) fs.unlinkSync(target);
        } catch {}
      }
      if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder);
    } catch {}
  }
}

function createAttachments({ dir, now = Date.now }) {
  function save(sessionId, name, buffer) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { ok: false, error: 'Not a session id' };
    if (!isBaseName(name)) return { ok: false, error: 'Not a file name' };
    const ext = path.extname(name);
    if (bytes(ext) > MAX_EXTENSION_BYTES) return { ok: false, error: 'Not a file name' };
    if (!buffer || buffer.length === 0) return { ok: false, error: 'The file is empty' };
    try {
      return store(sessionId, name, ext, buffer);
    } catch (err) {
      console.error('Could not save a session attachment:', err);
      return { ok: false, error: 'Could not save the file' };
    }
  }

  function store(sessionId, name, ext, buffer) {
    const folder = sessionFolder(dir, sessionId);
    if (!folder) return { ok: false, error: 'The attachments folder is not usable' };

    const stem = name.slice(0, name.length - ext.length);
    const prefix = stamp(now());
    const room = MAX_STORED_NAME_BYTES - bytes(ext) - prefix.length - 1;
    const base = `${prefix}-${fitBytes(stem, room)}`;
    for (let n = 1; ; n++) {
      const file = path.join(folder, `${base}${n === 1 ? '' : `-${n}`}${ext}`);
      let fd;
      try {
        fd = fs.openSync(file, 'wx', 0o600);
      } catch (err) {
        if (err.code === 'EEXIST') continue;
        throw err;
      }
      try {
        fs.writeFileSync(fd, buffer);
      } catch (err) {
        try { fs.unlinkSync(file); } catch {}
        throw err;
      } finally {
        fs.closeSync(fd);
      }
      prune(dir, now());
      return { ok: true, path: file, bytes: buffer.length };
    }
  }

  return { save };
}

module.exports = { createAttachments };
