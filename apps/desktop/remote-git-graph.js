// The Git Graph for a paired phone: which of its channels a phone may call
// and which of its events it hears (remote-api.js). Every channel here takes
// a project and one of its attached folders, which projects.js checks
// (requireAttachedFolder); git-actions.js checks each action's arguments.
//
// A phone has the whole Git Graph, settings and remotes included: a paired
// phone can already open a terminal on the computer and run any command, so
// withholding these would protect nothing. What is still checked is
// malformed input and mistakes:
//   - parameter shapes (below), as everywhere in remote-api.js;
//   - a remote an action names must be one the repository has (git takes any
//     other name as a path to a repository), one to edit or delete must
//     exist, and one to add must not;
//   - a file is reset only by its literal name: git reads `*`, `?`, `[`, `]`
//     and a leading `:` as a pattern, which could reset many files;
//   - a stash must still be the one the phone saw.
//
// Not the window's channels, but phone forms of them, because the originals
// ask the desktop's user with a native dialog:
//   - create-git-graph-archive picks the file itself, in ~/Downloads, and
//     never overwrites one (save-git-graph-archive shows a Save dialog);
//   - set-git-graph-avatars-gitlab-host sets the host without the dialog
//     (confirm-git-graph-avatars-gitlab-host); the phone asks its own user,
//     naming the exact host, before calling.
// The archive action itself (createArchive) takes a path, so it is not in
// PHONE_ACTIONS. rebaseInteractive runs nothing: it answers the command, and
// the phone types it into a terminal it opens in the repository.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { allow, allowEvent } = require('./remote-api');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
// Free text a phone may also send empty, which then means "not set".
const isText = (max) => v => typeof v === 'string' && v.length <= max;
const isId = isString(200);
const isPath = v => isString(4096)(v) && v.startsWith('/');
const isRelative = v => isString(4096)(v) && !v.startsWith('/');
// A ref or a hash, never something git could read as an option.
const isRev = v => isString(300)(v) && !v.startsWith('-');
const isHash = v => typeof v === 'string' && /^[0-9a-f]{4,40}$/.test(v);
const isBool = v => typeof v === 'boolean';
const isInt = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
const optional = check => v => v === undefined || v === null || check(v);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const selection = v => v === 'all' || (Array.isArray(v) && v.length <= 1000 && v.every(isRev));
const oneOf = (...values) => v => values.includes(v);
/** An object with only these keys, each passing its check; `required` keys must be there. */
const fields = (checks, required = []) => v => isPlainObject(v)
  && required.every(key => v[key] !== undefined)
  && Object.keys(v).every(key => Object.hasOwn(checks, key) && checks[key](v[key]));

const GRAPH_OPTIONS = fields({
  limit: isInt(1, 5000), skip: isInt(0, 10_000_000), order: v => ['date', 'author-date', 'topo'].includes(v),
  branches: selection, tags: selection, showRemote: isBool, showTags: isBool, includeReflogCommits: isBool,
  firstParentOnly: isBool, refsUnchanged: isBool, showStashes: isBool, showUncommittedChanges: isBool,
});

const PHONE_ACTIONS = new Set([
  'addTag', 'createBranch', 'checkoutCommit', 'checkoutBranchImmediate', 'checkoutRemoteBranch', 'renameBranch',
  'deleteBranch', 'deleteRemoteBranch', 'cherryPick', 'revert', 'dropCommit', 'merge', 'rebase', 'resetToCommit',
  'resetUncommitted', 'cleanUntracked', 'stashPush', 'stashApply', 'stashPop', 'stashDrop', 'stashCreateBranch',
  'pushBranch', 'pushTag', 'deleteTag', 'fetchRemote', 'fetchAllRemotes', 'fetchIntoLocalBranch', 'pullBranch',
  'addRemote', 'editRemote', 'deleteRemote', 'setUserDetails', 'resetFileToRevision', 'rebaseInteractive',
]);

