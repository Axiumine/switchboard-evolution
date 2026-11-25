// formatter.js — Format Document and Format Selection for the editor, in the
// main process (JSON is formatted in the editor itself, with jsonc-parser).
//
// 1. The project's own Prettier (node_modules/prettier in the file's project
//    folder), with its configuration, its .prettierignore and .editorconfig:
//    what the project's own `prettier --write` would do. It is the project's
//    code, run only for files inside a project's folders.
// 2. Otherwise the app's Prettier (prettier/standalone and the plugins of the
//    languages it formats, loaded the first time), which runs no project
//    code: it reads only configuration files that are data (.prettierrc as
//    JSON or YAML, the "prettier" key of package.json, .editorconfig) and,
//    without one, follows the file's own indentation and line breaks. A
//    configuration that is code (prettier.config.js …) is not run: the file
//    is left as it is and the message says to install the project's
//    dependencies.
// 3. A language Prettier does not know: { unsupported }, and the editor asks
//    the file's language server instead.

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

// The app's Prettier: the parser for each file and the plugins it needs.
const APP_PARSERS = [
  { exts: ['.js', '.mjs', '.cjs', '.jsx'], parser: 'babel', plugins: ['babel', 'estree'] },
  { exts: ['.ts', '.mts', '.cts', '.tsx'], parser: 'typescript', plugins: ['typescript', 'estree'] },
  { exts: ['.json', '.jsonc', '.json5'], parser: 'json', plugins: ['babel', 'estree'] },
  { exts: ['.css'], parser: 'css', plugins: ['postcss'] },
  { exts: ['.scss'], parser: 'scss', plugins: ['postcss'] },
  { exts: ['.less'], parser: 'less', plugins: ['postcss'] },
  { exts: ['.md', '.markdown'], parser: 'markdown', plugins: ['markdown'] },
  { exts: ['.mdx'], parser: 'mdx', plugins: ['markdown'] },
  { exts: ['.yml', '.yaml'], parser: 'yaml', plugins: ['yaml'] },
  { exts: ['.html', '.htm'], parser: 'html', plugins: ['html', 'postcss', 'babel', 'estree'] },
  { exts: ['.vue'], parser: 'vue', plugins: ['html', 'postcss', 'babel', 'estree', 'typescript'] },
  { exts: ['.graphql', '.gql'], parser: 'graphql', plugins: ['graphql'] },
];

const CODE_CONFIGS = ['prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts', 'prettier.config.cts', 'prettier.config.mts',
  '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.ts', '.prettierrc.cts', '.prettierrc.mts'];
const DATA_CONFIGS = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml'];

function appParserFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return APP_PARSERS.find(p => p.exts.includes(ext)) || null;
}

