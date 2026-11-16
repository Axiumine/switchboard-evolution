// project-files-view.js — the Files tab of a project page.
//
// One tab for the project folder and one for each attached folder, each an
// explorer: a tree beside an editor, with the actions a code editor's
// explorer has (new file and folder, cut / copy / paste, duplicate, rename,
// delete, compare, open to the side, open with, the Timeline of a file from
// git, and adding a file to a chat). The editor belongs to the page, not to a
// tab: switching tabs changes the tree and leaves the open file where it is.
//
// One ViewerPanel serves the whole page. Its DOM moves between renders rather
// than being rebuilt, so an unsaved edit survives the re-render that every
// projects-changed event triggers, and the file is not reloaded underneath
// the cursor. The side editor and a diff view are kept the same way. Saving
// CLAUDE.md or AGENTS.md of the project folder goes through
// save-project-brief, which writes both files and every worktree's bridge copy.
//
// Depends on globals from projects-view.js (projectsUi, projectViewer, PICONS,
// selectedProject, findTreeProject, showContextMenu, showPromptDialog,
// renderPlanMeta, fileKey, folderChipLabel, launchTargetFor,
// projectSessionsAll, sessionTitle, cliIcon, setProjectTab, renderOverview),
// app.js (activePtyIds, launchNewSession, openSession, sessionEventTime),
// dialogs.js (launchTerminalSession, resolveDefaultSessionOptions),
// file-actions.js (projectEntryPath, remapFileActionPath,
// remapFileActionRelative, openUnsupportedFile), utils.js (escapeHtml,
// shellEscape), viewer-panel.js and codemirror-bundle.js.

const FILES_LIST_TTL_MS = 10 * 1000;
// Files the brief names and the agent creates on demand; opening one from a
// card creates it so there is something to edit.
const PROJECT_OWN_FILES = ['plan.md', 'plan-tracker.md', 'todos.md', 'memory.md'];
let projectEditor = null; // { host, panel, projectId, root, rel }
let projectSideEditor = null; // "Open to the Side": { host, panel, projectId, root, rel }
let projectDiffView = null; // a comparison or a Timeline change shown in place of the editor
let filesClipboard = null; // { mode: 'copy' | 'cut', root, rel, name, isDir }
let filesCompareSource = null; // { root, rel, name }

const FICONS = {
  newFile: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 12v6"/><path d="M9 15h6"/></svg>`,
  newFolder: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>`,
  collapse: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/></svg>`,
  side: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></svg>`,
  compare: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/></svg>`,
  chat: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  copy: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  cut: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9"/><path d="M14.5 14.5 20 20"/><path d="M8.1 8.1 12 12"/></svg>`,
  paste: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
};

const isMacPlatform = () => window.api.platform === 'darwin';
/** A shortcut as the menus show it: the macOS glyphs, or Ctrl/Alt words elsewhere. */
function filesKeyHint(mac, other) { return isMacPlatform() ? mac : other; }

// --- Roots: the project folder, then every attached folder ---

function filesRoots(project) {
  const roots = [{ path: project.root, label: 'Project', kind: 'project' }];
  for (const folder of project.folders || []) {
    if (!folder?.path || folder.path === project.root || roots.some(r => r.path === folder.path)) continue;
    const label = typeof folderChipLabel === 'function' ? folderChipLabel(project, folder) : pathBasename(folder.path);
    roots.push({ path: folder.path, label, kind: folder.mode === 'worktree' ? 'worktree' : 'folder', folder });
  }
  return roots;
}

function filesUi(project) {
  if (!projectsUi.filesByProject) projectsUi.filesByProject = {};
  let ui = projectsUi.filesByProject[project.id];
  if (!ui) ui = projectsUi.filesByProject[project.id] = { root: project.root, roots: new Map() };
  return ui;
}

/** The root whose tab is showing; the project folder when its folder was detached. */
function currentFilesRoot(project) {
  const ui = filesUi(project);
  // Not overwritten: a folder missing from one refresh comes back with the next.
  return filesRoots(project).some(r => r.path === ui.root) ? ui.root : project.root;
}

// Hidden from the tree, as a code editor's explorer hides them by default.
const FILES_HIDDEN = new Set(['.git', '.svn', '.hg', 'CVS', '.DS_Store', 'Thumbs.db']);

function filesState(project, root = currentFilesRoot(project)) {
  const ui = filesUi(project);
  let state = ui.roots.get(root);
  if (!state) {
    state = { root, expanded: new Set(), selected: null, cache: new Map(), timeline: null };
    ui.roots.set(root, state);
  }
  return state;
}

/** The root of the project's tabs that holds an absolute path, the deepest one first. */
function filesRootFor(project, filePath) {
  const roots = filesRoots(project).map(r => r.path).sort((a, b) => b.length - a.length);
  return roots.find(root => filePath === root || filePath.startsWith(root + '/') || filePath.startsWith(root + '\\')) || null;
}

function relativeIn(root, filePath) {
  return filePath === root ? '' : filePath.slice(root.length + 1);
}

function parentRelative(rel) {
  const index = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'));
  return index < 0 ? '' : rel.slice(0, index);
}

function entryNameOf(rel, root) {
  return rel ? pathBasename(rel) : pathBasename(root);
}

// --- The editors ---

function ensureProjectEditor() {
  if (projectEditor) return projectEditor;
  const host = document.createElement('div');
  host.className = 'ws-editor-panel';
  const panel = new ViewerPanel(host, {
    copyPath: true, copyContent: true, language: 'auto', storageKey: 'markdownPreviewMode',
    onSave: (filePath, content) => saveProjectEditorFile(projectEditor, filePath, content),
  });
  projectEditor = { host, panel, projectId: null, root: null, rel: null };
  return projectEditor;
}

function ensureSideEditor() {
  if (projectSideEditor) return projectSideEditor;
  const host = document.createElement('div');
  host.className = 'ws-editor-panel';
  const panel = new ViewerPanel(host, {
    copyPath: true, copyContent: true, language: 'auto', storageKey: 'markdownPreviewMode',
    onSave: (filePath, content) => saveProjectEditorFile(projectSideEditor, filePath, content),
    onClose: () => closeSideEditor(),
  });
  projectSideEditor = { host, panel, projectId: null, root: null, rel: null };
  return projectSideEditor;
}

function closeSideEditor() {
  const side = projectSideEditor;
  if (!side) return;
  side.panel.destroy();
  side.projectId = side.root = side.rel = null;
  const pane = projectViewer?.querySelector('#ws-editor-side');
  if (pane) { pane.replaceChildren(); pane.hidden = true; }
  projectViewer?.querySelector('.ws-editor-area')?.classList.remove('has-side');
}

