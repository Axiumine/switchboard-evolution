// The Codex parser (harnesses/commands/codex.js) on short excerpts written
// like its real sources: codex-rs/tui/src/slash_command.rs, the docs page
// learn.chatgpt.com/docs/developer-commands.md and `codex completion fish`.
const test = require('node:test');
const assert = require('node:assert/strict');
const codex = require('../harnesses/commands/codex');
const catalog = require('../harnesses/commands');

const RUST = `
use strum_macros::EnumString;

/// Commands that can be invoked by starting a message with a leading slash.
#[derive(Debug, Clone, Copy, EnumString, EnumIter)]
#[strum(serialize_all = "kebab-case")]
pub enum SlashCommand {
    // DO NOT ALPHA-SORT! Enum order is presentation order in the popup.
    Model,
    #[strum(serialize = "setup-default-sandbox")]
    ElevateSandbox,
    #[strum(to_string = "approve")]
    AutoReview,
    DebugConfig,
    #[strum(to_string = "pwd", serialize = "cwd")]
    Pwd,
    Quit,
    Exit,
    Rollout,
    // Debugging commands.
    #[strum(serialize = "debug-m-drop")]
    MemoryDrop,
}

impl SlashCommand {
    pub fn description(self) -> &'static str {
        match self {
            SlashCommand::Model => "choose what model and reasoning effort to use",
            SlashCommand::ElevateSandbox => "set up elevated agent sandbox",
            SlashCommand::AutoReview => "approve one retry of a recent auto-review denial",
            SlashCommand::DebugConfig => {
                "show config layers and \\"requirement\\" sources"
            }
            SlashCommand::Pwd => "show the current working directory",
            SlashCommand::Quit | SlashCommand::Exit => "exit Codex",
            SlashCommand::Rollout => "print the rollout file path",
            SlashCommand::MemoryDrop => "DO NOT USE",
        }
    }

    pub fn supports_inline_args(self) -> bool {
        matches!(self, SlashCommand::Model | SlashCommand::Pwd)
    }

    pub fn available_during_task(self) -> bool {
        match self {
            SlashCommand::ElevateSandbox | SlashCommand::Quit => false,
            SlashCommand::Model | SlashCommand::Pwd | SlashCommand::Exit => true,
            SlashCommand::Rollout => true,
        }
    }

    fn is_visible(self) -> bool {
        match self {
            SlashCommand::Rollout => cfg!(debug_assertions),
            _ => true,
        }
    }
}
`;

const DOCS = [
  '# Developer commands',
  '## Interactive shortcuts',
  '',
  '- Type `@` to search for a file in the workspace and add its path to the prompt.',
  '- Press <kbd>Ctrl</kbd>+<kbd>R</kbd> to search prompt history.',
  '- Press <kbd>Ctrl</kbd>+<kbd>&nbsp;O&nbsp;</kbd> to copy the latest completed response.',
  '',
  '## Built-in slash commands',
  '',
  '| Command                         | Purpose                                 | When to use it                     |',
  '| ------------------------------- | --------------------------------------- | ---------------------------------- |',
  '| [`/model`](#set-the-model)      | Choose the active model.                | Switch to a faster model.          |',
  '| [`/pwd`, `/cwd`](#change-dirs)  | Show the working directory.             | Check the directory in use.        |',
  '| [`/fast`](#fast)                | Toggle Fast mode.                       | Only in the docs.                  |',
].join('\n');

