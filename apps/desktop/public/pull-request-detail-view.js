// pull-request-detail-view.js — an open pull request in the Pull Requests view,
// as GitHub's page of it: four tabs (Conversation, Commits, Checks, Files
// changed), the conversation with its sidebar (reviewers, assignees, labels),
// the editors of every message, reviews, the commits and their files, the
// checks with their logs and re-runs. project-pull-requests-view.js draws the
// list and its rows; this file draws what is under an open row (prdPaint) and
// the dialogs of Change base, Hide and Review changes.
//
// Every read and every change goes through window.api (pull-request-detail.js
// and pull-request-edits.js in the main process, through gh). Each tab reads
// its data when it is first shown and keeps it per pull request; a change
// reads again what it touched. GitHub's HTML passes through prSafeHtml
// (pull-request-markdown.js).
//
// While the focus is in a field of an open pull request (a comment being
// written, the title), the view does not paint that pull request again: the
// repaint waits until the focus leaves (prFlushPending), and the drafts of
// every editor live in the repository's state, so a repaint puts them back.

const PR_DETAIL_TABS = [['conversation', 'Conversation'], ['commits', 'Commits'], ['checks', 'Checks'], ['files', 'Files changed']];
const PR_DETAIL_TAB_KEY = 'pullRequests.detailTab';
const PR_DETAIL_STALE_MS = 60_000;
const PR_CHECKS_POLL_MS = 15_000;
const PR_REACTIONS = [
  ['THUMBS_UP', '👍'], ['THUMBS_DOWN', '👎'], ['LAUGH', '😄'], ['HOORAY', '🎉'],
  ['CONFUSED', '😕'], ['HEART', '❤️'], ['ROCKET', '🚀'], ['EYES', '👀'],
];
const PR_HIDE_REASONS = [['OUTDATED', 'Outdated'], ['RESOLVED', 'Resolved'], ['DUPLICATE', 'Duplicate'], ['OFF_TOPIC', 'Off-topic'], ['SPAM', 'Spam'], ['ABUSE', 'Abuse']];
const PR_ASSOCIATIONS = {
  OWNER: 'Owner', MEMBER: 'Member', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor',
  FIRST_TIME_CONTRIBUTOR: 'First-time contributor', FIRST_TIMER: 'First-time contributor',
};
const PR_REVIEW_STATES = {
  APPROVED: { word: 'approved these changes', icon: 'check', kind: 'ok' },
  CHANGES_REQUESTED: { word: 'requested changes', icon: 'x', kind: 'fail' },
  COMMENTED: { word: 'reviewed', icon: 'messages', kind: 'muted' },
  DISMISSED: { word: 'reviewed (dismissed)', icon: 'messages', kind: 'muted' },
  PENDING: { word: 'started a review', icon: 'messages', kind: 'muted' },
};

// --- State ---

function prDetailTab() {
  let stored = null;
  try { stored = localStorage.getItem(PR_DETAIL_TAB_KEY); } catch {}
  return PR_DETAIL_TABS.some(([key]) => key === stored) ? stored : 'conversation';
}

function setPrDetailTab(tab) {
  try { localStorage.setItem(PR_DETAIL_TAB_KEY, tab); } catch {}
}

/** What one open pull request keeps: the tab shown, each tab's data, what is open in it, the editors open. */
function prdState(data, pr) {
  if (!data.detail) data.detail = new Map();
  if (!data.drafts) data.drafts = new Map();
  let d = data.detail.get(pr.number);
  if (!d) {
    d = {
      tab: prDetailTab(),
      conversation: null, // { loading } | { pr, items, threads, hasNextPage, endCursor, loadedAt } | { error }
      commits: null,      // { list, totalCount, truncated } …
      checks: null,       // { list, summary, rollup } …
      viewed: null,       // { map } …
      openCommits: new Set(),
      commitFiles: new Map(),  // oid → { loading } | { files, truncated } | { error }
      commitOpen: new Map(),   // oid → Set of file paths shown open
      commitFolders: new Map(),
      logs: new Map(),         // job id → { loading } | { text, truncated } | { error }
      openLogs: new Set(),
      openThreads: new Set(),  // resolved threads shown open
      shownHidden: new Set(),  // hidden comments shown anyway
      editors: new Set(),      // keys of the editors open (the description, a comment, a thread's reply)
      busy: new Set(),         // what is being changed right now (a reaction, a resolve…)
      pending: false,
      pollTimer: null,
    };
    data.detail.set(pr.number, d);
  }
  return d;
}

/** The pull request as the list has it now, by number (the list may have been read again). */
function prFindPr(data, number) {
  for (const pr of [...(data.open?.items || []), ...(data.page?.items || [])]) if (pr.number === number) return pr;
  return null;
}

/** True while the focus is in a text field inside `el`: the moment not to paint it again. */
function prTypingIn(el) {
  if (!el || typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active || !el.contains(active)) return false;
  return active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && /^(text|search|)$/i.test(active.type || ''));
}

// --- Small pieces ---

function prdAvatarHtml(login, url, size = 20) {
  const safe = typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
  if (safe) {
    const sized = `${safe}${safe.includes('?') ? '&' : '?'}s=${size * 2}`;
    return `<img class="pr-avatar" src="${prAttr(sized)}" width="${size}" height="${size}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  return `<span class="pr-avatar pr-avatar--none" style="width:${size}px;height:${size}px" aria-hidden="true">${escapeHtml(String(login || '?').slice(0, 1).toUpperCase())}</span>`;
}

function prdWhen(iso, now) {
  const text = prRelative(iso, now);
  return text ? `<span class="pr-when" title="${prAttr(iso || '')}">${escapeHtml(text)}</span>` : '';
}

/** "3m 12s", "45s", "1h 2m": how long a check ran. */
function prdDuration(start, end) {
  const a = Date.parse(start || '');
  const b = Date.parse(end || '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '';
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** A label's colours on the dark page: its own hue, lightened when it is dark. */
function prdLabelStyle(color) {
  const hex = /^[0-9a-f]{6}$/i.test(color || '') ? color : '8a8aa0';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mix = light < 0.55 ? 0.5 : 0.1;
  const text = [r, g, b].map(v => Math.round(v + (255 - v) * mix));
  return `--label-bg:rgba(${r},${g},${b},0.18);--label-border:rgba(${r},${g},${b},0.45);--label-text:rgb(${text.join(',')})`;
}

function prdLabelHtml(label) {
  return `<span class="pr-label" style="${prdLabelStyle(label.color)}" title="${prAttr(label.description || label.name)}">${escapeHtml(label.name)}</span>`;
}

function prdCheckDot(state) {
  const kind = state === 'SUCCESS' ? 'ok' : (state === 'FAILURE' || state === 'ERROR') ? 'fail' : (state === 'PENDING' || state === 'EXPECTED') ? 'wait' : null;
  if (!kind) return '';
  const title = { ok: 'Checks passed', fail: 'Checks failed', wait: 'Checks running' }[kind];
  return `<span class="pr-dot pr-dot--${kind}" title="${title}" aria-label="${title}"></span>`;
}

// --- Tabs ---

/** The tabs' counts: from the conversation once read (GitHub counts them per pull request), the checks once read, the files from the list. */
function prdCounts(pr, d) {
  const head = d.conversation?.pr;
  return {
    conversation: head ? head.comments : (pr.comments ?? null),
    commits: d.commits?.list ? d.commits.totalCount : (head ? head.commitCount : (pr.commitCount ?? null)),
    checks: d.checks?.list ? d.checks.list.length : null,
    files: pr.changedFiles ?? null,
  };
}

function prdCanReview(pr) {
  return pr.state === 'OPEN';
}

function prdTabsHtml(pr, d) {
  const counts = prdCounts(pr, d);
  const tabs = PR_DETAIL_TABS.map(([key, label]) => {
    const on = d.tab === key;
    const count = counts[key] == null ? '' : `<span class="pr-tab-count">${counts[key]}</span>`;
    const dot = key === 'checks' ? prdCheckDot(d.checks?.rollup || pr.checks) : '';
    return `<button type="button" class="pr-tab${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-tab="${key}">${escapeHtml(label)}${count}${dot}</button>`;
  }).join('');
  const review = prdCanReview(pr) ? `<button type="button" class="ws-btn ws-btn--sm" data-act="review">${PICONS.messages(12)}<span>Review changes</span></button>` : '';
  return `<div class="pr-tabs" role="tablist" aria-label="Pull request #${pr.number}">${tabs}<span class="pr-tabs-end">${review}</span></div>`;
}

// --- Conversation: the pieces ---

function prdAssociationHtml(message, prAuthor) {
  const badges = [];
  if (message.author && message.author === prAuthor && message.kind !== 'description') badges.push('Author');
  const role = PR_ASSOCIATIONS[message.association];
  if (role) badges.push(role);
  return badges.map(b => `<span class="pr-assoc">${escapeHtml(b)}</span>`).join('');
}

function prdReactionsHtml(message) {
  const chips = (message.reactions || []).map((r) => {
    const emoji = (PR_REACTIONS.find(([c]) => c === r.content) || [])[1] || r.content;
    return `<button type="button" class="pr-reaction${r.mine ? ' mine' : ''}" data-react="${prAttr(r.content)}" data-subject="${prAttr(message.id)}" aria-pressed="${r.mine}"${message.can?.react ? '' : ' disabled'} title="${prAttr(r.mine ? 'Take your reaction back' : 'React too')}">${emoji}<span>${r.count}</span></button>`;
  }).join('');
  if (!chips) return '';
  return `<div class="pr-reactions">${chips}</div>`;
}

