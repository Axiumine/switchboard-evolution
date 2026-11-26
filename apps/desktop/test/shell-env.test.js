const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureWrappers, terminalEnvLaunch, WRAPPERS } = require('../shell-env');
const { shellArgs } = require('../shell-profiles');

const have = (shell) => fs.existsSync(shell);
const FILES = ['/p/local.env.sh', '/repos/app/local.env.sh'];

test('terminalEnvLaunch: zsh through ZDOTDIR, bash through --rcfile without -l, sh through ENV', () => {
  const env = { HOME: '/home/dev', PATH: '/usr/bin' };
  const zsh = terminalEnvLaunch('/bin/zsh', FILES, { wrapperDir: '/data/shell-env', env, args: ['-l', '-i'], windows: false });
  assert.deepEqual(zsh.args, ['-l', '-i']);
  assert.equal(zsh.env.ZDOTDIR, path.join('/data/shell-env', 'zsh'));
  assert.equal(zsh.env.SWITCHBOARD_USER_ZDOTDIR, '');
  assert.equal(zsh.env.SWITCHBOARD_ENV_FILES, FILES.join('\n'));
  assert.equal(zsh.env.PATH, '/usr/bin', 'the rest of the environment is kept');
  assert.deepEqual(zsh.files, FILES);
  assert.equal(terminalEnvLaunch('/bin/zsh', FILES, { wrapperDir: '/w', env: { ZDOTDIR: '/home/dev/.config/zsh' }, args: [] }).env.SWITCHBOARD_USER_ZDOTDIR, '/home/dev/.config/zsh');

  const bash = terminalEnvLaunch('/bin/bash', FILES, { wrapperDir: '/data/shell-env', env, args: ['-l', '-i'], windows: false });
  assert.deepEqual(bash.args, ['--rcfile', path.join('/data/shell-env', 'bash', 'bashrc'), '-i']);
  assert.equal(bash.env.SWITCHBOARD_ENV_FILES, FILES.join('\n'));
  assert.equal(bash.env.ZDOTDIR, undefined);

  const sh = terminalEnvLaunch('/bin/sh', FILES, { wrapperDir: '/data/shell-env', env: { ...env, ENV: '/home/dev/.shrc' }, args: ['-l', '-i'], windows: false });
  assert.deepEqual(sh.args, ['-l', '-i']);
  assert.equal(sh.env.ENV, path.join('/data/shell-env', 'sh', 'env'));
  assert.equal(sh.env.SWITCHBOARD_USER_ENV, '/home/dev/.shrc');

  const gitBash = terminalEnvLaunch('C:\\Program Files\\Git\\bin\\bash.exe', ['C:\\p\\local.env.sh'], { wrapperDir: 'C:\\data\\shell-env', env, args: ['-l', '-i'], windows: true });
  assert.equal(gitBash.env.SWITCHBOARD_ENV_FILES, 'C:/p/local.env.sh', 'Git Bash gets forward slashes');
  assert.ok(!gitBash.args[1].includes('\\'));
});

test('terminalEnvLaunch leaves the terminal alone without files, without a POSIX shell, and drops a path with a line break', () => {
  const env = { HOME: '/home/dev' };
  for (const [shell, files] of [['/bin/zsh', []], ['/bin/zsh', undefined], ['/opt/homebrew/bin/fish', FILES], ['powershell.exe', FILES], ['wsl.exe', FILES]]) {
    const launch = terminalEnvLaunch(shell, files, { wrapperDir: '/w', env, args: ['-l', '-i'] });
    assert.deepEqual(launch, { args: ['-l', '-i'], env, files: [] }, `${shell} ${files}`);
  }
  const odd = terminalEnvLaunch('/bin/zsh', ['/p/local.env.sh', '/bad\npath/local.env.sh'], { wrapperDir: '/w', env, args: [], windows: false });
  assert.equal(odd.env.SWITCHBOARD_ENV_FILES, '/p/local.env.sh');
});

