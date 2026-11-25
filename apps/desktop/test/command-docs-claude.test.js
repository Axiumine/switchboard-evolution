// The Claude Code docs parser on short excerpts written like the real pages
// (code.claude.com/docs/en/commands.md, cli-reference.md, interactive-mode.md),
// one for each case that a naive reading gets wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const claude = require('../harnesses/commands/claude');

const COMMANDS = [
  '> ## Documentation Index',
  '> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt',
  '',
  '# Commands',
  '',
  '## All commands',
  '',
  '| Command | Purpose |',
  '| :- | :- |',
  '| `/add-dir <path>` | Add a working directory for file access. Paths are kept. |',
  '| `/advisor [model\\|off]` | Enable or disable the [advisor tool](https://x/advisor.md). Accepts `fable`, `opus`, `sonnet`, or a full model ID. These forms require Claude Code v2.1.260 or later |',
  '| `/batch <instruction>` | **[Skill](https://x/skills.md#bundled-skills).** Orchestrate large-scale changes. Requires a git repository. |',
  '| `/bug [report]` | Report a bug. Alias: `/share`. Before v2.1.212, `/bug` and `/share` were aliases of `/feedback` |',
  '| `/clear [name]` | Start a new conversation with empty context. Aliases: `/reset`, `/new` |',
  '| `/code-review [low\\|high] [pr#]` | Review the current diff. Alias: `/review` |',
  '| `/deep-research <question>` | **[Workflow](https://x/workflows.md#bundled-workflows).** Fan out web searches |',
  '| `/design consent`, `/design revoke` | Grant Claude access to Claude Design, or withdraw it |',
  '| `/doctor [prompt-audit [path]]` | Run a checkup. Alias: `/checkup` |',
  '| `/exit` | Exit the CLI. Alias: `/quit` |',
  '| `/fast [on\\|off]` | Toggle fast mode on or off |',
  '| `/mcp [reconnect (<server>\\|all)\\|enable\\|disable [<server>\\|all]]` | Manage MCP server connections |',
  '| `/output-style [style]` | Switch the output style. Requires Claude Code v2.1.269 or later |',
  '| `/review [low\\|high] [pr#]` | Alias of [`/code-review`](https://x/code-review-local): reviews the current diff |',
  '| `/teleport` | Pull a cloud session into this terminal. Also available as `/tp`. Requires a claude.ai subscription |',
  '',
  '## MCP prompts',
].join('\n');

const CLI_REFERENCE = [
  '# CLI reference',
  '## CLI commands',
  '| Command | Description | Example |',
  '| :- | :- | :- |',
  '| `claude` | Start interactive session | `claude` |',
  '| `claude -p "query"` | Query via SDK, then exit | `claude -p "explain this function"` |',
  '| `cat file \\| claude -p "query"` | Process piped content | `cat logs.txt \\| claude -p "explain"` |',
  '| `claude install [version]` | Install the native binary. Accepts a version like `2.1.118`, or `stable` or `latest` | `claude install stable` |',
  '## CLI flags',
  '| Flag | Description | Example |',
  '| :- | :- | :- |',
  '| `--advisor <model>` | Enable the advisor tool | `claude --advisor opus` |',
  '| `--bg`, `--background` | Start the session as a background agent | `claude --bg "x"` |',
  '| `--effort` | Set the effort level. Options: `low`, `medium`, `high`, `xhigh`, `max`, or `ultracode`. Available levels depend on the model | `claude --effort high` |',
  '| `--enable-auto-mode` | Removed in v2.1.111. Use `--permission-mode auto` | `claude --permission-mode auto` |',
  '| `--output-format` | Specify output format for print mode (options: `text`, `json`, `stream-json`) | `claude -p "q" --output-format json` |',
  '| `--permission-mode` | Begin in a mode. Accepts `default`, `acceptEdits`, `plan`, or `manual` as an alias for `default` | `claude --permission-mode plan` |',
  '| `--restricted` | Start in restricted mode. Requires Claude Code v2.1.248 or later | `claude --restricted` |',
  '| `--system-prompt` | Replace the system prompt | `claude --system-prompt "x"` |',
  '### System prompt flags',
  '| Flag | Behavior | Example |',
  '| :- | :- | :- |',
  '| `--system-prompt` | Replaces the entire default prompt | `claude --system-prompt "x"` |',
  '| `--append-system-prompt` | Appends to the default prompt | `claude --append-system-prompt "x"` |',
].join('\n');