/** The words of a message's header: "commented", "approved these changes"… */
function prdVerb(message) {
  if (message.kind === 'description') return 'opened this';
  if (message.kind === 'review') return (PR_REVIEW_STATES[message.state] || PR_REVIEW_STATES.COMMENTED).word;
  return 'commented';
}

/**
 * One message: the description, a comment, a review or a review comment. An
 * open editor takes the place of its text; a hidden one shows as a line.
 */
function prdMessageHtml(message, { prAuthor = '', now = new Date(), editing = false, draft = null, shownHidden = false, compact = false } = {}) {
  const key = prdEditorKey(message);
  const hidden = message.minimized && !shownHidden;
  const edited = message.editedAt ? `<span class="pr-edited" title="${prAttr(`Edited ${message.editedAt}`)}">edited</span>` : '';
  const state = message.kind === 'review' ? (PR_REVIEW_STATES[message.state] || PR_REVIEW_STATES.COMMENTED) : null;
  const icon = state ? `<span class="pr-review-icon pr-review-icon--${state.kind}">${PICONS[state.icon] ? PICONS[state.icon](12) : ''}</span>` : '';
  const tools = `
        <span class="pr-msg-tools">
          ${message.can?.react && message.id ? `<button type="button" class="pr-msg-tool" data-act="react-add" data-subject="${prAttr(message.id)}" title="Add a reaction" aria-label="Add a reaction">☺︎</button>` : ''}
          <button type="button" class="pr-msg-tool" data-act="msg-more" data-msg="${prAttr(message.id || 'description')}" title="More" aria-label="More for this message">${PICONS.dots(12)}</button>
        </span>`;
  let body;
  if (editing) {
    body = prEditorHtml({
      key,
      text: draft ?? message.body ?? '',
      placeholder: message.kind === 'description' ? 'Describe the change' : 'Leave a comment',
      buttons: [{ act: 'save', label: message.kind === 'description' ? 'Update description' : 'Update comment', primary: true }],
      cancel: true,
    });
  } else if (hidden) {
    body = `<div class="pr-msg-hidden">This comment was hidden as ${escapeHtml(String(message.minimized).replace(/_/g, ' '))}. <button type="button" class="pr-link-btn" data-act="show-hidden" data-msg="${prAttr(message.id)}">Show it</button></div>`;
  } else if (message.body && message.body.trim()) {
    body = `<div class="pr-msg-body pr-md">${prSafeHtml(message.bodyHtml, message.body)}</div>`;
  } else {
    body = message.kind === 'description' ? '<div class="pr-msg-body pr-muted">No description provided.</div>' : '';
  }
  return `
    <article class="pr-msg${compact ? ' pr-msg--compact' : ''}${message.kind === 'review' ? ' pr-msg--review' : ''}" data-msg="${prAttr(message.id || 'description')}">
      <header class="pr-msg-head">
        ${prdAvatarHtml(message.author, message.avatar, compact ? 18 : 22)}
        ${icon}
        <span class="pr-msg-author">${escapeHtml(message.author || 'ghost')}</span>
        <span class="pr-msg-verb">${escapeHtml(prdVerb(message))}</span>
        ${prdWhen(message.submittedAt || message.createdAt, now)}
        ${edited}
        ${prdAssociationHtml(message, prAuthor)}
        ${tools}
      </header>
      ${body}
      ${editing || hidden ? '' : prdReactionsHtml(message)}
    </article>`;
}

function prdEditorKey(message) {
  return message.kind === 'description' ? 'edit:description' : `edit:${message.id}`;
}

/** The last lines of a thread's diff hunk, where the comment was made, its code in the editors' colours by `path`. */
function prdHunkHtml(hunk, lines = 5, path = '') {
  const all = String(hunk || '').split('\n');
  const head = all[0] && all[0].startsWith('@@') ? [all[0]] : [];
  const tail = all.slice(head.length).slice(-lines);
  if (!tail.length) return '';
  const text = [...head, ...tail].join('\n');
  return `<pre class="git-diff pr-thread-hunk">${typeof gitDiffLines === 'function' ? gitDiffLines(text, { filename: path }) : escapeHtml(text)}</pre>`;
}

function prdThreadHtml(thread, { prAuthor = '', now = new Date(), d, drafts }) {
  const open = !thread.resolved || d.openThreads.has(thread.id);
  const replyKey = `reply:${thread.id}`;
  const replying = d.editors.has(replyKey);
  const flags = [
    thread.outdated ? '<span class="pr-flag">Outdated</span>' : '',
    thread.resolved ? `<span class="pr-flag pr-flag--ok">Resolved${thread.resolvedBy ? ` by ${escapeHtml(thread.resolvedBy)}` : ''}</span>` : '',
  ].join('');
  const comments = open ? thread.comments.map(c => prdMessageHtml(c, {
    prAuthor, now, compact: true,
    editing: d.editors.has(prdEditorKey(c)), draft: drafts.get(prdEditorKey(c)), shownHidden: d.shownHidden.has(c.id),
  })).join('') : '';
  const resolveBtn = thread.resolved
    ? (thread.can.unresolve ? '<button type="button" class="ws-ghost ws-ghost--sm" data-act="thread-unresolve">Unresolve conversation</button>' : '')
    : (thread.can.resolve ? '<button type="button" class="ws-ghost ws-ghost--sm" data-act="thread-resolve">Resolve conversation</button>' : '');
  const reply = !open || !thread.can.reply ? '' : (replying
    ? prEditorHtml({ key: replyKey, text: drafts.get(replyKey) || '', placeholder: 'Reply', buttons: [{ act: 'reply', label: 'Reply', primary: true }], cancel: true })
    : '<button type="button" class="pr-reply-btn" data-act="thread-reply">Reply…</button>');
  return `
    <div class="pr-thread${thread.resolved ? ' is-resolved' : ''}" data-thread="${prAttr(thread.id)}">
      <div class="pr-thread-head">
        <button type="button" class="pr-thread-toggle" data-act="thread-toggle" aria-expanded="${open}"${thread.resolved ? '' : ' disabled'}>
          ${thread.resolved ? `<span class="pr-chevron">${PICONS.chevronRight(10)}</span>` : ''}
          <span class="pr-thread-path mono" title="${prAttr(thread.path)}">${escapeHtml(thread.path)}</span>
          ${thread.line != null ? `<span class="pr-thread-line">line ${thread.line}</span>` : ''}
        </button>
        ${flags}
      </div>
      ${open ? prdHunkHtml(thread.diffHunk, 5, thread.path) : ''}
      ${comments}
      ${open ? `<div class="pr-thread-actions">${reply}${replying ? '' : resolveBtn}</div>` : ''}
    </div>`;
}

const PR_EVENT_ICONS = {
  'force-pushed': 'push', 'base-changed': 'branch', renamed: 'pencil', closed: 'x', reopened: 'refresh', merged: 'merge',
  ready: 'check', draft: 'pencil', 'review-requested': 'messages', 'review-request-removed': 'messages', 'review-dismissed': 'x',
  labeled: 'tag', unlabeled: 'tag', assigned: 'file', unassigned: 'file', 'branch-deleted': 'trash', 'branch-restored': 'branch',
};

/** One event of the timeline as a sentence (HTML, every value escaped). */
function prdEventText(event) {
  const who = `<b>${escapeHtml(event.actor || 'ghost')}</b>`;
  const code = text => `<span class="mono pr-event-ref">${escapeHtml(text || '')}</span>`;
  switch (event.type) {
    case 'force-pushed': return `${who} force-pushed the branch from ${code(event.from)} to ${code(event.to)}`;
    case 'base-changed': return `${who} changed the base branch from ${code(event.from)} to ${code(event.to)}`;
    case 'renamed': return `${who} changed the title <del>${escapeHtml(event.from)}</del> ${escapeHtml(event.to)}`;
    case 'closed': return `${who} closed this`;
    case 'reopened': return `${who} reopened this`;
    case 'merged': return `${who} merged commit ${code(event.commit)} into ${code(event.to)}`;
    case 'ready': return `${who} marked this pull request as ready for review`;
    case 'draft': return `${who} marked this pull request as draft`;
    case 'review-requested': return `${who} requested a review from <b>${escapeHtml(event.subject || 'someone')}</b>`;
    case 'review-request-removed': return `${who} removed the review request for <b>${escapeHtml(event.subject || 'someone')}</b>`;
    case 'review-dismissed': return `${who} dismissed <b>${escapeHtml(event.subject || 'someone')}</b>'s review${event.message ? `: ${escapeHtml(event.message)}` : ''}`;
    case 'labeled': return `${who} added the ${prdLabelHtml(event.label || { name: '' })} label`;
    case 'unlabeled': return `${who} removed the ${prdLabelHtml(event.label || { name: '' })} label`;
    case 'assigned': return event.subject === event.actor ? `${who} self-assigned this` : `${who} assigned <b>${escapeHtml(event.subject || 'someone')}</b>`;
    case 'unassigned': return `${who} unassigned <b>${escapeHtml(event.subject || 'someone')}</b>`;
    case 'branch-deleted': return `${who} deleted the ${code(event.to)} branch`;
    case 'branch-restored': return `${who} restored the head branch`;
    default: return who;
  }
}

function prdEventHtml(event, now) {
  const icon = PICONS[PR_EVENT_ICONS[event.type]] ? PICONS[PR_EVENT_ICONS[event.type]](12) : '';
  return `<div class="pr-event pr-event--${prAttr(event.type)}"><span class="pr-event-icon">${icon}</span><span class="pr-event-text">${prdEventText(event)}</span>${prdWhen(event.createdAt, now)}</div>`;
}

