const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { isPosixShell, envSourcePrefix, shellArgs } = require('../shell-profiles');

const have = (shell) => fs.existsSync(shell);

test('isPosixShell: bash, zsh and sh, Git Bash too; not fish, nu, PowerShell, cmd or WSL', () => {
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh', '/opt/homebrew/bin/bash', 'C:\\Program Files\\Git\\bin\\bash.exe']) {
    assert.equal(isPosixShell(shell), true, shell);
  }
  for (const shell of ['/opt/homebrew/bin/fish', '/usr/local/bin/nu', 'powershell.exe', 'pwsh', 'C:\\Windows\\System32\\cmd.exe', 'wsl.exe', '', null]) {
    assert.equal(isPosixShell(shell), false, String(shell));
  }
});

test('envSourcePrefix sources the files in order between set -a and set +a, quoted', () => {
  assert.equal(
    envSourcePrefix('/bin/zsh', ['/p/local.env.sh', '/repos/app/local.env.sh'], { windows: false }),
    "set -a; . '/p/local.env.sh'; . '/repos/app/local.env.sh'; set +a; "
  );
  assert.equal(
    envSourcePrefix('/bin/bash', ["/it's here/local.env.sh"], { windows: false }),
    "set -a; . '/it'\\''s here/local.env.sh'; set +a; ",
    'a quote in a path cannot end the string'
  );
  assert.equal(
    envSourcePrefix('C:\\Program Files\\Git\\bin\\bash.exe', ['C:\\Users\\dev\\p\\local.env.sh'], { windows: true }),
    "set -a; . 'C:/Users/dev/p/local.env.sh'; set +a; ",
    'Git Bash gets forward slashes'
  );
  assert.equal(envSourcePrefix('/bin/zsh', []), '');
  assert.equal(envSourcePrefix('/bin/zsh', undefined), '');
  assert.equal(envSourcePrefix('/opt/homebrew/bin/fish', ['/p/local.env.sh']), '');
  assert.equal(envSourcePrefix('powershell.exe', ['/p/local.env.sh']), '');
});

/**
 * A HOME of its own whose startup files set SB_VAR, a project file and a
 * folder file that set it again, and the session command the way main.js
 * builds it: the folder's value has to reach the program.
 */
function runSession(shell, startupFile) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-env-home-'));
  try {
    fs.writeFileSync(path.join(home, startupFile), 'export SB_VAR=rc\nexport SB_ONLY_RC=kept\n');
    const project = path.join(home, 'project');
    const folder = path.join(home, 'repo with space');
    fs.mkdirSync(project);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(project, 'local.env.sh'), '#!/bin/bash\nexport SB_VAR=project\nSB_PLAIN=exported\n');
    fs.writeFileSync(path.join(folder, 'local.env.sh'), '#!/bin/bash\nexport SB_VAR=folder\n');
    const prefix = envSourcePrefix(shell, [path.join(project, 'local.env.sh'), path.join(folder, 'local.env.sh')], { windows: false });
    const command = prefix + 'printenv SB_VAR; printenv SB_PLAIN; printenv SB_ONLY_RC';
    const run = spawnSync(shell, shellArgs(shell, command), {
      cwd: folder,
      env: { HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin', TERM: 'dumb' },
      encoding: 'utf8',
      timeout: 20000,
    });
    return run.stdout.trim().split('\n').slice(-3);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('zsh: the folder wins over the project and the startup files, and VAR=value is exported', { skip: !have('/bin/zsh') && 'no zsh' }, () => {
  assert.deepEqual(runSession('/bin/zsh', '.zshrc'), ['folder', 'exported', 'kept']);
});

test('bash: the same through a login profile', { skip: !have('/bin/bash') && 'no bash' }, () => {
  assert.deepEqual(runSession('/bin/bash', '.bash_profile'), ['folder', 'exported', 'kept']);
});