function isBriefFile(ed, project) {
  return ed.root === project.root && (ed.rel === 'CLAUDE.md' || ed.rel === 'AGENTS.md');
}

async function saveProjectEditorFile(ed, filePath, content) {
  const project = ed ? findTreeProject(ed.projectId) : null;
  if (!project) return { ok: false };
  const brief = isBriefFile(ed, project);
  let result;
  if (brief) {
    result = await window.api.saveProjectBrief(project.id, content);
  } else {
    result = await window.api.saveFileForPanel(filePath, content);
  }
  if (!result || result.error || result.ok === false) {
    alert(result?.error || 'Could not save the file.');
    return { ok: false };
  }
  // The brief comes back with its folder block restored when the user had
  // removed it; show what is on disk now.
  if (brief && typeof result.content === 'string' && result.content !== content) {
    ed.panel.open(`${project.name} · ${ed.rel}`, filePath, result.content);
  }
  const saved = brief && typeof result.content === 'string' ? result.content : content;
  if (ed.root === project.root && ['CLAUDE.md', 'plan.md', 'plan-tracker.md', 'todos.md'].includes(ed.rel)) {
    projectsUi.files.set(fileKey(project, ed.rel), { content: saved, at: Date.now() });
    renderPlanMeta(project);
  }
  return { ok: true };
}

function editorTitle(project, root, rel) {
  const label = root === project.root ? project.name : `${project.name} · ${pathBasename(root)}`;
  return `${label} · ${rel}`;
}

function markSelectedRow(rel) {
  projectViewer?.querySelectorAll('.ws-file-row').forEach(r => r.classList.toggle('selected', r.dataset.rel === rel));
}

async function readForEditor(project, root, rel) {
  let result;
  try { result = await window.api.readProjectFile(root, rel); } catch (err) { result = { ok: false, error: err.message }; }
  // The project's own files are not made up front; opening one to write it
  // is the moment it comes into being.
  if (!result?.ok && root === project.root && PROJECT_OWN_FILES.includes(rel)) {
    const created = await window.api.createProjectFile(project.id, rel);
    if (created?.ok) {
      try { result = await window.api.readProjectFile(root, rel); } catch (err) { result = { ok: false, error: err.message }; }
      filesState(project, root).cache.clear();
    }
  }
  return result;
}

async function openFileInProjectEditor(project, rel, { allowExternal = false, root = currentFilesRoot(project) } = {}) {
  const state = filesState(project, root);
  state.selected = rel;
  const request = state.openRequest = (state.openRequest || 0) + 1;
  const host = projectViewer?.querySelector('#ws-editor');
  if (!host) return;
  markSelectedRow(rel);
  const ed = ensureProjectEditor();
  const filePath = projectEntryPath(root, rel);
  closeDiffView({ restore: false });
  // Same file already open: keep the editor and whatever is typed in it.
  if (ed.projectId === project.id && ed.root === root && ed.rel === rel && ed.panel.filePath === filePath) {
    host.replaceChildren(ed.host);
    return;
  }
  const result = await readForEditor(project, root, rel);
  if (state.openRequest !== request || !host.isConnected || selectedProject()?.id !== project.id) return;
  if (result?.code === 'PREVIEW_UNAVAILABLE') {
    // Restoring the Files tab must never launch another application.
    state.selected = ed.projectId === project.id && ed.root === root ? ed.rel : null;
    markSelectedRow(state.selected);
    if (ed.projectId === project.id && ed.panel.filePath) host.replaceChildren(ed.host);
    if (allowExternal) await openUnsupportedFile(result, filePath, root);
    return;
  }
  if (!result?.ok) {
    host.innerHTML = `<div class="ws-editor-empty">${escapeHtml(result?.error || 'Could not open the file.')}</div>`;
    return;
  }
  ed.projectId = project.id;
  ed.root = root;
  ed.rel = rel;
  host.replaceChildren(ed.host);
  ed.panel.open(editorTitle(project, root, rel), result.filePath || filePath, result.content, result);
}

/** "Open to the Side": the file in a second editor beside the first. */
async function openFileToSide(project, root, rel) {
  const area = projectViewer?.querySelector('.ws-editor-area');
  const pane = projectViewer?.querySelector('#ws-editor-side');
  if (!area || !pane) return;
  const side = ensureSideEditor();
  const filePath = projectEntryPath(root, rel);
  if (!(side.projectId === project.id && side.root === root && side.rel === rel && side.panel.filePath === filePath)) {
    const result = await readForEditor(project, root, rel);
    if (result?.code === 'PREVIEW_UNAVAILABLE') { await openUnsupportedFile(result, filePath, root); return; }
    if (!result?.ok) { alert(result?.error || 'Could not open the file.'); return; }
    side.projectId = project.id;
    side.root = root;
    side.rel = rel;
    side.panel.open(editorTitle(project, root, rel), result.filePath || filePath, result.content, result);
  }
  pane.hidden = false;
  pane.replaceChildren(side.host);
  area.classList.add('has-side');
}

/** A read-only diff in place of the editor, with a bar to close it. */
function showDiffView(project, { title, detail = '', oldContent, newContent, filename }) {
  const host = projectViewer?.querySelector('#ws-editor');
  if (!host) return;
  closeDiffView({ restore: false });
  const el = document.createElement('div');
  el.className = 'ws-diff-view';
  el.innerHTML = `
    <div class="ws-diff-head">
      <span class="ws-diff-icon">${FICONS.compare(13)}</span>
      <span class="ws-diff-title">${escapeHtml(title)}</span>
      ${detail ? `<span class="ws-diff-detail">${escapeHtml(detail)}</span>` : ''}
      <span class="ws-flex"></span>
      <button type="button" class="ws-ghost ws-files-action ws-diff-close" title="Close" aria-label="Close">${PICONS.x(12)}</button>
    </div>
    <div class="ws-diff-body"></div>`;
  const body = el.querySelector('.ws-diff-body');
  let view = null;
  if (oldContent === newContent) {
    body.innerHTML = '<div class="ws-editor-empty">No differences.</div>';
  } else if (typeof createUnifiedMergeViewer === 'function') {
    view = createUnifiedMergeViewer(body, oldContent, newContent, filename, { readOnly: true });
  }
  el.querySelector('.ws-diff-close').onclick = () => closeDiffView();
  projectDiffView = { projectId: project.id, el, view };
  host.replaceChildren(el);
}

