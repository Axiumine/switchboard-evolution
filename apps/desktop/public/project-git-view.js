// The Git tab of a project: Changes (staging), History (the Git Graph) and
// Worktrees. Repositories are the folders attached to the project; every git
// command runs in main and the renderer only receives data.
//
// Changes stages and unstages like a Git client: whole files from the lists
// (Merge Changes, Staged Changes, Changes, as VS Code groups them), and hunks
// or picked lines from a file's diff (git-diff-model.js names the lines; the
// main process builds the patch and applies it to the index).

const projectGitTabState = new Map();

// 'list' or 'tree'; one preference for every project, like DIFF_MODE_KEY.
const GIT_CHANGES_VIEW_KEY = 'gitChangesView';

function gitChangesViewMode() {
  let stored = null;
  try { stored = localStorage.getItem(GIT_CHANGES_VIEW_KEY); } catch {}
  return stored === 'list' ? 'list' : 'tree';
}

function setGitChangesViewMode(mode) {
  try { localStorage.setItem(GIT_CHANGES_VIEW_KEY, mode); } catch {}
}

function gitTabState(projectId) {
  if (!projectGitTabState.has(projectId)) {
    projectGitTabState.set(projectId, {
      workspaceView: 'changes',
      repositories: null,
      selectedRepo: null,
      selectedFiles: new Map(), // repo path -> `${side}\0${path}`
      selectionHint: new Map(), // repo path -> { side, path, index }, to land near it after a change
      diffs: new Map(), // `${repo}\0${side}\0${path}` -> { diff, truncated, diffId, parsed } | { error }
      picked: new Map(), // same key -> Set of picked line indices
      busy: false,
      collapsedFolders: new Map(), // repo path -> Set of collapsed tree folder keys
      request: 0,
      error: '',
    });
  }
  return projectGitTabState.get(projectId);
}

// The Git tab's views, in the order its switch shows them.
const GIT_WORKSPACE_VIEWS = ['changes', 'history', 'worktrees'];

function projectGitView(projectOrId) {
  const projectId = typeof projectOrId === 'string' ? projectOrId : projectOrId?.id;
  const view = projectId && gitTabState(projectId).workspaceView;
  return GIT_WORKSPACE_VIEWS.includes(view) ? view : 'changes';
}

function setProjectGitView(projectOrId, view) {
  const projectId = typeof projectOrId === 'string' ? projectOrId : projectOrId?.id;
  if (!projectId || !GIT_WORKSPACE_VIEWS.includes(view)) return;
  const changesState = gitTabState(projectId);
  const current = projectGitView(projectId);

  // Both views have their own richer state, but the selected repository is a
  // workspace-level choice. Carry it across when the user changes views.
  if (typeof gitGraphState === 'function') {
    const historyState = gitGraphState(projectId);
    if (current === 'changes' && view === 'history' && changesState.selectedRepo) {
      historyState.selectedRepo = changesState.selectedRepo;
    } else if (current === 'history' && view === 'changes' && historyState.selectedRepo) {
      changesState.selectedRepo = historyState.selectedRepo;
    }
  }
  changesState.workspaceView = view;
}

function gitWorkspaceNavHtml(view) {
  const button = (name, label) => `<button type="button" id="git-workspace-${name}-tab" class="git-workspace-nav-btn${view === name ? ' active' : ''}" data-git-view="${name}" role="tab" aria-selected="${view === name}" aria-controls="git-workspace-view">${label}</button>`;
  return `<div class="git-workspace-subnav"><div class="git-workspace-nav" role="tablist" aria-label="Git view">${button('changes', 'Changes')}${button('history', 'History')}${button('worktrees', 'Worktrees')}</div></div>`;
}

/**
 * The Git tab: Changes (working tree and diffs), History (the Git Graph,
 * with its actions), as upstream lays it out, and Worktrees.
 */
function renderProjectGitWorkspace(project, body) {
  const view = projectGitView(project);
  body.className = 'ws-body git-workspace-body';
  body.innerHTML = `${gitWorkspaceNavHtml(view)}<div class="git-workspace-view" id="git-workspace-view" role="tabpanel" aria-labelledby="git-workspace-${view}-tab"></div>`;

  body.querySelectorAll('.git-workspace-nav-btn').forEach((button) => {
    button.onclick = () => {
      if (button.dataset.gitView === projectGitView(project)) return;
      setProjectGitView(project, button.dataset.gitView);
      renderProjectGitWorkspace(project, body);
    };
  });

  const viewBody = body.querySelector('#git-workspace-view');
  if (view === 'history') renderProjectGitGraphTab(project, viewBody);
  else if (view === 'worktrees') renderProjectWorktreesTab(project, viewBody);
  else renderProjectGitTab(project, viewBody);
}

function gitCollapsedSet(state, repoPath) {
  if (!state.collapsedFolders.has(repoPath)) state.collapsedFolders.set(repoPath, new Set());
  return state.collapsedFolders.get(repoPath);
}

function gitRepoName(repo) {
  return pathBasename(repo.path) || repo.path;
}

function gitRelativeTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatDate(date);
}

function gitSyncText(repo) {
  if (repo.ahead === null || repo.behind === null) return 'No upstream';
  if (!repo.ahead && !repo.behind) return 'Up to date';
  const parts = [];
  if (repo.ahead) parts.push(`${repo.ahead} ahead`);
  if (repo.behind) parts.push(`${repo.behind} behind`);
  return parts.join(' · ');
}

