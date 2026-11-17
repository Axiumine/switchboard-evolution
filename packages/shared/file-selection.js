// file-selection.js — ticking several files and folders in a Files tree and
// moving them to the Trash together: Select All / Deselect All / Invert over
// the rows the tree shows, which of the ticked entries to actually trash (a
// folder takes what is inside it), the question asked before, and what to
// forget afterwards.
//
// Paths are relative to the tree's root, as the listings give them.
//
// Shared with the phone app (scripts/sync-shared.mjs there): no DOM, no Node.
(function (root) {
  /** Past this many entries the question gives the count instead of the list. */
  const LIST_MAX = 10;

  /** Never opened by Expand All: they can hold more than anyone wants to scroll. */
  const EXPAND_SKIP = new Set(['.git', '.svn', '.hg', 'CVS', 'node_modules']);

  const norm = (rel) => String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '');

  /** Whether `rel` is `parent` or inside it. */
  function isWithin(rel, parent) {
    const a = norm(rel);
    const b = norm(parent);
    return a === b || a.startsWith(b + '/');
  }

  /** Every row the tree shows. */
  function selectAll(visible) {
    return new Set(visible);
  }

  /** The rows the tree shows that were not ticked; ticks on hidden rows go. */
  function invertSelection(visible, picked) {
    const was = new Set(picked);
    return new Set(visible.filter(rel => !was.has(rel)));
  }

  function togglePicked(picked, rel) {
    const next = new Set(picked);
    if (next.has(rel)) next.delete(rel); else next.add(rel);
    return next;
  }

  /**
   * What to move to the Trash for these ticks: each once, and nothing that is
   * inside a ticked folder (the folder takes it along). Shallowest first.
   */
  function topLevelPicks(rels) {
    const unique = [...new Set([...(rels || [])].filter(rel => typeof rel === 'string' && norm(rel)))];
    unique.sort((a, b) => norm(a).split('/').length - norm(b).split('/').length || norm(a).localeCompare(norm(b)));
    const kept = [];
    for (const rel of unique) {
      if (kept.some(parent => isWithin(rel, parent))) continue;
      kept.push(rel);
    }
    return kept;
  }

  function countsText(folders, files) {
    const parts = [];
    if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`);
    if (files) parts.push(`${files} file${files === 1 ? '' : 's'}`);
    return parts.join(' and ');
  }

  /**
   * The question before moving entries ([{ rel, isDir }]) to the Trash: the
   * list of them up to ten, only how many past that. { title, detail, confirm }.
   */
  function trashQuestion(entries, { platform, max = LIST_MAX } = {}) {
    const list = entries || [];
    const destination = platform === 'win32' ? 'Recycle Bin' : 'Trash';
    const folders = list.filter(entry => entry.isDir).length;
    const files = list.length - folders;
    const name = (entry) => norm(entry.rel).split('/').pop();
    const title = list.length === 1
      ? `Move “${name(list[0])}” to the ${destination}?`
      : `Move ${list.length} items to the ${destination}?`;
    const what = list.length <= max
      ? list.map(entry => (entry.isDir ? `${norm(entry.rel)}/` : norm(entry.rel))).join('\n')
      : `${countsText(folders, files)}.`;
    const note = `${folders ? 'Folders go with everything in them. ' : ''}They can be restored from the ${destination}. Open previews of them will close; unsaved edits will be discarded.`;
    return { title, detail: `${what}\n\n${note}`, confirm: `Move to ${destination}` };
  }

  /** The paths left once `removed` went to the Trash, with everything inside them. */
  function remapAfterTrash(rels, removed) {
    const gone = [...(removed || [])];
    return [...(rels || [])].filter(rel => rel && !gone.some(parent => isWithin(rel, parent)));
  }

  /**
   * Expand All: the folders of a tree, level by level, with `listDir(rel)`
   * giving a folder's entries ({ name, relativePath, type }). Stops at
   * `maxFolders` or `maxDepth` levels and leaves out version-control folders
   * and node_modules, so a big repository does not open thousands of rows.
   */
  async function collectFolders(listDir, { maxFolders = 200, maxDepth = 6 } = {}) {
    const out = [];
    let level = [''];
    for (let depth = 0; depth < maxDepth && level.length; depth++) {
      const listings = await Promise.all(level.map(rel => Promise.resolve(listDir(rel)).catch(() => [])));
      const next = [];
      for (const entries of listings) {
        for (const entry of entries || []) {
          if (entry.type !== 'directory' || EXPAND_SKIP.has(entry.name)) continue;
          out.push(entry.relativePath);
          next.push(entry.relativePath);
          if (out.length >= maxFolders) return out;
        }
      }
      level = next;
    }
    return out;
  }

  /** "2 could not be moved: a.txt (No longer exists), …" for the failures of a batch. */
  function failuresText(failed, max = 8) {
    const list = failed || [];
    if (!list.length) return '';
    const lines = list.slice(0, max).map(item => `${norm(item.rel)}: ${item.error}`);
    if (list.length > max) lines.push(`+ ${list.length - max} more`);
    return `${list.length} item${list.length === 1 ? '' : 's'} could not be moved:\n${lines.join('\n')}`;
  }

  const api = {
    LIST_MAX,
    isWithin,
    selectAll,
    invertSelection,
    togglePicked,
    topLevelPicks,
    trashQuestion,
    remapAfterTrash,
    failuresText,
    collectFolders,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FileSelection = api;
})(typeof window !== 'undefined' ? window : globalThis);
