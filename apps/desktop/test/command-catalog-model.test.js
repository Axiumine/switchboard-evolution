// The command catalog's rules (packages/shared/command-catalog-model.js,
// through the desktop's copy): tabs, search, what a pick types, when Run is
// allowed and what it asks first.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../public/command-catalog-model');

const e = (over) => ({ cli: 'claude', kind: 'slash', source: 'official-docs', description: '', ...over });
const ENTRIES = [
  e({ id: 'claude:slash:clear', command: '/clear', name: 'clear', aliases: ['reset', 'new'], inputArgs: '[name]', description: 'Start a new conversation', flags: ['replacesConversation'] }),
  e({ id: 'claude:slash:compact', command: '/compact', name: 'compact', inputArgs: '[instructions]', description: 'Free up context by summarizing the conversation' }),
  e({ id: 'claude:slash:add-dir', command: '/add-dir', name: 'add-dir', inputArgs: '<path>', argsRequired: true, description: 'Add a working directory' }),
  e({ id: 'claude:slash:exit', command: '/exit', name: 'exit', description: 'Exit the CLI', flags: ['endsSession'] }),
  e({ id: 'claude:slash:status', command: '/status', name: 'status', description: 'Show the version and account', flags: ['runsWhileBusy', 'opensMenu'] }),
  e({ id: 'claude:slash:output-style', command: '/output-style', name: 'output-style', description: 'Switch the output style', requires: '2.1.269' }),
  e({ id: 'claude:skill:deploy', kind: 'skill', command: '/deploy', name: 'deploy', description: 'Deploy the app', source: 'project', origin: '.claude/skills/deploy' }),
  e({ id: 'claude:cli:claude-p-query', kind: 'cli', command: 'claude -p', name: 'claude -p "query"', inputArgs: '"query"', argsRequired: true, description: 'Query via SDK, then exit', example: 'claude -p "explain this function"' }),
  e({ id: 'claude:cli:piped', kind: 'cli', command: 'cat file | claude -p "query"', name: 'cat file | claude -p "query"', description: 'Process piped content', example: 'cat logs.txt | claude -p "explain"' }),
  e({ id: 'claude:flag:model', kind: 'flag', command: '--model', name: '--model', description: 'Sets the model for the current session' }),
  e({ id: 'claude:shortcut:ctrl-c', kind: 'shortcut', command: 'Ctrl+C', name: 'Ctrl+C', description: 'Interrupt, or clear input', group: 'General controls' }),
];
const plain = (v) => JSON.parse(JSON.stringify(v));
const commands = (list) => list.map((x) => x.command);

test('tabs: only those with entries, in order; a plain terminal starts on the CLI tab', () => {
  assert.deepEqual(M.tabsFor({ entries: ENTRIES, target: 'agent' }).map((t) => t.id), ['commands', 'custom', 'cli', 'shortcuts']);
  assert.deepEqual(M.tabsFor({ entries: ENTRIES, target: 'terminal' }).map((t) => t.id), ['cli', 'commands', 'custom', 'shortcuts']);
  assert.deepEqual(M.tabsFor({ entries: [], target: 'agent' }), []);
  assert.deepEqual(M.tabsFor(null), []);
  assert.equal(M.tabOf(ENTRIES[9]), 'cli');
  assert.equal(M.tabOf(ENTRIES[6]), 'custom');
});

test('search ranks a name that is the query, then names that start with it, then words, then descriptions', () => {
  assert.deepEqual(commands(M.searchCommands(ENTRIES, 'comp')), ['/compact']);
  assert.equal(M.searchCommands(ENTRIES, '/clear')[0].command, '/clear');
  // An alias finds its command.
  assert.equal(M.searchCommands(ENTRIES, 'reset')[0].command, '/clear');
  // A word of a name: "dir" in add-dir.
  assert.equal(M.searchCommands(ENTRIES, 'dir')[0].command, '/add-dir');
  // The description, every word of the query.
  assert.deepEqual(commands(M.searchCommands(ENTRIES, 'summarizing conversation')), ['/compact']);
  assert.equal(M.searchCommands(ENTRIES, '--model')[0].command, '--model');
  assert.deepEqual(M.searchCommands(ENTRIES, 'zzz'), []);
  // No query: the tab's entries in their order.
  assert.deepEqual(commands(M.searchCommands(ENTRIES, '', { tab: 'cli' })), ['claude -p', 'cat file | claude -p "query"', '--model']);
  assert.equal(M.searchCommands(ENTRIES, '', { limit: 2 }).length, 2);
  // Grouped by tab in the order shown: in a shell the CLI's commands come first.
  const shell = M.tabsFor({ entries: ENTRIES, target: 'terminal' }).map((t) => t.id);
  assert.deepEqual(commands(M.searchCommands(ENTRIES, 'model', { tabs: shell })), ['--model']);
  assert.deepEqual(commands(M.searchCommands(ENTRIES, 'c', { tabs: shell })).slice(0, 2), ['claude -p', 'cat file | claude -p "query"']);
  assert.equal(M.searchCommands(ENTRIES, 'c')[0].command, '/clear');
});

