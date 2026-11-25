// Claude Code's built-in commands for the command catalog, read from its
// documentation in Markdown:
//
//   commands.md          the slash commands, bundled skills and workflows
//   cli-reference.md     the `claude` commands and flags
//   interactive-mode.md  the TUI's keyboard shortcuts
//
// parseDocs() turns the pages into catalog entries (see
// packages/shared/command-catalog.d.ts for their shape). Descriptions keep
// only their first sentences, with a link to the page: the catalog points to
// the documentation, it does not copy it.

const { findTable, tables, codeSpans, inlineText, sentences, firstSentences, slug } = require('./markdown');

const CLI = 'claude';
const DOCS = 'https://code.claude.com/docs/en';

const SOURCES = [
  { id: 'commands', url: `${DOCS}/commands.md` },
  { id: 'cli-reference', url: `${DOCS}/cli-reference.md` },
  { id: 'interactive-mode', url: `${DOCS}/interactive-mode.md` },
];

// What the docs do not say in a form a program can read. Names are slash
// commands without their "/", aliases included; a test checks that each one
// is in the docs, so a renamed command is noticed.
const COMMAND_FLAGS = {
  // The session in the terminal ends or leaves it.
  endsSession: ['exit', 'background', 'restart', 'stop'],
  // The conversation on screen is replaced by another one.
  replacesConversation: ['clear', 'resume', 'branch', 'teleport', 'rewind'],
  // Signs in or out.
  account: ['login', 'logout'],
  // Writes files in the project or the user's setup.
  writesFiles: ['init', 'terminal-setup', 'install-github-app', 'install-slack-app'],
  // Opens a picker or a dialog in the terminal: from the phone's chat it is
  // seen in the terminal tab.
  opensMenu: ['model', 'config', 'mcp', 'resume', 'rewind', 'permissions', 'agents', 'hooks', 'memory', 'theme',
    'plugin', 'skills', 'help', 'ide', 'keybindings', 'output-style', 'privacy-settings', 'statusline', 'tasks',
    'usage', 'status', 'export', 'diff', 'login'],
  // Runs at once while Claude is working, instead of after the turn.
  runsWhileBusy: ['status', 'tasks', 'usage', 'fast', 'bug'],
};

/** The commands named in COMMAND_FLAGS, for the test that checks them. */
function flaggedNames() {
  return [...new Set(Object.values(COMMAND_FLAGS).flat())];
}

function flagsFor(names) {
  const out = [];
  for (const [flag, list] of Object.entries(COMMAND_FLAGS)) {
    if (names.some((n) => list.includes(n))) out.push(flag);
  }
  return out;
}

const VERSION = /^Requires Claude Code v(\d+\.\d+\.\d+) or later\.?$/;

/** The version a whole entry needs: a sentence of its own, "Requires Claude Code vX or later". */
function requiresOf(text) {
  for (const s of sentences(text)) {
    const m = VERSION.exec(s);
    if (m) return m[1];
  }
  return undefined;
}

/** Strip balanced bracket groups ([…], (…)) to see what is left at the top level. */
function topLevel(args) {
  let out = '';
  let depth = 0;
  for (const ch of String(args || '')) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (!depth) out += ch;
  }
  return out;
}

/** A required argument is a <placeholder> or a "quoted" one outside any [optional] group. */
const needsArgs = (args) => /<[^>]+>|"[^"]*"/.test(topLevel(args));

/**
 * A signature split into the words that are typed as they are and the
 * arguments: "/design consent" is all words, "/add-dir <path>" is "/add-dir"
 * and "<path>", "claude -p \"query\"" is "claude -p" and "\"query\"".
 */