function gitChangeMeta(change) {
  if (change.status === 'untracked') return 'Untracked';
  if (change.status === 'conflicted') return 'Conflicted';
  const inIndex = change.indexStatus !== ' ' && change.indexStatus !== '?';
  const inWorktree = change.worktreeStatus !== ' ' && change.worktreeStatus !== '?';
  if (inIndex && inWorktree) return 'Staged + unstaged';
  return inIndex ? 'Staged' : 'Unstaged';
}

function gitChangeCode(change) {
  return {
    conflicted: '!',
    untracked: '?',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    modified: 'M',
  }[change.status] || 'M';
}

// --- Staging: the lists by side, as VS Code groups them ---

const GICONS = {
  plus: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>`,
  check: (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>`,
};

const GIT_SIDES = [
  { side: 'merge', label: 'Merge Changes' },
  { side: 'staged', label: 'Staged Changes' },
  { side: 'unstaged', label: 'Changes' },
];

/** Whether this desktop can stage (it always can; the guard keeps the tests' fake api read-only). */
function gitCanStage() {
  return typeof window !== 'undefined' && typeof window.api?.stageProjectGitFiles === 'function';
}

/** { merge, staged, unstaged }: a file staged and changed again is in both of the last two. */
function gitSideLists(changes) {
  const lists = { merge: [], staged: [], unstaged: [] };
  for (const change of changes) {
    if (change.status === 'conflicted') { lists.merge.push(change); continue; }
    if (change.indexStatus && change.indexStatus !== ' ' && change.indexStatus !== '?') lists.staged.push(change);
    if (change.status === 'untracked' || (change.worktreeStatus && change.worktreeStatus !== ' ')) lists.unstaged.push(change);
    // A change without the two letters (an old main process) is listed once.
    if (!change.indexStatus && !change.worktreeStatus && change.status !== 'untracked') lists.unstaged.push(change);
  }
  return lists;
}

/** The letter a side shows for a file: its index letter when staged, its working-tree letter otherwise. */
function gitSideCode(change, side) {
  if (side === 'merge' || change.status === 'conflicted') return '!';
  if (change.status === 'untracked') return 'U';
  const letter = side === 'staged' ? change.indexStatus : change.worktreeStatus;
  return ['M', 'A', 'D', 'R', 'C', 'T'].includes(letter) ? letter : gitChangeCode(change);
}

function gitCodeClass(code) {
  return { A: 'added', U: 'untracked', D: 'deleted', R: 'renamed', C: 'renamed', '!': 'conflicted' }[code] || 'modified';
}

function gitSelectionKey(side, path) {
  return `${side}\0${path}`;
}

/** The side of the diff to show for a list: a conflicted file shows its working tree. */
function gitDiffSide(side) {
  return side === 'staged' ? 'staged' : 'unstaged';
}

function gitDiffKey(repo, side, path) {
  return `${repo.path}\0${gitDiffSide(side)}\0${path}`;
}

/** Every (side, change) the lists show, in order. */
function gitSideItems(changes) {
  const lists = gitSideLists(changes);
  return GIT_SIDES.flatMap(({ side }) => lists[side].map(change => ({ side, change })));
}

/** The item to select: the one remembered, or near where it was before it left its list. */
function gitSelectedItem(state, repo, items) {
  const key = state.selectedFiles.get(repo.path);
  let selected = items.find(item => gitSelectionKey(item.side, item.change.path) === key);
  if (!selected && key) {
    const hint = state.selectionHint.get(repo.path);
    if (hint) {
      const same = items.filter(item => item.side === hint.side);
      selected = same[Math.min(hint.index, same.length - 1)]
        || items.find(item => item.change.path === hint.path) || null;
    }
  }
  return selected || items[0] || null;
}

function gitWarningHtml(repo) {
  const warnings = [];
  const conflicts = repo.changes.filter(change => change.status === 'conflicted').length;
  if (repo.operation) warnings.push(`${repo.operation[0].toUpperCase()}${repo.operation.slice(1)} in progress`);
  if (conflicts) warnings.push(`${conflicts} conflicted file${conflicts === 1 ? '' : 's'}`);
  if (repo.detached) warnings.push(`Detached at ${repo.head || 'HEAD'}`);
  if (!warnings.length) return '';
  return `<div class="git-alert">${escapeHtml(warnings.join(' · '))}</div>`;
}

function gitOverviewHtml(repo) {
  const latest = repo.commits[0];
  const changed = repo.changes.length;
  const statParts = [];
  if (repo.stats.insertions) statParts.push(`<span class="git-plus">+${repo.stats.insertions}</span>`);
  if (repo.stats.deletions) statParts.push(`<span class="git-minus">−${repo.stats.deletions}</span>`);
  return `
    ${gitWarningHtml(repo)}
    <section class="git-summary">
      <div class="git-summary-top">
        <span class="git-branch">${PICONS.branch(14)}<span>${escapeHtml(repo.detached ? (repo.head || 'Detached HEAD') : (repo.branch || 'Unknown branch'))}</span></span>
        <span class="git-clean-state ${changed ? 'changed' : 'clean'}">${changed ? `${changed} changed file${changed === 1 ? '' : 's'}` : 'Clean'}</span>
      </div>
      <div class="git-summary-meta">
        <span>${escapeHtml(gitSyncText(repo))}</span>
        ${statParts.length ? `<span class="git-stat">${statParts.join(' ')}</span>` : ''}
      </div>
      <div class="git-latest">
        <span class="git-kicker">Latest commit</span>
        ${latest
          ? `<span class="git-latest-subject">${escapeHtml(latest.subject)}</span><span class="git-latest-meta"><span class="mono">${escapeHtml(latest.shortHash)}</span> · ${escapeHtml(latest.author)} · ${escapeHtml(gitRelativeTime(latest.date))}</span>`
          : '<span class="git-empty-inline">No commits yet</span>'}
      </div>
    </section>`;
}