test('a pick types a prompt command and a space in a session, and copies what the prompt cannot take', () => {
  assert.deepEqual(plain(M.insertionFor(ENTRIES[1], { target: 'agent' })), { mode: 'insert', text: '/compact ' });
  assert.deepEqual(plain(M.insertionFor(ENTRIES[6], { target: 'agent' })), { mode: 'insert', text: '/deploy ' });
  // The CLI's own commands and flags in its session would be a chat message.
  assert.deepEqual(plain(M.insertionFor(ENTRIES[7], { target: 'agent' })), { mode: 'copy', text: 'claude -p "explain this function"' });
  assert.deepEqual(plain(M.insertionFor(ENTRIES[9], { target: 'agent' })), { mode: 'copy', text: '--model' });
  // In a shell they are typed; a slash command is copied.
  assert.deepEqual(plain(M.insertionFor(ENTRIES[7], { target: 'terminal' })), { mode: 'insert', text: 'claude -p ' });
  assert.deepEqual(plain(M.insertionFor(ENTRIES[9], { target: 'terminal' })), { mode: 'insert', text: '--model ' });
  assert.deepEqual(plain(M.insertionFor(ENTRIES[8], { target: 'terminal' })), { mode: 'copy', text: 'cat logs.txt | claude -p "explain"' });
  assert.equal(M.insertionFor(ENTRIES[1], { target: 'terminal' }).mode, 'copy');
  // A shortcut is a key to press.
  assert.equal(M.insertionFor(ENTRIES[10], { target: 'agent' }), null);
  // Nothing in an entry can press a key.
  assert.equal(M.insertionFor(e({ command: '/x\r\x1b[2J', name: 'x' })).text, '/x  [2J ');
});

test('Run: a prompt command with no required argument, in an idle session', () => {
  assert.deepEqual(plain(M.canRun(ENTRIES[1], { target: 'agent', state: 'idle' })), { ok: true });
  assert.equal(M.canRun(ENTRIES[2], { target: 'agent', state: 'idle' }).ok, false);
  assert.match(M.canRun(ENTRIES[2], { target: 'agent', state: 'idle' }).reason, /<path>/);
  assert.equal(M.canRun(ENTRIES[1], { target: 'agent', state: 'busy' }).ok, false);
  assert.equal(M.canRun(ENTRIES[1], { target: 'agent', state: 'subagent' }).ok, false);
  assert.equal(M.canRun(ENTRIES[1], { target: 'agent', state: 'attention' }).ok, false);
  assert.equal(M.canRun(ENTRIES[1], { target: 'terminal', state: 'idle' }).ok, false);
  assert.equal(M.canRun(ENTRIES[9], { target: 'agent', state: 'idle' }).ok, false);
});

test('Run asks first for what ends the session, replaces the conversation, signs in or out or writes files', () => {
  assert.match(M.needsConfirm(ENTRIES[3]), /^Run \/exit\? It ends the session/);
  assert.match(M.needsConfirm(ENTRIES[0]), /replaces the conversation/);
  assert.match(M.needsConfirm(e({ command: '/logout', flags: ['account'] })), /signs you in or out/);
  assert.match(M.needsConfirm(e({ command: '/init', flags: ['writesFiles'] })), /writes files/);
  assert.equal(M.needsConfirm(ENTRIES[1]), null);
  assert.equal(M.needsConfirm(ENTRIES[4]), null);
});

test('what to say about the session for a pick', () => {
  assert.match(M.stateNotice(ENTRIES[1], 'attention'), /waiting for your answer/);
  assert.equal(M.stateNotice(ENTRIES[1], 'busy'), 'Runs after the current turn.');
  assert.equal(M.stateNotice(ENTRIES[4], 'busy'), 'Runs at once, while the CLI works.');
  assert.equal(M.stateNotice(ENTRIES[1], 'idle'), null);
  assert.equal(M.stateNotice(ENTRIES[9], 'busy'), null);
});

