// Codex's built-in commands for the command catalog.
//
//   slash-commands      codex-rs/tui/src/slash_command.rs in openai/codex, at
//                       the release's tag: the slash commands of that very
//                       version, in the popup's order, with their aliases,
//                       descriptions, and which take arguments or run while
//                       Codex works
//   developer-commands  the documentation page (learn.chatgpt.com), for the
//                       longer description of a slash command and the TUI's
//                       shortcuts
//   completion          `codex completion fish`: the `codex` subcommands and
//                       flags with their values. The docs page draws them
//                       from data the Markdown does not carry. Run at build
//                       time only (scripts/build-command-catalog.mjs); the
//                       refresh while the app runs keeps the ones it has.

const { findTable, codeSpans, inlineText, firstSentences, slug } = require('./markdown');

const CLI = 'codex';
const DOCS_PAGE = 'https://learn.chatgpt.com/docs/developer-commands';

const SOURCES = [
  { id: 'slash-commands', url: 'https://raw.githubusercontent.com/openai/codex/{tag}/codex-rs/tui/src/slash_command.rs' },
  { id: 'developer-commands', url: `${DOCS_PAGE}.md?surface=cli` },
  { id: 'completion', run: ['codex', 'completion', 'fish'], buildOnly: true },
];

/** The git tag of a Codex release. */
const tagFor = (version) => `rust-v${version}`;
/** How the build script learns the version of the codex it runs ("codex-cli 0.167.0"). */
const VERSION_COMMAND = ['codex', '--version'];

const COMMAND_FLAGS = {
  endsSession: ['exit', 'quit', 'logout'],
  replacesConversation: ['new', 'clear', 'resume', 'fork', 'delete', 'archive'],
  account: ['logout'],
  writesFiles: ['init'],
  opensMenu: ['model', 'permissions', 'resume', 'config', 'theme', 'statusline', 'title', 'skills', 'mcp', 'apps',
    'plugins', 'agents', 'experimental', 'memories', 'keymap', 'pets', 'presets', 'hooks', 'status', 'usage'],
};

function flaggedNames() {
  return [...new Set(Object.values(COMMAND_FLAGS).flat())];
}

// --- slash_command.rs ---

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();

/** The body of a Rust item from its opening brace, braces balanced (strings skipped). */
function block(source, from) {
  const open = source.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { for (i++; i < source.length && source[i] !== '"'; i++) if (source[i] === '\\') i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

function fnBody(source, name) {
  const at = source.search(new RegExp(`fn\\s+${name}\\s*\\(`));
  return at < 0 ? '' : block(source, at);
}

const variantsIn = (text) => [...String(text).matchAll(/SlashCommand::(\w+)/g)].map((m) => m[1]);

/**
 * The variants of `enum SlashCommand`, in order, each with the name typed
 * (strum: `to_string`, else the first `serialize`, else kebab-case) and its
 * aliases (the other `serialize` values).
 */
function parseEnum(source) {
  const at = source.search(/pub\s+enum\s+SlashCommand\b/);
  if (at < 0) return [];
  const body = block(source, at).replace(/\/\/[^\n]*/g, '');
  const out = [];
  let attrs = [];
  const re = /#\[strum\(([^)]*)\)\]|\b([A-Z]\w*)\s*,/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) { attrs.push(m[1]); continue; }
    const variant = m[2];
    const text = attrs.join(',');
    const toString = /to_string\s*=\s*"([^"]+)"/.exec(text);
    const serialize = [...text.matchAll(/serialize\s*=\s*"([^"]+)"/g)].map((s) => s[1]);
    const name = toString ? toString[1] : serialize[0] || kebab(variant);
    out.push({ variant, name, aliases: serialize.filter((s) => s !== name) });
    attrs = [];
  }
  return out;
}

/** `match self { A | B => "text", C => { "text" } }` as variant → text. */
function parseDescriptions(source) {
  const body = fnBody(source, 'description');
  const out = {};
  const re = /((?:SlashCommand::\w+\s*\|\s*)*SlashCommand::\w+)\s*=>\s*\{?\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(body))) for (const v of variantsIn(m[1])) out[v] = m[2].replace(/\\"/g, '"');
  return out;
}

