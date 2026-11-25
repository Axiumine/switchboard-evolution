// lsp/locate.js — finding the language servers installed on this computer.
//
// An app opened from the Finder gets a short PATH: no nvm, pyenv, cargo, go or
// dotnet folders, and on macOS not even Homebrew's. So the PATH a login shell
// gives (read once, with a marker around it and a timeout) comes first, then
// the app's own PATH, Homebrew's folders and the folders the usual installers
// use. A command can ask to be run once with `verify` (rust-analyzer: rustup
// leaves a shim in ~/.cargo/bin even when the component is not installed).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { HOMEBREW_BINS } = require('../find-binary');
const { commandArgs } = require('./servers');

const LOGIN_PATH_TIMEOUT = 5000;
const VERIFY_TIMEOUT = 8000;
const MARK = '__SB_LOGIN_PATH__';

/** The folders installers put programs in, under `home`. */
function wellKnownDirs(home, platform = process.platform) {
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, 'go', 'bin'),
    path.join(home, '.dotnet', 'tools'),
    path.join(home, '.ghcup', 'bin'),
    path.join(home, '.local', 'share', 'coursier', 'bin'),
    path.join(home, 'Library', 'Application Support', 'Coursier', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.pub-cache', 'bin'),
    path.join(home, '.opam', 'default', 'bin'),
  ];
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(appData, 'npm'));
  } else {
    dirs.push(...HOMEBREW_BINS, '/usr/bin', '/usr/local/sbin');
  }
  return dirs;
}

/** The text between the markers of a login shell's output: its PATH. */
function parseLoginPath(output) {
  const start = output.indexOf(MARK);
  const end = output.indexOf(MARK, start + MARK.length);
  if (start < 0 || end < 0) return null;
  const value = output.slice(start + MARK.length, end).trim();
  return value || null;
}

/** The PATH of the user's login shell, or null (Windows, no shell, a shell that hangs). */
function readLoginPath({ shell = process.env.SHELL, run = execFile, platform = process.platform } = {}) {
  if (platform === 'win32') return Promise.resolve(null);
  const program = shell || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return new Promise((resolve) => {
    run(program, ['-l', '-i', '-c', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      timeout: LOGIN_PATH_TIMEOUT,
      env: { ...process.env, TERM: 'dumb' },
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => resolve(parseLoginPath(String(stdout || ''))));
  });
}

let loginPathPromise = null;

/** The login shell's PATH, read once for the app's life. */
function loginPath() {
  if (!loginPathPromise) loginPathPromise = readLoginPath();
  return loginPathPromise;
}

/** Every folder to search, in order, each once. */
function searchDirs({ login = null, envPath = process.env.PATH || '', home = os.homedir(), platform = process.platform } = {}) {
  const dirs = [
    ...(login ? login.split(path.delimiter) : []),
    ...envPath.split(path.delimiter),
    ...wellKnownDirs(home, platform),
  ].filter(Boolean);
  return [...new Set(dirs)];
}

/** The PATH a server is started with: the same folders, so it finds node, go, cargo… */
function serverPath(options) {
  return searchDirs(options).join(path.delimiter);
}

/** Where `name` is among `dirs` (with .exe, .cmd, .bat on Windows), or null. */
function findExecutable(name, dirs, { platform = process.platform, exists = isExecutable } = {}) {
  const names = platform === 'win32' && !path.extname(name) ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.join(dir, candidate);
      if (exists(full)) return full;
    }
  }
  return null;
}

function isExecutable(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Run `file args` and say whether it exits 0 within the time. */
function runsOk(file, args, { run = execFile, env } = {}) {
  return new Promise((resolve) => {
    run(file, args, { timeout: VERIFY_TIMEOUT, env, windowsHide: true }, err => resolve(!err));
  });
}

/**
 * The first command of `server` installed here: { bin, path, args } or null.
 * `context` gives the arguments of the servers that depend on the folder
 * ({ root, dataDir }).
 */
async function locateServer(server, context = {}, { dirs = null, exists, run, platform } = {}) {
  const where = dirs || searchDirs({ login: await loginPath() });
  for (const command of server.commands) {
    const file = findExecutable(command.bin, where, { platform, exists });
    if (!file) continue;
    if (command.verify && !(await runsOk(file, command.verify, { run, env: { ...process.env, PATH: where.join(path.delimiter) } }))) continue;
    return { bin: command.bin, path: file, args: commandArgs(command, context) };
  }
  return null;
}

module.exports = {
  wellKnownDirs, parseLoginPath, readLoginPath, loginPath, searchDirs, serverPath, findExecutable, locateServer, MARK,
};
