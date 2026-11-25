// command-catalog-model.js — the command catalog's rules, for the desktop's
// palette and the phone's sheet.
//
// The catalog lists what a CLI understands: its slash commands, its skills
// and custom commands, MCP servers, its own commands and flags, its keyboard
// shortcuts (entries built by the desktop, apps/desktop/command-catalog.js).
// Here: the tabs, the search, what a pick types into a session, and when
// "Run" (the text, then Enter) is allowed.
//
// A pick types the command and a space, never Enter: the CLI's prompt may
// already hold text or a question, which the app cannot see. Run is a gesture
// of its own, only for a command that needs no argument while the session is
// idle, and it asks first for a command that ends the session, replaces the
// conversation, signs in or out or writes files.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const TABS = [
    { id: 'commands', label: 'Commands', kinds: ['slash'] },
    { id: 'custom', label: 'Skills & custom', kinds: ['skill', 'custom'] },
    { id: 'mcp', label: 'MCP', kinds: ['mcp'] },
    { id: 'cli', label: 'CLI', kinds: ['cli', 'flag'] },
    { id: 'shortcuts', label: 'Shortcuts', kinds: ['shortcut'] },
  ];
  const TAB_OF = {};
  for (const tab of TABS) for (const kind of tab.kinds) TAB_OF[kind] = tab.id;

  const CLI_LABELS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
  const BUSY = new Set(['busy', 'subagent']);
  const PROMPT_KINDS = new Set(['slash', 'skill', 'custom', 'mcp']);

  /** The tab an entry is listed in. */
  function tabOf(entry) {
    return TAB_OF[entry && entry.kind] || 'commands';
  }

  /**
   * The tabs that have entries, in order; in a plain terminal the CLI's own
   * commands come first, as they are what a shell can run.
   */
  function tabsFor(catalog) {
    const entries = (catalog && catalog.entries) || [];
    const used = new Set(entries.map(tabOf));
    const tabs = TABS.filter((t) => used.has(t.id)).map((t) => ({ id: t.id, label: t.label }));
    if (catalog && catalog.target === 'terminal') {
      const cli = tabs.findIndex((t) => t.id === 'cli');
      if (cli > 0) tabs.unshift(tabs.splice(cli, 1)[0]);
    }
    return tabs;
  }

  const fold = (s) => String(s || '').toLowerCase();
  const bare = (s) => fold(s).replace(/^[/$@-]+/, '');

  function score(entry, q) {
    const names = [entry.name, entry.command, ...(entry.aliases || [])].map(bare);
    if (names.some((n) => n === q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (names.some((n) => n.split(/[\s:._/-]+/).some((w) => w.startsWith(q)))) return 2;
    if (names.some((n) => n.includes(q))) return 3;
    const text = fold(`${entry.description || ''} ${entry.outputBehavior || ''} ${entry.group || ''} ${entry.origin || ''}`);
    if (q.split(/\s+/).every((w) => text.includes(w))) return 4;
    return -1;
  }

  /**
   * The entries of a tab (all when `tab` is null) that match `query`, best
   * first: a name that is the query, then names that start with it, then a
   * word of a name, then any part of a name, then the description. With
   * `tabs` (tab ids in the order shown), the matches stay grouped by tab in
   * that order, so a shell's search lists the CLI's commands before slash
   * commands it cannot run. With no query, the entries in their own order.
   */
  function searchCommands(entries, query, options) {
    const { tab = null, limit = Infinity, tabs = null } = options || {};
    const list = (entries || []).filter((e) => !tab || tabOf(e) === tab);
    const q = bare(String(query || '').trim());
    if (!q) return list.slice(0, limit);
    const group = (entry) => {
      if (!tabs) return 0;
      const at = tabs.indexOf(tabOf(entry));
      return at < 0 ? tabs.length : at;
    };
    return list
      .map((entry, index) => ({ entry, index, rank: score(entry, q), group: group(entry) }))
      .filter((r) => r.rank >= 0)
      .sort((a, b) => a.group - b.group || a.rank - b.rank || a.index - b.index)
      .slice(0, limit)
      .map((r) => r.entry);
  }

  /** The characters a catalog's prompt commands start with: `/`, and `$` (Codex skills) or `@` (OpenCode skills). */
  function sigilsOf(catalog) {
    const out = new Set();
    for (const e of (catalog && catalog.entries) || []) if (PROMPT_KINDS.has(e.kind) && e.command) out.add(e.command[0]);
    return out;
  }

  /**
   * The command being typed when the text is only `/comp`, `$dep` or `@rev`
   * (no space yet): { sigil, query }. Null otherwise, in a plain terminal, and
   * for a character the catalog's commands do not start with (`@` is a file
   * mention for Claude Code and Codex). Without a catalog, any of the three.
   */
  function typedCommand(text, catalog) {
    const m = /^([/$@])(\S*)$/.exec(String(text || ''));
    if (!m) return null;
    if (catalog && (catalog.target !== 'agent' || !sigilsOf(catalog).has(m[1]))) return null;
    return { sigil: m[1], query: m[2] };
  }

  /**
   * The commands that complete what is typed at the start of a prompt, best
   * first, by name only (a description match is no completion). All the
   * commands with that first character while only it is typed.
   */
  function suggestionsFor(catalog, text, options) {
    const { limit = 6 } = options || {};
    const typed = typedCommand(text, catalog);
    if (!typed || !catalog) return [];
    const list = (catalog.entries || []).filter((e) => PROMPT_KINDS.has(e.kind) && e.command && e.command[0] === typed.sigil);
    const q = bare(typed.query);
    if (!q) return list.slice(0, limit);
    return list
      .map((entry, index) => ({ entry, index, rank: score(entry, q) }))
      .filter((r) => r.rank >= 0 && r.rank <= 3)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, limit)
      .map((r) => r.entry);
  }

  /** Text without control characters: nothing picked from the catalog can press a key. */
  function cleanText(text) {
    // eslint-disable-next-line no-control-regex
    return String(text || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  }

  /** A name read from the user's files, when it is a plain one (letters, digits, `:._/-`). */
  function safeName(name) {
    return typeof name === 'string' && /^[\w][\w:./-]*$/.test(name) ? name : null;
  }

  /**
   * What a pick does: `insert` types the text into the session, `copy` puts
   * it on the clipboard; null for an entry that is only read (a shortcut).
   * In a CLI's session a command of the CLI itself (`claude mcp list`, a
   * flag) would be a chat message, so it is copied; in a plain terminal a
   * slash command means nothing, so it is copied too.
   */
  function insertionFor(entry, options) {
    const { target = 'agent' } = options || {};
    if (!entry || entry.kind === 'shortcut') return null;
    if (PROMPT_KINDS.has(entry.kind)) {
      const text = cleanText(`${entry.command} `);
      return { mode: target === 'agent' ? 'insert' : 'copy', text };
    }
    // In a shell: `claude -p `, `codex exec ` or a flag to add to the line.
    if (target === 'terminal' && (entry.kind === 'flag' || entry.command.split(/\s+/)[0] === entry.cli)) {
      return { mode: 'insert', text: cleanText(`${entry.command} `) };
    }
    return { mode: 'copy', text: cleanText(entry.example || entry.command) };
  }

  /**
   * Whether Run (the text, then Enter) is offered for an entry: a command of
   * the prompt that needs no argument, in a CLI's session that is idle.
   * `{ ok, reason }`, the reason saying why not.
   */
  function canRun(entry, options) {
    const { target = 'agent', state = 'idle' } = options || {};
    if (!entry || !PROMPT_KINDS.has(entry.kind) || target !== 'agent') return { ok: false, reason: 'Only commands typed at the prompt can run.' };
    if (entry.argsRequired) return { ok: false, reason: `Needs ${entry.inputArgs || 'an argument'}: insert it and add the rest.` };
    if (state === 'attention') return { ok: false, reason: 'The CLI is waiting for your answer.' };
    if (BUSY.has(state)) return { ok: false, reason: 'The CLI is working: insert it, it runs after the current turn.' };
    return { ok: true };
  }

  const CONFIRM = {
    endsSession: 'It ends the session in this terminal.',
    replacesConversation: 'It replaces the conversation on screen.',
    account: 'It signs you in or out.',
    writesFiles: 'It writes files in the project or your setup.',
  };

  /** The question to ask before running an entry, or null when it can run as it is. */
  function needsConfirm(entry) {
    for (const flag of (entry && entry.flags) || []) {
      if (CONFIRM[flag]) return `Run ${entry.command}? ${CONFIRM[flag]}`;
    }
    return null;
  }

  /**
   * A line about the session for a pick: while the CLI waits for an answer
   * what is typed goes to its question, while it works a command waits for
   * the turn to end (a few run at once). Null when there is nothing to say.
   */
  function stateNotice(entry, state) {
    if (state === 'attention') return 'The CLI is waiting for your answer: what you insert goes to its question.';
    if (BUSY.has(state) && entry && PROMPT_KINDS.has(entry.kind)) {
      return (entry.flags || []).includes('runsWhileBusy') ? 'Runs at once, while the CLI works.' : 'Runs after the current turn.';
    }
    return null;
  }

  /**
   * A chat draft with a picked command in front: a command already leading
   * the draft is replaced, the rest of the draft becomes the arguments.
   */
  function applyToDraft(draft, text) {
    const pick = cleanText(text);
    const rest = String(draft || '').replace(/^\s*[/$][^\s]*\s*/, '');
    return rest ? `${pick.trimEnd()} ${rest}` : pick;
  }

  /** A shell line with a picked command or flag at its end, a space between. */
  function appendToLine(line, text) {
    const pick = cleanText(text);
    const before = String(line || '');
    if (!before.trim()) return pick;
    return /\s$/.test(before) ? `${before}${pick}` : `${before} ${pick}`;
  }

  function parseVersion(v) {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  /** Is version `a` at least `b`? Null when either cannot be read. */
  function versionAtLeast(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return true;
  }

  /** 'ok', 'newer' (the CLI in the session is older than the entry needs) or 'unknown'. */
  function availability(entry, version) {
    if (!entry || !entry.requires) return 'ok';
    const ok = versionAtLeast(version, entry.requires);
    return ok === null ? 'unknown' : ok ? 'ok' : 'newer';
  }

  const SOURCE_LABELS = { project: 'Project', user: 'User', plugin: 'Plugin', config: 'Config' };

  /** Short labels for an entry, for its row and its details. */
  function badgesOf(entry, version) {
    const out = [];
    if (!entry) return out;
    if (entry.bundled === 'skill') out.push({ id: 'bundled', label: 'Bundled skill' });
    if (entry.bundled === 'workflow') out.push({ id: 'bundled', label: 'Workflow' });
    if (SOURCE_LABELS[entry.source]) out.push({ id: 'source', label: entry.origin ? `${SOURCE_LABELS[entry.source]}: ${entry.origin}` : SOURCE_LABELS[entry.source] });
    const flags = entry.flags || [];
    if (flags.includes('endsSession')) out.push({ id: 'danger', label: 'Ends the session' });
    if (flags.includes('replacesConversation')) out.push({ id: 'danger', label: 'New conversation' });
    if (flags.includes('account')) out.push({ id: 'danger', label: 'Account' });
    if (flags.includes('writesFiles')) out.push({ id: 'danger', label: 'Writes files' });
    if (flags.includes('opensMenu')) out.push({ id: 'menu', label: 'Opens a menu' });
    if (flags.includes('runsTask') && !entry.bundled) out.push({ id: 'task', label: 'Runs a task' });
    if (entry.requires) {
      const state = availability(entry, version);
      out.push({ id: state === 'newer' ? 'newer' : 'requires', label: `${state === 'newer' ? 'Needs' : 'Since'} v${entry.requires}` });
    }
    return out;
  }

  /** The CLI's name for people. */
  function cliLabel(cli) {
    return CLI_LABELS[cli] || cli || 'CLI';
  }

  const api = {
    TABS, tabOf, tabsFor, searchCommands, typedCommand, suggestionsFor, insertionFor, canRun, needsConfirm, stateNotice, applyToDraft, appendToLine,
    versionAtLeast, availability, badgesOf, cleanText, safeName, cliLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CommandCatalogModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
