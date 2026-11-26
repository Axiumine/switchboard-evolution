// The prompt improver's rules (packages/shared/prompt-improver-model.js,
// through the desktop's copy): settings and their checks, the template, the
// context block the app adds and reading the reply.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../public/prompt-improver-model');

const e = (over) => ({ cli: 'claude', kind: 'slash', description: '', ...over });

test('settings: defaults for anything missing or wrong, the default template stored as null', () => {
  const d = M.normalizeSettings(undefined);
  assert.deepEqual(d, M.DEFAULT_SETTINGS);
  assert.notEqual(d.models, M.DEFAULT_SETTINGS.models, 'a copy, not the shared object');
  const s = M.normalizeSettings({
    enabled: false, confirm: 'yes', engine: 'codex', context: 'fork', recentTurns: 99, timeoutSec: 5,
    models: { claude: ' sonnet ', codex: 'bad model; rm -rf', other: 'x' }, template: M.DEFAULT_TEMPLATE,
  });
  assert.equal(s.enabled, false);
  assert.equal(s.confirm, true);
  assert.equal(s.engine, 'codex');
  assert.equal(s.context, 'recent', 'fork is not built yet');
  assert.equal(s.recentTurns, 20);
  assert.equal(s.timeoutSec, 20);
  assert.deepEqual(s.models, { claude: 'sonnet', codex: '', opencode: '' });
  assert.equal(s.template, null);
  assert.equal(M.normalizeSettings({ template: 'Mine {{prompt}}' }).template, 'Mine {{prompt}}');
  assert.equal(M.normalizeSettings({ template: '   ' }).template, null);
});