function within(folder, file) {
  const rel = path.relative(folder, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The folders from the file's own up to `top` (included), or up to five levels without one. */
function foldersUp(filePath, top) {
  const out = [];
  let dir = path.dirname(filePath);
  for (let i = 0; i < 64; i++) {
    out.push(dir);
    if ((top && dir === top) || (!top && out.length >= 5)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

// ── Globs: .prettierignore lines and overrides' files ───────────────

function globRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += `(?:${glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return re;
}

/** A gitignore-style matcher of `lines` (relative paths with /): (rel) → ignored. */
function ignoreMatcher(lines) {
  const rules = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const body = globRegex(line);
    const re = new RegExp(anchored ? `^${body}(?:/.*)?$` : `(?:^|/)${body}(?:/.*)?$`);
    rules.push({ negate, re, dirOnly });
  }
  return (rel) => {
    let ignored = false;
    for (const rule of rules) if (rule.re.test(rel)) ignored = !rule.negate;
    return ignored;
  };
}

/** A glob of an overrides entry against a path relative to the configuration's folder. */
function matchesFiles(files, rel) {
  const list = Array.isArray(files) ? files : [files];
  return list.some((glob) => {
    if (typeof glob !== 'string') return false;
    const re = new RegExp(glob.includes('/') ? `^${globRegex(glob)}$` : `(?:^|/)${globRegex(glob)}$`);
    return re.test(rel);
  });
}

// ── Configuration as data ──────────────────────────────────────────

/** .editorconfig's settings for a file, as Prettier options (those it reads). */
function editorconfigOptions(filePath, top, { readFile = f => fs.readFileSync(f, 'utf8') } = {}) {
  const found = [];
  for (const dir of foldersUp(filePath, top)) {
    let text;
    try { text = readFile(path.join(dir, '.editorconfig')); } catch { continue; }
    found.unshift({ dir, text });
    if (/^\s*root\s*=\s*true\s*$/mi.test(text)) break;
  }
  const props = {};
  for (const { dir, text } of found) {
    const rel = path.relative(dir, filePath).split(path.sep).join('/');
    let applies = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/[#;].*$/, '').trim();
      if (!line) continue;
      const section = /^\[(.+)\]$/.exec(line);
      if (section) { applies = matchesFiles(section[1].startsWith('/') ? section[1].slice(1) : section[1], rel); continue; }
      const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
      if (kv && applies) props[kv[1].toLowerCase()] = kv[2].toLowerCase();
    }
  }
  const options = {};
  if (props.indent_style === 'tab') options.useTabs = true;
  if (props.indent_style === 'space') options.useTabs = false;
  const width = Number(props.indent_size === 'tab' ? props.tab_width : props.indent_size || props.tab_width);
  if (Number.isInteger(width) && width > 0) options.tabWidth = width;
  const max = Number(props.max_line_length);
  if (Number.isInteger(max) && max > 0) options.printWidth = max;
  if (['lf', 'crlf', 'cr'].includes(props.end_of_line)) options.endOfLine = props.end_of_line;
  return options;
}

/**
 * The project's Prettier configuration when it is data:
 * { options, file } (null when there is none) or { code: file } when it is code.
 */
function dataConfig(filePath, top, { readFile = f => fs.readFileSync(f, 'utf8'), exists = fs.existsSync, parseYaml = text => require('js-yaml').load(text) } = {}) {
  for (const dir of foldersUp(filePath, top)) {
    for (const name of CODE_CONFIGS) if (exists(path.join(dir, name))) return { code: path.join(dir, name) };
    for (const name of DATA_CONFIGS) {
      const file = path.join(dir, name);
      if (!exists(file)) continue;
      const text = readFile(file);
      let options;
      try { options = name.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch (err) { throw new Error(`${file}: ${err.message}`); }
      return { options: options && typeof options === 'object' ? options : {}, file, dir };
    }
    const pkg = path.join(dir, 'package.json');
    if (exists(pkg)) {
      let json = null;
      try { json = JSON.parse(readFile(pkg)); } catch {}
      if (json && json.prettier !== undefined) {
        if (typeof json.prettier === 'string') return { code: `${pkg} ("prettier": "${json.prettier}")` };
        return { options: json.prettier || {}, file: pkg, dir };
      }
    }
  }
  return null;
}

/** A configuration's options for a file: its own, with the overrides that match the file. */
function resolveOptions(config, filePath) {
  const { overrides, ...base } = config.options;
  const rel = path.relative(config.dir, filePath).split(path.sep).join('/');
  const out = { ...base };
  for (const o of Array.isArray(overrides) ? overrides : []) {
    if (o && matchesFiles(o.files, rel) && !(o.excludeFiles && matchesFiles(o.excludeFiles, rel))) Object.assign(out, o.options || {});
  }
  delete out.plugins;
  delete out.$schema;
  return out;
}

// ── The formatter ───────────────────────────────────────────────────

function createFormatter({ folderOf, log = console, appPrettier = null } = {}) {
  const projectPrettiers = new Map(); // resolved path → module
  let app = null;

  /** The project's Prettier for a file in `folder`, or null. */
  async function projectPrettier(filePath, folder) {
    let resolved;
    try {
      resolved = createRequire(path.join(path.dirname(filePath), 'noop.js')).resolve('prettier');
    } catch {
      return null;
    }
    if (!within(folder, resolved)) return null;
    if (!projectPrettiers.has(resolved)) {
      const mod = await import(pathToFileURL(resolved).href);
      projectPrettiers.set(resolved, mod.default && mod.default.format ? mod.default : mod);
    }
    return projectPrettiers.get(resolved);
  }

  function appModules(names) {
    if (!app) app = appPrettier || { standalone: require('prettier/standalone'), plugins: {} };
    const plugins = names.map((name) => {
      if (!app.plugins[name]) app.plugins[name] = require(`prettier/plugins/${name}`);
      return app.plugins[name];
    });
    return { format: app.standalone.format, plugins };
  }

  /**
   * Format `text` of `filePath` ({ from, to } for a selection). `indentation`
   * ({ insertSpaces, size }) and `eol` are the editor's, used when nothing
   * configures them. Returns { formatted, by: 'project' | 'app' },
   * { ignored }, { unsupported } or { error }.
   */
  async function format({ filePath, text, range = null, indentation = { insertSpaces: true, size: 2 }, eol = '\n' }) {
    const place = folderOf(filePath);
    const folder = place ? place.folder : null;
    const rangeOptions = range ? { rangeStart: range.from, rangeEnd: range.to } : {};

    if (folder) {
      const prettier = await projectPrettier(filePath, folder);
      if (prettier) {
        const ignorePath = path.join(folder, '.prettierignore');
        const info = await prettier.getFileInfo(filePath, { ignorePath: fs.existsSync(ignorePath) ? ignorePath : undefined });
        if (info.ignored) return { ignored: true, message: 'Ignored by .prettierignore' };
        if (!info.inferredParser) return { unsupported: true };
        const options = (await prettier.resolveConfig(filePath, { editorconfig: true })) || {};
        const formatted = await prettier.format(text, { ...options, filepath: filePath, ...rangeOptions });
        return { formatted, by: 'project' };
      }
    }

    const parser = appParserFor(filePath);
    if (!parser) return { unsupported: true };
    const top = folder || null;
    const config = dataConfig(filePath, top);
    if (config && config.code) {
      return { error: 'code-config', message: `The project's Prettier configuration is code (${path.basename(config.code)}): install the project's dependencies to use its own Prettier` };
    }
    const ignoreDir = top || path.dirname(filePath);
    try {
      const lines = fs.readFileSync(path.join(ignoreDir, '.prettierignore'), 'utf8').split(/\r?\n/);
      const rel = path.relative(ignoreDir, filePath).split(path.sep).join('/');
      if (ignoreMatcher(lines)(rel)) return { ignored: true, message: 'Ignored by .prettierignore' };
    } catch {}
    const fromEditorconfig = editorconfigOptions(filePath, top);
    const fromEditor = config || Object.keys(fromEditorconfig).length ? {} : {
      useTabs: !indentation.insertSpaces,
      tabWidth: indentation.size,
      endOfLine: eol === '\r\n' ? 'crlf' : 'lf',
    };
    const options = { ...fromEditor, ...fromEditorconfig, ...(config ? resolveOptions(config, filePath) : {}) };
    const { format: run, plugins } = appModules(parser.plugins);
    const formatted = await run(text, { ...options, parser: parser.parser, plugins, ...rangeOptions });
    return { formatted, by: 'app' };
  }

  return {
    async format(request) {
      try {
        return await format(request);
      } catch (err) {
        log.warn?.(`[format] ${request.filePath}: ${err.message}`);
        return { error: 'failed', message: String(err.message || err).split('\n')[0] };
      }
    },
  };
}

module.exports = { createFormatter, appParserFor, ignoreMatcher, editorconfigOptions, dataConfig, resolveOptions, matchesFiles };