const INTERACTIVE = [
  '# Interactive mode',
  '## Keyboard shortcuts',
  '### General controls',
  '| Shortcut | Description | Context |',
  '| :- | :- | :- |',
  '| `Ctrl+C` | Interrupt, or clear input | Interrupts a running operation. A second press exits |',
  '| `Ctrl+G` or `Ctrl+X Ctrl+E` | Open in default text editor | Edit your prompt |',
  '### Multiline input',
  '| Method | Shortcut | Context |',
  '| :- | :- | :- |',
  '| Quick escape | `\\` + `Enter` | Works in all terminals |',
  '## Vim editor mode',
  '| Command | Action | From mode |',
  '| :- | :- | :- |',
  '| `Esc` | Enter NORMAL mode | INSERT |',
].join('\n');

const byId = (entries) => Object.fromEntries(entries.map((e) => [e.id, e]));

test('slash commands: signature, arguments, aliases and kind markers', () => {
  const e = byId(claude.parseCommands(COMMANDS));
  assert.deepEqual(
    { command: e['claude:slash:add-dir'].command, inputArgs: e['claude:slash:add-dir'].inputArgs, argsRequired: e['claude:slash:add-dir'].argsRequired },
    { command: '/add-dir', inputArgs: '<path>', argsRequired: true });
  assert.equal(e['claude:slash:clear'].argsRequired, undefined);
  assert.deepEqual(e['claude:slash:clear'].aliases, ['reset', 'new']);
  assert.ok(e['claude:slash:clear'].flags.includes('replacesConversation'));
  // Only the first alias sentence counts: the history after it is not.
  assert.deepEqual(e['claude:slash:bug'].aliases, ['share']);
  assert.deepEqual(e['claude:slash:teleport'].aliases, ['tp']);
  assert.deepEqual(e['claude:slash:exit'].aliases, ['quit']);
  // An alias with a row of its own is that row only.
  assert.equal(e['claude:slash:code-review'].aliases, undefined);
  assert.equal(e['claude:slash:review'].aliases, undefined);
  assert.ok(e['claude:slash:exit'].flags.includes('endsSession'));
  // Two commands in one cell.
  assert.equal(e['claude:slash:design-consent'].command, '/design consent');
  assert.equal(e['claude:slash:design-revoke'].command, '/design revoke');
  // Bundled skills and workflows run a task.
  assert.equal(e['claude:slash:batch'].bundled, 'skill');
  assert.ok(e['claude:slash:batch'].flags.includes('runsTask'));
  assert.equal(e['claude:slash:batch'].description, 'Orchestrate large-scale changes. Requires a git repository.');
  assert.equal(e['claude:slash:deep-research'].bundled, 'workflow');
});

test('slash commands: nested grammar is optional, values from the signature or the prose', () => {
  const e = byId(claude.parseCommands(COMMANDS));
  assert.equal(e['claude:slash:mcp'].inputArgs, '[reconnect (<server>|all)|enable|disable [<server>|all]]');
  assert.equal(e['claude:slash:mcp'].argsRequired, undefined);
  assert.equal(e['claude:slash:doctor'].inputArgs, '[prompt-audit [path]]');
  assert.deepEqual(e['claude:slash:fast'].acceptedValues, ['on', 'off']);
  assert.deepEqual(e['claude:slash:advisor'].acceptedValues, ['fable', 'opus', 'sonnet']);
});