function closeDiffView({ restore = true } = {}) {
  const diff = projectDiffView;
  if (!diff) return;
  projectDiffView = null;
  try { diff.view?.destroy?.(); } catch {}
  diff.el.remove();
  if (!restore) return;
  const host = projectViewer?.querySelector('#ws-editor');
  if (!host) return;
  const ed = projectEditor;
  if (ed?.projectId === diff.projectId && ed.panel.filePath) host.replaceChildren(ed.host);
  else host.innerHTML = '<div class="ws-editor-empty">Pick a file to read or edit it here.</div>';
}

// --- The tree ---

async function listProjectDir(project, state, rel) {
  const cached = state.cache.get(rel);
  if (cached && Date.now() - cached.at < FILES_LIST_TTL_MS) return cached.entries;
  let result;
  const generation = state.cacheGeneration || 0;
  try { result = await window.api.listProjectDirectory(state.root || project.root, rel); } catch (err) { result = { ok: false, error: err.message }; }
  if (generation !== (state.cacheGeneration || 0)) return [];
  const entries = result?.ok ? result.entries : [];
  state.cache.set(rel, { at: Date.now(), entries, error: result?.ok ? null : (result?.error || 'Could not read the folder') });
  return entries;
}

/**
 * After a file action anywhere (this tab, a session's file browser): drop the
 * listings, follow a renamed or moved entry in every tab's selection, open
 * folders, Timeline and editors, and close what was deleted.
 */
async function applyProjectFileAction(change) {
  const follows = !['create', 'duplicate', 'copy'].includes(change.action);
  for (const [projectId, ui] of Object.entries(projectsUi.filesByProject || {})) {
    const project = findTreeProject(projectId);
    if (!project || !ui?.roots) continue;
    for (const state of ui.roots.values()) {
      state.cache.clear();
      state.cacheGeneration = (state.cacheGeneration || 0) + 1;
      state.renderRequest = (state.renderRequest || 0) + 1;
      if (!follows) continue;
      const selected = remapFileActionRelative(state.root, state.selected, change);
      if (selected !== state.selected) state.openRequest = (state.openRequest || 0) + 1;
      state.selected = selected;
      state.expanded = new Set([...state.expanded].map(rel => remapFileActionRelative(state.root, rel, change)).filter(Boolean));
      if (state.timeline) {
        const rel = remapFileActionRelative(state.root, state.timeline.rel, change);
        if (!rel) state.timeline = null;
        else if (rel !== state.timeline.rel) state.timeline = { ...state.timeline, rel, name: pathBasename(rel), data: null };
      }
    }
    if (!follows) continue;
    for (const key of projectsUi.files.keys()) {
      if (!key.startsWith(projectId + ':')) continue;
      const rel = key.slice(projectId.length + 1);
      if (remapFileActionRelative(project.root, rel, change) !== rel) projectsUi.files.delete(key);
    }
  }
  if (follows) {
    for (const clip of [filesClipboard, filesCompareSource]) {
      if (!clip) continue;
      const next = remapFileActionPath(projectEntryPath(clip.root, clip.rel), change);
      if (next === projectEntryPath(clip.root, clip.rel)) continue;
      if (clip === filesClipboard) filesClipboard = null; else filesCompareSource = null;
    }
    for (const ed of [projectEditor, projectSideEditor]) {
      if (!ed?.panel.filePath) continue;
      const next = remapFileActionPath(ed.panel.filePath, change);
      if (next === ed.panel.filePath) continue;
      const project = findTreeProject(ed.projectId);
      const root = next && project ? filesRootFor(project, next) : null;
      if (root) {
        ed.root = root;
        ed.rel = relativeIn(root, next);
        await ed.panel.relocate(editorTitle(project, root, ed.rel), next);
      } else if (ed === projectSideEditor) {
        closeSideEditor();
      } else {
        ed.panel.destroy();
        ed.projectId = ed.root = ed.rel = null;
        const host = projectViewer?.querySelector('#ws-editor');
        if (host?.contains(ed.host)) host.innerHTML = '<div class="ws-editor-empty">Pick a file to read or edit it here.</div>';
      }
    }
  }
  await rerenderFilesTree();
}

async function rerenderFilesTree() {
  const project = selectedProject();
  const list = projectViewer?.querySelector('#ws-files-list');
  if (!project || !list?.isConnected) return;
  const state = filesState(project, list.dataset.root || currentFilesRoot(project));
  await renderFileTree(project, list, state);
  renderTimeline(project, state);
}

async function renderFileTree(project, list, state) {
  const request = state.renderRequest = (state.renderRequest || 0) + 1;
  const rows = [];
  async function walk(rel, depth) {
    const entries = await listProjectDir(project, state, rel);
    for (const entry of entries) {
      if (FILES_HIDDEN.has(entry.name)) continue;
      rows.push({ entry, depth });
      if (entry.type === 'directory' && state.expanded.has(entry.relativePath)) await walk(entry.relativePath, depth + 1);
    }
  }
  await walk('', 0);
  if (!list.isConnected || state.renderRequest !== request) return;
  const focused = list.contains(document.activeElement) ? document.activeElement?.dataset?.rel : null;
  list.replaceChildren();
  const rootError = state.cache.get('')?.error;
  if (rootError) { list.innerHTML = `<div class="ws-card-text muted">${escapeHtml(rootError)}</div>`; return; }
  if (!rows.length) { list.innerHTML = `<div class="ws-card-text muted">${state.root === project.root ? 'The project folder is empty.' : 'This folder is empty.'}</div>`; return; }
  const root = state.root;
  for (const { entry, depth } of rows) {
    const isDir = entry.type === 'directory';
    const open = isDir && state.expanded.has(entry.relativePath);
    const cut = filesClipboard?.mode === 'cut' && filesClipboard.root === root && filesClipboard.rel === entry.relativePath;
    const row = document.createElement('div');
    row.className = 'ws-file-row' + (isDir ? ' is-dir' : '') + (!isDir && entry.type !== 'file' ? ' is-binary' : '') +
      (state.selected === entry.relativePath ? ' selected' : '') + (cut ? ' is-cut' : '');
    row.dataset.rel = entry.relativePath;
    row.tabIndex = 0;
    row.setAttribute('role', 'treeitem');
    if (isDir) row.setAttribute('aria-expanded', String(open));
    row.style.paddingLeft = `${10 + depth * 14}px`;
    row.title = entry.type === 'file' && entry.viewable === false ? entry.relativePath + '\nOpen in default application' : entry.relativePath;
    row.innerHTML = `<span class="ws-file-icon">${isDir ? (open ? '&#9662;' : '&#9656;') : ''}</span><span class="ws-file-name">${escapeHtml(entry.name)}</span>`;
    const activate = async () => {
      if (isDir) {
        if (open) state.expanded.delete(entry.relativePath); else state.expanded.add(entry.relativePath);
        await renderFileTree(project, list, state);
        list.querySelector(`.ws-file-row[data-rel="${CSS.escape(entry.relativePath)}"]`)?.focus();
        return;
      }
      if (entry.type !== 'file') return;
      openFileInProjectEditor(project, entry.relativePath, { allowExternal: true, root });
    };
    row.onclick = activate;
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(explorerMenuItems(project, root, entry), { x: event.clientX, y: event.clientY });
    });
    row.addEventListener('keydown', (event) => onExplorerKey(event, project, root, entry, row, activate));
    list.appendChild(row);
  }
  if (focused) list.querySelector(`.ws-file-row[data-rel="${CSS.escape(focused)}"]`)?.focus();
}