function gitDiffLines(diff) {
  return String(diff || '').split('\n').map((line) => {
    let cls = '';
    if (line.startsWith('@@')) cls = ' hunk';
    else if (line.startsWith('+') && !line.startsWith('+++')) cls = ' add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = ' remove';
    else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity index|rename (from|to))/.test(line)) cls = ' header';
    return `<span class="git-diff-line${cls}">${line ? escapeHtml(line) : ' '}</span>`;
  }).join('');
}

/** What a diff's file header says, in words: new, deleted, renamed, mode changed, binary. */
function gitDiffNote(parsed) {
  if (!parsed) return '';
  const notes = [];
  for (const index of parsed.header) {
    const line = parsed.lines[index];
    if (line.startsWith('new file mode')) notes.push('New file');
    else if (line.startsWith('deleted file mode')) notes.push('Deleted file');
    else if (line.startsWith('rename from ')) notes.push(`Renamed from ${line.slice(12)}`);
    else if (line.startsWith('old mode ')) notes.push(`Mode ${line.slice(9)}`);
    else if (line.startsWith('new mode ')) notes.push(`→ ${line.slice(9)}`);
  }
  if (parsed.binary) notes.push('Binary file');
  return notes.join(' · ');
}

/** The hunks of a diff, each line with its numbers and a gutter to pick it by. */
function gitHunksHtml(parsed, picked, side) {
  const verb = side === 'staged' ? 'Unstage' : 'Stage';
  return parsed.hunks.map((hunk, h) => {
    const lines = hunk.lines.map((line) => {
      if (line.kind === 'eof') return `<div class="git-dl eof"><span class="git-dl-gutter"></span><span class="git-dl-text">${escapeHtml(line.text.replace(/^\\ ?/, ''))}</span></div>`;
      const changed = line.kind === 'add' || line.kind === 'remove';
      const sign = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
      const on = changed && picked.has(line.index);
      return `<div class="git-dl ${line.kind}${on ? ' picked' : ''}"${changed ? ` data-index="${line.index}"` : ''}>`
        + `<span class="git-dl-gutter"${changed ? ` title="Click or drag to pick lines to ${verb.toLowerCase()}; Shift+click picks a range"` : ''}>`
        + `<span class="git-dl-num">${line.oldLine ?? ''}</span><span class="git-dl-num">${line.newLine ?? ''}</span><span class="git-dl-sign">${sign}</span></span>`
        + `<span class="git-dl-text">${line.text ? escapeHtml(line.text) : ' '}</span></div>`;
    }).join('');
    return `<div class="git-hunk" data-hunk="${h}">
      <div class="git-hunk-head"><span class="git-hunk-range mono">@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@</span><span class="git-hunk-section mono">${escapeHtml(hunk.section)}</span><button type="button" class="ws-ghost ws-ghost--sm git-hunk-act" data-hunk="${h}">${verb} Hunk</button></div>
      ${lines}
    </div>`;
  }).join('');
}

function gitDiffSideLabel(side, change) {
  if (side === 'merge') return 'Merge conflict';
  if (side === 'staged') return 'Staged';
  return change.status === 'untracked' ? 'Untracked' : 'Unstaged';
}

/** The header of the diff: the file, which side, and the staging buttons. */
function gitDiffHeadHtml(item, cached) {
  const { side, change } = item;
  const renamed = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
  let actions = '';
  if (gitCanStage()) {
    const pickable = cached && !cached.error && cached.parsed && GitDiffModelLib().canPickLines(cached.parsed) && !cached.truncated;
    const verb = side === 'staged' ? 'Unstage' : 'Stage';
    const fileLabel = side === 'merge' ? 'Mark as Resolved' : `${verb} File`;
    actions = `<span class="git-diff-actions">
      ${pickable ? `<button type="button" class="ws-ghost ws-ghost--sm git-pick-clear" hidden>Clear</button><button type="button" class="ws-ghost ws-ghost--sm git-pick-act" disabled>${verb} Selected Lines</button>` : ''}
      <button type="button" class="ws-ghost ws-ghost--sm git-file-act">${side === 'staged' ? GICONS.minus(12) : side === 'merge' ? GICONS.check(12) : GICONS.plus(12)}<span>${fileLabel}</span></button>
    </span>`;
  }
  return `<div class="git-diff-title"><span class="git-diff-file mono" title="${escapeHtml(renamed)}">${escapeHtml(renamed)}</span><span class="git-diff-side ${side}">${escapeHtml(gitDiffSideLabel(side, change))}</span>${actions}</div>`;
}

