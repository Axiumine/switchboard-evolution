// --- Files tab (sidebar) ---
// The agent files (main.js get-memories), the files opened by dropping them on
// the sidebar (files-drop.js; main.js get-opened-files) and the pinned ones,
// in the sections files-list.js decides. A file opens in the main area's
// editor (memoryPanel) or in a window of its own (main.js openFileWindow).
//
// Depends on globals: memoryContent, memoryPanel, memoryViewer, placeholder,
// terminalArea, planViewer, statsViewer, settingsViewer, processViewer,
// activeTab (app.js); buildFilesSections, filesSectionsEmpty, loadFilesFilter,
// saveFilesFilter, pinnedStep, pinnedDropIndex (files-list.js); formatDate
// (utils.js); ICONS (icons.js); fileIconHtml (file-icons.js); showContextMenu
// (projects-view.js); openUnsupportedFile (file-actions.js).

let cachedMemoryData = { global: { files: [] }, projects: [] };
let cachedOpenedFiles = { opened: [], pinned: [] };
let filesFilter = loadFilesFilter(localStorage);
// The paths the search in the field found, or null without a search.
let filesMatchIds = null;
let currentMemoryFilePath = null;
let filesOpenRequest = 0;
const memoryCollapsedState = new Map();
const filesFilterSelect = document.getElementById('files-filter-select');
const PINNED_FILE_TYPE = 'application/x-switchboard-pinned-file';

