// "Git Graph" project tab: a mutating, interactive commit graph for the
// project's attached repositories, sitting immediately after the existing
// read-only "Git" tab (which this file never touches). Layout and painting
// (this file + git-graph-render.js) are self-contained; menu item lists and
// dialogs are built by git-graph-menus.js / git-graph-dialogs.js and only
// ever called through the small set of guarded globals below, so this tab
// still renders and its own tests still pass before those files exist.
//
// Depends on globals: escapeHtml, escapeAttr, formatDate, pathBasename
// (utils.js / projects-view.js), PICONS, showContextMenu (projects-view.js),
// createUnifiedMergeViewer, createReadOnlyViewer (codemirror-setup.js),
// selectedProject/projectTab (projects-view.js), buildGitChangeTree,
// gitTreeRows (project-git-view.js — the commit-details file tree reuses
// #98's tree builder rather than a second implementation), and the render
// helpers in git-graph-render.js (gitGraphFormatDate, gitGraphBuildLayoutInput,
// gitGraphResolveLayoutFn, gitGraphRenderGraphSvg, gitGraphRenderRefPills,
// gitGraphRowClasses, gitGraphDiffStatHtml, gitGraphFileStatusGlyph, gitGraphIcon),
// and gitGraphCompareCall/gitGraphCompareFileDiff (git-graph-compare.js) to
// read a file opened in a record.
//
// The History can show several repositories at once (git-repo-tabs.js: a
// checkbox on each tab). Then it is one merged table: each repository keeps
// its own slice of data (state.slices, keyed by path) and every row carries
// the repository it belongs to; a row's key is "<tag>:<hash>" (see
// gitGraphRepoKey in git-graph-render.js). With one repository shown, none of
// that exists: the state holds the repository's data itself, as always.

const GG_INITIAL_LOAD = 300;
const GG_LOAD_MORE = 100;

const gitGraphTabState = new Map();

function gitGraphState(projectId) {
  if (!gitGraphTabState.has(projectId)) {
    gitGraphTabState.set(projectId, {
      repositories: null,
      // The primary repository: what the toolbar's actions, the settings drawer
      // and every single-repository code path use.
      selectedRepo: null,
      // Every repository shown, as paths; more than one makes it a merged History.
      selectedRepos: [],
      // path -> one repository's own data while several are shown (gitGraphNewSlice).
      slices: new Map(),
      // Rows each repository holds below the merge's frontier, for Load More's plan.
      multiHeld: null,
      multiLists: null,
      request: 0,
      detailsRequest: 0,
      error: '',
      loading: false,
      rows: [],           // merged Commit[]+pseudo-commits, render order
      layout: [],          // parallel lane assignments
      refs: null,
      remotes: [],
      skip: 0,
      hasMore: false,
      loadingMore: false,
      branchSelection: 'all',
      tagSelection: 'all',
      refSort: 'asc',
      showRemoteBranches: true,
      order: 'date',
      firstParentOnly: false,
      columns: { date: true, author: true, commit: true },
      columnWidths: {},
      muteMergeCommits: true,
      muteNonAncestors: false,
      dateFormat: 'date-time',
      dateType: 'author',
      graphStyle: 'rounded',
      uncommittedChangesStyle: 'openAtUncommitted',
      combineLocalAndRemote: true,
      selectedHash: null,
      compareHash: null,
      // The commits ticked in the first column, for Compare (git-graph-compare.js).
      checkedHashes: new Set(),
      // The first column only shows after Enable Selection (the toolbar's "•••").
      selecting: false,
      detailsLocation: 'inline',
      detailsData: null,
      detailsLoading: false,
      detailsJustOpened: false,
      fileViewType: 'tree',
      collapsedFolders: new Set(),
      findOpen: false,
      findQuery: '',
      findCaseSensitive: false,
      findAlsoOpenDetails: false,
      findMatches: [],
      findIndex: -1,
      settingsOpen: false,
      settingsTab: 'repository',
      progress: null,
      keydownHandler: null,
      // Repository-scoped fields loaded from RepoConfig (git-graph-settings.js's
      // gitGraphApplyRepoConfigToState) once a repo's config is read.
      repoConfig: null,
      showTags: true,
      showStashesPref: true,
      showUncommittedChangesPref: true,
      includeReflogCommits: false,
      trustPromptShownFor: new Set(),
      // App-wide fields loaded from GlobalPrefs (gitGraphApplyGlobalPrefsToState).
      globalPrefs: null,
      graphColours: null,
      initialLoad: GG_INITIAL_LOAD,
      loadMore: GG_LOAD_MORE,
      loadMoreAutomatically: true,
      repositoryDropdownOrder: 'attachmentOrder',
      markdownRendering: true,
      referenceLabelAlignment: 'normal',
      globalFetchAvatars: false,
      autoCenterDetails: true,
      // Avatars and Code Review.
      avatarCache: new Map(),
      avatarPending: new Set(),
      codeReview: null,
      lastViewedFilePath: null,
      // The file open in the record, under the commit's text (gitGraphOpenFileIn).
      openFile: null,
      // Its viewer, taken out of the panel while the panel is drawn again (gitGraphKeepFileView).
      keptFileView: null,
    });
  }
  return gitGraphTabState.get(projectId);
}

// --- window.api wrapper: degrades gracefully if the preload bridge doesn't expose a given call yet ---

function gitGraphApi(name, ...args) {
  if (!window.api || typeof window.api[name] !== 'function') {
    return Promise.resolve({ error: `${name} is not available yet` });
  }
  return window.api[name](...args);
}

// --- Per-viewer ephemeral UI-state persistence: localStorage, not server-side
// — resets are acceptable, matching the existing tab-memory idiom. ---

function gitGraphUiKey(projectId) { return `gitGraph.ui.${projectId}`; }