/** git-diff-model.js, as a global in the window. */
function GitDiffModelLib() {
  return typeof GitDiffModel !== 'undefined' ? GitDiffModel : null;
}

function paintGitDiff(project, state, repo, body, item) {
  const pane = body.querySelector('#git-diff-pane');
  if (!pane) return;
  if (!item) {
    pane.innerHTML = '<div class="git-diff-empty">Select a changed file to view its diff.</div>';
    return;
  }
  // An item from an older caller is a bare change.
  if (!item.change) item = { side: 'unstaged', change: item };
  const { side, change } = item;
  const staging = gitCanStage() && !!GitDiffModelLib();
  const key = staging ? gitDiffKey(repo, side, change.path) : `${repo.path}\0${change.path}`;
  const cached = state.diffs.get(key);
  const selectedKey = gitSelectionKey(side, change.path);
  const stillSelected = () => body.isConnected && state.selectedRepo === repo.path
    && (state.selectedFiles.get(repo.path) === selectedKey || state.selectedFiles.get(repo.path) === change.path);
  pane.dataset.path = change.path;
  // A diff read before the last refresh stays on screen while it is read
  // again, and is drawn again only if it changed: the scroll and the picked
  // lines stay where they are.
  if (!cached || (cached.stale && !cached.refreshing)) {
    if (!cached) pane.innerHTML = '<div class="git-diff-empty">Loading diff…</div>';
    else cached.refreshing = true;
    const request = staging
      ? window.api.getProjectGitDiff(project.id, repo.path, change.path, gitDiffSide(side))
      : window.api.getProjectGitDiff(project.id, repo.path, change.path);
    const settle = (next) => {
      const prev = state.diffs.get(key);
      state.diffs.set(key, next);
      if (!stillSelected()) return;
      if (prev && prev !== cached) return; // a newer read already landed
      if (prev && !prev.error && !next.error && prev.diff === next.diff) return;
      const scroll = body.scrollTop;
      paintGitDiff(project, state, repo, body, item);
      body.scrollTop = scroll;
    };
    request.then((result) => {
      if (result?.ok) {
        const diff = result.diff || '';
        settle({ diff, truncated: !!result.truncated, diffId: result.diffId || null, parsed: staging ? GitDiffModelLib().parseUnifiedDiff(diff) : null });
      } else {
        settle({ error: result?.error || 'Could not load this diff.' });
      }
    }).catch((err) => settle({ error: err?.message || 'Could not load this diff.' }));
    if (!cached) return;
  }
  if (cached.error) {
    pane.innerHTML = `<div class="git-diff-empty">${escapeHtml(cached.error)}</div>`;
    return;
  }
  if (!staging) {
    pane.innerHTML = cached.diff
      ? `<div class="git-diff-title mono">${escapeHtml(change.path)}</div><pre class="git-diff">${gitDiffLines(cached.diff)}</pre>`
      : `<div class="git-diff-title mono">${escapeHtml(change.path)}</div><div class="git-diff-empty">No textual diff is available.</div>`;
    return;
  }
  const parsed = cached.parsed;
  const model = GitDiffModelLib();
  const pickable = model.canPickLines(parsed) && !cached.truncated;
  // Picked lines belong to one exact diff; a new one starts with none.
  let entry = state.picked.get(key);
  if (!entry || entry.diffId !== cached.diffId) {
    entry = { diffId: cached.diffId, lines: new Set() };
    state.picked.set(key, entry);
  }
  const picked = entry.lines;
  const note = gitDiffNote(parsed);
  let content;
  if (!cached.diff) content = '<div class="git-diff-empty">No textual diff is available.</div>';
  else if (pickable) content = `<div class="git-hunks">${gitHunksHtml(parsed, picked, side)}</div>`;
  else content = `<pre class="git-diff">${gitDiffLines(cached.diff)}</pre>`;
  pane.innerHTML = `${gitDiffHeadHtml(item, cached)}${note ? `<div class="git-diff-note">${escapeHtml(note)}${cached.truncated ? ' · too long to stage in parts' : ''}</div>` : (cached.truncated ? '<div class="git-diff-note">Too long to stage in parts</div>' : '')}${content}`;
  bindGitDiffPane(project, state, repo, body, item, { key, cached, pickable, picked });
}