/** The explorer's shortcuts on a focused row (or on the empty tree for `entry` null). */
function onExplorerKey(event, project, root, entry, row, activate) {
  const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
  const key = event.key;
  const act = (fn) => { event.preventDefault(); event.stopPropagation(); fn(); };
  if (key === 'ContextMenu' || (event.shiftKey && key === 'F10')) {
    return act(() => showContextMenu(explorerMenuItems(project, root, entry), entry ? { anchor: row } : { x: 40, y: 120 }));
  }
  if (mod && !event.altKey && !event.shiftKey && key.toLowerCase() === 'v') return act(() => explorerPaste(project, root, entry));
  if (!entry) return;
  const rel = entry.relativePath;
  if (mod && event.altKey && event.shiftKey && key.toLowerCase() === 'c') return act(() => window.api.writeClipboard(rel));
  if (mod && event.altKey && !event.shiftKey && (key.toLowerCase() === 'c' || event.code === 'KeyC')) return act(() => window.api.writeClipboard(projectEntryPath(root, rel)));
  if (mod && event.altKey && (key.toLowerCase() === 'r' || event.code === 'KeyR')) return act(() => explorerManage(project, root, entry, 'reveal'));
  if (mod && !event.altKey && !event.shiftKey && key.toLowerCase() === 'c') return act(() => explorerClip(project, root, entry, 'copy'));
  if (mod && !event.altKey && !event.shiftKey && key.toLowerCase() === 'x') return act(() => explorerClip(project, root, entry, 'cut'));
  if ((mod && key === 'Backspace') || (!isMacPlatform() && key === 'Delete')) return act(() => explorerManage(project, root, entry, 'trash'));
  if (event.ctrlKey && key === 'Enter' && entry.type === 'file') return act(() => openFileToSide(project, root, rel));
  if ((isMacPlatform() && key === 'Enter' && !event.metaKey && !event.ctrlKey) || key === 'F2') return act(() => explorerManage(project, root, entry, 'rename'));
  if (key === ' ' || (!isMacPlatform() && key === 'Enter') || (event.metaKey && key === 'ArrowDown')) return act(activate);
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    return act(() => (key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling)?.focus());
  }
  if (key === 'ArrowRight' && entry.type === 'directory' && row.getAttribute('aria-expanded') === 'false') return act(activate);
  if (key === 'ArrowLeft' && entry.type === 'directory' && row.getAttribute('aria-expanded') === 'true') return act(activate);
}

// --- Actions ---

async function explorerResult(project, result, fallback) {
  if (!result?.ok) { alert(result?.error || fallback); return null; }
  if (result.cancelled) return null;
  if (typeof applyProjectFileAction === 'function') await applyProjectFileAction(result);
  // A session's file browser follows renames and moves the same way.
  if (['rename', 'trash', 'move'].includes(result.action) && typeof applyBrowserFileAction === 'function') await applyBrowserFileAction(result);
  return result;
}

async function explorerManage(project, root, entry, action) {
  if ((action === 'rename' || action === 'trash') && typeof canManageBrowserEntry === 'function' && !canManageBrowserEntry(root, entry.relativePath)) {
    alert('Resolve or close the open diff for this item before changing it.');
    return;
  }
  let name;
  if (action === 'rename') {
    name = await showPromptDialog({ title: 'Rename ' + entry.name, label: 'Name', value: entry.name, confirm: 'Rename' });
    if (!name || name === entry.name) return;
  }
  let result;
  try { result = await window.api.manageProjectEntry(root, entry.relativePath, action, name); } catch (err) { result = { ok: false, error: err.message }; }
  if (action === 'reveal' || action === 'open-folder') { if (!result?.ok) alert(result?.error || 'Could not show the item.'); return; }
  await explorerResult(project, result, 'Could not complete the file action.');
}

async function explorerNewEntry(project, root, folderRel, kind) {
  const where = folderRel ? `${pathBasename(root)}/${folderRel}` : pathBasename(root);
  const name = await showPromptDialog({
    title: kind === 'file' ? 'New File' : 'New Folder', label: 'Name', confirm: 'Create',
    placeholder: kind === 'file' ? 'notes.md' : 'docs',
    help: `In ${where}. Use / to create folders on the way, as in docs/notes.md.`,
  });
  if (!name) return;
  let result;
  try { result = await window.api.createProjectEntry(root, folderRel, name, kind); } catch (err) { result = { ok: false, error: err.message }; }
  if (!await explorerResult(project, result, `Could not create the ${kind}.`)) return;
  const state = filesState(project, root);
  // Show the new entry: open the folders on the way, and open a new file in the editor.
  const parts = result.relativePath.split(/[\\/]/);
  for (let i = 1; i < parts.length; i++) state.expanded.add(parts.slice(0, i).join('/'));
  if (kind === 'folder') state.expanded.add(result.relativePath);
  await rerenderFilesTree();
  if (kind === 'file') await openFileInProjectEditor(project, result.relativePath, { root });
}

function explorerClip(project, root, entry, mode) {
  filesClipboard = { mode, root, rel: entry.relativePath, name: entry.name, isDir: entry.type === 'directory' };
  rerenderFilesTree();
}

async function explorerPaste(project, root, entry) {
  const clip = filesClipboard;
  if (!clip) return;
  const folderRel = !entry ? '' : entry.type === 'directory' ? entry.relativePath : parentRelative(entry.relativePath);
  let result;
  try { result = await window.api.pasteProjectEntry(clip.root, clip.rel, root, folderRel, clip.mode === 'cut' ? 'move' : 'copy'); } catch (err) { result = { ok: false, error: err.message }; }
  if (clip.mode === 'cut' && result?.ok) filesClipboard = null;
  if (!await explorerResult(project, result, 'Could not paste.')) return;
  if (folderRel) filesState(project, root).expanded.add(folderRel);
  await rerenderFilesTree();
}

