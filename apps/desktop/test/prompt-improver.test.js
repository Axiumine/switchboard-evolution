// The prompt improver in the main process: the command line of each CLI, how
// its answer is read, the run through the user's shell, one run per session,
// cancel, and nothing left for the session lists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../prompt-improver-runners');
const M = require('../public/prompt-improver-model');
const { createPromptImprover, runThroughShell, turnsFromEntries } = require('../prompt-improver');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-improver-'));

test('runners: each CLI headless, signed in as the user, nothing persisted, prompt on stdin', () => {
  const c = R.claudeSpec({ model: 'sonnet' });
  assert.equal(c.binary, 'claude');
  for (const flag of ['-p', '--safe-mode', '--no-session-persistence', '--max-turns']) assert.ok(c.args.includes(flag), flag);
  assert.equal(c.args.includes('--bare'), false, '--bare would skip the OAuth sign-in');
  assert.equal(c.args[c.args.indexOf('--tools') + 1], '', 'no tools');
  assert.deepEqual(c.args.slice(-2), ['--model', 'sonnet']);
  assert.equal(R.claudeSpec({}).args.includes('--model'), false);

  const x = R.codexSpec({ outFile: '/tmp/out.txt', model: 'gpt-5' });
  assert.deepEqual(x.args, ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-o', '/tmp/out.txt', '-m', 'gpt-5', '-']);
  assert.match(x.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, /^switchboard_/, 'codex.js ignores runs tagged switchboard_');

  const o = R.opencodeSpec({ sessionId: 'ses_abc', model: 'opencode/big-pickle' });
  assert.deepEqual(o.args, ['run', '--session', 'ses_abc', '--format', 'json', '-m', 'opencode/big-pickle']);
  assert.deepEqual(R.opencodeCleanupSpec('ses_abc').args, ['session', 'delete', 'ses_abc']);
});

test('answers: Claude result JSON, Codex -o file, OpenCode text events; errors from what the CLI says', () => {
  const ok = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '<improved_prompt>x</improved_prompt>' });
  assert.deepEqual(R.parseClaude({ stdout: `Welcome from .zshrc\n${ok}\n`, stderr: '', code: 0 }), { text: '<improved_prompt>x</improved_prompt>' });
  const bad = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' });
  assert.deepEqual(R.parseClaude({ stdout: bad, code: 1 }), { error: 'Credit balance is too low' });
  assert.deepEqual(R.parseClaude({ stdout: '', stderr: 'Error: Invalid API key · Please run /login', code: 1 }), { error: 'Invalid API key · Please run /login' });

  assert.deepEqual(R.parseCodex({ fileText: 'answer\n', stderr: '', code: 0 }), { text: 'answer\n' });
  const codexErr = '\u001b[2m2026\u001b[0m \u001b[31mERROR\u001b[0m codex_login: x\n\u001b[1m\u001b[31mERROR:\u001b[0m\u001b[0m provider auth command `sh` produced an empty token\n';
  assert.deepEqual(R.parseCodex({ fileText: '', stderr: codexErr, code: 1 }), { error: 'provider auth command `sh` produced an empty token' });

  const events = [
    { type: 'step_start', sessionID: 's', part: {} },
    { type: 'text', sessionID: 's', part: { type: 'text', text: '<improved_prompt>a' } },
    { type: 'text', sessionID: 's', part: { type: 'text', text: 'b</improved_prompt>' } },
    { type: 'step_finish', sessionID: 's', part: {} },
  ].map((e) => JSON.stringify(e)).join('\n');
  assert.deepEqual(R.parseOpencode({ stdout: events, code: 0 }), { text: '<improved_prompt>a\nb</improved_prompt>' });
  assert.deepEqual(R.parseOpencode({ stdout: JSON.stringify({ type: 'error', error: { name: 'ProviderAuthError', data: { message: 'No key' } } }), code: 1 }), { error: 'No key' });

  assert.match(R.failureMessage('codex', { code: 127, stderr: 'zsh: command not found: codex' }), /Codex was not found in your login shell/);
  assert.match(R.failureMessage('claude', { timedOut: true, timeoutSec: 90 }), /longer than 90 s/);
  assert.equal(R.failureMessage('claude', { code: 1, stderr: 'boom' }), null);
});