function splitSignature(signature) {
  const tokens = String(signature || '').trim().split(/\s+/).filter(Boolean);
  const words = [];
  let i = 0;
  for (; i < tokens.length; i++) {
    if (/^[<["'(]/.test(tokens[i]) || tokens[i].includes('|')) break;
    words.push(tokens[i]);
  }
  return { command: words.join(' '), args: tokens.slice(i).join(' ') };
}

/** Values listed in the prose: "(options: `a`, `b`)", "Options: `a`, `b`, or `c`", "Accepts `a`, `b`…". */
function valuesFromProse(md) {
  const text = String(md || '');
  const re = /(?:\(options:\s*|Options:\s*|Accepts\s+)((?:`[^`]+`(?:\s*,\s*(?:or\s+)?|\s+or\s+|\s+and\s+)?)+)/;
  const m = re.exec(text);
  if (!m) return undefined;
  const values = codeSpans(m[1]).filter((v) => /^[\w.:-]+$/.test(v));
  return values.length > 1 ? values : undefined;
}

/** Values written in the signature itself: "[on|off]", "[classic|fullscreen]". */
function valuesFromArgs(args) {
  const m = /^\[([\w-]+(?:\|[\w-]+)+)\]$/.exec(String(args || '').trim());
  return m ? m[1].split('|') : undefined;
}

const MARKER = /^\*\*\[(Skill|Workflow)\]\([^)]*\)\.?\*\*\.?\s*/;
const ALIASES = /(?:^|[.;]\s+)(?:Alias|Aliases|Also available as)\s*:?\s+((?:`\/[^`]+`(?:\s*,\s*|\s+or\s+|\s+and\s+)?)+)/;

function compact(entry) {
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete entry[key];
  }
  return entry;
}

/** The slash commands of commands.md ("All commands"), each with its aliases, flags and version. */
function parseCommands(md) {
  const table = findTable(md, ['Command', 'Purpose']);
  if (!table) return [];
  const docUrl = `${DOCS}/commands#all-commands`;
  const out = [];
  for (const [cell, purposeMd = ''] of table.rows) {
    let purpose = purposeMd;
    const marker = MARKER.exec(purpose);
    if (marker) purpose = purpose.slice(marker[0].length);
    const aliasMatch = ALIASES.exec(purpose);
    const aliases = aliasMatch ? codeSpans(aliasMatch[1]).map((a) => a.replace(/^\//, '')) : [];
    const text = inlineText(purpose);
    // A cell can hold several commands: `/design consent`, `/design revoke`.
    for (const signature of codeSpans(cell).filter((s) => s.startsWith('/'))) {
      const { command, args } = splitSignature(signature);
      if (!command) continue;
      const name = command.slice(1);
      const first = name.split(' ')[0];
      const flags = flagsFor([first, ...aliases]);
      if (marker) flags.push('runsTask');
      out.push(compact({
        id: `${CLI}:slash:${slug(name)}`,
        cli: CLI,
        kind: 'slash',
        command,
        name,
        aliases: name.includes(' ') ? [] : aliases,
        inputArgs: args,
        argsRequired: needsArgs(args) || undefined,
        acceptedValues: valuesFromProse(purpose) || valuesFromArgs(args),
        description: firstSentences(text, 2),
        bundled: marker ? marker[1].toLowerCase() : undefined,
        requires: requiresOf(text),
        flags,
        source: 'official-docs',
        docUrl,
      }));
    }
  }
  // An alias with a row of its own (`/review`, alias of `/code-review`) is
  // listed as that row only.
  const rows = new Set(out.map((e) => e.name));
  for (const e of out) {
    if (!e.aliases) continue;
    e.aliases = e.aliases.filter((a) => !rows.has(a));
    if (!e.aliases.length) delete e.aliases;
  }
  return out;
}

/** The `claude` commands and flags of cli-reference.md. */
function parseCliReference(md) {
  const out = [];
  const commands = findTable(md, ['Command', 'Description', 'Example']);
  for (const [cell, descMd = '', exampleMd = ''] of commands ? commands.rows : []) {
    const signature = codeSpans(cell)[0];
    if (!signature) continue;
    // `cat file | claude -p "query"` is a whole shell line, not a command and its arguments.
    const { command, args } = signature.startsWith(`${CLI} `) || signature === CLI
      ? splitSignature(signature)
      : { command: signature, args: '' };
    out.push(compact({
      id: `${CLI}:cli:${slug(signature)}`,
      cli: CLI,
      kind: 'cli',
      command: command || signature,
      name: signature,
      inputArgs: args,
      argsRequired: needsArgs(args) || undefined,
      description: firstSentences(inlineText(descMd), 2),
      example: codeSpans(exampleMd)[0],
      requires: requiresOf(inlineText(descMd)),
      source: 'official-docs',
      docUrl: `${DOCS}/cli-reference#cli-commands`,
    }));
  }
  // "CLI flags", then "System prompt flags", which repeats a few of them with
  // more detail: the first one met is kept.
  const flagTables = tables(md).filter((t) => t.headers[0] === 'Flag' && t.headers.length >= 3);
  const seen = new Set();
  for (const table of flagTables) {
    for (const [cell, descMd = '', exampleMd = ''] of table.rows) {
      const spans = codeSpans(cell).filter((s) => s.startsWith('-'));
      if (!spans.length) continue;
      const text = inlineText(descMd);
      if (/^Removed in v/.test(text)) continue;
      const [flag, ...rest] = spans[0].split(/\s+/);
      if (seen.has(flag)) continue;
      seen.add(flag);
      const args = rest.join(' ');
      out.push(compact({
        id: `${CLI}:flag:${slug(flag)}`,
        cli: CLI,
        kind: 'flag',
        command: flag,
        name: flag,
        aliases: spans.slice(1).map((s) => s.split(/\s+/)[0]),
        inputArgs: args,
        acceptedValues: valuesFromProse(descMd),
        description: firstSentences(text, 2),
        example: codeSpans(exampleMd)[0],
        requires: requiresOf(text),
        group: table.headings[table.headings.length - 1] === 'System prompt flags' ? 'System prompt flags' : undefined,
        source: 'official-docs',
        docUrl: `${DOCS}/cli-reference#${slug(table.headings[table.headings.length - 1] || 'cli-flags')}`,
      }));
    }
  }
  return out;
}

/** The keyboard shortcuts of interactive-mode.md ("Keyboard shortcuts"), by section. */
function parseShortcuts(md) {
  const out = [];
  const seen = new Set();
  for (const table of tables(md)) {
    if (!table.headings.includes('Keyboard shortcuts')) continue;
    const at = table.headers.indexOf('Shortcut');
    if (at < 0) continue;
    const descAt = table.headers.indexOf('Description') >= 0 ? table.headers.indexOf('Description') : table.headers.indexOf('Method');
    const notesAt = ['Context', 'Notes'].map((h) => table.headers.indexOf(h)).find((i) => i >= 0);
    const group = table.headings[table.headings.length - 1];
    for (const row of table.rows) {
      const keys = inlineText(row[at]);
      if (!keys) continue;
      let id = `${CLI}:shortcut:${slug(group)}:${slug(keys)}`;
      for (let n = 2; seen.has(id); n++) id = `${CLI}:shortcut:${slug(group)}:${slug(keys)}-${n}`;
      seen.add(id);
      out.push(compact({
        id,
        cli: CLI,
        kind: 'shortcut',
        command: keys,
        name: keys,
        description: firstSentences(inlineText(row[descAt]), 2),
        outputBehavior: notesAt === undefined ? undefined : firstSentences(inlineText(row[notesAt]), 2),
        group,
        source: 'official-docs',
        docUrl: `${DOCS}/interactive-mode#${slug(group)}`,
      }));
    }
  }
  return out;
}

/** Every entry of the docs, from `{ [source id]: markdown }`. */
function parseDocs(pages) {
  return [
    ...parseCommands(pages.commands),
    ...parseCliReference(pages['cli-reference']),
    ...parseShortcuts(pages['interactive-mode']),
  ];
}

/**
 * What is wrong with the entries read from the docs, as messages; empty when
 * they look like the docs as we know them. A page whose layout changed gives
 * far fewer entries, and its result is not used.
 */
function sanity(entries) {
  const problems = [];
  const of = (kind) => entries.filter((e) => e.kind === kind);
  const names = (kind) => new Set(of(kind).flatMap((e) => [e.name, ...(e.aliases || [])]));
  const expect = (kind, min, required) => {
    const list = of(kind);
    if (list.length < min) problems.push(`${kind}: ${list.length} entries, expected at least ${min}`);
    const have = names(kind);
    for (const name of required) if (!have.has(name)) problems.push(`${kind}: ${name} is missing`);
  };
  expect('slash', 80, ['clear', 'compact', 'help', 'model', 'exit']);
  expect('cli', 15, ['claude', 'claude -p "query"']);
  expect('flag', 40, ['--print', '--model', '--output-format', '--permission-mode']);
  expect('shortcut', 10, []);
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
  COMMAND_FLAGS,
  flaggedNames,
  parseDocs,
  parseCommands,
  parseCliReference,
  parseShortcuts,
  sanity,
  // For the tests.
  splitSignature,
  needsArgs,
  valuesFromProse,
  requiresOf,
};