async function explorerDuplicate(project, root, entry) {
  let result;
  try { result = await window.api.duplicateProjectEntry(root, entry.relativePath); } catch (err) { result = { ok: false, error: err.message }; }
  await explorerResult(project, result, 'Could not duplicate the item.');
}

async function compareProjectFiles(project, left, right) {
  const [a, b] = await Promise.all([left, right].map(side => window.api.readProjectFile(side.root, side.rel).catch(err => ({ ok: false, error: err.message }))));
  for (const [side, result] of [[left, a], [right, b]]) {
    if (!result?.ok) { alert(`${side.name}: ${result?.error || 'Could not read the file.'}`); return; }
    if (typeof result.content !== 'string') { alert(`${side.name} is not a text file, so it cannot be compared.`); return; }
  }
  showDiffView(project, { title: `${left.name} ↔ ${right.name}`, detail: `${left.rel} ↔ ${right.rel}`, oldContent: a.content, newContent: b.content, filename: right.name });
}

// --- Open With… (macOS): the editor, the default application, or one picked ---

const OPEN_WITH_RECENT_KEY = 'files.openWithRecent';

function recentOpenWithApps() {
  try { return JSON.parse(localStorage.getItem(OPEN_WITH_RECENT_KEY) || '[]').filter(a => a?.path && a?.name).slice(0, 5); } catch { return []; }
}

function rememberOpenWithApp(app) {
  const next = [app, ...recentOpenWithApps().filter(a => a.path !== app.path)].slice(0, 5);
  localStorage.setItem(OPEN_WITH_RECENT_KEY, JSON.stringify(next));
}

async function openWithApp(root, rel, appPath) {
  let result;
  try { result = await window.api.openFileWithApp(projectEntryPath(root, rel), root, appPath); } catch (err) { result = { ok: false, error: err.message }; }
  if (!result?.ok) { alert(result?.error || 'Could not open the file.'); return; }
  if (result.appPath) rememberOpenWithApp({ path: result.appPath, name: result.appName });
}

async function openWithDefaultApp(root, rel) {
  try {
    const opened = await window.api.openFileExternally(projectEntryPath(root, rel), root);
    if (!opened?.ok) throw new Error(opened?.error || 'Could not open the file in its default application.');
  } catch (err) {
    alert(err.message || 'Could not open the file in its default application.');
  }
}

function openWithItems(project, root, entry) {
  const rel = entry.relativePath;
  const items = [
    { label: 'Switchboard Editor', icon: PICONS.file(14), disabled: !entry.viewable, hint: entry.viewable ? '' : 'no preview', onClick: () => openFileInProjectEditor(project, rel, { root }) },
    { label: 'Default Application', icon: PICONS.open(14), onClick: () => openWithDefaultApp(root, rel) },
  ];
  if (isMacPlatform()) {
    const recent = recentOpenWithApps();
    if (recent.length) items.push({ sep: true }, ...recent.map(app => ({ label: app.name, onClick: () => openWithApp(root, rel, app.path) })));
    items.push({ sep: true }, { label: 'Other Application…', onClick: () => openWithApp(root, rel, null) });
  }
  return items;
}

// --- Chats: add a file to a running chat, or start one with it ---

/** The project's Claude and Codex sessions that are running, the most recent first. */
function runningChatsOf(project) {
  const live = typeof activePtyIds !== 'undefined' ? activePtyIds : new Set();
  const time = s => (typeof sessionEventTime === 'function' ? sessionEventTime(s) : 0) || Date.parse(s.modified || 0) || 0;
  return projectSessionsAll(project).filter(s => live.has(s.sessionId) && s.type !== 'terminal').sort((a, b) => time(b) - time(a));
}

/** What to type into a chat for a file: an @-mention for Claude, the path for Codex. */
function chatMentionFor(runtime, cwd, filePath) {
  let ref = filePath;
  if (cwd && (filePath.startsWith(cwd + '/') || filePath.startsWith(cwd + '\\'))) ref = filePath.slice(cwd.length + 1);
  if (runtime === 'codex') return (/\s/.test(ref) ? shellEscape(ref) : ref) + ' ';
  return (/\s/.test(ref) ? `@"${ref}"` : `@${ref}`) + ' ';
}

function addFileToChat(session, filePath) {
  window.api.sendInput(session.sessionId, chatMentionFor(session.runtime, session.projectPath, filePath));
  openSession(session);
}

// A new chat gets the mention once its CLI has drawn itself and gone quiet,
// so the text lands in the prompt rather than in the startup output.
const chatPrefills = new Map(); // sessionId → { text, timer, deadline }
let chatPrefillListening = false;