/** The diff's buttons, and picking lines in its gutter by click, drag or Shift+click. */
function bindGitDiffPane(project, state, repo, body, item, { key, cached, pickable, picked }) {
  const pane = body.querySelector('#git-diff-pane');
  if (!pane || !gitCanStage()) return;
  const { side, change } = item;
  const verb = side === 'staged' ? 'Unstage' : 'Stage';
  const fileButton = pane.querySelector('.git-file-act');
  if (fileButton) {
    fileButton.onclick = () => gitStageFiles(project, state, repo, body, [change], side !== 'staged', item);
  }
  if (!pickable) return;
  const model = GitDiffModelLib();
  const pickButton = pane.querySelector('.git-pick-act');
  const clearButton = pane.querySelector('.git-pick-clear');
  const refresh = () => {
    pane.querySelectorAll('.git-dl[data-index]').forEach(el => el.classList.toggle('picked', picked.has(Number(el.dataset.index))));
    const n = picked.size;
    if (pickButton) {
      pickButton.disabled = n === 0;
      pickButton.textContent = n ? `${verb} ${n} Selected Line${n === 1 ? '' : 's'}` : `${verb} Selected Lines`;
    }
    if (clearButton) clearButton.hidden = n === 0;
  };
  refresh();
  if (pickButton) pickButton.onclick = () => gitStageLines(project, state, repo, body, item, cached, [...picked]);
  if (clearButton) clearButton.onclick = () => { picked.clear(); refresh(); };
  pane.querySelectorAll('.git-hunk-act').forEach((button) => {
    button.onclick = () => gitStageLines(project, state, repo, body, item, cached, model.changedLineIndices(cached.parsed, Number(button.dataset.hunk)));
  });

  const order = model.changedLineIndices(cached.parsed);
  const between = (a, b) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return order.filter(i => i >= lo && i <= hi);
  };
  let drag = null; // { anchor, on, base }
  pane.onmousedown = (event) => {
    const gutter = event.target.closest('.git-dl-gutter');
    const line = gutter?.closest('.git-dl[data-index]');
    if (!line || event.button !== 0) return;
    event.preventDefault();
    const index = Number(line.dataset.index);
    if (event.shiftKey && state.pickAnchor?.key === key) {
      for (const i of between(state.pickAnchor.index, index)) picked.add(i);
      refresh();
      return;
    }
    const on = !picked.has(index);
    drag = { anchor: index, on, base: new Set(picked) };
    state.pickAnchor = { key, index };
    if (on) picked.add(index); else picked.delete(index);
    refresh();
    const stop = () => { drag = null; document.removeEventListener('mouseup', stop); };
    document.addEventListener('mouseup', stop);
  };
  pane.onmouseover = (event) => {
    if (!drag) return;
    const line = event.target.closest('.git-dl[data-index]');
    if (!line) return;
    const range = new Set(between(drag.anchor, Number(line.dataset.index)));
    picked.clear();
    for (const i of drag.base) picked.add(i);
    for (const i of range) { if (drag.on) picked.add(i); else picked.delete(i); }
    refresh();
  };
}

/** The scroll of the tab, to put back after the lists are drawn again. */
function gitScrollOf(body) {
  return body.scrollTop;
}

async function gitAfterStaging(project, state, repo, body, item, result) {
  if (result && result.ok === false && result.code !== 'STALE') alert(result.error || 'Git could not do this.');
  if (item) {
    const lists = gitSideLists(repo.changes);
    const index = (lists[item.side] || []).findIndex(c => c.path === item.change.path);
    state.selectionHint.set(repo.path, { side: item.side, path: item.change.path, index: Math.max(0, index) });
  }
  await refreshGitRepositories(project, state, body);
  if (result?.code === 'STALE') {
    const pane = body.querySelector('#git-diff-pane');
    pane?.insertAdjacentHTML('afterbegin', `<div class="git-diff-note is-warning">${escapeHtml(result.error)}</div>`);
  }
}

async function gitStageFiles(project, state, repo, body, changes, stage, item = null) {
  if (state.busy || !changes.length) return;
  state.busy = true;
  body.classList.add('is-busy');
  const paths = [...new Set(changes.flatMap(c => (!stage && c.oldPath ? [c.path, c.oldPath] : [c.path])))];
  let result;
  try { result = await window.api.stageProjectGitFiles(project.id, repo.path, paths, stage); } catch (err) { result = { ok: false, error: err.message }; }
  state.busy = false;
  body.classList.remove('is-busy');
  await gitAfterStaging(project, state, repo, body, item, result);
}

async function gitStageLines(project, state, repo, body, item, cached, lines) {
  if (state.busy || !lines.length) return;
  state.busy = true;
  body.classList.add('is-busy');
  let result;
  try {
    result = await window.api.stageProjectGitLines(project.id, repo.path, item.change.path, gitDiffSide(item.side), cached.diffId, lines);
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  state.busy = false;
  body.classList.remove('is-busy');
  if (result?.ok) state.picked.delete(gitDiffKey(repo, item.side, item.change.path));
  await gitAfterStaging(project, state, repo, body, item, result);
}

/** Read the repositories again and redraw, keeping the selection and the scroll. */
async function refreshGitRepositories(project, state, body) {
  const scroll = gitScrollOf(body);
  let result;
  try { result = await window.api.getProjectGitInfo(project.id); } catch (err) { result = { ok: false, error: err.message }; }
  if (!result?.ok) return;
  for (const entry of state.diffs.values()) entry.stale = true;
  state.repositories = result.repositories || [];
  if (!body.isConnected) return;
  paintGitRepository(project, state, body);
  body.scrollTop = scroll;
}

function gitNaturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Folders before files; a folder whose only child is a folder is merged into
// one row ("src/app"), like VS Code's compact folders.
function gitSortTreeLevel(nodes) {
  const sorted = nodes.map((node) => {
    if (node.kind !== 'folder') return node;
    let name = node.name;
    let children = gitSortTreeLevel(node.children);
    while (children.length === 1 && children[0].kind === 'folder') {
      name = `${name}/${children[0].name}`;
      children = children[0].children;
    }
    return { kind: 'folder', name, children };
  });
  sorted.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return gitNaturalCompare(a.name, b.name);
  });
  return sorted;
}

