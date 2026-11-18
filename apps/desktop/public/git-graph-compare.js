// Compare of 2 to 4 commits ticked in the Git History, step by step: from the
// oldest to the newest, A→B, B→C, C→D. With two commits it is the comparison
// the History already makes. The commits come from the checkboxes of the
// History (project-git-graph-view.js); the comparison opens in a popup over
// the window, or in a window of its own (main.js openGitCompareWindow, then
// projects-view.js with PROJECT_WINDOW.compare).
//
// On top, a table of the files: one column per step, with the file's status
// and its lines added and removed in that step. Under it, the file picked in
// the table, one diff per step side by side.
//
// Depends on globals: escapeHtml, escapeAttr (utils.js), window.api,
// createUnifiedMergeViewer (codemirror-bundle.js), buildGitChangeTree and
// gitTreeRows (project-git-view.js, the files as a tree), and from
// git-graph-render.js gitGraphFileStatusGlyph, gitGraphDiffStatHtml and
// gitGraphIcon (looked up when called, so tests can do without them).

const GG_COMPARE_MAX = 4;
const GG_UNCOMMITTED_HASH = '#uncommitted';

// What a comparison loaded, by the commits it compares: the popup opened
// again, or the window drawn again, shows it at once and on the same file.
const gitGraphCompareCache = new Map();

/** The ticked commits still loaded, from the oldest to the newest: the rows
 * run from the newest, so the oldest has the highest index. Uncommitted
 * Changes is the first row, so it always comes last. */
function gitGraphCompareOrder(rows, hashes) {
  const index = new Map((rows || []).map((row, i) => [row.hash, i]));
  return [...new Set(hashes || [])].filter(hash => index.has(hash)).sort((a, b) => index.get(b) - index.get(a));
}

/** Each commit with the next one: [A, B, C] → A→B, B→C. */
function gitGraphCompareSteps(ordered) {
  const steps = [];
  for (let i = 0; i + 1 < (ordered || []).length; i += 1) steps.push({ from: ordered[i], to: ordered[i + 1] });
  return steps;
}

/** What the desktop is asked for a step: the working tree is `null`. */
function gitGraphCompareStepArgs(step) {
  return [step.from, step.to === GG_UNCOMMITTED_HASH ? null : step.to];
}

/** Every file changed in at least one step, by path, with what it was in each step (null: unchanged there). */
function gitGraphCompareMatrix(stepFiles) {
  const byPath = new Map();
  (stepFiles || []).forEach((files, step) => {
    for (const file of files || []) {
      if (!byPath.has(file.path)) byPath.set(file.path, new Array(stepFiles.length).fill(null));
      byPath.get(file.path)[step] = file;
    }
  });
  return [...byPath.keys()].sort((a, b) => a.localeCompare(b)).map(path => ({ path, cells: byPath.get(path) }));
}

/** What Select all ticks: the commits found while the search is open with results, otherwise every loaded one. */
function gitGraphSelectAllHashes(state) {
  const rows = state.rows || [];
  if (state.findOpen && state.findQuery && (state.findMatches || []).length) {
    return state.findMatches.map(index => rows[index] && rows[index].hash).filter(Boolean);
  }
  return rows.map(row => row.hash);
}

/** A commit as the comparison names it. */
function gitGraphCompareLabel(rows, hash) {
  if (hash === GG_UNCOMMITTED_HASH) return 'Uncommitted';
  const row = (rows || []).find(r => r.hash === hash);
  if (row && row.kind === 'stash' && row.stashIndex != null) return `stash@{${row.stashIndex}}`;
  return (row && row.shortHash) || String(hash).slice(0, 8);
}

/** A commit's title, so the commits compared are told apart by more than a hash. */
function gitGraphCompareSubject(rows, hash) {
  if (hash === GG_UNCOMMITTED_HASH) return 'Uncommitted Changes';
  const row = (rows || []).find(r => r.hash === hash);
  return (row && row.subject) || '';
}

/** What the comparison of `hashes` (oldest first) shows and asks for: the repository, each commit's name and title. */
function gitGraphCompareSpecFor(projectId, repoPath, rows, hashes) {
  return {
    projectId, repoPath, hashes,
    labels: hashes.map(hash => gitGraphCompareLabel(rows, hash)),
    subjects: hashes.map(hash => gitGraphCompareSubject(rows, hash)),
  };
}

