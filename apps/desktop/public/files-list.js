// What the sidebar's Files tab lists, and in which sections (files-view.js
// draws them):
//   1. the pinned files, in the order the user gave, whatever the filter;
//   2. the files opened by dropping them on the sidebar, most recent first;
//   3. the agent files (CLAUDE.md, AGENTS.md, memory…), Global and by project,
//      as main.js get-memories finds them.
// The filter combo shows the opened files, the agent files or both. A search
// narrows every section, the pinned one too. In "All" a file shows once: an
// agent file that was also dropped stays in its agent group.
// No DOM, so node --test loads it as well.

const FILES_FILTERS = [
  ['all', 'All files'],
  ['agents', 'Agent files'],
  ['opened', 'Opened files'],
];
const FILES_FILTER_KEY = 'files.filter';

function validFilesFilter(value) {
  return FILES_FILTERS.some(([key]) => key === value) ? value : 'all';
}

/** The filter last chosen, kept across restarts. */
function loadFilesFilter(storage) {
  try { return validFilesFilter(storage && storage.getItem(FILES_FILTER_KEY)); } catch { return 'all'; }
}

function saveFilesFilter(storage, value) {
  try { if (storage) storage.setItem(FILES_FILTER_KEY, validFilesFilter(value)); } catch {}
}

/** Every agent file by path, the first place it is found winning. */
function agentFilesByPath(agents) {
  const byPath = new Map();
  const add = (file) => { if (file && file.filePath && !byPath.has(file.filePath)) byPath.set(file.filePath, file); };
  for (const file of (agents && agents.global && agents.global.files) || []) add(file);
  for (const project of (agents && agents.projects) || []) for (const file of project.files || []) add(file);
  return byPath;
}

/**
 * The sections of the tab.
 * @param {object} input
 * @param {object} input.agents   - get-memories: { global: { files }, projects: [{ folder, shortName, files }] }
 * @param {object} input.opened   - get-opened-files: { opened: [file], pinned: [file] }
 * @param {string} input.filter   - 'all' | 'agents' | 'opened'
 * @param {Set<string>|null} input.matchIds - paths a search found, or null without a search
 * @returns {{ pinned: Array<{ file, opened: boolean, agent: boolean }>, opened: object[],
 *            groups: Array<{ key, label, files }>, filter: string }}
 */
function buildFilesSections({ agents, opened, filter, matchIds = null } = {}) {
  const show = validFilesFilter(filter);
  const matches = (filePath) => !matchIds || matchIds.has(filePath);
  const agentFiles = agentFilesByPath(agents);
  const openedFiles = new Map(((opened && opened.opened) || []).map(file => [file.filePath, file]));

  const pinnedPaths = new Set();
  const pinned = [];
  for (const file of (opened && opened.pinned) || []) {
    if (!file || !file.filePath || pinnedPaths.has(file.filePath)) continue;
    pinnedPaths.add(file.filePath);
    if (!matches(file.filePath)) continue;
    const agent = agentFiles.get(file.filePath);
    const openedFile = openedFiles.get(file.filePath);
    pinned.push({
      // An agent file keeps the place its group shows (~/.claude, dev/app/).
      file: agent ? { ...file, ...agent } : (openedFile || file),
      opened: !!openedFile,
      agent: !!agent,
    });
  }

  const openedList = show === 'agents' ? [] : [...openedFiles.values()].filter(file =>
    !pinnedPaths.has(file.filePath) && matches(file.filePath)
    && !(show === 'all' && agentFiles.has(file.filePath)));

  const groups = [];
  if (show !== 'opened') {
    const keep = (files) => (files || []).filter(file => !pinnedPaths.has(file.filePath) && matches(file.filePath));
    const globalFiles = keep(agents && agents.global && agents.global.files);
    if (globalFiles.length) groups.push({ key: '__global__', label: 'Global', files: globalFiles });
    for (const project of (agents && agents.projects) || []) {
      const files = keep(project.files);
      if (files.length) groups.push({ key: project.folder, label: project.shortName, files });
    }
  }

  return { pinned, opened: openedList, groups, filter: show };
}

/** Whether the sections hold no file at all. */
function filesSectionsEmpty(sections) {
  return !sections.pinned.length && !sections.opened.length && !sections.groups.length;
}

/** Where a pinned file goes when moved one step up (-1) or down (+1); null when it cannot. */
function pinnedStep(pinnedPaths, filePath, step) {
  const from = pinnedPaths.indexOf(filePath);
  const to = from + step;
  if (from < 0 || to < 0 || to >= pinnedPaths.length) return null;
  return to;
}

/**
 * Where a pinned file dragged onto another pinned one goes: before it, or
 * after it when dropped on its lower half. The index is the one the file
 * takes once moved (main.js move-pinned-file); null when nothing moves.
 */
function pinnedDropIndex(pinnedPaths, fromPath, targetPath, after) {
  const from = pinnedPaths.indexOf(fromPath);
  const target = pinnedPaths.indexOf(targetPath);
  if (from < 0 || target < 0 || from === target) return null;
  let to = after ? target + 1 : target;
  if (from < to) to -= 1;
  return to === from ? null : to;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FILES_FILTERS, FILES_FILTER_KEY, validFilesFilter, loadFilesFilter, saveFilesFilter,
    buildFilesSections, filesSectionsEmpty, pinnedStep, pinnedDropIndex,
  };
}