function prefillChatWhenReady(sessionId, text) {
  if (!chatPrefillListening && window.api.onTerminalData) {
    chatPrefillListening = true;
    window.api.onTerminalData((id) => {
      const waiting = chatPrefills.get(id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      waiting.timer = setTimeout(() => sendChatPrefill(id), Date.now() > waiting.deadline ? 0 : 900);
    });
  }
  const deadline = Date.now() + 20000;
  chatPrefills.set(sessionId, { text, deadline, timer: setTimeout(() => sendChatPrefill(sessionId), 20000) });
}

function sendChatPrefill(sessionId) {
  const waiting = chatPrefills.get(sessionId);
  if (!waiting) return;
  chatPrefills.delete(sessionId);
  clearTimeout(waiting.timer);
  window.api.sendInput(sessionId, waiting.text);
}

async function addFileToNewChat(project, filePath, runtime) {
  const target = launchTargetFor(project);
  const options = await resolveDefaultSessionOptions(target);
  options.runtime = runtime;
  const sessionId = await launchNewSession(target, options);
  if (sessionId) prefillChatWhenReady(sessionId, chatMentionFor(runtime, target.projectPath, filePath));
}

function chatMenuItems(project, root, entry) {
  const filePath = projectEntryPath(root, entry.relativePath);
  const kind = entry.type === 'directory' ? 'Folder' : 'File';
  const chats = runningChatsOf(project);
  const toChat = chats.length === 1
    ? { label: `Add ${kind} to Chat`, icon: FICONS.chat(14), hint: sessionTitle(chats[0]).slice(0, 28), onClick: () => addFileToChat(chats[0], filePath) }
    : chats.length
      ? { label: `Add ${kind} to Chat`, icon: FICONS.chat(14), submenu: chats.map(s => ({ label: sessionTitle(s), icon: cliIcon(s, 13), onClick: () => addFileToChat(s, filePath) })) }
      : { label: `Add ${kind} to Chat`, icon: FICONS.chat(14), disabled: true, hint: 'no running chat' };
  return [
    toChat,
    {
      label: `Add ${kind} to New Chat`, icon: PICONS.plus(14), submenu: [
        { label: 'Claude', icon: ICONS.claude(14), onClick: () => addFileToNewChat(project, filePath, 'claude') },
        { label: 'Codex', icon: ICONS.codex(14, 'codex-icon'), onClick: () => addFileToNewChat(project, filePath, 'codex') },
      ],
    },
  ];
}

// --- The context menu ---

function explorerMenuItems(project, root, entry) {
  const mac = isMacPlatform();
  const manager = mac ? 'Finder' : window.api.platform === 'win32' ? 'Explorer' : 'File Manager';
  const isDir = !entry || entry.type === 'directory';
  const rel = entry?.relativePath || '';
  const folderRel = isDir ? rel : parentRelative(rel);
  const items = [{ head: entry ? entry.name : pathBasename(root) }];
  if (isDir) {
    items.push(
      { label: 'New File…', icon: FICONS.newFile(14), onClick: () => explorerNewEntry(project, root, rel, 'file') },
      { label: 'New Folder…', icon: FICONS.newFolder(14), onClick: () => explorerNewEntry(project, root, rel, 'folder') },
      { sep: true },
    );
  } else {
    items.push(
      { label: 'Open to the Side', icon: FICONS.side(14), hint: filesKeyHint('⌃↩', 'Ctrl+Enter'), disabled: entry.type !== 'file' || !entry.viewable, onClick: () => openFileToSide(project, root, rel) },
      { label: 'Open With…', icon: PICONS.open(14), disabled: entry.type !== 'file', submenu: entry.type === 'file' ? openWithItems(project, root, entry) : null },
    );
  }
  items.push(
    entry
      ? { label: `Reveal in ${manager}`, icon: PICONS.folder(14), hint: filesKeyHint('⌥⌘R', 'Shift+Alt+R'), onClick: () => explorerManage(project, root, entry, 'reveal') }
      : { label: `Open in ${manager}`, icon: PICONS.folder(14), onClick: async () => { const r = await window.api.openPath(root); if (r?.error) alert(r.error); } },
    { label: 'Open in Integrated Terminal', icon: PICONS.terminal(14), onClick: () => launchTerminalSession({ ...launchTargetFor(project), projectPath: projectEntryPath(root, folderRel) }) },
    { sep: true },
  );
  if (entry && !isDir) {
    const source = filesCompareSource;
    const sameAsSource = source && source.root === root && source.rel === rel;
    items.push({ label: 'Select for Compare', icon: FICONS.compare(14), onClick: () => { filesCompareSource = { root, rel, name: entry.name }; } });
    if (source && !sameAsSource) {
      items.push({ label: 'Compare with Selected', hint: source.name, onClick: () => compareProjectFiles(project, source, { root, rel, name: entry.name }) });
    }
    items.push({ sep: true });
  }
  if (entry) {
    items.push(...chatMenuItems(project, root, entry), { sep: true });
    items.push({ label: 'Open Timeline', icon: PICONS.clock(14), onClick: () => openTimeline(project, root, entry) }, { sep: true });
    items.push(
      { label: 'Cut', icon: FICONS.cut(14), hint: filesKeyHint('⌘X', 'Ctrl+X'), onClick: () => explorerClip(project, root, entry, 'cut') },
      { label: 'Copy', icon: FICONS.copy(14), hint: filesKeyHint('⌘C', 'Ctrl+C'), onClick: () => explorerClip(project, root, entry, 'copy') },
    );
  }
  items.push(
    { label: 'Paste', icon: FICONS.paste(14), hint: filesClipboard ? filesKeyHint('⌘V', 'Ctrl+V') : '', disabled: !filesClipboard, onClick: () => explorerPaste(project, root, entry) },
    { sep: true },
    { label: 'Copy Path', hint: filesKeyHint('⌥⌘C', 'Shift+Alt+C'), onClick: () => window.api.writeClipboard(projectEntryPath(root, rel)) },
  );
  if (entry) {
    items.push(
      { label: 'Copy Relative Path', hint: filesKeyHint('⌥⇧⌘C', 'Ctrl+Shift+Alt+C'), onClick: () => window.api.writeClipboard(rel) },
      { sep: true },
      { label: 'Rename…', icon: PICONS.pencil(14), hint: filesKeyHint('↩', 'F2'), onClick: () => explorerManage(project, root, entry, 'rename') },
      { label: 'Delete', icon: PICONS.trash(14), hint: filesKeyHint('⌘⌫', 'Delete'), danger: true, onClick: () => explorerManage(project, root, entry, 'trash') },
      { sep: true },
      { label: 'Duplicate', icon: FICONS.copy(14), onClick: () => explorerDuplicate(project, root, entry) },
    );
  }
  return items;
}

// --- Timeline: the commits that changed a file, under the tree ---

function timelineAgo(ms) {
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, unit] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

async function openTimeline(project, root, entry) {
  const state = filesState(project, root);
  state.timeline = { rel: entry.relativePath, name: entry.name, isDir: entry.type === 'directory', data: null, error: null, request: 0 };
  if (currentFilesRoot(project) !== root) { filesUi(project).root = root; renderOverview(); }
  await loadTimeline(project, state);
}

async function loadTimeline(project, state) {
  const timeline = state.timeline;
  if (!timeline) return;
  const request = timeline.request = (timeline.request || 0) + 1;
  timeline.loading = true;
  renderTimeline(project, state);
  let result;
  try { result = await window.api.getFileTimeline(state.root, timeline.rel); } catch (err) { result = { ok: false, error: err.message }; }
  if (state.timeline !== timeline || timeline.request !== request) return;
  timeline.loading = false;
  timeline.data = result?.ok ? result : null;
  timeline.error = result?.ok ? null : (result?.error || 'Could not read the history.');
  renderTimeline(project, state);
}

function renderTimeline(project, state) {
  const pane = projectViewer?.querySelector('#ws-timeline');
  if (!pane || pane.dataset.root !== state.root) return;
  const timeline = state.timeline;
  pane.hidden = !timeline;
  if (!timeline) { pane.replaceChildren(); return; }
  pane.innerHTML = `
    <div class="ws-timeline-head">
      <span class="ws-card-title">Timeline</span>
      <span class="ws-timeline-file" title="${escapeHtml(timeline.rel)}">${escapeHtml(timeline.name)}</span>
      <span class="ws-flex"></span>
      <button type="button" class="ws-ghost ws-files-action" data-act="refresh" title="Refresh" aria-label="Refresh the Timeline">${PICONS.refresh(13)}</button>
      <button type="button" class="ws-ghost ws-files-action" data-act="close" title="Close" aria-label="Close the Timeline">${PICONS.x(12)}</button>
    </div>
    <div class="ws-timeline-list" role="list"></div>`;
  pane.querySelector('[data-act="refresh"]').onclick = () => loadTimeline(project, state);
  pane.querySelector('[data-act="close"]').onclick = () => { state.timeline = null; renderTimeline(project, state); };
  const list = pane.querySelector('.ws-timeline-list');
  const data = timeline.data;
  if (timeline.loading && !data) { list.innerHTML = '<div class="ws-timeline-note">Reading the history…</div>'; return; }
  if (timeline.error) { list.innerHTML = `<div class="ws-timeline-note">${escapeHtml(timeline.error)}</div>`; return; }
  if (!data?.repoRoot) { list.innerHTML = '<div class="ws-timeline-note">Not in a Git repository, so there is no history to show.</div>'; return; }
  const rows = [];
  if (data.uncommitted) rows.push({ hash: null, subject: 'Uncommitted changes', meta: 'Working tree' });
  for (const entry of data.entries || []) rows.push({ ...entry, meta: `${entry.authorName} · ${timelineAgo(entry.date)}` });
  if (!rows.length) { list.innerHTML = '<div class="ws-timeline-note">No commits yet.</div>'; return; }
  for (const item of rows) {
    const row = document.createElement('div');
    row.className = 'ws-timeline-row' + (item.hash ? '' : ' is-working');
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');
    row.title = item.hash ? `${item.shortHash} · ${item.authorName} <${item.authorEmail}>\n${new Date(item.date).toLocaleString()}\n\n${item.subject}` : 'Changes not committed yet';
    row.innerHTML = `<span class="ws-timeline-dot"></span><span class="ws-timeline-subject">${escapeHtml(item.subject)}</span><span class="ws-timeline-meta">${escapeHtml(item.meta)}</span>`;
    const open = () => (timeline.isDir ? (item.hash && showCommitInGitGraph(project, data.repoRoot, item.hash)) : openTimelineChange(project, state, item));
    row.onclick = open;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(timelineMenuItems(project, state, item), { x: e.clientX, y: e.clientY });
    };
    list.appendChild(row);
  }
}