test('ensureWrappers writes the startup files once and puts back one that changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-shell-env-'));
  try {
    ensureWrappers(dir);
    for (const rel of Object.keys(WRAPPERS)) assert.equal(fs.readFileSync(path.join(dir, rel), 'utf8'), WRAPPERS[rel], rel);
    fs.writeFileSync(path.join(dir, 'zsh', '.zshrc'), 'echo edited\n');
    const before = fs.statSync(path.join(dir, 'bash', 'bashrc')).mtimeMs;
    ensureWrappers(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'zsh', '.zshrc'), 'utf8'), WRAPPERS['zsh/.zshrc']);
    assert.equal(fs.statSync(path.join(dir, 'bash', 'bashrc')).mtimeMs, before, 'an up-to-date file is not rewritten');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A terminal as main.js starts it: an interactive login shell with no command,
 * a HOME of its own with startup files that leave a trace and set SB_VAR, a
 * project file and a folder file. The commands come on stdin, as a user would
 * type them; each answer is a `name=value` line. `startup(home)` maps paths
 * relative to HOME to their text; `userEnv(home)` is the user's environment.
 */
function runTerminal(shell, { startup, userEnv = () => ({}) }) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-term-home-')));
  try {
    for (const [rel, text] of Object.entries(startup(home))) {
      fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
      fs.writeFileSync(path.join(home, rel), text);
    }
    // Spaces in the paths, and a user who turns on SH_WORD_SPLIT, must not break the startup files.
    const project = path.join(home, 'my project');
    const folder = path.join(home, 'my repo');
    fs.mkdirSync(project);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(project, 'local.env.sh'), '#!/bin/bash\nexport SB_VAR=project\nSB_PLAIN=exported\nalias sbalias="echo from-alias"\n');
    fs.writeFileSync(path.join(folder, 'local.env.sh'), '#!/bin/bash\nexport SB_VAR=folder\n');
    const wrapperDir = ensureWrappers(path.join(home, 'data', 'shell-env'));
    const env = { HOME: home, PATH: '/usr/bin:/bin', TERM: 'dumb', ...userEnv(home) };
    const launch = terminalEnvLaunch(shell, [path.join(project, 'local.env.sh'), path.join(folder, 'local.env.sh')], {
      wrapperDir, env, args: shellArgs(shell), windows: false,
    });
    const ask = [
      'echo "SB_VAR=$SB_VAR"',
      'printenv SB_PLAIN | sed "s/^/SB_PLAIN=/"',
      'echo "TRACE=$SB_TRACE"',
      'echo "ZDOTDIR=${ZDOTDIR-unset}"',
      'echo "HISTFILE=${HISTFILE-unset}"',
      'echo "LEFT=$(env | grep -c ^SWITCHBOARD_)"',
      'echo "ALIAS=$(alias sbalias >/dev/null 2>&1 && echo yes || echo no)"',
      'exit',
    ].join('\n') + '\n';
    const run = spawnSync(shell, launch.args, { cwd: folder, env: launch.env, input: ask, encoding: 'utf8', timeout: 20000 });
    const answers = {};
    for (const line of run.stdout.split('\n')) {
      const m = line.match(/^(SB_VAR|SB_PLAIN|TRACE|ZDOTDIR|HISTFILE|LEFT|ALIAS)=(.*)$/);
      if (m) answers[m[1]] = m[2];
    }
    return { home, answers, stderr: run.stderr };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** zsh startup files under dir (relative to HOME) that leave a trace; .zshrc sets SB_VAR. */
const zshFiles = (dir = '') => ({
  [path.join(dir, '.zshenv')]: 'setopt shwordsplit\nSB_TRACE="${SB_TRACE}env "\n',
  [path.join(dir, '.zprofile')]: 'SB_TRACE="${SB_TRACE}profile "\n',
  [path.join(dir, '.zshrc')]: 'SB_TRACE="${SB_TRACE}rc "\nexport SB_VAR=rc\n',
  [path.join(dir, '.zlogin')]: 'SB_TRACE="${SB_TRACE}login"\n',
});

