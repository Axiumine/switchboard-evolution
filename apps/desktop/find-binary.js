// Finding a command-line program the app runs itself (cloudflared, ngrok, gh).
// An app opened from the Finder gets a short PATH without Homebrew's folders,
// so those are searched too, after PATH.

const fs = require('fs');
const path = require('path');

const HOMEBREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin'];

/** Where a program is: PATH first, then Homebrew's folders (an app opened from the Finder has a short PATH). */
function findBinary(name, { pathEnv = process.env.PATH || '', exists = fs.existsSync } = {}) {
  for (const dir of [...pathEnv.split(path.delimiter).filter(Boolean), ...HOMEBREW_BINS]) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** PATH with Homebrew's folders added at the end when they are missing. */
function pathWithHomebrew(pathEnv = process.env.PATH || '') {
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of HOMEBREW_BINS) if (!dirs.includes(dir)) dirs.push(dir);
  return dirs.join(path.delimiter);
}

module.exports = { findBinary, pathWithHomebrew, HOMEBREW_BINS };