// git reads these in a path as a pathspec pattern.
const PATHSPEC_CHARACTERS = /[*?[\]\\]/;

/**
 * Whether git could read a file path as a pathspec rather than a name: a
 * pattern character, or ':' (pathspec magic) opening any segment. The action
 * resolves the path before it reaches git (`x/../:(top)a` becomes
 * `:(top)a`), so the resolved form is checked as well as the one given.
 */
function readsAsPathspec(relPath) {
  return [relPath, path.posix.normalize(relPath)].some((candidate) => PATHSPEC_CHARACTERS.test(candidate)
    || candidate.split('/').some((segment) => segment.startsWith(':')));
}

const REMOTE_LISTS = ['remotes', 'pushToRemotes', 'deleteOnRemotes'];

/**
 * (actionId, params) → null when a phone may run it, or why not.
 * remotesOf() lists the repository's remotes; revParse(ref) is the hash a ref names.
 */
function checkPhoneAction({ remotesOf, revParse }) {
  return async (actionId, params) => {
    const named = [
      ...(typeof params.remote === 'string' ? [params.remote] : []),
      ...REMOTE_LISTS.flatMap((key) => (Array.isArray(params[key]) ? params[key] : [])),
      ...(actionId === 'editRemote' && typeof params.oldName === 'string' ? [params.oldName] : []),
      ...(actionId === 'deleteRemote' && typeof params.name === 'string' ? [params.name] : []),
    ];
    const adding = actionId === 'addRemote' && typeof params.name === 'string' ? params.name : null;
    if (named.length || adding !== null) {
      const remotes = new Set(await remotesOf());
      const unknown = named.find((name) => !remotes.has(name));
      if (unknown !== undefined) return `"${unknown}" is not a remote of this repository`;
      if (adding !== null && remotes.has(adding)) return `A remote named "${adding}" already exists`;
    }
    if (actionId === 'resetFileToRevision' && typeof params.relPath === 'string' && readsAsPathspec(params.relPath)) {
      return 'Reset this file from the computer: its name has characters git reads as a pattern';
    }
    if (typeof params.stashRef === 'string') {
      const now = await revParse(params.stashRef);
      if (!now || now !== params.stashHash) return 'The stashes changed meanwhile. Pull to refresh and try again.';
    }
    return null;
  };
}

/**
 * The file a phone's archive is written to: `<name>.<format>` in the
 * Downloads folder, `<name> (2).<format>`, `(3)`… when it is taken. The name
 * is the suggested one (or the ref) as a single file name.
 */
function archivePath(downloads, suggestedName, ref, format) {
  const name = String(suggestedName || ref).replace(/[/\\]/g, '-').replace(/[\u0000-\u001f]/g, '-').replace(/^\.+/, '').slice(0, 200) || 'archive';
  const taken = (file) => { try { fs.lstatSync(file); return true; } catch { return false; } };
  let file = path.join(downloads, `${name}.${format}`);
  for (let n = 2; taken(file); n++) file = path.join(downloads, `${name} (${n}).${format}`);
  return file;
}

/**
 * (client, projectId, folderPath, { ref, refType, remote, format, suggestedName })
 * → what createArchive answers, for an archive written to Downloads.
 * downloadsDir() is the folder; remotesOf(projectId, folderPath) lists the
 * repository's remotes; getHandler gives the window's run-git-graph-action.
 */
function archiveForPhone({ downloadsDir, getHandler, remotesOf }) {
  return async (_client, projectId, folderPath, { ref, refType, remote, format, suggestedName }) => {
    const remoteName = remote || undefined;
    if (remoteName !== undefined && !(await remotesOf(projectId, folderPath)).includes(remoteName)) {
      return { error: `"${remoteName}" is not a remote of this repository` };
    }
    const downloads = downloadsDir();
    fs.mkdirSync(downloads, { recursive: true });
    const absPath = archivePath(downloads, suggestedName, ref, format);
    return getHandler('run-git-graph-action').fn(null, projectId, folderPath, 'createArchive', { ref, refType, remote: remoteName, format, absPath });
  };
}