// Git reports paths with '/' on every platform; renames sit at their new path.
function buildGitChangeTree(changes) {
  const root = new Map();
  for (const change of changes) {
    const parts = String(change.path || '').split('/').filter(Boolean);
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let node = level.get(part);
      if (!node || node.kind !== 'folder') {
        node = { kind: 'folder', name: part, children: new Map() };
        level.set(part, node);
      }
      level = node.children;
    }
    const fileName = parts[parts.length - 1] || change.path;
    level.set(`\0${fileName}`, { kind: 'file', name: fileName, change });
  }
  const toArray = (map) => [...map.values()].map(node => node.kind === 'folder' ? { ...node, children: toArray(node.children) } : node);
  return gitSortTreeLevel(toArray(root));
}

function gitTreeFileCount(node) {
  let count = 0;
  for (const child of node.children) count += child.kind === 'file' ? 1 : gitTreeFileCount(child);
  return count;
}

// Visible rows in display order; collapsed folders keep their own row only.
function gitTreeRows(tree, collapsedSet, keyPrefix, depth = 0) {
  const rows = [];
  for (const node of tree) {
    const key = keyPrefix ? `${keyPrefix}/${node.name}` : node.name;
    if (node.kind === 'folder') {
      const collapsed = collapsedSet.has(key);
      rows.push({ kind: 'folder', depth, name: node.name, key, count: gitTreeFileCount(node), collapsed });
      if (!collapsed) rows.push(...gitTreeRows(node.children, collapsedSet, key, depth + 1));
    } else {
      rows.push({ kind: 'file', depth, name: node.name, key, change: node.change });
    }
  }
  return rows;
}

/** A changed file's row: its letter for this side, icon, name, and the stage / unstage button. */
function createGitFileRow(project, state, repo, body, list, change, isSelected, opts) {
  const tree = !!(opts && opts.tree);
  const side = (opts && opts.side) || 'unstaged';
  const row = document.createElement('div');
  row.className = 'git-file-row' + (tree ? ' tree' : '') + (isSelected ? ' selected' : '');
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.dataset.key = gitSelectionKey(side, change.path);
  if (tree) row.style.setProperty('--depth', String(opts.depth || 0));
  const renamed = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
  const meta = gitChangeMeta(change);
  const staging = gitCanStage();
  row.title = staging ? `${renamed}\n${gitDiffSideLabel(side, change)}` : (tree ? `${renamed}\n${meta}` : renamed);
  const code = staging ? gitSideCode(change, side) : gitChangeCode(change);
  const codeClass = staging ? gitCodeClass(code) : change.status;
  const name = (opts && opts.name) || pathBasename(change.path) || change.path;
  const dir = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '';
  const icon = typeof fileIconHtml === 'function' ? fileIconHtml(name) : '';
  let action = '';
  if (staging) {
    action = side === 'staged'
      ? `<button type="button" class="git-row-act" data-act="unstage" title="Unstage Changes" aria-label="Unstage ${escapeHtml(name)}">${GICONS.minus(13)}</button>`
      : `<button type="button" class="git-row-act" data-act="stage" title="${side === 'merge' ? 'Stage (Mark as Resolved)' : 'Stage Changes'}" aria-label="Stage ${escapeHtml(name)}">${GICONS.plus(13)}</button>`;
  }
  // Without staging (an old main process), the row still says which state the file is in.
  const marker = !staging && tree && change.status !== 'untracked' && change.status !== 'conflicted'
    ? `<span class="git-file-meta">${escapeHtml(meta)}</span>` : '';
  if (tree) {
    row.innerHTML = `<span class="git-file-code ${escapeHtml(codeClass)}">${escapeHtml(code)}</span>${icon}<span class="git-file-path mono">${escapeHtml(opts.name || change.path)}</span>${marker}<span class="git-row-acts">${action}</span>`;
  } else if (staging) {
    row.innerHTML = `<span class="git-file-code ${escapeHtml(codeClass)}">${escapeHtml(code)}</span>${icon}<span class="git-file-path mono">${escapeHtml(name)}</span><span class="git-file-dir">${escapeHtml(dir)}</span><span class="git-row-acts">${action}</span>`;
  } else {
    row.innerHTML = `<span class="git-file-code ${escapeHtml(change.status)}">${gitChangeCode(change)}</span>
        <span class="git-file-text"><span class="git-file-path mono">${escapeHtml(change.path)}</span><span class="git-file-meta">${escapeHtml(meta)}</span></span>`;
  }
  const select = () => {
    state.selectedFiles.set(repo.path, row.dataset.key);
    list.querySelectorAll('.git-file-row').forEach(el => el.classList.toggle('selected', el === row));
    paintGitDiff(project, state, repo, body, { side, change });
  };
  row.onclick = (event) => {
    const act = event && event.target && event.target.closest ? event.target.closest('.git-row-act') : null;
    if (act) {
      event.stopPropagation();
      gitStageFiles(project, state, repo, body, [change], act.dataset.act === 'stage', { side, change });
      return;
    }
    select();
  };
  row.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = [...list.querySelectorAll('.git-file-row, .git-folder-row')];
      const next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) { next.focus(); if (next.classList.contains('git-file-row')) next.click(); }
    }
  };
  return row;
}

