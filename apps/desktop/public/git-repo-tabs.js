// git-repo-tabs.js — the row of repository tabs at the top of the Git tab's
// History, Pull Requests, Worktrees and Actions views.
//
// A click on a repository's name shows that repository alone. In the views
// that can show several repositories at once (History, Pull Requests,
// Worktrees), a checkbox appears before the name on hover: ticking it adds
// that repository to the ones shown, unticking it takes it away. Each
// repository has its color (repo-colors.js, the same on the phone), which
// paints its name wherever rows of several repositories are mixed.
//
// The selection is { primary, paths } (repo-selection.js); a view keeps it
// as state.selectedRepo (the primary, what the single-repository code uses)
// and state.selectedRepos (every path shown).

/** { path: color } for a project's repositories: its folders first, in their order, then any other repository listed. */
function gitRepoColors(project, repos) {
  const paths = ((project && project.folders) || []).map((folder) => folder && folder.path).filter(Boolean);
  if (project && project.root && !paths.includes(project.root)) paths.push(project.root);
  for (const repo of repos || []) {
    const path = repo && (repo.colorKey || repo.path);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return typeof RepoColors !== 'undefined' ? RepoColors.repoColorMap(paths) : {};
}

function gitRepoTabLabel(repo) {
  return repo.label || pathBasename(repo.path) || repo.path;
}

/** The view's selection, as { primary, paths }, made valid for the repositories it lists. */
function gitRepoSelectionOf(state, repos) {
  const available = (repos || []).map((repo) => repo.path);
  const selection = { primary: state.selectedRepo || null, paths: Array.isArray(state.selectedRepos) ? state.selectedRepos : [] };
  if (typeof RepoSelection === 'undefined') {
    const primary = available.includes(selection.primary) ? selection.primary : available[0] || null;
    return { primary, paths: primary ? [primary] : [] };
  }
  return RepoSelection.normalizeRepoSelection(available, selection);
}

function gitSetRepoSelection(state, selection) {
  state.selectedRepo = selection.primary || null;
  state.selectedRepos = [...(selection.paths || [])];
}

/** The repositories a view shows, in its order: the selected ones, or the primary alone. */
function gitShownRepos(state, repos) {
  const selection = gitRepoSelectionOf(state, repos);
  return (repos || []).filter((repo) => selection.paths.includes(repo.path));
}

function gitIsMultiRepo(state, repos) {
  return gitShownRepos(state, repos).length > 1;
}

/**
 * The tabs, or '' with one repository or none. repos: [{ path, label?, title? }];
 * opts.multi: show the checkboxes (History, Pull Requests, Worktrees);
 * opts.colors: { path: color }.
 */
function gitRepoTabsHtml(repos, selection, opts = {}) {
  const list = repos || [];
  if (list.length <= 1) return '';
  const multi = !!opts.multi;
  const shown = new Set((selection && selection.paths) || []);
  const primary = selection && selection.primary;
  const isMulti = multi && shown.size > 1;
  const colors = opts.colors || {};
  const tabs = list.map((repo, index) => {
    const label = gitRepoTabLabel(repo);
    const checked = multi ? shown.has(repo.path) : repo.path === primary;
    const active = checked;
    const color = colors[repo.colorKey || repo.path];
    const classes = ['gg-repo-option'];
    if (active) classes.push('active');
    if (multi && checked) classes.push('checked');
    if (repo.path === primary) classes.push('primary');
    const style = color ? ` style="--repo-color:${escapeAttr(color)}"` : '';
    const check = multi
      ? `<input type="checkbox" class="gg-repo-check" data-index="${index}" ${checked ? 'checked ' : ''}aria-label="${escapeAttr(checked ? `Hide ${label}` : `Also show ${label}`)}" title="${escapeAttr(checked ? 'Hide this repository' : 'Also show this repository')}">`
      : '';
    return `<div class="${classes.join(' ')}" data-index="${index}"${style}>${check}<button type="button" class="gg-repo-name" data-index="${index}" role="tab" aria-selected="${active}" title="${escapeAttr(repo.title || repo.path)}">${escapeHtml(label)}</button></div>`;
  }).join('');
  const classes = ['gg-repo-picker'];
  if (multi) classes.push('gg-repo-picker--multi');
  if (isMulti) classes.push('is-multi');
  return `<div class="${classes.join(' ')}" role="tablist" aria-label="Repositories"${multi ? ' aria-multiselectable="true"' : ''}>${tabs}</div>`;
}

/**
 * Wires the tabs: onOnly(repo) on a name, onToggle(repo) on a checkbox.
 * onToggle returns false when nothing changed (the last repository shown
 * cannot be taken away), and the checkbox goes back as it was.
 */
function gitWireRepoTabs(container, repos, handlers = {}) {
  if (!container) return;
  container.querySelectorAll('.gg-repo-name').forEach((button) => {
    const repo = (repos || [])[Number(button.dataset.index)];
    if (!repo) return;
    button.onclick = () => { if (handlers.onOnly) handlers.onOnly(repo); };
  });
  container.querySelectorAll('.gg-repo-check').forEach((box) => {
    const repo = (repos || [])[Number(box.dataset.index)];
    if (!repo) return;
    box.onclick = (event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      const changed = handlers.onToggle ? handlers.onToggle(repo) : false;
      if (changed === false) box.checked = !box.checked;
    };
  });
}

/** Applies a name click to a view's state; true when the selection changed. */
function gitRepoSelectOnly(state, repos, repo) {
  const before = gitRepoSelectionOf(state, repos);
  if (before.primary === repo.path && before.paths.length === 1) return false;
  gitSetRepoSelection(state, typeof RepoSelection !== 'undefined' ? RepoSelection.selectOnlyRepo(repo.path) : { primary: repo.path, paths: [repo.path] });
  return true;
}

/** Applies a checkbox click to a view's state; true when the selection changed. */
function gitRepoToggle(state, repos, repo) {
  if (typeof RepoSelection === 'undefined') return false;
  const before = gitRepoSelectionOf(state, repos);
  const after = RepoSelection.toggleRepoInSelection(before, repo.path, (repos || []).map((r) => r.path));
  if (after.paths.length === before.paths.length && after.primary === before.primary) return false;
  gitSetRepoSelection(state, after);
  return true;
}
