// shell-env.js — a terminal sources its project's local.env.sh files (and its
// folder's) at the end of its shell's own startup, so they win over the
// user's startup files the same way they do in an agent session, where they
// go in front of the command (shell-profiles.js envSourcePrefix). A terminal
// is an interactive login shell with no command to put them in front of, so
// the shell reaches them through small startup files the app keeps in its
// data folder:
//
//   zsh   ZDOTDIR points at them; each sources the user's own file of the same
//         name (from the user's ZDOTDIR, or HOME), and the last one sources
//         the environment files and gives ZDOTDIR back.
//   bash  --rcfile, without -l (bash ignores --rcfile in a login shell): it
//         reads what a login reads (/etc/profile, then the first of
//         ~/.bash_profile, ~/.bash_login and ~/.profile), then the files.
//   sh    ENV, which an interactive sh reads after its profile: the user's own
//         ENV first, then the files.
//
// The list travels in SWITCHBOARD_ENV_FILES, one path per line, and every
// SWITCHBOARD_ variable is gone once the shell is up. Other shells, and WSL,
// start as before.

const fs = require('fs');
const path = require('path');
const { isPosixShell, isWindows } = require('./shell-profiles');

const HEADER = '# Written by Switchboard Evolution, which rewrites it: a terminal reads your own\n'
  + '# startup files through this one, then the local.env.sh files of its project.\n';

// zsh: the user's file of the same name, read with the user's ZDOTDIR, which
// the file may change (it is taken back for the next one).
// Quoted throughout: the user's .zshenv may turn on SH_WORD_SPLIT.
const zshUserFile = (name) => `ZDOTDIR="\${SWITCHBOARD_USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/${name}" ]] && builtin source "$ZDOTDIR/${name}"
SWITCHBOARD_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$SWITCHBOARD_ZDOTDIR"
`;

const ZSH_FINISH = `${HEADER}ZDOTDIR="\${SWITCHBOARD_USER_ZDOTDIR:-$HOME}"
if [[ -z "$SWITCHBOARD_ZDOTDIR_WAS_SET" && "$ZDOTDIR" == "$HOME" ]]; then unset ZDOTDIR; else export ZDOTDIR; fi
for SWITCHBOARD_ENV_FILE in "\${(@f)SWITCHBOARD_ENV_FILES}"; do
  if [[ -f "$SWITCHBOARD_ENV_FILE" ]]; then set -a; builtin source "$SWITCHBOARD_ENV_FILE"; set +a; fi
done
unset SWITCHBOARD_ENV_FILE SWITCHBOARD_ENV_FILES SWITCHBOARD_USER_ZDOTDIR SWITCHBOARD_ZDOTDIR SWITCHBOARD_ZDOTDIR_WAS_SET
`;

const WRAPPERS = {
  'zsh/.zshenv': `${HEADER}SWITCHBOARD_ZDOTDIR="$ZDOTDIR"
[[ -n "$SWITCHBOARD_USER_ZDOTDIR" ]] && SWITCHBOARD_ZDOTDIR_WAS_SET=1
${zshUserFile('.zshenv')}`,
  'zsh/.zprofile': `${HEADER}${zshUserFile('.zprofile')}`,
  // /etc/zshrc on macOS has just put the history next to these files.
  'zsh/.zshrc': `${HEADER}if [[ "$HISTFILE" == "$SWITCHBOARD_ZDOTDIR/.zsh_history" ]]; then HISTFILE="\${SWITCHBOARD_USER_ZDOTDIR:-$HOME}/.zsh_history"; fi
${zshUserFile('.zshrc')}[[ -o login ]] || builtin source "$SWITCHBOARD_ZDOTDIR/finish.zsh"
`,
  'zsh/.zlogin': `${HEADER}${zshUserFile('.zlogin')}builtin source "$SWITCHBOARD_ZDOTDIR/finish.zsh"
`,
  'zsh/finish.zsh': ZSH_FINISH,
  'bash/bashrc': `${HEADER}if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
fi
while IFS= read -r SWITCHBOARD_ENV_FILE <&3; do
  if [ -f "$SWITCHBOARD_ENV_FILE" ]; then set -a; . "$SWITCHBOARD_ENV_FILE"; set +a; fi
done 3<<< "$SWITCHBOARD_ENV_FILES"
unset SWITCHBOARD_ENV_FILE SWITCHBOARD_ENV_FILES
`,
  'sh/env': `${HEADER}if [ -n "$SWITCHBOARD_USER_ENV" ]; then ENV=$SWITCHBOARD_USER_ENV; export ENV; [ -r "$ENV" ] && . "$ENV"; else unset ENV; fi
SWITCHBOARD_IFS=$IFS
IFS='
'
for SWITCHBOARD_ENV_FILE in $SWITCHBOARD_ENV_FILES; do
  IFS=$SWITCHBOARD_IFS
  if [ -f "$SWITCHBOARD_ENV_FILE" ]; then set -a; . "$SWITCHBOARD_ENV_FILE"; set +a; fi
done
IFS=$SWITCHBOARD_IFS
unset SWITCHBOARD_IFS SWITCHBOARD_ENV_FILE SWITCHBOARD_ENV_FILES SWITCHBOARD_USER_ENV
`,
};

/** Write the startup files into dir when one is missing or out of date. */
function ensureWrappers(dir) {
  for (const [rel, content] of Object.entries(WRAPPERS)) {
    const file = path.join(dir, ...rel.split('/'));
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch {}
    if (current === content) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return dir;
}

/**
 * The argv and environment of a terminal that sources `files` at the end of
 * its startup. `args` is what shellArgs gives for a terminal and `env` the
 * environment it would start with; both come back unchanged when there are
 * no files or the shell is not bash, zsh or sh. A path with a line break in it
 * cannot travel in the list and is left out.
 */
function terminalEnvLaunch(shellPath, files, { wrapperDir, env = {}, args = [], windows = isWindows } = {}) {
  const usable = (Array.isArray(files) ? files : []).filter(file => typeof file === 'string' && file && !/[\r\n]/.test(file));
  if (!usable.length || !wrapperDir || !isPosixShell(shellPath)) return { args, env, files: [] };
  const slash = (p) => (windows ? p.replace(/\\/g, '/') : p);
  const list = usable.map(slash).join('\n');
  const base = path.basename(shellPath).toLowerCase();
  if (base.includes('zsh')) {
    return {
      args,
      env: { ...env, ZDOTDIR: path.join(wrapperDir, 'zsh'), SWITCHBOARD_USER_ZDOTDIR: env.ZDOTDIR || '', SWITCHBOARD_ENV_FILES: list },
      files: usable,
    };
  }
  if (base.includes('bash')) {
    return {
      args: ['--rcfile', slash(path.join(wrapperDir, 'bash', 'bashrc')), '-i'],
      env: { ...env, SWITCHBOARD_ENV_FILES: list },
      files: usable,
    };
  }
  return {
    args,
    env: { ...env, ENV: slash(path.join(wrapperDir, 'sh', 'env')), SWITCHBOARD_USER_ENV: env.ENV || '', SWITCHBOARD_ENV_FILES: list },
    files: usable,
  };
}

module.exports = { ensureWrappers, terminalEnvLaunch, WRAPPERS };
