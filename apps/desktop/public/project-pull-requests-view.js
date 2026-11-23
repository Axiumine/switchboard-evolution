// The Git tab's Pull Requests view for a project: the pull requests of each of
// the project's repositories on GitHub, one tab per repository as in History.
// Every open pull request is listed, drafts too; closed and merged ones join
// the list 10 at a time when the filter asks for them. A row opens on its
// changed files and their diffs. Merge sits on the row, and its "…" menu has
// Convert to draft (or Ready for review) and Close; each of them asks first.
// Before Merge, icons copy the pull request's address and open its page on
// GitHub: in a panel, in a window of its own (web-page-view.js), or in the browser.
// Over the list: a search box (titles, descriptions, comments and the changed
// files' paths, *.sql as a pattern; pull-request-search.js), the states filter,
// a People filter (the authors, several at once), and Prompt, which copies a
// prompt naming the pull requests shown.
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
// How a pull request's files are laid out, 'tree' or 'list': one choice for
// every project, kept as the Changes tab keeps its own. Tree at first.
const PR_FILE_VIEW_KEY = 'pullRequests.fileView';
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
  people: prSvg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  prompt: prSvg('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 11h8"/><path d="M8 15h5"/>'),
};
// Pull requests whose texts one request reads, and how many requests at once.
const PR_TEXTS_BATCH = 20;
const PR_TEXTS_PARALLEL = 2;
// With the search or People on, a page of closed and merged ones holds this many.
const PR_NARROWED_PAGE_SIZE = 100;

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
      // The People filter's authors (none is everyone) and the search box's
      // text: kept while the app runs, as the filter is.
      people: [],
      search: '',
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
    openFiles: new Map(), // the same key → Set of file paths whose diff is shown; none at first
    closedFolders: new Map(), // the same key → Set of tree folders closed
    detail: new Map(),    // number → what an open pull request's tabs hold (pull-request-detail-view.js)
    drafts: new Map(),    // editor key → its text, kept while it is open
    titleEdit: null,      // { number, busy, error } while a title is edited in place
    listPending: false,   // a repaint waiting for the focus to leave a field
    // What the search reads per pull request (pull-request-search.js in main):
    // number → { updatedAt, body, comments, files, truncated }.
    texts: { map: new Map(), pending: new Set(), failed: new Set(), running: 0, error: null },
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

function prEmptyText(filter, { people = [], search = '' } = {}) {
  const states = prWordList(PR_FILTERS.filter(([key]) => (filter || []).includes(key)).map(([, label]) => label.toLowerCase()));
  const by = (people || []).length ? ` by ${prWordList(people)}` : '';
  const matching = String(search || '').trim() ? ` matching “${String(search).trim()}”` : '';
  return `No ${states} pull requests${by}${matching}`;
}

// --- Search and People (pull-request-search.js has the pure parts) ---

let prSearchCache = { raw: null, parsed: { raw: '', terms: [] } };

/** The search box's text, parsed once per text. */
function prSearchOf(state) {
  const raw = String(state?.search || '');
  if (typeof prParseSearch !== 'function') return { raw: '', terms: [] };
  if (prSearchCache.raw !== raw) prSearchCache = { raw, parsed: prParseSearch(raw) };
  return prSearchCache.parsed;
}

/**
 * What the list shows for the states filter, People and the search: { items,
 * candidates (what the search looks through), search, where (number → where
 * the words were found), read (how many candidates' texts have come), unread
 * (how many are still to come), people, narrowed }.
 */
function prShownView(data, state) {
  const byState = prMergeLists(data.open?.items, data.page?.items, state?.filter || PR_DEFAULT_FILTER);
  const people = state?.people || [];
  const candidates = people.length && typeof prByPeople === 'function' ? byState.filter(pr => prByPeople(pr, people)) : byState;
  const search = prSearchOf(state);
  const narrowed = people.length > 0 || search.terms.length > 0;
  if (!search.terms.length) return { items: candidates, candidates, search, where: null, read: 0, unread: 0, people, narrowed };
  const texts = data.texts || { map: new Map(), failed: new Set() };
  const where = new Map();
  const items = [];
  let read = 0;
  let unread = 0;
  for (const pr of candidates) {
    const known = texts.map.get(pr.number) || null;
    if (known) read++;
    else if (!texts.failed.has(pr.number)) unread++;
    const result = prSearchMatch(pr, known, search);
    if (result.match) { items.push(pr); where.set(pr.number, result.where); }
  }
  return { items, candidates, search, where, read, unread, people, narrowed };
}

/** The line over the rows while the search runs: how far it has read, or why it stopped. */
function prSearchStatusHtml(data, view) {
  if (!view || !view.search?.terms.length) return '';
  const texts = data.texts || { failed: new Set() };
  const total = view.candidates.length;
  const failed = view.candidates.filter(pr => texts.failed.has(pr.number) && !texts.map?.has(pr.number)).length;
  let inner;
  if (failed && texts.error) {
    inner = `<span>${escapeHtml(`${prPlural(failed, 'pull request')} could not be searched: ${texts.error}`)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="texts-retry">Retry</button>`;
  } else if (view.unread) {
    inner = `<span class="git-loading-dot"></span><span>Searching descriptions, comments and files: ${view.read} of ${total} read</span>`;
  } else {
    inner = `<span>${view.items.length} of ${prPlural(total, 'pull request')} match</span>`;
  }
  return `<div class="pr-search-status${failed && texts.error ? ' is-error' : ''}" id="pr-search-status" role="status">${inner}</div>`;
}