/** The variants a `matches!(self, …)` function lists. */
function matchesSet(source, name) {
  return new Set(variantsIn(fnBody(source, name)));
}

/** The arms of a `match self { … => true/false }` function, as variant → boolean. */
function boolArms(source, name) {
  const body = fnBody(source, name);
  const out = {};
  const re = /((?:SlashCommand::\w+\s*\|\s*)*SlashCommand::\w+)\s*=>\s*(true|false)/g;
  let m;
  while ((m = re.exec(body))) for (const v of variantsIn(m[1])) out[v] = m[2] === 'true';
  return out;
}

/** The variants `is_visible` shows only in debug builds. */
function debugOnly(source) {
  const body = fnBody(source, 'is_visible');
  const out = new Set();
  const re = /((?:SlashCommand::\w+\s*\|\s*)*SlashCommand::\w+)\s*=>\s*cfg!\(debug_assertions\)/g;
  let m;
  while ((m = re.exec(body))) for (const v of variantsIn(m[1])) out.add(v);
  return out;
}

const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** The docs' table of slash commands: name → { purpose, when }. */
function docsCommands(md) {
  const table = findTable(md, ['Command', 'Purpose', 'When to use it']);
  const out = {};
  for (const [cell, purpose = '', when = ''] of table ? table.rows : []) {
    for (const span of codeSpans(cell)) {
      if (!span.startsWith('/')) continue;
      out[span.slice(1).split(/\s+/)[0]] = { purpose: inlineText(purpose), when: inlineText(when) };
    }
  }
  return out;
}

function parseSlashCommands(source, docsMd = '') {
  const variants = parseEnum(source);
  const descriptions = parseDescriptions(source);
  const inline = matchesSet(source, 'supports_inline_args');
  const duringTask = boolArms(source, 'available_during_task');
  const hidden = debugOnly(source);
  const docs = docsCommands(docsMd);
  const out = [];
  for (const { variant, name, aliases } of variants) {
    const short = descriptions[variant];
    if (!short || /^DO NOT USE$/i.test(short) || hidden.has(variant)) continue;
    const doc = docs[name] || aliases.map((a) => docs[a]).find(Boolean);
    const flags = Object.entries(COMMAND_FLAGS).filter(([, list]) => list.includes(name)).map(([flag]) => flag);
    if (duringTask[variant]) flags.push('runsWhileBusy');
    out.push(compact({
      id: `${CLI}:slash:${slug(name)}`,
      cli: CLI,
      kind: 'slash',
      command: `/${name}`,
      name,
      aliases,
      inputArgs: inline.has(variant) ? '[args]' : undefined,
      description: firstSentences(doc && doc.purpose ? doc.purpose : `${capital(short)}.`, 2),
      outputBehavior: doc && doc.when ? firstSentences(doc.when, 2) : undefined,
      flags,
      source: 'cli-source',
      docUrl: `${DOCS_PAGE}#built-in-slash-commands`,
    }));
  }
  return out;
}

// --- The docs page: shortcuts ---

/** The bullets of "Interactive shortcuts": the keys (or the character typed) and what they do. */
function parseShortcuts(md) {
  const lines = String(md || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Interactive shortcuts\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) {
    const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    const kbd = /((?:<kbd>[^<]*<\/kbd>\s*\+?\s*)+)/.exec(m[1]);
    let keys = kbd ? inlineText(kbd[1].replace(/&nbsp;/g, ' ')).replace(/\s*\+\s*/g, '+') : '';
    if (!keys) keys = (codeSpans(m[1])[0] || '').trim();
    if (!keys) continue;
    const text = inlineText(m[1].replace(/&nbsp;/g, ' ')).replace(/\+\s+/g, '+');
    let id = `${CLI}:shortcut:${slug(keys)}`;
    for (let n = 2; out.some((e) => e.id === id); n++) id = `${CLI}:shortcut:${slug(keys)}-${n}`;
    out.push({ id, cli: CLI, kind: 'shortcut', command: keys, name: keys, description: firstSentences(text, 2), group: 'Interactive shortcuts', source: 'official-docs', docUrl: `${DOCS_PAGE}#interactive-shortcuts` });
  }
  return out;
}

