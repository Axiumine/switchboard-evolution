// Copied from packages/shared/prompt-improver-model.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// prompt-improver-model.js — the prompt improver's rules, for the desktop
// (main process and window) and the phone.
//
// The improver rewrites the prompt the user is writing to a session's CLI
// (Claude Code, Codex, OpenCode) before it is sent. The desktop runs the CLI
// the user is already signed in to, once and out of sight (`claude -p`,
// `codex exec --ephemeral`, `opencode run`): no API key. What it sends is
// the improver prompt the user can edit (DEFAULT_TEMPLATE when they have not)
// with, after it, a context block the app builds and the editor never shows:
// the session's CLI, the last turns of the conversation, and the commands,
// skills, custom commands and MCP servers the session has, with the exact
// way to call each and the instruction to use one only when it clearly fits
// (CAPABILITIES_INSTRUCTION: the app's, so no improver prompt drops it). The reply is the rewritten prompt, inside
// <improved_prompt></improved_prompt>.
//
// Here: the settings and their checks, the template's placeholders, the
// context block and the reading of the reply. Shared with the phone app
// (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const ENGINES = ['session', 'claude', 'codex', 'opencode'];
  const CLIS = ['claude', 'codex', 'opencode'];
  // `fork` (the whole conversation, through a hidden fork of the session) is
  // alternative B, not built yet: prompt-improver-alternative-b-g.md.
  const MODES = ['recent', 'none'];
  const CLI_LABELS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

  const MAX_PROMPT = 32768;
  const MAX_TEMPLATE = 32768;
  const MAX_TURNS = 20;
  const MIN_TIMEOUT = 20;
  const MAX_TIMEOUT = 600;

  const DEFAULT_TEMPLATE = [
    'You rewrite a prompt that a developer is about to send to {{cli}}, a coding agent working in the project "{{project}}". Make the agent\'s result better; do not do the task yourself.',
    '',
    'Rewrite the prompt so that it:',
    '- keeps the author\'s goal, scope and language: write in the language of the prompt, and keep code, paths, identifiers and commands exactly as written;',
    '- states the action explicitly (implement, fix, explain, review…) and what counts as done;',
    '- carries the context the agent cannot find in the repository: the symptom and how to reproduce a bug, constraints, what must not change, a preferred approach;',
    '- names files, symbols or commands only when the prompt or the context below gives them; never invent paths, requirements or facts;',
    '- when the task changes code, asks for a check the agent can run (tests, build, lint, a reproduction) and for its result in the final report;',
    '- leaves out filler, capitalised emphasis and generic advice such as "think step by step";',
    '- stays as short as the task allows: if the prompt is already clear, change little.',
    '',
    'If something essential is missing and cannot be inferred, end with one line asking the agent to ask about it before starting.',
    '',
    'Do not run tools and do not answer the prompt. Reply only with the rewritten prompt inside <improved_prompt></improved_prompt>.',
    '',
    '{{prompt}}',
  ].join('\n');

  // What the CLI is told it is (Claude's --system-prompt): a short role, the
  // template carries the rules.
  const SYSTEM_PROMPT = 'You improve prompts for coding agents. You never run tools and never do the task; you reply only with the rewritten prompt.';

  const PLACEHOLDERS = [
    { name: '{{prompt}}', description: 'The prompt to improve, with the app\'s context just before it. Without it, both go at the end.' },
    { name: '{{cli}}', description: 'The CLI of the session: Claude Code, Codex or OpenCode.' },
    { name: '{{project}}', description: 'The name of the project folder.' },
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    confirm: true,
    engine: 'session',
    context: 'recent',
    recentTurns: 6,
    models: { claude: '', codex: '', opencode: '' },
    timeoutSec: 120,
    template: null,
  };

  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const MODEL_RE = /^[\w.:/#@+-]{0,120}$/;

  /**
   * Settings with every field, from whatever is stored: a missing or wrong
   * value takes its default. `template: null` is the default template, so a
   * better default reaches whoever never changed it.
   */
  function normalizeSettings(raw) {
    const s = isObject(raw) ? raw : {};
    const out = { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } };
    if (typeof s.enabled === 'boolean') out.enabled = s.enabled;
    if (typeof s.confirm === 'boolean') out.confirm = s.confirm;
    if (ENGINES.includes(s.engine)) out.engine = s.engine;
    if (MODES.includes(s.context)) out.context = s.context;
    if (Number.isInteger(s.recentTurns)) out.recentTurns = Math.min(MAX_TURNS, Math.max(0, s.recentTurns));
    if (Number.isInteger(s.timeoutSec)) out.timeoutSec = Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, s.timeoutSec));
    if (isObject(s.models)) {
      for (const cli of CLIS) {
        const m = s.models[cli];
        if (typeof m === 'string' && MODEL_RE.test(m.trim())) out.models[cli] = m.trim();
      }
    }
    if (typeof s.template === 'string' && s.template.trim() && s.template.length <= MAX_TEMPLATE && s.template !== DEFAULT_TEMPLATE) {
      out.template = s.template;
    }
    return out;
  }

  /**
   * Checks settings sent to be saved (from the window or a phone): the same
   * fields as normalizeSettings, but a wrong value is an error, not a default.
   * `{ ok: true, value }` (normalized) or `{ ok: false, error }`.
   */
  function validateSettings(raw) {
    if (!isObject(raw)) return { ok: false, error: 'Settings must be an object.' };
    const known = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const key of Object.keys(raw)) if (!known.has(key)) return { ok: false, error: `Unknown setting: ${key}.` };
    if ('enabled' in raw && typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false.' };
    if ('confirm' in raw && typeof raw.confirm !== 'boolean') return { ok: false, error: 'confirm must be true or false.' };
    if ('engine' in raw && !ENGINES.includes(raw.engine)) return { ok: false, error: `engine must be one of ${ENGINES.join(', ')}.` };
    if ('context' in raw && !MODES.includes(raw.context)) return { ok: false, error: `context must be one of ${MODES.join(', ')}.` };
    if ('recentTurns' in raw && !(Number.isInteger(raw.recentTurns) && raw.recentTurns >= 0 && raw.recentTurns <= MAX_TURNS)) {
      return { ok: false, error: `recentTurns must be a whole number from 0 to ${MAX_TURNS}.` };
    }
    if ('timeoutSec' in raw && !(Number.isInteger(raw.timeoutSec) && raw.timeoutSec >= MIN_TIMEOUT && raw.timeoutSec <= MAX_TIMEOUT)) {
      return { ok: false, error: `timeoutSec must be a whole number from ${MIN_TIMEOUT} to ${MAX_TIMEOUT}.` };
    }
    if ('models' in raw) {
      if (!isObject(raw.models)) return { ok: false, error: 'models must be an object.' };
      for (const [cli, m] of Object.entries(raw.models)) {
        if (!CLIS.includes(cli)) return { ok: false, error: `Unknown CLI in models: ${cli}.` };
        if (typeof m !== 'string' || !MODEL_RE.test(m.trim())) return { ok: false, error: `The model for ${cli} is not a plain model name.` };
      }
    }
    if ('template' in raw && raw.template !== null) {
      if (typeof raw.template !== 'string') return { ok: false, error: 'template must be text or null.' };
      if (raw.template.length > MAX_TEMPLATE) return { ok: false, error: `The improver prompt is longer than ${MAX_TEMPLATE} characters.` };
    }
    return { ok: true, value: normalizeSettings(raw) };
  }

  /** The improver prompt in use: the user's, or the default. */
  function templateOf(settings) {
    const t = settings && settings.template;
    return typeof t === 'string' && t.trim() ? t : DEFAULT_TEMPLATE;
  }

  /** The CLI that runs the improvement for a session of `runtime`. */
  function engineFor(settings, runtime) {
    const engine = settings && settings.engine;
    if (engine && engine !== 'session' && CLIS.includes(engine)) return engine;
    return CLIS.includes(runtime) ? runtime : 'claude';
  }

  /** The CLI's name for people. */
  function cliLabel(cli) {
    return CLI_LABELS[cli] || cli || 'CLI';
  }

  // Text without control characters, except new lines and tabs.
  function cleanMultiline(text) {
    // eslint-disable-next-line no-control-regex
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
  }

  // One line, at most `max` characters, cut at a word.
  function oneLine(text, max) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }

  function firstSentence(text, max) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const m = /^(.+?[.!?])(\s|$)/.exec(s);
    return oneLine(m ? m[1] : s, max);
  }

  // Keeps a tag the user typed from closing the app's own.
  function neutralize(text, tags) {
    let out = text;
    for (const tag of tags) out = out.replace(new RegExp(`</?${tag}>`, 'gi'), (m) => m.replace('<', '‹').replace('>', '›'));
    return out;
  }

  const INVOCATION_RULES = {
    claude: [
      'A slash command or skill (/name) only runs when it is the very first thing in the message, and only one per message. Put at most one at the start; ask for any other skill in words ("use the <name> skill").',
      'MCP servers are used through their tools: name the server in words ("use the <name> MCP server to …").',
    ],
    codex: [
      'Skills are called with $name anywhere in the message, several if needed.',
      'A slash command (/name, /prompts:name) only runs when it is the very first thing in the message.',
      'MCP servers are used through their tools: name the server in words ("use the <name> MCP server to …").',
    ],
    opencode: [
      'A command (/name) only runs when it is the very first thing in the message.',
      'Skills can be mentioned anywhere in the message with the syntax listed.',
      'MCP servers are used through their tools: name the server in words ("use the <name> MCP server to …").',
    ],
  };

  // At the head of the list of what the session has, whatever the improver prompt says.
  const CAPABILITIES_INSTRUCTION = 'Before rewriting, check this list for a command, skill or MCP server that fits the task. Use one only when it clearly fits, with the exact syntax given here, and only a few; otherwise use none.';

  /** How commands, skills and MCP servers are called in a message to `cli`. */
  function invocationRules(cli) {
    return INVOCATION_RULES[cli] || INVOCATION_RULES.claude;
  }

  const SKIP_FLAGS = ['endsSession', 'replacesConversation', 'account', 'opensMenu'];

  /**
   * The catalog entries worth offering in a prompt: skills, custom commands
   * and MCP servers, and the CLI's own slash commands that run a task or are
   * a bundled skill (not /clear, /exit, /login, a menu…).
   */
  function usefulEntries(entries) {
    return (entries || []).filter((e) => {
      if (!e || typeof e.command !== 'string' || !e.command) return false;
      if ((e.flags || []).some((f) => SKIP_FLAGS.includes(f))) return false;
      if (e.kind === 'skill' || e.kind === 'custom' || e.kind === 'mcp') return true;
      if (e.kind === 'slash') return !!e.bundled || (e.flags || []).includes('runsTask');
      return false;
    });
  }

  // Letters of any script where the engine knows \p{…}, ASCII ones elsewhere.
  let NOT_WORD;
  try {
    NOT_WORD = new RegExp('[^\\p{L}\\p{N}]+', 'u');
  } catch {
    NOT_WORD = /[^a-z0-9]+/;
  }
  const words = (s) => new Set(String(s || '').toLowerCase().split(NOT_WORD).filter((w) => w.length > 2));

  /** How a capability is written in the list: the exact syntax, or the server's name. */
  function syntaxOf(entry) {
    if (entry.kind === 'mcp') return `MCP server "${oneLine(entry.name || entry.command, 80)}"`;
    const args = entry.inputArgs ? ` ${oneLine(entry.inputArgs, 60)}` : '';
    return `${oneLine(entry.command, 120)}${args}`;
  }

  /**
   * The list of what the session can call, for the context block: each line
   * the syntax and the first sentence of its description, the ones sharing
   * words with the prompt first. Past `maxChars` only names follow, and past
   * twice that a count.
   */
  function capabilitiesBlock(entries, prompt, options) {
    const { maxChars = 16000 } = options || {};
    const useful = usefulEntries(entries);
    if (!useful.length) return '';
    const promptWords = words(prompt);
    const ranked = useful
      .map((entry, index) => {
        const own = words(`${entry.name} ${entry.description || ''}`);
        let shared = 0;
        for (const w of own) if (promptWords.has(w)) shared++;
        return { entry, index, shared };
      })
      .sort((a, b) => b.shared - a.shared || a.index - b.index);
    const lines = [];
    const namesOnly = [];
    let used = 0;
    let left = 0;
    for (const { entry } of ranked) {
      const desc = firstSentence(entry.description, 200);
      const line = `- ${syntaxOf(entry)}${desc ? ` — ${desc}` : ''}`;
      if (used + line.length + 1 <= maxChars) {
        lines.push(line);
        used += line.length + 1;
      } else if (used + syntaxOf(entry).length + 2 <= maxChars * 2) {
        namesOnly.push(syntaxOf(entry));
        used += syntaxOf(entry).length + 2;
      } else {
        left++;
      }
    }
    if (namesOnly.length) lines.push(`- Also available (no description): ${namesOnly.join(', ')}`);
    if (left) lines.push(`- And ${left} more not listed.`);
    return lines.join('\n');
  }

  /**
   * The last turns of the conversation, for the context block: `turns` is a
   * list of `{ role: 'user' | 'assistant', text }`, oldest first. The newest
   * are kept, each cut to `perTurn` characters, all within `maxChars`.
   */
  function recentBlock(turns, options) {
    const { perTurn = 1500, maxChars = 8000 } = options || {};
    const out = [];
    let used = 0;
    const list = (turns || []).filter((t) => t && (t.role === 'user' || t.role === 'assistant') && String(t.text || '').trim());
    for (let i = list.length - 1; i >= 0; i--) {
      const text = cleanMultiline(list[i].text).trim();
      const cut = text.length > perTurn ? `${text.slice(0, perTurn).trimEnd()}…` : text;
      const block = `[${list[i].role}]\n${cut}`;
      if (used + block.length > maxChars) break;
      out.unshift(block);
      used += block.length + 2;
    }
    return out.join('\n\n');
  }

  /** The template with its placeholders filled; `{{prompt}}` becomes `promptBlock`. */
  function fillTemplate(template, values) {
    const { prompt = '', cli = '', project = '' } = values || {};
    const text = String(template || '');
    const filled = text.replace(/\{\{\s*(cli|project)\s*\}\}/g, (_, key) => (key === 'cli' ? cli : project));
    if (/\{\{\s*prompt\s*\}\}/.test(filled)) return filled.replace(/\{\{\s*prompt\s*\}\}/g, () => prompt);
    return `${filled.trimEnd()}\n\n${prompt}`;
  }

  /**
   * What the CLI receives: the improver prompt (the user's or the default),
   * and where it says {{prompt}} (or at the end) the app's context block and
   * the prompt to improve.
   *
   *   input = { template, prompt, cli, version?, project?, mode?, recent?, entries? }
   */
  function buildImproverInput(input) {
    const { template, prompt, cli, version, project, mode = 'recent', recent, entries } = input || {};
    const label = cliLabel(cli);
    const userPrompt = neutralize(cleanMultiline(prompt).trim(), ['user_prompt', 'switchboard_context']);
    const parts = [];
    parts.push(`<session cli="${label}"${version ? ` version="${oneLine(version, 40)}"` : ''}${project ? ` project="${oneLine(project, 120).replace(/"/g, "'")}"` : ''} />`);
    if (mode === 'recent') {
      const turns = recentBlock(recent);
      if (turns) parts.push(`<recent_conversation>\nThe last turns of the session the prompt is for, oldest first:\n\n${neutralize(turns, ['recent_conversation', 'switchboard_context', 'user_prompt'])}\n</recent_conversation>`);
    }
    const caps = capabilitiesBlock(entries, prompt);
    if (caps) {
      const rules = invocationRules(cli).map((r) => `- ${r}`).join('\n');
      // The app's own instruction, not the template's: an edited improver prompt cannot drop it.
      parts.push(`<available_capabilities>\n${CAPABILITIES_INSTRUCTION}\n\nHow to call them in a message to ${label}:\n${rules}\n\nWhat this session has:\n${caps}\n</available_capabilities>`);
    }
    const context = `<switchboard_context>\n${parts.join('\n\n')}\n</switchboard_context>`;
    const promptBlock = `${context}\n\n<user_prompt>\n${userPrompt}\n</user_prompt>`;
    return fillTemplate(templateOf({ template }), { prompt: promptBlock, cli: label, project: oneLine(project || '', 120) });
  }

  /**
   * The rewritten prompt in a reply: the last <improved_prompt> block (an
   * unclosed one runs to the end), or the whole reply when there is none.
   * Null when nothing is left.
   */
  function extractImproved(output) {
    const text = cleanMultiline(output);
    const open = text.toLowerCase().lastIndexOf('<improved_prompt>');
    let body = text;
    if (open >= 0) {
      const start = open + '<improved_prompt>'.length;
      const close = text.toLowerCase().indexOf('</improved_prompt>', start);
      body = close >= 0 ? text.slice(start, close) : text.slice(start);
    }
    body = body.replace(/^\n+|\s+$/g, '');
    return body.trim() ? body : null;
  }

  /** Checks a prompt sent to be improved: `{ ok, error? }`. */
  function checkPrompt(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'There is no prompt to improve.' };
    if (prompt.length > MAX_PROMPT) return { ok: false, error: `The prompt is longer than ${MAX_PROMPT} characters.` };
    return { ok: true };
  }

  const api = {
    ENGINES, CLIS, MODES, DEFAULT_TEMPLATE, DEFAULT_SETTINGS, SYSTEM_PROMPT, PLACEHOLDERS, MAX_PROMPT, MAX_TEMPLATE,
    normalizeSettings, validateSettings, templateOf, engineFor, cliLabel, invocationRules, usefulEntries,
    capabilitiesBlock, recentBlock, fillTemplate, buildImproverInput, extractImproved, checkPrompt, cleanMultiline,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PromptImproverModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
