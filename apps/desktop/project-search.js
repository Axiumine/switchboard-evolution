// project-search.js — search and replace across the files of a folder, the way
// VS Code's Search view does it: a query (match case, whole word, regular
// expression), files to include and to exclude, results by file and line,
// and replacing all of them, the ones of a file, or one match.
//
// Which files: in a Git checkout, the ones Git knows plus the untracked ones it
// does not ignore (git ls-files), so .gitignore is respected; elsewhere, every
// file but the folders a code editor leaves out (node_modules, .git, …).
// Binary files and files over 2 MB are not searched.
//
// The work runs in a worker thread (workers/search-files.js), so a big folder
// never freezes the window; `search` and `replace` are what main.js calls.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const textSearch = require('./public/text-search');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 200000;
const DEFAULT_MAX_RESULTS = 20000;
const BEFORE_CHARS = 60;
const AFTER_CHARS = 200;
const MAX_MATCHES_PER_LINE = 1000;
// Left out of a folder that is not a Git checkout, as VS Code's files.exclude and search.exclude do.
const SKIPPED_NAMES = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db', 'node_modules', 'bower_components']);

// --- Which files ---

function gitFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    return [...new Set(String(out).split('\0').filter(Boolean))];
  } catch {
    return null;
  }
}

function walkFiles(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      // Symbolic links to folders are not followed (a link to a parent would never end).
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(child);
    }
  }
  return out.sort();
}

/** The folder's files, relative with '/' separators, in a stable order. */
function listFiles(root) {
  const files = gitFiles(root) || walkFiles(root);
  // A node_modules committed to the repository is still left out, as VS Code does.
  return files.filter(rel => !rel.split('/').some(part => SKIPPED_NAMES.has(part))).slice(0, MAX_FILES).sort();
}

/** The file's text, or null for one that is not searched (too big, binary, gone). */
function readText(absolute) {
  let stat;
  try { stat = fs.statSync(absolute); } catch { return null; }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  let buffer;
  try { buffer = fs.readFileSync(absolute); } catch { return null; }
  if (buffer.subarray(0, 8000).includes(0)) return null;
  return { buffer, text: buffer.toString('utf8') };
}

function normalizeOptions(opts = {}) {
  return {
    query: String(opts.query || ''),
    isRegex: !!opts.isRegex,
    matchCase: !!opts.matchCase,
    wholeWord: !!opts.wholeWord,
    include: typeof opts.include === 'string' ? opts.include : '',
    exclude: typeof opts.exclude === 'string' ? opts.exclude : '',
    maxResults: Number.isInteger(opts.maxResults) && opts.maxResults > 0 ? Math.min(opts.maxResults, DEFAULT_MAX_RESULTS) : DEFAULT_MAX_RESULTS,
  };
}

/** The lines of a text without their line endings (\n or \r\n). */
function splitLines(text) {
  return text.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// --- Search ---

/**
 * { ok, files: [{ path, matches: [{ line, column, length, text, before, after }] }],
 * matchCount, fileCount, limitHit } for the query in `root`. Lines are 1-based,
 * columns 0-based UTF-16 offsets, as a JavaScript string counts them.
 */
function searchRoot(root, rawOptions, { deadline = Infinity } = {}) {
  const options = normalizeOptions(rawOptions);
  let regex;
  try { regex = textSearch.buildSearchRegExp(options); } catch (err) { return { ok: false, error: err.message }; }
  const include = textSearch.globListMatcher(options.include);
  const exclude = textSearch.globListMatcher(options.exclude);
  // A plain query is looked for in the whole text first: most files do not have it.
  const quick = options.isRegex ? null : new RegExp(regex.source, regex.flags.replace('g', ''));
  const files = [];
  let matchCount = 0;
  let limitHit = false;
  let timedOut = false;
  for (const rel of listFiles(root)) {
    if (include && !include(rel)) continue;
    if (exclude && exclude(rel)) continue;
    if (Date.now() > deadline) { timedOut = true; break; }
    const read = readText(path.join(root, rel));
    if (!read) continue;
    if (quick && !quick.test(read.text)) continue;
    const matches = [];
    const lines = splitLines(read.text);
    for (let i = 0; i < lines.length && !limitHit; i += 1) {
      const line = lines[i];
      for (const m of textSearch.matchesInLine(regex, line, MAX_MATCHES_PER_LINE)) {
        matches.push({
          line: i + 1, column: m.column, length: m.length, text: m.text,
          before: line.slice(Math.max(0, m.column - BEFORE_CHARS), m.column),
          after: line.slice(m.column + m.length, m.column + m.length + AFTER_CHARS),
        });
        matchCount += 1;
        if (matchCount >= options.maxResults) { limitHit = true; break; }
      }
    }
    if (matches.length) files.push({ path: rel, matches });
    if (limitHit) break;
  }
  return { ok: true, files, matchCount, fileCount: files.length, limitHit: limitHit || timedOut, timedOut };
}

// --- Replace ---

/** The file inside `root` for a relative path, refusing one outside it (also through a link). */
function fileInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) throw new Error('Not a file of this folder');
  const absolute = path.resolve(root, rel);
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(absolute);
  const relative = path.relative(realRoot, real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Not a file of this folder');
  return absolute;
}

/**
 * Replace in the listed files: the matches given for a file (each checked
 * against the file as it is now; one that changed is left alone), or every
 * match of the query in a file listed without matches. Returns { ok,
 * replaced, files, skipped: [{ path, reason }] }.
 */
