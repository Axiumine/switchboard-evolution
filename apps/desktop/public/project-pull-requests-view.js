// The Git tab's Pull Requests view for a project: the pull requests of each of
// the project's repositories on GitHub, one tab per repository as in History.
// Every open pull request is listed, drafts too; closed and merged ones join
// the list 10 at a time when the filter asks for them. A row opens on its
// changed files and their diffs. Merge sits on the row, and its "…" menu has
// Convert to draft (or Ready for review) and Close; each of them asks first.
// gh runs in main (pull-requests.js); this file paints and asks.

const projectPullRequestsTabState = new Map();

// The filter's choices, in the order the label lists them.
const PR_FILTERS = [
  ['open', 'Open'],
  ['draft', 'Draft'],
  ['closed', 'Closed'],
  ['merged', 'Merged'],
];
const PR_DEFAULT_FILTER = ['open', 'draft'];
const PR_PAGE_SIZE = 10;
// Diff lines shown open at once when a pull request is opened; the files after
// that start closed, one click away.
const PR_DIFF_LINE_BUDGET = 1500;
// Showing the view again, or the window getting the focus back, reads the list
// again once it is older than this.
const PR_STALE_MS = 60_000;
const PR_METHOD_LABELS = { merge: 'Create a merge commit', squash: 'Squash and merge', rebase: 'Rebase and merge' };
const PR_STATE_LABELS = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' };