// --- `codex completion fish` ---

/** The `complete …` commands of a fish script, each as its words (quotes and escapes read the fish way). */
function fishCommands(script) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  const text = String(script || '');
  const end = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === '\\' && (text[i + 1] === "'" || text[i + 1] === '\\')) { word += text[++i]; continue; }
      if (ch === "'") { quote = null; continue; }
      word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && '"\\$\n'.includes(text[i + 1])) { word += text[++i]; continue; }
      if (ch === '"') { quote = null; continue; }
      word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; inWord = true; continue; }
    if (ch === '#' && !inWord) { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
    if (ch === '\n') { end(); if (words.length) commands.push(words); words = []; continue; }
    if (ch === ' ' || ch === '\t') { end(); continue; }
    if (ch === '\\' && text[i + 1] === '\n') { i++; continue; }
    word += ch;
    inWord = true;
  }
  end();
  if (words.length) commands.push(words);
  return commands.filter((w) => w[0] === 'complete');
}

/** One `complete` command's options: condition, short, long, description, arguments. */
function completeSpec(words) {
  const spec = {};
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const next = () => words[++i];
    if (w === '-c') next();
    else if (w === '-n') spec.condition = next();
    else if (w === '-s') spec.short = next();
    else if (w === '-l') spec.long = next();
    else if (w === '-o') spec.old = next();
    else if (w === '-d') spec.description = next();
    else if (w === '-a') spec.args = next();
    else if (w === '-r') spec.requiresValue = true;
  }
  return spec;
}

/** The subcommand path a condition applies to: [] at the top, ['mcp'], ['mcp', 'add']. */
function conditionPath(condition) {
  const c = String(condition || '');
  if (/^__fish_codex_needs_command\b/.test(c)) return [];
  const m = /__fish_codex_using_subcommand\s+([\w-]+)/.exec(c);
  if (!m) return null;
  const path = [m[1]];
  // "; and __fish_seen_subcommand_from add" (not "; and not …", which only rules the others out).
  const seen = /;\s*and\s+__fish_seen_subcommand_from\s+([\w-]+)/.exec(c);
  if (seen) path.push(seen[1]);
  return path;
}