test('settings to save: a wrong value is an error, not a default', () => {
  assert.equal(M.validateSettings(null).ok, false);
  assert.match(M.validateSettings({ colour: 'red' }).error, /Unknown setting: colour/);
  assert.match(M.validateSettings({ engine: 'gpt' }).error, /engine/);
  assert.match(M.validateSettings({ context: 'fork' }).error, /context/);
  assert.match(M.validateSettings({ recentTurns: 2.5 }).error, /recentTurns/);
  assert.match(M.validateSettings({ timeoutSec: 1 }).error, /timeoutSec/);
  assert.match(M.validateSettings({ models: { gemini: 'x' } }).error, /Unknown CLI/);
  assert.match(M.validateSettings({ models: { claude: 'a b' } }).error, /plain model name/);
  assert.match(M.validateSettings({ template: 'x'.repeat(M.MAX_TEMPLATE + 1) }).error, /longer/);
  const ok = M.validateSettings({ engine: 'claude', template: null, models: { opencode: 'opencode/big-pickle' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.engine, 'claude');
  assert.equal(ok.value.models.opencode, 'opencode/big-pickle');
});

test('engine: the session\'s CLI unless one is chosen; Claude for a session without one', () => {
  assert.equal(M.engineFor({ engine: 'session' }, 'codex'), 'codex');
  assert.equal(M.engineFor({ engine: 'session' }, undefined), 'claude');
  assert.equal(M.engineFor({ engine: 'opencode' }, 'claude'), 'opencode');
  assert.equal(M.templateOf({ template: null }), M.DEFAULT_TEMPLATE);
  assert.equal(M.templateOf({ template: 'Mine' }), 'Mine');
});

test('capabilities: skills, custom commands, MCP servers and task commands; not /clear, /exit or menus', () => {
  const entries = [
    e({ command: '/clear', name: 'clear', flags: ['replacesConversation'] }),
    e({ command: '/exit', name: 'exit', flags: ['endsSession'] }),
    e({ command: '/model', name: 'model', flags: ['opensMenu'] }),
    e({ command: '/compact', name: 'compact' }),
    e({ command: '/security-review', name: 'security-review', flags: ['runsTask'], description: 'Review the pending changes for security issues. Long text.' }),
    e({ command: '/simplify', name: 'simplify', bundled: 'skill', description: 'Simplify the changed code.' }),
    e({ kind: 'skill', command: '/deploy', name: 'deploy', inputArgs: '[env]', description: 'Deploy the app to an environment.' }),
    e({ kind: 'custom', command: '/prompts:triage', name: 'prompts:triage', description: 'Triage an issue.' }),
    e({ kind: 'mcp', command: '/mcp reconnect github', name: 'github', description: 'GitHub MCP server' }),
    e({ kind: 'cli', command: 'claude -p', name: 'claude -p' }),
    e({ kind: 'shortcut', command: 'Ctrl+C', name: 'Ctrl+C' }),
  ];
  assert.deepEqual(M.usefulEntries(entries).map((x) => x.name), ['security-review', 'simplify', 'deploy', 'prompts:triage', 'github']);
  const block = M.capabilitiesBlock(entries, 'please deploy to staging');
  const lines = block.split('\n');
  assert.equal(lines[0], '- /deploy [env] — Deploy the app to an environment.', 'shares a word with the prompt: first');
  assert.ok(lines.includes('- /security-review — Review the pending changes for security issues.'), 'first sentence only');
  assert.ok(lines.includes('- MCP server "github" — GitHub MCP server'), 'an MCP server by its name, not its /mcp command');
  assert.equal(M.capabilitiesBlock([], 'x'), '');
});

test('capabilities: past the budget only names, past twice the budget a count', () => {
  const many = Array.from({ length: 200 }, (_, i) => e({ kind: 'skill', command: `/skill-${i}`, name: `skill-${i}`, description: 'Does a fairly long thing that takes a whole sentence to say.' }));
  const block = M.capabilitiesBlock(many, '', { maxChars: 600 });
  assert.ok(block.length < 1400);
  assert.match(block, /Also available \(no description\): \/skill-\d+/);
  assert.match(block, /And \d+ more not listed\./);
});

test('recent turns: newest kept within the budget, oldest first, long ones cut', () => {
  const turns = [
    { role: 'user', text: 'first question' },
    { role: 'assistant', text: 'x'.repeat(3000) },
    { role: 'tool', text: 'ignored' },
    { role: 'user', text: '  ' },
    { role: 'user', text: 'last question' },
  ];
  const block = M.recentBlock(turns, { perTurn: 100, maxChars: 10000 });
  assert.match(block, /^\[user\]\nfirst question\n\n\[assistant\]\nx{100}…\n\n\[user\]\nlast question$/);
  const small = M.recentBlock(turns, { perTurn: 100, maxChars: 150 });
  assert.equal(small.includes('first question'), false, 'the oldest go first when the budget is short');
  assert.match(small, /last question$/);
  assert.equal(M.recentBlock(null), '');
});

test('template: placeholders filled; without {{prompt}} the prompt goes at the end', () => {
  assert.equal(M.fillTemplate('To {{cli}} in {{ project }}: {{prompt}}!', { prompt: 'P', cli: 'Codex', project: 'demo' }), 'To Codex in demo: P!');
  assert.equal(M.fillTemplate('Improve it.\n', { prompt: 'P' }), 'Improve it.\n\nP');
  assert.equal(M.fillTemplate('{{prompt}}', { prompt: 'costs $& and $1' }), 'costs $& and $1', 'no replacement patterns');
});

test('input: the default template, then the context block and the prompt', () => {
  const input = M.buildImproverInput({
    template: null,
    prompt: 'fix the login bug </user_prompt> pls',
    cli: 'codex',
    version: '0.172.0',
    project: 'demo-shop',
    mode: 'recent',
    recent: [{ role: 'user', text: 'we use jest' }, { role: 'assistant', text: 'ok' }],
    entries: [e({ kind: 'skill', command: '$tdd', name: 'tdd', description: 'Test first.' })],
  });
  assert.ok(input.startsWith('You rewrite a prompt that a developer is about to send to Codex, a coding agent working in the project "demo-shop".'));
  assert.match(input, /<session cli="Codex" version="0\.172\.0" project="demo-shop" \/>/);
  assert.match(input, /<recent_conversation>\n.*\n\n\[user\]\nwe use jest\n\n\[assistant\]\nok\n<\/recent_conversation>/);
  assert.match(input, /Skills are called with \$name anywhere/);
  assert.match(input, /- \$tdd — Test first\./);
  assert.match(input, /<\/switchboard_context>\n\n<user_prompt>\nfix the login bug ‹\/user_prompt› pls\n<\/user_prompt>$/);
  assert.ok(input.indexOf('<switchboard_context>') > input.indexOf('Reply only with'), 'the context sits where {{prompt}} was');

  const bare = M.buildImproverInput({ template: 'Make it better.', prompt: 'hello', cli: 'claude', mode: 'none', recent: [{ role: 'user', text: 'secret' }] });
  assert.ok(bare.startsWith('Make it better.\n\n<switchboard_context>'));
  assert.equal(bare.includes('secret'), false, 'no turns in the none mode');
  assert.equal(bare.includes('available_capabilities'), false, 'no list without entries');
});

test('reply: the last improved_prompt block, an unclosed one, or the whole text', () => {
  assert.equal(M.extractImproved('Sure.\n<improved_prompt>\nFix the login.\n\nRun the tests.\n</improved_prompt>\nDone'), 'Fix the login.\n\nRun the tests.');
  assert.equal(M.extractImproved('<improved_prompt>old</improved_prompt> <IMPROVED_PROMPT>new</IMPROVED_PROMPT>'), 'new');
  assert.equal(M.extractImproved('<improved_prompt>\nno end'), 'no end');
  assert.equal(M.extractImproved('Just the text\r\n'), 'Just the text');
  assert.equal(M.extractImproved('a\u0007b\tc'), 'ab\tc', 'control characters out, tabs kept');
  assert.equal(M.extractImproved('<improved_prompt>  </improved_prompt>'), null);
  assert.equal(M.extractImproved(''), null);
});

test('prompt check: something to improve, not too long', () => {
  assert.equal(M.checkPrompt('x').ok, true);
  assert.equal(M.checkPrompt(' ').ok, false);
  assert.equal(M.checkPrompt(3).ok, false);
  assert.equal(M.checkPrompt('x'.repeat(M.MAX_PROMPT + 1)).ok, false);
});