test('turns: user and assistant text only, a run of one role as one turn, the last N', () => {
  const entries = [
    { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'user', message: { role: 'user', content: 'Add a login page' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'Reading the router.' }, { type: 'tool_use', name: 'Read' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file text' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done: /login.' }] } },
    { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: 'subagent talk' } },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
    { type: 'user', message: { role: 'user', content: 'Now the tests' } },
  ];
  assert.deepEqual(turnsFromEntries(entries, 10), [
    { role: 'user', text: 'Add a login page' },
    { role: 'assistant', text: 'Reading the router.\n\nDone: /login.' },
    { role: 'user', text: 'Now the tests' },
  ]);
  assert.deepEqual(turnsFromEntries(entries, 1), [{ role: 'user', text: 'Now the tests' }]);
  assert.deepEqual(turnsFromEntries(entries, 0), []);
});

function fakeDeps(over = {}) {
  const calls = [];
  const hidden = [];
  const settings = { engine: 'session', context: 'recent', recentTurns: 4, ...over.settings };
  const deps = {
    getSettings: () => settings,
    getContext: async () => ({
      runtime: 'claude', isPlainTerminal: false, projectPath: '/work/demo', project: 'demo', version: '2.1.332',
      entries: [{ kind: 'skill', command: '/tdd', name: 'tdd', description: 'Test first.' }],
      readEntries: async () => [
        { type: 'user', message: { content: 'we use vitest' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'noted' }] } },
      ],
      launch: { shell: '/bin/zsh', extraArgs: [], envFiles: ['/work/demo/local.env.sh'] },
      env: { PATH: '/usr/bin' },
      ...over.context,
    }),
    run: async (spec) => {
      calls.push(spec);
      if (over.run) return over.run(spec, calls);
      return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', result: '<improved_prompt>Better prompt</improved_prompt>' }), stderr: '' };
    },
    newOpencodeId: () => 'ses_helper',
    hideSession: (id) => hidden.push(id),
    tmpDir: over.tmpDir || os.tmpdir(),
    log: { warn() {}, error() {} },
  };
  return { deps, calls, hidden };
}

test('improve: Claude for a Claude session, the input on stdin through the session\'s shell and env files', async () => {
  const { deps, calls } = fakeDeps();
  const improver = createPromptImprover(deps);
  const res = await improver.improve('s1', 'fix login');
  assert.equal(res.ok, true);
  assert.equal(res.text, 'Better prompt');
  assert.equal(res.engine, 'claude');
  assert.equal(res.mode, 'recent');
  const spec = calls[0];
  assert.equal(spec.binary, 'claude');
  assert.equal(spec.cwd, '/work/demo');
  assert.deepEqual(spec.launch.envFiles, ['/work/demo/local.env.sh']);
  assert.equal(spec.env.NO_COLOR, '1');
  assert.equal(spec.env.PATH, '/usr/bin');
  assert.match(spec.stdin, /<user_prompt>\nfix login\n<\/user_prompt>/);
  assert.match(spec.stdin, /\[user\]\nwe use vitest/);
  assert.match(spec.stdin, /- \/tdd — Test first\./);
  assert.equal(spec.timeoutMs, M.DEFAULT_SETTINGS.timeoutSec * 1000);
});