test('a version applies to the command only when its own sentence says so', () => {
  const e = byId(claude.parseCommands(COMMANDS));
  assert.equal(e['claude:slash:output-style'].requires, '2.1.269');
  // "These forms require…" is about some uses of the command, not the command.
  assert.equal(e['claude:slash:advisor'].requires, undefined);
});

test('CLI commands keep their arguments apart; a shell line is kept whole', () => {
  const e = byId(claude.parseCliReference(CLI_REFERENCE));
  assert.deepEqual([e['claude:cli:claude-p-query'].command, e['claude:cli:claude-p-query'].inputArgs, e['claude:cli:claude-p-query'].argsRequired],
    ['claude -p', '"query"', true]);
  assert.equal(e['claude:cli:claude'].command, 'claude');
  assert.equal(e['claude:cli:claude-p-query'].example, 'claude -p "explain this function"');
  const piped = e['claude:cli:cat-file-claude-p-query'];
  assert.deepEqual([piped.command, piped.inputArgs], ['cat file | claude -p "query"', undefined]);
  assert.equal(e['claude:cli:claude-install-version'].argsRequired, undefined);
});

test('CLI flags: aliases, arguments, accepted values; removed and repeated flags left out', () => {
  const entries = claude.parseCliReference(CLI_REFERENCE).filter((x) => x.kind === 'flag');
  const e = byId(entries);
  assert.deepEqual([e['claude:flag:advisor'].command, e['claude:flag:advisor'].inputArgs], ['--advisor', '<model>']);
  assert.deepEqual(e['claude:flag:bg'].aliases, ['--background']);
  assert.deepEqual(e['claude:flag:effort'].acceptedValues, ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
  assert.deepEqual(e['claude:flag:output-format'].acceptedValues, ['text', 'json', 'stream-json']);
  assert.deepEqual(e['claude:flag:permission-mode'].acceptedValues, ['default', 'acceptEdits', 'plan', 'manual']);
  assert.equal(e['claude:flag:restricted'].requires, '2.1.248');
  assert.equal(e['claude:flag:enable-auto-mode'], undefined);
  assert.equal(entries.filter((x) => x.command === '--system-prompt').length, 1);
  assert.equal(e['claude:flag:system-prompt'].description, 'Replace the system prompt');
  assert.ok(e['claude:flag:append-system-prompt']);
});

test('keyboard shortcuts, by section, only under Keyboard shortcuts', () => {
  const entries = claude.parseShortcuts(INTERACTIVE);
  assert.deepEqual(entries.map((x) => x.command), ['Ctrl+C', 'Ctrl+G or Ctrl+X Ctrl+E', '\\ + Enter']);
  assert.equal(entries[0].group, 'General controls');
  assert.equal(entries[0].outputBehavior, 'Interrupts a running operation. A second press exits');
  // In the multiline table the description is the Method column.
  assert.equal(entries[2].description, 'Quick escape');
  assert.equal(entries[2].group, 'Multiline input');
});

test('every entry has the fields the catalog needs', () => {
  const entries = claude.parseDocs({ commands: COMMANDS, 'cli-reference': CLI_REFERENCE, 'interactive-mode': INTERACTIVE });
  for (const e of entries) {
    assert.equal(e.cli, 'claude');
    assert.ok(e.id && e.command && e.name && e.description && e.docUrl, e.id);
    assert.equal(e.source, 'official-docs');
    for (const [key, value] of Object.entries(e)) assert.ok(value !== undefined && value !== '', `${e.id}.${key}`);
  }
});

test('sanity rejects entries that do not look like the docs', () => {
  const few = claude.parseDocs({ commands: COMMANDS, 'cli-reference': CLI_REFERENCE, 'interactive-mode': INTERACTIVE });
  const problems = claude.sanity(few);
  assert.ok(problems.some((p) => p.startsWith('slash:')));
  assert.ok(problems.some((p) => p === 'slash: compact is missing'));
  assert.deepEqual(claude.sanity([]).length > 0, true);
});