async function openTimelineChange(project, state, item) {
  const timeline = state.timeline;
  let result;
  try { result = await window.api.getFileTimelineDiff(state.root, timeline.rel, item.hash, item.path || undefined, item.oldPath || undefined); } catch (err) { result = { ok: false, error: err.message }; }
  if (!result?.ok) { alert(result?.error || 'Could not read this change.'); return; }
  const what = item.hash ? `${item.shortHash} · ${item.subject}` : 'Uncommitted changes';
  showDiffView(project, { title: timeline.name, detail: what, oldContent: result.oldContent, newContent: result.newContent, filename: timeline.name });
}

async function openTimelineVersion(project, state, item) {
  const timeline = state.timeline;
  let result;
  try { result = await window.api.getFileAtCommit(state.root, timeline.rel, item.hash, item.path || undefined); } catch (err) { result = { ok: false, error: err.message }; }
  if (!result?.ok) { alert(result?.error || 'Could not read this version.'); return; }
  showDiffView(project, { title: `${timeline.name} at ${item.shortHash}`, detail: item.subject, oldContent: result.content, newContent: result.content, filename: timeline.name });
  // Same text on both sides reads as "No differences"; show the version itself instead.
  const body = projectViewer?.querySelector('.ws-diff-view .ws-diff-body');
  if (body && typeof createReadOnlyViewer === 'function') {
    body.replaceChildren();
    const view = createReadOnlyViewer(body, result.content, timeline.name);
    if (projectDiffView) projectDiffView.view = view;
  }
}

/** The attached folder that is this repository, for History (the Git Graph) in the Git tab. */
function gitGraphFolderFor(project, repoRoot) {
  const norm = p => String(p || '').replace(/[\\/]+$/, '');
  return (project.folders || []).find(f => norm(f.path) === norm(repoRoot) || norm(f.realPath) === norm(repoRoot)) || null;
}

function showCommitInGitGraph(project, repoRoot, hash) {
  const folder = gitGraphFolderFor(project, repoRoot);
  if (!folder || typeof gitGraphState !== 'function') return;
  const state = gitGraphState(project.id);
  if (state.selectedRepo !== folder.path) {
    state.selectedRepo = folder.path;
    state.selectedHash = null;
    state.detailsData = null;
    state.repositories = null;
    if (typeof gitGraphSaveUiPrefs === 'function') gitGraphSaveUiPrefs(project.id, state);
  }
  state.pendingFocusHash = hash;
  state.focusTries = 0;
  setProjectGitView(project, 'history');
  showProjectTab(project, 'git');
  // Already loaded: the commit can be picked right away.
  const body = projectViewer?.querySelector('#git-workspace-view');
  if (state.repositories && body && typeof gitGraphFocusPending === 'function' && (state.rows || []).length) gitGraphFocusPending(project, state, body);
}

function timelineMenuItems(project, state, item) {
  const timeline = state.timeline;
  const data = timeline?.data;
  const inGraph = !!(item.hash && data?.repoRoot && gitGraphFolderFor(project, data.repoRoot) && typeof renderProjectGitGraphTab === 'function');
  const items = [{ head: item.hash ? item.shortHash : 'Working tree' }];
  if (!timeline.isDir) {
    items.push({ label: 'Open Changes', icon: FICONS.compare(14), onClick: () => openTimelineChange(project, state, item) });
    if (item.hash) items.push({ label: 'Open File at This Version', icon: PICONS.file(14), onClick: () => openTimelineVersion(project, state, item) });
  }
  if (item.hash) {
    items.push(
      { label: 'Show in Git Graph', icon: PICONS.merge(14), disabled: !inGraph, hint: inGraph ? '' : 'attach the repository', onClick: () => showCommitInGitGraph(project, data.repoRoot, item.hash) },
      { sep: true },
      { label: 'Copy Commit ID', onClick: () => window.api.writeClipboard(item.hash) },
      { label: 'Copy Commit Message', onClick: () => window.api.writeClipboard(item.subject) },
    );
  }
  return items;
}

// --- The tab ---

