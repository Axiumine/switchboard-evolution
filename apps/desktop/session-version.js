// The version of the CLI in a session, for the command catalog: a command the
// docs say needs a newer version than the session's is marked so.
//
// Read from what the CLIs write, never by running them: the main process does
// not have the login shell's PATH, and a running session keeps the version it
// started with even after an update.
//
//   Claude Code  every line of a transcript carries "version":"2.1.x"; the
//                last one is the version that wrote it (a session resumed by
//                a newer CLI changes version halfway). The native installer
//                links ~/.local/bin/claude to …/versions/<version>.
//   Codex        a session file starts with session_meta, whose cli_version
//                is the version that started it; $CODEX_HOME/models_cache.json
//                has the client_version of the codex that ran last.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL_BYTES = 64 * 1024;
const VERSION = /"version":"(\d+\.\d+\.\d+)"/g;

/** The last `"version":"x.y.z"` in the last bytes of a file, or null. */
function lastVersionInFile(file, { tailBytes = TAIL_BYTES, fsImpl = fs } = {}) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const { size } = fsImpl.fstatSync(fd);
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    fsImpl.readSync(fd, buffer, 0, length, size - length);
    let last = null;
    for (const m of buffer.toString('utf8').matchAll(VERSION)) last = m[1];
    return last;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fsImpl.closeSync(fd); } catch {}
  }
}

/** The version the native installer's link points to (~/.local/bin/claude → …/versions/2.1.x), or null. */
function nativeClaudeVersion({ home = os.homedir(), fsImpl = fs } = {}) {
  try {
    const target = fsImpl.readlinkSync(path.join(home, '.local', 'bin', 'claude'));
    const m = /(?:^|[\\/])versions[\\/](\d+\.\d+\.\d+)$/.exec(target);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** The cli_version of a Codex session file's first line (session_meta), or null. */
function codexSessionVersion(file, { fsImpl = fs } = {}) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const buffer = Buffer.alloc(TAIL_BYTES);
    const read = fsImpl.readSync(fd, buffer, 0, TAIL_BYTES, 0);
    const first = buffer.toString('utf8', 0, read).split('\n')[0];
    const m = /"cli_version":"(\d+\.\d+\.\d+)"/.exec(first);
    return m ? m[1] : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fsImpl.closeSync(fd); } catch {}
  }
}

/** The client_version of $CODEX_HOME/models_cache.json: the codex that ran last. */
function codexInstalledVersion({ home = os.homedir(), env = process.env, fsImpl = fs } = {}) {
  const codexHome = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex');
  try {
    const v = JSON.parse(fsImpl.readFileSync(path.join(codexHome, 'models_cache.json'), 'utf8')).client_version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v.match(/^\d+\.\d+\.\d+/)[0] : null;
  } catch {
    return null;
  }
}

/**
 * `{ session?, installed?, source }` for a session of `cli`: `session` is the
 * version in its transcript, `installed` the one installed now, when they can
 * be read. `source` says where the version the catalog compares with came from.
 */
function versionsFor({ cli, transcript, home, env, fsImpl } = {}) {
  let session = null;
  let installed = null;
  if (cli === 'claude') {
    session = transcript ? lastVersionInFile(transcript, { fsImpl }) : null;
    installed = nativeClaudeVersion({ home, fsImpl });
  } else if (cli === 'codex') {
    session = transcript ? codexSessionVersion(transcript, { fsImpl }) : null;
    installed = codexInstalledVersion({ home, env, fsImpl });
  }
  const out = {};
  if (session) out.session = session;
  if (installed) out.installed = installed;
  out.source = session ? 'transcript' : installed ? 'install' : 'unknown';
  return out;
}

module.exports = { lastVersionInFile, nativeClaudeVersion, codexSessionVersion, codexInstalledVersion, versionsFor };
