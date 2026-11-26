// env-files-model.js — the environment file of a project and of its folders.
// Every project folder has a local.env.sh, made with the project; an attached
// folder can have one of its own, made from the Env tab. Before a session or a
// terminal starts, its shell sources them (main.js open-terminal): in the
// project folder only the project's file, in an attached folder the project's
// and then that folder's, so a variable the folder sets wins.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const ENV_FILE_NAME = 'local.env.sh';
  const ENV_FILE_TEMPLATE = '#!/bin/bash\n\n\n';

  /** How the files are loaded, in the words the Env tab shows on both apps. */
  const ENV_RULES = [
    'A session or terminal started in the project folder, or in a folder inside it that is not attached, loads only the project\'s file.',
    'One started in an attached folder, or in a worktree of it, loads the project\'s file first and then the folder\'s, so the folder wins when both set the same variable.',
    'The session\'s shell (bash, zsh or sh) sources them after your own startup files, between set -a and set +a: plain VAR=value lines are exported too. Under zsh, bash-only syntax such as arrays or shopt does not work.',
    'A change applies to sessions started after you save it; running sessions keep the environment they started with.',
    'fish, nu, PowerShell, cmd and WSL terminals do not load them.',
  ];

  /** What a session started in an entry's folder loads, for the line above the editor. */
  function loadOrderText(kind) {
    return kind === 'project'
      ? 'Sessions started here load only this file.'
      : `Sessions started here load the project's ${ENV_FILE_NAME} first, then this one.`;
  }

  const api = { ENV_FILE_NAME, ENV_FILE_TEMPLATE, ENV_RULES, loadOrderText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EnvFilesModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