function bindFilesDivider(project, container) {
  const handle = container.querySelector('.ws-files-divider');
  const storageKey = `project-files-tree-width:${project.id}`;
  const saved = Number(localStorage.getItem(storageKey));
  const resize = (width) => {
    const max = Math.max(0, Math.min(600, container.getBoundingClientRect().width * 0.6));
    const next = Math.round(Math.max(Math.min(160, max), Math.min(max, width)));
    container.style.setProperty('--files-tree-width', `${next}px`);
    handle.setAttribute('aria-valuenow', String(next));
    return next;
  };
  if (Number.isFinite(saved) && saved > 0) resize(saved);
  let drag = null;
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.focus();
    drag = { x: event.clientX, width: container.firstElementChild.getBoundingClientRect().width };
    handle.setPointerCapture(event.pointerId);
    container.classList.add('is-resizing');
  };
  handle.onpointermove = (event) => {
    if (drag) resize(drag.width + event.clientX - drag.x);
  };
  handle.onlostpointercapture = () => {
    if (!drag) return;
    drag = null;
    container.classList.remove('is-resizing');
    localStorage.setItem(storageKey, parseFloat(container.style.getPropertyValue('--files-tree-width')) || container.firstElementChild.getBoundingClientRect().width);
  };
  handle.onkeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const width = container.firstElementChild.getBoundingClientRect().width;
    localStorage.setItem(storageKey, resize(width + (event.key === 'ArrowLeft' ? -20 : 20)));
  };
}

function filesRootTabsHtml(project, current) {
  const roots = filesRoots(project);
  return roots.map(r => {
    const icon = r.kind === 'project' ? PICONS.file(12) : r.kind === 'worktree' ? PICONS.branch(12) : PICONS.folder(12);
    const active = r.path === current;
    return `<button type="button" class="ws-files-root${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-root="${escapeHtml(r.path)}" title="${escapeHtml(r.path)}">${icon}<span>${escapeHtml(r.label)}</span></button>`;
  }).join('');
}

async function renderFilesTab(project, body) {
  body.classList.add('ws-body--files');
  const root = currentFilesRoot(project);
  const isProject = root === project.root;
  body.innerHTML = `
    <div class="ws-files-roots" role="tablist" aria-label="Folders">${filesRootTabsHtml(project, root)}</div>
    <div class="ws-files">
      <div class="ws-files-side">
        <div class="ws-files-head">
          <span class="ws-card-title" title="${escapeHtml(root)}">${isProject ? 'Project folder' : escapeHtml(pathBasename(root))}</span>
          <span class="ws-flex"></span>
          <button type="button" class="ws-ghost ws-files-action" data-act="new-file" title="New File…" aria-label="New File">${FICONS.newFile(14)}</button>
          <button type="button" class="ws-ghost ws-files-action" data-act="new-folder" title="New Folder…" aria-label="New Folder">${FICONS.newFolder(14)}</button>
          <button type="button" class="ws-ghost ws-files-action" data-act="refresh" id="ws-files-refresh" title="Refresh Explorer" aria-label="Refresh files">${PICONS.refresh(14)}</button>
          <button type="button" class="ws-ghost ws-files-action" data-act="collapse" title="Collapse Folders" aria-label="Collapse Folders">${FICONS.collapse(14)}</button>
          <button type="button" class="ws-ghost ws-files-action" data-act="open" id="ws-files-open" title="Open folder" aria-label="Open folder">${PICONS.open(14)}</button>
        </div>
        <div class="ws-files-list" id="ws-files-list" role="tree" tabindex="-1" data-root="${escapeHtml(root)}"></div>
        ${isProject ? '<div class="ws-help ws-files-hint">CLAUDE.md is the brief every session reads. The agent creates plan.md, plan-tracker.md, todos.md and memory.md when it needs them. Each attached folder has its own tab above.</div>' : ''}
        <div class="ws-timeline" id="ws-timeline" data-root="${escapeHtml(root)}" hidden></div>
      </div>
      <div class="ws-files-divider" role="separator" aria-label="Resize file tree" aria-orientation="vertical" tabindex="0"></div>
      <div class="ws-editor-area">
        <div class="ws-editor" id="ws-editor"><div class="ws-editor-empty">Pick a file to read or edit it here.</div></div>
        <div class="ws-editor ws-editor--side" id="ws-editor-side" hidden></div>
      </div>
    </div>`;
  const state = filesState(project, root);
  bindFilesDivider(project, body.querySelector('.ws-files'));
  body.querySelectorAll('.ws-files-root').forEach(tab => {
    tab.onclick = () => {
      if (tab.dataset.root === currentFilesRoot(project)) return;
      filesUi(project).root = tab.dataset.root;
      renderFilesTab(project, body);
    };
  });
  const list = body.querySelector('#ws-files-list');
  const act = (name, fn) => { body.querySelector(`.ws-files-head [data-act="${name}"]`).onclick = fn; };
  act('open', async () => {
    const result = await window.api.openPath(root);
    if (result?.error) alert(result.error);
  });
  act('refresh', async () => {
    state.cache.clear();
    await renderFileTree(project, list, state);
  });
  act('collapse', async () => {
    state.expanded.clear();
    await renderFileTree(project, list, state);
  });
  act('new-file', () => explorerNewEntry(project, root, selectedFolderOf(state), 'file'));
  act('new-folder', () => explorerNewEntry(project, root, selectedFolderOf(state), 'folder'));
  // The empty part of the tree acts on the folder itself.
  list.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.ws-file-row')) return;
    event.preventDefault();
    showContextMenu(explorerMenuItems(project, root, null), { x: event.clientX, y: event.clientY });
  });
  list.addEventListener('keydown', (event) => { if (event.target === list) onExplorerKey(event, project, root, null, null, () => {}); });

  // The editors and a diff belong to the page: put back whichever is open.
  const host = body.querySelector('#ws-editor');
  const ed = projectEditor;
  if (projectDiffView?.projectId === project.id) host.replaceChildren(projectDiffView.el);
  else if (ed?.projectId === project.id && ed.panel.filePath) host.replaceChildren(ed.host);
  const side = projectSideEditor;
  if (side?.projectId === project.id && side.panel.filePath) {
    const pane = body.querySelector('#ws-editor-side');
    pane.hidden = false;
    pane.replaceChildren(side.host);
    body.querySelector('.ws-editor-area').classList.add('has-side');
  }
  renderTimeline(project, state);
  await renderFileTree(project, list, state);
  const hasEditor = projectDiffView?.projectId === project.id || (ed?.projectId === project.id && ed.panel.filePath);
  if (!hasEditor && state.selected && selectedProject()?.id === project.id) await openFileInProjectEditor(project, state.selected, { root });
}

/** Where the toolbar's New File puts it: the selected folder, or the selected file's folder. */
function selectedFolderOf(state) {
  const rel = state.selected;
  if (!rel) return '';
  const entries = state.cache.get(parentRelative(rel))?.entries || [];
  const entry = entries.find(e => e.relativePath === rel);
  return entry?.type === 'directory' ? rel : parentRelative(rel);
}