test('a picked command goes in front of a chat draft, replacing one already there', () => {
  assert.equal(M.applyToDraft('', '/compact '), '/compact ');
  assert.equal(M.applyToDraft('keep the tests', '/compact '), '/compact keep the tests');
  assert.equal(M.applyToDraft('/clear old name', '/compact '), '/compact old name');
  assert.equal(M.applyToDraft('$deploy now', '/compact '), '/compact now');
  assert.equal(M.applyToDraft('/clear', '/compact '), '/compact ');
});

test('typing a command at the start of a prompt suggests the ones that complete it', () => {
  const claude = { target: 'agent', entries: ENTRIES };
  assert.deepEqual(plain(M.typedCommand('/comp', claude)), { sigil: '/', query: 'comp' });
  assert.equal(M.typedCommand('/compact now', claude), null);
  assert.equal(M.typedCommand('please /compact', claude), null);
  // @ is a file mention for Claude Code; $ is nothing.
  assert.equal(M.typedCommand('@src', claude), null);
  assert.equal(M.typedCommand('$x', claude), null);
  assert.equal(M.typedCommand('/x', { ...claude, target: 'terminal' }), null);
  // Without the catalog yet, any of the three may be one.
  assert.deepEqual(plain(M.typedCommand('@', null)), { sigil: '@', query: '' });
  assert.deepEqual(commands(M.suggestionsFor(claude, '/comp')), ['/compact']);
  assert.deepEqual(commands(M.suggestionsFor(claude, '/res')), ['/clear']);
  // A description match is no completion.
  assert.deepEqual(commands(M.suggestionsFor(claude, '/summarizing')), []);
  assert.deepEqual(commands(M.suggestionsFor(claude, '/', { limit: 3 })), ['/clear', '/compact', '/add-dir']);
  assert.ok(commands(M.suggestionsFor(claude, '/dep')).includes('/deploy'));
  const codex = { target: 'agent', entries: [
    { id: 'codex:slash:model', cli: 'codex', kind: 'slash', command: '/model', name: 'model', description: 'm', source: 'cli-source' },
    { id: 'codex:skill:user:deploy', cli: 'codex', kind: 'skill', command: '$deploy', name: 'deploy', description: 'd', source: 'user' },
  ] };
  assert.deepEqual(commands(M.suggestionsFor(codex, '$de')), ['$deploy']);
  assert.deepEqual(commands(M.suggestionsFor(codex, '/')), ['/model']);
  assert.deepEqual(commands(M.searchCommands(codex.entries, '$dep')), ['$deploy']);
});

test('in a shell a pick goes at the end of the line', () => {
  assert.equal(M.appendToLine('', 'claude -p '), 'claude -p ');
  assert.equal(M.appendToLine('claude', '--model '), 'claude --model ');
  assert.equal(M.appendToLine('claude ', '--model '), 'claude --model ');
});

test('versions and the badges they give', () => {
  assert.equal(M.versionAtLeast('2.1.331', '2.1.269'), true);
  assert.equal(M.versionAtLeast('2.1.200', '2.1.269'), false);
  assert.equal(M.versionAtLeast('2.10.0', '2.9.9'), true);
  assert.equal(M.versionAtLeast('2.1.269', '2.1.269'), true);
  assert.equal(M.versionAtLeast(null, '2.1.269'), null);
  assert.equal(M.availability(ENTRIES[5], '2.1.200'), 'newer');
  assert.equal(M.availability(ENTRIES[5], '2.1.300'), 'ok');
  assert.equal(M.availability(ENTRIES[5], undefined), 'unknown');
  assert.equal(M.availability(ENTRIES[1], '1.0.0'), 'ok');
  assert.deepEqual(plain(M.badgesOf(ENTRIES[5], '2.1.200')), [{ id: 'newer', label: 'Needs v2.1.269' }]);
  assert.deepEqual(plain(M.badgesOf(ENTRIES[5], '2.1.300')), [{ id: 'requires', label: 'Since v2.1.269' }]);
  assert.deepEqual(plain(M.badgesOf(ENTRIES[6])), [{ id: 'source', label: 'Project: .claude/skills/deploy' }]);
  assert.deepEqual(plain(M.badgesOf(ENTRIES[3])).map((b) => b.label), ['Ends the session']);
});

test('safe names and labels', () => {
  assert.equal(M.safeName('my-plugin:deploy'), 'my-plugin:deploy');
  assert.equal(M.safeName('frontend/component'), 'frontend/component');
  assert.equal(M.safeName('bad name'), null);
  assert.equal(M.safeName('x\r'), null);
  assert.equal(M.safeName('-flag'), null);
  assert.equal(M.safeName(3), null);
  assert.equal(M.cliLabel('claude'), 'Claude Code');
  assert.equal(M.cliLabel('opencode'), 'OpenCode');
});
