// OpenCode's built-in commands for the command catalog (OpenCode 2, the
// version harnesses/opencode.js runs).
//
// OpenCode's docs name only a few slash commands; the TUI declares each one
// as a command of its keymap with a `slash` name ({ name: "session.new",
// title: "New session", slash: { name: "new" } }). Those declarations are
// read from the TUI's source in anomalyco/opencode at the release's tag, in
// the files that hold them (found for v2.4.1; sanity() notices when a
// release moves them). The docs give the rest:
//
//   cli/keybinds.md   the keys of every keymap command (a slash command's key,
//                     and the Shortcuts tab)
//   cli/commands.md   the `opencode` subcommands

const { tables, inlineText, codeSpans, firstSentences, slug } = require('./markdown');

const CLI = 'opencode';
const DOCS = 'https://opencode.ai/docs';
const SOURCE = 'https://raw.githubusercontent.com/anomalyco/opencode/{tag}/packages/tui/src';

// The TUI files that declare slash commands.
const TUI_FILES = {
  'tui-app': 'app.tsx',
  'tui-prompt': 'component/prompt/index.tsx',
  'tui-session-frame': 'component/session-frame.tsx',
  'tui-btw': 'feature-plugins/prompt/btw.tsx',
  'tui-diff-viewer': 'feature-plugins/system/diff-viewer.tsx',
  'tui-plugins': 'feature-plugins/system/plugins.tsx',
  'tui-stats': 'feature-plugins/system/stats.tsx',
  'tui-session': 'routes/session/index.tsx',
};

const SOURCES = [
  ...Object.entries(TUI_FILES).map(([id, file]) => ({ id, url: `${SOURCE}/${file}` })),
  { id: 'keybinds', url: `${DOCS}/cli/keybinds.md` },
  { id: 'cli-commands', url: `${DOCS}/cli/commands.md` },
];

/** The git tag of an OpenCode release. */
const tagFor = (version) => `v${version}`;
/** The latest OpenCode 2 release, for the build script (no OpenCode needed). */
const VERSION_COMMAND = ['npm', 'view', '@opencode/cli', 'version'];

const COMMAND_FLAGS = {
  endsSession: ['exit'],
  replacesConversation: ['new', 'clear', 'sessions', 'fork', 'undo', 'open'],
  account: ['connect'],
  opensMenu: ['sessions', 'open', 'models', 'agents', 'mcps', 'variants', 'speed', 'connect', 'settings', 'status',
    'themes', 'help', 'skills', 'worktrees', 'timeline', 'plugins', 'stats', 'diff', 'usage'],
};

function flaggedNames() {
  return [...new Set(Object.values(COMMAND_FLAGS).flat())];
}

/** From `{` at `open`, the index of its matching `}` (strings and template literals skipped), or -1. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The `{` that opens the object around `at`, or -1. Strings are not skipped going backwards: braces in titles are rare. */
function opening(text, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

const str = (text, key) => {
  const m = new RegExp(`(?:^|[\\s,{])${key}:\\s*(["'\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`).exec(text);
  return m ? m[2].replace(/\\(.)/g, '$1') : undefined;
};

/** The slash commands declared in a TUI file: { id, title, description, category, name, aliases, args }. */
function parseDeclarations(source) {
  const text = String(source || '');
  const out = [];
  const re = /\bslash:\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('{', m.index);
    const close = closing(text, open);
    if (close < 0) continue;
    const slash = text.slice(open, close + 1);
    const name = str(slash, 'name');
    if (!name) continue;
    const aliases = (/aliases:\s*\[([^\]]*)\]/.exec(slash) || [, ''])[1].match(/["'][^"']+["']/g) || [];
    const ownerStart = opening(text, m.index);
    const ownerEnd = ownerStart < 0 ? -1 : closing(text, ownerStart);
    // The command's own fields: its object with the slash part and any nested body taken out.
    let owner = ownerStart < 0 || ownerEnd < 0 ? '' : text.slice(ownerStart + 1, ownerEnd);
    owner = owner.replace(slash, '');
    let flat = '';
    let depth = 0;
    for (const ch of owner) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      else if (!depth) flat += ch;
    }
    flat = flat || owner;
    out.push({
      id: str(flat, 'name'),
      title: str(flat, 'title') || str(owner, 'title'),
      description: str(flat, 'description') || str(owner, 'description'),
      category: str(flat, 'category') || str(owner, 'category'),
      name,
      aliases: aliases.map((a) => a.slice(1, -1)),
      args: /arguments:\s*true/.test(slash),
    });
  }
  return out;
}