function createGitFolderRow(project, state, repo, body, collapsedSet, row, holdsSelected) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'git-folder-row' + (holdsSelected ? ' selected' : '');
  button.dataset.key = row.key;
  button.style.setProperty('--depth', String(row.depth));
  button.setAttribute('aria-expanded', row.collapsed ? 'false' : 'true');
  const name = row.name.split('/').pop();
  const icon = typeof fileIconHtml === 'function' ? fileIconHtml(name, { dir: true, open: !row.collapsed }) : `<span class="git-folder-icon">${PICONS.folder(13)}</span>`;
  button.innerHTML = `
    <span class="git-folder-chevron">${row.collapsed ? PICONS.chevronRight(11) : PICONS.chevronDown(11)}</span>
    ${icon}
    <span class="git-folder-name mono">${escapeHtml(row.name)}</span>
    ${row.count ? `<span class="git-folder-count">${row.count}</span>` : ''}`;
  button.onclick = () => {
    if (collapsedSet.has(row.key)) collapsedSet.delete(row.key); else collapsedSet.add(row.key);
    paintGitChanges(project, state, repo, body, { repaintDiff: false });
    // The list was rebuilt, so put keyboard focus back on the new copy of this row.
    [...body.querySelectorAll('.git-folder-row')].find(el => el.dataset.key === row.key)?.focus();
  };
  return button;
}

/** A list's heading: its name, how many files, and Stage All / Unstage All. */
function createGitGroupRow(project, state, repo, body, side, label, changes) {
  const head = document.createElement('div');
  head.className = 'git-file-group';
  const staging = gitCanStage();
  let action = '';
  if (staging && side === 'staged') action = `<button type="button" class="git-row-act" data-act="unstage-all" title="Unstage All Changes" aria-label="Unstage All Changes">${GICONS.minus(13)}</button>`;
  else if (staging) action = `<button type="button" class="git-row-act" data-act="stage-all" title="${side === 'merge' ? 'Stage All Merge Changes' : 'Stage All Changes'}" aria-label="Stage All">${GICONS.plus(13)}</button>`;
  head.innerHTML = `<span class="git-file-group-label">${escapeHtml(label)}</span><span class="git-file-group-count">${changes.length}</span><span class="git-row-acts">${action}</span>`;
  head.onclick = (event) => {
    const act = event && event.target && event.target.closest ? event.target.closest('.git-row-act') : null;
    if (!act) return;
    gitStageFiles(project, state, repo, body, changes, act.dataset.act === 'stage-all');
  };
  return head;
}