function replaceInRoot(root, rawOptions) {
  const options = normalizeOptions(rawOptions);
  const replace = typeof rawOptions?.replace === 'string' ? rawOptions.replace : '';
  let regex;
  try { regex = textSearch.buildSearchRegExp(options); } catch (err) { return { ok: false, error: err.message }; }
  const sticky = new RegExp(regex.source, regex.flags.replace('g', '') + 'y');
  const targets = Array.isArray(rawOptions?.files) ? rawOptions.files : [];
  let replaced = 0;
  let changedFiles = 0;
  const skipped = [];
  for (const target of targets) {
    const rel = target?.path;
    let absolute;
    try { absolute = fileInside(root, rel); } catch (err) { skipped.push({ path: String(rel), reason: err.message }); continue; }
    const read = readText(absolute);
    if (!read) { skipped.push({ path: rel, reason: 'Not a text file, too big, or gone' }); continue; }
    if (!Buffer.from(read.text, 'utf8').equals(read.buffer)) { skipped.push({ path: rel, reason: 'Not UTF-8 text' }); continue; }
    // Lines with their endings, so the file keeps its own (\n or \r\n).
    const pieces = read.text.split(/(?<=\n)/);
    const edits = new Map(); // line index → [{ column, length, value }]
    const add = (index, column, length, value) => {
      if (!edits.has(index)) edits.set(index, []);
      edits.get(index).push({ column, length, value });
    };
    const content = (index) => {
      const piece = pieces[index] ?? '';
      return piece.replace(/\r?\n$/, '');
    };
    let stale = 0;
    if (Array.isArray(target.matches)) {
      for (const match of target.matches) {
        const index = Number(match?.line) - 1;
        const column = Number(match?.column);
        if (!Number.isInteger(index) || index < 0 || index >= pieces.length || !Number.isInteger(column)) { stale += 1; continue; }
        const line = content(index);
        sticky.lastIndex = column;
        const m = sticky.exec(line);
        if (!m || m[0] !== match.text || m[0].length === 0) { stale += 1; continue; }
        add(index, column, m[0].length, options.isRegex ? textSearch.expandReplacement(replace, m) : replace);
      }
    } else {
      for (let index = 0; index < pieces.length; index += 1) {
        const line = content(index);
        for (const m of textSearch.matchesInLine(regex, line, MAX_MATCHES_PER_LINE)) {
          add(index, m.column, m.length, textSearch.replacementFor(options, m.text, replace, { line, column: m.column }));
        }
      }
    }
    if (stale) skipped.push({ path: rel, reason: `${stale} match${stale === 1 ? '' : 'es'} changed since the search` });
    if (!edits.size) continue;
    let count = 0;
    for (const [index, list] of edits) {
      const piece = pieces[index];
      const ending = piece.slice(content(index).length);
      let line = content(index);
      // From the end, so earlier columns stay right; overlapping ones are dropped.
      list.sort((a, b) => b.column - a.column);
      let limit = Infinity;
      for (const edit of list) {
        if (edit.column + edit.length > limit) continue;
        line = line.slice(0, edit.column) + edit.value + line.slice(edit.column + edit.length);
        limit = edit.column;
        count += 1;
      }
      pieces[index] = line + ending;
    }
    const next = pieces.join('');
    if (next === read.text) continue;
    try {
      fs.writeFileSync(absolute, next, 'utf8');
    } catch (err) {
      skipped.push({ path: rel, reason: err.message });
      continue;
    }
    replaced += count;
    changedFiles += 1;
  }
  return { ok: true, replaced, files: changedFiles, skipped };
}

// --- In a worker ---

const running = new Map(); // caller key → { worker, resolve }
const SEARCH_TIMEOUT_MS = 60 * 1000;

function runInWorker(key, job) {
  // eslint-disable-next-line global-require
  const { Worker } = require('worker_threads');
  const previous = key ? running.get(key) : null;
  if (previous) {
    previous.resolve({ ok: false, cancelled: true, error: 'A newer search replaced this one' });
    previous.worker.terminate();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (key && running.get(key)?.worker === worker) running.delete(key);
      resolve(result);
    };
    const worker = new Worker(path.join(__dirname, 'workers', 'search-files.js'), { workerData: job });
    const timer = setTimeout(() => { finish({ ok: false, error: 'The search took too long' }); worker.terminate(); }, SEARCH_TIMEOUT_MS + 5000);
    if (key) running.set(key, { worker, resolve: finish });
    worker.once('message', (result) => { finish(result); worker.terminate(); });
    worker.once('error', (err) => finish({ ok: false, error: err.message }));
    worker.once('exit', () => finish({ ok: false, error: 'The search stopped' }));
  });
}

function checkedRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return null;
  try { return fs.statSync(root).isDirectory() ? root : null; } catch { return null; }
}

/** Search a folder; a new search by the same `caller` stops the one before it. */
function search(root, options, { caller = 'window' } = {}) {
  if (!checkedRoot(root)) return Promise.resolve({ ok: false, error: 'Folder not found' });
  return runInWorker(`${caller}\0${root}`, { type: 'search', root, options, deadline: Date.now() + SEARCH_TIMEOUT_MS });
}

function replace(root, options) {
  if (!checkedRoot(root)) return Promise.resolve({ ok: false, error: 'Folder not found' });
  return runInWorker(null, { type: 'replace', root, options });
}

module.exports = { listFiles, searchRoot, replaceInRoot, search, replace, MAX_FILE_BYTES };