function prSvg(paths) {
  return (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// Lucide's pull request glyphs, one per state, and the filter's.
const PR_ICONS = {
  open: prSvg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>'),
  draft: prSvg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6V5"/><path d="M18 11v-1"/><path d="M6 9v12"/>'),
  closed: prSvg('<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>'),
  merged: prSvg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'),
  filter: prSvg('<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>'),
};

// One sequence for every request this view makes, so an answer that arrives
// after a newer request (or after the remote or the filter changed) is dropped.
let prSeq = 0;

function prTabState(projectId) {
  if (!projectPullRequestsTabState.has(projectId)) {
    projectPullRequestsTabState.set(projectId, {
      repositories: null,
      selectedRepo: null,
      // The filter's choice, kept while the app runs (not saved): every start
      // shows the open pull requests, drafts included.
      filter: [...PR_DEFAULT_FILTER],
      repos: new Map(), // repository path → its pull requests (prRepoData)
      notice: null,
      dialogOpen: false,
    });
  }
  return projectPullRequestsTabState.get(projectId);
}

function prEmptyPage(key = '') {
  return { key, items: [], endCursor: null, hasNextPage: false, totalCount: 0, loaded: false, loading: false, error: null, request: 0 };
}

function prRepoData(remote = null) {
  return {
    remote,           // the remote asked for; null lets main choose
    remotes: [],      // the repository's GitHub remotes, for the Remote combo
    open: null,       // { repo, items, totalCount, truncated } once read
    error: null,
    errorCode: null,
    loading: false,
    loadedAt: 0,
    request: 0,
    page: prEmptyPage(),
    expanded: new Set(),  // pull request numbers shown open
    files: new Map(),     // `${number}@${headOid}` → { loading } | { files, truncated } | { error }
    openFiles: new Map(), // the same key → Set of file paths shown open
  };
}

function prRepoState(projectId, state, path) {
  if (!state.repos.has(path)) state.repos.set(path, prRepoData(prSavedRemote(projectId, path)));
  return state.repos.get(path);
}

// --- The remote chosen per repository, kept in localStorage ---

function prRemotesKey(projectId) {
  return `pullRequests.remotes.${projectId}`;
}

function prSavedRemote(projectId, path) {
  try {
    const saved = JSON.parse(localStorage.getItem(prRemotesKey(projectId)) || '{}');
    return typeof saved[path] === 'string' ? saved[path] : null;
  } catch { return null; }
}

function prSaveRemote(projectId, path, remote) {
  try {
    const saved = JSON.parse(localStorage.getItem(prRemotesKey(projectId)) || '{}');
    saved[path] = remote;
    localStorage.setItem(prRemotesKey(projectId), JSON.stringify(saved));
  } catch {}
}

/** Call a preload method; a missing one or a throw comes back as { error }. */
async function prApi(name, ...args) {
  const fn = typeof window !== 'undefined' ? window.api?.[name] : null;
  if (typeof fn !== 'function') return { error: 'This version of Switchboard cannot do that.' };
  try {
    return (await fn(...args)) || { error: 'No answer from Switchboard.' };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

/** escapeHtml leaves quotes alone; attribute values need them escaped too. */
function prAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prPlural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// --- What a pull request is, and what may be done with it ---

/** open | draft | closed | merged */
function prStatus(pr) {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  return pr.isDraft ? 'draft' : 'open';
}

function prVisible(pr, filter) {
  return (filter || []).includes(prStatus(pr));
}

/** The states that come in pages, for the filter: closed and/or merged. */
function prPageStates(filter) {
  const states = [];
  if ((filter || []).includes('closed')) states.push('CLOSED');
  if ((filter || []).includes('merged')) states.push('MERGED');
  return states;
}

/** All open ones and the pages read so far, as the filter shows them: newest first. */
function prMergeLists(openItems, pageItems, filter) {
  const byNumber = new Map();
  for (const pr of [...(openItems || []), ...(pageItems || [])]) {
    if (pr && !byNumber.has(pr.number)) byNumber.set(pr.number, pr);
  }
  return [...byNumber.values()]
    .filter(pr => prVisible(pr, filter))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.number - a.number);
}

function prFilterLabel(filter) {
  const chosen = PR_FILTERS.filter(([key]) => (filter || []).includes(key));
  if (chosen.length === PR_FILTERS.length) return 'All';
  return chosen.map(([, label]) => label).join(', ');
}

function prIsDefaultFilter(filter) {
  return (filter || []).length === PR_DEFAULT_FILTER.length && PR_DEFAULT_FILTER.every(key => filter.includes(key));
}

/** The filter with `key` turned on or off; the last choice left stays on. */
function prToggleFilter(filter, key) {
  if (!PR_FILTERS.some(([k]) => k === key)) return filter;
  const on = filter.includes(key);
  if (on && filter.length === 1) return filter;
  const next = on ? filter.filter(k => k !== key) : [...filter, key];
  return PR_FILTERS.map(([k]) => k).filter(k => next.includes(k));
}

function prWordList(words) {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : (words[0] || '');
}

function prEmptyText(filter) {
  return `No ${prWordList(PR_FILTERS.filter(([key]) => (filter || []).includes(key)).map(([, label]) => label.toLowerCase()))} pull requests`;
}

/** "closed", "merged" or "closed and merged", for the pages' footer. */
function prPagedWords(states) {
  return (states || []).map(s => s.toLowerCase()).join(' and ');
}

/** The author, and anyone who may write to the repository, may change a pull request. */
function prCanEdit(pr, repo) {
  return !!(repo && repo.canWrite) || !!pr.viewerDidAuthor;
}

/** Why Merge is off for this pull request, or null when it may be merged. */
function prMergeBlock(pr, repo) {
  if (pr.state === 'OPEN' && pr.isDraft) return 'A draft cannot be merged. Mark it ready for review first.';
  if (pr.state !== 'OPEN') return 'Only an open pull request can be merged.';
  if (!repo || !repo.canWrite) return 'Your GitHub account cannot merge in this repository.';
  if (!(repo.mergeMethods || []).length) return 'The repository allows no merge method.';
  if (pr.mergeable === 'CONFLICTING') return `It has conflicts with ${pr.base}. Resolve them first.`;
  return null;
}

/** The row's "…" menu: Convert to draft or Ready for review, then Close. Closed and merged ones have none. */
function prRowMenuItems(pr, repo, actions = {}) {
  if (pr.state !== 'OPEN') return [];
  const disabled = !prCanEdit(pr, repo);
  const items = [];
  if (pr.isDraft) items.push({ label: 'Ready for review…', icon: PR_ICONS.open(13), disabled, onClick: () => actions.ready?.() });
  else items.push({ label: 'Convert to draft…', icon: PR_ICONS.draft(13), disabled, onClick: () => actions.draft?.() });
  items.push({ sep: true });
  items.push({ label: 'Close pull request…', icon: PR_ICONS.closed(13), danger: true, disabled, onClick: () => actions.close?.() });
  return items;
}

/** The files opened at first: in order, while their diffs together stay within the budget. */
function prFileBudget(files, budget = PR_DIFF_LINE_BUDGET) {
  const open = new Set();
  let lines = 0;
  for (const file of files || []) {
    if (!file.patch) continue;
    const count = file.patch.split('\n').length;
    if (lines + count > budget) break;
    lines += count;
    open.add(file.path);
  }
  return open;
}

function prFilesKey(pr) {
  return `${pr.number}@${pr.headOid || ''}`;
}

// --- Rows ---

function prRelative(iso, now = new Date()) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  if (typeof gitGraphFormatRelative === 'function') return gitGraphFormatRelative(date, now);
  return date.toISOString().slice(0, 10);
}

function prWhenText(pr, now) {
  const status = prStatus(pr);
  if (status === 'merged') return `merged ${prRelative(pr.mergedAt || pr.closedAt, now)}`;
  if (status === 'closed') return `closed ${prRelative(pr.closedAt, now)}`;
  return `opened ${prRelative(pr.createdAt, now)}`;
}

function prBadgesHtml(pr) {
  const badges = [];
  if (prStatus(pr) === 'draft') badges.push(['draft', 'Draft']);
  if (pr.state === 'OPEN') {
    if (pr.mergeable === 'CONFLICTING') badges.push(['conflict', 'Conflicts']);
    if (pr.reviewDecision === 'APPROVED') badges.push(['approved', 'Approved']);
    else if (pr.reviewDecision === 'CHANGES_REQUESTED') badges.push(['changes', 'Changes requested']);
    if (pr.checks === 'SUCCESS') badges.push(['checks-ok', 'Checks passed']);
    else if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') badges.push(['checks-fail', 'Checks failed']);
    else if (pr.checks === 'PENDING' || pr.checks === 'EXPECTED') badges.push(['checks-wait', 'Checks running']);
  }
  return badges.map(([kind, text]) => `<span class="pr-badge pr-badge--${kind}">${escapeHtml(text)}</span>`).join('');
}

function prRowHtml(pr, { expanded = false, repo = null, now = new Date() } = {}) {
  const status = prStatus(pr);
  const block = prMergeBlock(pr, repo);
  const branches = `${pr.head} → ${pr.base}`;
  // A disabled button shows no tooltip of its own: the reason sits on its wrapper.
  const actions = pr.state === 'OPEN' ? `
          <span class="pr-merge-wrap"${block ? ` title="${prAttr(block)}"` : ''}><button type="button" class="ws-btn ws-btn--sm ws-btn--primary pr-merge-btn" data-act="merge"${block ? ' disabled' : ''}>${PR_ICONS.merged(12)}<span>Merge</span></button></span>
          <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="more" title="More actions" aria-label="More actions for #${pr.number}">${PICONS.dots(13)}</button>` : '';
  return `
    <div class="pr-item${expanded ? ' open' : ''}" data-pr="${pr.number}">
      <div class="pr-row" data-act="toggle" role="button" tabindex="0" aria-expanded="${expanded}">
        <span class="pr-chevron">${PICONS.chevronRight(10)}</span>
        <span class="pr-state pr-state--${status}" title="${PR_STATE_LABELS[status]}">${PR_ICONS[status](15)}</span>
        <div class="pr-main">
          <div class="pr-line"><span class="pr-title">${escapeHtml(pr.title)}</span>${prBadgesHtml(pr)}</div>
          <div class="pr-meta"><span class="pr-number">#${pr.number}</span><span>${escapeHtml(prWhenText(pr, now))} by ${escapeHtml(pr.author)}</span><span class="pr-branches mono" title="${prAttr(branches)}">${escapeHtml(branches)}</span><span class="pr-stats mono"><span class="pr-add">+${pr.additions || 0}</span> <span class="pr-del">−${pr.deletions || 0}</span></span><span>${prPlural(pr.changedFiles || 0, 'file')}</span></div>
        </div>
        <div class="pr-actions">${actions}</div>
      </div>
      <div class="pr-detail" data-detail="${pr.number}"${expanded ? '' : ' hidden'}></div>
    </div>`;
}

function prFooterHtml(data, filter) {
  const states = prPageStates(filter);
  if (!states.length) return '';
  const page = data.page;
  const words = prPagedWords(states);
  if (page.error) {
    return `<div class="pr-footer is-error"><span>${escapeHtml(page.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="page-retry">Retry</button></div>`;
  }
  if (!page.loaded) return `<div class="pr-footer"><span class="git-loading-dot"></span><span>Reading ${escapeHtml(words)} pull requests…</span></div>`;
  const shown = `${page.items.length} of ${page.totalCount} ${words} shown`;
  if (!page.hasNextPage) return page.totalCount ? `<div class="pr-footer"><span>${escapeHtml(shown)}</span></div>` : '';
  return `
    <div class="pr-footer">
      <span>${escapeHtml(shown)}</span>
      <button type="button" class="ws-btn ws-btn--sm pr-more-btn" data-act="page-more"${page.loading ? ' disabled' : ''}>${page.loading ? 'Loading…' : `Load ${PR_PAGE_SIZE} more`}</button>
    </div>`;
}

/** The list for one repository's data and the filter: rows, an empty line, the pages' footer. */
function prListHtml(data, filter, now = new Date()) {
  const items = prMergeLists(data.open?.items, data.page.items, filter);
  const repo = data.open?.repo || null;
  const truncated = data.open?.truncated ? '<div class="pr-footer">Only the newest 1000 open pull requests are listed.</div>' : '';
  const waitingForPage = prPageStates(filter).length && !data.page.loaded;
  const rows = items.length
    ? `<div class="pr-rows">${items.map(pr => prRowHtml(pr, { expanded: data.expanded.has(pr.number), repo, now })).join('')}</div>`
    : (waitingForPage ? '' : `<div class="git-empty-state"><div class="git-empty-title">${escapeHtml(prEmptyText(filter))}</div></div>`);
  return `${rows}${truncated}${prFooterHtml(data, filter)}`;
}

// --- Files and diffs ---

const PR_STATUS_LETTERS = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

function prPatchHtml(file) {
  if (file.patch) {
    const lines = typeof gitDiffLines === 'function' ? gitDiffLines(file.patch) : escapeHtml(file.patch);
    return `<pre class="git-diff">${lines}</pre>`;
  }
  let text = 'A binary file, or a diff GitHub does not show.';
  if (file.tooLarge) text = 'This pull request\'s diffs are too large to show them all here.';
  else if (file.status === 'renamed' && !file.insertions && !file.deletions) text = 'Renamed, nothing else changed.';
  return `<div class="pr-file-note">${escapeHtml(text)}</div>`;
}

function prFilesHtml(entry, openPaths = new Set()) {
  if (!entry || entry.loading) return '<div class="pr-files-empty"><span class="git-loading-dot"></span>Reading the changed files…</div>';
  if (entry.error) {
    return `<div class="pr-files-empty is-error"><span>${escapeHtml(entry.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="files-retry">Retry</button></div>`;
  }
  const files = entry.files || [];
  if (!files.length) return '<div class="pr-files-empty">No files changed.</div>';
  const insertions = files.reduce((n, f) => n + (f.insertions || 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions || 0), 0);
  const rows = files.map((file, index) => {
    const open = openPaths.has(file.path);
    const name = pathBasename(file.path) || file.path;
    const slash = file.path.lastIndexOf('/');
    const dir = slash > 0 ? file.path.slice(0, slash) : '';
    const icon = typeof fileIconHtml === 'function' ? fileIconHtml(name) : '';
    const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    return `
      <button type="button" class="pr-file${open ? ' open' : ''}" data-file="${index}" aria-expanded="${open}" title="${prAttr(title)}">
        <span class="pr-chevron">${PICONS.chevronRight(10)}</span>
        <span class="git-file-code ${prAttr(file.status)}">${PR_STATUS_LETTERS[file.status] || 'M'}</span>
        ${icon}
        <span class="pr-file-name mono">${escapeHtml(name)}</span>
        <span class="pr-file-dir">${escapeHtml(dir)}${file.oldPath ? ` <span class="pr-file-from">from ${escapeHtml(file.oldPath)}</span>` : ''}</span>
        <span class="pr-stats mono"><span class="pr-add">+${file.insertions || 0}</span> <span class="pr-del">−${file.deletions || 0}</span></span>
      </button>
      <div class="pr-file-diff" data-diff="${index}"${open ? '' : ' hidden'}>${open ? prPatchHtml(file) : ''}</div>`;
  }).join('');
  return `
    <div class="pr-files-head">
      <span>${prPlural(files.length, 'file')} changed</span>
      <span class="pr-stats mono"><span class="pr-add">+${insertions}</span> <span class="pr-del">−${deletions}</span></span>
      ${entry.truncated ? '<span class="pr-files-note">GitHub lists the first 3000 files.</span>' : ''}
      <span class="pr-files-tools">
        <button type="button" class="ws-ghost ws-ghost--sm" data-act="files-open-all">Open all</button>
        <button type="button" class="ws-ghost ws-ghost--sm" data-act="files-close-all">Close all</button>
      </span>
    </div>
    <div class="pr-files">${rows}</div>`;
}

// --- Dialogs' bodies ---

function prDialogHeadHtml(pr) {
  const status = prStatus(pr);
  return `
    <div class="pr-dialog-pr">
      <span class="pr-state pr-state--${status}">${PR_ICONS[status](15)}</span>
      <span class="pr-dialog-title">${escapeHtml(pr.title)}</span>
      <span class="pr-number">#${pr.number}</span>
    </div>
    <div class="pr-dialog-branches mono">${escapeHtml(`${pr.head} → ${pr.base}`)}</div>`;
}

const PR_ACTION_COPY = {
  draft: {
    title: 'Convert to draft',
    primary: 'Convert to draft',
    text: 'A draft cannot be merged, and reviewers are not asked to review it. You can mark it ready for review again at any time.',
  },
  ready: {
    title: 'Ready for review',
    primary: 'Mark as ready',
    text: 'Reviewers are asked to review it, and it can be merged when the repository\'s rules allow it.',
  },
  close: {
    title: 'Close pull request',
    primary: 'Close pull request',
    danger: true,
    text: 'It is closed without merging. Its branch stays, and the pull request can be reopened on GitHub.',
  },
};

function prConfirmHtml(pr, action) {
  return `${prDialogHeadHtml(pr)}<p class="gg-dialog-hint">${escapeHtml(PR_ACTION_COPY[action].text)}</p>`;
}

function prMergeDialogHtml(pr, repo) {
  const methods = (repo && repo.mergeMethods) || [];
  const chosen = methods.includes(repo?.defaultMethod) ? repo.defaultMethod : methods[0];
  const options = methods.map(m => `<option value="${m}"${m === chosen ? ' selected' : ''}>${escapeHtml(PR_METHOD_LABELS[m] || m)}</option>`).join('');
  const warnings = [];
  if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') warnings.push('Its checks failed.');
  else if (pr.checks === 'PENDING' || pr.checks === 'EXPECTED') warnings.push('Its checks are still running.');
  if (pr.reviewDecision === 'CHANGES_REQUESTED') warnings.push('A reviewer asked for changes.');
  else if (pr.reviewDecision === 'REVIEW_REQUIRED') warnings.push('It has not been approved yet.');
  if (pr.mergeable === 'UNKNOWN') warnings.push('GitHub has not worked out yet whether it can be merged.');
  const fork = !!pr.crossRepository;
  const deleteHint = fork
    ? 'Its branch is in another repository (a fork), so it stays.'
    : 'On GitHub only: the branch on this computer, and any worktree on it, stay.';
  return `
    ${prDialogHeadHtml(pr)}
    ${warnings.map(w => `<p class="gg-dialog-warning">${escapeHtml(w)}</p>`).join('')}
    <div class="gg-field"><label class="gg-field-label" for="pr-merge-method">Merge method</label><select id="pr-merge-method" class="gg-field-input">${options}</select></div>
    <div class="gg-field gg-field-checkbox"><label><input type="checkbox" id="pr-merge-delete"${!fork && repo?.deleteBranchOnMerge ? ' checked' : ''}${fork ? ' disabled' : ''}> Delete the branch <span class="mono">${escapeHtml(pr.head)}</span> after merging</label><div class="gg-field-hint">${escapeHtml(deleteHint)}</div></div>
    <p class="gg-dialog-hint">The merge happens on GitHub. Your local checkout is not changed.</p>`;
}

// --- Painting ---

/** The view's body when it is the one on screen for this project (Git → Pull Requests), else null. */
function prActiveBody(project) {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  const body = document.getElementById('git-workspace-view');
  if (!body || !body.isConnected) return null;
  if (selectedProject()?.id !== project.id || projectTab(project) !== 'git' || projectGitView(project) !== 'pulls') return null;
  return body;
}

function prSelectedRepo(state) {
  const repos = state.repositories || [];
  return repos.find(r => r.path === state.selectedRepo) || repos[0] || null;
}

function prSummaryText(data) {
  if (data.open) {
    const items = data.open.items || [];
    const drafts = items.filter(pr => pr.isDraft).length;
    const open = items.length - drafts;
    return `${data.open.repo?.nameWithOwner || ''} · ${open} open${drafts ? `, ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}`;
  }
  if (data.loading) return 'Reading pull requests…';
  return '';
}

function prErrorHtml(data) {
  const titles = {
    'gh-missing': 'The GitHub CLI is needed',
    'gh-auth': 'Sign in to GitHub',
    'no-github-remote': 'No GitHub remote',
    'not-found': 'Repository not found on GitHub',
  };
  const title = titles[data.errorCode] || 'The pull requests could not be read';
  const text = data.errorCode === 'no-github-remote'
    ? 'Pull requests are listed for repositories on GitHub, and this one has no GitHub remote.'
    : data.error;
  return `
    <div class="git-empty-state">
      <div class="git-empty-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(text || '')}</div>
      <button type="button" class="ws-btn ws-btn--sm" data-act="retry">Try again</button>
    </div>`;
}

function prNoticeHtml(notice) {
  if (!notice) return '';
  return `
    <div class="wt-notice wt-notice--${prAttr(notice.kind)}" role="status">
      ${notice.kind === 'busy' ? '<span class="git-loading-dot"></span>' : ''}
      <span class="wt-notice-text">${escapeHtml(notice.text)}</span>
      ${notice.kind === 'busy' ? '' : `<button type="button" class="wt-notice-close" title="Dismiss" aria-label="Dismiss">${PICONS.x(10)}</button>`}
    </div>`;
}

function prRemoteSelectHtml(data) {
  const remotes = data.remotes || [];
  if (remotes.length < 2) return '';
  const current = data.remote || remotes[0].name;
  return `
    <select class="ws-select pr-remote" id="pr-remote" title="Whose pull requests are listed" aria-label="Remote">
      ${remotes.map(r => `<option value="${prAttr(r.name)}"${r.name === current ? ' selected' : ''}>${escapeHtml(`${r.name} · ${r.slug}`)}</option>`).join('')}
    </select>`;
}

function prRepoPickerHtml(repos, active) {
  if (typeof gitGraphRepoPickerHtml === 'function') return gitGraphRepoPickerHtml(repos, active);
  return '';
}

function prPaint(project, state, body) {
  const repos = state.repositories || [];
  if (!repos.length) {
    body.innerHTML = '<div class="git-empty-state"><div class="git-empty-title">No folders attached</div><div>Attach a repository to this project to see its pull requests here.</div></div>';
    return;
  }
  const repo = prSelectedRepo(state);
  state.selectedRepo = repo.path;
  const picker = prRepoPickerHtml(repos, repo);
  if (repo.git === false) {
    body.innerHTML = `<div class="git-tab-shell pr-shell">${picker}<div class="git-empty-state"><div class="git-empty-title">Not a Git repository</div><div>${escapeHtml(repo.path)}</div></div></div>`;
    prWireRepoPicker(project, state, body);
    return;
  }
  const data = prRepoState(project.id, state, repo.path);
  body.innerHTML = `
    <div class="git-tab-shell pr-shell">
      ${picker}
      <div class="git-tab-top">
        <div class="pr-heading"><div class="git-tab-title">Pull Requests</div><div class="git-tab-path" id="pr-summary" title="${prAttr(repo.path)}">${escapeHtml(prSummaryText(data))}</div></div>
        <div class="pr-top-actions">
          <span id="pr-remote-slot">${prRemoteSelectHtml(data)}</span>
          <div class="pr-filter-wrap">
            <button type="button" class="ws-btn ws-btn--sm pr-filter-btn${prIsDefaultFilter(state.filter) ? '' : ' is-on'}" id="pr-filter" aria-haspopup="true" aria-expanded="false" title="Which pull requests to show">${PR_ICONS.filter(12)}<span id="pr-filter-label">${escapeHtml(prFilterLabel(state.filter))}</span>${PICONS.chevronDown(10)}</button>
          </div>
          <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" id="pr-refresh" title="Refresh">${PICONS.refresh(13)}</button>
        </div>
      </div>
      <div id="pr-notice">${prNoticeHtml(state.notice)}</div>
      <div class="pr-list" id="pr-list"></div>
    </div>`;
  prWireRepoPicker(project, state, body);
  prPaintList(project, state, body);
  prBindNotice(project, state, body);
  body.querySelector('#pr-refresh').onclick = () => prRefresh(project, state, repo.path, { notice: true });
  body.querySelector('#pr-filter').onclick = (e) => prOpenFilterMenu(project, state, body, e.currentTarget);
  prWireRemote(project, state, body, repo.path);
}

function prWireRepoPicker(project, state, body) {
  body.querySelectorAll('.gg-repo-option').forEach((button) => {
    const repo = (state.repositories || [])[Number(button.dataset.index)];
    if (!repo) return;
    button.onclick = () => {
      if (state.selectedRepo === repo.path) return;
      state.selectedRepo = repo.path;
      state.notice = null;
      prPaint(project, state, body);
      prEnsureLoaded(project, state);
    };
  });
}

function prWireRemote(project, state, body, repoPath) {
  const select = body.querySelector('#pr-remote');
  if (!select) return;
  select.onchange = () => {
    const previous = state.repos.get(repoPath);
    const fresh = prRepoData(select.value);
    fresh.remotes = previous ? previous.remotes : [];
    state.repos.set(repoPath, fresh);
    prSaveRemote(project.id, repoPath, select.value);
    prLoad(project, state, repoPath);
  };
}

function prBindNotice(project, state, body) {
  const close = body.querySelector('#pr-notice .wt-notice-close');
  if (close) close.onclick = () => prSetNotice(project, state, null);
}

function prSetNotice(project, state, notice) {
  state.notice = notice;
  const body = prActiveBody(project);
  const slot = body?.querySelector('#pr-notice');
  if (!slot) return;
  slot.innerHTML = prNoticeHtml(notice);
  prBindNotice(project, state, body);
}

/** Repaint the summary, the Remote combo and the list of the repository on screen. */
function prRepaint(project, state, repoPath) {
  const body = prActiveBody(project);
  if (!body || state.selectedRepo !== repoPath || !body.querySelector('#pr-list')) return;
  const data = prRepoState(project.id, state, repoPath);
  const summary = body.querySelector('#pr-summary');
  if (summary) summary.textContent = prSummaryText(data);
  const remoteSlot = body.querySelector('#pr-remote-slot');
  if (remoteSlot && !remoteSlot.querySelector('select:focus')) {
    remoteSlot.innerHTML = prRemoteSelectHtml(data);
    prWireRemote(project, state, body, repoPath);
  }
  prPaintList(project, state, body);
}

function prPaintList(project, state, body) {
  const list = body.querySelector('#pr-list');
  const repo = prSelectedRepo(state);
  if (!list || !repo) return;
  const data = prRepoState(project.id, state, repo.path);
  // Painting again keeps the place: the view scrolls, not the list.
  const scroller = body;
  const scrollTop = scroller.scrollTop;
  if (!data.open) {
    if (data.error && !data.loading) list.innerHTML = prErrorHtml(data);
    else list.innerHTML = '<div class="git-loading"><span class="git-loading-dot"></span>Reading pull requests…</div>';
    list.querySelector('[data-act="retry"]')?.addEventListener('click', () => prLoad(project, state, repo.path));
    return;
  }
  list.innerHTML = prListHtml(data, state.filter);
  const byNumber = new Map(prMergeLists(data.open.items, data.page.items, state.filter).map(pr => [pr.number, pr]));
  list.querySelectorAll('.pr-item').forEach((item) => {
    const pr = byNumber.get(Number(item.dataset.pr));
    if (pr) prWireItem(project, state, repo.path, item, pr);
  });
  list.querySelector('[data-act="page-more"]')?.addEventListener('click', () => prLoadPage(project, state, repo.path, { more: true }));
  list.querySelector('[data-act="page-retry"]')?.addEventListener('click', () => prLoadPage(project, state, repo.path, { more: data.page.loaded }));
  scroller.scrollTop = scrollTop;
}

function prWireItem(project, state, repoPath, item, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const row = item.querySelector('.pr-row');
  const toggle = () => prToggle(project, state, repoPath, item, pr);
  row.onclick = (e) => {
    if (e.target.closest('[data-act="merge"], [data-act="more"], .pr-merge-wrap')) return;
    toggle();
  };
  row.onkeydown = (e) => {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggle();
  };
  const merge = item.querySelector('[data-act="merge"]');
  if (merge) merge.onclick = (e) => { e.stopPropagation(); prMergeDialog(project, state, repoPath, pr); };
  const more = item.querySelector('[data-act="more"]');
  if (more) {
    more.onclick = (e) => {
      e.stopPropagation();
      showContextMenu(prRowMenuItems(pr, data.open?.repo, {
        draft: () => prConfirmDialog(project, state, repoPath, pr, 'draft'),
        ready: () => prConfirmDialog(project, state, repoPath, pr, 'ready'),
        close: () => prConfirmDialog(project, state, repoPath, pr, 'close'),
      }), { anchor: e.currentTarget });
    };
  }
  if (data.expanded.has(pr.number)) prPaintDetail(project, state, repoPath, item, pr);
}

function prToggle(project, state, repoPath, item, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const open = !data.expanded.has(pr.number);
  if (open) data.expanded.add(pr.number); else data.expanded.delete(pr.number);
  item.classList.toggle('open', open);
  item.querySelector('.pr-row').setAttribute('aria-expanded', String(open));
  const detail = item.querySelector('.pr-detail');
  detail.hidden = !open;
  if (!open) { detail.innerHTML = ''; return; }
  prPaintDetail(project, state, repoPath, item, pr);
}

function prPaintDetail(project, state, repoPath, item, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const key = prFilesKey(pr);
  const entry = data.files.get(key);
  const detail = item.querySelector('.pr-detail');
  if (!entry) {
    prLoadFiles(project, state, repoPath, pr);
    detail.innerHTML = prFilesHtml({ loading: true });
    return;
  }
  const openPaths = data.openFiles.get(key) || new Set();
  detail.innerHTML = prFilesHtml(entry, openPaths);
  detail.querySelector('[data-act="files-retry"]')?.addEventListener('click', () => {
    data.files.delete(key);
    prPaintDetail(project, state, repoPath, item, pr);
  });
  const files = entry.files || [];
  const setOpen = (button, open) => {
    const file = files[Number(button.dataset.file)];
    if (!file) return;
    if (open) openPaths.add(file.path); else openPaths.delete(file.path);
    button.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    const slot = detail.querySelector(`[data-diff="${button.dataset.file}"]`);
    if (!slot) return;
    slot.hidden = !open;
    if (open && !slot.innerHTML) slot.innerHTML = prPatchHtml(file);
  };
  data.openFiles.set(key, openPaths);
  detail.querySelectorAll('.pr-file').forEach((button) => {
    button.onclick = () => setOpen(button, button.getAttribute('aria-expanded') !== 'true');
  });
  const openAll = detail.querySelector('[data-act="files-open-all"]');
  if (openAll) openAll.onclick = () => detail.querySelectorAll('.pr-file').forEach(button => setOpen(button, true));
  const closeAll = detail.querySelector('[data-act="files-close-all"]');
  if (closeAll) closeAll.onclick = () => detail.querySelectorAll('.pr-file').forEach(button => setOpen(button, false));
}

/** The repaint of one open row's files, if it is still on screen and open. */
function prRepaintDetail(project, state, repoPath, pr) {
  const body = prActiveBody(project);
  if (!body || state.selectedRepo !== repoPath) return;
  const data = prRepoState(project.id, state, repoPath);
  if (!data.expanded.has(pr.number)) return;
  const item = body.querySelector(`.pr-item[data-pr="${pr.number}"]`);
  if (item) prPaintDetail(project, state, repoPath, item, pr);
}

// --- Filter menu ---

function prCloseFilterMenu() {
  const open = typeof document !== 'undefined' ? document.querySelector('.pr-filter-menu') : null;
  if (open) open._close?.();
}

function prOpenFilterMenu(project, state, body, button) {
  if (document.querySelector('.pr-filter-menu')) { prCloseFilterMenu(); return; }
  const menu = document.createElement('div');
  menu.className = 'ctx-menu pr-filter-menu';
  menu.setAttribute('role', 'menu');
  const paint = () => {
    menu.innerHTML = PR_FILTERS.map(([key, label]) => {
      const on = state.filter.includes(key);
      const last = on && state.filter.length === 1;
      return `<label class="pr-filter-option${last ? ' is-last' : ''}" title="${last ? 'At least one stays chosen' : ''}"><input type="checkbox" data-key="${key}"${on ? ' checked' : ''}${last ? ' disabled' : ''}><span class="pr-state pr-state--${key}">${PR_ICONS[key](13)}</span><span>${escapeHtml(label)}</span></label>`;
    }).join('') + (prIsDefaultFilter(state.filter) ? '' : '<div class="ctx-sep"></div><button type="button" class="pr-filter-reset" data-act="reset">Open and draft only</button>');
    menu.querySelectorAll('input[data-key]').forEach((input) => {
      input.onchange = () => { prSetFilter(project, state, body, prToggleFilter(state.filter, input.dataset.key)); paint(); };
    });
    const reset = menu.querySelector('[data-act="reset"]');
    if (reset) reset.onclick = () => { prSetFilter(project, state, body, [...PR_DEFAULT_FILTER]); paint(); };
  };
  paint();
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  button.setAttribute('aria-expanded', 'true');
  const onDown = (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); button.focus?.(); } };
  function close() {
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  }
  menu._close = close;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  menu.querySelector('input:not([disabled])')?.focus();
}

function prSetFilter(project, state, body, filter) {
  state.filter = filter;
  const label = body.querySelector('#pr-filter-label');
  if (label) label.textContent = prFilterLabel(filter);
  body.querySelector('#pr-filter')?.classList.toggle('is-on', !prIsDefaultFilter(filter));
  const repo = prSelectedRepo(state);
  if (!repo) return;
  const data = prRepoState(project.id, state, repo.path);
  const states = prPageStates(filter);
  if (states.length && data.open && data.page.key !== states.join(',')) {
    data.page = prEmptyPage(states.join(','));
    prLoadPage(project, state, repo.path);
  }
  prPaintList(project, state, body);
}

// --- Reading ---

function prRepoPaths(project) {
  if (typeof gitGraphRepoList === 'function') return gitGraphRepoList(project).map(r => r.path);
  const seen = new Set();
  return [project.root, ...((project.folders || []).map(f => f.path))].filter(p => p && !seen.has(p) && seen.add(p));
}

function prSameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((value, i) => value === sb[i]);
}

async function prLoadRepositories(project, state) {
  const holder = {};
  if (typeof gitGraphLoadRepositories === 'function') await gitGraphLoadRepositories(project, holder);
  else holder.repositories = prRepoPaths(project).map(path => ({ path }));
  const order = typeof gitGraphState === 'function' ? gitGraphState(project.id).repositoryDropdownOrder : 'attachmentOrder';
  state.repositories = typeof gitGraphSortRepositories === 'function'
    ? gitGraphSortRepositories(holder.repositories || [], order)
    : (holder.repositories || []);
}

function prRemoteOpts(data, extra = {}) {
  return data.remote ? { remote: data.remote, ...extra } : { ...extra };
}

/** Read every open pull request again; then the pages, as many as were read. */
async function prLoad(project, state, repoPath, { quiet = false } = {}) {
  const data = prRepoState(project.id, state, repoPath);
  const request = ++prSeq;
  data.request = request;
  data.loading = true;
  if (!quiet) prRepaint(project, state, repoPath);
  const result = await prApi('getPullRequests', project.id, repoPath, prRemoteOpts(data));
  if (state.repos.get(repoPath) !== data || data.request !== request) return false;
  data.loading = false;
  if (Array.isArray(result?.remotes)) data.remotes = result.remotes;
  if (!result?.ok) {
    data.error = result?.error || 'The pull requests could not be read.';
    data.errorCode = result?.code || null;
    if (!quiet || !data.open) data.open = null;
    prRepaint(project, state, repoPath);
    return false;
  }
  if (!data.remote && result.remote) data.remote = result.remote;
  data.error = null;
  data.errorCode = null;
  data.open = { repo: result.repo, items: result.items || [], totalCount: result.totalCount || 0, truncated: !!result.truncated };
  data.loadedAt = Date.now();
  prRepaint(project, state, repoPath);
  const states = prPageStates(state.filter);
  if (states.length) {
    const key = states.join(',');
    const read = data.page.key === key ? data.page.items.length : 0;
    if (data.page.key !== key) data.page = prEmptyPage(key);
    prLoadPage(project, state, repoPath, { refill: read });
  }
  return true;
}

/**
 * Closed and merged pull requests, a page at a time: the next page (`more`),
 * or the first again, as long as what was read before (`refill`).
 */
async function prLoadPage(project, state, repoPath, { more = false, refill = 0 } = {}) {
  const data = prRepoState(project.id, state, repoPath);
  const states = prPageStates(state.filter);
  if (!states.length) return;
  const key = states.join(',');
  if (data.page.key !== key) data.page = prEmptyPage(key);
  const page = data.page;
  if (more && (!page.hasNextPage || !page.endCursor)) return;
  const request = ++prSeq;
  page.request = request;
  page.loading = true;
  page.error = null;
  prRepaint(project, state, repoPath);
  const first = refill ? Math.min(100, Math.max(PR_PAGE_SIZE, refill)) : PR_PAGE_SIZE;
  const opts = prRemoteOpts(data, { states, first });
  if (more) opts.after = page.endCursor;
  const result = await prApi('getPullRequestsPage', project.id, repoPath, opts);
  if (state.repos.get(repoPath) !== data || data.page !== page || page.request !== request) return;
  page.loading = false;
  if (!result?.ok) {
    page.error = result?.error || 'The pull requests could not be read.';
  } else {
    page.items = more ? [...page.items, ...(result.items || [])] : (result.items || []);
    page.totalCount = result.totalCount || 0;
    page.hasNextPage = !!result.hasNextPage;
    page.endCursor = result.endCursor || null;
    page.loaded = true;
  }
  prRepaint(project, state, repoPath);
}

async function prLoadFiles(project, state, repoPath, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const key = prFilesKey(pr);
  if (data.files.get(key)?.loading) return;
  const entry = { loading: true };
  data.files.set(key, entry);
  const result = await prApi('getPullRequestFiles', project.id, repoPath, prRemoteOpts(data, { number: pr.number }));
  if (state.repos.get(repoPath) !== data || data.files.get(key) !== entry) return;
  if (result?.ok) {
    data.files.set(key, { files: result.files || [], truncated: !!result.truncated });
    if (!data.openFiles.has(key)) data.openFiles.set(key, prFileBudget(result.files || []));
  } else {
    data.files.set(key, { error: result?.error || 'The changed files could not be read.' });
  }
  prRepaintDetail(project, state, repoPath, pr);
}

async function prRefresh(project, state, repoPath, { notice = false } = {}) {
  if (notice) prSetNotice(project, state, { kind: 'busy', text: 'Reading pull requests…' });
  const ok = await prLoad(project, state, repoPath, { quiet: true });
  if (notice && state.notice?.kind === 'busy') {
    const data = prRepoState(project.id, state, repoPath);
    prSetNotice(project, state, ok || !data.error ? null : { kind: 'error', text: data.error });
  }
}

/** Read the selected repository's pull requests when they were never read, or long ago. */
function prEnsureLoaded(project, state) {
  const repo = prSelectedRepo(state);
  if (!repo || repo.git === false) return;
  const data = prRepoState(project.id, state, repo.path);
  if (data.loading) return;
  if (!data.open) { prLoad(project, state, repo.path); return; }
  if (Date.now() - data.loadedAt > PR_STALE_MS) prRefresh(project, state, repo.path);
}

function renderProjectPullRequestsTab(project, body) {
  const state = prTabState(project.id);
  body.className = 'git-workspace-view git-tab-body pr-tab-body';
  if (!state.selectedRepo) {
    // The repository chosen in Changes or History, the first time.
    const history = typeof gitGraphState === 'function' ? gitGraphState(project.id).selectedRepo : null;
    const changes = typeof gitTabState === 'function' ? gitTabState(project.id).selectedRepo : null;
    state.selectedRepo = history || changes || null;
  }
  // Folders attached since the list was read show up, as in History.
  const stale = !!state.repositories && !prSameSet((state.repositories || []).map(r => r.path), prRepoPaths(project));
  if (state.repositories && !stale) {
    prPaint(project, state, body);
    prEnsureLoaded(project, state);
    return;
  }
  if (!state.repositories) body.innerHTML = '<div class="git-loading"><span class="git-loading-dot"></span>Reading repositories…</div>';
  prLoadRepositories(project, state).then(() => {
    const active = prActiveBody(project);
    if (!active) return;
    prPaint(project, state, active);
    prEnsureLoaded(project, state);
  });
}

// --- Actions ---

/** Run one action from its dialog: an error stays in the dialog, success closes it and reads the list again. */
async function prRunAction(project, state, repoPath, pr, params, handle) {
  const data = prRepoState(project.id, state, repoPath);
  const result = await prApi('runPullRequestAction', project.id, repoPath, prRemoteOpts(data, { number: pr.number, ...params }));
  if (!result?.ok) throw new Error(result?.error || 'GitHub did not do it.');
  handle.close();
  state.dialogOpen = false;
  prSetNotice(project, state, { kind: 'ok', text: result.message || 'Done.' });
  // The files of a merged or closed pull request stay as they were.
  prLoad(project, state, repoPath, { quiet: true });
}

function prOpenActionDialog(project, state, repoPath, pr, { title, bodyHtml, primaryLabel, primaryDanger = false, focusSelector, params }) {
  let handle = null;
  let failed = false;
  state.dialogOpen = true;
  // gitGraphOpenDialog takes Enter as "do it" wherever the focus is. Here the
  // focus starts on Cancel, so Enter on a button presses that button instead:
  // registered first, this listener runs before the dialog's own.
  const onEnter = (e) => {
    if (!handle || !handle.overlay.isConnected) { document.removeEventListener('keydown', onEnter, true); return; }
    if (e.key !== 'Enter') return;
    const focused = document.activeElement;
    if (focused && focused.tagName === 'BUTTON' && handle.dialog.contains(focused)) e.stopImmediatePropagation();
  };
  document.addEventListener('keydown', onEnter, true);
  handle = gitGraphOpenDialog({
    title,
    bodyHtml,
    primaryLabel,
    primaryDanger,
    focusSelector,
    onCancel: () => {
      document.removeEventListener('keydown', onEnter, true);
      state.dialogOpen = false;
      // A refused action may mean the list is behind GitHub (new commits, a merge elsewhere).
      if (failed) prLoad(project, state, repoPath, { quiet: true });
    },
    onSubmit: async () => {
      try {
        await prRunAction(project, state, repoPath, pr, params(handle.dialog), handle);
      } catch (err) {
        failed = true;
        throw err;
      }
    },
  });
  handle.dialog.classList.add('pr-dialog');
  const close = handle.close;
  handle.close = () => { document.removeEventListener('keydown', onEnter, true); close(); };
  return handle;
}

function prConfirmDialog(project, state, repoPath, pr, action) {
  const copy = PR_ACTION_COPY[action];
  if (!copy) return null;
  return prOpenActionDialog(project, state, repoPath, pr, {
    title: copy.title,
    bodyHtml: prConfirmHtml(pr, action),
    primaryLabel: copy.primary,
    primaryDanger: !!copy.danger,
    focusSelector: '.gg-dialog-cancel',
    params: () => ({ action }),
  });
}

function prMergeDialog(project, state, repoPath, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const repo = data.open?.repo;
  if (prMergeBlock(pr, repo)) return null;
  return prOpenActionDialog(project, state, repoPath, pr, {
    title: `Merge pull request #${pr.number}`,
    bodyHtml: prMergeDialogHtml(pr, repo),
    primaryLabel: 'Merge',
    focusSelector: '#pr-merge-method',
    params: (dialog) => prMergeParams(dialog, pr),
  });
}

