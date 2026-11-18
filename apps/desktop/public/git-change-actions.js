// Copied from packages/shared/git-change-actions.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// git-change-actions.js — what the Git tab's Changes list may do to a file or
// a folder beyond staging: discard its working-tree changes (an untracked
// file goes to the Trash), add it to .gitignore, or add it and stop tracking
// it. Which changes an action reaches, which actions a row offers, the line
// written to .gitignore, and the question asked before anything is lost. Also
// which changed files can be edited in place from the diff (canEdit).
//
// A change is one entry of git.js parsePorcelain(): { path, status, code,
// indexStatus, worktreeStatus }, paths relative to the repository's root.
// A target is { path, dir } for a file or a folder row, or null for every change.
//
// Shared with the phone app (scripts/sync-shared.mjs there) and required by
// git.js in main: no DOM, no Node.
(function (root) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const baseName = (p) => norm(p).split('/').pop() || norm(p);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /** Whether `path` is the target itself or, for a folder, inside it. */
  function inTarget(path, target) {
    if (!target) return true;
    const p = norm(path);
    const t = norm(target.path);
    return p === t || (!!target.dir && p.startsWith(`${t}/`));
  }

  const isConflicted = (change) => change.status === 'conflicted';
  const isUntracked = (change) => change.status === 'untracked';

  /** Changed in the working tree (an untracked file too), and not in conflict. */
  function hasWorktreeChange(change) {
    if (isConflicted(change)) return false;
    if (isUntracked(change)) return true;
    return !!change.worktreeStatus && change.worktreeStatus !== ' ';
  }

  /** The changes a Discard of `target` (null: all) reaches: the "Changes" side only. */
  function discardTargets(changes, target) {
    return (changes || []).filter(change => hasWorktreeChange(change) && inTarget(change.path, target));
  }

  /**
   * What a row's menu offers besides staging. A file not tracked yet can be
   * ignored; a tracked one only ignored and taken out of Git together, since
   * .gitignore alone does nothing to it. A folder can always be ignored, and
   * also taken out of Git when it holds tracked files. Conflicts get neither.
   */
  function ignoreOptions(changes, target) {
    const none = { ignore: false, untrack: false };
    if (!target || norm(target.path) === '.gitignore') return none;
    const inside = (changes || []).filter(change => inTarget(change.path, target) && !isConflicted(change));
    if (!inside.length) return none;
    if (!target.dir) {
      const untracked = isUntracked(inside[0]);
      return { ignore: untracked, untrack: !untracked };
    }
    return { ignore: true, untrack: inside.some(change => !isUntracked(change)) };
  }

  /** gitignore's own pattern characters, and a trailing space it would trim. */
  function escapeSegment(segment) {
    return segment.replace(/[\\*?[]/g, ch => `\\${ch}`).replace(/ $/, '\\ ');
  }

  /**
   * The .gitignore line for a path relative to the repository's root: anchored
   * with a leading "/" (so it matches that path only, and "#" or "!" at its
   * start are plain characters), and with a trailing "/" for a folder.
   */
  function ignorePattern(path, isDir) {
    const parts = norm(path).split('/').filter(Boolean);
    const last = parts.length - 1;
    const line = parts.map((part, i) => (i === last ? escapeSegment(part) : part.replace(/[\\*?[]/g, ch => `\\${ch}`))).join('/');
    return `/${line}${isDir ? '/' : ''}`;
  }

  /**
   * The question before a Discard: `targets` from discardTargets(), `name` the
   * folder's name for a folder row (none for one file or for everything).
   */
  function discardQuestion(targets, name, { trash = 'Trash' } = {}) {
    const list = targets || [];
    const fresh = list.filter(isUntracked).length;
    const tracked = list.length - fresh;
    if (list.length === 1 && !name) {
      const file = baseName(list[0].path);
      if (fresh) {
        return {
          title: `Move “${file}” to the ${trash}?`,
          detail: `It is not tracked by Git, so discarding it moves it to the ${trash}.`,
          confirm: `Move to ${trash}`,
        };
      }
      return {
        title: `Discard the changes in “${file}”?`,
        detail: 'It goes back to its last staged or committed version. This cannot be undone.',
        confirm: 'Discard Changes',
      };
    }
    const parts = [];
    if (tracked) parts.push(`${plural(tracked, 'file')} ${tracked === 1 ? 'goes' : 'go'} back to the last staged or committed version; this cannot be undone.`);
    if (fresh) parts.push(`${plural(fresh, 'untracked file')} ${fresh === 1 ? 'goes' : 'go'} to the ${trash}.`);
    return {
      title: `Discard the changes in ${plural(list.length, 'file')}${name ? ` in “${name}”` : ''}?`,
      detail: parts.join(' '),
      confirm: `Discard ${plural(list.length, 'File')}`,
    };
  }

  /** The question before Add to .gitignore and Remove from Git. */
  function untrackQuestion(name, isDir) {
    return {
      title: `Add “${name}” to .gitignore and remove it from Git?`,
      detail: isDir
        ? 'The files in it stay on disk. Git stops tracking them: the removal is staged and goes into your next commit.'
        : 'The file stays on disk. Git stops tracking it: the removal is staged and goes into your next commit.',
      confirm: 'Add and Remove from Git',
    };
  }

  /**
   * Whether the diff of `change` offers Edit: the file has to be on disk. A
   * deletion has nothing to edit; a file in conflict does, unless both sides
   * deleted it (in a conflict, D names a side, not the working tree).
   */
  function canEdit(change) {
    if (!change) return false;
    if (isConflicted(change)) return change.code !== 'DD';
    if (change.worktreeStatus === 'D') return false;
    return !(change.indexStatus === 'D' && (!change.worktreeStatus || change.worktreeStatus === ' '));
  }

  /** What the editor of `change` compares its text with, in words, shown above it in edit mode. */
  function editNote(change) {
    if (change && isUntracked(change)) return 'Not tracked yet: all of it is new. Saved edits stay unstaged.';
    if (change && isConflicted(change)) return 'In conflict: marked is what you change from here. Saved edits stay unstaged.';
    return 'Marked is what differs from the staged copy. Saved edits are left to stage.';
  }

  const api = { discardTargets, ignoreOptions, ignorePattern, discardQuestion, untrackQuestion, inTarget, canEdit, editNote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GitChangeActions = api;
})(typeof window !== 'undefined' ? window : globalThis);