function prdCommitsGroupHtml(commits, now) {
  const author = commits[0].author;
  const same = commits.every(c => c.author === author);
  const head = `${same ? `<b>${escapeHtml(author)}</b>` : 'Commits were'} added ${prPlural(commits.length, 'commit')}`;
  const rows = commits.map(c => `
        <div class="pr-event-commit">${prdCheckDot(c.checks)}<span class="pr-event-commit-title" title="${prAttr(c.headline)}">${escapeHtml(c.headline)}</span><span class="mono pr-event-ref">${escapeHtml(c.short)}</span></div>`).join('');
  return `<div class="pr-event pr-event--commits"><span class="pr-event-icon">${PICONS.push ? PICONS.push(12) : ''}</span><div class="pr-event-body"><span class="pr-event-text">${head}</span>${prdWhen(commits[commits.length - 1].createdAt, now)}${rows}</div></div>`;
}

/** The box at the end of an open pull request's conversation: checks, reviews, conflicts, and Update branch when it is behind. */
function prdStatusBoxHtml(pr, conv) {
  if (pr.state !== 'OPEN') return '';
  const head = conv?.pr || {};
  const rows = [];
  const checks = head.checks ?? pr.checks;
  if (checks === 'SUCCESS') rows.push(['ok', 'All checks have passed']);
  else if (checks === 'FAILURE' || checks === 'ERROR') rows.push(['fail', 'Some checks were not successful']);
  else if (checks === 'PENDING' || checks === 'EXPECTED') rows.push(['wait', 'Some checks haven\'t completed yet']);
  const decision = head.reviewDecision ?? pr.reviewDecision;
  if (decision === 'APPROVED') rows.push(['ok', 'Changes approved']);
  else if (decision === 'CHANGES_REQUESTED') rows.push(['fail', 'Changes requested']);
  else if (decision === 'REVIEW_REQUIRED') rows.push(['wait', 'Review required']);
  if ((head.mergeable ?? pr.mergeable) === 'CONFLICTING') rows.push(['fail', `This branch has conflicts with ${pr.base} that must be resolved`]);
  if (pr.isDraft) rows.push(['muted', 'This pull request is still a work in progress']);
  const behind = (head.mergeStateStatus ?? pr.mergeStateStatus) === 'BEHIND';
  const canUpdate = head.can ? head.can.updateBranch : pr.viewerCanUpdateBranch;
  let update = '';
  if (behind) {
    rows.push(['wait', 'This branch is out-of-date with the base branch']);
    if (canUpdate) {
      update = `<div class="pr-status-update"><span>Merge the latest changes from ${escapeHtml(pr.base)} into this branch.</span>
          <button type="button" class="ws-btn ws-btn--sm" data-act="update-branch" data-method="MERGE">Update with merge commit</button>
          <button type="button" class="ws-btn ws-btn--sm" data-act="update-branch" data-method="REBASE">Update with rebase</button></div>`;
    }
  }
  if (!rows.length) return '';
  return `
    <div class="pr-status">
      ${rows.map(([kind, text]) => `<div class="pr-status-row pr-status-row--${kind}"><span class="pr-dot pr-dot--${kind}"></span><span>${escapeHtml(text)}</span></div>`).join('')}
      ${update}
    </div>`;
}

function prdComposerHtml(pr, conv, drafts) {
  const key = `composer:${pr.number}`;
  const head = conv?.pr || {};
  const buttons = [];
  if (pr.state === 'OPEN' && (head.can ? head.can.close : pr.viewerCanClose)) buttons.push({ act: 'close', label: 'Close with comment' });
  if (pr.state === 'CLOSED' && (head.can ? head.can.reopen : pr.viewerCanReopen)) buttons.push({ act: 'reopen', label: 'Reopen with comment' });
  buttons.push({ act: 'comment', label: 'Comment', primary: true });
  return `<div class="pr-composer">${prEditorHtml({ key, text: drafts.get(key) || '', placeholder: 'Leave a comment', buttons })}</div>`;
}

// --- Sidebar ---

function prdReviewerStateHtml(state) {
  const s = {
    APPROVED: ['ok', 'Approved'], CHANGES_REQUESTED: ['fail', 'Requested changes'], COMMENTED: ['muted', 'Commented'],
    DISMISSED: ['muted', 'Dismissed'], REQUESTED: ['wait', 'Awaiting review'], PENDING: ['wait', 'Awaiting review'],
  }[state] || ['muted', ''];
  return `<span class="pr-dot pr-dot--${s[0]}" title="${prAttr(s[1])}" aria-label="${prAttr(s[1])}"></span>`;
}

function prdSidebarHtml(head) {
  const section = (key, title, editable, items, empty) => `
      <section class="pr-side" data-side="${key}">
        <header class="pr-side-head"><span>${title}</span>${editable ? `<button type="button" class="pr-side-edit" data-act="side-edit" data-side="${key}" title="Edit ${title.toLowerCase()}" aria-label="Edit ${title.toLowerCase()}">${PICONS.gear(12)}</button>` : ''}</header>
        <div class="pr-side-body">${items || `<span class="pr-muted">${empty}</span>`}</div>
      </section>`;
  const reviewers = (head.reviewers || []).map(r => `<div class="pr-side-person">${r.kind === 'team' ? `<span class="pr-avatar pr-avatar--none" style="width:18px;height:18px">${PICONS.messages(10)}</span>` : prdAvatarHtml(r.login, r.avatar, 18)}<span>${escapeHtml(r.kind === 'team' ? r.name : r.login)}</span>${prdReviewerStateHtml(r.state)}</div>`).join('');
  const assignees = (head.assignees || []).map(a => `<div class="pr-side-person">${prdAvatarHtml(a.login, a.avatar, 18)}<span>${escapeHtml(a.login)}</span></div>`).join('');
  const labels = (head.labels || []).length ? `<div class="pr-side-labels">${head.labels.map(prdLabelHtml).join('')}</div>` : '';
  return `
    <aside class="pr-sidebar" aria-label="Reviewers, assignees and labels">
      ${section('reviewers', 'Reviewers', !!head.can?.update && head.state === 'OPEN', reviewers, 'No reviews')}
      ${section('assignees', 'Assignees', !!head.can?.assign, assignees, 'No one assigned')}
      ${section('labels', 'Labels', !!head.can?.label, labels, 'None yet')}
    </aside>`;
}

// --- Conversation: the whole tab ---

/**
 * The timeline as GitHub shows it: commits in a row grouped, each review with
 * its threads under it; threads whose review is not in the pages read yet
 * come at the end once every page is read.
 */
function prdTimelineHtml(conv, { pr, now, d, drafts }) {
  const parts = [];
  const threadsByReview = new Map();
  for (const thread of conv.threads || []) {
    const list = threadsByReview.get(thread.reviewId) || [];
    list.push(thread);
    threadsByReview.set(thread.reviewId, list);
  }
  const shown = new Set();
  let commits = [];
  const flush = () => { if (commits.length) parts.push(prdCommitsGroupHtml(commits, now)); commits = []; };
  for (const item of conv.items || []) {
    if (item.kind === 'commit') { commits.push(item); continue; }
    flush();
    if (item.kind === 'event') { parts.push(prdEventHtml(item, now)); continue; }
    const threads = item.kind === 'review' ? (threadsByReview.get(item.id) || []) : [];
    // A review that is nothing but its threads' comments shows them only.
    if (item.kind === 'review' && !item.body.trim() && threads.length && item.state === 'COMMENTED') {
      parts.push(`<div class="pr-event pr-event--review"><span class="pr-event-icon">${PICONS.messages(12)}</span><span class="pr-event-text"><b>${escapeHtml(item.author)}</b> reviewed</span>${prdWhen(item.submittedAt, now)}</div>`);
    } else {
      parts.push(prdMessageHtml(item, {
        prAuthor: pr.author, now,
        editing: d.editors.has(prdEditorKey(item)), draft: drafts.get(prdEditorKey(item)), shownHidden: d.shownHidden.has(item.id),
      }));
    }
    for (const thread of threads) { shown.add(thread.id); parts.push(prdThreadHtml(thread, { prAuthor: pr.author, now, d, drafts })); }
  }
  flush();
  if (!conv.hasNextPage) {
    for (const thread of conv.threads || []) {
      if (!shown.has(thread.id)) parts.push(prdThreadHtml(thread, { prAuthor: pr.author, now, d, drafts }));
    }
  }
  return parts.join('');
}

function prdConversationHtml(conv, { pr, now = new Date(), d, drafts }) {
  if (!conv || (conv.loading && !conv.pr)) return '<div class="pr-files-empty"><span class="git-loading-dot"></span>Reading the conversation…</div>';
  if (conv.error && !conv.pr) return `<div class="pr-files-empty is-error"><span>${escapeHtml(conv.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="tab-retry">Retry</button></div>`;
  const head = conv.pr;
  const description = prdMessageHtml({ ...head, kind: 'description', id: head.id }, {
    prAuthor: head.author, now, editing: d.editors.has('edit:description'), draft: drafts.get('edit:description'),
  });
  const more = conv.hasNextPage
    ? `<div class="pr-more"><button type="button" class="ws-btn ws-btn--sm" data-act="timeline-more"${conv.loadingMore ? ' disabled' : ''}>${conv.loadingMore ? 'Loading…' : 'Load more'}</button></div>` : '';
  return `
    <div class="pr-conv">
      <div class="pr-conv-main">
        ${description}
        <div class="pr-timeline">${prdTimelineHtml(conv, { pr: head, now, d, drafts })}</div>
        ${more}
        ${prdStatusBoxHtml({ ...pr, state: head.state || pr.state }, conv)}
        ${prdComposerHtml({ ...pr, state: head.state || pr.state }, conv, drafts)}
      </div>
      ${prdSidebarHtml(head)}
    </div>`;
}