/** The Compare button and the one beside it for a window of its own, once two or more commits are ticked. */
function gitGraphCompareButtonsHtml(count) {
  if (count < 2) return '';
  const tooMany = count > GG_COMPARE_MAX;
  const title = tooMany
    ? `Compare up to ${GG_COMPARE_MAX} commits: ${count} are selected`
    : 'Compare the selected commits step by step, from the oldest';
  const icon = typeof gitGraphIcon === 'function' ? gitGraphIcon('compare', 13) : '';
  const windowIcon = typeof gitGraphIcon === 'function' ? gitGraphIcon('popOut', 13) : '';
  const disabled = tooMany ? ' disabled' : '';
  return `<button type="button" class="gg-toolbar-btn gg-compare-btn" id="gg-compare-btn" title="${escapeAttr(title)}"${disabled}>${icon}<span>Compare ${count}</span></button>`
    + `<button type="button" class="gg-icon-btn" id="gg-compare-window-btn" title="${escapeAttr(tooMany ? title : 'Compare the selected commits in a window of their own')}"${disabled}>${windowIcon}</button>`;
}

// --- The view: popup or window ---

function gitGraphCompareCall(name, ...args) {
  if (typeof window === 'undefined' || !window.api || typeof window.api[name] !== 'function') {
    return Promise.resolve({ error: `${name} is not available` });
  }
  return Promise.resolve(window.api[name](...args)).catch(err => ({ error: (err && err.message) || String(err) }));
}

function gitGraphCompareKey(spec) {
  return JSON.stringify([spec.projectId, spec.repoPath, spec.hashes]);
}

function gitGraphCompareName(spec, hash) {
  return (spec.labels || [])[spec.hashes.indexOf(hash)] || gitGraphCompareLabel([], hash);
}

function gitGraphCompareStepLabel(spec, step) {
  return `${gitGraphCompareName(spec, step.from)} → ${gitGraphCompareName(spec, step.to)}`;
}

/** A step with the commits' titles, for its tooltip. */
function gitGraphCompareStepTitle(spec, step) {
  const named = (hash) => {
    const subject = (spec.subjects || [])[spec.hashes.indexOf(hash)];
    return subject ? `${gitGraphCompareName(spec, hash)} ${subject}` : gitGraphCompareName(spec, hash);
  };
  return `${named(step.from)} → ${named(step.to)}`;
}

/** The title of the comparison: each commit's name and title, oldest first. */
function gitGraphCompareTitleHtml(spec) {
  return (spec.hashes || []).map((hash, i) => {
    const subject = (spec.subjects || [])[i] || '';
    return `<span class="gg-cmp-commit"><span class="mono">${escapeHtml(gitGraphCompareName(spec, hash))}</span>${subject ? ` <span class="gg-cmp-subject" title="${escapeAttr(subject)}">${escapeHtml(subject)}</span>` : ''}</span>`;
  }).join('<span class="gg-cmp-arrow">→</span>');
}

/** The table's rows in the order shown: as a tree of folders (the default), or a flat list of paths. */
function gitGraphCompareDisplayRows(matrix, fileView, collapsed) {
  const canTree = typeof buildGitChangeTree === 'function' && typeof gitTreeRows === 'function';
  if (fileView === 'list' || !canTree) return matrix.map(row => ({ kind: 'file', depth: 0, name: row.path, row }));
  const tree = buildGitChangeTree(matrix);
  return gitTreeRows(tree, collapsed || new Set(), '').map(item => (item.kind === 'folder'
    ? item
    : { kind: 'file', depth: item.depth, name: item.name, row: item.change }));
}

function gitGraphCompareStatusHtml(file) {
  const glyph = typeof gitGraphFileStatusGlyph === 'function' ? gitGraphFileStatusGlyph(file.status) : (file.status || '').charAt(0).toUpperCase();
  const stat = typeof gitGraphDiffStatHtml === 'function' ? gitGraphDiffStatHtml(file) : '';
  return `<span class="gg-file-status gg-file-status-${escapeAttr(file.status || 'modified')}">${escapeHtml(glyph)}</span>${stat}`;
}