function gitGraphLoadUiPrefs(projectId) {
  try {
    const raw = localStorage.getItem(gitGraphUiKey(projectId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function gitGraphSaveUiPrefs(projectId, state) {
  try {
    localStorage.setItem(gitGraphUiKey(projectId), JSON.stringify({
      selectedRepo: state.selectedRepo,
      selectedRepos: state.selectedRepos,
      columns: state.columns,
      columnWidths: state.columnWidths,
      branchSelection: state.branchSelection,
      tagSelection: state.tagSelection,
      refSort: state.refSort,
      showRemoteBranches: state.showRemoteBranches,
      order: state.order,
      findOpen: state.findOpen,
    }));
  } catch { /* private-browsing / disabled storage: ephemeral state only */ }
}

// --- The repositories shown ---

/** The selection ({ primary, paths }) made valid for the repositories listed: git-repo-tabs.js's, or the primary alone when that file is not loaded. */
function gitGraphSelection(state) {
  const repos = state.repositories || [];
  if (typeof gitRepoSelectionOf === 'function') return gitRepoSelectionOf(state, repos);
  const primary = (repos.find(r => r.path === state.selectedRepo) || repos[0] || {}).path || null;
  return { primary, paths: primary ? [primary] : [] };
}

/** The repositories the History shows, in the order of its tabs: the selected ones that are Git repositories, or else the primary alone. */
function gitGraphShownRepos(state) {
  const repos = state.repositories || [];
  const selection = gitGraphSelection(state);
  const shown = repos.filter(r => selection.paths.includes(r.path) && r.git !== false);
  if (shown.length > 1) return shown;
  const primary = repos.find(r => r.path === state.selectedRepo) || repos.find(r => r.path === selection.primary) || repos[0];
  return primary ? [primary] : [];
}

/** True while several repositories are shown as one History. */
function gitGraphIsMulti(state) {
  return gitGraphShownRepos(state).length > 1;
}

/** What the shown repositories are, as a string: a History loaded for another selection has to be loaded again. */
function gitGraphSelectionKey(state) {
  return gitGraphShownRepos(state).map(r => r.path).join('\n');
}

/** "r<index>": the repository's position among the tabs, which names its rows (gitGraphRepoKey). */
function gitGraphRepoTag(state, path) {
  const index = (state.repositories || []).findIndex(r => r.path === path);
  return index < 0 ? null : `r${index}`;
}

function gitGraphRepoByTag(state, tag) {
  const match = /^r(\d+)$/.exec(tag || '');
  return match ? (state.repositories || [])[Number(match[1])] || null : null;
}

function gitGraphPrimaryRepo(state) {
  return (state.repositories || []).find(r => r.path === state.selectedRepo) || null;
}

/** The repository a row belongs to: the one its key names with several shown, the primary otherwise. */
function gitGraphRowRepo(state, key) {
  const { tag } = gitGraphSplitKey(key);
  return (tag && gitGraphRepoByTag(state, tag)) || gitGraphPrimaryRepo(state);
}

/**
 * The object holding the data of a row's repository (refs, stashes, remotes,
 * repoConfig, headHash, branchSelection, …): its slice when the row is of a
 * History of several repositories, the state itself otherwise. Both have the
 * same field names, so what reads them does not care which it got.
 */
function gitGraphRowView(state, key) {
  const { tag } = gitGraphSplitKey(key);
  if (!tag) return state;
  const repo = gitGraphRepoByTag(state, tag);
  return (repo && state.slices && state.slices.get(repo.path)) || state;
}

/** The same for a repository by its path. */
function gitGraphViewByPath(state, path) {
  const slice = state.slices && state.slices.get(path);
  return slice && gitGraphIsMulti(state) ? slice : state;
}

/** The repository the open record (commit or comparison) belongs to. */
function gitGraphDetailsRepo(state) {
  const path = state.detailsData && state.detailsData.repoPath;
  return (path && (state.repositories || []).find(r => r.path === path)) || gitGraphPrimaryRepo(state);
}

function gitGraphDetailsRepoPath(state) {
  const repo = gitGraphDetailsRepo(state);
  return repo ? repo.path : state.selectedRepo;
}

function gitGraphDetailsView(state) {
  return gitGraphViewByPath(state, gitGraphDetailsRepoPath(state));
}

/** Whether ticked or named commits are of different repositories. */
function gitGraphMixedRepos(keys) {
  return new Set((keys || []).map(key => gitGraphSplitKey(key).tag)).size > 1;
}

// --- Slices: one repository's data in a History of several ---

// What every repository of the History keeps for itself (the primary's are
// the state's own fields too: they move between the two, see gitGraphAdoptPrimary).
const GG_SLICE_SETTINGS = ['branchSelection', 'tagSelection', 'showTags', 'showStashesPref', 'showUncommittedChangesPref', 'includeReflogCommits'];

function gitGraphNewSlice(path) {
  return {
    path, tag: null,
    rawCommits: [], refs: null, stashes: [], uncommitted: null, headHash: null, headBranchName: null,
    remotes: [], repoConfig: null, configLoaded: false,
    branchSelection: 'all', tagSelection: 'all', showTags: true, showStashesPref: true, showUncommittedChangesPref: true, includeReflogCommits: false,
    hasMore: false, error: '', request: 0,
  };
}

/** The primary's settings, as the state holds them, onto its slice (or the other way round). */
function gitGraphCopySettings(from, to) {
  for (const field of GG_SLICE_SETTINGS) to[field] = from[field];
}

/** The slices for the repositories shown: made for the new ones, dropped for those no longer shown, tagged for where the tabs are now. */
function gitGraphSyncSlices(state, repos) {
  if (!state.slices) state.slices = new Map();
  const paths = new Set(repos.map(r => r.path));
  for (const path of [...state.slices.keys()]) if (!paths.has(path)) state.slices.delete(path);
  for (const repo of repos) {
    let slice = state.slices.get(repo.path);
    if (!slice) {
      slice = gitGraphNewSlice(repo.path);
      state.slices.set(repo.path, slice);
      // The primary's config is the one the state already holds, when it holds one.
      if (repo.path === state.selectedRepo && state.repoConfig) { slice.repoConfig = state.repoConfig; slice.configLoaded = true; }
    }
    slice.tag = gitGraphRepoTag(state, repo.path);
    if (repo.path === state.selectedRepo) gitGraphCopySettings(state, slice);
  }
}

/** A repository becomes the primary: the state takes its settings and data, as the state holds the primary's. */
function gitGraphAdoptPrimary(state) {
  const slice = state.slices && state.slices.get(state.selectedRepo);
  if (!slice) return;
  gitGraphCopySettings(slice, state);
  gitGraphMirrorPrimary(state);
}

/** The primary's data from its slice onto the state, for what reads the state's own fields (the settings drawer, Fetch). */
function gitGraphMirrorPrimary(state) {
  const slice = state.slices && state.slices.get(state.selectedRepo);
  if (!slice) return;
  if (slice.repoConfig) state.repoConfig = slice.repoConfig;
  if (slice.refs) state.refs = slice.refs;
  state.remotes = slice.remotes || [];
  state.stashes = slice.stashes;
  state.uncommitted = slice.uncommitted;
  state.headHash = slice.headHash;
  state.headBranchName = slice.headBranchName;
  state.rawCommits = slice.rawCommits;
}

// --- Pure helpers (unit-tested directly; no DOM) ---

/** Case-sensitive/-insensitive substring match across message/date/author/hash/branch/tag. */
function gitGraphFindMatches(rows, query, caseSensitive) {
  if (!query) return [];
  const q = caseSensitive ? query : query.toLowerCase();
  const norm = (v) => (caseSensitive ? String(v || '') : String(v || '').toLowerCase());
  const matches = [];
  const refName = (typeof gitGraphRefName === 'function') ? gitGraphRefName : (entry => (typeof entry === 'string' ? entry : entry && entry.name));
  rows.forEach((row, index) => {
    const refNames = [
      ...(row.refs?.heads || []).map(refName),
      ...(row.refs?.remotes || []).map(r => r.name),
      ...(row.refs?.tags || []).map(refName),
    ];
    // A History of several repositories: the repository's name and the hash git knows count too.
    const repoName = row.repoPath ? (typeof pathBasename === 'function' ? pathBasename(row.repoPath) : row.repoPath) : '';
    const haystacks = [row.subject, row.authorDate, row.commitDate, row.authorName, row.hash, row.sha, repoName, ...refNames];
    if (haystacks.some(h => norm(h).includes(q))) matches.push(index);
  });
  return matches;
}

/**
 * Escape → dialog, then context menu, then Commit Details/Comparison view, in
 * that priority order. `hooks` are the closers for whichever
 * of those is actually open; each returns true if it closed something.
 */
function gitGraphHandleEscapePriority(hooks) {
  if (hooks.closeDialog && hooks.closeDialog()) return 'dialog';
  if (hooks.closeMenu && hooks.closeMenu()) return 'menu';
  if (hooks.closeDetails && hooks.closeDetails()) return 'details';
  if (hooks.closeFind && hooks.closeFind()) return 'find';
  return null;
}

function gitGraphIsEditableTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

/** Reads the frozen data-gg-* contract off the closest carrying element. */
function gitGraphReadTargetData(target) {
  const el = target && typeof target.closest === 'function' ? target.closest('[data-gg-kind]') : null;
  if (!el) return null;
  const ds = el.dataset || {};
  return {
    el,
    kind: ds.ggKind || null,
    hash: ds.ggHash || null,
    refName: ds.ggRefName || null,
    remote: ds.ggRemote || null,
    refType: ds.ggRefType || null,
    filePath: ds.ggFilePath || null,
  };
}

/** kind -> which of git-graph-menus.js's real gitGraphBuild*Menu functions to call. */
const GG_MENU_BUILDERS = {
  commit: 'gitGraphBuildCommitMenu',
  uncommitted: 'gitGraphBuildUncommittedMenu',
  branch: 'gitGraphBuildLocalBranchMenu',
  'remote-branch': 'gitGraphBuildRemoteBranchMenu',
  tag: 'gitGraphBuildTagMenu',
  stash: 'gitGraphBuildStashMenu',
  file: 'gitGraphBuildFileMenu',
  'column-header': 'gitGraphBuildColumnHeaderMenu',
  link: 'gitGraphBuildLinkMenu',
};

/**
 * Own fallback dispatch, used only when git-graph-menus.js's real
 * `gitGraphShowContextMenu(el, ctx, position)` (which does the same
 * data-gg-* routing plus the combined-pill dual-hit-region case) has not
 * been loaded — keeps this tab's own logic working (and its own tests
 * self-sufficient) even without that file present.
 */
function gitGraphDispatchContextMenu(el, ctx, position, target) {
  const data = target || gitGraphReadTargetData(el);
  if (!data) return false;
  const builderName = data.kind === 'branch' && data.refType === 'remote' ? GG_MENU_BUILDERS['remote-branch'] : GG_MENU_BUILDERS[data.kind];
  const builder = builderName ? globalThis[builderName] : null;
  if (typeof builder !== 'function' || typeof showContextMenu !== 'function') return false;
  showContextMenu(builder(ctx), position);
  return true;
}

/** Every branch the dropdown lists for a repository: `state` is the state, or a slice. */
function gitGraphAllBranchKeys(state) {
  const heads = ((state.refs && state.refs.heads) || []).map(h => h.name);
  const visibleRemotes = gitGraphVisibleRemotes((state.refs && state.refs.remotes) || [], state.repoConfig && state.repoConfig.perRemoteVisibility);
  const remotes = visibleRemotes.map(r => `${r.remote}/${r.name}`);
  return [...heads, ...remotes];
}

/** `path`: the repository the branch is of, when several are shown (its slice holds the selection). */
function gitGraphToggleBranchKey(project, state, body, key, select, path) {
  const slice = path && gitGraphIsMulti(state) ? state.slices.get(path) : null;
  const view = slice || state;
  const current = view.branchSelection === 'all' ? new Set(gitGraphAllBranchKeys(view)) : new Set(view.branchSelection);
  if (select) current.add(key); else current.delete(key);
  if (slice) {
    gitGraphCommitSelections(project, state, body, 'branches', [{ path, next: [...current] }]);
    return;
  }
  state.branchSelection = [...current];
  gitGraphSaveUiPrefs(project.id, state);
  gitGraphPatchRepoConfig(project, state, { branchDropdownSelection: state.branchSelection });
  gitGraphLoadGraph(project, state, body, { reset: true });
}

/**
 * New branch or tag selections for repositories of a History of several: each
 * lands on its slice (and on the state's own fields for the primary), is
 * remembered, and the repositories that changed are read again.
 * tab: 'branches' | 'tags'; changes: [{ path, next }].
 */
function gitGraphCommitSelections(project, state, body, tab, changes) {
  const field = tab === 'tags' ? 'tagSelection' : 'branchSelection';
  for (const { path, next } of changes) {
    const slice = state.slices.get(path);
    if (slice) slice[field] = next;
    if (path === state.selectedRepo) state[field] = next;
    if (field === 'branchSelection') gitGraphPatchRepoConfigFor(project, state, path, { branchDropdownSelection: next });
  }
  gitGraphSaveUiPrefs(project.id, state);
  if (changes.length === 1) return gitGraphReloadSlice(project, state, body, changes[0].path, {});
  return gitGraphLoadGraph(project, state, body, { reset: true });
}

function gitGraphDefaultRemoteName(remotes) {
  if (!remotes || !remotes.length) return null;
  return (remotes.find(r => r.name === 'origin') || remotes[0]).name;
}

function gitGraphRemoteBranchesByLocalName(refs) {
  const map = {};
  for (const remote of (refs && refs.remotes) || []) {
    if (!map[remote.name]) map[remote.name] = [];
    map[remote.name].push(remote);
  }
  return map;
}

/** Builds the file-menu target object git-graph-menus.js's gitGraphBuildFileMenu expects. */
function gitGraphBuildFileCtx(state, filePath) {
  const data = state.detailsData || {};
  const file = (data.files || []).find(f => f.path === filePath) || { path: filePath, status: 'modified' };
  const repo = gitGraphDetailsRepo(state);
  const isUncommittedSide = (data.mode === 'single' && data.kind === 'uncommitted') || (data.mode === 'compare' && gitGraphPlainHash(data.toHash) === '#uncommitted');
  const isSingleHistorical = data.mode === 'single' && data.kind !== 'uncommitted';
  return {
    path: file.path,
    relativePath: file.path,
    absolutePath: repo ? `${repo.path}/${file.path}` : file.path,
    status: file.status,
    existsOnDisk: file.status !== 'deleted',
    isWorkingTreeSide: isUncommittedSide,
    isHistoricalSingleCommit: isSingleHistorical,
    revisionHash: isSingleHistorical ? gitGraphPlainHash(data.hash) : null,
    revisionShortHash: isSingleHistorical ? (data.commit && data.commit.shortHash) : null,
  };
}

/**
 * Fills in the one target-specific field (commit/localBranch/remoteBranch/tag/stash/file/columnHeader/link) git-graph-menus.js's ctx contract expects, from the frozen data-gg-* attributes.
 * The menus and git speak plain hashes: with several repositories shown the
 * rows' keys are turned back into them, and `view` is the repository's data
 * (its slice) the refs and stashes are read from.
 */
function gitGraphPopulateTargetField(ctx, state, target, view = state) {
  if (!target) return;
  const plain = gitGraphPlainHash;
  if (target.kind === 'commit' || target.kind === 'uncommitted') {
    const row = state.rows.find(r => r.hash === target.hash);
    if (row) {
      const children = ((state.childrenByHash && state.childrenByHash.get(row.hash)) || []).map(c => ({ hash: plain(c.hash), parents: (c.parents || []).map(plain) }));
      ctx.commit = { hash: plain(row.hash), shortHash: row.shortHash, subject: row.subject, parents: (row.parents || []).map(plain), children };
    }
  } else if (target.kind === 'branch' && target.refType !== 'remote') {
    ctx.localBranch = { name: target.refName, hash: plain(target.hash) };
  } else if (target.kind === 'remote-branch' || (target.kind === 'branch' && target.refType === 'remote')) {
    ctx.remoteBranch = { remote: target.remote, name: target.refName, hash: plain(target.hash) };
  } else if (target.kind === 'tag') {
    const known = ((view.refs && view.refs.tags) || []).find(t => t.name === target.refName);
    ctx.tag = { name: target.refName, hash: plain(target.hash), annotated: !!(known && known.annotated) };
  } else if (target.kind === 'stash') {
    const stash = (view.stashes || []).find(s => s.hash === plain(target.hash));
    ctx.stash = stash ? { hash: stash.hash, index: stash.index, branch: stash.branch, message: stash.message } : { hash: plain(target.hash) };
  } else if (target.kind === 'file') {
    ctx.file = gitGraphBuildFileCtx(state, target.filePath);
  } else if (target.kind === 'column-header') {
    ctx.columnHeader = { columnVisibility: state.columns, commitsOrder: state.order };
  } else if (target.kind === 'link') {
    ctx.link = { url: (target.el && (target.el.getAttribute('href') || target.el.href)) || '' };
  }
}

/** Assembles the full ctx object git-graph-menus.js's gitGraphBuild*Menu functions read (see that file's own header comment for the contract). */
function gitGraphBuildMenuCtx(project, state, body, repo, target) {
  // With several repositories shown, everything about the repository (refs,
  // remotes, config, HEAD) is its slice's, and the menus get plain hashes.
  const view = gitGraphViewByPath(state, repo.path);
  const multi = view !== state;
  const tag = multi ? gitGraphRepoTag(state, repo.path) : null;
  const keyOf = (hash) => (tag ? gitGraphRepoKey(tag, hash) : hash);
  // Compare with the open or ticked commit: only one of this repository.
  let compareBase = gitGraphCompareBase(state);
  if (compareBase) {
    const split = gitGraphSplitKey(compareBase.hash);
    compareBase = (split.tag || null) === (tag || null) ? { ...compareBase, hash: split.sha } : null;
  }
  const ctx = {
    projectId: project.id,
    folderPath: repo.path,
    refresh: multi
      ? () => gitGraphReloadSlice(project, state, body, repo.path, { keepScroll: true })
      : () => gitGraphLoadGraph(project, state, body, { reset: true }),
    onActionError: (message) => { state.error = message; gitGraphPaint(project, state, body); },
    head: { hash: view.headHash || null, branch: view.headBranchName || null },
    remotes: view.remotes || [],
    localBranches: ((view.refs && view.refs.heads) || []).map(h => ({ name: h.name, hash: h.hash })),
    selectedBranchKeys: view.branchSelection,
    onSelectBranch: (key) => gitGraphToggleBranchKey(project, state, body, key, true, multi ? repo.path : null),
    onUnselectBranch: (key) => gitGraphToggleBranchKey(project, state, body, key, false, multi ? repo.path : null),
    issueLinking: (view.repoConfig && view.repoConfig.issueLinking) || null,
    pullRequestProvider: (view.repoConfig && view.repoConfig.pullRequestProvider) || null,
    defaultBranch: view.headBranchName || 'main',
    defaultRemoteName: gitGraphDefaultRemoteName(view.remotes),
    dialogDefaults: (state.globalPrefs && state.globalPrefs.dialogDefaults) || {},
    contextMenuActionsVisibility: (state.globalPrefs && state.globalPrefs.contextMenuActionsVisibility) || {},
    remoteBranchesByLocalName: gitGraphRemoteBranchesByLocalName(view.refs),
    tags: ((view.refs && view.refs.tags) || []).map(t => (typeof t === 'string' ? t : t && t.name)).filter(Boolean),
    onColumnVisibilityChange: (col, visible) => {
      state.columns[col] = visible;
      gitGraphPatchGlobalPrefs(state, { columnVisibility: { ...state.columns } });
      gitGraphPaint(project, state, body);
    },
    onCommitsOrderChange: (order) => {
      state.order = order;
      gitGraphPatchRepoConfig(project, state, { commitsOrder: order });
      gitGraphLoadGraph(project, state, body, { reset: true });
    },
    onOpenSourceControlView: () => { if (typeof setProjectGitView === 'function') setProjectGitView(project, 'changes'); if (typeof setProjectTab === 'function') setProjectTab(project, 'git'); if (typeof renderOverview === 'function') renderOverview(); },
    hasUntrackedFiles: !!(view.uncommitted && (view.uncommitted.changes || []).some(f => f.status === 'untracked')),
    codeReview: state.codeReview ? { key: state.codeReview.key, reviewedPaths: state.codeReview.reviewedPaths } : null,
    compareBase,
    isChecked: (hash) => state.checkedHashes.has(keyOf(hash)),
    // Ticking from the menu turns the selection on, so the tick is in sight.
    onSelectForCompare: (hash) => {
      if (!state.selecting) gitGraphSetSelecting(project, state, body, true);
      gitGraphToggleChecked(project, state, body, keyOf(hash));
    },
    onCompare: (hash) => gitGraphCompareWithSelected(project, state, body, keyOf(hash)),
    onMarkFileReviewed: (path, reviewed) => gitGraphSetFileReviewed(project, state, body, path, reviewed),
    onViewDiff: (file) => gitGraphOpenFileDiff(project, state, body, repo, file.path),
    onViewFileAtRevision: (file) => gitGraphViewFileAtRevision(project, state, body, repo, file),
    onViewDiffWithWorkingFile: (file) => gitGraphOpenFileDiff(project, state, body, repo, file.path, { forceWorkingTree: true }),
    // 'openPath' is the reveal-in-file-manager channel and only accepts a
    // directory; opening a file with its OS-default application goes through
    // 'openFileExternally' instead, the same channel every other "open this
    // file externally" call in the app uses.
    onOpenFile: (file) => { gitGraphMarkFileReviewedIfActive(project, state, body, file.path); return gitGraphApi('openFileExternally', file.absolutePath || file.path, repo.path); },
  };
  gitGraphPopulateTargetField(ctx, state, target, view);
  return ctx;
}

/** The repository a right-click is about: the row's for what sits on a row, the open record's for its files and links, the primary's otherwise (the header). */
function gitGraphTargetRepo(state, target) {
  if (target.kind === 'file' || target.kind === 'link') return gitGraphDetailsRepo(state);
  const onRow = ['commit', 'uncommitted', 'branch', 'remote-branch', 'tag', 'stash'].includes(target.kind);
  return onRow && target.hash ? gitGraphRowRepo(state, target.hash) : gitGraphPrimaryRepo(state);
}

/** One call site for every right-click: prefers git-graph-menus.js's real dispatcher, falls back to this file's own when it is not loaded (pre-integration/tests). */
function gitGraphOpenContextMenu(project, state, body, el, position) {
  const attrReader = typeof gitGraphReadTargetAttrs === 'function' ? gitGraphReadTargetAttrs : null;
  const target = attrReader ? { ...attrReader(el), el } : gitGraphReadTargetData(el);
  if (!target || !target.kind) return;
  const repo = gitGraphTargetRepo(state, target);
  if (!repo) return;
  const ctx = gitGraphBuildMenuCtx(project, state, body, repo, target);
  if (typeof gitGraphShowContextMenu === 'function') gitGraphShowContextMenu(el, ctx, position);
  else gitGraphDispatchContextMenu(el, ctx, position, target);
}

/**
 * Double-click checks out. A commit goes through the same in-app "Checkout
 * Commit…" dialog (and its detached-HEAD warning + session "Always Accept")
 * the commit context menu's Checkout… item uses — never an unconfirmed,
 * fire-and-forget action; a branch is a normal, reversible switch, so it
 * runs immediately the same way the branch menu's Checkout Branch item does.
 */
function gitGraphHandleDoubleClick(project, state, body, target, ctx) {
  const data = gitGraphReadTargetData(target);
  if (!data) return null;
  // A row of a History of several repositories acts on its own repository,
  // with the plain hash git knows (the key's tag says which it is).
  const multiRow = !!gitGraphSplitKey(data.hash).tag;
  const rowRepo = multiRow ? gitGraphRowRepo(state, data.hash) : null;
  const repoPath = rowRepo ? rowRepo.path : ctx.repoPath;
  const refresh = rowRepo
    ? () => gitGraphReloadSlice(project, state, body, repoPath, { keepScroll: true })
    : () => gitGraphLoadGraph(project, state, body, { reset: true });
  const onActionError = (message) => { state.error = message; gitGraphPaint(project, state, body); };
  const plainHash = gitGraphPlainHash(data.hash);
  const localBranchNames = rowRepo
    ? new Set((((gitGraphRowView(state, data.hash).refs) || {}).heads || []).map(h => h.name))
    : ctx.localBranchNames;
  if (data.kind === 'commit' && data.hash) {
    if (typeof gitGraphShowCheckoutCommitDialog === 'function') {
      const row = state.rows.find(r => r.hash === data.hash);
      gitGraphShowCheckoutCommitDialog({ projectId: ctx.projectId, folderPath: repoPath, refresh, commitHash: plainHash, commitShortHash: row && row.shortHash });
    }
    return 'checkoutCommit';
  }
  if (data.kind === 'branch' && data.refName) {
    if (typeof gitGraphRunImmediateAction === 'function') gitGraphRunImmediateAction({ projectId: ctx.projectId, folderPath: repoPath, refresh, onActionError }, 'checkoutBranchImmediate', { name: data.refName });
    return 'checkoutBranchImmediate';
  }
  // Either half of a combined local+remote pill checks out the local branch
  // (the remote half carries data-gg-kind="remote-branch"); a standalone
  // remote pill with no matching local branch has nothing to check out.
  if (data.kind === 'remote-branch' && data.refName && localBranchNames && localBranchNames.has(data.refName)) {
    if (typeof gitGraphRunImmediateAction === 'function') gitGraphRunImmediateAction({ projectId: ctx.projectId, folderPath: repoPath, refresh, onActionError }, 'checkoutBranchImmediate', { name: data.refName });
    return 'checkoutBranchImmediate';
  }
  return null;
}

// --- Layout / row assembly ---

function gitGraphMergedRows(state) {
  return gitGraphBuildLayoutInput(state.rawCommits || [], state.stashes || [], state.uncommitted, state.headHash);
}

/** The rows of the repositories shown, merged into one list (gitGraphMergeSlices), in the order of the tabs. */
function gitGraphMultiRows(state) {
  const slices = gitGraphShownRepos(state).map(repo => state.slices.get(repo.path)).filter(Boolean);
  for (const slice of slices) slice.tag = gitGraphRepoTag(state, slice.path);
  return { slices, merged: gitGraphMergeSlices(slices, state.order) };
}

function gitGraphRecomputeLayout(state) {
  if (gitGraphIsMulti(state) && state.slices && state.slices.size) {
    // Each repository's lanes side by side: the layout reads only hashes and parents, which are keys here.
    const { slices, merged } = gitGraphMultiRows(state);
    state.rows = merged.rows;
    state.multiHeld = merged.held;
    state.multiLists = merged.lists;
    state.hasMore = merged.hasMore;
    state.childrenByHash = gitGraphComputeChildren(slices.flatMap(slice => gitGraphNamespaceRows(slice.rawCommits, slice.tag, slice.path)));
  } else {
    state.rows = gitGraphMergedRows(state);
  }
  const layoutFn = gitGraphResolveLayoutFn();
  state.layout = layoutFn(state.rows, state.order, { firstParentOnly: state.firstParentOnly });
}

/** hash -> [{hash, parents}] for every commit that names it as a parent (git-graph-menus.js's Drop… visibility rule needs this; git log alone only gives parents, never children). */
function gitGraphComputeChildren(rawCommits) {
  const map = new Map();
  for (const commit of rawCommits || []) {
    for (const parentHash of commit.parents || []) {
      if (!map.has(parentHash)) map.set(parentHash, []);
      map.get(parentHash).push({ hash: commit.hash, parents: commit.parents || [] });
    }
  }
  return map;
}

// --- Data loading ---

function gitGraphRepoList(project) {
  const seen = new Set();
  const list = [];
  for (const path of [project.root, ...((project.folders || []).map(f => f.path))]) {
    if (path && !seen.has(path)) { seen.add(path); list.push({ path }); }
  }
  return list;
}

function gitGraphLoadRepositories(project, state) {
  return gitGraphApi('getProjectGitInfo', project.id).then((result) => {
    const list = (result && result.ok && result.repositories) ? result.repositories : gitGraphRepoList(project);
    state.repositories = list.filter(r => r.git !== false);
    if (!state.repositories.length) state.repositories = list;
    return state.repositories;
  });
}

function gitGraphLoadGraph(project, state, body, opts = {}) {
  const repo = (state.repositories || []).find(r => r.path === state.selectedRepo) || (state.repositories || [])[0];
  if (!repo) return Promise.resolve();
  state.selectedRepo = repo.path;
  if (gitGraphIsMulti(state)) return gitGraphLoadMultiGraph(project, state, body, opts);
  if (state.slices && state.slices.size) state.slices.clear();
  const reset = opts.reset !== false;
  if (reset) state.loadedKey = gitGraphSelectionKey(state);
  // A quiet reload (the working tree changed under an open graph) keeps the
  // rows on screen until the new ones arrive and reloads as many as were
  // loaded, so the table neither blanks nor jumps.
  const quiet = reset && !!opts.keepScroll && (state.rawCommits || []).length > 0;
  if (reset && !quiet) { state.skip = 0; state.rawCommits = []; }
  const limit = quiet
    ? Math.min(5000, Math.max(state.initialLoad || GG_INITIAL_LOAD, state.rawCommits.length))
    : (reset ? (state.initialLoad || GG_INITIAL_LOAD) : (state.loadMore || GG_LOAD_MORE));
  const request = ++state.request;
  if (!quiet) {
    if (reset) { state.loading = true; state.error = ''; } else { state.loadingMore = true; }
    // This interim repaint (setting the loading-more flag before the fetch
    // even resolves) must preserve scroll too — Load More is triggered by
    // scrolling near the bottom, so a bare gitGraphPaint() here would already
    // reset the table to the top before any new rows arrive.
    gitGraphPaint(project, state, body, { preserveScroll: !reset });
  }

  return gitGraphApi('getProjectGitGraph', project.id, repo.path, {
    branches: state.branchSelection,
    tags: state.tagSelection,
    order: state.order,
    limit,
    skip: quiet ? 0 : state.skip,
    firstParentOnly: state.firstParentOnly,
    includeReflogCommits: state.includeReflogCommits,
    showRemote: state.showRemoteBranches,
    showTags: state.showTags,
    showStashes: state.showStashesPref,
    refsUnchanged: !reset,
  }).then((result) => {
    if (request !== state.request) return;
    state.loading = false;
    state.loadingMore = false;
    if (!result || !result.ok) {
      state.error = (result && result.error) || 'Could not load the commit graph.';
      gitGraphPaint(project, state, body);
      return;
    }
    const incoming = result.commits || [];
    state.rawCommits = reset ? incoming : [...(state.rawCommits || []), ...incoming];
    if (result.refs) state.refs = result.refs;
    state.stashes = result.stashes || [];
    state.uncommitted = state.showUncommittedChangesPref !== false ? (result.uncommitted || null) : null;
    state.headHash = (state.rawCommits.find(c => c.isHead) || {}).hash || state.headHash;
    state.headBranchName = ((state.refs && state.refs.heads || []).find(h => h.isHead) || {}).name || null;
    state.childrenByHash = gitGraphComputeChildren(state.rawCommits);
    state.hasMore = !!result.hasMore;
    state.skip = state.rawCommits.length;
    gitGraphRecomputeLayout(state);
    // Load More only appends rows and must never disturb the table's scroll
    // position; a fresh load (repo/filter change) naturally lands at the top
    // of a different row set, so only the former asks gitGraphPaint to
    // preserve it. The one-off preference/remotes reloads below repaint again
    // afterwards, which is always a `reset` repaint and so never needs it.
    gitGraphPaint(project, state, body, { preserveScroll: !reset || quiet });
    if (state.pendingFocusHash) gitGraphFocusPending(project, state, body);
    // Remotes, repository settings and preferences don't change with the
    // working tree; a quiet reload leaves them (and their repaints) alone.
    if (reset && !quiet) {
      gitGraphApi('getGitGraphRemotes', project.id, repo.path).then((r) => {
        state.remotes = (r && r.ok && r.remotes) || [];
        if (body.isConnected && gitGraphStillActive(project)) gitGraphPaint(project, state, body);
      });
      gitGraphApi('getGitGraphRepoConfig', project.id, repo.path).then((r) => {
        if (!(r && r.ok)) return;
        gitGraphApplyRepoConfigToState(state, r.config);
        gitGraphMaybePromptTrust(project, state, body, repo);
      });
      gitGraphApi('getGitGraphGlobalPreferences').then((r) => {
        if (r && r.ok) gitGraphApplyGlobalPrefsToState(state, r.preferences);
      });
    }
  }).catch((err) => {
    if (request !== state.request) return;
    state.loading = false;
    state.loadingMore = false;
    state.error = err?.message || 'Could not load the commit graph.';
    gitGraphPaint(project, state, body);
  });
}

/**
 * A commit asked for from elsewhere (a file's Timeline on the Files tab):
 * select it and open its details once its row is loaded, loading a few more
 * pages if it is further down. Not shown by the current filters: left alone.
 */
function gitGraphFocusPending(project, state, body) {
  const hash = state.pendingFocusHash;
  if (!hash) return;
  // Asked for by its plain hash and the repository's path: with several
  // repositories shown the row is "<tag>:<hash>".
  const tag = state.pendingFocusRepo && gitGraphIsMulti(state) ? gitGraphRepoTag(state, state.pendingFocusRepo) : null;
  const key = tag ? gitGraphRepoKey(tag, hash) : hash;
  const row = (state.rows || []).find(r => r.hash === key);
  if (row) {
    state.pendingFocusHash = null;
    state.focusTries = 0;
    state.selectedHash = row.hash;
    gitGraphOpenDetails(project, state, body, row);
    return;
  }
  if (state.hasMore && !state.loadingMore && (state.focusTries = (state.focusTries || 0) + 1) <= 5) {
    gitGraphLoadGraph(project, state, body, { reset: false });
    return;
  }
  state.pendingFocusHash = null;
  state.focusTries = 0;
}

// --- Loading several repositories at once ---

/** What the shown repositories are asked for besides what they all share (order, first parent, Show Remote). */
function gitGraphSliceQuery(state, slice, { skip, limit, refsUnchanged }) {
  return {
    branches: slice.branchSelection,
    tags: slice.tagSelection,
    order: state.order,
    limit,
    skip,
    firstParentOnly: state.firstParentOnly,
    includeReflogCommits: slice.includeReflogCommits,
    showRemote: state.showRemoteBranches,
    showTags: slice.showTags,
    showStashes: slice.showStashesPref,
    refsUnchanged,
  };
}

/** One repository's commits, asked for; the answer says which request it is, so a stale one is told apart. */
function gitGraphFetchSlice(project, state, slice, params) {
  const request = ++slice.request;
  return gitGraphApi('getProjectGitGraph', project.id, slice.path, gitGraphSliceQuery(state, slice, params))
    .then(result => ({ slice, request, result }), err => ({ slice, request, result: { error: (err && err.message) || '' } }));
}

/** An answer onto its slice. False when a newer request of that repository has been made since (this one is stale). */
function gitGraphApplySliceResult(slice, request, result, reset) {
  if (request !== slice.request) return false;
  if (!result || !result.ok) {
    slice.error = (result && result.error) || 'Could not load the commit graph.';
    return true;
  }
  slice.error = '';
  const incoming = result.commits || [];
  slice.rawCommits = reset ? incoming : [...(slice.rawCommits || []), ...incoming];
  if (result.refs) slice.refs = result.refs;
  slice.stashes = result.stashes || [];
  slice.uncommitted = slice.showUncommittedChangesPref !== false ? (result.uncommitted || null) : null;
  slice.headHash = (slice.rawCommits.find(c => c.isHead) || {}).hash || slice.headHash;
  slice.headBranchName = ((slice.refs && slice.refs.heads || []).find(h => h.isHead) || {}).name || null;
  slice.hasMore = !!result.hasMore;
  return true;
}

/** Commits asked for each repository the first time: enough that together they fill the table, at least 100 each. */
function gitGraphPerRepoLimit(state, count) {
  return Math.max(100, Math.ceil((state.initialLoad || GG_INITIAL_LOAD) / Math.max(1, count)));
}

/**
 * The repository's own config, read once when it joins the History (a
 * repository's saved branches, what it shows). The primary's is the state's:
 * it is read only when the state has none yet.
 */
function gitGraphReadSliceConfig(project, state, body, slice) {
  const primary = slice.path === state.selectedRepo;
  return gitGraphApi('getGitGraphRepoConfig', project.id, slice.path).then((r) => {
    slice.configLoaded = true;
    if (!(r && r.ok)) return;
    if (primary) {
      gitGraphApplyRepoConfigToState(state, r.config);
      gitGraphApplyRepoConfigToSlice(slice, r.config);
      const repo = gitGraphPrimaryRepo(state);
      if (repo) gitGraphMaybePromptTrust(project, state, body, repo);
    } else {
      gitGraphApplyRepoConfigToSlice(slice, r.config);
      gitGraphApplyOnLoadSelection(slice, r.config, null);
    }
  }, () => { slice.configLoaded = true; });
}

/** What every load of a History of several ends with: the merge, the layout, the paint. */
function gitGraphFinishMulti(project, state, body, opts = {}) {
  const slices = [...state.slices.values()];
  const failed = slices.filter(slice => slice.error);
  state.loading = false;
  state.loadingMore = false;
  if (slices.length && failed.length === slices.length) {
    state.error = failed.map(slice => `${pathBasename(slice.path) || slice.path}: ${slice.error}`).join('; ');
    gitGraphPaint(project, state, body);
    return;
  }
  gitGraphRecomputeLayout(state);
  gitGraphMirrorPrimary(state);
  gitGraphPaint(project, state, body, { preserveScroll: !!opts.preserveScroll });
  if (state.pendingFocusHash) gitGraphFocusPending(project, state, body);
}

function gitGraphLoadMultiGraph(project, state, body, opts = {}) {
  const repos = gitGraphShownRepos(state);
  const reset = opts.reset !== false;
  // A quiet reload (a working tree changed under an open History) keeps the
  // rows on screen until the new ones arrive and reloads as many as were loaded.
  const quiet = reset && !!opts.keepScroll && (state.rows || []).length > 0;
  if (!repos.some(r => r.path === state.selectedRepo)) {
    // The primary is not one that can be shown (not a Git repository): the first one takes over.
    state.selectedRepo = repos[0].path;
    gitGraphAdoptPrimary(state);
  }
  gitGraphSyncSlices(state, repos);
  const slices = repos.map(r => state.slices.get(r.path));
  const request = ++state.request;
  if (reset) state.loadedKey = gitGraphSelectionKey(state);

  if (!reset) return gitGraphLoadMoreMulti(project, state, body, slices, request);

  if (!quiet) {
    for (const slice of slices) { slice.rawCommits = []; slice.error = ''; }
    state.loading = true;
    state.error = '';
    gitGraphPaint(project, state, body);
  }
  const perRepo = gitGraphPerRepoLimit(state, slices.length);
  return Promise.all(slices.filter(slice => !slice.configLoaded).map(slice => gitGraphReadSliceConfig(project, state, body, slice)))
    .then(() => {
      if (request !== state.request) return null;
      if (state.selectedRepo && state.slices.has(state.selectedRepo)) gitGraphCopySettings(state, state.slices.get(state.selectedRepo));
      return Promise.all(slices.map(slice => gitGraphFetchSlice(project, state, slice, {
        skip: 0,
        limit: quiet ? Math.min(5000, Math.max(perRepo, slice.rawCommits.length)) : perRepo,
        refsUnchanged: false,
      })));
    })
    .then((answers) => {
      if (!answers || request !== state.request) return;
      for (const { slice, request: asked, result } of answers) gitGraphApplySliceResult(slice, asked, result, true);
      gitGraphFinishMulti(project, state, body, { preserveScroll: quiet });
      // Remotes and preferences don't change with the working tree.
      if (quiet) return;
      Promise.all(slices.map(slice => gitGraphApi('getGitGraphRemotes', project.id, slice.path).then((r) => { slice.remotes = (r && r.ok && r.remotes) || []; })))
        .then(() => {
          gitGraphMirrorPrimary(state);
          if (body.isConnected && gitGraphStillActive(project)) gitGraphPaint(project, state, body, { preserveScroll: true });
        });
      gitGraphApi('getGitGraphGlobalPreferences').then((r) => {
        if (r && r.ok) gitGraphApplyGlobalPrefsToState(state, r.preferences);
      });
    })
    .catch((err) => {
      if (request !== state.request) return;
      state.loading = false;
      state.loadingMore = false;
      state.error = (err && err.message) || 'Could not load the commit graph.';
      gitGraphPaint(project, state, body);
    });
}

/** Load More: only the repositories the merge needs more of (RepoSelection.repoPagePlan), each from the commits it holds. */
function gitGraphLoadMoreMulti(project, state, body, slices, request) {
  const want = state.loadMore || GG_LOAD_MORE;
  const plan = RepoSelection.repoPagePlan(state.multiLists || [], state.multiHeld || {}, want);
  const chosen = slices.filter(slice => plan.includes(slice.tag));
  if (!chosen.length) {
    state.hasMore = false;
    gitGraphPaint(project, state, body, { preserveScroll: true });
    return Promise.resolve();
  }
  state.loadingMore = true;
  gitGraphPaint(project, state, body, { preserveScroll: true });
  return Promise.all(chosen.map(slice => gitGraphFetchSlice(project, state, slice, { skip: slice.rawCommits.length, limit: want, refsUnchanged: true })))
    .then((answers) => {
      if (request !== state.request) return;
      for (const { slice, request: asked, result } of answers) gitGraphApplySliceResult(slice, asked, result, false);
      gitGraphFinishMulti(project, state, body, { preserveScroll: true });
    });
}

/**
 * One repository read again, the others left as they are: a working tree
 * that changed, a branch picked, an action that ran. keepScroll reloads as
 * many commits as were loaded and leaves the table where it was.
 */
function gitGraphReloadSlice(project, state, body, path, opts = {}) {
  const slice = state.slices && state.slices.get(path);
  if (!slice || !gitGraphIsMulti(state)) return gitGraphLoadGraph(project, state, body, { reset: true, keepScroll: !!opts.keepScroll });
  if (path === state.selectedRepo) gitGraphCopySettings(state, slice);
  const perRepo = gitGraphPerRepoLimit(state, gitGraphShownRepos(state).length);
  const limit = opts.keepScroll ? Math.min(5000, Math.max(perRepo, slice.rawCommits.length)) : perRepo;
  return gitGraphFetchSlice(project, state, slice, { skip: 0, limit, refsUnchanged: false }).then(({ request, result }) => {
    if (!gitGraphApplySliceResult(slice, request, result, true)) return;
    if (!body.isConnected || !gitGraphStillActive(project)) return;
    state.error = '';
    gitGraphFinishMulti(project, state, body, { preserveScroll: !!opts.keepScroll });
  });
}

function gitGraphStillActive(project) {
  return typeof selectedProject === 'function' && selectedProject()?.id === project.id &&
    typeof projectTab === 'function' && projectTab(project) === 'git' &&
    typeof projectGitView === 'function' && projectGitView(project) === 'history';
}

// --- Entry point ---

function renderProjectGitGraphTab(project, body) {
  const state = gitGraphState(project.id);
  const prefs = gitGraphLoadUiPrefs(project.id);
  Object.assign(state, {
    selectedRepo: state.selectedRepo || prefs.selectedRepo || null,
    selectedRepos: (state.selectedRepos && state.selectedRepos.length) ? state.selectedRepos : (Array.isArray(prefs.selectedRepos) ? prefs.selectedRepos : []),
    columns: prefs.columns || state.columns,
    columnWidths: prefs.columnWidths || state.columnWidths,
    branchSelection: prefs.branchSelection || state.branchSelection,
    tagSelection: prefs.tagSelection || state.tagSelection,
    refSort: prefs.refSort || state.refSort,
    showRemoteBranches: prefs.showRemoteBranches !== undefined ? prefs.showRemoteBranches : state.showRemoteBranches,
    order: prefs.order || state.order,
  });
  body.className = 'git-workspace-view gg-tab-body';
  gitGraphBindKeyboard(project, state, body);
  gitGraphEnsureWatcherBound();

  // project.folders can change while this tab isn't the one being painted
  // (e.g. Attach Folder… from the Settings tab) — state.repositories is
  // cached per project id across tab switches, so without this check a
  // newly-attached folder would never appear here until the app restarts.
  const freshPaths = gitGraphRepoList(project).map(r => r.path);
  const cachedPaths = (state.repositories || []).map(r => r.path);
  const repositoriesStale = !!state.repositories && !gitGraphSameStringSet(cachedPaths, freshPaths);

  if (state.repositories && !repositoriesStale) {
    // Another view handed over other repositories (Pull Requests, Worktrees):
    // what is loaded is of the ones it showed before.
    if (state.loadedKey && state.loadedKey !== gitGraphSelectionKey(state)) {
      gitGraphClearForSelection(state);
      gitGraphLoadGraph(project, state, body, { reset: true });
      return;
    }
    gitGraphPaint(project, state, body);
    return;
  }
  const firstLoad = !state.repositories;
  if (firstLoad) body.innerHTML = '<div class="gg-loading"><span class="gg-loading-dot"></span>Reading repository…</div>';
  gitGraphLoadRepositories(project, state).then(() => {
    if (!body.isConnected || !gitGraphStillActive(project)) return;
    if (!state.repositories.length) { gitGraphPaint(project, state, body); return; }
    if (!firstLoad) {
      // Only the repo list itself was stale — the currently selected repo's
      // own loaded graph is still valid, so just refresh the picker rather
      // than re-running the whole first-load sequence (preferences + graph)
      // and losing the user's place.
      state.repositories = gitGraphSortRepositories(state.repositories, state.repositoryDropdownOrder);
      // The rows' tags are positions among the tabs: with several repositories
      // shown, a changed list means loading again.
      if (gitGraphIsMulti(state) || (state.loadedKey && state.loadedKey.includes('\n'))) {
        gitGraphClearForSelection(state);
        gitGraphLoadGraph(project, state, body, { reset: true });
        return;
      }
      gitGraphPaint(project, state, body);
      return;
    }
    const repo = state.repositories.find(r => r.path === state.selectedRepo) || state.repositories[0];
    // Reading RepoConfig/GlobalPrefs before the very first commit query (rather
    // than only after it, as every later reload still does below) is what
    // makes a stored branch selection/order/mute-rule correct on the tab's
    // first paint instead of only after a second, corrective reload.
    gitGraphLoadInitialPreferences(project, state, repo).then(() => {
      if (!body.isConnected || !gitGraphStillActive(project)) return;
      state.repositories = gitGraphSortRepositories(state.repositories, state.repositoryDropdownOrder);
      gitGraphLoadGraph(project, state, body, { reset: true });
    });
  });
}

function gitGraphSameStringSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// --- Painting ---

function gitGraphPaint(project, state, body, opts = {}) {
  const prevWrap = opts.preserveScroll ? body.querySelector('.gg-table-wrap') : null;
  const prevScrollTop = prevWrap ? prevWrap.scrollTop : null;
  const prevInner = opts.preserveScroll ? gitGraphInlineScrolls(body, state) : null;

  const repos = state.repositories || [];
  if (!repos.length) {
    body.innerHTML = '<div class="gg-empty-state"><div class="gg-empty-title">No folders attached</div><div>Attach a repository to this project to see its history here.</div></div>';
    return;
  }
  const shown = gitGraphShownRepos(state);
  const multi = shown.length > 1;
  const repo = (multi ? shown.find(r => r.path === state.selectedRepo) : null) || repos.find(r => r.path === state.selectedRepo) || repos[0];
  state.selectedRepo = repo.path;
  const tabs = gitGraphHistoryTabsHtml(project, state, repo);

  if (!multi && repo.git === false) {
    body.innerHTML = `<div class="gg-tab-shell">${tabs}<div class="gg-empty-state"><div class="gg-empty-title">Not a Git repository</div><div>${escapeHtml(repo.path)}</div></div></div>`;
    gitGraphWireRepoPicker(project, state, body);
    return;
  }

  if (state.error) {
    const title = multi ? 'Git Graph could not load these repositories' : 'Git Graph could not load this repository';
    body.innerHTML = `<div class="gg-tab-shell">${tabs}<div class="gg-error-state"><div class="gg-empty-title">${title}</div><div>${escapeHtml(state.error)}</div><button type="button" class="ws-btn" id="gg-retry">Retry</button></div></div>`;
    body.querySelector('#gg-retry').onclick = () => gitGraphLoadGraph(project, state, body, { reset: true });
    gitGraphWireRepoPicker(project, state, body);
    return;
  }

  if (state.loading && !state.rows.length) {
    body.innerHTML = `<div class="gg-tab-shell">${tabs}<div class="gg-loading"><span class="gg-loading-dot"></span>Loading commits…</div></div>`;
    gitGraphWireRepoPicker(project, state, body);
    return;
  }

  gitGraphKeepFileView(body, state);
  const repoWidth = multi ? ` style="--gg-repo-col:${gitGraphRepoColumnWidth(state)}px"` : '';
  body.innerHTML = `
    <div class="gg-tab-shell gg-ref-align-${escapeHtml(state.referenceLabelAlignment || 'normal')}">
      ${tabs}
      ${gitGraphControlBarHtml(project, state)}
      ${multi ? gitGraphSliceErrorsHtml(state) : ''}
      ${gitGraphFindWidgetHtml(state)}
      <div class="gg-table-wrap${state.selecting ? '' : ' gg-no-select'}${multi ? ' gg-multi-repo' : ''}"${repoWidth}>
        ${gitGraphHeaderHtml(state)}
        <div class="gg-tbody" id="gg-tbody">${gitGraphRowsHtml(project, state)}</div>
        ${state.hasMore ? '<button type="button" class="gg-load-more" id="gg-load-more">Load More Commits</button>' : ''}
      </div>
      <div class="gg-details-docked" id="gg-details-docked" style="display:none"></div>
      <div class="gg-settings-drawer" id="gg-settings-drawer" style="display:none"></div>
    </div>`;

  gitGraphFitDetailsHeight(state, body.querySelector('.gg-table-wrap'));
  gitGraphWireRepoPicker(project, state, body);
  gitGraphWireSliceErrors(project, state, body);
  gitGraphWireControlBar(project, state, body);
  gitGraphWireFindWidget(project, state, body);
  gitGraphWireHeader(project, state, body);
  gitGraphWireRows(project, state, body);
  // Before the details: bringing a just-opened panel into view starts from here.
  if (prevScrollTop != null) {
    const newWrap = body.querySelector('.gg-table-wrap');
    if (newWrap) newWrap.scrollTop = prevScrollTop;
  }
  gitGraphRestoreInlineScrolls(body, state, prevInner);
  if (state.detailsData && state.detailsLocation === 'docked') {
    gitGraphRenderDetailsPanel(project, state, body);
  } else if (state.detailsData) {
    // Inline mode's markup already came back inside #gg-tbody's own innerHTML
    // (gitGraphRowsHtml/gitGraphInlineDetailsHtml), so only the event wiring
    // — not a second render — is needed here.
    const inline = body.querySelector('#gg-details-inline');
    if (inline) { gitGraphWireDetailsPanel(project, state, body, inline); gitGraphMaybeAutoCenterDetails(state, inline); }
  }
  // A viewer kept for a panel that is no longer drawn is let go.
  state.keptFileView = null;
  if (state.settingsOpen) gitGraphRenderSettingsDrawer(project, state, body);
  if (state.progress) gitGraphRenderProgress(project, state, body);
}

// The inline panel is at most three quarters of the table's height, and its text
// and its files scroll inside it (git-graph.css). Painting the table again
// (a folder folded, Tree/List) keeps them where they were, for the same record.
const GG_INLINE_SCROLLERS = ['.gg-details-text', '.gg-file-tree', '.gg-file-flat-list'];

/** The inline panel's ceiling: three quarters of what the table shows, so the
 * commits above and below it stay in sight (the window would be too much: the
 * toolbar and the tabs take part of it). Follows the window as it is resized. */
function gitGraphFitDetailsHeight(state, wrap) {
  if (state.detailsResizeObserver) { state.detailsResizeObserver.disconnect(); state.detailsResizeObserver = null; }
  if (!wrap || !wrap.style || typeof wrap.style.setProperty !== 'function') return;
  const fit = () => { if (wrap.clientHeight) wrap.style.setProperty('--gg-details-max', `${Math.round(wrap.clientHeight * 0.75)}px`); };
  fit();
  if (typeof ResizeObserver === 'function') {
    state.detailsResizeObserver = new ResizeObserver(fit);
    state.detailsResizeObserver.observe(wrap);
  }
}

function gitGraphDetailsKey(state) {
  const data = state.detailsData;
  return data ? `${data.mode}:${data.hash || ''}:${data.fromHash || ''}:${data.toHash || ''}` : null;
}

function gitGraphInlineScrolls(body, state) {
  const panel = body.querySelector('#gg-details-inline');
  if (!panel || typeof panel.querySelector !== 'function') return null;
  const scrolls = {};
  for (const selector of GG_INLINE_SCROLLERS) {
    const el = panel.querySelector(selector);
    if (el && el.scrollTop) scrolls[selector] = el.scrollTop;
  }
  return { key: gitGraphDetailsKey(state), scrolls };
}

function gitGraphRestoreInlineScrolls(body, state, saved) {
  if (!saved || saved.key !== gitGraphDetailsKey(state)) return;
  const panel = body.querySelector('#gg-details-inline');
  if (!panel || typeof panel.querySelector !== 'function') return;
  for (const [selector, top] of Object.entries(saved.scrolls)) {
    const el = panel.querySelector(selector);
    if (el) el.scrollTop = top;
  }
}

/**
 * The Repository column's width: the one the user dragged it to, else enough
 * for the longest name shown (names of one project often share a prefix, so
 * cutting them early would make them look alike), within reason.
 */
function gitGraphRepoColumnWidth(state) {
  const dragged = state.columnWidths && Number(state.columnWidths.repo);
  if (dragged) return dragged;
  const names = gitGraphShownRepos(state).map((repo) => pathBasename(repo.path) || repo.path);
  const longest = names.reduce((max, name) => Math.max(max, String(name).length), 0);
  return Math.max(90, Math.min(220, Math.round(longest * 6.6) + 22));
}

/** The repository tabs of a view that shows one repository at a time (Actions): git-repo-tabs.js without checkboxes. */
function gitGraphRepoPickerHtml(repos, active) {
  if (typeof gitRepoTabsHtml !== 'function') return '';
  return gitRepoTabsHtml(repos, { primary: active && active.path, paths: active ? [active.path] : [] }, { multi: false });
}

/** The History's repository tabs: a name shows that repository alone, the checkbox on hover adds or takes away one (git-repo-tabs.js). */
function gitGraphHistoryTabsHtml(project, state, repo) {
  const repos = state.repositories || [];
  if (typeof gitRepoTabsHtml !== 'function') return gitGraphRepoPickerHtml(repos, repo);
  const colors = typeof gitRepoColors === 'function' ? gitRepoColors(project, repos) : {};
  return gitRepoTabsHtml(repos, gitGraphSelection(state), { multi: true, colors });
}

/**
 * What a change of the repositories shown does: the open record, the ticks,
 * the search and (when it turns the table into or out of a merged one) the
 * rows belong to the old selection. The old primary's settings go back to its
 * slice before the new primary's come in.
 */
function gitGraphClearForSelection(state) {
  state.selectedHash = null;
  state.compareHash = null;
  state.detailsData = null;
  state.openFile = null;
  state.keptFileView = null;
  state.codeReview = null;
  state.lastViewedFilePath = null;
  state.checkedHashes.clear();
  state.findMatches = [];
  state.findIndex = -1;
  state.rows = [];
  state.layout = [];
}

/** Applies a change to the repositories shown (mutate() changes the state's selection, true when it did) and loads again. */
function gitGraphChangeSelection(project, state, body, mutate) {
  const wasMulti = gitGraphIsMulti(state);
  const before = state.selectedRepo;
  const oldSlice = state.slices && state.slices.get(before);
  if (oldSlice) gitGraphCopySettings(state, oldSlice);
  if (!mutate()) return false;
  const isMulti = gitGraphIsMulti(state);
  if (wasMulti || isMulti) gitGraphClearForSelection(state);
  else {
    state.selectedHash = null;
    state.detailsData = null;
    state.checkedHashes.clear();
  }
  if (state.selectedRepo !== before) gitGraphAdoptPrimary(state);
  gitGraphSaveUiPrefs(project.id, state);
  gitGraphLoadGraph(project, state, body, { reset: true });
  return true;
}

function gitGraphWireRepoPicker(project, state, body) {
  const repos = state.repositories || [];
  if (typeof gitWireRepoTabs === 'function') {
    gitWireRepoTabs(body, repos, {
      onOnly: (repo) => gitGraphChangeSelection(project, state, body, () => gitRepoSelectOnly(state, repos, repo)),
      onToggle: (repo) => gitGraphChangeSelection(project, state, body, () => gitRepoToggle(state, repos, repo)),
    });
    return;
  }
  body.querySelectorAll('.gg-repo-option').forEach((btn) => {
    const repo = repos[Number(btn.dataset.index)];
    if (!repo) return;
    btn.onclick = () => {
      state.selectedRepo = repo.path;
      state.selectedRepos = [repo.path];
      state.selectedHash = null;
      state.detailsData = null;
      state.checkedHashes.clear();
      gitGraphSaveUiPrefs(project.id, state);
      gitGraphLoadGraph(project, state, body, { reset: true });
    };
  });
}

/** A repository that could not be read, over the table that shows the others: one line each, with Retry. */
function gitGraphSliceErrorsHtml(state) {
  const failed = [...(state.slices ? state.slices.values() : [])].filter(slice => slice.error);
  if (!failed.length) return '';
  const lines = failed.map(slice => {
    const name = pathBasename(slice.path) || slice.path;
    return `<div class="gg-slice-error"><span class="gg-slice-error-text"><strong>${escapeHtml(name)}</strong> could not be read: ${escapeHtml(slice.error)}</span><button type="button" class="ws-btn gg-slice-retry" data-path="${escapeAttr(slice.path)}">Retry</button></div>`;
  }).join('');
  return `<div class="gg-slice-errors">${lines}</div>`;
}

function gitGraphWireSliceErrors(project, state, body) {
  body.querySelectorAll('.gg-slice-retry').forEach((button) => {
    button.onclick = () => gitGraphReloadSlice(project, state, body, button.dataset.path, {});
  });
}

// --- Control bar ---

/** The Branches button's text: what is selected, over one repository or over all the ones shown. */
function gitGraphBranchesLabel(state) {
  if (gitGraphIsMulti(state)) {
    const slices = gitGraphShownRepos(state).map(r => state.slices && state.slices.get(r.path)).filter(Boolean);
    const filtered = slices.some(slice => Array.isArray(slice.branchSelection));
    const tagged = slices.filter(slice => Array.isArray(slice.tagSelection));
    const repoCount = gitGraphShownRepos(state).length;
    const branchCount = slices.reduce((sum, slice) => sum + (Array.isArray(slice.branchSelection) ? slice.branchSelection.length : gitGraphAllBranchKeys(slice).length), 0);
    const branches = filtered ? `${branchCount} branch${branchCount === 1 ? '' : 'es'} · ${repoCount} repos` : 'Show All';
    if (!tagged.length) return branches;
    const tagCount = tagged.reduce((sum, slice) => sum + slice.tagSelection.length, 0);
    return `${branches} · ${tagCount} tag${tagCount === 1 ? '' : 's'}`;
  }
  const branchLabel = !Array.isArray(state.branchSelection) ? 'Show All'
    : state.branchSelection.length
      ? `${state.branchSelection.length} branch${state.branchSelection.length === 1 ? '' : 'es'}`
      : 'None';
  const tagCount = Array.isArray(state.tagSelection) ? state.tagSelection.length : null;
  const tagLabel = tagCount === null ? '' : ` · ${tagCount} tag${tagCount === 1 ? '' : 's'}`;
  return branchLabel + tagLabel;
}

/** The checked-out branch of a repository: its name, "detached at <hash>", or null while it is not known. */
function gitGraphHeadName(view, repo) {
  const name = view.headBranchName || (repo && !repo.detached && repo.branch) || null;
  if (name) return name;
  const hash = view.headHash || (repo && repo.head) || null;
  if (!hash) return null;
  const commit = (view.rawCommits || []).find(c => c.hash === hash);
  return `detached at ${(commit && commit.shortHash) || String(hash).slice(0, 8)}`;
}

/**
 * Where the toolbar shows the checked-out branch (HEAD) of the repository, so
 * it is in sight: one chip with one repository, one chip per repository shown
 * with several, each in that repository's color (the one of its Repository
 * column), with the repository's name as the tooltip.
 */
function gitGraphHeadBranchesHtml(project, state) {
  const shown = gitGraphShownRepos(state);
  const multi = shown.length > 1;
  const colors = multi && typeof gitRepoColors === 'function' ? gitRepoColors(project, state.repositories || []) : {};
  const chips = shown.map((repo) => {
    const view = multi ? (state.slices && state.slices.get(repo.path)) || {} : state;
    const name = gitGraphHeadName(view, repo);
    if (!name) return '';
    const repoName = (typeof gitRepoTabLabel === 'function' ? gitRepoTabLabel(repo) : pathBasename(repo.path)) || repo.path;
    const style = multi && colors[repo.colorKey || repo.path] ? ` style="--repo-color:${escapeAttr(colors[repo.colorKey || repo.path])}"` : '';
    const title = multi ? `${repoName}: ${name}` : `Checked out: ${name}`;
    return `<span class="gg-head-branch" title="${escapeAttr(title)}"${style}>${gitGraphIcon('branch', 12)}<span>${escapeHtml(name)}</span></span>`;
  }).join('');
  return chips ? `<div class="gg-head-branches" id="gg-head-branches">${chips}</div>` : '';
}

function gitGraphControlBarHtml(project, state) {
  return `
    <div class="gg-toolbar">
      <div class="gg-toolbar-left">
        <div class="gg-branches-dropdown">
          <button type="button" class="gg-toolbar-btn" id="gg-branches-btn">${gitGraphIcon('branch', 13)}<span>Branches: ${escapeHtml(gitGraphBranchesLabel(state))}</span>${gitGraphIcon('chevronDown', 10)}</button>
        </div>
        ${gitGraphHeadBranchesHtml(project, state)}
      </div>
      <div class="gg-toolbar-right">
        <span class="gg-compare-slot" id="gg-compare-slot">${gitGraphCompareSlotHtml(state)}</span>
        <button type="button" class="gg-icon-btn" id="gg-find-btn" title="Find (Ctrl/Cmd+F)">${gitGraphIcon('search', 14)}</button>
        <button type="button" class="gg-icon-btn" id="gg-settings-btn" title="Repository Settings">${gitGraphIcon('gear', 14)}</button>
        ${state.remotes.length ? `<button type="button" class="gg-icon-btn" id="gg-fetch-btn" title="Fetch from Remote(s)">${gitGraphIcon('fetch', 14)}</button>` : ''}
        <button type="button" class="gg-icon-btn ${state.loading ? 'gg-spin' : ''}" id="gg-refresh-btn" title="Refresh">${gitGraphIcon('refresh', 14)}</button>
        <button type="button" class="gg-icon-btn" id="gg-terminal-btn" title="Open a Terminal for this Repository">${gitGraphIcon('terminal', 14)}</button>
        ${state.selecting ? `<span class="gg-selected-count" id="gg-selected-count">${gitGraphCheckedCount(state)} selected</span>` : ''}
        <button type="button" class="gg-icon-btn" id="gg-select-menu-btn" title="Selection: tick commits to compare them" aria-label="Selection">${gitGraphIcon('more', 14)}</button>
      </div>
    </div>
    <div class="gg-branches-menu" id="gg-branches-menu" style="display:none"></div>`;
}

function gitGraphWireControlBar(project, state, body) {
  const repo = (state.repositories || []).find(r => r.path === state.selectedRepo);
  body.querySelector('#gg-find-btn').onclick = () => { state.findOpen = !state.findOpen; gitGraphPaint(project, state, body); };
  const selectBtn = body.querySelector('#gg-select-menu-btn');
  selectBtn.onclick = () => showContextMenu(gitGraphSelectionMenuItems(project, state, body), { anchor: selectBtn });
  gitGraphWireCompareSlot(project, state, body);
  body.querySelector('#gg-settings-btn').onclick = () => gitGraphToggleSettings(project, state, body);
  const fetchBtn = body.querySelector('#gg-fetch-btn');
  if (fetchBtn) {
    fetchBtn.onclick = () => gitGraphRunNetworkAction(project, state, body, 'fetchAllRemotes', {
      prune: !!(state.repoConfig && state.repoConfig.fetchAndPrune),
      pruneTags: !!(state.repoConfig && state.repoConfig.fetchAndPruneTags),
    });
  }
  body.querySelector('#gg-refresh-btn').onclick = () => gitGraphLoadGraph(project, state, body, { reset: true });
  body.querySelector('#gg-terminal-btn').onclick = () => {
    if (typeof launchTerminalSession === 'function' && repo) launchTerminalSession({ projectPath: repo.path, projectId: project.id });
  };
  const branchesBtn = body.querySelector('#gg-branches-btn');
  if (branchesBtn) {
    branchesBtn.onclick = () => gitGraphToggleBranchesMenu(project, state, body, branchesBtn);
    // Picking a branch reloads (and repaints) the graph; keep the menu open across that.
    if (state.branchesMenuOpen) gitGraphOpenBranchesMenu(project, state, body, branchesBtn);
  }
}

function gitGraphCloseBranchesMenu(state) {
  state.branchesMenuOpen = false;
  if (state.branchesMenuCleanup) state.branchesMenuCleanup();
  state.branchesMenuCleanup = null;
}

function gitGraphToggleBranchesMenu(project, state, body, anchor) {
  if (state.branchesMenuOpen) {
    gitGraphCloseBranchesMenu(state);
    const menu = body.querySelector('#gg-branches-menu');
    if (menu) menu.style.display = 'none';
    return;
  }
  gitGraphOpenBranchesMenu(project, state, body, anchor);
}

/**
 * The branches (or tags) the dropdown lists, one section per repository
 * shown: a History of one repository has a single section without a header.
 * Each: { path, label, color, view, names (sorted), selected (Set) }.
 */
function gitGraphBranchesSections(project, state, tab, sortDir) {
  const shown = gitGraphShownRepos(state);
  const multi = shown.length > 1;
  const colors = multi && typeof gitRepoColors === 'function' ? gitRepoColors(project, state.repositories || []) : {};
  const selKey = tab === 'tags' ? 'tagSelection' : 'branchSelection';
  return shown.map((repo) => {
    const view = multi ? (state.slices && state.slices.get(repo.path)) || state : state;
    let names;
    if (tab === 'tags') {
      names = (view.refs?.tags || []).map(t => t.name);
    } else {
      const heads = view.refs?.heads || [];
      const remotes = state.showRemoteBranches ? gitGraphVisibleRemotes(view.refs?.remotes || [], view.repoConfig && view.repoConfig.perRemoteVisibility) : [];
      names = [...heads.map(h => h.name), ...remotes.map(r => `${r.remote}/${r.name}`)];
    }
    // Natural order, so v1.10 sorts after v1.9.
    names.sort((a, b) => sortDir * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const selection = view[selKey] || 'all';
    return {
      path: repo.path, view, names, selected: selection === 'all' ? new Set(names) : new Set(selection),
      label: (typeof gitRepoTabLabel === 'function' ? gitRepoTabLabel(repo) : pathBasename(repo.path)) || repo.path,
      color: colors[repo.colorKey || repo.path] || '',
    };
  });
}

function gitGraphBranchesSectionHtml(section, tab, multi) {
  const rows = section.names.length
    ? section.names.map(name => `<label class="gg-branches-row" data-name="${escapeAttr(name)}"><input type="checkbox" data-name="${escapeAttr(name)}"${multi ? ` data-repo="${escapeAttr(section.path)}"` : ''} ${section.selected.has(name) ? 'checked' : ''}> ${escapeHtml(name)}</label>`).join('')
    : `<div class="gg-empty-row">No ${tab}.</div>`;
  if (!multi) return rows;
  const style = section.color ? ` style="--repo-color:${escapeAttr(section.color)}"` : '';
  return `<div class="gg-branches-section" data-repo="${escapeAttr(section.path)}"${style}>
    <div class="gg-branches-section-head"><span class="gg-branches-section-name" title="${escapeAttr(section.path)}">${escapeHtml(section.label)}</span><span class="gg-branches-section-actions"><button type="button" data-section-act="all" data-repo="${escapeAttr(section.path)}">All</button><button type="button" data-section-act="none" data-repo="${escapeAttr(section.path)}">None</button></span></div>${rows}</div>`;
}

function gitGraphOpenBranchesMenu(project, state, body, anchor) {
  const menu = body.querySelector('#gg-branches-menu');
  if (!menu) return;
  if (state.branchesMenuCleanup) state.branchesMenuCleanup();
  state.branchesMenuOpen = true;
  const tab = state.branchesMenuTab === 'tags' ? 'tags' : 'branches';
  const selKey = tab === 'tags' ? 'tagSelection' : 'branchSelection';
  const sortDir = state.refSort === 'desc' ? -1 : 1;
  const sections = gitGraphBranchesSections(project, state, tab, sortDir);
  const multi = sections.length > 1;
  // Show Remote lives here, in the row of the tabs before the sort button.
  menu.innerHTML = `
    <div class="gg-branches-tabs">
      <button type="button" class="gg-branches-tab ${tab === 'branches' ? 'active' : ''}" data-tab="branches">Branches</button>
      <button type="button" class="gg-branches-tab ${tab === 'tags' ? 'active' : ''}" data-tab="tags">Tags</button>
      <label class="gg-checkbox gg-branches-remote" title="${multi ? 'Show remote branches in every repository shown' : 'Show remote branches'}"><input type="checkbox" id="gg-show-remote" ${state.showRemoteBranches ? 'checked' : ''}> Show Remote</label>
      <button type="button" class="gg-branches-sort" id="gg-branches-sort" title="${sortDir === 1 ? 'Sorted A to Z — click for Z to A' : 'Sorted Z to A — click for A to Z'}">${sortDir === 1 ? 'A→Z' : 'Z→A'}</button>
    </div>
    <div class="gg-branches-search"><input type="text" id="gg-branches-filter" placeholder="Filter ${tab}…"></div>
    <div class="gg-branches-actions">
      <button type="button" data-act="all">Select All</button>
      <button type="button" data-act="none">Deselect All</button>
      <button type="button" data-act="invert">Invert Selection</button>
    </div>
    <div class="gg-branches-list">${sections.map(section => gitGraphBranchesSectionHtml(section, tab, multi)).join('')}</div>`;
  menu.style.display = 'block';
  // Fixed to the button so it floats above the graph instead of sitting in the page flow.
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.maxHeight = `${Math.max(200, window.innerHeight - rect.bottom - 24)}px`;
  const dismiss = (e) => {
    if (e.type === 'keydown' ? e.key !== 'Escape' : (menu.contains(e.target) || anchor.contains(e.target))) return;
    gitGraphCloseBranchesMenu(state);
    menu.style.display = 'none';
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', dismiss, true);
  state.branchesMenuCleanup = () => {
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', dismiss, true);
  };
  menu.querySelectorAll('.gg-branches-tab').forEach((btn) => {
    btn.onclick = () => { state.branchesMenuTab = btn.dataset.tab; state.branchesFilter = ''; gitGraphOpenBranchesMenu(project, state, body, anchor); };
  });
  // Show Remote applies to every repository shown: the primary's config and
  // the others', then everything is read again.
  menu.querySelector('#gg-show-remote').onchange = (e) => {
    state.showRemoteBranches = e.target.checked;
    gitGraphSaveUiPrefs(project.id, state);
    gitGraphPatchRepoConfig(project, state, { showRemoteBranches: e.target.checked });
    for (const section of sections) {
      if (section.path !== state.selectedRepo) gitGraphPatchRepoConfigFor(project, state, section.path, { showRemoteBranches: e.target.checked });
    }
    gitGraphLoadGraph(project, state, body, { reset: true });
  };
  menu.querySelector('#gg-branches-sort').onclick = () => {
    state.refSort = sortDir === 1 ? 'desc' : 'asc';
    gitGraphSaveUiPrefs(project.id, state);
    gitGraphOpenBranchesMenu(project, state, body, anchor);
  };
  const filter = menu.querySelector('#gg-branches-filter');
  filter.value = state.branchesFilter || '';
  const applyFilter = () => {
    const q = filter.value.toLowerCase();
    menu.querySelectorAll('.gg-branches-list .gg-branches-row').forEach((row) => {
      row.style.display = row.dataset.name.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  applyFilter();
  const currentOf = (section) => {
    const selection = section.view[selKey] || 'all';
    return selection === 'all' ? new Set(section.names) : new Set(selection);
  };
  // One repository: as it always was. Several: each section's own selection.
  const commit = (changes) => {
    if (multi) { gitGraphCommitSelections(project, state, body, tab, changes.map(({ section, next }) => ({ path: section.path, next }))); return; }
    const { next } = changes[0];
    state[selKey] = next;
    gitGraphSaveUiPrefs(project.id, state);
    if (selKey === 'branchSelection') gitGraphPatchRepoConfig(project, state, { branchDropdownSelection: next });
    gitGraphLoadGraph(project, state, body, { reset: true });
  };
  menu.querySelectorAll('.gg-branches-actions button').forEach((btn) => {
    btn.onclick = () => {
      commit(sections.map((section) => {
        if (btn.dataset.act === 'all') return { section, next: 'all' };
        if (btn.dataset.act === 'none') return { section, next: [] };
        const current = currentOf(section);
        return { section, next: section.names.filter(name => !current.has(name)) };
      }));
    };
  });
  menu.querySelectorAll('.gg-branches-section-actions button').forEach((btn) => {
    btn.onclick = () => {
      const section = sections.find(sec => sec.path === btn.dataset.repo);
      if (section) commit([{ section, next: btn.dataset.sectionAct === 'all' ? 'all' : [] }]);
    };
  });
  menu.querySelectorAll('.gg-branches-list input[type="checkbox"]').forEach((cb) => {
    cb.onchange = () => {
      const section = multi ? sections.find(sec => sec.path === cb.dataset.repo) : sections[0];
      if (!section) return;
      const current = currentOf(section);
      if (cb.checked) current.add(cb.dataset.name); else current.delete(cb.dataset.name);
      commit([{ section, next: [...current] }]);
    };
  });
  filter.oninput = () => { state.branchesFilter = filter.value; applyFilter(); };
}

function gitGraphRunNetworkAction(project, state, body, actionId, params) {
  const repo = (state.repositories || []).find(r => r.path === state.selectedRepo);
  if (!repo) return;
  // The progress events name the folder: with several repositories shown, the primary's.
  state.progress = { actionId, text: `Running ${actionId}…`, folderPath: repo.path };
  state.error = '';
  gitGraphPaint(project, state, body);
  gitGraphApi('runGitGraphAction', project.id, repo.path, actionId, params).then((result) => {
    state.progress = null;
    if (!result || !result.ok) {
      // A reload's own `reset` immediately clears state.error, which would
      // otherwise erase the failure it's meant to report before the user
      // ever sees it — only reload (and let that reload's own outcome own
      // the error state) once the action itself actually succeeded.
      state.error = (result && result.error) || `${actionId} failed.`;
      gitGraphPaint(project, state, body);
      return;
    }
    // Only the primary changed (a fetch): the others are left as they are.
    if (gitGraphIsMulti(state)) gitGraphReloadSlice(project, state, body, repo.path, { keepScroll: true });
    else gitGraphLoadGraph(project, state, body, { reset: true });
  });
}

function gitGraphRenderProgress(project, state, body) {
  const bar = document.createElement('div');
  bar.className = 'gg-progress';
  bar.innerHTML = `<span class="gg-progress-text">${escapeHtml(state.progress.text)}</span><button type="button" class="gg-progress-cancel">Cancel</button>`;
  bar.querySelector('.gg-progress-cancel').onclick = () => {
    const path = state.progress.folderPath || state.selectedRepo;
    const repo = (state.repositories || []).find(r => r.path === path);
    if (repo) gitGraphApi('cancelGitGraphAction', project.id, repo.path, state.progress.actionId);
  };
  body.querySelector('.gg-tab-shell').prepend(bar);
}

// --- Table header ---

const GG_COLUMNS = [
  // Only while several repositories are shown: the name of each row's repository, in its color.
  { key: 'repo', label: 'Repository', hideable: false, multiOnly: true },
  { key: 'graph', label: 'Graph', hideable: false },
  { key: 'description', label: 'Description', hideable: false },
  { key: 'date', label: 'Date', hideable: true },
  { key: 'author', label: 'Author', hideable: true },
  { key: 'commit', label: 'Commit', hideable: true },
];

function gitGraphHeaderHtml(state) {
  const multi = gitGraphIsMulti(state);
  const cells = GG_COLUMNS.filter(col => (!col.multiOnly || multi) && (!col.hideable || state.columns[col.key])).map((col) => {
    const width = state.columnWidths[col.key] ? ` style="width:${state.columnWidths[col.key]}px"` : '';
    return `<div class="gg-th" data-col="${col.key}"${width}>${escapeHtml(col.label)}<span class="gg-col-resizer" data-col="${col.key}"></span></div>`;
  }).join('');
  return `<div class="gg-thead" id="gg-thead" data-gg-kind="column-header"><div class="gg-th gg-th-select" data-col="select"></div>${cells}</div>`;
}

function gitGraphWireHeader(project, state, body) {
  const thead = body.querySelector('#gg-thead');
  if (!thead) return;
  thead.oncontextmenu = (e) => {
    e.preventDefault();
    gitGraphOpenContextMenu(project, state, body, thead, { x: e.clientX, y: e.clientY });
  };
  thead.querySelectorAll('.gg-col-resizer').forEach((handle) => {
    handle.onpointerdown = (e) => {
      e.preventDefault();
      const col = handle.dataset.col;
      const cell = handle.closest('.gg-th');
      const startX = e.clientX;
      const startWidth = cell.getBoundingClientRect().width;
      const onMove = (moveEvent) => {
        const next = Math.max(30, startWidth + (moveEvent.clientX - startX));
        cell.style.width = `${next}px`;
        state.columnWidths[col] = next;
        if (col === 'graph') thead.closest('.gg-table-wrap')?.style.setProperty('--gg-graph-width', `${next}px`);
        if (col === 'repo') thead.closest('.gg-table-wrap')?.style.setProperty('--gg-repo-col', `${next}px`);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        gitGraphSaveUiPrefs(project.id, state);
        gitGraphPatchRepoConfig(project, state, { columnWidths: { ...state.columnWidths } });
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };
  });
}

// --- Rows ---

/** The inline Commit Details open right under the row they belong to: the
 * commit's own row, or for a comparison the row clicked first. Only when that
 * row is no longer loaded do they fall to the end of the list. */
function gitGraphRowsHtml(project, state) {
  if (!state.rows.length) return '<div class="gg-empty-row">No commits yet.</div>';
  const showCols = { date: state.columns.date, author: state.columns.author, commit: state.columns.commit };
  if (gitGraphIsMulti(state)) showCols.repoMeta = gitGraphRepoMeta(project, state);
  const data = state.detailsLocation === 'inline' ? state.detailsData : null;
  const anchor = data ? (data.mode === 'compare' ? state.selectedHash : data.hash) : null;
  let placed = false;
  const html = state.rows.map((row, index) => {
    const rowHtml = gitGraphRowHtml(row, state.layout[index], state, showCols, index);
    if (!data || placed || row.hash !== anchor) return rowHtml;
    placed = true;
    return rowHtml + gitGraphInlineDetailsHtml(state);
  }).join('');
  return html + (data && !placed ? gitGraphInlineDetailsHtml(state) : '');
}

/** { path: { name, color, title } } for the repositories of the History: what its Repository column shows. */
function gitGraphRepoMeta(project, state) {
  const repos = state.repositories || [];
  const colors = typeof gitRepoColors === 'function' ? gitRepoColors(project, repos) : {};
  const meta = {};
  for (const repo of repos) {
    meta[repo.path] = {
      name: (typeof gitRepoTabLabel === 'function' ? gitRepoTabLabel(repo) : pathBasename(repo.path)) || repo.path,
      color: colors[repo.colorKey || repo.path] || '',
      title: repo.path,
    };
  }
  return meta;
}

/** A row's repository, by name: long names are cut, the color is what tells the repositories apart. */
function gitGraphRepoCellHtml(meta) {
  if (!meta) return '<div class="gg-cell gg-cell-repo"></div>';
  const style = meta.color ? ` style="--repo-color:${escapeAttr(meta.color)}"` : '';
  return `<div class="gg-cell gg-cell-repo" title="${escapeAttr(meta.title || meta.name)}"${style}>${escapeHtml(meta.name)}</div>`;
}

function gitGraphRowHtml(row, layoutEntry, state, showCols, index) {
  // The row's own repository: its data is the state's with one shown, its slice with several.
  const view = gitGraphRowView(state, row.hash);
  const kind = row.kind === 'uncommitted' ? 'uncommitted' : (row.kind === 'stash' ? 'stash' : 'commit');
  const selected = row.hash === state.selectedHash || row.hash === state.compareHash;
  const checked = !!(state.checkedHashes && state.checkedHashes.has(row.hash));
  const classes = gitGraphRowClasses({ ...row, selected }, state) + (checked ? ' gg-row-checked' : '');
  const dateValue = state.dateType === 'commit' ? row.commitDate : row.authorDate;
  const dateText = kind === 'uncommitted' ? gitGraphFormatDate(new Date().toISOString(), state.dateFormat) : gitGraphFormatDate(dateValue, state.dateFormat);
  const avatarHtml = (kind === 'commit' && gitGraphAvatarsEnabled(state, view)) ? gitGraphAvatarHtml(row.authorEmail, gitGraphAvatarUrlFor(state, row.authorEmail)) : '';
  const authorText = kind === 'uncommitted' ? '*' : `${avatarHtml}${escapeHtml(row.authorName || '')}`;
  const commitText = kind === 'uncommitted' ? '*' : escapeHtml(row.shortHash || (row.hash || '').slice(0, 8));
  const pills = kind === 'commit' || kind === 'stash' ? gitGraphRenderRefPills(row, { combineLocalAndRemote: state.combineLocalAndRemote, headBranchName: view.headBranchName }) : '';
  const stashBadge = kind === 'stash' ? `<span class="gg-stash-badge" data-gg-kind="stash" data-gg-hash="${escapeAttr(row.hash)}" title="Stash">stash@{${row.stashIndex}}</span>` : '';
  return `
    <div class="${classes}" data-gg-kind="${kind}" data-gg-hash="${escapeAttr(row.hash)}" data-row-index="${index}">
      <div class="gg-cell gg-cell-select" title="Select for Compare"><input type="checkbox" class="gg-select-box" tabindex="-1" aria-label="Select for Compare" ${checked ? 'checked' : ''}></div>
      ${showCols.repoMeta ? gitGraphRepoCellHtml(showCols.repoMeta[row.repoPath]) : ''}
      <div class="gg-cell gg-cell-graph"></div>
      <div class="gg-cell gg-cell-description">${pills}${stashBadge}<span class="gg-subject">${gitGraphLinkifySubject(row.subject || '', view.repoConfig && view.repoConfig.issueLinking)}</span></div>
      ${showCols.date ? `<div class="gg-cell gg-cell-date">${escapeHtml(dateText)}</div>` : ''}
      ${showCols.author ? `<div class="gg-cell gg-cell-author">${authorText}</div>` : ''}
      ${showCols.commit ? `<div class="gg-cell gg-cell-commit mono">${commitText}</div>` : ''}
    </div>`;
}

function gitGraphWireRows(project, state, body) {
  const tbody = body.querySelector('#gg-tbody');
  if (!tbody) return;
  const graphColumns = tbody.querySelectorAll('.gg-cell-graph');
  if (graphColumns.length) {
    // One <svg> for the whole loaded window, absolutely positioned over
    // .gg-tbody (already `position: relative`) so it lines up with every
    // row's graph cell at once — each individual .gg-cell-graph stays an
    // empty placeholder that only reserves the column's width. Building a
    // second, separately-clipped copy of the full svg's markup per row
    // (every row repeating every other row's paths/circles) was O(rows²)
    // DOM nodes; this is O(rows).
    const rowY = [];
    let rowHeight = 0;
    tbody.querySelectorAll('.gg-row[data-row-index]').forEach((el) => {
      rowY[Number(el.dataset.rowIndex)] = el.offsetTop + el.offsetHeight / 2;
      rowHeight = rowHeight || el.offsetHeight;
    });
    const measured = rowY.length === state.rows.length && rowY.some(y => y > 0);
    const svg = gitGraphRenderGraphSvg(state.rows, state.layout, {
      style: state.graphStyle, uncommittedChangesStyle: state.uncommittedChangesStyle, palette: state.graphColours,
      rowY: measured ? rowY : null, height: measured ? tbody.scrollHeight : null, bendHeight: measured ? rowHeight : null,
    });
    const clip = document.createElement('div');
    clip.className = 'gg-graph-clip'; // decorative only — clicks/right-clicks fall through to the row underneath
    clip.innerHTML = svg;
    const svgEl = clip.firstChild;
    clip.style.height = `${svgEl.getAttribute('height')}px`;
    // The column fits the graph unless the user has resized it; either way the
    // clip keeps the lanes from ever drawing over the description text.
    const graphWidth = state.columnWidths.graph || Math.max(60, Number(svgEl.getAttribute('width')) + 6);
    body.querySelector('.gg-table-wrap')?.style.setProperty('--gg-graph-width', `${graphWidth}px`);
    tbody.insertBefore(clip, tbody.firstChild);
  }

  const repo = (state.repositories || []).find(r => r.path === state.selectedRepo);
  const localBranchNames = new Set(((state.refs && state.refs.heads) || []).map(h => h.name));
  const clickCtx = { projectId: project.id, repoPath: repo?.path, localBranchNames };

  tbody.querySelectorAll('[data-gg-kind]').forEach((el) => {
    // Every ref pill/stash badge nested inside a row also carries its own
    // data-gg-kind, so this same querySelectorAll matches both a pill and
    // its enclosing row. Without stopPropagation, a click/right-click on the
    // pill would fire its own handler and then bubble to the row's, whose
    // showContextMenu() call replaces (rather than coexists with) whatever
    // the pill just opened.
    el.onclick = (e) => {
      e.stopPropagation();
      // The first column ticks the row for Compare: it does not open it.
      if (gitGraphInSelectCell(e.target)) { gitGraphToggleChecked(project, state, body, el.dataset.ggHash); return; }
      gitGraphHandleRowClick(project, state, body, el, e);
    };
    el.ondblclick = (e) => {
      e.stopPropagation();
      if (gitGraphInSelectCell(e.target)) return;
      gitGraphHandleDoubleClick(project, state, body, el, clickCtx);
    };
    el.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      gitGraphOpenContextMenu(project, state, body, el, { x: e.clientX, y: e.clientY });
    };
    el.onmouseenter = () => gitGraphShowTooltip(el, state);
    el.onmouseleave = () => gitGraphHideTooltip();
  });

  const loadMoreBtn = body.querySelector('#gg-load-more');
  if (loadMoreBtn) loadMoreBtn.onclick = () => gitGraphLoadGraph(project, state, body, { reset: false });
  gitGraphBindScrollAutoLoad(project, state, body);

  // Each avatar is asked for through a repository that has a commit of that author.
  const avatars = new Map();
  for (const row of state.rows) {
    if (row.kind !== 'commit' || !row.authorEmail || avatars.has(row.authorEmail)) continue;
    if (gitGraphAvatarsEnabled(state, gitGraphRowView(state, row.hash))) avatars.set(row.authorEmail, row.repoPath);
  }
  avatars.forEach((repoPath, email) => gitGraphQueueAvatarFetch(project, state, body, email, repoPath));
}

function gitGraphBindScrollAutoLoad(project, state, body) {
  const wrap = body.querySelector('.gg-table-wrap');
  if (!wrap) return;
  if (state.loadMoreAutomatically === false) { wrap.onscroll = null; return; }
  wrap.onscroll = () => {
    if (state.loadingMore || !state.hasMore) return;
    if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 80) {
      gitGraphLoadGraph(project, state, body, { reset: false });
    }
  };
}

// --- Avatars ---
//
// git-graph-render.js only turns an already-known URL into markup
// (gitGraphAvatarHtml); this file owns the actual fetch-and-cache, exactly
// like every other window.api call in this file.

/** `view`: the data of the repository the avatar is for (its slice), the state's own by default. */
function gitGraphAvatarsEnabled(state, view = state) {
  const repoOverride = view.repoConfig && view.repoConfig.fetchAvatars;
  if (repoOverride === true || repoOverride === false) return repoOverride;
  return !!state.globalFetchAvatars;
}

function gitGraphAvatarUrlFor(state, email) {
  if (!email || !state.avatarCache) return null;
  const key = email.trim().toLowerCase();
  return state.avatarCache.has(key) ? state.avatarCache.get(key) : null;
}

/** Fetches an avatar URL at most once per email per tab session, then swaps
 * every placeholder already in the DOM for that email in place — cheaper and
 * less disruptive than a full gitGraphPaint() for what's normally a handful
 * of small image loads trickling in after the row/detail markup is already
 * on screen. */
function gitGraphQueueAvatarFetch(project, state, body, email, repoPath) {
  if (!email) return;
  const key = email.trim().toLowerCase();
  if (!state.avatarCache) state.avatarCache = new Map();
  if (!state.avatarPending) state.avatarPending = new Set();
  if (state.avatarCache.has(key) || state.avatarPending.has(key)) return;
  const repo = (state.repositories || []).find(r => r.path === (repoPath || state.selectedRepo));
  if (!repo) return;
  state.avatarPending.add(key);
  gitGraphApi('getGitGraphAvatarUrl', project.id, repo.path, email).then((r) => {
    state.avatarPending.delete(key);
    const url = (r && r.ok && r.url) || null;
    state.avatarCache.set(key, url);
    if (!body.isConnected || !gitGraphStillActive(project)) return;
    body.querySelectorAll(`[data-gg-avatar-email="${key}"]`).forEach((el) => {
      const size = parseInt(el.getAttribute('width'), 10) || parseInt(el.style && el.style.width, 10) || 16;
      el.outerHTML = gitGraphAvatarHtml(email, url, { size });
    });
  });
}

/**
 * Whether `ancestorHash` is a (possibly indirect) parent of `descendantHash`,
 * walking `.parents` through whichever commits are currently loaded — the
 * only history available client-side. A pseudo-row (Uncommitted, a stash)
 * has its own single-parent link into the real graph, so it walks the same
 * way as any real commit.
 */
function gitGraphIsAncestor(rows, ancestorHash, descendantHash) {
  const byHash = new Map((rows || []).map(r => [r.hash, r]));
  const seen = new Set();
  const stack = [descendantHash];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const row = byHash.get(current);
    if (!row) continue;
    for (const parentHash of row.parents || []) {
      if (parentHash === ancestorHash) return true;
      stack.push(parentHash);
    }
  }
  return false;
}

/** A click opens the commit's record; on the record already open it closes it,
 * and it stays closed. The second click of a double-click (which checks the
 * commit out) leaves the record as the first click made it. */
function gitGraphHandleRowClick(project, state, body, el, event) {
  const hash = el.dataset.ggHash;
  if (!hash) return;
  if (event && event.detail > 1) return;
  const row = state.rows.find(r => r.hash === hash);
  if ((event.ctrlKey || event.metaKey) && gitGraphCompareWithSelected(project, state, body, hash)) return;
  if (gitGraphIsOpenRecord(state, hash)) { gitGraphCloseDetails(project, state, body); return; }
  state.selectedHash = hash;
  state.compareHash = null;
  gitGraphOpenDetails(project, state, body, row);
}

/** Whether `hash` is the commit whose record is open (a comparison is not one commit's record). */
function gitGraphIsOpenRecord(state, hash) {
  const data = state.detailsData;
  return !!(data && data.mode === 'single' && data.hash === hash);
}

/** Compares `hash` with the selected commit (the one open, or the only one
 * ticked for Compare): Ctrl/Cmd+click and the right-click menu. The open
 * record closes and the comparison opens over the History, the same as for
 * ticked commits, the older of the two first. False when there is no other
 * commit selected. */
function gitGraphCompareWithSelected(project, state, body, hash) {
  const base = gitGraphCompareBase(state);
  if (!base || base.hash === hash) return false;
  const hashes = gitGraphCompareOrder(state.rows, [base.hash, hash]);
  if (hashes.length !== 2) return false;
  // Compare works within one repository.
  if (gitGraphMixedRepos(hashes)) return false;
  if (state.detailsData || state.selectedHash) gitGraphCloseDetails(project, state, body);
  const repo = gitGraphRowRepo(state, hashes[0]);
  gitGraphShowComparePopup(gitGraphCompareSpecFor(project.id, repo ? repo.path : state.selectedRepo, state.rows, hashes));
  return true;
}

/** The commit a two-commit comparison starts from: the open one, or else the
 * only one ticked. Null when there is none. */
function gitGraphCompareBase(state) {
  let hash = state.selectedHash;
  if (!hash) {
    const ticked = gitGraphCompareOrder(state.rows, state.checkedHashes || []);
    if (ticked.length !== 1) return null;
    hash = ticked[0];
  }
  if (gitGraphPlainHash(hash) === '#uncommitted') return { hash, label: 'Uncommitted Changes' };
  const row = (state.rows || []).find(r => r.hash === hash);
  return { hash, label: (row && row.shortHash) || gitGraphPlainHash(hash).slice(0, 8) };
}

// --- The first column: commits ticked for Compare (git-graph-compare.js) ---

/**
 * The toolbar's "•••": Enable Selection shows the first column; then Select
 * All (the loaded commits, or the ones found while searching), Deselect All,
 * Invert Selection and Cancel Selection, which hides the column and unticks.
 */
function gitGraphSelectionMenuItems(project, state, body) {
  if (!state.selecting) {
    return [{ label: 'Enable Selection', icon: typeof FICONS !== 'undefined' ? FICONS.select(14) : '', onClick: () => gitGraphSetSelecting(project, state, body, true) }];
  }
  const count = gitGraphCheckedCount(state);
  const visible = gitGraphSelectAllHashes(state);
  return [
    { head: `${count} selected` },
    { label: 'Select All', onClick: () => { for (const hash of visible) state.checkedHashes.add(hash); gitGraphRefreshChecks(project, state, body); } },
    { label: 'Deselect All', disabled: !count, onClick: () => { state.checkedHashes.clear(); gitGraphRefreshChecks(project, state, body); } },
    {
      label: 'Invert Selection',
      onClick: () => {
        const was = new Set(state.checkedHashes);
        state.checkedHashes = new Set(visible.filter(hash => !was.has(hash)));
        gitGraphRefreshChecks(project, state, body);
      },
    },
    { sep: true },
    { label: 'Cancel Selection', onClick: () => gitGraphSetSelecting(project, state, body, false) },
  ];
}

/** Show or hide the first column; hiding it unticks every commit. */
function gitGraphSetSelecting(project, state, body, on) {
  state.selecting = !!on;
  if (!on) state.checkedHashes.clear();
  body.querySelector('.gg-table-wrap')?.classList.toggle('gg-no-select', !on);
  const count = body.querySelector('#gg-selected-count');
  if (on && !count) {
    body.querySelector('#gg-select-menu-btn')?.insertAdjacentHTML('beforebegin', `<span class="gg-selected-count" id="gg-selected-count"></span>`);
  } else if (!on && count) {
    count.remove();
  }
  gitGraphRefreshChecks(project, state, body);
}

function gitGraphInSelectCell(target) {
  return !!(target && typeof target.closest === 'function' && target.closest('.gg-cell-select'));
}

/** The ticked commits that are still loaded. */
function gitGraphCheckedCount(state) {
  return gitGraphCompareOrder(state.rows, state.checkedHashes || []).length;
}

function gitGraphCompareSlotHtml(state) {
  const ticked = gitGraphCompareOrder(state.rows, state.checkedHashes || []);
  return gitGraphCompareButtonsHtml(ticked.length, { mixed: gitGraphMixedRepos(ticked) });
}

/** Ticks `hash` (or unticks it), without repainting the table. */
function gitGraphToggleChecked(project, state, body, hash) {
  if (!hash) return;
  if (state.checkedHashes.has(hash)) state.checkedHashes.delete(hash);
  else state.checkedHashes.add(hash);
  gitGraphRefreshChecks(project, state, body);
}

/** The ticks on the rows, and the toolbar's Clear and Compare, as the ticked commits now are. */
function gitGraphRefreshChecks(project, state, body) {
  body.querySelectorAll('.gg-tbody .gg-row[data-gg-hash]').forEach((rowEl) => {
    const on = state.checkedHashes.has(rowEl.dataset.ggHash);
    rowEl.classList.toggle('gg-row-checked', on);
    const box = rowEl.querySelector('.gg-select-box');
    if (box) box.checked = on;
  });
  const count = body.querySelector('#gg-selected-count');
  if (count) count.textContent = `${gitGraphCheckedCount(state)} selected`;
  const slot = body.querySelector('#gg-compare-slot');
  if (slot) { slot.innerHTML = gitGraphCompareSlotHtml(state); gitGraphWireCompareSlot(project, state, body); }
}

function gitGraphWireCompareSlot(project, state, body) {
  const compareBtn = body.querySelector('#gg-compare-btn');
  if (compareBtn) compareBtn.onclick = () => gitGraphOpenCompare(project, state, { inWindow: false });
  const windowBtn = body.querySelector('#gg-compare-window-btn');
  if (windowBtn) windowBtn.onclick = () => gitGraphOpenCompare(project, state, { inWindow: true });
}

/** What Compare compares: the ticked commits, oldest first, with their names and titles. Null outside 2 to GG_COMPARE_MAX. */
function gitGraphCompareSpec(project, state) {
  const hashes = gitGraphCompareOrder(state.rows, state.checkedHashes || []);
  if (hashes.length < 2 || hashes.length > GG_COMPARE_MAX) return null;
  // Commits of several repositories cannot be compared.
  if (gitGraphMixedRepos(hashes)) return null;
  const repo = gitGraphRowRepo(state, hashes[0]);
  return gitGraphCompareSpecFor(project.id, repo ? repo.path : state.selectedRepo, state.rows, hashes);
}

function gitGraphOpenCompare(project, state, { inWindow }) {
  const spec = gitGraphCompareSpec(project, state);
  if (!spec) return null;
  if (inWindow) gitGraphApi('openGitCompareWindow', spec.projectId, spec.repoPath, spec.hashes, spec.labels, spec.subjects);
  else gitGraphShowComparePopup(spec);
  return spec;
}

function gitGraphShowTooltip(el, state) {
  const hash = el.dataset.ggHash;
  const row = state.rows.find(r => r.hash === hash);
  if (!row) return;
  el.title = row.isHead ? 'HEAD — the currently checked-out commit' : (row.subject || '');
}

function gitGraphHideTooltip() { /* native title tooltip needs no teardown */ }

// --- Commit Details / Comparison ---

/** The file layout every record opens in: the "File list layout" setting,
 * which is Tree unless changed there. Tree/List in the panel only switch the
 * record that is open. */
function gitGraphDefaultFileView(state) {
  return state.globalPrefs && state.globalPrefs.fileViewType === 'list' ? 'list' : 'tree';
}

function gitGraphOpenDetails(project, state, body, row) {
  if (!row) return;
  // The record of a row of a History of several repositories remembers its
  // repository; git is asked with the plain hash and that repository's HEAD.
  const repo = gitGraphRowRepo(state, row.hash);
  const view = gitGraphRowView(state, row.hash);
  const own = gitGraphSplitKey(row.hash).tag ? { repoPath: repo.path } : {};
  const request = ++state.detailsRequest;
  state.detailsLoading = true;
  state.detailsData = { mode: 'single', hash: row.hash, kind: row.kind, ...own };
  state.fileViewType = gitGraphDefaultFileView(state);
  state.lastViewedFilePath = null;
  state.openFile = null;
  state.detailsJustOpened = true;
  gitGraphHydrateCodeReviewForDetails(state);
  gitGraphPaintDetailsOnly(project, state, body);
  const fetch = row.kind === 'uncommitted'
    ? gitGraphApi('getGitGraphCompareDetail', project.id, repo.path, view.headHash, null)
    : gitGraphApi('getGitGraphCommitDetail', project.id, repo.path, gitGraphPlainHash(row.hash));
  fetch.then((result) => {
    if (request !== state.detailsRequest) return;
    state.detailsLoading = false;
    if (result && result.ok) {
      state.detailsData = { mode: 'single', hash: row.hash, kind: row.kind, ...own, commit: result.commit, files: result.files || [] };
      if (result.commit && result.commit.authorEmail) gitGraphQueueAvatarFetch(project, state, body, result.commit.authorEmail, repo.path);
    } else {
      state.detailsData = { mode: 'single', hash: row.hash, kind: row.kind, ...own, error: (result && result.error) || 'Could not load commit details.' };
    }
    gitGraphPaintDetailsOnly(project, state, body);
  });
}

function gitGraphOpenComparison(project, state, body, fromHash, toHash) {
  const repo = gitGraphRowRepo(state, fromHash);
  const own = gitGraphSplitKey(fromHash).tag ? { repoPath: repo.path } : {};
  const request = ++state.detailsRequest;
  state.detailsLoading = true;
  state.detailsData = { mode: 'compare', fromHash, toHash, ...own };
  state.fileViewType = gitGraphDefaultFileView(state);
  state.lastViewedFilePath = null;
  state.openFile = null;
  state.detailsJustOpened = true;
  gitGraphHydrateCodeReviewForDetails(state);
  gitGraphPaintDetailsOnly(project, state, body);
  const from = gitGraphPlainHash(fromHash);
  const to = gitGraphPlainHash(toHash);
  const toArg = to === '#uncommitted' ? null : to;
  gitGraphApi('getGitGraphCompareDetail', project.id, repo.path, from === '#uncommitted' ? to : from, from === '#uncommitted' ? null : toArg)
    .then((result) => {
      if (request !== state.detailsRequest) return;
      state.detailsLoading = false;
      if (result && result.ok) state.detailsData = { mode: 'compare', fromHash, toHash, ...own, files: result.files || [] };
      else state.detailsData = { mode: 'compare', fromHash, toHash, ...own, error: (result && result.error) || 'Could not load comparison.' };
      gitGraphPaintDetailsOnly(project, state, body);
    });
}

/** Inline, the panel sits among the rows, so painting it repaints the table:
 * that keeps the graph's lines measured around it, and the scroll position
 * where it was (a fresh table starts at the top). */
function gitGraphPaintDetailsOnly(project, state, body) {
  if (state.detailsLocation === 'docked') {
    const dock = body.querySelector('#gg-details-docked');
    if (dock) { dock.style.display = 'block'; gitGraphRenderDetailsPanel(project, state, body); return; }
  }
  gitGraphPaint(project, state, body, { preserveScroll: true });
}

function gitGraphInlineDetailsHtml(state) {
  return `<div class="gg-details gg-details-inline" id="gg-details-inline">${gitGraphDetailsBodyHtml(state)}</div>`;
}

function gitGraphRenderDetailsPanel(project, state, body) {
  // Inline, a new height (Tree/List, a folder folded) moves every row below.
  if (state.detailsLocation !== 'docked') { gitGraphPaintDetailsOnly(project, state, body); return; }
  const container = body.querySelector('#gg-details-docked');
  if (!container) return;
  gitGraphKeepFileView(container, state);
  container.innerHTML = gitGraphDetailsBodyHtml(state);
  gitGraphWireDetailsPanel(project, state, body, container);
  gitGraphMaybeAutoCenterDetails(state, container);
}

/** Brings the inline panel into view exactly once per open, when its details
 * have arrived (the "Loading…" placeholder is a fraction of their height), not
 * on every later repaint of an already-open panel: `state.detailsJustOpened`
 * is set by gitGraphOpenDetails/OpenComparison and cleared here. With
 * auto-center on, the clicked row and its panel are centered in the table, or
 * the row goes to the top if they are taller than the table; with it off, the
 * table only scrolls as far as it takes for the panel to show. Only the table
 * scrolls, never the tab around it. A docked panel is always in view. */
function gitGraphMaybeAutoCenterDetails(state, container) {
  if (!state.detailsJustOpened || state.detailsLoading) return;
  state.detailsJustOpened = false;
  const wrap = container && typeof container.closest === 'function' ? container.closest('.gg-table-wrap') : null;
  if (!wrap) return;
  const head = wrap.querySelector('.gg-thead');
  const headHeight = head ? head.offsetHeight : 0;
  const origin = wrap.getBoundingClientRect().top - wrap.scrollTop;
  const row = container.previousElementSibling;
  const top = (row && row.classList && row.classList.contains('gg-row') ? row : container).getBoundingClientRect().top - origin;
  const bottom = container.getBoundingClientRect().bottom - origin;
  const visible = wrap.clientHeight - headHeight;
  if (state.autoCenterDetails !== false) {
    const room = visible - (bottom - top);
    wrap.scrollTop = Math.max(0, top - headHeight - Math.max(0, room / 2));
  } else if (top - headHeight < wrap.scrollTop) {
    wrap.scrollTop = Math.max(0, top - headHeight);
  } else if (bottom > wrap.scrollTop + wrap.clientHeight) {
    wrap.scrollTop = Math.min(top - headHeight, bottom - wrap.clientHeight);
  }
}

function gitGraphDetailsBodyHtml(state) {
  const data = state.detailsData;
  if (!data) return '';
  if (state.detailsLoading) return '<div class="gg-loading"><span class="gg-loading-dot"></span>Loading…</div>';
  if (data.error) return `<div class="gg-error-state">${escapeHtml(data.error)}</div>`;
  const header = data.mode === 'compare'
    ? `<div class="gg-details-header">Displaying all changes from <span class="mono">${escapeHtml(String(gitGraphPlainHash(data.fromHash) || '').replace('#uncommitted', 'the working tree'))}</span> to <span class="mono">${escapeHtml(String(gitGraphPlainHash(data.toHash) || '').replace('#uncommitted', 'the working tree'))}</span>.</div>`
    : gitGraphSingleCommitHeaderHtml(data.commit, data.kind, state);
  const files = data.files || [];
  const reviewControls = gitGraphCodeReviewControlsHtml(state);
  const openFile = gitGraphOpenFileFor(state);
  // The files on the left, with Tree/List and Code Review in one bar on top;
  // on the right the commit's own text, and under it the file opened from the
  // list, filling the rest of the panel.
  return `
    <button type="button" class="gg-details-close" id="gg-details-close">×</button>
    <div class="gg-details-grid${openFile ? ' gg-details-has-file' : ''}">
      <div class="gg-details-files">
        <div class="gg-details-files-bar">
          <div class="gg-file-view-toggle">
            <button type="button" class="gg-toggle-btn${state.fileViewType !== 'list' ? ' active' : ''}" data-view="tree">Tree</button>
            <button type="button" class="gg-toggle-btn${state.fileViewType === 'list' ? ' active' : ''}" data-view="list">List</button>
          </div>
          ${reviewControls}
        </div>
        ${gitGraphFileListHtml(files, {
          fileViewType: state.fileViewType, compactFolders: state.compactFolders, collapsedFolders: state.collapsedFolders,
          codeReview: state.codeReview, lastViewedFilePath: state.lastViewedFilePath, openFilePath: openFile ? openFile.path : null,
        })}
      </div>
      <div class="gg-details-side">
        <div class="gg-details-text">${header}</div>
        ${openFile ? gitGraphOpenFilePaneHtml(openFile) : ''}
      </div>
    </div>`;
}

/** The file open in the record that is open now, or null. */
function gitGraphOpenFileFor(state) {
  const file = state.openFile;
  return file && file.detailsKey === gitGraphDetailsKey(state) ? file : null;
}

/** The file under the commit's text: its name, then Expand (over the window),
 * a window of its own and ×; its diff (or its content) fills the rest. */
function gitGraphOpenFilePaneHtml(file) {
  const glyph = file.status ? gitGraphFileStatusGlyph(file.status) : '';
  const note = file.kind === 'revision' ? 'At this revision' : (file.kind === 'working' ? 'With the working file' : '');
  const renamed = file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ` : '';
  return `
    <div class="gg-details-diff" id="gg-details-diff">
      <div class="gg-details-diff-head">
        ${glyph ? `<span class="gg-file-status gg-file-status-${escapeAttr(file.status)}">${escapeHtml(glyph)}</span>` : ''}
        <span class="gg-details-diff-path mono" title="${escapeAttr(renamed + file.path)}">${escapeHtml(renamed + file.path)}</span>
        ${note ? `<span class="gg-details-diff-note">${note}</span>` : ''}
        <span class="gg-details-diff-actions">
          <button type="button" class="gg-icon-btn" id="gg-file-expand" title="Expand over the window" aria-label="Expand over the window">${gitGraphIcon('maximize', 13)}</button>
          <button type="button" class="gg-icon-btn" id="gg-file-window" title="Open in a window of its own" aria-label="Open in a window of its own">${gitGraphIcon('popOut', 13)}</button>
          <button type="button" class="gg-icon-btn gg-details-diff-close" id="gg-file-close" title="Close the file" aria-label="Close the file">×</button>
        </span>
      </div>
      <div class="gg-inline-diff-body" id="gg-inline-diff-body"></div>
    </div>`;
}

function gitGraphSingleCommitHeaderHtml(commit, kind, state) {
  if (kind === 'uncommitted' || !commit) return '<div class="gg-details-header">Working tree changes</div>';
  const parentsHtml = (commit.parents || []).map(p => `<a class="gg-link mono" data-gg-kind="link" data-gg-hash="${escapeAttr(p)}" href="#">${escapeHtml(p)}</a>`).join(', ') || 'none (root commit)';
  const authorDate = gitGraphFormatFullDate(commit.authorDate);
  const commitDate = gitGraphFormatFullDate(commit.commitDate);
  const bothDates = commit.authorDate !== commit.commitDate;
  // The repository the record is of: its config says about signatures, issues, avatars.
  const view = state ? gitGraphDetailsView(state) : null;
  const avatarsOn = state && gitGraphAvatarsEnabled(state, view);
  const avatarHtml = avatarsOn ? gitGraphAvatarHtml(commit.authorEmail, gitGraphAvatarUrlFor(state, commit.authorEmail), { size: 18 }) : '';
  const showSignature = view && view.repoConfig && view.repoConfig.showSignatureStatus;
  const signatureHtml = showSignature ? gitGraphSignatureBadgeHtml(commit.signature) : '';
  const markdownOn = !state || state.markdownRendering !== false;
  const issueLinking = view && view.repoConfig && view.repoConfig.issueLinking;
  return `
    <div class="gg-detail-field"><span class="gg-detail-label">Commit:</span> <span class="mono">${escapeHtml(commit.hash)}</span></div>
    <div class="gg-detail-field"><span class="gg-detail-label">Subject:</span> ${gitGraphLinkifySubject(commit.subject || '', issueLinking)}</div>
    <div class="gg-detail-field"><span class="gg-detail-label">Parents:</span> ${parentsHtml}</div>
    <div class="gg-detail-field"><span class="gg-detail-label">Author:</span> ${avatarHtml}${escapeHtml(commit.authorName)} &lt;<a class="gg-link" href="mailto:${escapeAttr(commit.authorEmail)}">${escapeHtml(commit.authorEmail)}</a>&gt;</div>
    <div class="gg-detail-field"><span class="gg-detail-label">Date:</span> ${escapeHtml(authorDate)}${bothDates ? ` <span class="gg-detail-secondary">(committed ${escapeHtml(commitDate)})</span>` : ''}</div>
    <div class="gg-detail-field"><span class="gg-detail-label">Committer:</span> ${escapeHtml(commit.committerName)}${signatureHtml}</div>
    <div class="gg-detail-body">${gitGraphLinkifyBody(commit.body || '', markdownOn)}</div>`;
}

/**
 * Wraps every substring of `subject` that matches the repo's configured
 * Issue Regex in a clickable link to the built issue URL — the same
 * substitution gitGraphBuildIssueUrl (git-graph-menus.js) does for a whole
 * branch name, just applied in place at each match's own position instead of
 * requiring the whole string to match. Used everywhere a commit subject is
 * shown (the graph row and the Commit Details header), per Issue Linking's
 * own documented scope.
 */
function gitGraphLinkifySubject(subject, issueLinking) {
  const text = subject || '';
  if (!issueLinking || !issueLinking.regex || !issueLinking.url) return escapeHtml(text);
  let re;
  try { re = new RegExp(issueLinking.regex, 'g'); } catch { return escapeHtml(text); }
  let result = '';
  let lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex += 1; continue; } // never loop forever on a zero-width match
    const url = issueLinking.url.replace(/\$([1-8])/g, (_, n) => (m[Number(n)] != null ? m[Number(n)] : ''));
    result += escapeHtml(text.slice(lastIndex, m.index));
    result += `<a class="gg-link" data-gg-kind="link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(m[0])}</a>`;
    lastIndex = m.index + m[0].length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function gitGraphLinkifyBody(body, markdownEnabled) {
  let escaped = escapeHtml(body);
  if (markdownEnabled) escaped = gitGraphRenderMarkdownInline(escaped);
  return escaped
    .replace(/\n/g, '<br>')
    // Excludes '"'/"'" from the match itself (on top of the '<' escapeHtml
    // already turned into an entity): a commit body is attacker-controlled
    // text, and without this a quote character could close the href
    // attribute early and start a new, live one (e.g. an onmouseover=...)
    // right where the match ends. The matched text has already been through
    // escapeHtml above, so once quotes can't appear in it, it's already
    // fully safe to drop straight into this attribute.
    .replace(/https?:\/\/[^\s<>"']+/g, (url) => `<a class="gg-link" data-gg-kind="link" href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

// Reuses #98's tree builder (buildGitChangeTree/gitTreeRows from
// project-git-view.js) for the commit-details file tree rather than a
// second tree implementation.
function gitGraphFileListHtml(files, opts) {
  if (!files.length) return '<div class="gg-empty-row">No files changed.</div>';
  if (opts.fileViewType === 'list') {
    return `<div class="gg-file-flat-list">${files.map(f => gitGraphFileRowHtml(f, { ...opts, name: f.path })).join('')}</div>`;
  }
  const tree = buildGitChangeTree(files);
  const rows = gitTreeRows(tree, opts.collapsedFolders || new Set(), '');
  return `<div class="gg-file-tree">${rows.map(row => row.kind === 'folder'
    ? gitGraphFolderRowHtml(row)
    : gitGraphFileRowHtml(row.change, { ...opts, name: row.name, depth: row.depth })).join('')}</div>`;
}

function gitGraphFolderRowHtml(row) {
  return `
    <button type="button" class="gg-tree-folder" data-gg-folder-key="${escapeAttr(row.key)}" style="--depth:${row.depth}">
      <span class="gg-tree-folder-chevron">${gitGraphIcon(row.collapsed ? 'chevronRight' : 'chevronDown', 11)}</span>
      ${gitGraphIcon('folder', 12)}
      <span class="gg-tree-folder-name mono">${escapeHtml(row.name)}</span>
      ${row.count ? `<span class="gg-tree-folder-count">${row.count}</span>` : ''}
    </button>`;
}

/** `opts.codeReview` (`{key, reviewedPaths: Set}` or null/undefined) drives
 * the "still needs review" bold styling. Every file shows its A/M/D/R/U
 * letter, as in the Changes view. */
function gitGraphFileRowHtml(file, opts = {}) {
  const depth = opts.depth || 0;
  const codeReview = opts.codeReview;
  const reviewed = !!(codeReview && codeReview.reviewedPaths.has(file.path));
  const rowClass = (codeReview && !reviewed ? ' gg-file-unreviewed' : '') + (opts.openFilePath === file.path ? ' gg-file-row-open' : '');
  const eyeHtml = opts.lastViewedFilePath === file.path ? '<span class="gg-file-eye" title="Most recently viewed">◉</span>' : '';
  const glyph = gitGraphFileStatusGlyph(file.status);
  return `
    <div class="gg-file-row${rowClass}" data-gg-kind="file" data-gg-file-path="${escapeAttr(file.path)}" style="--depth:${depth}">
      <span class="gg-file-status gg-file-status-${escapeAttr(file.status)}">${escapeHtml(glyph)}</span>
      <span class="gg-file-name mono">${escapeHtml(opts.name || file.path)}</span>
      ${eyeHtml}
      ${gitGraphDiffStatHtml(file)}
    </div>`;
}

function gitGraphWireDetailsPanel(project, state, body, container) {
  const closeBtn = container.querySelector('#gg-details-close');
  if (closeBtn) closeBtn.onclick = () => gitGraphCloseDetails(project, state, body);
  container.querySelectorAll('[data-view]').forEach((btn) => {
    // Only for the record that is open: the next one opens in the default view again.
    btn.onclick = () => { state.fileViewType = btn.dataset.view; gitGraphRenderDetailsPanel(project, state, body); };
  });
  container.querySelectorAll('.gg-tree-folder').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.ggFolderKey;
      if (state.collapsedFolders.has(key)) state.collapsedFolders.delete(key); else state.collapsedFolders.add(key);
      gitGraphRenderDetailsPanel(project, state, body);
    };
  });
  gitGraphWireCodeReviewControls(project, state, body, container);
  const repo = gitGraphDetailsRepo(state);
  container.querySelectorAll('[data-gg-kind="file"]').forEach((row) => {
    row.onclick = () => gitGraphOpenFileDiff(project, state, body, repo, row.dataset.ggFilePath);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      gitGraphOpenContextMenu(project, state, body, row, { x: e.clientX, y: e.clientY });
    };
  });
  container.querySelectorAll('[data-gg-kind="link"][href]').forEach((link) => {
    link.oncontextmenu = (e) => {
      e.preventDefault();
      gitGraphOpenContextMenu(project, state, body, link, { x: e.clientX, y: e.clientY });
    };
  });
  container.querySelectorAll('[data-gg-kind="link"][data-gg-hash]').forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      // The record names its parents by plain hash: with several repositories shown, the row is of the record's own.
      const tag = gitGraphSplitKey(state.detailsData && (state.detailsData.hash || state.detailsData.fromHash)).tag;
      const key = tag ? gitGraphRepoKey(tag, link.dataset.ggHash) : link.dataset.ggHash;
      const target = state.rows.find(r => r.hash === key);
      if (target) { state.selectedHash = target.hash; gitGraphOpenDetails(project, state, body, target); }
    };
  });
  gitGraphWireOpenFile(project, state, body, container);
}

/** The open file's viewer back in its place, and its Expand, window and × buttons. */
function gitGraphWireOpenFile(project, state, body, container) {
  if (!gitGraphOpenFileFor(state)) { state.keptFileView = null; return; }
  gitGraphPlaceFileView(container, state);
  const expand = container.querySelector('#gg-file-expand');
  if (expand) expand.onclick = () => gitGraphExpandOpenFile(state);
  const windowBtn = container.querySelector('#gg-file-window');
  if (windowBtn) windowBtn.onclick = () => gitGraphOpenFileWindow(project, state);
  const close = container.querySelector('#gg-file-close');
  if (close) close.onclick = () => gitGraphCloseOpenFile(project, state, body);
}

function gitGraphCloseDetails(project, state, body) {
  state.detailsData = null;
  state.selectedHash = null;
  state.compareHash = null;
  state.codeReview = null;
  state.lastViewedFilePath = null;
  state.openFile = null;
  const dock = body.querySelector('#gg-details-docked');
  if (dock) dock.style.display = 'none';
  gitGraphPaint(project, state, body, { preserveScroll: true });
}

/** A file clicked in the record, or "View Diff" / "View Diff with Working File"
 * from its menu: its diff opens in the record, under the commit's text. */
function gitGraphOpenFileDiff(project, state, body, repo, filePath, opts = {}) {
  return gitGraphOpenFileIn(project, state, body, repo, filePath, opts.forceWorkingTree ? 'working' : 'diff');
}

/** "View File at this Revision" (file-menu item): the file as it is in the record's commit, in the same place. */
function gitGraphViewFileAtRevision(project, state, body, repo, file) {
  return gitGraphOpenFileIn(project, state, body, repo, file && file.path, 'revision');
}

// --- The file open in the record ---
//
// `state.openFile` belongs to the record it was opened from (`detailsKey`):
// opening another record, or closing this one, closes it. Its content is
// fetched once and kept on it (`result`), so Expand and drawing the panel
// again need no second fetch.

/**
 * The revisions the file is read at: `kind` 'diff' is the record's own
 * change, 'working' the record's side against the working file, 'revision'
 * the file as it is at the record's commit (`toRev` only). Uncommitted
 * Changes start from HEAD, as their list of files does. Null when there is
 * nothing to show ('revision' of the working tree).
 */
function gitGraphFileRevs(state, kind) {
  const data = state.detailsData || {};
  // git is asked with plain hashes and the HEAD of the record's own repository.
  const plain = gitGraphPlainHash;
  if (kind === 'revision') {
    const rev = data.mode === 'single' ? plain(data.hash) : plain(data.toHash);
    return rev && rev !== '#uncommitted' ? { fromRev: null, toRev: rev } : null;
  }
  const fromRev = data.mode === 'compare'
    ? (plain(data.fromHash) === '#uncommitted' ? null : plain(data.fromHash))
    : (data.kind === 'uncommitted' ? (gitGraphDetailsView(state).headHash || 'HEAD') : `${plain(data.hash)}^`);
  let toRev = null;
  if (kind !== 'working') {
    toRev = data.mode === 'compare'
      ? (plain(data.toHash) === '#uncommitted' ? null : plain(data.toHash))
      : (data.kind === 'uncommitted' ? null : plain(data.hash));
  }
  return { fromRev, toRev };
}

/** Opens `filePath` of the open record under the commit's text, as `kind` (gitGraphFileRevs). */
function gitGraphOpenFileIn(project, state, body, repo, filePath, kind = 'diff') {
  if (!repo || !filePath || !state.detailsData || state.detailsLoading) return null;
  const revs = gitGraphFileRevs(state, kind);
  if (!revs) return null;
  const listed = (state.detailsData.files || []).find(f => f.path === filePath) || {};
  const detailsKey = gitGraphDetailsKey(state);
  const file = {
    key: `${detailsKey}\n${kind}\n${filePath}`, detailsKey, kind, repoPath: repo.path,
    path: filePath, oldPath: listed.oldPath || null, status: listed.status || null,
    fromRev: revs.fromRev, toRev: revs.toRev,
    loading: true, result: null, error: null,
  };
  state.openFile = file;
  gitGraphNoteFileViewed(project, state, body, filePath);
  gitGraphRenderDetailsPanel(project, state, body);
  gitGraphFetchFileView(project.id, file).then((result) => {
    file.loading = false;
    if (result && result.ok) file.result = result;
    else file.error = (result && result.error) || 'Could not load the file.';
    if (state.openFile !== file || !body.isConnected) return;
    const host = body.querySelector('#gg-inline-diff-body');
    if (host) gitGraphMountFileView(host, file);
  });
  return file;
}

/** The content of `file`: both sides of its diff (a renamed file's old side under
 * its old path, gitGraphCompareFileDiff), or the file at its revision. */
function gitGraphFetchFileView(projectId, file) {
  if (file.kind === 'revision') return gitGraphCompareCall('getGitGraphFileAtRevision', projectId, file.repoPath, file.toRev, file.path);
  return gitGraphCompareFileDiff({ projectId, repoPath: file.repoPath }, file.fromRev, file.toRev, file.path, file.oldPath);
}

/** The viewer for `file` in `host`: its diff, or its content read-only. */
function gitGraphCreateFileViewer(host, file) {
  const result = file.result || {};
  if (file.kind === 'revision') {
    if (typeof createReadOnlyViewer === 'function') return createReadOnlyViewer(host, result.content || '', file.path);
    if (typeof createUnifiedMergeViewer === 'function') return createUnifiedMergeViewer(host, result.content || '', result.content || '', file.path, { readOnly: true });
    return null;
  }
  if (typeof createUnifiedMergeViewer === 'function') return createUnifiedMergeViewer(host, result.oldContent || '', result.newContent || '', file.path, { readOnly: true });
  return null;
}

/** `file` drawn into the panel's slot: loading, its error, or its viewer. */
function gitGraphMountFileView(host, file) {
  host.ggFileKey = file.key;
  host.ggMounted = false;
  if (file.loading) { host.innerHTML = '<div class="gg-loading"><span class="gg-loading-dot"></span>Loading…</div>'; return; }
  if (file.error) { host.innerHTML = `<div class="gg-details-diff-none">${escapeHtml(file.error)}</div>`; return; }
  host.innerHTML = '';
  gitGraphCreateFileViewer(host, file);
  host.ggMounted = true;
}

/** Before the panel is drawn again (a folder folded, Tree/List, the working
 * tree reloaded): the open file's viewer is taken out of `root`, to go back in
 * its place as it was, scrolled and folded, instead of being built again. */
function gitGraphKeepFileView(root, state) {
  if (state.keptFileView || !root || typeof root.querySelector !== 'function') return;
  const file = state.openFile;
  const host = file ? root.querySelector('#gg-inline-diff-body') : null;
  if (!host || !host.ggMounted || host.ggFileKey !== file.key) return;
  const scrolls = [...host.querySelectorAll('.cm-scroller')].map(el => [el, el.scrollTop, el.scrollLeft]);
  host.remove();
  state.keptFileView = { host, key: file.key, scrolls };
}

/** The open file in the panel just drawn: the viewer kept from before, or a new one. */
function gitGraphPlaceFileView(container, state) {
  const kept = state.keptFileView;
  state.keptFileView = null;
  const file = gitGraphOpenFileFor(state);
  const slot = file ? container.querySelector('#gg-inline-diff-body') : null;
  if (!slot) return;
  if (kept && kept.key === file.key && typeof slot.replaceWith === 'function') {
    slot.replaceWith(kept.host);
    for (const [el, top, left] of kept.scrolls) { el.scrollTop = top; el.scrollLeft = left; }
    return;
  }
  gitGraphMountFileView(slot, file);
}

/** Expand: the open file over the window, as a file opened before this panel did. */
function gitGraphExpandOpenFile(state) {
  const file = gitGraphOpenFileFor(state);
  if (!file || file.loading || file.error) return false;
  const host = gitGraphEnsureDiffHost();
  host.innerHTML = '';
  gitGraphCreateFileViewer(host, file);
  return true;
}

/** What a window of its own needs to show `file` (main.js openGitFileWindow): the
 * revisions it is read at, and the commit's short hash and title for its header. */
function gitGraphFileWindowSpec(state, file) {
  const data = state.detailsData || {};
  const key = data.mode === 'single' ? data.hash : data.toHash;
  const row = (state.rows || []).find(r => r.hash === key);
  const hash = gitGraphPlainHash(key);
  const uncommitted = hash === '#uncommitted';
  const label = uncommitted ? 'Uncommitted' : ((row && row.shortHash) || (data.commit && data.commit.shortHash) || String(hash || '').slice(0, 8));
  const subject = uncommitted ? 'Uncommitted Changes' : ((data.commit && data.commit.subject) || (row && row.subject) || '');
  return {
    repo: file.repoPath, path: file.path, oldPath: file.oldPath, status: file.status,
    kind: file.kind, fromRev: file.fromRev, toRev: file.toRev, label, subject,
  };
}

/** The open file in a window of its own, which can stay above the others (its pin). */
function gitGraphOpenFileWindow(project, state) {
  const file = gitGraphOpenFileFor(state);
  if (!file) return null;
  const spec = gitGraphFileWindowSpec(state, file);
  gitGraphApi('openGitFileWindow', project.id, file.repoPath, spec);
  return spec;
}

/** × on the open file: the record shows the commit's text alone again. */
function gitGraphCloseOpenFile(project, state, body) {
  state.openFile = null;
  state.keptFileView = null;
  gitGraphRenderDetailsPanel(project, state, body);
}

/** A file in a window of its own (main.js openGitFileWindow, then projects-view.js
 * with PROJECT_WINDOW.file): its commit and path on top, its diff filling the window. */
function gitGraphRenderFileWindow(host, projectId, spec) {
  const file = {
    key: 'window', kind: spec.kind || 'diff', repoPath: spec.repo, path: spec.path,
    oldPath: spec.oldPath || null, status: spec.status || null,
    fromRev: spec.fromRev || null, toRev: spec.toRev || null,
    loading: true, result: null, error: null,
  };
  const glyph = file.status ? gitGraphFileStatusGlyph(file.status) : '';
  const note = file.kind === 'revision' ? 'At this revision' : (file.kind === 'working' ? 'With the working file' : '');
  const renamed = file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ` : '';
  host.innerHTML = `
    <div class="gg-file-in-window">
      <div class="gg-details-diff-head gg-file-window-head">
        ${spec.label ? `<span class="mono gg-file-window-commit">${escapeHtml(spec.label)}</span>` : ''}
        ${spec.subject ? `<span class="gg-file-window-subject" title="${escapeAttr(spec.subject)}">${escapeHtml(spec.subject)}</span>` : ''}
        ${glyph ? `<span class="gg-file-status gg-file-status-${escapeAttr(file.status)}">${escapeHtml(glyph)}</span>` : ''}
        <span class="gg-details-diff-path mono" title="${escapeAttr(renamed + file.path)}">${escapeHtml(renamed + file.path)}</span>
        ${note ? `<span class="gg-details-diff-note">${note}</span>` : ''}
      </div>
      <div class="gg-inline-diff-body" id="gg-file-window-body"></div>
    </div>`;
  const slot = host.querySelector('#gg-file-window-body');
  gitGraphMountFileView(slot, file);
  return gitGraphFetchFileView(projectId, file).then((result) => {
    file.loading = false;
    if (result && result.ok) file.result = result;
    else file.error = (result && result.error) || 'Could not load the file.';
    if (slot.isConnected !== false) gitGraphMountFileView(slot, file);
    return file;
  });
}

/** Records the "eye" last-viewed marker and auto-un-bolds the file
 * if a Code Review is active on the open commit/comparison — shared
 * by every way a file's content can be viewed (diff, at-revision, or the
 * plain working-tree open). */
function gitGraphNoteFileViewed(project, state, body, filePath) {
  state.lastViewedFilePath = filePath;
  gitGraphMarkFileReviewedIfActive(project, state, body, filePath);
}

/** Returns the *content* element for the diff/file overlay — the close
 * button lives on its permanent sibling, so callers are free to reset this
 * div's innerHTML on every open without wiping the close affordance out. */
function gitGraphEnsureDiffHost() {
  let host = document.getElementById('gg-diff-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'gg-diff-host';
    host.className = 'gg-diff-host';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'gg-details-close';
    close.textContent = '×';
    close.onclick = () => gitGraphCloseDiffHost();
    const content = document.createElement('div');
    content.className = 'gg-diff-host-content';
    host.appendChild(close);
    host.appendChild(content);
    document.body.appendChild(host);
  }
  return host.querySelector('.gg-diff-host-content');
}

function gitGraphCloseDiffHost() {
  const host = document.getElementById('gg-diff-host');
  if (host) host.remove();
}

// --- Find widget ---

function gitGraphFindWidgetHtml(state) {
  if (!state.findOpen) return '';
  return `
    <div class="gg-find-widget">
      <input type="text" id="gg-find-input" placeholder="Find in loaded commits…" value="${escapeAttr(state.findQuery)}">
      <span class="gg-find-count">${state.findMatches.length ? `${state.findIndex + 1}/${state.findMatches.length}` : '0/0'}</span>
      <button type="button" id="gg-find-prev">‹</button>
      <button type="button" id="gg-find-next">›</button>
      <label class="gg-checkbox"><input type="checkbox" id="gg-find-case" ${state.findCaseSensitive ? 'checked' : ''}>Case</label>
      <label class="gg-checkbox"><input type="checkbox" id="gg-find-open-details" ${state.findAlsoOpenDetails ? 'checked' : ''}>Also open details</label>
      <button type="button" id="gg-find-close">×</button>
    </div>`;
}

function gitGraphWireFindWidget(project, state, body) {
  const input = body.querySelector('#gg-find-input');
  if (!input) return;
  const run = () => {
    state.findMatches = gitGraphFindMatches(state.rows, input.value, state.findCaseSensitive);
    state.findIndex = state.findMatches.length ? 0 : -1;
    state.findQuery = input.value;
    gitGraphApplyFindHighlight(project, state, body);
  };
  input.oninput = run;
  input.focus();
  body.querySelector('#gg-find-case').onchange = (e) => { state.findCaseSensitive = e.target.checked; run(); };
  body.querySelector('#gg-find-open-details').onchange = (e) => { state.findAlsoOpenDetails = e.target.checked; };
  body.querySelector('#gg-find-next').onclick = () => gitGraphFindStep(project, state, body, 1);
  body.querySelector('#gg-find-prev').onclick = () => gitGraphFindStep(project, state, body, -1);
  body.querySelector('#gg-find-close').onclick = () => { state.findOpen = false; gitGraphPaint(project, state, body); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gitGraphFindStep(project, state, body, e.shiftKey ? -1 : 1); }
  };
}

function gitGraphFindStep(project, state, body, dir) {
  if (!state.findMatches.length) return;
  state.findIndex = (state.findIndex + dir + state.findMatches.length) % state.findMatches.length;
  gitGraphApplyFindHighlight(project, state, body);
}

function gitGraphApplyFindHighlight(project, state, body) {
  const countEl = body.querySelector('.gg-find-count');
  if (countEl) countEl.textContent = state.findMatches.length ? `${state.findIndex + 1}/${state.findMatches.length}` : '0/0';
  body.querySelectorAll('.gg-tbody [data-gg-kind]').forEach(el => el.classList.remove('gg-find-match', 'gg-find-current'));
  state.findMatches.forEach((rowIndex, i) => {
    const el = body.querySelector(`.gg-tbody [data-row-index="${rowIndex}"]`);
    if (!el) return;
    el.classList.add('gg-find-match');
    if (i === state.findIndex) {
      el.classList.add('gg-find-current');
      el.scrollIntoView({ block: 'nearest' });
      if (state.findAlsoOpenDetails) {
        const row = state.rows[rowIndex];
        state.selectedHash = row.hash;
        gitGraphOpenDetails(project, state, body, row);
      }
    }
  });
}

// --- Repository Settings drawer — full drawer content/wiring lives in
// git-graph-settings.js's gitGraphRenderSettingsDrawer; this file only owns
// the open/close toggle, which the drawer's own close button calls back into. ---

function gitGraphToggleSettings(project, state, body) {
  state.settingsOpen = !state.settingsOpen;
  if (!state.settingsOpen) { body.querySelector('#gg-settings-drawer').style.display = 'none'; return; }
  gitGraphRenderSettingsDrawer(project, state, body);
}

// --- Keyboard shortcuts ---
//
// Deliberately avoids Cmd/Ctrl+Up/Down (already the app's shortcut for
// switching sessions — handleSessionNavKey in app.js) and Cmd/Ctrl+R (taken
// by the app for reload, so the Refresh button carries no shortcut hint):
// every arrow-key branch below requires the *absence* of a modifier, so a
// Cmd/Ctrl+Arrow press is left untouched for the app's own handler and never
// double-fires. Plain Up/Down moves between commits when the details panel
// is open (Shift+Up/Down crosses to the other side of a fork/merge); with it
// closed, they scroll the table instead.

function gitGraphBindKeyboard(project, state, body) {
  if (state.keydownHandler) document.removeEventListener('keydown', state.keydownHandler);
  const handler = (e) => {
    if (!gitGraphStillActive(project) || !body.isConnected) return;
    // The Compare popup over the History keeps the keys to itself.
    if (document.getElementById('gg-cmp-overlay')) return;
    if (gitGraphIsEditableTarget(e.target) && e.key !== 'Escape') return;
    // Keys in the open file's viewer are the viewer's: its arrows, its search.
    // Esc still closes the file expanded over the window.
    // The file expanded over the window (#gg-diff-host) and any editor count as the viewer too.
    const inViewer = e.target && typeof e.target.closest === 'function' && e.target.closest('.gg-inline-diff-body, #gg-diff-host, .cm-editor');
    if (inViewer && !(e.key === 'Escape' && document.getElementById('gg-diff-host'))) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (document.getElementById('gg-diff-host')) { gitGraphCloseDiffHost(); e.preventDefault(); return; }
      const closed = gitGraphHandleEscapePriority({
        closeDialog: () => false, // real dialogs manage their own Escape handler
        closeMenu: () => {
          if (state.branchesMenuOpen) { gitGraphCloseBranchesMenu(state); gitGraphPaint(project, state, body); return true; }
          if (typeof openCtxMenu !== 'undefined' && openCtxMenu && typeof closeContextMenu === 'function') { closeContextMenu(); return true; }
          return false;
        },
        closeDetails: () => { if (state.detailsData) { gitGraphCloseDetails(project, state, body); return true; } return false; },
        closeFind: () => { if (state.findOpen) { state.findOpen = false; gitGraphPaint(project, state, body); return true; } return false; },
      });
      if (closed) e.preventDefault();
      return;
    }
    if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); state.findOpen = true; gitGraphPaint(project, state, body); }
    else if (mod && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); gitGraphScrollToHead(project, state, body); }
    else if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); gitGraphScrollToStash(project, state, body, 1); }
    else if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); gitGraphScrollToStash(project, state, body, -1); }
    else if (!mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const dir = e.key === 'ArrowDown' ? 1 : -1; // Down toward parents/older, Up toward children/newer
      if (!state.detailsData) {
        const wrap = body.querySelector('.gg-table-wrap');
        if (wrap) wrap.scrollTop += dir * GG_ROW_HEIGHT;
        return;
      }
      e.preventDefault();
      gitGraphMoveDetailsFocus(project, state, body, dir, e.shiftKey ? 'alternate' : 'sameBranch');
    }
  };
  state.keydownHandler = handler;
  document.addEventListener('keydown', handler);
}

/**
 * Same-branch parent/child of `hash`, via the loaded graph's own layout
 * edges rather than a fresh git query — `dir > 0` walks toward the parent
 * (the row's own 'same-lane' outgoing edge), `dir < 0` toward the child (an
 * earlier row whose 'same-lane' edge points back at this hash). Returns null
 * at a fork/merge with no plain same-lane edge in that direction, or when
 * `hash` isn't in the currently loaded window.
 */
function gitGraphSameBranchNeighbor(state, hash, dir) {
  const index = state.rows.findIndex(r => r.hash === hash);
  if (index < 0) return null;
  if (dir > 0) {
    const edge = (state.layout[index] && state.layout[index].edges || []).find(e => e.style === 'same-lane');
    return edge ? edge.parentHash : null;
  }
  for (let i = index - 1; i >= 0; i--) {
    const hasEdge = (state.layout[i] && state.layout[i].edges || []).some(e => e.style === 'same-lane' && e.parentHash === hash);
    if (hasEdge) return state.rows[i].hash;
  }
  return null;
}

/**
 * The *other* branch at a fork/merge touching `hash` — a 'branch-out' or
 * 'merge-in' edge instead of the plain 'same-lane' one gitGraphSameBranchNeighbor
 * follows. Same direction convention: `dir > 0` toward a parent, `dir < 0`
 * toward a child.
 */
function gitGraphAlternateBranchNeighbor(state, hash, dir) {
  const index = state.rows.findIndex(r => r.hash === hash);
  if (index < 0) return null;
  if (dir > 0) {
    const edge = (state.layout[index] && state.layout[index].edges || []).find(e => e.style !== 'same-lane');
    return edge ? edge.parentHash : null;
  }
  for (let i = index - 1; i >= 0; i--) {
    const hasEdge = (state.layout[i] && state.layout[i].edges || []).some(e => e.style !== 'same-lane' && e.parentHash === hash);
    if (hasEdge) return state.rows[i].hash;
  }
  return null;
}

/**
 * Moves the Commit Details/Comparison focus in response to an arrow key.
 * `sameBranch` follows gitGraphSameBranchNeighbor; `alternate` follows
 * gitGraphAlternateBranchNeighbor (the fork/merge's other side). Silently
 * does nothing when there's no current row or no neighbor in that direction
 * — never throws, so a keystroke at either end of the graph is a no-op
 * rather than an error.
 */
function gitGraphMoveDetailsFocus(project, state, body, dir, mode) {
  if (!state.selectedHash) return;
  const targetHash = mode === 'alternate'
    ? gitGraphAlternateBranchNeighbor(state, state.selectedHash, dir)
    : gitGraphSameBranchNeighbor(state, state.selectedHash, dir);
  if (!targetHash) return;
  const row = state.rows.find(r => r.hash === targetHash);
  if (!row) return;
  state.selectedHash = targetHash;
  state.compareHash = null;
  gitGraphOpenDetails(project, state, body, row);
}

function gitGraphScrollToHead(project, state, body) {
  const headRow = state.rows.findIndex(r => r.isHead);
  if (headRow < 0) return;
  const el = body.querySelector(`.gg-tbody [data-row-index="${headRow}"]`);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('gg-flash'); setTimeout(() => el.classList.remove('gg-flash'), 900); }
}

function gitGraphScrollToStash(project, state, body, dir) {
  const stashRows = state.rows.map((r, i) => (r.kind === 'stash' ? i : -1)).filter(i => i >= 0);
  if (!stashRows.length) return;
  const current = state.rows.findIndex(r => r.hash === state.selectedHash);
  let next = dir > 0 ? stashRows.find(i => i > current) : [...stashRows].reverse().find(i => i < current);
  if (next === undefined) next = dir > 0 ? stashRows[0] : stashRows[stashRows.length - 1];
  const el = body.querySelector(`.gg-tbody [data-row-index="${next}"]`);
  if (el) el.scrollIntoView({ block: 'center' });
}

// --- Auto-refresh / progress streaming ---
//
// Bound exactly once at module load (not per render, not per project): the
// #git-workspace-view element this view paints into is recreated whenever the
// Git subview or the project tab changes, so a handler that closed over a particular `body`/
// `project` would silently stop firing (or keep painting into a detached
// node) the moment the user left and came back to this tab. Resolving the
// active project/state/body fresh, at event time, means one listener stays
// correct across the whole session.

let gitGraphWatcherBound = false;

function gitGraphEnsureWatcherBound() {
  if (gitGraphWatcherBound) return;
  gitGraphWatcherBound = true;
  if (typeof window === 'undefined' || !window.api) return;

  if (typeof window.api.onGitGraphRepoChanged === 'function') {
    window.api.onGitGraphRepoChanged((folderPath, info) => {
      const project = typeof selectedProject === 'function' ? selectedProject() : null;
      if (!project || !gitGraphStillActive(project)) return;
      const state = gitGraphTabState.get(project.id);
      // Any repository shown counts; the others are left as they are.
      if (!state || !gitGraphShownRepos(state).some(r => r.path === folderPath)) return;
      const body = typeof document !== 'undefined' ? document.getElementById('git-workspace-view') : null;
      if (!body) return;
      // Only the working tree moved: refresh the Uncommitted Changes row in
      // place, without scrolling back to the top or dropping loaded commits.
      const keepScroll = !!(info && info.workingTree);
      if (gitGraphIsMulti(state)) gitGraphReloadSlice(project, state, body, folderPath, { keepScroll });
      else gitGraphLoadGraph(project, state, body, { reset: true, keepScroll });
    });
  }

  // Streams the fetch/push/pull progress text into the already-rendered
  // progress bar. Updates the existing node's textContent directly rather
  // than a full gitGraphPaint() re-render, since git can emit several
  // \r-terminated progress lines per second and a full innerHTML rebuild on
  // every one would be wasteful and would fight the user's scroll position.
  if (typeof window.api.onGitGraphActionProgress === 'function') {
    window.api.onGitGraphActionProgress(({ folderPath, actionId, text } = {}) => {
      const project = typeof selectedProject === 'function' ? selectedProject() : null;
      if (!project || !gitGraphStillActive(project)) return;
      const state = gitGraphTabState.get(project.id);
      if (!state || !state.progress || folderPath !== (state.progress.folderPath || state.selectedRepo) || actionId !== state.progress.actionId) return;
      state.progress.text = text;
      const body = typeof document !== 'undefined' ? document.getElementById('git-workspace-view') : null;
      const el = body && body.querySelector('.gg-progress-text');
      if (el) el.textContent = text;
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    gitGraphState, gitGraphFindMatches, gitGraphHandleEscapePriority, gitGraphReadTargetData,
    gitGraphDispatchContextMenu, gitGraphHandleDoubleClick, GG_MENU_BUILDERS,
    gitGraphComputeChildren, gitGraphAllBranchKeys, gitGraphToggleBranchKey, gitGraphDefaultRemoteName,
    gitGraphRemoteBranchesByLocalName, gitGraphBuildFileCtx, gitGraphPopulateTargetField,
    gitGraphBuildMenuCtx, gitGraphOpenContextMenu, gitGraphLoadGraph, gitGraphLoadRepositories,
    gitGraphPaint, gitGraphApi, renderProjectGitGraphTab,
    gitGraphAvatarsEnabled, gitGraphAvatarUrlFor, gitGraphQueueAvatarFetch,
    gitGraphSingleCommitHeaderHtml, gitGraphLinkifyBody, gitGraphLinkifySubject, gitGraphFileRowHtml, gitGraphFileListHtml,
    gitGraphFolderRowHtml, gitGraphOpenFileDiff, gitGraphViewFileAtRevision, gitGraphRunNetworkAction,
    gitGraphOpenDetails, gitGraphOpenComparison, gitGraphCloseDetails, gitGraphNoteFileViewed,
    gitGraphMaybeAutoCenterDetails, gitGraphDetailsBodyHtml, gitGraphRowsHtml, gitGraphIsAncestor, gitGraphHandleRowClick, gitGraphBindKeyboard,
    gitGraphSameBranchNeighbor, gitGraphAlternateBranchNeighbor, gitGraphMoveDetailsFocus,
    gitGraphSameStringSet, gitGraphRepoList, gitGraphEnsureWatcherBound,
    gitGraphCompareBase, gitGraphCompareWithSelected, gitGraphToggleChecked, gitGraphCompareSpec, gitGraphOpenCompare,
    gitGraphRowHtml, gitGraphHeaderHtml, gitGraphControlBarHtml, gitGraphInSelectCell, gitGraphSelectionMenuItems, gitGraphSetSelecting,
    gitGraphInlineScrolls, gitGraphRestoreInlineScrolls, gitGraphFitDetailsHeight,
    gitGraphIsOpenRecord, gitGraphOpenFileFor, gitGraphOpenFilePaneHtml, gitGraphFileRevs, gitGraphOpenFileIn,
    gitGraphKeepFileView, gitGraphPlaceFileView, gitGraphExpandOpenFile, gitGraphFileWindowSpec, gitGraphOpenFileWindow,
    gitGraphCloseOpenFile, gitGraphRenderFileWindow,
    gitGraphSelection, gitGraphShownRepos, gitGraphIsMulti, gitGraphSelectionKey, gitGraphRepoTag, gitGraphRepoByTag,
    gitGraphRowRepo, gitGraphRowView, gitGraphViewByPath, gitGraphDetailsRepo, gitGraphDetailsRepoPath, gitGraphDetailsView,
    gitGraphMixedRepos, gitGraphNewSlice, gitGraphSyncSlices, gitGraphAdoptPrimary, gitGraphMirrorPrimary, gitGraphCopySettings,
    gitGraphMultiRows, gitGraphLoadMultiGraph, gitGraphLoadMoreMulti, gitGraphReloadSlice, gitGraphApplySliceResult,
    gitGraphSliceErrorsHtml, gitGraphHistoryTabsHtml, gitGraphChangeSelection, gitGraphClearForSelection, gitGraphWireRepoPicker,
    gitGraphBranchesLabel, gitGraphHeadName, gitGraphHeadBranchesHtml, gitGraphBranchesSections, gitGraphBranchesSectionHtml,
    gitGraphOpenBranchesMenu, gitGraphCommitSelections, gitGraphRepoMeta, gitGraphRepoCellHtml, gitGraphTargetRepo,
    gitGraphFocusPending, gitGraphRepoPickerHtml, gitGraphRecomputeLayout, gitGraphSaveUiPrefs,
  };
}