// --- Commits ---

function prdDay(iso) {
  const date = new Date(iso || '');
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function prdCommitsHtml(entry, { d, now = new Date() }) {
  if (!entry || (entry.loading && !entry.list)) return '<div class="pr-files-empty"><span class="git-loading-dot"></span>Reading the commits…</div>';
  if (entry.error && !entry.list) return `<div class="pr-files-empty is-error"><span>${escapeHtml(entry.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="tab-retry">Retry</button></div>`;
  if (!entry.list.length) return '<div class="pr-files-empty">No commits.</div>';
  const days = [];
  for (const commit of entry.list) {
    const day = prdDay(commit.date);
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, commits: [] });
    days[days.length - 1].commits.push(commit);
  }
  const html = days.map(({ day, commits }) => `
      <div class="pr-day">Commits on ${escapeHtml(day)}</div>
      <div class="pr-commits">${commits.map((c) => {
        const open = d.openCommits.has(c.oid);
        return `
        <div class="pr-commit${open ? ' open' : ''}" data-commit="${prAttr(c.oid)}">
          <div class="pr-commit-row" data-act="commit-toggle" role="button" tabindex="0" aria-expanded="${open}">
            <span class="pr-chevron">${PICONS.chevronRight(10)}</span>
            ${prdAvatarHtml(c.author, c.avatar, 18)}
            <div class="pr-commit-main">
              <div class="pr-commit-title">${escapeHtml(c.headline)}${prdCheckDot(c.checks)}</div>
              <div class="pr-commit-meta"><b>${escapeHtml(c.author)}</b> committed ${prdWhen(c.date, now)}</div>
            </div>
            <span class="pr-commit-tools">
              <button type="button" class="pr-sha mono" data-act="copy-sha" title="Copy the full hash: ${prAttr(c.oid)}">${escapeHtml(c.short)}</button>
              ${/^https?:\/\//i.test(c.url || '') ? `<button type="button" class="ws-btn ws-btn--sm ws-btn--icon" data-act="commit-web" title="Open the commit on GitHub" aria-label="Open ${prAttr(c.short)} on GitHub">${PICONS.globe(12)}</button>` : ''}
            </span>
          </div>
          ${open ? `<div class="pr-commit-detail">${c.body ? `<pre class="pr-commit-body">${escapeHtml(c.body)}</pre>` : ''}<div class="pr-commit-files" data-commit-files="${prAttr(c.oid)}"></div></div>` : ''}
        </div>`;
      }).join('')}</div>`).join('');
  return `${html}${entry.truncated ? '<div class="pr-footer">GitHub lists the first 250 commits of a pull request.</div>' : ''}`;
}

// --- Checks ---

const PR_CHECK_WORDS = { pass: 'Successful', fail: 'Failing', pending: 'In progress', skipped: 'Skipped', cancelled: 'Cancelled' };