/** The table: one row per file (under its folders, in the tree), one column per step. */
function gitGraphCompareTableHtml(spec, steps, matrix, selectedPath, display = {}) {
  const head = steps.map(step => `<th class="gg-cmp-step mono" title="${escapeAttr(gitGraphCompareStepTitle(spec, step))}">${escapeHtml(gitGraphCompareStepLabel(spec, step))}</th>`).join('');
  const items = gitGraphCompareDisplayRows(matrix, display.fileView || 'tree', display.collapsed);
  const icon = (name, size) => (typeof gitGraphIcon === 'function' ? gitGraphIcon(name, size) : '');
  const rows = items.map((item) => {
    const indent = `style="--depth:${item.depth || 0}"`;
    if (item.kind === 'folder') {
      return `<tr class="gg-cmp-folder" data-folder-key="${escapeAttr(item.key)}"><td class="gg-cmp-file gg-cmp-indent" colspan="${steps.length + 1}" ${indent}>`
        + `<span class="gg-tree-folder-chevron">${icon(item.collapsed ? 'chevronRight' : 'chevronDown', 11)}</span>${icon('folder', 12)}`
        + ` <span class="mono">${escapeHtml(item.name)}</span> <span class="gg-tree-folder-count">${item.count || ''}</span></td></tr>`;
    }
    const row = item.row;
    const renamed = row.cells.find(cell => cell && cell.oldPath && cell.oldPath !== row.path);
    const title = renamed ? `${renamed.oldPath} → ${row.path}` : row.path;
    let name;
    if (display.fileView === 'list') {
      const slash = row.path.lastIndexOf('/');
      name = `<span class="gg-cmp-dir">${escapeHtml(slash >= 0 ? row.path.slice(0, slash + 1) : '')}</span>${escapeHtml(row.path.slice(slash + 1))}`;
    } else {
      name = escapeHtml(item.name);
    }
    const cells = row.cells.map((cell, step) => (cell
      ? `<td class="gg-cmp-cell" data-step="${step}">${gitGraphCompareStatusHtml(cell)}</td>`
      : `<td class="gg-cmp-cell gg-cmp-cell-none" data-step="${step}" title="No change in this step">·</td>`)).join('');
    const selected = row.path === selectedPath ? ' gg-cmp-row-selected' : '';
    const tree = display.fileView === 'list' ? '' : ' gg-cmp-indent gg-cmp-indent-file';
    return `<tr class="gg-cmp-row${selected}" data-path="${escapeAttr(row.path)}"><td class="gg-cmp-file mono${tree}" title="${escapeAttr(title)}" ${indent}>${name}</td>${cells}</tr>`;
  }).join('');
  return `<table class="gg-cmp-table"><thead><tr><th class="gg-cmp-file-head">File</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** The first file the table shows, in its order. */
function gitGraphCompareFirstPath(matrix, display) {
  const first = gitGraphCompareDisplayRows(matrix, display.fileView || 'tree', display.collapsed).find(item => item.kind === 'file');
  return first ? first.row.path : (matrix[0] && matrix[0].path) || null;
}

/** The comparison of `spec` ({ projectId, repoPath, hashes oldest first, labels }) drawn into `host`.
 * opts.onClose: the × (popup only); opts.onOpenWindow: the button for a window of its own (not in that window). */
function gitGraphRenderCompareView(host, spec, opts = {}) {
  const steps = gitGraphCompareSteps(spec.hashes);
  const key = gitGraphCompareKey(spec);
  const view = gitGraphCompareCache.get(key) || { stepFiles: null, error: null, selectedPath: null, fileView: 'tree', collapsed: new Set() };
  gitGraphCompareCache.set(key, view);
  // A comparison opened again starts in the Tree, as every one does; drawn again (the window), it keeps its view.
  if (opts.fresh) { view.fileView = 'tree'; view.collapsed = new Set(); }
  const windowIcon = typeof gitGraphIcon === 'function' ? gitGraphIcon('popOut', 13) : '⧉';
  host.innerHTML = `
    <div class="gg-cmp ${opts.onClose ? 'gg-cmp-in-popup' : 'gg-cmp-in-window'}">
      <div class="gg-cmp-head">
        <div class="gg-cmp-heading">
          <div class="gg-cmp-title"><span class="gg-cmp-title-label">Compare</span> ${gitGraphCompareTitleHtml(spec)}</div>
          <div class="gg-cmp-summary" id="gg-cmp-summary"></div>
        </div>
        <div class="gg-file-view-toggle gg-cmp-view-toggle">
          <button type="button" class="gg-toggle-btn" data-cmp-view="tree">Tree</button>
          <button type="button" class="gg-toggle-btn" data-cmp-view="list">List</button>
        </div>
        ${opts.onOpenWindow ? `<button type="button" class="gg-icon-btn" id="gg-cmp-window" title="Open in a window of its own">${windowIcon}</button>` : ''}
        ${opts.onClose ? '<button type="button" class="gg-icon-btn gg-cmp-close" id="gg-cmp-close" title="Close (Esc)">×</button>' : ''}
      </div>
      <div class="gg-cmp-table-wrap" id="gg-cmp-table"><div class="gg-loading"><span class="gg-loading-dot"></span>Comparing ${steps.length} step${steps.length === 1 ? '' : 's'}…</div></div>
      <div class="gg-cmp-diffs" id="gg-cmp-diffs" style="--gg-cmp-steps:${Math.max(steps.length, 1)}"></div>
    </div>`;
  const closeBtn = host.querySelector('#gg-cmp-close');
  if (closeBtn) closeBtn.onclick = () => opts.onClose();
  const windowBtn = host.querySelector('#gg-cmp-window');
  if (windowBtn) windowBtn.onclick = () => opts.onOpenWindow();

  const showView = () => host.querySelectorAll('[data-cmp-view]').forEach((btn) => btn.classList.toggle('active', btn.dataset.cmpView === view.fileView));
  showView();
  host.querySelectorAll('[data-cmp-view]').forEach((btn) => {
    btn.onclick = () => {
      if (view.fileView === btn.dataset.cmpView) return;
      view.fileView = btn.dataset.cmpView;
      showView();
      if (view.stepFiles) paintTable();
    };
  });

  // The table alone, where it was scrolled to: folding a folder or switching
  // Tree/List leaves the diffs below as they are.
  const paintTable = () => {
    const tableHost = host.querySelector('#gg-cmp-table');
    const matrix = gitGraphCompareMatrix(view.stepFiles);
    const scrollTop = tableHost.scrollTop;
    tableHost.innerHTML = gitGraphCompareTableHtml(spec, steps, matrix, view.selectedPath, view);
    tableHost.scrollTop = scrollTop;
    tableHost.querySelectorAll('.gg-cmp-folder').forEach((tr) => {
      tr.onclick = () => {
        const folder = tr.dataset.folderKey;
        if (view.collapsed.has(folder)) view.collapsed.delete(folder); else view.collapsed.add(folder);
        paintTable();
      };
    });
    tableHost.querySelectorAll('.gg-cmp-row').forEach((tr) => {
      tr.onclick = () => {
        view.selectedPath = tr.dataset.path;
        tableHost.querySelectorAll('.gg-cmp-row-selected').forEach(el => el.classList.remove('gg-cmp-row-selected'));
        tr.classList.add('gg-cmp-row-selected');
        gitGraphRenderCompareDiffs(host, spec, steps, matrix.find(row => row.path === view.selectedPath));
      };
    });
    return { tableHost, matrix };
  };

  const paint = () => {
    if (!host.isConnected) return;
    const tableHost = host.querySelector('#gg-cmp-table');
    if (view.error) { tableHost.innerHTML = `<div class="gg-error-state">${escapeHtml(view.error)}</div>`; return; }
    const matrix = gitGraphCompareMatrix(view.stepFiles);
    const summary = host.querySelector('#gg-cmp-summary');
    if (summary) summary.textContent = `${matrix.length} file${matrix.length === 1 ? '' : 's'} changed across ${steps.length} step${steps.length === 1 ? '' : 's'}`;
    if (!matrix.length) { tableHost.innerHTML = '<div class="gg-empty-row">No files changed between these commits.</div>'; return; }
    if (!view.selectedPath || !matrix.some(row => row.path === view.selectedPath)) view.selectedPath = gitGraphCompareFirstPath(matrix, view);
    paintTable();
    const selectedRow = tableHost.querySelector('.gg-cmp-row-selected');
    if (selectedRow && selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: 'nearest' });
    gitGraphRenderCompareDiffs(host, spec, steps, matrix.find(row => row.path === view.selectedPath));
  };

  if (view.stepFiles) { paint(); return view; }
  Promise.all(steps.map(step => gitGraphCompareCall('getGitGraphCompareDetail', spec.projectId, spec.repoPath, ...gitGraphCompareStepArgs(step))))
    .then((results) => {
      const failed = results.find(result => !result || !result.ok);
      if (failed) view.error = (failed && failed.error) || 'Could not compare these commits.';
      else view.stepFiles = results.map(result => result.files || []);
      // A failure is not kept: opening the comparison again tries again.
      if (failed) gitGraphCompareCache.delete(key);
      paint();
    });
  return view;
}

/** One column per step for the picked file: its diff in that step, or a note that it did not change there. */
function gitGraphRenderCompareDiffs(host, spec, steps, row) {
  const diffs = host.querySelector('#gg-cmp-diffs');
  if (!diffs) return;
  diffs.innerHTML = '';
  if (!row) return;
  steps.forEach((step, i) => {
    const cell = row.cells[i];
    const column = document.createElement('div');
    column.className = 'gg-cmp-diff-col';
    column.innerHTML = `<div class="gg-cmp-diff-head"><span class="mono">${escapeHtml(gitGraphCompareStepLabel(spec, step))}</span>${cell ? gitGraphCompareStatusHtml(cell) : ''}</div>`;
    const content = document.createElement('div');
    content.className = 'gg-cmp-diff-body';
    column.appendChild(content);
    diffs.appendChild(column);
    if (!cell) { content.innerHTML = '<div class="gg-cmp-diff-none">No change in this step</div>'; return; }
    content.innerHTML = '<div class="gg-loading"><span class="gg-loading-dot"></span>Loading…</div>';
    const [fromRev, toRev] = gitGraphCompareStepArgs(step);
    gitGraphCompareFileDiff(spec, fromRev, toRev, row.path, cell.oldPath).then((result) => {
      if (!content.isConnected) return;
      if (!result || !result.ok) { content.innerHTML = `<div class="gg-cmp-diff-none">${escapeHtml((result && result.error) || 'Could not load the diff.')}</div>`; return; }
      content.innerHTML = '';
      if (typeof createUnifiedMergeViewer === 'function') createUnifiedMergeViewer(content, result.oldContent || '', result.newContent || '', row.path, { readOnly: true });
    });
  });
}

/** Both sides of a file in a step. A file renamed in the step is read under its old path on the old side. */
function gitGraphCompareFileDiff(spec, fromRev, toRev, path, oldPath) {
  const diff = gitGraphCompareCall('getGitGraphFileDiffBetween', spec.projectId, spec.repoPath, fromRev, toRev, path);
  if (!oldPath || oldPath === path) return diff;
  const before = gitGraphCompareCall('getGitGraphFileAtRevision', spec.projectId, spec.repoPath, fromRev, oldPath);
  return Promise.all([diff, before]).then(([result, old]) => (result && result.ok && old && old.ok ? { ...result, oldContent: old.content || '' } : result));
}

// --- The popup ---

function gitGraphCloseComparePopup() {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('gg-cmp-overlay');
  if (!overlay) return;
  if (overlay.ggOnKey) document.removeEventListener('keydown', overlay.ggOnKey, true);
  overlay.remove();
}

/** The comparison over the window: Esc, the × or a click beside it closes it. */
function gitGraphShowComparePopup(spec) {
  gitGraphCloseComparePopup();
  const overlay = document.createElement('div');
  overlay.id = 'gg-cmp-overlay';
  overlay.className = 'gg-cmp-overlay';
  const panel = document.createElement('div');
  panel.className = 'gg-cmp-popup';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Compare commits');
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlay.onmousedown = (e) => { if (e.target === overlay) gitGraphCloseComparePopup(); };
  // Before the History's own Esc (which closes the open record): the popup goes first.
  overlay.ggOnKey = (e) => {
    if (e.key !== 'Escape' || document.getElementById('gg-diff-host')) return;
    e.preventDefault();
    e.stopPropagation();
    gitGraphCloseComparePopup();
  };
  document.addEventListener('keydown', overlay.ggOnKey, true);
  gitGraphRenderCompareView(panel, spec, {
    fresh: true,
    onClose: gitGraphCloseComparePopup,
    onOpenWindow: () => {
      gitGraphCompareCall('openGitCompareWindow', spec.projectId, spec.repoPath, spec.hashes, spec.labels, spec.subjects);
      gitGraphCloseComparePopup();
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GG_COMPARE_MAX, gitGraphCompareOrder, gitGraphCompareSteps, gitGraphCompareStepArgs, gitGraphCompareMatrix,
    gitGraphSelectAllHashes, gitGraphCompareLabel, gitGraphCompareSubject, gitGraphCompareSpecFor, gitGraphCompareButtonsHtml,
    gitGraphCompareTableHtml, gitGraphCompareTitleHtml, gitGraphCompareDisplayRows, gitGraphCompareFirstPath,
    gitGraphCompareFileDiff, gitGraphRenderCompareView, gitGraphShowComparePopup, gitGraphCloseComparePopup, gitGraphCompareCall,
  };
}