const BRAIN_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>';
const FILES_ICONS = {
  x: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  up: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
  down: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  here: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>`,
  folder: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
};

function fileBaseName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || String(filePath || '');
}

function isAgentFilePath(filePath) {
  const data = cachedMemoryData;
  return [...data.global.files, ...data.projects.flatMap(p => p.files)].some(f => f.filePath === filePath);
}

// --- Loading and drawing ---

/** Load both lists and draw the tab. A new visit starts without a search. */
async function loadFiles({ keepSearch = false } = {}) {
  if (!keepSearch) filesMatchIds = null;
  const [memories, opened] = await Promise.all([
    window.api.getMemories().catch(() => null),
    window.api.getOpenedFiles().catch(() => null),
  ]);
  if (memories) cachedMemoryData = memories;
  if (opened) cachedOpenedFiles = opened;
  renderFiles(filesMatchIds);
}

/** The opened and pinned files as main.js returned them after a change. */
function applyOpenedFiles(state) {
  if (!state || !Array.isArray(state.opened) || !Array.isArray(state.pinned)) return;
  cachedOpenedFiles = { opened: state.opened, pinned: state.pinned };
  if (activeTab === 'memory') renderFiles(filesMatchIds);
}

function setFilesFilter(value) {
  saveFilesFilter(localStorage, value);
  filesFilter = loadFilesFilter(localStorage);
  syncFilesFilterSelect();
  if (activeTab === 'memory') renderFiles(filesMatchIds);
}

function syncFilesFilterSelect() {
  if (!filesFilterSelect) return;
  filesFilterSelect.value = filesFilter;
  filesFilterSelect.classList.toggle('is-on', filesFilter !== 'all');
}

if (filesFilterSelect) {
  syncFilesFilterSelect();
  filesFilterSelect.addEventListener('change', () => setFilesFilter(filesFilterSelect.value));
}

function filesEmptyText(matchIds) {
  if (matchIds) return 'No files match the search.';
  if (filesFilter === 'agents') return 'No agent files found.';
  if (filesFilter === 'opened') return 'No opened files yet. Drop a file on the sidebar to open it.';
  return 'No files yet. Drop a file on the sidebar to open it.';
}

/** Draw the tab, narrowed to `matchIds` (the paths a search found) when given. */
function renderFiles(matchIds = null) {
  filesMatchIds = matchIds;
  const sections = buildFilesSections({
    agents: cachedMemoryData, opened: cachedOpenedFiles, filter: filesFilter, matchIds,
  });
  memoryContent.innerHTML = '';
  if (filesSectionsEmpty(sections)) {
    const empty = document.createElement('div');
    empty.className = 'plans-empty';
    empty.textContent = filesEmptyText(matchIds);
    memoryContent.appendChild(empty);
    return;
  }
  const openedPaths = new Set(cachedOpenedFiles.opened.map(f => f.filePath));
  if (sections.pinned.length) {
    const rows = sections.pinned.map(p => buildFileItem(p.file, { agent: p.agent, opened: p.opened, pinned: true }));
    memoryContent.appendChild(buildMemoryGroup('__pinned__', 'Pinned', rows, { className: 'files-pinned-group' }));
  }
  if (sections.opened.length) {
    const rows = sections.opened.map(f => buildFileItem(f, { agent: isAgentFilePath(f.filePath), opened: true, pinned: false }));
    memoryContent.appendChild(buildMemoryGroup('__opened__', 'Opened', rows));
  }
  for (const group of sections.groups) {
    const rows = group.files.map(f => buildFileItem(f, { agent: true, opened: openedPaths.has(f.filePath), pinned: false }));
    memoryContent.appendChild(buildMemoryGroup(group.key, group.label, rows));
  }
  if (currentMemoryFilePath) markActiveFile(currentMemoryFilePath);
}

function buildMemoryGroup(key, label, rows, { className = '' } = {}) {
  const group = document.createElement('div');
  group.className = 'project-group' + (className ? ` ${className}` : '');
  const isCollapsed = memoryCollapsedState.get(key) === true; // default expanded
  if (isCollapsed) group.classList.add('collapsed');

  // Header
  const header = document.createElement('div');
  header.className = 'project-header';

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.innerHTML = '&#9660;';
  header.appendChild(arrow);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'project-name';
  nameSpan.textContent = label;
  header.appendChild(nameSpan);

  const countBadge = document.createElement('span');
  countBadge.className = 'memory-file-count';
  countBadge.textContent = rows.length;
  header.appendChild(countBadge);

  header.addEventListener('click', () => {
    const nowCollapsed = !group.classList.contains('collapsed');
    group.classList.toggle('collapsed');
    memoryCollapsedState.set(key, nowCollapsed);
  });

  group.appendChild(header);

  // Files list
  const filesList = document.createElement('div');
  filesList.className = 'project-sessions';
  for (const row of rows) filesList.appendChild(row);
  group.appendChild(filesList);

  return group;
}

function fileRowIcon(file, agent) {
  const icon = document.createElement('span');
  // Agent files keep their icons: a clock for schedule-*.md, a brain for the rest.
  if (agent) {
    const isSchedule = file.filename.startsWith('schedule-');
    icon.className = isSchedule ? 'memory-schedule-icon' : 'memory-brain-icon';
    icon.innerHTML = isSchedule ? ICONS.schedule(15) : BRAIN_ICON;
  } else {
    icon.className = 'memory-file-icon';
    icon.innerHTML = typeof fileIconHtml === 'function' ? fileIconHtml(file.filename) : '';
  }
  return icon;
}

function fileRowButton(className, title, html, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `session-move-btn ${className}`;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = html;
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

/** A row of the tab, as the agent files' rows have always looked. */
function buildFileItem(file, { agent, opened, pinned }) {
  const item = document.createElement('div');
  item.className = 'session-item memory-item' + (pinned ? ' is-pinned' : '');
  item.dataset.filepath = file.filePath;
  const missing = file.exists === false;
  if (missing) item.classList.add('is-missing');

  const row = document.createElement('div');
  row.className = 'session-row';
  row.appendChild(fileRowIcon(file, agent));

  const info = document.createElement('div');
  info.className = 'session-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'session-summary';
  titleEl.textContent = file.filename;

  const pathEl = document.createElement('div');
  pathEl.className = 'session-id';
  pathEl.textContent = file.displayPath || '';
  pathEl.title = file.filePath;

  const metaEl = document.createElement('div');
  metaEl.className = 'session-meta';
  metaEl.textContent = missing ? 'File not found' : (file.modified ? formatDate(new Date(file.modified)) : '');

  info.appendChild(titleEl);
  info.appendChild(pathEl);
  info.appendChild(metaEl);
  row.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'session-actions';
  const pin = fileRowButton(`files-pin-btn${pinned ? ' on' : ''}`, pinned ? 'Unpin' : 'Pin to the top',
    ICONS.pin(14), () => toggleFilePinned(file.filePath, !pinned));
  pin.setAttribute('aria-pressed', String(pinned));
  actions.appendChild(pin);
  if (opened) {
    actions.appendChild(fileRowButton('files-remove-btn', 'Remove from list', FILES_ICONS.x(14),
      () => removeFileFromList(file.filePath)));
  }
  row.appendChild(actions);
  item.appendChild(row);

  item.addEventListener('click', () => {
    if (missing) { offerRemoveMissing(file, { opened, pinned }); return; }
    openFileHere(file.filePath);
  });
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showFileMenu(file, { agent, opened, pinned, missing }, { x: e.clientX, y: e.clientY });
  });
  if (pinned) bindPinnedDrag(item, file.filePath);
  return item;
}

function offerRemoveMissing(file, { opened, pinned }) {
  if (!opened && !pinned) return;
  const what = !opened ? 'Unpin it?'
    : pinned ? 'It is pinned. Are you sure you want to remove it from the list?'
    : 'Remove it from the list?';
  if (!confirm(`${file.filename} is no longer at\n${file.filePath}\n\n${what}`)) return;
  if (opened) removeFileFromList(file.filePath, { confirmed: true });
  else toggleFilePinned(file.filePath, false);
}

function showFileMenu(file, { opened, pinned, missing }, position) {
  const pinnedPaths = cachedOpenedFiles.pinned.map(f => f.filePath);
  const up = pinned ? pinnedStep(pinnedPaths, file.filePath, -1) : null;
  const down = pinned ? pinnedStep(pinnedPaths, file.filePath, 1) : null;
  const revealLabel = window.api.platform === 'darwin' ? 'Reveal in Finder'
    : window.api.platform === 'win32' ? 'Show in Explorer' : 'Show in folder';
  const items = [
    { label: 'Open here', icon: FILES_ICONS.here(14), disabled: missing, onClick: () => openFileHere(file.filePath) },
    { label: 'Open in new window', icon: ICONS.popOut(14), disabled: missing, onClick: () => openFileInWindow(file.filePath) },
    { sep: true },
    { label: pinned ? 'Unpin' : 'Pin to the top', icon: ICONS.pin(14), onClick: () => toggleFilePinned(file.filePath, !pinned) },
  ];
  if (pinned) {
    items.push(
      { label: 'Move up', icon: FILES_ICONS.up(14), disabled: up === null, onClick: () => moveFilePinned(file.filePath, up) },
      { label: 'Move down', icon: FILES_ICONS.down(14), disabled: down === null, onClick: () => moveFilePinned(file.filePath, down) },
    );
  }
  items.push({ sep: true }, { label: revealLabel, icon: ICONS.folderOpen(14), disabled: missing, onClick: () => window.api.revealFile(file.filePath) });
  if (opened) items.push({ label: 'Remove from list', icon: FILES_ICONS.x(14), danger: true, onClick: () => removeFileFromList(file.filePath) });
  showContextMenu(items, position);
}

// --- Pinned files: order by dragging ---

function bindPinnedDrag(item, filePath) {
  item.draggable = true;
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(PINNED_FILE_TYPE, filePath);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('is-dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('is-dragging');
    clearPinnedDropMarks();
  });
  const isPinnedDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(PINNED_FILE_TYPE);
  const lowerHalf = (e) => {
    const rect = item.getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2;
  };
  item.addEventListener('dragover', (e) => {
    if (!isPinnedDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearPinnedDropMarks(item);
    const after = lowerHalf(e);
    item.classList.toggle('drop-after', after);
    item.classList.toggle('drop-before', !after);
  });
  item.addEventListener('dragleave', (e) => {
    if (!item.contains(e.relatedTarget)) item.classList.remove('drop-before', 'drop-after');
  });
  item.addEventListener('drop', (e) => {
    if (!isPinnedDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const fromPath = e.dataTransfer.getData(PINNED_FILE_TYPE);
    const after = lowerHalf(e);
    clearPinnedDropMarks();
    const index = pinnedDropIndex(cachedOpenedFiles.pinned.map(f => f.filePath), fromPath, filePath, after);
    if (index !== null) moveFilePinned(fromPath, index);
  });
}

function clearPinnedDropMarks(except) {
  memoryContent.querySelectorAll('.memory-item.drop-before, .memory-item.drop-after').forEach((el) => {
    if (el !== except) el.classList.remove('drop-before', 'drop-after');
  });
}

// --- Changes to the list ---

async function toggleFilePinned(filePath, pinned) {
  try { applyOpenedFiles(await window.api.setFilePinned(filePath, pinned)); }
  catch (err) { alert(err.message || 'Could not change the pin.'); }
}

async function moveFilePinned(filePath, toIndex) {
  if (toIndex === null || toIndex === undefined) return;
  try { applyOpenedFiles(await window.api.movePinnedFile(filePath, toIndex)); }
  catch (err) { alert(err.message || 'Could not move the file.'); }
}

function isPinnedFilePath(filePath) {
  return cachedOpenedFiles.pinned.some(f => f.filePath === filePath);
}

/**
 * As if the file had never been opened in the app. The file itself stays where
 * it is. A pinned file is unpinned too, so it asks first, unless the caller
 * already did (`confirmed`).
 */
async function removeFileFromList(filePath, { confirmed = false } = {}) {
  if (!confirmed && isPinnedFilePath(filePath)
    && !confirm(`“${fileBaseName(filePath)}” is pinned. Are you sure you want to remove it from the list?\n\nIt is unpinned too. The file itself stays on disk.`)) return;
  try { applyOpenedFiles(await window.api.removeOpenedFile(filePath)); }
  catch (err) { alert(err.message || 'Could not remove the file from the list.'); }
}

// --- Opening a file ---

function markActiveFile(filePath) {
  memoryContent.querySelectorAll('.memory-item.active').forEach(el => el.classList.remove('active'));
  const target = memoryContent.querySelector(`.memory-item[data-filepath="${CSS.escape(filePath)}"]`);
  if (target) target.classList.add('active');
  return target;
}

/** Show the file in the main area's editor, whatever its kind (text, image, PDF…). */
async function openFileHere(filePath) {
  // Unsaved changes in the file shown: Save, Don't Save or stay on it.
  if (memoryPanel.filePath && memoryPanel.filePath !== filePath && !(await memoryPanel.confirmLeave())) return;
  const request = ++filesOpenRequest;
  currentMemoryFilePath = filePath;
  const row = markActiveFile(filePath);
  if (row) row.scrollIntoView({ block: 'nearest' });

  let result;
  try { result = await window.api.readFileForPanel(filePath); } catch (err) { result = { ok: false, error: err.message }; }
  if (request !== filesOpenRequest) return;
  if (await openUnsupportedFile(result, filePath)) return;
  if (!result?.ok) { alert(result?.error || 'Unable to open the file.'); return; }

  // Show memory viewer in main area
  if (typeof hideProjectChrome === 'function') hideProjectChrome();
  placeholder.style.display = 'none';
  terminalArea.style.display = 'none';
  planViewer.style.display = 'none';
  statsViewer.style.display = 'none';
  settingsViewer.style.display = 'none';
  processViewer.style.display = 'none';
  // The message history sits over this viewer when it stays shown (and takes its Cmd+F).
  jsonlViewer.style.display = 'none';
  memoryViewer.style.display = 'flex';

  memoryPanel.open(fileBaseName(filePath), filePath, result.content || '', result);
}

function openFileInWindow(filePath) {
  return window.api.openFileWindow(filePath).then((opened) => {
    if (!opened) alert(`Could not open ${fileBaseName(filePath)} in a window: it is no longer there.`);
  }).catch(err => alert(err.message || 'Could not open the window.'));
}

/** The editor's pop-out: what it shows, saved first, in a window of its own. */
async function popOutCurrentFile() {
  const filePath = memoryPanel.filePath;
  if (!filePath) return;
  if (memoryPanel.isDirty()) await memoryPanel.flush();
  openFileInWindow(filePath);
}

/** The editor's Save: agent files as before (save-memory), any other file as the file panel does. */
function saveFilesViewFile(filePath, content) {
  return isAgentFilePath(filePath) && /\.md$/i.test(filePath)
    ? window.api.saveMemory(filePath, content)
    : window.api.saveFileForPanel(filePath, content);
}

/**
 * Files dropped on the sidebar (files-drop.js): into the list, then on the
 * Files tab's editor (`here`) or each in a window of its own (`window`).
 */
async function openDroppedFiles(paths, target) {
  if (!paths.length) return;
  let result;
  try { result = await window.api.addOpenedFiles(paths); } catch (err) { alert(err.message || 'Could not open the files.'); return; }
  if (!result) return;
  applyOpenedFiles(result);
  if (result.rejected?.length) {
    const lines = result.rejected.map(r => `${fileBaseName(r.filePath)}: ${r.reason}`);
    alert(`${lines.length === 1 ? 'This item' : 'These items'} could not be opened:\n\n${lines.join('\n')}`);
  }
  const files = result.added || [];
  if (!files.length) return;

  if (target === 'window') {
    for (const filePath of files) await openFileInWindow(filePath);
    return;
  }
  // Open here: the Files tab, with the file in sight.
  if (filesFilter === 'agents') setFilesFilter('all');
  if (activeTab !== 'memory') document.querySelector('.sidebar-tab[data-tab="memory"]')?.click();
  else renderFiles(filesMatchIds);
  await openFileHere(files[0]);
}