function prdChecksSummaryText(summary) {
  const parts = [];
  if (summary.fail) parts.push(`${summary.fail} failing`);
  if (summary.pending) parts.push(`${summary.pending} in progress`);
  if (summary.cancelled) parts.push(`${summary.cancelled} cancelled`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  if (summary.pass) parts.push(`${summary.pass} successful`);
  return parts.join(', ');
}

function prdCheckIcon(bucket) {
  const icon = { pass: 'check', fail: 'x', pending: 'clock', skipped: 'chevronRight', cancelled: 'x' }[bucket] || 'clock';
  return `<span class="pr-check-icon pr-check-icon--${prAttr(bucket)}" title="${prAttr(PR_CHECK_WORDS[bucket] || '')}">${PICONS[icon] ? PICONS[icon](12) : ''}</span>`;
}

/**
 * A job's log with GitHub Actions' own markers read: a group's title stands
 * out (its end mark goes), errors in red, warnings in yellow, commands in blue.
 */
function prdLogHtml(text) {
  const marks = { error: 'pr-log-error', warning: 'pr-log-warning', notice: 'pr-log-command', command: 'pr-log-command', debug: '' };
  return String(text || '').split('\n').filter(line => !line.startsWith('##[endgroup]')).map((line) => {
    const group = /^##\[group\](.*)$/.exec(line);
    if (group) return `<span class="pr-log-group">▸ ${escapeHtml(group[1])}</span>`;
    const mark = /^##\[(error|warning|notice|command|debug)\](.*)$/.exec(line);
    if (mark) return marks[mark[1]] ? `<span class="${marks[mark[1]]}">${escapeHtml(mark[2])}</span>` : escapeHtml(mark[2]);
    return escapeHtml(line);
  }).join('\n');
}

function prdChecksHtml(entry, { d }) {
  if (!entry || (entry.loading && !entry.list)) return '<div class="pr-files-empty"><span class="git-loading-dot"></span>Reading the checks…</div>';
  if (entry.error && !entry.list) return `<div class="pr-files-empty is-error"><span>${escapeHtml(entry.error)}</span><button type="button" class="ws-btn ws-btn--sm" data-act="tab-retry">Retry</button></div>`;
  if (!entry.list.length) return '<div class="pr-files-empty">No checks on the last commit.</div>';
  const groups = [];
  for (const check of entry.list) {
    const name = check.group || 'Other checks';
    let group = groups.find(g => g.name === name);
    if (!group) { group = { name, checks: [], runs: new Set() }; groups.push(group); }
    group.checks.push(check);
    if (check.actions && check.runId && check.bucket === 'fail') group.runs.add(check.runId);
  }
  const html = groups.map(group => `
      <div class="pr-check-group">
        <div class="pr-check-group-head"><span>${escapeHtml(group.name)}</span>${[...group.runs].map(runId => `<button type="button" class="ws-ghost ws-ghost--sm" data-act="rerun-failed" data-run="${prAttr(runId)}">Re-run failed jobs</button>`).join('')}</div>
        ${group.checks.map((check) => {
          const done = check.status === 'COMPLETED';
          const canLog = check.actions && done && check.id;
          const logOpen = canLog && d.openLogs.has(check.id);
          const log = logOpen ? d.logs.get(check.id) : null;
          let logHtml = '';
          if (logOpen) {
            if (!log || log.loading) logHtml = '<div class="pr-log-note"><span class="git-loading-dot"></span>Reading the log…</div>';
            else if (log.error) logHtml = `<div class="pr-log-note is-error">${escapeHtml(log.error)}</div>`;
            else logHtml = `${log.truncated ? '<div class="pr-log-note">Only the end of the log is shown.</div>' : ''}<pre class="pr-log" data-log="${prAttr(check.id)}">${prdLogHtml(log.text)}</pre>`;
          }
          const duration = prdDuration(check.startedAt, check.completedAt);
          return `
        <div class="pr-check" data-check="${prAttr(check.id ?? check.name)}">
          ${prdCheckIcon(check.bucket)}
          <span class="pr-check-name">${escapeHtml(check.name)}</span>
          ${check.required ? '<span class="pr-flag">Required</span>' : ''}
          <span class="pr-check-title">${escapeHtml(check.title || (check.event ? `on ${check.event}` : ''))}</span>
          <span class="pr-check-time">${escapeHtml(duration)}</span>
          <span class="pr-check-tools">
            ${canLog ? `<button type="button" class="ws-ghost ws-ghost--sm" data-act="check-log" data-job="${prAttr(check.id)}" aria-expanded="${!!logOpen}">${logOpen ? 'Hide log' : 'Log'}</button>` : ''}
            ${check.actions && done && check.id ? `<button type="button" class="ws-ghost ws-ghost--sm" data-act="rerun-job" data-job="${prAttr(check.id)}">Re-run</button>` : ''}
            ${check.actions && check.runId && typeof openActionsRun === 'function' ? `<button type="button" class="ws-ghost ws-ghost--sm" data-act="check-actions" data-run="${prAttr(check.runId)}" data-job="${prAttr(check.id || '')}" title="Open this job in the Git tab's Actions view">Open in Actions</button>` : ''}
            ${/^https?:\/\//i.test(check.url || '') ? `<button type="button" class="ws-ghost ws-ghost--sm" data-act="check-details" data-url="${prAttr(check.url)}">Details</button>` : ''}
          </span>
          ${logOpen ? `<div class="pr-check-log">${logHtml}</div>` : ''}
        </div>`;
        }).join('')}
      </div>`).join('');
  return `<div class="pr-checks-head">${escapeHtml(prdChecksSummaryText(entry.summary || {}))}</div>${html}`;
}

// --- Painting ---

function prdContext(project, state, repoPath, item, pr) {
  const data = prRepoState(project.id, state, repoPath);
  const d = prdState(data, pr);
  return { project, state, repoPath, item, pr, data, d, detail: item.querySelector('.pr-detail') };
}

/** Paint the open pull request under its row: the tabs and the tab shown. */
function prdPaint(project, state, repoPath, item, pr) {
  const ctx = prdContext(project, state, repoPath, item, pr);
  const { d, detail } = ctx;
  if (!detail) return;
  if (prTypingIn(detail)) { d.pending = true; return; }
  d.pending = false;
  prdStopPoll(d);
  detail.innerHTML = `${prdTabsHtml(pr, d)}<div class="pr-tab-body" role="tabpanel"></div>`;
  detail.querySelectorAll('.pr-tab').forEach((button) => {
    button.onclick = () => {
      if (d.tab === button.dataset.tab) return;
      d.tab = button.dataset.tab;
      setPrDetailTab(d.tab);
      prdPaint(project, state, repoPath, item, pr);
    };
  });
  const review = detail.querySelector('[data-act="review"]');
  if (review) review.onclick = () => prdReviewDialog(ctx);
  const slot = detail.querySelector('.pr-tab-body');
  if (d.tab === 'files') {
    prPaintFiles(project, state, repoPath, item, pr, slot);
    prdEnsure(ctx, 'viewed');
  } else if (d.tab === 'commits') prdPaintCommits(ctx, slot);
  else if (d.tab === 'checks') prdPaintChecks(ctx, slot);
  else prdPaintConversation(ctx, slot);
  // The counts of Conversation and Commits come with the conversation: it is read whichever tab is shown.
  if (d.tab !== 'conversation' && !d.conversation) prdLoad(ctx, 'conversation');
}

/** Paint the pull request again where it is now on the page, if it is still open there. */
function prdRefresh(ctx) {
  const { project, state, repoPath, data, pr } = ctx;
  if (state.repos.get(repoPath) !== data || !prIsShown(state, repoPath) || !data.expanded.has(pr.number)) return;
  const body = prActiveBody(project);
  const item = body?.querySelector(prItemSelectorFor(state, repoPath, pr.number));
  if (item) prdPaint(project, state, repoPath, item, prFindPr(data, pr.number) || pr);
}

/** After the focus left a field: paint what waited for it. */
function prFlushPending(project, state) {
  const body = prActiveBody(project);
  const repo = prSelectedRepo(state);
  if (!body || !repo) return;
  const list = body.querySelector('#pr-list');
  // The repaint of the list waits on the primary repository's data, whatever else is shown.
  const primary = prRepoState(project.id, state, repo.path);
  if (primary.listPending && !prTypingIn(list)) {
    primary.listPending = false;
    prPaintList(project, state, body);
    return;
  }
  for (const shown of prShownRepos(state)) {
    const data = prRepoState(project.id, state, shown.path);
    for (const [number, d] of data.detail || []) {
      if (!d.pending) continue;
      const item = body.querySelector(prItemSelectorFor(state, shown.path, number));
      const pr = prFindPr(data, number);
      if (item && pr && !prTypingIn(item.querySelector('.pr-detail'))) prdPaint(project, state, shown.path, item, pr);
    }
  }
}

const PR_LOADERS = {
  conversation: 'getPullRequestConversation',
  commits: 'getPullRequestCommits',
  checks: 'getPullRequestChecks',
  viewed: 'getPullRequestViewed',
};

function prdShape(what, result) {
  if (what === 'conversation') {
    return { pr: result.pr, items: result.timeline?.items || [], threads: result.threads || [], hasNextPage: !!result.timeline?.hasNextPage, endCursor: result.timeline?.endCursor || null };
  }
  if (what === 'commits') return { list: result.commits || [], totalCount: result.totalCount || 0, truncated: !!result.truncated };
  if (what === 'checks') return { list: result.checks || [], summary: result.summary || {}, rollup: result.rollup || null, headOid: result.headOid || '' };
  return { map: result.viewed || {} };
}

/**
 * Read one tab's data. Quietly, what was there stays on screen while it is
 * read again, and stays if the reading fails (the failure goes to the notice).
 */
async function prdLoad(ctx, what, { quiet = false } = {}) {
  const { d } = ctx;
  const previous = d[what];
  if (previous?.loading) return;
  const keep = quiet && previous && !previous.error ? previous : null;
  const entry = { ...(keep || {}), loading: true };
  d[what] = entry;
  if (!keep) prdRefresh(ctx);
  const result = await prApi(PR_LOADERS[what], ctx.project.id, ctx.repoPath, prRemoteOpts(ctx.data, { number: ctx.pr.number }));
  if (d[what] !== entry || ctx.state.repos.get(ctx.repoPath) !== ctx.data) return;
  if (result?.ok) d[what] = { ...prdShape(what, result), loadedAt: Date.now() };
  else if (keep) {
    d[what] = { ...keep, loading: false, loadedAt: Date.now() };
    prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub could not be read.' });
  } else d[what] = { error: result?.error || 'GitHub could not be read.', loadedAt: Date.now() };
  prdRefresh(ctx);
}

/** A tab's data: read when never read, read again quietly when older than a minute. */
function prdEnsure(ctx, what) {
  const entry = ctx.d[what];
  if (!entry) { prdLoad(ctx, what); return; }
  if (!entry.loading && Date.now() - (entry.loadedAt || 0) > PR_DETAIL_STALE_MS) prdLoad(ctx, what, { quiet: true });
}

/** After a change: the list again (titles, badges, counts) and the tabs it touched. */
function prdAfterChange(ctx, { tabs = ['conversation'], list = true, notice = '' } = {}) {
  if (notice) prSetNotice(ctx.project, ctx.state, { kind: 'ok', text: notice });
  for (const what of tabs) if (ctx.d[what]) prdLoad(ctx, what, { quiet: true });
  if (list) prLoad(ctx.project, ctx.state, ctx.repoPath, { quiet: true });
}

/** One change through pull-request-edits.js: { ok, message } or { error }. */
function prdEdit(ctx, params) {
  return prApi('editPullRequest', ctx.project.id, ctx.repoPath, prRemoteOpts(ctx.data, params));
}

// --- Conversation: painting and wiring ---

function prdPaintConversation(ctx, slot) {
  const { d, data, pr } = ctx;
  prdEnsure(ctx, 'conversation');
  slot.innerHTML = prdConversationHtml(d.conversation, { pr, d, drafts: data.drafts });
  slot.querySelector('[data-act="tab-retry"]')?.addEventListener('click', () => prdLoad(ctx, 'conversation'));
  const conv = d.conversation;
  if (!conv?.pr) return;
  // The list's search: its words marked in the description and every comment.
  const search = typeof prSearchOf === 'function' ? prSearchOf(ctx.state) : null;
  if (search?.terms.length && typeof prMarkIn === 'function') prMarkIn(slot.querySelectorAll('.pr-msg-body.pr-md'), search);
  prWireLinks(slot);
  const head = conv.pr;
  const messages = new Map([['description', { ...head, kind: 'description' }]]);
  for (const item of conv.items) if (item.id) messages.set(item.id, item);
  for (const thread of conv.threads) for (const c of thread.comments) messages.set(c.id, c);

  // Editors already open (an edit, a reply), and the composer.
  slot.querySelectorAll('.pr-editor').forEach((editor) => prdWireMessageEditor(ctx, editor, messages));
  slot.querySelectorAll('[data-act="msg-more"]').forEach((button) => {
    button.onclick = (e) => {
      e.stopPropagation();
      const message = messages.get(button.dataset.msg);
      if (message) showContextMenu(prdMessageMenuItems(ctx, message), { anchor: e.currentTarget });
    };
  });
  slot.querySelectorAll('[data-act="show-hidden"]').forEach((button) => {
    button.onclick = () => { d.shownHidden.add(button.dataset.msg); prdRefresh(ctx); };
  });
  slot.querySelectorAll('[data-act="react-add"]').forEach((button) => {
    button.onclick = (e) => {
      e.stopPropagation();
      const message = messages.get(button.dataset.subject) || [...messages.values()].find(m => m.id === button.dataset.subject);
      if (!message) return;
      showContextMenu(PR_REACTIONS.map(([content, emoji]) => {
        const mine = (message.reactions || []).some(r => r.content === content && r.mine);
        const name = content.charAt(0) + content.slice(1).toLowerCase().replace(/_/g, ' ');
        return { label: name, icon: `<span class="pr-menu-emoji">${emoji}</span>`, hint: mine ? 'yours' : '', onClick: () => prdToggleReaction(ctx, message, content) };
      }), { anchor: e.currentTarget });
    };
  });
  slot.querySelectorAll('.pr-reaction').forEach((chip) => {
    chip.onclick = () => {
      const message = [...messages.values()].find(m => m.id === chip.dataset.subject);
      if (message) prdToggleReaction(ctx, message, chip.dataset.react);
    };
  });
  slot.querySelectorAll('.pr-thread').forEach((el) => {
    const thread = conv.threads.find(t => t.id === el.dataset.thread);
    if (!thread) return;
    const toggle = el.querySelector('[data-act="thread-toggle"]');
    if (toggle && thread.resolved) toggle.onclick = () => { if (d.openThreads.has(thread.id)) d.openThreads.delete(thread.id); else d.openThreads.add(thread.id); prdRefresh(ctx); };
    const reply = el.querySelector('[data-act="thread-reply"]');
    if (reply) reply.onclick = () => { d.editors.add(`reply:${thread.id}`); prdRefresh(ctx); prdFocusEditor(ctx, `reply:${thread.id}`); };
    for (const act of ['thread-resolve', 'thread-unresolve']) {
      const button = el.querySelector(`[data-act="${act}"]`);
      if (button) button.onclick = () => prdSimpleChange(ctx, button, { kind: act, threadId: thread.id });
    }
  });
  slot.querySelectorAll('[data-act="update-branch"]').forEach((button) => {
    button.onclick = () => prdSimpleChange(ctx, button, { kind: 'update-branch', pullRequestId: head.id, headOid: head.headOid, method: button.dataset.method }, { tabs: ['conversation', 'commits', 'checks'] });
  });
  const more = slot.querySelector('[data-act="timeline-more"]');
  if (more) more.onclick = () => prdLoadMoreTimeline(ctx);
  slot.querySelectorAll('[data-act="side-edit"]').forEach((button) => {
    button.onclick = (e) => { e.stopPropagation(); prdOpenSidePicker(ctx, button.dataset.side, button); };
  });
}

/** Focus an editor once painted (after a repaint opened it). */
function prdFocusEditor(ctx, key) {
  const body = prActiveBody(ctx.project);
  const item = body?.querySelector(prItemSelectorFor(ctx.state, ctx.repoPath, ctx.pr.number));
  const input = item ? [...item.querySelectorAll('.pr-editor')].find(e => e.dataset.editor === key)?.querySelector('textarea') : null;
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

function prdCloseEditor(ctx, key) {
  ctx.d.editors.delete(key);
  ctx.data.drafts.delete(key);
}

function prdWireMessageEditor(ctx, editor, messages) {
  const { d, data, pr } = ctx;
  const key = editor.dataset.editor;
  const head = d.conversation.pr;
  const preview = text => prApi('renderPullRequestMarkdown', ctx.project.id, ctx.repoPath, prRemoteOpts(data, { text }));
  const onCancel = () => { prdCloseEditor(ctx, key); document.activeElement?.blur?.(); prdRefresh(ctx); };
  if (key.startsWith('composer:')) {
    prWireEditor(editor, {
      drafts: data.drafts, preview,
      onAction: async (act, text, ui) => {
        if (act === 'comment') {
          if (!text.trim()) { ui.setError('Write a comment first.'); return; }
          const result = await prdEdit(ctx, { kind: 'comment', pullRequestId: head.id, body: text });
          if (!result?.ok) { ui.setError(result?.error || 'GitHub did not take the comment.'); return; }
          data.drafts.delete(key);
          editor.querySelector('textarea').value = '';
          document.activeElement?.blur?.();
          prdAfterChange(ctx, { tabs: ['conversation'] });
          return;
        }
        // Close or reopen, with the comment first when there is one.
        const action = act === 'close' ? 'close' : 'reopen';
        if (!text.trim() && action === 'close') { prConfirmDialog(ctx.project, ctx.state, ctx.repoPath, pr, 'close'); return; }
        if (text.trim()) {
          const comment = await prdEdit(ctx, { kind: 'comment', pullRequestId: head.id, body: text });
          if (!comment?.ok) { ui.setError(comment?.error || 'GitHub did not take the comment.'); return; }
          data.drafts.delete(key);
        }
        const result = await prApi('runPullRequestAction', ctx.project.id, ctx.repoPath, prRemoteOpts(data, { number: pr.number, action }));
        if (!result?.ok) { ui.setError(result?.error || 'GitHub did not do it.'); return; }
        document.activeElement?.blur?.();
        prdAfterChange(ctx, { tabs: ['conversation'], notice: result.message });
      },
    });
    return;
  }
  if (key.startsWith('reply:')) {
    const threadId = key.slice('reply:'.length);
    prWireEditor(editor, {
      drafts: data.drafts, preview, onCancel, focus: false,
      onAction: async (_act, text, ui) => {
        if (!text.trim()) { ui.setError('Write a reply first.'); return; }
        const result = await prdEdit(ctx, { kind: 'thread-reply', threadId, body: text });
        if (!result?.ok) { ui.setError(result?.error || 'GitHub did not take the reply.'); return; }
        prdCloseEditor(ctx, key);
        document.activeElement?.blur?.();
        prdAfterChange(ctx, { tabs: ['conversation'] });
      },
    });
    return;
  }
  // An edit of the description, a comment, a review or a review comment.
  const id = key.slice('edit:'.length);
  const message = id === 'description' ? messages.get('description') : messages.get(id);
  if (!message) return;
  prWireEditor(editor, {
    drafts: data.drafts, preview, onCancel,
    onAction: async (_act, text, ui) => {
      const params = message.kind === 'description'
        ? { kind: 'body', pullRequestId: head.id, body: text }
        : { kind: 'comment-edit', type: prdCommentType(message), id: message.id, body: text };
      const result = await prdEdit(ctx, params);
      if (!result?.ok) { ui.setError(result?.error || 'GitHub did not take the change.'); return; }
      prdCloseEditor(ctx, key);
      document.activeElement?.blur?.();
      prdAfterChange(ctx, { tabs: ['conversation'], list: false });
    },
  });
}

function prdCommentType(message) {
  if (message.kind === 'review') return 'review';
  if (message.kind === 'review-comment') return 'review-comment';
  return 'issue';
}

/** The "…" of a message: Copy link, Quote reply, Edit, Hide or Unhide, Delete, Open on GitHub. */
function prdMessageMenuItems(ctx, message) {
  const { d, data, pr } = ctx;
  const items = [];
  const url = message.kind === 'description' ? (d.conversation?.pr?.url || pr.url) : message.url;
  if (url) {
    items.push({ label: 'Copy link', icon: PICONS.link(13), onClick: () => window.api?.writeClipboard?.(url) });
  }
  items.push({
    label: 'Quote reply', icon: PICONS.messages(13),
    onClick: () => {
      const thread = message.kind === 'review-comment' ? (d.conversation?.threads || []).find(t => t.comments.some(c => c.id === message.id)) : null;
      const key = thread && thread.can.reply ? `reply:${thread.id}` : `composer:${pr.number}`;
      const before = data.drafts.get(key) || '';
      data.drafts.set(key, `${before}${before && !before.endsWith('\n') ? '\n\n' : ''}${prQuoteText(message.body)}`);
      if (thread) d.editors.add(key);
      prdRefresh(ctx);
      prdFocusEditor(ctx, key);
    },
  });
  if (message.can?.update) {
    items.push({
      label: message.kind === 'description' ? 'Edit description' : 'Edit', icon: PICONS.pencil(13),
      onClick: () => {
        const key = prdEditorKey(message);
        d.editors.add(key);
        if (!data.drafts.has(key)) data.drafts.set(key, message.body || '');
        prdRefresh(ctx);
        prdFocusEditor(ctx, key);
      },
    });
  }
  if (message.can?.minimize && message.id && message.kind !== 'description' && message.kind !== 'review') {
    if (message.minimized) items.push({ label: 'Unhide', icon: PICONS.messages(13), onClick: () => prdSimpleChange(ctx, null, { kind: 'comment-unhide', id: message.id }) });
    else {
      items.push({
        label: 'Hide', icon: PICONS.messages(13),
        submenu: PR_HIDE_REASONS.map(([reason, label]) => ({ label, onClick: () => prdSimpleChange(ctx, null, { kind: 'comment-hide', id: message.id, reason }) })),
      });
    }
  }
  if (url) items.push({ label: 'Open on GitHub', icon: PICONS.globe(13), onClick: () => window.api?.openExternal?.(url) });
  if (message.can?.delete && message.id && (message.kind === 'comment' || message.kind === 'review-comment')) {
    items.push({ sep: true });
    items.push({ label: 'Delete…', icon: PICONS.trash(13), danger: true, onClick: () => prdDeleteDialog(ctx, message) });
  }
  return items;
}

/** A change from a button (resolve, update branch, unhide): the button waits, an error goes to the notice. */
async function prdSimpleChange(ctx, button, params, { tabs = ['conversation'], list = false } = {}) {
  if (button) { button.disabled = true; button.classList.add('is-busy'); }
  const result = await prdEdit(ctx, params);
  if (!result?.ok) {
    if (button && button.isConnected) { button.disabled = false; button.classList.remove('is-busy'); }
    prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub did not do it.' });
    return false;
  }
  prdAfterChange(ctx, { tabs, list, notice: result.message || '' });
  return true;
}

/** A reaction on or off, shown at once and taken back if GitHub refuses. */
async function prdToggleReaction(ctx, message, content) {
  const key = `react:${message.id}:${content}`;
  if (ctx.d.busy.has(key) || !message.can?.react) return;
  ctx.d.busy.add(key);
  const reactions = message.reactions || (message.reactions = []);
  const existing = reactions.find(r => r.content === content);
  const mine = !!existing?.mine;
  const before = reactions.map(r => ({ ...r }));
  if (mine) {
    existing.mine = false;
    existing.count -= 1;
    if (existing.count <= 0) reactions.splice(reactions.indexOf(existing), 1);
  } else if (existing) {
    existing.mine = true;
    existing.count += 1;
  } else reactions.push({ content, count: 1, mine: true });
  prdRefresh(ctx);
  const result = await prdEdit(ctx, { kind: mine ? 'unreact' : 'react', subjectId: message.id, content });
  ctx.d.busy.delete(key);
  if (!result?.ok) {
    message.reactions = before;
    prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub did not take the reaction.' });
    prdRefresh(ctx);
  }
}

async function prdLoadMoreTimeline(ctx) {
  const conv = ctx.d.conversation;
  if (!conv || conv.loadingMore || !conv.hasNextPage) return;
  conv.loadingMore = true;
  prdRefresh(ctx);
  const result = await prApi('getPullRequestConversation', ctx.project.id, ctx.repoPath, prRemoteOpts(ctx.data, { number: ctx.pr.number, after: conv.endCursor }));
  if (ctx.d.conversation !== conv) return;
  conv.loadingMore = false;
  if (result?.ok) {
    conv.items = [...conv.items, ...(result.timeline?.items || [])];
    conv.hasNextPage = !!result.timeline?.hasNextPage;
    conv.endCursor = result.timeline?.endCursor || null;
  } else prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub could not be read.' });
  prdRefresh(ctx);
}

// --- Dialogs ---

function prdDeleteDialog(ctx, message) {
  const handle = gitGraphOpenDialog({
    title: 'Delete comment',
    bodyHtml: `<p class="gg-dialog-hint">The comment by <b>${escapeHtml(message.author)}</b> is deleted on GitHub. It cannot be brought back.</p>`,
    primaryLabel: 'Delete', primaryDanger: true, focusSelector: '.gg-dialog-cancel',
    onSubmit: async () => {
      const result = await prdEdit(ctx, { kind: 'comment-delete', type: prdCommentType(message), id: message.id });
      if (!result?.ok) throw new Error(result?.error || 'GitHub did not delete it.');
      handle.close();
      prdAfterChange(ctx, { tabs: ['conversation'], notice: result.message });
    },
  });
  return handle;
}

/** The body of Review changes: the text, then Comment, Approve or Request changes (the last two not on one's own pull request). */
function prdReviewDialogHtml(pr, { mine = false } = {}) {
  const own = mine ? ' disabled' : '';
  const why = mine ? '<div class="gg-field-hint">GitHub does not let you approve or request changes on your own pull request.</div>' : '';
  return `
    <div class="gg-field"><label class="gg-field-label" for="pr-review-body">Your review</label><textarea id="pr-review-body" class="gg-field-input pr-review-text" rows="6" placeholder="Leave a comment (⌘↵ submits)"></textarea></div>
    <div class="gg-field pr-review-events" role="radiogroup" aria-label="Review">
      <label class="pr-review-event"><input type="radio" name="pr-review-event" value="COMMENT" checked><span><b>Comment</b><small>General feedback, without approving.</small></span></label>
      <label class="pr-review-event${mine ? ' is-off' : ''}"><input type="radio" name="pr-review-event" value="APPROVE"${own}><span><b>Approve</b><small>Feedback, and approval to merge.</small></span></label>
      <label class="pr-review-event${mine ? ' is-off' : ''}"><input type="radio" name="pr-review-event" value="REQUEST_CHANGES"${own}><span><b>Request changes</b><small>Feedback that must be addressed before merging.</small></span></label>
      ${why}
    </div>`;
}

function prdReviewDialog(ctx) {
  const head = ctx.d.conversation?.pr;
  const pr = ctx.pr;
  const mine = head ? head.mine : !!pr.viewerDidAuthor;
  const handle = gitGraphOpenDialog({
    title: `Review #${pr.number}`,
    bodyHtml: prdReviewDialogHtml(pr, { mine }),
    primaryLabel: 'Submit review',
    focusSelector: '#pr-review-body',
    onSubmit: async () => {
      const dialog = handle.dialog;
      const body = dialog?.querySelector('#pr-review-body')?.value || '';
      const event = dialog?.querySelector('input[name="pr-review-event"]:checked')?.value || 'COMMENT';
      const pullRequestId = head?.id || pr.id;
      if (!pullRequestId) throw new Error('Read the conversation first: open the Conversation tab.');
      const params = { kind: 'review', pullRequestId, event };
      if (body.trim()) params.body = body;
      if (head?.pendingReviewId) params.pendingReviewId = head.pendingReviewId;
      const result = await prdEdit(ctx, params);
      if (!result?.ok) throw new Error(result?.error || 'GitHub did not take the review.');
      handle.close();
      prdAfterChange(ctx, { tabs: ['conversation'], notice: result.message });
    },
  });
  return handle;
}

/** Change base…: the repository's branches, searched as one types, the current base and the head left out. */
function prChangeBaseDialog(project, state, repoPath, pr) {
  const data = prRepoState(project.id, state, repoPath);
  let chosen = null;
  let request = 0;
  state.dialogOpen = true;
  const bodyHtml = `
    <div class="pr-dialog-pr"><span class="pr-dialog-title">${escapeHtml(pr.title)}</span><span class="pr-number">#${pr.number}</span></div>
    <div class="pr-dialog-branches mono">${escapeHtml(`${pr.head} → ${pr.base}`)}</div>
    <div class="gg-field"><label class="gg-field-label" for="pr-base-search">New base branch</label><input id="pr-base-search" class="gg-field-input" type="text" placeholder="Find a branch" autocomplete="off" spellcheck="false"></div>
    <div class="pr-base-list" id="pr-base-list" role="listbox" aria-label="Branches"><div class="pr-muted"><span class="git-loading-dot"></span>Reading branches…</div></div>
    <p class="gg-dialog-warning">Some commits from the old base branch may be removed from the timeline, and old review comments may become outdated.</p>`;
  const handle = gitGraphOpenDialog({
    title: 'Change base branch',
    bodyHtml,
    primaryLabel: 'Change base',
    focusSelector: '#pr-base-search',
    onCancel: () => { state.dialogOpen = false; },
    onSubmit: async () => {
      if (!chosen) throw new Error('Choose a branch.');
      const result = await prApi('editPullRequest', project.id, repoPath, prRemoteOpts(data, { kind: 'base', pullRequestId: pr.id, base: chosen }));
      if (!result?.ok) throw new Error(result?.error || 'GitHub did not change the base.');
      handle.close();
      state.dialogOpen = false;
      prSetNotice(project, state, { kind: 'ok', text: result.message });
      // New files and commits: what was read for the old base is dropped.
      for (const key of [...data.files.keys()]) if (key.startsWith(`${pr.number}@`)) data.files.delete(key);
      data.detail?.delete(pr.number);
      prLoad(project, state, repoPath, { quiet: true });
    },
  });
  handle.dialog.classList.add('pr-dialog');
  const list = handle.dialog.querySelector('#pr-base-list');
  const search = handle.dialog.querySelector('#pr-base-search');
  const paint = (result) => {
    if (!list || !list.isConnected) return;
    if (!result?.ok) { list.innerHTML = `<div class="pr-muted is-error">${escapeHtml(result?.error || 'The branches could not be read.')}</div>`; return; }
    const names = prBaseChoices(result, pr);
    if (!names.length) { list.innerHTML = '<div class="pr-muted">No other branch matches.</div>'; return; }
    list.innerHTML = names.map(name => `<button type="button" class="pr-base-option${name === chosen ? ' on' : ''}" role="option" aria-selected="${name === chosen}" data-branch="${prAttr(name)}"><span class="mono">${escapeHtml(name)}</span>${name === result.defaultBranch ? '<span class="pr-flag">default</span>' : ''}</button>`).join('')
      + (result.totalCount > names.length + 2 ? '<div class="pr-muted">Type to find the others.</div>' : '');
    list.querySelectorAll('.pr-base-option').forEach((button) => {
      button.onclick = () => {
        chosen = button.dataset.branch;
        list.querySelectorAll('.pr-base-option').forEach(b => { const on = b === button; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      };
    });
  };
  const read = async () => {
    const mine = ++request;
    const result = await prApi('getPullRequestBranches', project.id, repoPath, prRemoteOpts(data, { query: search?.value.trim() || null }));
    if (mine === request) paint(result);
  };
  let timer = null;
  if (search) search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(read, 250); });
  read();
}

/** The branches Change base offers: the default first, never the head or the current base. */
function prBaseChoices(result, pr) {
  const names = (result.branches || []).filter(name => name !== pr.head && name !== pr.base);
  const def = result.defaultBranch;
  if (def && names.includes(def)) return [def, ...names.filter(n => n !== def)];
  return names;
}

// --- Sidebar pickers ---

/**
 * The popover of a sidebar section: a filter and a checkbox per label or
 * person, from the repository's own (gh). Closing it saves what changed, as
 * GitHub's sidebar does.
 */
function prdOpenSidePicker(ctx, side, button) {
  if (document.querySelector('.pr-side-menu')) { document.querySelector('.pr-side-menu')._close?.(); return; }
  const head = ctx.d.conversation?.pr;
  if (!head) return;
  const kind = side === 'labels' ? 'labels' : 'users';
  const current = side === 'labels'
    ? new Map(head.labels.map(l => [l.id, l]))
    : side === 'assignees' ? new Map(head.assignees.map(a => [a.id, a])) : new Map(head.reviewers.filter(r => r.kind !== 'team').map(r => [r.login, r]));
  const chosen = new Set(current.keys());
  let items = [];
  let request = 0;
  const menu = document.createElement('div');
  menu.className = 'ctx-menu pr-side-menu';
  menu.innerHTML = `<input type="text" class="pr-side-search" placeholder="${side === 'labels' ? 'Filter labels' : 'Type a name'}" aria-label="Filter" spellcheck="false"><div class="pr-side-options"><div class="pr-muted"><span class="git-loading-dot"></span>Reading…</div></div>`;
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 320)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268))}px`;
  const options = menu.querySelector('.pr-side-options');
  const keyOf = item => (side === 'reviewers' ? item.login : item.id);
  const paint = () => {
    // What is chosen stays listed even when the search does not find it.
    const shown = [...items];
    for (const [key, value] of current) if (chosen.has(key) && !shown.some(i => keyOf(i) === key)) shown.unshift(value);
    options.innerHTML = shown.length ? shown.map((item) => {
      const key = keyOf(item);
      const label = side === 'labels' ? prdLabelHtml(item) : `${prdAvatarHtml(item.login, item.avatar, 16)}<span>${escapeHtml(item.login)}</span>${item.name ? `<span class="pr-muted">${escapeHtml(item.name)}</span>` : ''}`;
      return `<label class="pr-filter-option"><input type="checkbox" data-key="${prAttr(key)}"${chosen.has(key) ? ' checked' : ''}>${label}</label>`;
    }).join('') : `<div class="pr-muted">${side === 'reviewers' && !search.value.trim() ? 'No one else to ask: GitHub takes no review from the pull request\'s author.' : 'Nothing found.'}</div>`;
    options.querySelectorAll('input[data-key]').forEach((input) => {
      input.onchange = () => { if (input.checked) chosen.add(input.dataset.key); else chosen.delete(input.dataset.key); };
    });
  };
  const read = async (query) => {
    const mine = ++request;
    const result = await prApi('getPullRequestCandidates', ctx.project.id, ctx.repoPath, prRemoteOpts(ctx.data, { kind, query: query || null }));
    if (mine !== request || !menu.isConnected) return;
    if (!result?.ok) { options.innerHTML = `<div class="pr-muted is-error">${escapeHtml(result?.error || 'Could not be read.')}</div>`; return; }
    // GitHub ignores a review asked of the pull request's own author: not offered.
    items = (result.items || []).filter(item => side !== 'reviewers' || item.login !== head.author);
    paint();
  };
  let timer = null;
  const search = menu.querySelector('.pr-side-search');
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => read(search.value.trim()), 250); });
  const onDown = (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  async function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    const add = [...chosen].filter(k => !current.has(k));
    const remove = [...current.keys()].filter(k => !chosen.has(k));
    if (!add.length && !remove.length) return;
    let params;
    if (side === 'reviewers') {
      params = { kind: 'reviewers', pullRequestId: head.id, users: [...chosen], teams: head.reviewers.filter(r => r.kind === 'team' && r.state === 'REQUESTED').map(r => r.login) };
    } else params = { kind: side, pullRequestId: head.id, add, remove };
    const result = await prdEdit(ctx, params);
    if (!result?.ok) { prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub did not take the change.' }); return; }
    prdAfterChange(ctx, { tabs: ['conversation'], list: side === 'reviewers', notice: result.message });
  }
  menu._close = close;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  search.focus();
  read('');
}

// --- Commits: painting and wiring ---

function prdPaintCommits(ctx, slot) {
  const { d } = ctx;
  prdEnsure(ctx, 'commits');
  slot.innerHTML = prdCommitsHtml(d.commits, { d });
  slot.querySelector('[data-act="tab-retry"]')?.addEventListener('click', () => prdLoad(ctx, 'commits'));
  const list = d.commits?.list || [];
  slot.querySelectorAll('.pr-commit').forEach((el) => {
    const commit = list.find(c => c.oid === el.dataset.commit);
    if (!commit) return;
    const row = el.querySelector('.pr-commit-row');
    const toggle = () => {
      if (d.openCommits.has(commit.oid)) d.openCommits.delete(commit.oid);
      else { d.openCommits.add(commit.oid); if (!d.commitFiles.has(commit.oid)) prdLoadCommitFiles(ctx, commit.oid); }
      prdRefresh(ctx);
    };
    row.onclick = (e) => { if (e.target.closest('.pr-commit-tools')) return; toggle(); };
    row.onkeydown = (e) => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } };
    const sha = el.querySelector('[data-act="copy-sha"]');
    if (sha) sha.onclick = (e) => {
      e.stopPropagation();
      window.api?.writeClipboard?.(commit.oid);
      sha.classList.add('is-done');
      setTimeout(() => sha.classList.remove('is-done'), 1200);
    };
    const web = el.querySelector('[data-act="commit-web"]');
    if (web) web.onclick = (e) => { e.stopPropagation(); window.api?.openExternal?.(commit.url); };
    const filesSlot = el.querySelector('.pr-commit-files');
    if (filesSlot) {
      const entry = d.commitFiles.get(commit.oid);
      if (!d.commitOpen.has(commit.oid)) d.commitOpen.set(commit.oid, new Set());
      if (!d.commitFolders.has(commit.oid)) d.commitFolders.set(commit.oid, new Set());
      prWireFiles(filesSlot, entry || { loading: true }, {
        openPaths: d.commitOpen.get(commit.oid),
        closedFolders: d.commitFolders.get(commit.oid),
        repaint: () => prdRefresh(ctx),
        retry: () => { d.commitFiles.delete(commit.oid); prdLoadCommitFiles(ctx, commit.oid); },
        onView: () => prRepaint(ctx.project, ctx.state, ctx.repoPath),
        loadDiff: file => prReadTextDiff(() => prApi('getPullRequestFileDiff', ctx.project.id, ctx.repoPath,
          prRemoteOpts(ctx.data, { sha: commit.oid, path: file.path, oldPath: file.oldPath || null, status: file.status }))),
      });
    }
  });
}

async function prdLoadCommitFiles(ctx, oid) {
  const { d } = ctx;
  if (d.commitFiles.get(oid)?.loading) return;
  const entry = { loading: true };
  d.commitFiles.set(oid, entry);
  const result = await prApi('getPullRequestCommitFiles', ctx.project.id, ctx.repoPath, prRemoteOpts(ctx.data, { sha: oid }));
  if (d.commitFiles.get(oid) !== entry) return;
  d.commitFiles.set(oid, result?.ok ? { files: result.files || [], truncated: !!result.truncated } : { error: result?.error || 'The commit\'s files could not be read.' });
  prdRefresh(ctx);
}

// --- Checks: painting and wiring ---

function prdStopPoll(d) {
  if (d.pollTimer) { clearTimeout(d.pollTimer); d.pollTimer = null; }
}

function prdPaintChecks(ctx, slot) {
  const { d } = ctx;
  prdEnsure(ctx, 'checks');
  slot.innerHTML = prdChecksHtml(d.checks, { d });
  slot.querySelector('[data-act="tab-retry"]')?.addEventListener('click', () => prdLoad(ctx, 'checks'));
  slot.querySelectorAll('[data-act="check-details"]').forEach((button) => {
    button.onclick = () => window.api?.openExternal?.(button.dataset.url);
  });
  // A GitHub Actions job opens in the Actions view, on its run's page (project-actions-view.js).
  slot.querySelectorAll('[data-act="check-actions"]').forEach((button) => {
    button.onclick = () => openActionsRun(ctx.project, { repoPath: ctx.repoPath, runId: Number(button.dataset.run), jobId: Number(button.dataset.job) || null });
  });
  slot.querySelectorAll('[data-act="check-log"]').forEach((button) => {
    button.onclick = () => {
      const job = Number(button.dataset.job);
      if (d.openLogs.has(job)) d.openLogs.delete(job);
      else { d.openLogs.add(job); if (!d.logs.has(job) || d.logs.get(job).error) prdLoadLog(ctx, job); }
      prdRefresh(ctx);
    };
  });
  // A log opens at its end, where a failure says why.
  slot.querySelectorAll('.pr-log').forEach((pre) => {
    const job = Number(pre.dataset.log);
    if (d.logsScrolled?.has(job)) return;
    pre.scrollTop = pre.scrollHeight;
    (d.logsScrolled || (d.logsScrolled = new Set())).add(job);
  });
  slot.querySelectorAll('[data-act="rerun-job"]').forEach((button) => {
    button.onclick = () => prdRerun(ctx, button, { kind: 'rerun-job', jobId: Number(button.dataset.job) });
  });
  slot.querySelectorAll('[data-act="rerun-failed"]').forEach((button) => {
    button.onclick = () => prdRerun(ctx, button, { kind: 'rerun', runId: Number(button.dataset.run), failedOnly: true });
  });
  // While something runs, the checks are read again every 15 seconds, as long as this tab is shown.
  if (d.checks?.list?.some(c => c.bucket === 'pending')) {
    d.pollTimer = setTimeout(() => {
      d.pollTimer = null;
      if (d.tab === 'checks' && ctx.data.expanded.has(ctx.pr.number) && prActiveBody(ctx.project)) prdLoad(ctx, 'checks', { quiet: true });
    }, PR_CHECKS_POLL_MS);
  }
}

async function prdLoadLog(ctx, jobId) {
  const { d } = ctx;
  const entry = { loading: true };
  d.logs.set(jobId, entry);
  const result = await prApi('getPullRequestJobLog', ctx.project.id, ctx.repoPath, prRemoteOpts(ctx.data, { jobId }));
  if (d.logs.get(jobId) !== entry) return;
  d.logs.set(jobId, result?.ok ? { text: result.text || '', truncated: !!result.truncated } : { error: result?.error || 'The log could not be read.' });
  prdRefresh(ctx);
}

async function prdRerun(ctx, button, params) {
  button.disabled = true;
  const result = await prdEdit(ctx, params);
  if (!result?.ok) {
    if (button.isConnected) button.disabled = false;
    prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub did not start it again.' });
    return;
  }
  prSetNotice(ctx.project, ctx.state, { kind: 'ok', text: result.message });
  // GitHub takes a moment to queue the jobs again.
  setTimeout(() => prdLoad(ctx, 'checks', { quiet: true }), 3000);
}

// --- Viewed files (Files changed) ---

/** Mark a file viewed or not: shown at once, taken back if GitHub refuses. A viewed file's diff closes. */
async function prdToggleViewed(ctx, file, viewed, openPaths) {
  const { d, pr } = ctx;
  const map = d.viewed?.map || {};
  if (!d.viewed?.map) d.viewed = { map, loadedAt: Date.now() };
  const before = map[file.path];
  if (viewed) { map[file.path] = 'VIEWED'; openPaths?.delete(file.path); } else delete map[file.path];
  prdRefresh(ctx);
  const result = await prdEdit(ctx, { kind: viewed ? 'viewed' : 'unviewed', pullRequestId: pr.id, path: file.path });
  if (!result?.ok) {
    if (before) map[file.path] = before; else delete map[file.path];
    prSetNotice(ctx.project, ctx.state, { kind: 'error', text: result?.error || 'GitHub did not take it.' });
    prdRefresh(ctx);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PR_DETAIL_TABS, PR_REACTIONS, prdLogHtml,
    prDetailTab, setPrDetailTab, prdState, prFindPr, prdCounts, prdTabsHtml, prdMessageHtml, prdThreadHtml, prdEventText,
    prdTimelineHtml, prdConversationHtml, prdStatusBoxHtml, prdComposerHtml, prdSidebarHtml, prdCommitsHtml, prdChecksHtml,
    prdChecksSummaryText, prdDuration, prdLabelStyle, prdHunkHtml, prdReviewDialogHtml, prBaseChoices, prdMessageMenuItems, prdDay,
  };
}