function runForPhone(check, getHandler) {
  return async (_client, projectId, folderPath, actionId, params) => {
    const refusal = await check(actionId, params);
    if (refusal) return { error: refusal };
    const { stashHash, ...forward } = params;
    return getHandler('run-git-graph-action').fn(null, projectId, folderPath, actionId, forward);
  };
}

allow('get-project-git-graph', [isId, isPath, optional(GRAPH_OPTIONS)]);
allow('get-git-graph-commit-detail', [isId, isPath, isHash]);
allow('get-git-graph-compare-detail', [isId, isPath, isHash, optional(isHash)]);
allow('get-git-graph-file-at-revision', [isId, isPath, isRev, isRelative]);
allow('get-git-graph-file-diff-between', [isId, isPath, isRev, optional(isRev), isRelative]);
allow('get-git-graph-remotes', [isId, isPath]);
allow('get-git-graph-tag-details', [isId, isPath, isRev]);
allow('get-git-graph-user-details', [isId, isPath]);
allow('get-git-graph-repo-config', [isId, isPath]);
allow('get-git-graph-global-preferences');
allow('set-git-graph-repo-config', [isId, isPath, isPlainObject]);
allow('set-git-graph-global-preferences', [isPlainObject]);
allow('trust-git-graph-repo-config', [isId, isPath, isBool]);
allow('export-git-graph-repo-config', [isId, isPath]);
allow('get-git-graph-avatar-url', [isId, isPath, isString(320)]);
allow('clear-git-graph-avatar-cache');
// Checked here first, then handed to the window's own handler (ipc-registry.js).
const { getHandler } = require('./ipc-registry');
const git = require('./git');
const remoteNames = async (projectId, folderPath) => {
  const result = await getHandler('get-git-graph-remotes').fn(null, projectId, folderPath);
  return (result?.remotes || []).map((remote) => remote.name);
};
// What the phone forms below reach for, looked up when used: projects.js needs
// the app's database, and a test swaps them.
const wiring = {
  setGitLabHost: (projectId, folderPath, host) => require('./projects').setProjectGitGraphAvatarsSelfHostedGitLabHost(projectId, folderPath, host),
  downloadsDir: () => path.join(os.homedir(), 'Downloads'),
};
allow('run-git-graph-action', [isId, isPath, v => PHONE_ACTIONS.has(v), isPlainObject], {
  run: (client, projectId, folderPath, actionId, params) => runForPhone(checkPhoneAction({
    remotesOf: () => remoteNames(projectId, folderPath),
    revParse: (ref) => git.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], folderPath).then((out) => String(out).trim(), () => null),
  }), getHandler)(client, projectId, folderPath, actionId, params),
});
allow('cancel-git-graph-action', [isId, isPath, optional(isString(100))]);

// The host gets this repository's commit author addresses for avatar lookups,
// so the phone confirms it with its user, naming the host, before it calls.
const isHostName = v => v === null || (isString(253)(v) && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(v));
allow('set-git-graph-avatars-gitlab-host', [isId, isPath, isHostName], {
  run: (_client, projectId, folderPath, host) => wiring.setGitLabHost(projectId, folderPath, host),
});

allow('create-git-graph-archive', [isId, isPath, fields({
  ref: isString(300),
  refType: oneOf('hash', 'branch', 'tag', 'remote-branch'),
  remote: optional(isText(200)),
  format: oneOf('zip', 'tar'),
  suggestedName: optional(isText(200)),
}, ['ref', 'refType', 'format'])], {
  run: (client, projectId, folderPath, spec) => archiveForPhone({
    downloadsDir: wiring.downloadsDir, getHandler, remotesOf: remoteNames,
  })(client, projectId, folderPath, spec),
});

allowEvent('git-graph-repo-changed');
allowEvent('git-graph-action-progress');

module.exports = { PHONE_ACTIONS, checkPhoneAction, archiveForPhone, wiring };