const FISH = [
  '# Print an optspec for argparse',
  'function __fish_codex_needs_command',
  '\tset -l cmd (commandline -opc)',
  'end',
  'complete -c codex -n "__fish_codex_needs_command" -s m -l model -d \'Model the agent should use\' -r',
  'complete -c codex -n "__fish_codex_needs_command" -s s -l sandbox -d \'Select the sandbox policy\' -r -f -a "read-only\\t\'\'',
  'workspace-write\\t\'\'',
  'danger-full-access\\t\'\'"',
  'complete -c codex -n "__fish_codex_needs_command" -l add-dir -d \'Additional directories\' -r -f -a "(__fish_complete_directories)"',
  'complete -c codex -n "__fish_codex_needs_command" -s h -l help -d \'Print help (see more with \\\'--help\\\')\'',
  'complete -c codex -n "__fish_codex_needs_command" -a "exec" -d \'Run Codex non-interactively\'',
  'complete -c codex -n "__fish_codex_needs_command" -a "e" -d \'Run Codex non-interactively\'',
  'complete -c codex -n "__fish_codex_needs_command" -a "mcp" -d \'Manage external MCP servers for Codex\'',
  'complete -c codex -n "__fish_codex_needs_command" -a "tcp-tunnel" -d \'Internal: forward a local TCP socket\'',
  'complete -c codex -n "__fish_codex_needs_command" -a "help" -d \'Print this message\'',
  'complete -c codex -n "__fish_codex_using_subcommand exec; and not __fish_seen_subcommand_from resume help" -s m -l model -d \'Model the agent should use\' -r',
  'complete -c codex -n "__fish_codex_using_subcommand exec; and not __fish_seen_subcommand_from resume help" -l json -d \'Print events to stdout as JSONL\'',
  'complete -c codex -n "__fish_codex_using_subcommand exec; and not __fish_seen_subcommand_from resume help" -f -a "resume" -d \'Resume a previous session\'',
  'complete -c codex -n "__fish_codex_using_subcommand e; and not __fish_seen_subcommand_from resume help" -l json -d \'Print events to stdout as JSONL\'',
  'complete -c codex -n "__fish_codex_using_subcommand mcp; and not __fish_seen_subcommand_from list add help" -f -a "list"',
  'complete -c codex -n "__fish_codex_using_subcommand mcp; and not __fish_seen_subcommand_from list add help" -f -a "add"',
  'complete -c codex -n "__fish_codex_using_subcommand mcp; and __fish_seen_subcommand_from add" -l url -d \'The URL of a streamable HTTP server\' -r',
  'complete -c codex -n "__fish_codex_using_subcommand help; and not __fish_seen_subcommand_from exec" -f -a "exec" -d \'Run Codex non-interactively\'',
  'complete -c codex -n "__fish_codex_using_subcommand tcp-tunnel" -l port -d \'Port\' -r',
].join('\n');

const byId = (entries) => Object.fromEntries(entries.map((e) => [e.id, e]));

test('the slash command enum: names as strum makes them, aliases, order', () => {
  assert.deepEqual(codex.parseEnum(RUST).map((v) => [v.name, v.aliases]), [
    ['model', []], ['setup-default-sandbox', []], ['approve', []], ['debug-config', []], ['pwd', ['cwd']],
    ['quit', []], ['exit', []], ['rollout', []], ['debug-m-drop', []],
  ]);
});

test('slash commands: descriptions from the docs or the source, arguments, while busy, hidden ones left out', () => {
  const entries = codex.parseSlashCommands(RUST, DOCS);
  const e = byId(entries);
  assert.deepEqual(entries.map((x) => x.command), ['/model', '/setup-default-sandbox', '/approve', '/debug-config', '/pwd', '/quit', '/exit']);
  assert.equal(e['codex:slash:model'].description, 'Choose the active model.');
  assert.equal(e['codex:slash:model'].outputBehavior, 'Switch to a faster model.');
  assert.equal(e['codex:slash:model'].inputArgs, '[args]');
  assert.ok(e['codex:slash:model'].flags.includes('runsWhileBusy'));
  // No docs row: the source's description, made a sentence.
  assert.equal(e['codex:slash:approve'].description, 'Approve one retry of a recent auto-review denial.');
  assert.equal(e['codex:slash:debug-config'].description, 'Show config layers and "requirement" sources.');
  assert.deepEqual(e['codex:slash:pwd'].aliases, ['cwd']);
  assert.equal(e['codex:slash:pwd'].description, 'Show the working directory.');
  assert.equal(e['codex:slash:quit'].description, 'Exit Codex.');
  assert.ok(e['codex:slash:exit'].flags.includes('endsSession'));
  assert.ok(!e['codex:slash:quit'].flags.includes('runsWhileBusy'));
  assert.equal(e['codex:slash:fast'], undefined);
  assert.equal(e['codex:slash:rollout'], undefined);
  assert.equal(e['codex:slash:debug-m-drop'], undefined);
});