/**
 * What the merge dialog asks gh for. Read once the dialog is busy, when
 * gitGraphOpenDialog has disabled every field: so a fork's branch is told
 * apart by the pull request, not by its disabled checkbox.
 */
function prMergeParams(dialog, pr) {
  const method = dialog.querySelector('#pr-merge-method')?.value;
  const deleteBox = dialog.querySelector('#pr-merge-delete');
  const params = { action: 'merge', method, deleteBranch: !pr.crossRepository && !!(deleteBox && deleteBox.checked) };
  if (/^[0-9a-f]{40}$/.test(pr.headOid || '')) params.headOid = pr.headOid;
  return params;
}

// Back to the window: what changed on GitHub meanwhile shows up.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('focus', () => {
    const project = typeof selectedProject === 'function' ? selectedProject() : null;
    if (!project || !prActiveBody(project)) return;
    const state = prTabState(project.id);
    if (state.dialogOpen) return;
    prEnsureLoaded(project, state);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PR_FILTERS, PR_DEFAULT_FILTER, PR_PAGE_SIZE,
    prStatus, prVisible, prPageStates, prMergeLists, prFilterLabel, prIsDefaultFilter, prToggleFilter, prEmptyText,
    prCanEdit, prMergeBlock, prRowMenuItems, prFileBudget, prRowHtml, prListHtml, prFooterHtml, prFilesHtml,
    prPatchHtml, prMergeDialogHtml, prMergeParams, prConfirmHtml, prBadgesHtml, prSummaryText, prErrorHtml, prRepoData, prEmptyPage,
  };
}