function paintGitChanges(project, state, repo, body, { repaintDiff = true } = {}) {
  const list = body.querySelector('#git-file-list');
  if (!list) return;
  const tree = gitChangesViewMode() === 'tree';
  const collapsedSet = gitCollapsedSet(state, repo.path);
  list.replaceChildren();

  if (!gitCanStage()) {
    // Read-only: the old grouping by kind of change.
    const groupOrder = ['conflicted', 'modified', 'added', 'deleted', 'renamed', 'untracked'];
    const groupLabels = { conflicted: 'Conflicted', modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', untracked: 'Untracked' };
    const selectedPath = state.selectedFiles.get(repo.path);
    const selected = repo.changes.find(change => change.path === selectedPath) || repo.changes[0] || null;
    if (selected) state.selectedFiles.set(repo.path, selected.path);
    for (const kind of groupOrder) {
      const changes = repo.changes.filter(change => change.status === kind);
      if (!changes.length) continue;
      const label = document.createElement('div');
      label.className = 'git-file-group';
      label.textContent = groupLabels[kind];
      list.appendChild(label);
      if (!tree) {
        for (const change of changes) list.appendChild(createGitFileRow(project, state, repo, body, list, change, selected?.path === change.path, { tree: false }));
        continue;
      }
      for (const row of gitTreeRows(buildGitChangeTree(changes), collapsedSet, kind)) {
        if (row.kind === 'folder') {
          const folderPath = row.key.slice(kind.length + 1);
          const holdsSelected = row.collapsed && selected?.status === kind && selected.path.startsWith(`${folderPath}/`);
          list.appendChild(createGitFolderRow(project, state, repo, body, collapsedSet, row, holdsSelected));
        } else {
          list.appendChild(createGitFileRow(project, state, repo, body, list, row.change, selected?.path === row.change.path, { tree: true, depth: row.depth, name: row.name }));
        }
      }
    }
    if (repaintDiff) paintGitDiff(project, state, repo, body, selected);
    return;
  }

  const lists = gitSideLists(repo.changes);
  const items = GIT_SIDES.flatMap(({ side }) => lists[side].map(change => ({ side, change })));
  const selected = gitSelectedItem(state, repo, items);
  if (selected) state.selectedFiles.set(repo.path, gitSelectionKey(selected.side, selected.change.path));
  const isSelected = (side, change) => !!selected && selected.side === side && selected.change.path === change.path;

  for (const { side, label } of GIT_SIDES) {
    const changes = lists[side];
    if (!changes.length) continue;
    list.appendChild(createGitGroupRow(project, state, repo, body, side, label, changes));
    if (!tree) {
      for (const change of changes) list.appendChild(createGitFileRow(project, state, repo, body, list, change, isSelected(side, change), { tree: false, side }));
      continue;
    }
    for (const row of gitTreeRows(buildGitChangeTree(changes), collapsedSet, side)) {
      if (row.kind === 'folder') {
        // A collapsed folder hiding the selected file stands in for it.
        const folderPath = row.key.slice(side.length + 1);
        const holdsSelected = row.collapsed && selected?.side === side && selected.change.path.startsWith(`${folderPath}/`);
        list.appendChild(createGitFolderRow(project, state, repo, body, collapsedSet, row, holdsSelected));
      } else {
        list.appendChild(createGitFileRow(project, state, repo, body, list, row.change, isSelected(side, row.change), { tree: true, depth: row.depth, name: row.name, side }));
      }
    }
  }
  if (repaintDiff) paintGitDiff(project, state, repo, body, selected);
}

function gitViewToggleHtml(mode) {
  const btn = (view, label, icon) => `<button type="button" class="git-view-btn${mode === view ? ' on' : ''}" data-view="${view}" title="${label}" aria-label="${label}" aria-pressed="${mode === view}">${icon}</button>`;
  return `<span class="git-view-toggle" role="group" aria-label="Changes view">
    ${btn('list', 'View as list', PICONS.list(13))}
    ${btn('tree', 'View as tree', PICONS.tree(13))}
  </span>`;
}

function paintGitRepository(project, state, body) {
  const repositories = state.repositories || [];
  if (!repositories.length) {
    body.innerHTML = '<div class="git-empty-state"><div class="git-empty-title">No folders attached</div><div>Git information will appear here when this project has an attached repository.</div></div>';
    return;
  }

  let repo = repositories.find(item => item.path === state.selectedRepo);
  if (!repo) repo = repositories.find(item => item.git) || repositories[0];
  state.selectedRepo = repo.path;

  const picker = repositories.length > 1 ? `
    <div class="git-repo-picker" role="tablist" aria-label="Repositories">
      ${repositories.map((item, index) => `<button type="button" class="git-repo-option ${item.path === repo.path ? 'active' : ''}" data-index="${index}">${escapeHtml(gitRepoName(item))}</button>`).join('')}
    </div>` : '';

  if (!repo.git) {
    body.innerHTML = `
      <div class="git-tab-shell">
        <div class="git-tab-top"><div><div class="git-tab-title">Git</div><div class="git-tab-path mono">${escapeHtml(repo.path)}</div></div><span class="git-readonly">Read only</span></div>
        ${picker}
        <div class="git-empty-state"><div class="git-empty-title">Not a Git repository</div><div>${escapeHtml(repo.path)}</div></div>
      </div>`;
  } else {
    const changed = repo.changes.length;
    body.innerHTML = `
      <div class="git-tab-shell">
        <div class="git-tab-top"><div><div class="git-tab-title">${escapeHtml(gitRepoName(repo))}</div><div class="git-tab-path mono">${escapeHtml(repo.path)}</div></div>${gitCanStage() ? '' : '<span class="git-readonly">Read only</span>'}</div>
        ${picker}
        ${gitOverviewHtml(repo)}
        <section class="git-section">
          <div class="git-section-heading"><span>Changes</span><span class="git-heading-right">${changed ? gitViewToggleHtml(gitChangesViewMode()) : ''}<span class="git-section-meta">${changed ? `${changed} file${changed === 1 ? '' : 's'}` : 'Working tree clean'}</span></span></div>
          ${changed ? '<div class="git-changes"><div class="git-file-list" id="git-file-list" role="tree" aria-label="Changed files"></div><div class="git-diff-pane" id="git-diff-pane"></div></div>' : '<div class="git-empty-row">There are no staged, unstaged, or untracked files.</div>'}
        </section>
      </div>`;
    if (changed) paintGitChanges(project, state, repo, body);
  }

  body.querySelectorAll('.git-repo-option').forEach(button => {
    const item = repositories[Number(button.dataset.index)];
    if (!item) return;
    button.title = item.path;
    button.onclick = () => {
      state.selectedRepo = item.path;
      paintGitRepository(project, state, body);
    };
  });

  body.querySelectorAll('.git-view-btn').forEach(button => {
    button.onclick = () => {
      setGitChangesViewMode(button.dataset.view);
      // Read back what was stored so the buttons match what gets rendered.
      const effective = gitChangesViewMode();
      body.querySelectorAll('.git-view-btn').forEach(btn => {
        const on = btn.dataset.view === effective;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
      });
      paintGitChanges(project, state, repo, body, { repaintDiff: false });
    };
  });
}

function renderProjectGitTab(project, body) {
  const state = gitTabState(project.id);
  body.className = 'git-workspace-view git-tab-body';
  if (state.repositories) paintGitRepository(project, state, body);
  else body.innerHTML = '<div class="git-loading"><span class="git-loading-dot"></span>Reading repository…</div>';

  const request = ++state.request;
  state.error = '';
  window.api.getProjectGitInfo(project.id).then((result) => {
    if (request !== state.request) return;
    if (!result?.ok) throw new Error(result?.error || 'Could not read Git information.');
    for (const entry of state.diffs.values()) entry.stale = true;
    state.repositories = result.repositories || [];
    if (body.isConnected && selectedProject()?.id === project.id && projectTab(project) === 'git' && projectGitView(project) === 'changes') {
      const scroll = body.scrollTop;
      paintGitRepository(project, state, body);
      body.scrollTop = scroll;
    }
  }).catch((err) => {
    if (request !== state.request) return;
    state.error = err?.message || 'Could not read Git information.';
    if (body.isConnected) body.innerHTML = `<div class="git-empty-state"><div class="git-empty-title">Git information unavailable</div><div>${escapeHtml(state.error)}</div></div>`;
  });
}