/** Every keybind of the docs: command id → { keys, description, group }. */
function parseKeybinds(md) {
  const out = new Map();
  for (const table of tables(md)) {
    if (table.headers[0] !== 'ID' || table.headers[1] !== 'Default') continue;
    const group = table.headings[table.headings.length - 1];
    for (const [idCell, keysCell = '', descCell = ''] of table.rows) {
      const id = codeSpans(idCell)[0] || inlineText(idCell);
      const keys = codeSpans(keysCell)[0] || inlineText(keysCell);
      if (!id || out.has(id)) continue;
      out.set(id, { keys, description: inlineText(descCell), group });
    }
  }
  return out;
}

/** "ctrl+c,<leader>q" as people read it: "Ctrl+C, Leader+Q" (the leader is Ctrl+X unless changed). */
function showKeys(keys) {
  return String(keys || '').split(',').map((k) => k.trim()).filter(Boolean)
    .map((k) => k.replace(/<leader>\s*/g, 'leader+').split('+').filter(Boolean)
      .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+'))
    .join(', ');
}

const humanize = (id) => {
  const last = String(id || '').split('.').filter(Boolean).join(' ');
  return last ? last[0].toUpperCase() + last.slice(1) : '';
};

function parseSlashCommands(pages, keybinds) {
  const out = [];
  const seen = new Set();
  for (const id of Object.keys(TUI_FILES)) {
    for (const d of parseDeclarations(pages[id])) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      const keys = d.id && keybinds.get(d.id);
      const flags = Object.entries(COMMAND_FLAGS).filter(([, list]) => list.includes(d.name)).map(([flag]) => flag);
      const title = d.title || humanize(d.id) || d.name;
      out.push(compact({
        id: `${CLI}:slash:${slug(d.name)}`,
        cli: CLI,
        kind: 'slash',
        command: `/${d.name}`,
        name: d.name,
        aliases: d.aliases,
        inputArgs: d.args ? '[args]' : undefined,
        description: firstSentences(d.description ? `${title}: ${d.description}.` : `${title}.`, 2),
        outputBehavior: keys && keys.keys && keys.keys !== 'none' ? `Key: ${showKeys(keys.keys)}.` : undefined,
        group: d.category,
        flags,
        source: 'cli-source',
        docUrl: `${DOCS}/cli/tui#commands`,
      }));
    }
  }
  return out;
}

function parseShortcuts(keybinds) {
  const out = [];
  for (const [id, k] of keybinds) {
    if (!k.keys || k.keys === 'none' || id === 'leader') continue;
    out.push({
      id: `${CLI}:shortcut:${slug(id)}`,
      cli: CLI,
      kind: 'shortcut',
      command: showKeys(k.keys),
      name: id,
      description: firstSentences(k.description || humanize(id), 2),
      group: k.group,
      source: 'official-docs',
      docUrl: `${DOCS}/cli/keybinds`,
    });
  }
  return out;
}

/** `## name` sections of cli/commands.md: `opencode name`, its first sentence, its first example. */
function parseCliCommands(md) {
  const out = [];
  const lines = String(md || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const h = /^##\s+([a-z][\w-]*)\s*$/.exec(lines[i]);
    if (!h) continue;
    let text = '';
    let example;
    let fence = false;
    for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j]); j++) {
      if (/^\s*```/.test(lines[j])) { fence = !fence; continue; }
      if (fence) {
        const cmd = /^\$\s+(opencode\s.*)$/.exec(lines[j].trim());
        if (cmd && !example) example = cmd[1];
      } else if (!text && lines[j].trim() && !lines[j].startsWith('#')) {
        text = inlineText(lines[j]);
      }
    }
    out.push(compact({
      id: `${CLI}:cli:${slug(h[1])}`,
      cli: CLI,
      kind: 'cli',
      command: `${CLI} ${h[1]}`,
      name: `${CLI} ${h[1]}`,
      description: firstSentences(text || `${CLI} ${h[1]}`, 2),
      example,
      source: 'official-docs',
      docUrl: `${DOCS}/cli/commands#${slug(h[1])}`,
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

function parseDocs(pages) {
  const keybinds = parseKeybinds(pages.keybinds);
  return [
    ...parseSlashCommands(pages, keybinds),
    ...parseCliCommands(pages['cli-commands']),
    ...parseShortcuts(keybinds),
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
  // A release that moved a declaration to a file not listed in TUI_FILES loses it here.
  expect('slash', 25, ['new', 'sessions', 'models', 'agents', 'exit', 'undo', 'redo', 'compact', 'help']);
  expect('cli', 10, ['opencode run', 'opencode session', 'opencode mcp']);
  expect('shortcut', 30, []);
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
  TUI_FILES,
  tagFor,
  VERSION_COMMAND,
  COMMAND_FLAGS,
  flaggedNames,
  parseDocs,
  sanity,
  // For the tests.
  parseDeclarations,
  parseKeybinds,
  parseCliCommands,
  showKeys,
};