test('shortcuts from the docs: the keys, or the character typed', () => {
  const entries = codex.parseShortcuts(DOCS);
  assert.deepEqual(entries.map((x) => x.command), ['@', 'Ctrl+R', 'Ctrl+O']);
  assert.equal(entries[2].description, 'Press Ctrl+O to copy the latest completed response.');
});

test('the fish script read the fish way: quotes across lines, escapes, comments', () => {
  const commands = codex.fishCommands(FISH);
  const sandbox = commands.find((w) => w.includes('sandbox'));
  assert.equal(sandbox[sandbox.indexOf('-a') + 1], "read-only\\t''\nworkspace-write\\t''\ndanger-full-access\\t''");
  const help = commands.find((w) => w.includes('help') && w.includes('-l'));
  assert.equal(help[help.indexOf('-d') + 1], "Print help (see more with '--help')");
  assert.equal(commands.every((w) => w[0] === 'complete'), true);
  assert.deepEqual(codex.conditionPath('__fish_codex_needs_command'), []);
  assert.deepEqual(codex.conditionPath('__fish_codex_using_subcommand exec; and not __fish_seen_subcommand_from resume help'), ['exec']);
  assert.deepEqual(codex.conditionPath('__fish_codex_using_subcommand mcp; and __fish_seen_subcommand_from add'), ['mcp', 'add']);
});

test('subcommands and flags from the completion: aliases, values, nothing internal or repeated', () => {
  const entries = codex.parseCompletion(FISH);
  const e = byId(entries);
  assert.deepEqual(entries.filter((x) => x.kind === 'cli').map((x) => x.command),
    ['codex exec', 'codex mcp', 'codex exec resume', 'codex mcp list', 'codex mcp add']);
  assert.deepEqual(e['codex:cli:exec'].aliases, ['e']);
  assert.equal(e['codex:cli:mcp-list'].description, 'The list command of codex mcp.');
  assert.deepEqual(e['codex:flag:sandbox'].acceptedValues, ['read-only', 'workspace-write', 'danger-full-access']);
  assert.deepEqual(e['codex:flag:sandbox'].aliases, ['-s']);
  assert.equal(e['codex:flag:add-dir'].acceptedValues, undefined);
  assert.equal(e['codex:flag:help'], undefined);
  // exec repeats the global --model: only its own --json is listed, under it.
  assert.equal(e['codex:flag:exec:model'], undefined);
  assert.equal(e['codex:flag:exec:json'].group, 'codex exec');
  // Nothing under an alias, help, or an internal subcommand.
  assert.equal(entries.some((x) => x.group === 'codex e' || x.group === 'codex tcp-tunnel'), false);
  assert.equal(entries.some((x) => x.command.startsWith('codex help') || x.command.includes('tcp-tunnel')), false);
});

test('without the completion (the refresh), the entries it gave before are kept', () => {
  const previous = { entries: [{ id: 'codex:cli:exec', kind: 'cli', source: 'cli-completion' }, { id: 'codex:slash:old', kind: 'slash', source: 'cli-source' }] };
  const entries = codex.parseDocs({ 'slash-commands': RUST, 'developer-commands': DOCS }, { previous });
  assert.ok(entries.some((x) => x.id === 'codex:cli:exec'));
  assert.ok(!entries.some((x) => x.id === 'codex:slash:old'));
});

test('a source kept at a release tag is read at the tag of the version asked for', () => {
  const [slash, docs, completion] = codex.SOURCES;
  assert.equal(catalog.sourceUrl('codex', slash, '0.167.0'), 'https://raw.githubusercontent.com/openai/codex/rust-v0.167.0/codex-rs/tui/src/slash_command.rs');
  assert.equal(catalog.sourceUrl('codex', slash, undefined), null);
  assert.equal(catalog.sourceUrl('codex', docs, undefined), docs.url);
  assert.equal(catalog.sourceUrl('codex', completion, '1.0.0'), null);
  assert.ok(completion.buildOnly);
});

test('sanity wants the commands Codex always has', () => {
  const problems = codex.sanity(codex.parseDocs({ 'slash-commands': RUST, 'developer-commands': DOCS, completion: FISH }));
  assert.ok(problems.includes('slash: review is missing'));
  assert.ok(problems.some((p) => p.startsWith('flag:')));
});
