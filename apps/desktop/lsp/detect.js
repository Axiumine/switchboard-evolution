// lsp/detect.js — which languages a folder has, to turn their servers on when
// the folder joins a project. In a git repository the tracked files
// (`git ls-files`, which leaves out what .gitignore ignores); elsewhere a
// bounded walk that skips dependency and build folders.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { serverForFile } = require('./servers');

const MAX_FILES = 20000;
const MAX_DEPTH = 8;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', '.venv', 'venv', '__pycache__',
  'Pods', '.next', '.nuxt', '.gradle', '.idea', '.vscode', 'bin', 'obj', '.dart_tool', '_build', 'deps', '.terraform',
]);

/** The files git tracks in `folder` (relative paths), or null when it is not a repository. */
function gitFiles(folder, { run = execFile } = {}) {
  return new Promise((resolve) => {
    run('git', ['-C', folder, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      timeout: 15000, maxBuffer: 128 * 1024 * 1024, windowsHide: true,
    }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).split('\0').filter(Boolean).slice(0, MAX_FILES * 5));
    });
  });
}

/** Up to MAX_FILES files under `folder`, MAX_DEPTH deep, without the folders in SKIP_DIRS. */
function walkFiles(folder) {
  const files = [];
  const visit = (dir, depth) => {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        files.push(path.relative(folder, path.join(dir, entry.name)));
      }
    }
  };
  visit(folder, 0);
  return files;
}

/** For a list of files: { [serverId]: { files, extensions: { '.ts': n, 'Dockerfile': n } } }. */
function countLanguages(files) {
  const found = {};
  for (const file of files) {
    if (file.split(/[\\/]/).some(part => SKIP_DIRS.has(part))) continue;
    const match = serverForFile(file);
    if (!match) continue;
    const key = path.extname(file).toLowerCase() || path.basename(file);
    const entry = found[match.server.id] || (found[match.server.id] = { files: 0, extensions: {} });
    entry.files++;
    entry.extensions[key] = (entry.extensions[key] || 0) + 1;
  }
  return found;
}

/** The languages of `folder`: countLanguages of its files. Never throws. */
async function detectLanguages(folder, options = {}) {
  try {
    if (!fs.statSync(folder).isDirectory()) return {};
  } catch {
    return {};
  }
  const files = (await gitFiles(folder, options)) || walkFiles(folder);
  return countLanguages(files);
}

/** Two detections as one: the counts added up. */
function mergeFound(a = {}, b = {}) {
  const out = JSON.parse(JSON.stringify(a));
  for (const [id, entry] of Object.entries(b)) {
    const into = out[id] || (out[id] = { files: 0, extensions: {} });
    into.files += entry.files;
    for (const [ext, n] of Object.entries(entry.extensions)) into.extensions[ext] = (into.extensions[ext] || 0) + n;
  }
  return out;
}

module.exports = { detectLanguages, countLanguages, mergeFound, walkFiles, gitFiles, SKIP_DIRS, MAX_FILES };