test('improve: the none mode leaves the conversation out; a chosen engine wins over the session\'s CLI', async () => {
  const dir = tmp();
  const { deps, calls } = fakeDeps({
    settings: { engine: 'codex', models: { codex: 'gpt-5' } },
    tmpDir: dir,
    run: (spec) => {
      fs.writeFileSync(spec.args[spec.args.indexOf('-o') + 1], '<improved_prompt>From Codex</improved_prompt>');
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const res = await createPromptImprover(deps).improve('s1', 'fix login', { mode: 'none' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.text, 'From Codex');
  assert.equal(res.engine, 'codex');
  assert.equal(calls[0].stdin.includes('we use vitest'), false);
  assert.match(calls[0].stdin, /<session cli="Claude Code"/, 'the capabilities are those of the session\'s CLI');
  assert.ok(calls[0].args.includes('gpt-5'));
  assert.deepEqual(fs.readdirSync(dir), [], 'the -o file is removed');
});

test('improve: OpenCode\'s helper session is hidden before the run and deleted after', async () => {
  const { deps, calls, hidden } = fakeDeps({
    settings: { engine: 'opencode' },
    run: (spec) => (spec.args[0] === 'run'
      ? { code: 0, stdout: JSON.stringify({ type: 'text', part: { text: '<improved_prompt>From OpenCode</improved_prompt>' } }), stderr: '' }
      : { code: 0, stdout: '', stderr: '' }),
  });
  const res = await createPromptImprover(deps).improve('s1', 'fix login');
  assert.equal(res.text, 'From OpenCode');
  assert.deepEqual(hidden, ['ses_helper']);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.map((c) => c.args.slice(0, 3)), [['run', '--session', 'ses_helper'], ['session', 'delete', 'ses_helper']]);
});

test('improve: errors say what the CLI said; nothing for a plain terminal, an empty prompt, or with the improver off', async () => {
  const fail = fakeDeps({ run: () => ({ code: 1, stdout: '', stderr: 'Error: Invalid API key · Please run /login' }) });
  assert.deepEqual(await createPromptImprover(fail.deps).improve('s1', 'x'), { ok: false, error: 'Claude Code: Invalid API key · Please run /login' });

  const empty = fakeDeps({ run: () => ({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', result: '<improved_prompt> </improved_prompt>' }) }) });
  assert.match((await createPromptImprover(empty.deps).improve('s1', 'x')).error, /gave back no prompt/);

  const shell = fakeDeps({ context: { isPlainTerminal: true } });
  assert.match((await createPromptImprover(shell.deps).improve('s1', 'x')).error, /Only a CLI session/);
  assert.equal(shell.calls.length, 0);

  assert.match((await createPromptImprover(fakeDeps().deps).improve('s1', '  ')).error, /no prompt/);
  const off = fakeDeps({ settings: { enabled: false } });
  assert.match((await createPromptImprover(off.deps).improve('s1', 'x')).error, /off in Settings/);
});

test('improve: one run per session, and cancel stops it', async () => {
  let killed = false;
  let release;
  const { deps } = fakeDeps({
    run: (spec) => new Promise((resolve) => {
      spec.onKill(() => { killed = true; resolve({ code: -1, stdout: '', stderr: '', cancelled: true }); });
      release = () => resolve({ code: 0, stdout: '', stderr: '' });
    }),
  });
  const improver = createPromptImprover(deps);
  const first = improver.improve('s1', 'x');
  await new Promise((r) => setImmediate(r));
  assert.equal(improver.isRunning('s1'), true);
  assert.match((await improver.improve('s1', 'y')).error, /already being improved/);
  assert.equal(improver.cancel('s1'), true);
  assert.deepEqual(await first, { ok: false, cancelled: true, error: 'Cancelled.' });
  assert.equal(killed, true);
  assert.equal(improver.isRunning('s1'), false);
  assert.equal(improver.cancel('s1'), false);
  assert.equal(typeof release, 'function');
});

// A real shell and a fake CLI: quoting, stdin, the env files, timeout.
test('runThroughShell: the binary gets its args and stdin through a login shell, env files first', { skip: process.platform === 'win32' }, async () => {
  const dir = tmp();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'fakecli'), '#!/bin/sh\nprintf "args:"; for a in "$@"; do printf "[%s]" "$a"; done; printf "\\nenv:%s\\nstdin:" "$FROM_ENV_FILE"; cat\n', { mode: 0o755 });
  const envFile = path.join(dir, 'local.env.sh');
  fs.writeFileSync(envFile, 'FROM_ENV_FILE=yes\n');
  const env = { HOME: dir, PATH: `${bin}:/usr/bin:/bin`, ENV: '' };
  const res = await runThroughShell({
    binary: 'fakecli', args: ['-p', '', "it's \"quoted\" $HOME"], stdin: 'line 1\nline 2', cwd: dir, env,
    launch: { shell: '/bin/bash', extraArgs: [], envFiles: [envFile] }, timeoutMs: 10000,
  });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /args:\[-p\]\[\]\[it's "quoted" \$HOME\]\nenv:yes\nstdin:line 1\nline 2$/);
});

test('runThroughShell: a run past its time is stopped', { skip: process.platform === 'win32' }, async () => {
  const dir = tmp();
  const res = await runThroughShell({
    binary: 'sleep', args: ['30'], stdin: '', cwd: dir, env: { HOME: dir, PATH: '/usr/bin:/bin' },
    launch: { shell: '/bin/bash', extraArgs: [], envFiles: [] }, timeoutMs: 300,
  });
  assert.equal(res.timedOut, true);
});