test('zsh terminal: every startup file of the user runs in order, then the files, and ZDOTDIR is given back', { skip: !have('/bin/zsh') && 'no zsh' }, () => {
  const { home, answers } = runTerminal('/bin/zsh', { startup: () => zshFiles() });
  assert.equal(answers.SB_VAR, 'folder', 'the folder wins over the project and ~/.zshrc');
  assert.equal(answers.SB_PLAIN, 'exported');
  assert.equal(answers.TRACE, 'env profile rc login');
  assert.equal(answers.ZDOTDIR, 'unset', 'no ZDOTDIR before, none after');
  assert.equal(answers.LEFT, '0', 'no SWITCHBOARD_ variable left');
  assert.equal(answers.ALIAS, 'yes', 'aliases reach the terminal');
  if (process.platform === 'darwin') assert.equal(answers.HISTFILE, path.join(home, '.zsh_history'), 'the history stays in HOME');
  else assert.ok(!String(answers.HISTFILE).includes('shell-env'), 'the history is not kept with the startup files');
});

test('zsh terminal: a ZDOTDIR of the user\'s own, set before or by ~/.zshenv, is followed and kept', { skip: !have('/bin/zsh') && 'no zsh' }, () => {
  const preset = runTerminal('/bin/zsh', { startup: () => zshFiles('cfg'), userEnv: (home) => ({ ZDOTDIR: path.join(home, 'cfg') }) });
  assert.equal(preset.answers.TRACE, 'env profile rc login', 'the files of the ZDOTDIR in the environment');
  assert.equal(preset.answers.SB_VAR, 'folder');
  assert.equal(preset.answers.ZDOTDIR, path.join(preset.home, 'cfg'));

  const moved = runTerminal('/bin/zsh', {
    startup: (home) => ({
      '.zshenv': `ZDOTDIR="${home}/cfg"\nSB_TRACE="\${SB_TRACE}home-env "\n`,
      'cfg/.zprofile': 'SB_TRACE="${SB_TRACE}profile "\n',
      'cfg/.zshrc': 'SB_TRACE="${SB_TRACE}rc "\nexport SB_VAR=rc\n',
      'cfg/.zlogin': 'SB_TRACE="${SB_TRACE}login"\n',
    }),
  });
  assert.equal(moved.answers.TRACE, 'home-env profile rc login', 'the files of the ZDOTDIR ~/.zshenv chose');
  assert.equal(moved.answers.SB_VAR, 'folder');
  assert.equal(moved.answers.ZDOTDIR, path.join(moved.home, 'cfg'));
});

test('bash terminal: what a login reads, then the files', { skip: !have('/bin/bash') && 'no bash' }, () => {
  const { answers } = runTerminal('/bin/bash', {
    startup: () => ({
      '.bash_profile': 'SB_TRACE="${SB_TRACE}bash_profile "\nexport SB_VAR=rc\n. ~/.bashrc\n',
      '.bashrc': 'SB_TRACE="${SB_TRACE}bashrc"\n',
      '.profile': 'SB_TRACE="${SB_TRACE}not-read"\n',
    }),
  });
  assert.equal(answers.TRACE, 'bash_profile bashrc', 'the first login file, and what it sources');
  assert.equal(answers.SB_VAR, 'folder');
  assert.equal(answers.SB_PLAIN, 'exported');
  assert.equal(answers.LEFT, '0');
  assert.equal(answers.ALIAS, 'yes');
});

test('sh terminal: the profile and the user\'s ENV, then the files', { skip: !have('/bin/sh') && 'no sh' }, () => {
  const { answers } = runTerminal('/bin/sh', {
    startup: () => ({
      '.profile': 'SB_TRACE="${SB_TRACE}profile "\nexport SB_VAR=rc\n',
      '.shrc': 'SB_TRACE="${SB_TRACE}shrc"\n',
    }),
    userEnv: (home) => ({ ENV: path.join(home, '.shrc') }),
  });
  assert.equal(answers.TRACE, 'profile shrc');
  assert.equal(answers.SB_VAR, 'folder');
  assert.equal(answers.SB_PLAIN, 'exported');
  assert.equal(answers.LEFT, '0');
});