/** What makes the rows what they are (not the status line): the list is painted again only when it changes. */
function prViewKey(view) {
  return view.items.map(pr => `${pr.number}:${view.where ? prSearchWhereText(view.where.get(pr.number)) : ''}`).join(',');
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

/**
 * The row's "…" menu: Convert to draft or Ready for review, Change base, then
 * Close; a closed one has Reopen; a merged one has none.
 */
function prRowMenuItems(pr, repo, actions = {}) {
  const disabled = !prCanEdit(pr, repo);
  if (pr.state === 'CLOSED') {
    return [{ label: 'Reopen pull request…', icon: PR_ICONS.open(13), disabled: disabled && !pr.viewerCanReopen, onClick: () => actions.reopen?.() }];
  }
  if (pr.state !== 'OPEN') return [];
  const items = [];
  if (pr.isDraft) items.push({ label: 'Ready for review…', icon: PR_ICONS.open(13), disabled, onClick: () => actions.ready?.() });
  else items.push({ label: 'Convert to draft…', icon: PR_ICONS.draft(13), disabled, onClick: () => actions.draft?.() });
  items.push({ label: 'Change base…', icon: PICONS.branch(13), disabled, onClick: () => actions.base?.() });
  items.push({ sep: true });
  items.push({ label: 'Close pull request…', icon: PR_ICONS.closed(13), danger: true, disabled, onClick: () => actions.close?.() });
  return items;
}

function prFileView() {
  let stored = null;
  try { stored = localStorage.getItem(PR_FILE_VIEW_KEY); } catch {}
  return stored === 'list' ? 'list' : 'tree';
}

function setPrFileView(view) {
  try { localStorage.setItem(PR_FILE_VIEW_KEY, view === 'list' ? 'list' : 'tree'); } catch {}
}

/**
 * A pull request's files as rows: a tree, as the Changes tab draws one
 * (buildGitChangeTree and gitTreeRows in project-git-view.js: folders first, a
 * chain of single folders on one row, a closed folder keeping only its own
 * row), or a list. Each file row carries the file's index in `files`.
 */
function prFileRows(files, view = 'tree', closedFolders = new Set()) {
  const indexed = (files || []).map((file, index) => ({ ...file, index }));
  if (view !== 'tree' || typeof buildGitChangeTree !== 'function' || typeof gitTreeRows !== 'function') {
    return indexed.map(file => ({ kind: 'file', depth: 0, file }));
  }
  return gitTreeRows(buildGitChangeTree(indexed), closedFolders, '').map(row => (row.kind === 'folder'
    ? { kind: 'folder', depth: row.depth, name: row.name, key: row.key, count: row.count, collapsed: row.collapsed }
    : { kind: 'file', depth: row.depth, file: row.change }));
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

/** The pull request's page on GitHub, or null when gh gave no web address. */
function prWebUrl(pr) {
  return pr && typeof pr.url === 'string' && /^https?:\/\//i.test(pr.url) ? pr.url : null;
}

/**
 * The icons before Merge, on every pull request with a web address, closed and
 * merged ones too: Copy the address, Open here (a panel with the page inside
 * the app), Open in a window of its own, Open in the browser. The page shows
 * inside the app only over https (web-page-view.js); without it, only the
 * first and the last.
 */
function prLinkToolsHtml(pr) {
  const url = prWebUrl(pr);
  if (!url) return '';
  const inside = /^https:\/\//i.test(url);
  const tool = (act, label, icon) => `<button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="${act}" title="${prAttr(label)}" aria-label="${prAttr(`${label} (#${pr.number})`)}">${icon}</button>`;
  return `<span class="pr-link-tools" role="group" aria-label="Pull request #${pr.number} on GitHub">${[
    tool('copy-url', `Copy the address: ${url}`, PICONS.link(13)),
    inside ? tool('view', 'Open here', PICONS.panel(13)) : '',
    inside ? tool('window', 'Open in a window of its own', PICONS.popOut(13)) : '',
    tool('browser', 'Open in the browser', PICONS.globe(13)),
  ].join('')}</span>`;
}

/** The title the page's panel and window carry. */
function prWebTitle(pr) {
  return `#${pr.number} ${pr.title || ''}`.trim();
}

/**
 * The title being edited in place: the field, and the pencil turned into Save.
 * Enter saves, Escape puts the title back.
 */
function prTitleEditHtml(pr, edit) {
  const off = edit.busy ? ' disabled' : '';
  return `<span class="pr-title-edit"><input type="text" class="pr-title-input" value="${prAttr(edit.text)}" maxlength="256" spellcheck="true" aria-label="Title of #${pr.number}" title="Enter saves, Esc cancels"${off}><button type="button" class="ws-btn ws-btn--sm ws-btn--primary pr-title-save" data-act="title-save"${off}>${edit.busy ? '<span class="gg-dialog-spinner" aria-hidden="true"></span>' : PICONS.check(12)}<span>Save</span></button>${edit.error ? `<span class="pr-title-error" role="alert">${escapeHtml(edit.error)}</span>` : ''}</span>`;
}

function prRowHtml(pr, { expanded = false, repo = null, now = new Date(), titleEdit = null, search = null, where = null } = {}) {
  const status = prStatus(pr);
  const block = prMergeBlock(pr, repo);
  const branches = `${pr.head} → ${pr.base}`;
  const link = prLinkToolsHtml(pr);
  const more = prRowMenuItems(pr, repo).length
    ? `
          <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="more" title="More actions" aria-label="More actions for #${pr.number}">${PICONS.dots(13)}</button>` : '';
  // A disabled button shows no tooltip of its own: the reason sits on its wrapper.
  const actions = link + (pr.state === 'OPEN' ? `
          <span class="pr-merge-wrap"${block ? ` title="${prAttr(block)}"` : ''}><button type="button" class="ws-btn ws-btn--sm ws-btn--primary pr-merge-btn" data-act="merge"${block ? ' disabled' : ''}>${PR_ICONS.merged(12)}<span>Merge</span></button></span>` : '') + more;
  const pencil = pr.viewerCanUpdate ? `<button type="button" class="pr-title-pencil" data-act="title-edit" title="Edit title" aria-label="Edit the title of #${pr.number}">${PICONS.pencil(12)}</button>` : '';
  const searching = !!(search && search.terms && search.terms.length && typeof prMarkHtml === 'function');
  const titleText = searching ? prMarkHtml(pr.title, search) : escapeHtml(pr.title);
  const title = titleEdit ? prTitleEditHtml(pr, titleEdit) : `<span class="pr-title">${titleText}</span>${pencil}`;
  // Where the search found its words beyond the title: the files by name in the tooltip.
  const found = searching && where ? prSearchWhereText(where) : '';
  const foundTip = found && where.files.length ? `Files: ${where.files.slice(0, 12).join(', ')}${where.files.length > 12 ? '…' : ''}` : '';
  const foundHtml = found ? `<span class="pr-found"${foundTip ? ` title="${prAttr(foundTip)}"` : ''}>Found in ${escapeHtml(found)}</span>` : '';
  return `
    <div class="pr-item${expanded ? ' open' : ''}" data-pr="${pr.number}">
      <div class="pr-row" data-act="toggle" role="button" tabindex="0" aria-expanded="${expanded}">
        <span class="pr-chevron">${PICONS.chevronRight(10)}</span>
        <span class="pr-state pr-state--${status}" title="${PR_STATE_LABELS[status]}">${PR_ICONS[status](15)}</span>
        <div class="pr-main">
          <div class="pr-line">${title}${prBadgesHtml(pr)}</div>
          <div class="pr-meta"><span class="pr-number">#${pr.number}</span><span>${escapeHtml(prWhenText(pr, now))} by ${escapeHtml(pr.author)}</span><span class="pr-branches mono" title="${prAttr(branches)}">${escapeHtml(branches)}</span><span class="pr-stats mono"><span class="pr-add">+${pr.additions || 0}</span> <span class="pr-del">−${pr.deletions || 0}</span></span><span>${prPlural(pr.changedFiles || 0, 'file')}</span>${foundHtml}</div>
        </div>
        <div class="pr-actions">${actions}</div>
      </div>
      <div class="pr-detail" data-detail="${pr.number}"${expanded ? '' : ' hidden'}></div>
    </div>`;
}

function prFooterHtml(data, filter, { narrowed = false } = {}) {
  const states = prPageStates(filter);
  if (!states.length) return '';
  const page = data.page;
  const words = prPagedWords(states);
  // With the search or People on, the footer counts what was looked through, not what shows.
  const size = narrowed ? PR_NARROWED_PAGE_SIZE : PR_PAGE_SIZE;
  if (page.error) {
    return `<div class="pr-footer is-error"><span>${escapeHtml(page.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="page-retry">Retry</button></div>`;
  }
  if (!page.loaded) return `<div class="pr-footer"><span class="git-loading-dot"></span><span>Reading ${escapeHtml(words)} pull requests…</span></div>`;
  const shown = `${page.items.length} of ${page.totalCount} ${words} ${narrowed ? 'read' : 'shown'}`;
  if (!page.hasNextPage) return page.totalCount ? `<div class="pr-footer"><span>${escapeHtml(shown)}</span></div>` : '';
  return `
    <div class="pr-footer">
      <span>${escapeHtml(shown)}</span>
      <button type="button" class="ws-btn ws-btn--sm pr-more-btn" data-act="page-more"${page.loading ? ' disabled' : ''}>${page.loading ? 'Loading…' : `Load ${size} more`}</button>
    </div>`;
}

/** The title edit of this row, if it is the one being edited: its text is the draft. */
function prTitleEditOf(data, pr) {
  const edit = data.titleEdit;
  if (!edit || edit.number !== pr.number) return null;
  return { text: data.drafts?.get(`title:${pr.number}`) ?? pr.title, busy: !!edit.busy, error: edit.error || '' };
}

/**
 * The list for one repository's data and the filter: the search's line, rows,
 * an empty line, the pages' footer. `view` (prShownView) narrows it by People
 * and the search; without one every pull request of the filter's states shows.
 */
function prListHtml(data, filter, now = new Date(), view = null) {
  const items = view ? view.items : prMergeLists(data.open?.items, data.page.items, filter);
  const search = view && view.search?.terms.length ? view.search : null;
  const repo = data.open?.repo || null;
  const truncated = data.open?.truncated ? '<div class="pr-footer">Only the newest 1000 open pull requests are listed.</div>' : '';
  const waitingForPage = prPageStates(filter).length && !data.page.loaded;
  const waitingForTexts = !!(view && view.unread);
  const empty = prEmptyText(filter, { people: view?.people || [], search: search ? search.raw : '' });
  const rows = items.length
    ? `<div class="pr-rows">${items.map(pr => prRowHtml(pr, { expanded: data.expanded.has(pr.number), repo, now, titleEdit: prTitleEditOf(data, pr), search, where: view?.where?.get(pr.number) || null })).join('')}</div>`
    : (waitingForPage || waitingForTexts ? '' : `<div class="git-empty-state"><div class="git-empty-title">${escapeHtml(empty)}</div></div>`);
  return `${prSearchStatusHtml(data, view)}${rows}${truncated}${prFooterHtml(data, filter, { narrowed: !!view?.narrowed })}`;
}

// --- Files and diffs ---

const PR_STATUS_LETTERS = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

function prPatchHtml(file) {
  if (file.patch) {
    // The code in the editors' colours, by the file's language.
    const lines = typeof gitDiffLines === 'function' ? gitDiffLines(file.patch, { filename: file.path }) : escapeHtml(file.patch);
    return `<pre class="git-diff">${lines}</pre>`;
  }
  let text = 'A binary file, or a diff GitHub does not show.';
  if (file.tooLarge) text = 'This pull request\'s diffs are too large to show them all here.';
  else if (file.status === 'renamed' && !file.insertions && !file.deletions) text = 'Renamed, nothing else changed.';
  return `<div class="pr-file-note">${escapeHtml(text)}</div>`;
}

/** The tools over the files: Expand all and Collapse all, then Tree and List; icons, named in their tooltips. */
function prFilesToolsHtml(view) {
  const tool = (act, label, icon) => `<button type="button" class="git-view-btn" data-act="${act}" title="${label}" aria-label="${label}">${icon}</button>`;
  const mode = (name, label, icon) => `<button type="button" class="git-view-btn${view === name ? ' on' : ''}" data-act="files-view" data-view="${name}" title="${label}" aria-label="${label}" aria-pressed="${view === name}">${icon}</button>`;
  return `
      <span class="pr-files-tools">
        <span class="git-view-toggle" role="group" aria-label="Diffs">
          ${tool('files-expand-all', 'Expand all', PICONS.expandAll(13))}
          ${tool('files-collapse-all', 'Collapse all', PICONS.collapseAll(13))}
        </span>
        <span class="git-view-toggle" role="group" aria-label="Files view">
          ${mode('tree', 'View as tree', PICONS.tree(13))}
          ${mode('list', 'View as list', PICONS.list(13))}
        </span>
      </span>`;
}

/**
 * An open pull request's changed files, as a tree or a list. Every diff starts
 * closed: a file opens its own, Expand all opens them all.
 */
function prFilesHtml(entry, { open = new Set(), view = 'tree', closedFolders = new Set(), viewed = null, search = null } = {}) {
  if (!entry || entry.loading) return '<div class="pr-files-empty"><span class="git-loading-dot"></span>Reading the changed files…</div>';
  if (entry.error) {
    return `<div class="pr-files-empty is-error"><span>${escapeHtml(entry.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="files-retry">Retry</button></div>`;
  }
  const files = entry.files || [];
  if (!files.length) return '<div class="pr-files-empty">No files changed.</div>';
  const insertions = files.reduce((n, f) => n + (f.insertions || 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions || 0), 0);
  const tree = view === 'tree';
  // The search's words marked in the names, a file a pattern found marked whole.
  const searching = !!(search && search.terms && search.terms.length && typeof prMarkHtml === 'function');
  const mark = (text) => (searching ? prMarkHtml(text, search) : escapeHtml(text));
  const rows = prFileRows(files, view, closedFolders).map((row) => {
    if (row.kind === 'folder') {
      return `
      <button type="button" class="pr-folder" data-folder="${prAttr(row.key)}" aria-expanded="${!row.collapsed}" style="--depth:${row.depth}" title="${prAttr(row.key)}">
        <span class="pr-chevron">${PICONS.chevronRight(10)}</span>
        <span class="pr-folder-icon">${PICONS.folder(12)}</span>
        <span class="pr-folder-name mono">${mark(row.name)}</span>
        <span class="pr-folder-count">${row.count}</span>
      </button>`;
    }
    const file = row.file;
    const isOpen = open.has(file.path);
    const name = pathBasename(file.path) || file.path;
    const slash = file.path.lastIndexOf('/');
    const dir = slash > 0 ? file.path.slice(0, slash) : '';
    const icon = typeof fileIconHtml === 'function' ? fileIconHtml(name) : '';
    const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    // In the tree the folders say where a file is; the list says it after the name.
    const where = tree ? '' : mark(dir);
    const hit = searching && prFileHit(file.path, search);
    const byPattern = hit && search.terms.some(t => t.kind === 'glob' && prGlobMatches(t, file.path));
    const from = file.oldPath ? ` <span class="pr-file-from">from ${escapeHtml(file.oldPath)}</span>` : '';
    // A pull request's files (not a commit's) can be marked as viewed, as on GitHub.
    const seen = viewed ? viewed[file.path] : null;
    const box = viewed ? `<label class="pr-viewed${seen === 'DISMISSED' ? ' is-dismissed' : ''}" title="${seen === 'DISMISSED' ? 'Changed since you viewed it' : 'Mark as viewed'}"><input type="checkbox" data-viewed="${file.index}"${seen === 'VIEWED' ? ' checked' : ''}><span>Viewed</span></label>` : '';
    const button = `
      <button type="button" class="pr-file${tree ? ' tree' : ''}${isOpen ? ' open' : ''}${seen === 'VIEWED' ? ' is-viewed' : ''}${hit ? ' is-hit' : ''}" data-file="${file.index}" aria-expanded="${isOpen}" style="--depth:${row.depth}" title="${prAttr(title)}">
        <span class="pr-chevron">${PICONS.chevronRight(10)}</span>
        <span class="git-file-code ${prAttr(file.status)}">${PR_STATUS_LETTERS[file.status] || 'M'}</span>
        ${icon}
        <span class="pr-file-name mono">${byPattern ? prMarkHtml(name, search, { whole: true }) : mark(name)}</span>
        <span class="pr-file-dir">${where}${from}</span>
        <span class="pr-stats mono"><span class="pr-add">+${file.insertions || 0}</span> <span class="pr-del">−${file.deletions || 0}</span></span>
      </button>`;
    return `${box ? `<div class="pr-file-line">${button}${box}</div>` : button}
      <div class="pr-file-diff" data-diff="${file.index}"${isOpen ? '' : ' hidden'}>${isOpen ? prPatchHtml(file) : ''}</div>`;
  }).join('');
  const viewedCount = viewed ? files.filter(f => viewed[f.path] === 'VIEWED').length : 0;
  return `
    <div class="pr-files-head">
      <span>${prPlural(files.length, 'file')} changed</span>
      <span class="pr-stats mono"><span class="pr-add">+${insertions}</span> <span class="pr-del">−${deletions}</span></span>
      ${entry.truncated ? '<span class="pr-files-note">GitHub lists the first 3000 files.</span>' : ''}
      ${viewed ? `<span class="pr-viewed-count">${viewedCount} of ${files.length} viewed</span>` : ''}
      ${prFilesToolsHtml(view)}
    </div>
    <div class="pr-files${tree ? ' is-tree' : ''}">${rows}</div>`;
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
  reopen: {
    title: 'Reopen pull request',
    primary: 'Reopen pull request',
    text: 'It is open again, with its branch, its commits and its conversation as they were.',
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
          <label class="pr-search" title="Words in a title, a description or a comment, or in a changed file's path, never in the code. A word with * or ? is a pattern for the files: *.sql finds the pull requests that change a .sql file.">${PICONS.search(12)}<input type="search" id="pr-search" placeholder="Search titles, comments, files" autocomplete="off" spellcheck="false" aria-label="Search pull requests" value="${prAttr(state.search)}"></label>
          <span id="pr-remote-slot">${prRemoteSelectHtml(data)}</span>
          <div class="pr-filter-wrap">
            <button type="button" class="ws-btn ws-btn--sm pr-filter-btn${prIsDefaultFilter(state.filter) ? '' : ' is-on'}" id="pr-filter" aria-haspopup="true" aria-expanded="false" title="Which pull requests to show">${PR_ICONS.filter(12)}<span id="pr-filter-label">${escapeHtml(prFilterLabel(state.filter))}</span>${PICONS.chevronDown(10)}</button>
          </div>
          <button type="button" class="ws-btn ws-btn--sm pr-filter-btn${(state.people || []).length ? ' is-on' : ''}" id="pr-people" aria-haspopup="true" aria-expanded="false" title="Whose pull requests to show, by their author">${PR_ICONS.people(12)}<span id="pr-people-label">${escapeHtml(prPeopleLabel(state.people))}</span>${PICONS.chevronDown(10)}</button>
          <button type="button" class="ws-btn ws-btn--sm pr-filter-btn" id="pr-prompt" aria-haspopup="menu" title="Copy a prompt about the pull requests shown">${PR_ICONS.prompt(12)}<span>Prompt</span>${PICONS.chevronDown(10)}</button>
          <button type="button" class="ws-btn ws-btn--sm ws-btn--icon" id="pr-refresh" title="Refresh">${PICONS.refresh(13)}</button>
        </div>
      </div>
      <div id="pr-notice">${prNoticeHtml(state.notice)}</div>
      <div class="pr-list" id="pr-list"></div>
    </div>`;
  prWireRepoPicker(project, state, body);
  prPaintList(project, state, body);
  prBindNotice(project, state, body);
  // A repaint held back while a field had the focus runs once it leaves (after the click that moved it).
  body.onfocusout = () => setTimeout(() => { if (typeof prFlushPending === 'function') prFlushPending(project, state); }, 200);
  body.querySelector('#pr-refresh').onclick = () => prRefresh(project, state, repo.path, { notice: true });
  body.querySelector('#pr-filter').onclick = (e) => prOpenFilterMenu(project, state, body, e.currentTarget);
  body.querySelector('#pr-people').onclick = (e) => prOpenPeopleMenu(project, state, body, e.currentTarget);
  body.querySelector('#pr-prompt').onclick = (e) => prOpenPromptMenu(project, state, e.currentTarget);
  prWireSearch(project, state, body);
  prWireRemote(project, state, body, repo.path);
}

/** The search box: the list follows the text a moment after typing stops, at once on Enter; Escape empties it. */
function prWireSearch(project, state, body) {
  const input = body.querySelector('#pr-search');
  if (!input) return;
  let timer = null;
  const apply = () => {
    clearTimeout(timer);
    timer = null;
    if (state.search === input.value) return;
    state.search = input.value;
    prPaintList(project, state, body);
  };
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 200); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; apply(); }
  };
  // The field's own clear button.
  input.addEventListener('search', apply);
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
  // Never under the fingers: while a field in the list has the focus, the repaint waits.
  if (typeof prTypingIn === 'function' && prTypingIn(list)) { data.listPending = true; return; }
  data.listPending = false;
  // Painting again keeps the place: the view scrolls, not the list.
  const scroller = body;
  const scrollTop = scroller.scrollTop;
  if (!data.open) {
    if (data.error && !data.loading) list.innerHTML = prErrorHtml(data);
    else list.innerHTML = '<div class="git-loading"><span class="git-loading-dot"></span>Reading pull requests…</div>';
    list.querySelector('[data-act="retry"]')?.addEventListener('click', () => prLoad(project, state, repo.path));
    return;
  }
  const view = prShownView(data, state);
  data.viewKey = prViewKey(view);
  list.innerHTML = prListHtml(data, state.filter, new Date(), view);
  const byNumber = new Map(view.items.map(pr => [pr.number, pr]));
  list.querySelectorAll('.pr-item').forEach((item) => {
    const pr = byNumber.get(Number(item.dataset.pr));
    if (pr) prWireItem(project, state, repo.path, item, pr);
  });
  list.querySelector('[data-act="page-more"]')?.addEventListener('click', () => prLoadPage(project, state, repo.path, { more: true }));
  list.querySelector('[data-act="page-retry"]')?.addEventListener('click', () => prLoadPage(project, state, repo.path, { more: data.page.loaded }));
  prWireTextsRetry(project, state, body, list);
  scroller.scrollTop = scrollTop;
  prSearchEnsure(project, state, repo.path, view);
}

function prWireTextsRetry(project, state, body, list) {
  list.querySelector('[data-act="texts-retry"]')?.addEventListener('click', () => {
    const repo = prSelectedRepo(state);
    if (!repo) return;
    const texts = prRepoState(project.id, state, repo.path).texts;
    texts.failed.clear();
    texts.error = null;
    prPaintList(project, state, body);
  });
}

/** The icons before Merge (prLinkToolsHtml). */
function prWireLinkTools(item, pr) {
  const url = prWebUrl(pr);
  if (!url) return;
  const on = (act, run) => {
    const button = item.querySelector(`.pr-link-tools [data-act="${act}"]`);
    if (button) button.onclick = (e) => { e.stopPropagation(); run(button); };
  };
  on('copy-url', (button) => {
    window.api?.writeClipboard?.(url);
    clearTimeout(button._copiedTimer);
    button.innerHTML = PICONS.check(13);
    button.classList.add('is-done');
    button._copiedTimer = setTimeout(() => {
      button.innerHTML = PICONS.link(13);
      button.classList.remove('is-done');
    }, 1200);
  });
  on('view', () => openWebPagePanel({ url, title: prWebTitle(pr) }));
  on('window', () => window.api?.openWebWindow?.(url, prWebTitle(pr)));
  on('browser', () => window.api?.openExternal?.(url));
}

function prWireItem(project, state, repoPath, item, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const row = item.querySelector('.pr-row');
  const toggle = () => prToggle(project, state, repoPath, item, pr);
  row.onclick = (e) => {
    if (e.target.closest('[data-act="merge"], [data-act="more"], .pr-link-tools, .pr-merge-wrap, .pr-title-edit, [data-act="title-edit"]')) return;
    toggle();
  };
  row.onkeydown = (e) => {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggle();
  };
  prWireLinkTools(item, pr);
  prWireTitle(project, state, repoPath, item, pr);
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
        reopen: () => prConfirmDialog(project, state, repoPath, pr, 'reopen'),
        base: () => prChangeBaseDialog(project, state, repoPath, pr),
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
  prOpenOnHits(data, state, pr);
  prPaintDetail(project, state, repoPath, item, pr);
}

/**
 * Opened while the search is on: the tab where its words are, so they show
 * marked: Conversation for the description and the comments, Files changed
 * for the files. Not kept as the tab to open next time.
 */
function prOpenOnHits(data, state, pr) {
  const search = prSearchOf(state);
  if (!search.terms.length || typeof prdState !== 'function') return;
  const where = prSearchMatch(pr, data.texts?.map.get(pr.number) || null, search).where;
  const d = prdState(data, pr);
  if (where.body || where.comments) d.tab = 'conversation';
  else if (where.files.length) d.tab = 'files';
}

/** What is under an open row: the four tabs (pull-request-detail-view.js), or the files alone without it. */
function prPaintDetail(project, state, repoPath, item, pr) {
  if (typeof prdPaint === 'function') { prdPaint(project, state, repoPath, item, pr); return; }
  prPaintFiles(project, state, repoPath, item, pr, item.querySelector('.pr-detail'));
}

/** The Files changed tab: the pull request's files, read once per head commit, with their Viewed boxes. */
function prPaintFiles(project, state, repoPath, item, pr, slot) {
  const data = prRepoState(project.id, state, repoPath);
  const key = prFilesKey(pr);
  const entry = data.files.get(key);
  if (!entry) {
    prLoadFiles(project, state, repoPath, pr);
    slot.innerHTML = prFilesHtml({ loading: true });
    return;
  }
  if (!data.openFiles.has(key)) data.openFiles.set(key, new Set());
  if (!data.closedFolders.has(key)) data.closedFolders.set(key, new Set());
  const openPaths = data.openFiles.get(key);
  const d = typeof prdState === 'function' ? prdState(data, pr) : null;
  const viewed = d && pr.id && d.viewed && !d.viewed.error && d.viewed.map ? d.viewed.map : null;
  prWireFiles(slot, entry, {
    openPaths,
    closedFolders: data.closedFolders.get(key),
    viewed,
    search: prSearchOf(state),
    repaint: () => prPaintDetail(project, state, repoPath, item, pr),
    retry: () => { data.files.delete(key); prPaintDetail(project, state, repoPath, item, pr); },
    onView: () => prRepaint(project, state, repoPath),
    onViewed: viewed ? (file, on) => prdToggleViewed(prdContext(project, state, repoPath, item, pr), file, on, openPaths) : null,
  });
}

/**
 * Files as prFilesHtml draws them, brought to life: a file opens its diff, a
 * folder closes, Expand all and Collapse all, Tree and List (`onView`), and
 * the Viewed boxes (`onViewed`). Used by Files changed and by each commit.
 */
function prWireFiles(slot, entry, { openPaths, closedFolders, viewed = null, search = null, repaint, retry, onView, onViewed = null }) {
  slot.innerHTML = prFilesHtml(entry, { open: openPaths, view: prFileView(), closedFolders, viewed, search });
  slot.querySelector('[data-act="files-retry"]')?.addEventListener('click', () => retry?.());
  const files = entry.files || [];
  const setOpen = (button, open) => {
    const file = files[Number(button.dataset.file)];
    if (!file) return;
    if (open) openPaths.add(file.path); else openPaths.delete(file.path);
    button.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    const diff = slot.querySelector(`[data-diff="${button.dataset.file}"]`);
    if (!diff) return;
    diff.hidden = !open;
    if (open && !diff.innerHTML) diff.innerHTML = prPatchHtml(file);
  };
  slot.querySelectorAll('.pr-file').forEach((button) => {
    button.onclick = () => setOpen(button, button.getAttribute('aria-expanded') !== 'true');
  });
  slot.querySelectorAll('.pr-folder').forEach((button) => {
    button.onclick = () => {
      const folder = button.dataset.folder;
      if (closedFolders.has(folder)) closedFolders.delete(folder); else closedFolders.add(folder);
      repaint?.();
    };
  });
  slot.querySelectorAll('[data-viewed]').forEach((box) => {
    box.onchange = () => {
      const file = files[Number(box.dataset.viewed)];
      if (file) onViewed?.(file, box.checked);
    };
  });
  // Expand all opens every folder and every diff; Collapse all closes the
  // diffs and leaves the folders as they are, so the files stay in sight.
  const expandAll = slot.querySelector('[data-act="files-expand-all"]');
  if (expandAll) expandAll.onclick = () => {
    closedFolders.clear();
    for (const file of files) openPaths.add(file.path);
    repaint?.();
  };
  const collapseAll = slot.querySelector('[data-act="files-collapse-all"]');
  if (collapseAll) collapseAll.onclick = () => {
    openPaths.clear();
    repaint?.();
  };
  slot.querySelectorAll('[data-act="files-view"]').forEach((button) => {
    button.onclick = () => {
      if (button.dataset.view === prFileView()) return;
      setPrFileView(button.dataset.view);
      // One choice for every pull request: the other open ones change too.
      onView?.();
    };
  });
}

// --- The title, edited in place ---

/** Paint one row again where it is (after its title changed, or started or stopped being edited). */
function prRepaintItem(project, state, repoPath, number) {
  const body = prActiveBody(project);
  if (!body || state.selectedRepo !== repoPath) return null;
  const data = prRepoState(project.id, state, repoPath);
  const item = body.querySelector(`.pr-item[data-pr="${number}"]`);
  const pr = typeof prFindPr === 'function' ? prFindPr(data, number) : null;
  if (!item || !pr) return null;
  const holder = document.createElement('div');
  const search = prSearchOf(state);
  const where = search.terms.length ? prSearchMatch(pr, data.texts?.map.get(number) || null, search).where : null;
  holder.innerHTML = prRowHtml(pr, { expanded: data.expanded.has(number), repo: data.open?.repo || null, titleEdit: prTitleEditOf(data, pr), search: search.terms.length ? search : null, where }).trim();
  const fresh = holder.firstElementChild;
  item.replaceWith(fresh);
  prWireItem(project, state, repoPath, fresh, pr);
  return fresh;
}

function prFocusTitle(item) {
  const input = item?.querySelector('.pr-title-input');
  if (!input || input.disabled) return;
  input.focus();
  input.select();
}

function prWireTitle(project, state, repoPath, item, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const key = `title:${pr.number}`;
  const pencil = item.querySelector('[data-act="title-edit"]');
  if (pencil) {
    pencil.onclick = (e) => {
      e.stopPropagation();
      data.titleEdit = { number: pr.number, busy: false, error: '' };
      data.drafts.set(key, pr.title);
      prFocusTitle(prRepaintItem(project, state, repoPath, pr.number));
    };
  }
  const input = item.querySelector('.pr-title-input');
  if (!input) return;
  const save = item.querySelector('[data-act="title-save"]');
  const cancel = () => {
    data.titleEdit = null;
    data.drafts.delete(key);
    prRepaintItem(project, state, repoPath, pr.number);
  };
  input.onclick = (e) => e.stopPropagation();
  input.oninput = () => data.drafts.set(key, input.value);
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); prSaveTitle(project, state, repoPath, pr); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  // The button keeps the field's focus, so the row is not painted again under the click.
  if (save) {
    save.onmousedown = (e) => e.preventDefault();
    save.onclick = (e) => { e.stopPropagation(); prSaveTitle(project, state, repoPath, pr); };
  }
}

/** Save the title being edited: refused when empty, nothing when unchanged; GitHub's refusal stays beside the field. */
async function prSaveTitle(project, state, repoPath, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const key = `title:${pr.number}`;
  if (!data.titleEdit || data.titleEdit.number !== pr.number || data.titleEdit.busy) return;
  const text = String(data.drafts.get(key) ?? pr.title).trim();
  const fail = (error) => {
    data.titleEdit = { number: pr.number, busy: false, error };
    prFocusTitle(prRepaintItem(project, state, repoPath, pr.number));
  };
  if (!text) { fail('A title cannot be empty.'); return; }
  if (text === pr.title) {
    data.titleEdit = null;
    data.drafts.delete(key);
    prRepaintItem(project, state, repoPath, pr.number);
    return;
  }
  if (!pr.id) { fail('Refresh the list, then try again.'); return; }
  data.titleEdit = { number: pr.number, busy: true, error: '' };
  prRepaintItem(project, state, repoPath, pr.number);
  const result = await prApi('editPullRequest', project.id, repoPath, prRemoteOpts(data, { kind: 'title', pullRequestId: pr.id, title: text }));
  if (state.repos.get(repoPath) !== data) return;
  if (!result?.ok) { fail(result?.error || 'GitHub did not take the title.'); return; }
  for (const item of [...(data.open?.items || []), ...(data.page?.items || [])]) if (item.number === pr.number) item.title = text;
  pr.title = text;
  const conversation = data.detail?.get(pr.number)?.conversation;
  if (conversation?.pr) conversation.pr.title = text;
  data.titleEdit = null;
  data.drafts.delete(key);
  prRepaintItem(project, state, repoPath, pr.number);
  prLoad(project, state, repoPath, { quiet: true });
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

/**
 * A menu of checkboxes under `button` (the filter's, People's): `paint(menu)`
 * fills it, again after each change. A second click on the button, a click
 * elsewhere or Escape closes it.
 */
function prOpenCheckMenu(button, className, paint) {
  if (document.querySelector('.pr-filter-menu')) { prCloseFilterMenu(); return null; }
  const menu = document.createElement('div');
  menu.className = `ctx-menu pr-filter-menu${className ? ` ${className}` : ''}`;
  menu.setAttribute('role', 'menu');
  paint(menu);
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
  return menu;
}

function prOpenFilterMenu(project, state, body, button) {
  const paint = (menu) => {
    menu.innerHTML = PR_FILTERS.map(([key, label]) => {
      const on = state.filter.includes(key);
      const last = on && state.filter.length === 1;
      return `<label class="pr-filter-option${last ? ' is-last' : ''}" title="${last ? 'At least one stays chosen' : ''}"><input type="checkbox" data-key="${key}"${on ? ' checked' : ''}${last ? ' disabled' : ''}><span class="pr-state pr-state--${key}">${PR_ICONS[key](13)}</span><span>${escapeHtml(label)}</span></label>`;
    }).join('') + (prIsDefaultFilter(state.filter) ? '' : '<div class="ctx-sep"></div><button type="button" class="pr-filter-reset" data-act="reset">Open and draft only</button>');
    menu.querySelectorAll('input[data-key]').forEach((input) => {
      input.onchange = () => { prSetFilter(project, state, body, prToggleFilter(state.filter, input.dataset.key)); paint(menu); };
    });
    const reset = menu.querySelector('[data-act="reset"]');
    if (reset) reset.onclick = () => { prSetFilter(project, state, body, [...PR_DEFAULT_FILTER]); paint(menu); };
  };
  prOpenCheckMenu(button, '', paint);
}

/**
 * People: the authors of the pull requests the states filter shows, several
 * at once, the account's own first, each with how many it wrote. None chosen
 * is everyone.
 */
function prOpenPeopleMenu(project, state, body, button) {
  const repo = prSelectedRepo(state);
  const data = repo ? prRepoState(project.id, state, repo.path) : null;
  const paint = (menu) => {
    const items = data ? prMergeLists(data.open?.items, data.page?.items, state.filter) : [];
    const choices = prPeopleChoices(items, state.people);
    const avatar = (c) => (typeof prdAvatarHtml === 'function' ? prdAvatarHtml(c.login, c.avatar, 16) : '');
    menu.innerHTML = (choices.length
      ? choices.map((c) => {
        const on = (state.people || []).includes(c.login);
        return `<label class="pr-filter-option pr-person"><input type="checkbox" data-login="${prAttr(c.login)}"${on ? ' checked' : ''}>${avatar(c)}<span class="pr-person-name">${escapeHtml(c.login)}${c.you ? ' <span class="pr-person-you">you</span>' : ''}</span><span class="pr-person-count">${c.count}</span></label>`;
      }).join('')
      : '<div class="pr-filter-empty">No pull requests listed yet.</div>')
      + ((state.people || []).length ? '<div class="ctx-sep"></div><button type="button" class="pr-filter-reset" data-act="everyone">Everyone</button>' : '');
    menu.querySelectorAll('input[data-login]').forEach((input) => {
      input.onchange = () => { prSetPeople(project, state, body, prTogglePerson(state.people, input.dataset.login)); paint(menu); };
    });
    const everyone = menu.querySelector('[data-act="everyone"]');
    if (everyone) everyone.onclick = () => { prSetPeople(project, state, body, []); paint(menu); };
  };
  prOpenCheckMenu(button, 'pr-people-menu', paint);
}

function prSetPeople(project, state, body, people) {
  state.people = people;
  const label = body.querySelector('#pr-people-label');
  if (label) label.textContent = prPeopleLabel(people);
  body.querySelector('#pr-people')?.classList.toggle('is-on', people.length > 0);
  prPaintList(project, state, body);
}

/** Prompt: copy a prompt, in English, naming the pull requests shown right now (pull-request-search.js, prPromptText). */
function prOpenPromptMenu(project, state, button) {
  const repo = prSelectedRepo(state);
  if (!repo) return;
  const data = prRepoState(project.id, state, repo.path);
  const shown = data.open ? prShownView(data, state).items : [];
  const what = { numbers: 'the numbers', titles: 'the numbers and titles' };
  showContextMenu([
    { head: shown.length ? `${prPlural(shown.length, 'pull request')} shown` : 'No pull requests shown' },
    ...PR_PROMPTS.map(([kind, label]) => ({
      label,
      icon: PR_ICONS.prompt(13),
      disabled: !shown.length,
      onClick: () => {
        window.api?.writeClipboard?.(prPromptText(kind, shown, data.open?.repo));
        prSetNotice(project, state, { kind: 'ok', text: `Copied a prompt with ${what[kind]} of ${prPlural(shown.length, 'pull request')}.` });
      },
    })),
  ], { anchor: button });
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
  const narrowed = (state.people || []).length > 0 || prSearchOf(state).terms.length > 0;
  const size = narrowed ? PR_NARROWED_PAGE_SIZE : PR_PAGE_SIZE;
  const first = refill ? Math.min(100, Math.max(size, refill)) : size;
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
  } else {
    data.files.set(key, { error: result?.error || 'The changed files could not be read.' });
  }
  prRepaintDetail(project, state, repoPath, pr);
}

/**
 * The search needs the texts of the pull requests it looks through: those
 * never read, or changed on GitHub since, PR_TEXTS_BATCH a request, at most
 * PR_TEXTS_PARALLEL requests at once; each answer asks for the next ones.
 */
function prSearchEnsure(project, state, repoPath, view) {
  if (!view || !view.search?.terms.length) return;
  const data = prRepoState(project.id, state, repoPath);
  const texts = data.texts;
  const need = view.candidates
    .filter(pr => !texts.pending.has(pr.number) && !texts.failed.has(pr.number) && prTextsStale(texts.map.get(pr.number), pr))
    .map(pr => pr.number);
  while (texts.running < PR_TEXTS_PARALLEL && need.length) prReadTexts(project, state, repoPath, need.splice(0, PR_TEXTS_BATCH));
}

async function prReadTexts(project, state, repoPath, numbers) {
  const data = prRepoState(project.id, state, repoPath);
  const texts = data.texts;
  texts.running++;
  for (const n of numbers) texts.pending.add(n);
  const result = await prApi('getPullRequestTexts', project.id, repoPath, prRemoteOpts(data, { numbers }));
  texts.running--;
  for (const n of numbers) texts.pending.delete(n);
  if (state.repos.get(repoPath) !== data) return;
  if (result?.ok) {
    const got = new Set();
    for (const item of result.items || []) { texts.map.set(item.number, item); got.add(item.number); }
    const missing = numbers.filter(n => !got.has(n));
    for (const n of missing) texts.failed.add(n);
    if (missing.length) texts.error = 'GitHub did not give them.';
  } else {
    for (const n of numbers) texts.failed.add(n);
    texts.error = result?.error || 'GitHub could not be read.';
  }
  prAfterTexts(project, state, repoPath);
}

/** After texts came: the rows again if what shows changed, else only the search's line; then the next ones. */
function prAfterTexts(project, state, repoPath) {
  const body = prActiveBody(project);
  const list = body?.querySelector('#pr-list');
  if (!list || state.selectedRepo !== repoPath) return;
  const data = prRepoState(project.id, state, repoPath);
  const view = prShownView(data, state);
  if (prViewKey(view) !== data.viewKey) { prPaintList(project, state, body); return; }
  const line = list.querySelector('#pr-search-status');
  if (line) {
    line.outerHTML = prSearchStatusHtml(data, view);
    prWireTextsRetry(project, state, body, list);
  } else if (view.search.terms.length) {
    prPaintList(project, state, body);
    return;
  }
  prSearchEnsure(project, state, repoPath, view);
}

async function prRefresh(project, state, repoPath, { notice = false } = {}) {
  if (notice) {
    prSetNotice(project, state, { kind: 'busy', text: 'Reading pull requests…' });
    // The search tries again the pull requests it could not read.
    const texts = prRepoState(project.id, state, repoPath).texts;
    texts.failed.clear();
    texts.error = null;
    // What the open pull requests' tabs read is read again when they are painted.
    for (const d of prRepoState(project.id, state, repoPath).detail.values()) {
      for (const what of ['conversation', 'commits', 'checks', 'viewed']) if (d[what]) d[what].loadedAt = 0;
    }
  }
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
    prSearchOf, prShownView, prSearchStatusHtml, prViewKey, prSearchEnsure,
    prCanEdit, prMergeBlock, prRowMenuItems, prWebUrl, prLinkToolsHtml, prWebTitle, prFileRows, prFileView, prFilesToolsHtml, prRowHtml, prListHtml, prFooterHtml, prFilesHtml,
    prTitleEditHtml, prTitleEditOf,
    prPatchHtml, prMergeDialogHtml, prMergeParams, prConfirmHtml, prBadgesHtml, prSummaryText, prErrorHtml, prRepoData, prEmptyPage,
  };
}
