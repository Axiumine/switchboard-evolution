// The Worktrees tab for a paired phone: which of its channels a phone may
// call (remote-api.js). worktrees.js checks every path against the project's
// repositories itself (requireProjectRepository, requireProjectWorktree), so
// this file only checks the shape of each parameter. Parameters are
// positional, in the order of the IPC handlers in main.js.
//
// A phone may change the post-create and pre-remove commands in the worktree
// settings. That is deliberate: a paired phone can already start a terminal
// session and run any command, so locking these two fields would protect
// nothing.
//
// There are no events here: worktree changes reach phones through
// projects-changed.
//
// list-env-files takes only a folder on the desktop and checks nothing. For a
// phone it takes the project too, and the folder must be one of the project's
// repositories.

const { allow } = require('./remote-api');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
// Free text a phone may also clear: a template, a command, a lock reason.
const isText = (max) => v => typeof v === 'string' && v.length <= max;
const isId = isString(200);
const isPath = v => isString(4096)(v) && v.startsWith('/');
// The service resolves a relative path or ~ itself (resolveUserPath).
const isFolder = v => isString(4096)(v) && !v.startsWith('-');
// A ref or a hash, never something git could read as an option.
const isRev = v => isString(300)(v) && !v.startsWith('-');
const isBool = v => typeof v === 'boolean';
const optional = check => v => v === undefined || v === null || check(v);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arrayOf = (check, max) => v => Array.isArray(v) && v.length <= max && v.every(check);
const oneOf = (...values) => v => values.includes(v);
/** An object with only these keys, each passing its check; `required` keys must be there. */
const fields = (checks, required = []) => v => isPlainObject(v)
  && required.every(key => v[key] !== undefined)
  && Object.keys(v).every(key => Object.hasOwn(checks, key) && checks[key](v[key]));

// Same as COMMAND_LENGTH_MAX in worktrees.js.
const COMMAND_LENGTH_MAX = 2000;

const SETTINGS_PATCH = fields({
  pathTemplate: isText(500),
  copyPatterns: arrayOf(isText(500), 200),
  copyIgnores: arrayOf(isText(500), 200),
  postCreateCmd: isText(COMMAND_LENGTH_MAX),
  preRemoveCmd: isText(COMMAND_LENGTH_MAX),
  startAfterCreate: oneOf('none', 'claude', 'codex', 'terminal'),
  sortOrder: oneOf('default', 'nameAsc', 'nameDesc', 'createdDesc', 'createdAsc'),
  collapsedGroups: arrayOf(isText(1000), 100),
});

const CREATE_SPEC = fields({
  repoPath: isPath,
  mode: oneOf('new', 'existing', 'remote', 'detached'),
  branch: optional(isString(300)),
  startPoint: optional(isRev),
  remoteBranch: optional(isString(300)),
  path: optional(isFolder),
  attach: optional(isBool),
  copyEnv: optional(arrayOf(isString(200), 50)),
}, ['repoPath', 'mode']);

/**
 * (client, projectId, repoPath) → the env files of one of the project's
 * repositories, as the window's list-env-files answers. requireRepository
 * throws for a folder that is not one of them.
 */
function envFilesForPhone({ requireRepository, listEnvFiles, defaultEnvSelection }) {
  return async (_client, projectId, repoPath) => {
    const { mainPath } = await requireRepository(projectId, repoPath);
    return { ok: true, files: listEnvFiles(mainPath), defaults: defaultEnvSelection(mainPath) };
  };
}

// Wired on first use: worktrees.js and projects.js need the app's database.
const realEnvFiles = envFilesForPhone({
  requireRepository: (projectId, repoPath) => require('./worktrees').requireProjectRepository(projectId, repoPath),
  listEnvFiles: (dir) => require('./projects').listEnvFiles(dir),
  defaultEnvSelection: (dir) => require('./projects').defaultEnvSelection(dir),
});

allow('get-project-worktrees', [isId]);
allow('get-worktree-settings', [isId]);
allow('set-worktree-settings', [isId, SETTINGS_PATCH]);
allow('list-worktree-branches', [isId, isPath]);
allow('suggest-worktree-path', [isId, isPath, isString(300)]);
allow('worktree-create', [isId, CREATE_SPEC]);
allow('worktree-run-post-create', [isId, isPath]);
allow('worktree-remove', [isId, isPath, optional(fields({
  force: isBool, unlock: isBool, deleteBranch: isBool, forceDeleteBranch: isBool, skipPreRemove: isBool,
}))]);
allow('worktree-delete-branch', [isId, isPath, isString(300), optional(fields({ force: isBool }))]);
allow('worktree-merged', [isId, isPath, isRev]);
allow('worktree-lock', [isId, isPath, optional(isText(1000))]);
allow('worktree-unlock', [isId, isPath]);
allow('worktree-move', [isId, isPath, isFolder]);
allow('worktree-repair', [isId, isPath, optional(arrayOf(isPath, 100))]);
allow('worktree-prune-preview', [isId, isPath]);
allow('worktree-prune', [isId, isPath, optional(fields({ detachStale: isBool }))]);
allow('worktree-attach', [isId, isPath]);
allow('worktree-detach', [isId, isPath]);
allow('list-env-files', [isId, isPath], { run: realEnvFiles });

module.exports = { envFilesForPhone };