/** Values a flag takes, from its `-a` list ("read-only\t''\nworkspace-write\t''"); not a function call. */
function flagValues(args) {
  if (!args || /^\(/.test(args.trim())) return undefined;
  // In fish's double quotes `\t` stays a backslash and a t.
  const values = args.split('\n').map((l) => l.split(/\\t|\t/)[0].trim()).filter((v) => /^[\w.:-]+$/.test(v));
  return values.length ? values : undefined;
}

const INTERNAL = /^(internal:|\[experimental\]|\[EXPERIMENTAL\])/i;

/**
 * The `codex` subcommands (first and second level) and flags (global, and a
 * first-level subcommand's own: not the global ones it repeats) of a fish
 * completion script. Internal and experimental subcommands are left out.
 */
function parseCompletion(script) {
  const specs = fishCommands(script).map(completeSpec).map((s) => ({ ...s, path: conditionPath(s.condition) })).filter((s) => s.path);
  const out = [];
  const byDesc = new Map();
  const hiddenSubs = new Set();
  const aliasSubs = new Set();
  // Subcommands, top level first; one with the description of the one before is its alias (e for exec).
  for (const s of specs) {
    if (s.long || s.short || !s.args || s.path.length > 1) continue;
    // Only top-level subcommands always carry a description; `mcp list` may not.
    if (!s.description && !s.path.length) continue;
    const name = s.args.trim();
    if (!/^[\w-]+$/.test(name) || name === 'help') continue;
    const full = [...s.path, name];
    if (INTERNAL.test(s.description || '')) { hiddenSubs.add(full.join(' ')); continue; }
    // `codex help exec` and `codex e resume` repeat what is listed already.
    if (s.path.length === 1 && (hiddenSubs.has(s.path[0]) || aliasSubs.has(s.path[0]) || s.path[0] === 'help')) continue;
    const key = `${s.path.join(' ')}\n${s.description}`;
    const first = s.description ? byDesc.get(key) : null;
    if (first && name.length < first.name.split(' ').pop().length) {
      first.aliases = [...(first.aliases || []), name];
      if (!s.path.length) aliasSubs.add(name);
      continue;
    }
    const command = `${CLI} ${full.join(' ')}`;
    const description = s.description ? firstSentences(s.description, 2) : `The ${name} command of ${CLI} ${s.path.join(' ')}.`;
    const entry = { id: `${CLI}:cli:${slug(full.join(' '))}`, cli: CLI, kind: 'cli', command, name: command, description, source: 'cli-completion', docUrl: `${DOCS_PAGE}#command-details` };
    byDesc.set(key, entry);
    out.push(entry);
  }
  // Flags: the global ones, then those a first-level subcommand adds.
  const global = new Map();
  for (const s of specs) {
    if (!s.long || s.path.length > 1 || s.long === 'help' || s.long === 'version') continue;
    const scope = s.path.join(' ');
    if (scope && (hiddenSubs.has(scope) || aliasSubs.has(scope) || scope === 'help')) continue;
    const flag = `--${s.long}`;
    if (scope && global.get(flag) === s.description) continue;
    if (!scope) global.set(flag, s.description);
    out.push(compact({
      id: `${CLI}:flag:${scope ? `${slug(scope)}:` : ''}${slug(s.long)}`,
      cli: CLI,
      kind: 'flag',
      command: flag,
      name: flag,
      aliases: s.short ? [`-${s.short}`] : undefined,
      inputArgs: s.requiresValue ? '<value>' : undefined,
      acceptedValues: flagValues(s.args),
      description: firstSentences(s.description || flag, 2),
      group: scope ? `${CLI} ${scope}` : undefined,
      source: 'cli-completion',
      docUrl: `${DOCS_PAGE}#global-flags`,
    }));
  }
  return out;
}

function compact(entry) {
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete entry[key];
  }
  return entry;
}

/**
 * Every entry from `{ [source id]: text }`. Without the completion script
 * (the refresh while the app runs), the entries it gave `previous` are kept.
 */
function parseDocs(pages, { previous } = {}) {
  const completion = typeof pages.completion === 'string'
    ? parseCompletion(pages.completion)
    : ((previous && previous.entries) || []).filter((e) => e.source === 'cli-completion');
  return [
    ...parseSlashCommands(pages['slash-commands'], pages['developer-commands']),
    ...completion,
    ...parseShortcuts(pages['developer-commands']),
  ];
}

function sanity(entries) {
  const problems = [];
  const of = (kind) => entries.filter((e) => e.kind === kind);
  const expect = (kind, min, required) => {
    const list = of(kind);
    if (list.length < min) problems.push(`${kind}: ${list.length} entries, expected at least ${min}`);
    const names = new Set(list.flatMap((e) => [e.name, ...(e.aliases || [])]));
    for (const name of required) if (!names.has(name)) problems.push(`${kind}: ${name} is missing`);
  };
  expect('slash', 30, ['model', 'compact', 'review', 'exit', 'new']);
  expect('cli', 10, ['codex exec', 'codex resume', 'codex mcp']);
  expect('flag', 10, ['--model', '--sandbox', '--cd']);
  expect('shortcut', 4, []);
  const ids = new Set();
  for (const e of entries) {
    if (ids.has(e.id)) problems.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    if (!e.description) problems.push(`${e.id}: no description`);
  }
  return problems;
}

module.exports = {
  id: CLI,
  SOURCES,
  tagFor,
  VERSION_COMMAND,
  COMMAND_FLAGS,
  flaggedNames,
  parseDocs,
  sanity,
  // For the tests.
  parseEnum,
  parseSlashCommands,
  parseShortcuts,
  parseCompletion,
  fishCommands,
  conditionPath,
};
