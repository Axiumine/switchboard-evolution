// An open pull request's tabs (public/pull-request-detail-view.js) and GitHub's
// text in them (public/pull-request-markdown.js): the pure parts, loaded in a
// vm context after the list view they build on, as index.html loads them.
// Without a document nothing is painted; the HTML each part draws is checked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const SOURCES = ['project-git-view.js', 'project-pull-requests-view.js', 'pull-request-markdown.js', 'pull-request-detail-view.js'].map(read);

function loadContext(extra = {}) {
  const icon = name => () => `<svg data-icon="${name}"></svg>`;
  const stored = new Map();
  const context = vm.createContext({
    window: { api: {} },
    escapeHtml: (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    pathBasename: (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '',
    PICONS: new Proxy({}, { get: (_t, name) => icon(name) }),
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) },
    ...extra,
  });
  for (const source of SOURCES) vm.runInContext(source, context);
  return context;
}

/** A stand-in for DOMPurify that records what it was given and marks what it returns. */
function fakePurify() {
  const calls = [];
  return {
    calls,
    hooks: [],
    addHook(name, fn) { this.hooks.push(name); },
    sanitize(html, options) { calls.push({ html, options }); return `[clean]${html}[/clean]`; },
  };
}

const plain = value => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-01-10T12:00:00Z');

function message(extra = {}) {
  return {
    kind: 'comment', id: 'IC_1', url: 'https://github.com/acme/widgets/pull/7#issuecomment-1',
    author: 'dev-two', avatar: 'https://avatars.example.com/u/2?v=4', association: 'MEMBER',
    body: 'Looks **good**', bodyHtml: '<p>Looks <strong>good</strong></p>', createdAt: '2026-01-09T12:00:00Z', editedAt: null,
    mine: true, can: { update: true, delete: true, minimize: false, react: true }, minimized: null,
    reactions: [{ content: 'THUMBS_UP', count: 2, mine: true }, { content: 'EYES', count: 1, mine: false }],
    ...extra,
  };
}

function freshD(ctx, extra = {}) {
  return Object.assign(ctx.prdState({ detail: new Map(), drafts: new Map() }, { number: 7 }), extra);
}

const PR = { number: 7, title: 'Add widgets', state: 'OPEN', isDraft: false, author: 'dev-one', base: 'main', head: 'feature', comments: 3, commitCount: 2, changedFiles: 4, checks: 'FAILURE' };

// --- GitHub's HTML and the editor ---

test('GitHub\'s HTML goes through DOMPurify with only http(s) and mailto links, no styles, no frames or forms', () => {
  const purify = fakePurify();
  const ctx = loadContext({ window: { api: {}, DOMPurify: purify } });
  assert.equal(ctx.prSafeHtml('<p>Hi</p>'), '[clean]<p>Hi</p>[/clean]');
  const { options } = purify.calls[0];
  assert.ok(options.ALLOWED_URI_REGEXP.test('https://github.com/x'));
  assert.ok(options.ALLOWED_URI_REGEXP.test('mailto:dev@example.com'));
  // Values that are not addresses pass (an input's type, a relative path): DOMPurify checks every attribute.
  for (const good of ['checkbox', 'auto', '#footnote-1', '/acme/widgets/pull/7']) assert.ok(options.ALLOWED_URI_REGEXP.test(good), good);
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', 'chrome-extension://x']) assert.ok(!options.ALLOWED_URI_REGEXP.test(bad), bad);
  for (const tag of ['style', 'form', 'iframe', 'object', 'embed', 'button', 'textarea', 'link', 'meta', 'base']) assert.ok(options.FORBID_TAGS.includes(tag), tag);
  assert.ok(options.FORBID_ATTR.includes('style'));
  assert.deepEqual(plain(purify.hooks), ['afterSanitizeAttributes']);
});

test('without DOMPurify none of GitHub\'s HTML is used: the Markdown shows as escaped text', () => {
  const ctx = loadContext();
  assert.equal(ctx.prSafeHtml('<img src=x onerror=alert(1)>', '**hi** <script>'), '<p class="pr-md-plain">**hi** &lt;script&gt;</p>');
});

test('the editor: Write and Preview, the draft as its text, its buttons, Cancel when asked', () => {
  const ctx = loadContext();
  const html = ctx.prEditorHtml({ key: 'edit:IC_1', text: 'a </textarea><b>', buttons: [{ act: 'close', label: 'Close with comment' }, { act: 'comment', label: 'Comment', primary: true }], cancel: true });
  assert.match(html, /<div class="pr-editor" data-editor="edit:IC_1">/);
  assert.match(html, /data-mode="write" role="tab" aria-selected="true">Write<\/button>/);
  assert.match(html, /data-mode="preview" role="tab" aria-selected="false">Preview<\/button>/);
  assert.match(html, /<textarea class="pr-editor-input"[^>]*>a &lt;\/textarea&gt;&lt;b&gt;<\/textarea>/);
  assert.deepEqual([...html.matchAll(/data-editor-act="([a-z]+)"/g)].map(m => m[1]), ['cancel', 'close', 'comment']);
  assert.match(html, /data-editor-act="comment" data-primary="1">Comment/);
  assert.doesNotMatch(ctx.prEditorHtml({ key: 'k', buttons: [] }), /data-editor-act="cancel"/);
});

test('a quote reply puts "> " before every line', () => {
  const ctx = loadContext();
  assert.equal(ctx.prQuoteText('first\n\nsecond\r\n'), '> first\n>\n> second\n\n');
});

// --- Tabs ---

test('the four tabs, with their counts and the last one chosen remembered', () => {
  const ctx = loadContext();
  assert.equal(ctx.prDetailTab(), 'conversation');
  ctx.setPrDetailTab('checks');
  assert.equal(ctx.prDetailTab(), 'checks');
  ctx.setPrDetailTab('nonsense');
  assert.equal(ctx.prDetailTab(), 'conversation');

  const d = freshD(ctx, { tab: 'files' });
  const html = ctx.prdTabsHtml(PR, d);
  assert.deepEqual([...html.matchAll(/data-tab="([a-z]+)">([A-Za-z ]+)/g)].map(m => [m[1], m[2]]),
    [['conversation', 'Conversation'], ['commits', 'Commits'], ['checks', 'Checks'], ['files', 'Files changed']]);
  assert.match(html, /class="pr-tab on" role="tab" aria-selected="true" data-tab="files"/);
  assert.match(html, /data-tab="conversation">Conversation<span class="pr-tab-count">3<\/span>/);
  assert.match(html, /data-tab="commits">Commits<span class="pr-tab-count">2<\/span>/);
  // The checks are counted once read; the list's roll-up colours their dot meanwhile.
  assert.match(html, /data-tab="checks">Checks<span class="pr-dot pr-dot--fail"/);
  assert.match(html, /data-tab="files">Files changed<span class="pr-tab-count">4<\/span>/);
  assert.match(html, /data-act="review">.*Review changes/);
  d.checks = { list: [{}, {}, {}], rollup: 'SUCCESS' };
  assert.match(ctx.prdTabsHtml(PR, d), /Checks<span class="pr-tab-count">3<\/span><span class="pr-dot pr-dot--ok"/);
  assert.doesNotMatch(ctx.prdTabsHtml({ ...PR, state: 'MERGED' }, d), /data-act="review"/);
});

// --- Conversation ---

test('a message: its author, when, its role, GitHub\'s HTML made safe, its reactions and its tools', () => {
  const purify = fakePurify();
  const ctx = loadContext({ window: { api: {}, DOMPurify: purify } });
  const html = ctx.prdMessageHtml(message(), { prAuthor: 'dev-two', now: NOW });
  assert.match(html, /<article class="pr-msg" data-msg="IC_1">/);
  assert.match(html, /<img class="pr-avatar" src="https:\/\/avatars\.example\.com\/u\/2\?v=4&amp;s=44"/);
  assert.match(html, /<span class="pr-msg-author">dev-two<\/span>\s*<span class="pr-msg-verb">commented<\/span>/);
  assert.match(html, /<span class="pr-assoc">Author<\/span><span class="pr-assoc">Member<\/span>/);
  assert.match(html, /<div class="pr-msg-body pr-md">\[clean\]<p>Looks <strong>good<\/strong><\/p>\[\/clean\]<\/div>/);
  assert.match(html, /class="pr-reaction mine" data-react="THUMBS_UP" data-subject="IC_1" aria-pressed="true"[^>]*>👍<span>2<\/span>/);
  assert.match(html, /class="pr-reaction" data-react="EYES"[^>]*>👀<span>1<\/span>/);
  assert.match(html, /data-act="react-add" data-subject="IC_1"/);
  assert.match(html, /data-act="msg-more" data-msg="IC_1"/);

  // An avatar that is not https is not loaded: the initial shows instead.
  assert.match(ctx.prdMessageHtml(message({ avatar: 'javascript:x' }), {}), /<span class="pr-avatar pr-avatar--none"[^>]*>D<\/span>/);
  // No reactions allowed: no "add" tool, chips off.
  const quiet = ctx.prdMessageHtml(message({ can: { update: false, delete: false, minimize: false, react: false } }), {});
  assert.doesNotMatch(quiet, /data-act="react-add"/);
  assert.match(quiet, /data-react="THUMBS_UP"[^>]* disabled/);
  assert.match(ctx.prdMessageHtml(message({ editedAt: '2026-01-09T13:00:00Z' }), {}), /<span class="pr-edited" title="Edited 2026-01-09T13:00:00Z">edited<\/span>/);
});

test('a message being edited shows the editor with its draft; a hidden one shows a line; an empty description says so', () => {
  const ctx = loadContext();
  const editing = ctx.prdMessageHtml(message(), { editing: true, draft: 'Changed my mind' });
  assert.match(editing, /data-editor="edit:IC_1"/);
  assert.match(editing, />Changed my mind<\/textarea>/);
  assert.match(editing, /data-editor-act="save" data-primary="1">Update comment/);
  assert.doesNotMatch(editing, /pr-msg-body|pr-reactions/);

  const hidden = ctx.prdMessageHtml(message({ minimized: 'off_topic' }), {});
  assert.match(hidden, /This comment was hidden as off topic\. <button type="button" class="pr-link-btn" data-act="show-hidden" data-msg="IC_1">Show it<\/button>/);
  assert.doesNotMatch(hidden, /pr-msg-body/);
  assert.match(ctx.prdMessageHtml(message({ minimized: 'off_topic' }), { shownHidden: true }), /pr-msg-body/);

  const description = ctx.prdMessageHtml(message({ kind: 'description', id: 'PR_7', body: '' }), {});
  assert.match(description, /opened this/);
  assert.match(description, /No description provided\./);
  assert.match(ctx.prdMessageHtml(message({ kind: 'description', id: 'PR_7' }), { editing: true }), /data-editor="edit:description".*Update description/s);
});

test('a review says what it decided', () => {
  const ctx = loadContext();
  assert.match(ctx.prdMessageHtml(message({ kind: 'review', id: 'PRR_1', state: 'APPROVED' }), {}), /pr-review-icon--ok.*approved these changes/s);
  assert.match(ctx.prdMessageHtml(message({ kind: 'review', id: 'PRR_1', state: 'CHANGES_REQUESTED' }), {}), /pr-review-icon--fail.*requested changes/s);
});

function thread(extra = {}) {
  return {
    id: 'PRRT_1', path: 'src/widget.js', line: 12, resolved: false, outdated: false, resolvedBy: null,
    can: { resolve: true, unresolve: false, reply: true }, reviewId: 'PRR_1',
    diffHunk: '@@ -1,8 +1,9 @@\n a\n b\n c\n d\n e\n f\n+g',
    comments: [message({ kind: 'review-comment', id: 'PRRC_1', replyTo: null })],
    ...extra,
  };
}

test('a review thread: its file and line, the end of its hunk, its comments, Reply and Resolve', () => {
  const ctx = loadContext();
  const d = freshD(ctx);
  const drafts = new Map();
  const open = ctx.prdThreadHtml(thread(), { d, drafts });
  assert.match(open, /<span class="pr-thread-path mono" title="src\/widget\.js">src\/widget\.js<\/span>\s*<span class="pr-thread-line">line 12<\/span>/);
  assert.match(open, /<pre class="git-diff pr-thread-hunk">/);
  // The hunk's header and its last five lines.
  assert.match(open, /@@ -1,8 \+1,9 @@/);
  assert.doesNotMatch(open, /git-diff-line"> a</);
  assert.match(open, /data-msg="PRRC_1"/);
  assert.match(open, /data-act="thread-reply">Reply…/);
  assert.match(open, /data-act="thread-resolve">Resolve conversation/);

  // A resolved one starts closed, and opens on a click.
  const resolved = thread({ resolved: true, resolvedBy: 'dev-one', can: { resolve: false, unresolve: true, reply: true } });
  const closed = ctx.prdThreadHtml(resolved, { d, drafts });
  assert.match(closed, /Resolved by dev-one/);
  assert.match(closed, /data-act="thread-toggle" aria-expanded="false"/);
  assert.doesNotMatch(closed, /pr-thread-hunk|data-msg="PRRC_1"|thread-reply/);
  d.openThreads.add('PRRT_1');
  assert.match(ctx.prdThreadHtml(resolved, { d, drafts }), /data-act="thread-unresolve">Unresolve conversation/);

  // Replying: the editor with its draft, in place of the button.
  d.editors.add('reply:PRRT_1');
  drafts.set('reply:PRRT_1', 'On it');
  const replying = ctx.prdThreadHtml(thread(), { d, drafts });
  assert.match(replying, /data-editor="reply:PRRT_1".*>On it<\/textarea>/s);
  assert.doesNotMatch(replying, /data-act="thread-reply"|thread-resolve/);
});

test('events read as sentences, with every value escaped', () => {
  const ctx = loadContext();
  const text = event => ctx.prdEventText({ actor: 'dev-one', ...event });
  assert.equal(text({ type: 'renamed', from: 'WIP <b>', to: 'Add <img src=x>' }), '<b>dev-one</b> changed the title <del>WIP &lt;b&gt;</del> Add &lt;img src=x&gt;');
  assert.match(text({ type: 'base-changed', from: 'develop', to: 'main' }), /changed the base branch from <span class="mono pr-event-ref">develop<\/span> to <span class="mono pr-event-ref">main<\/span>/);
  assert.match(text({ type: 'merged', commit: 'abc1234', to: 'main' }), /merged commit .*abc1234.* into .*main/);
  assert.match(text({ type: 'labeled', label: { name: 'bug', color: 'd73a4a' } }), /added the <span class="pr-label" style="--label-bg:rgba\(215,58,74,0\.18\)/);
  assert.equal(text({ type: 'assigned', subject: 'dev-one' }), '<b>dev-one</b> self-assigned this');
  assert.equal(text({ type: 'assigned', subject: 'dev-two' }), '<b>dev-one</b> assigned <b>dev-two</b>');
  assert.match(text({ type: 'review-dismissed', subject: 'dev-two', message: 'outdated' }), /dismissed <b>dev-two<\/b>'s review: outdated/);
  assert.equal(text({ type: 'closed' }), '<b>dev-one</b> closed this');
});

test('the timeline: commits in a row grouped, each review with its threads, threads of unread reviews at the end', () => {
  const ctx = loadContext();
  const d = freshD(ctx);
  const commit = (n, author = 'dev-one') => ({ kind: 'commit', oid: String(n).repeat(40), short: String(n).repeat(7), headline: `Step ${n}`, author, createdAt: '2026-01-09T10:00:00Z', checks: null });
  const conv = {
    items: [
      commit(1), commit(2),
      message({ kind: 'review', id: 'PRR_1', state: 'CHANGES_REQUESTED', body: 'See inline' }),
      { kind: 'event', type: 'closed', actor: 'dev-one', createdAt: '2026-01-09T11:00:00Z' },
      commit(3, 'dev-two'),
    ],
    threads: [thread(), thread({ id: 'PRRT_2', reviewId: 'PRR_9', path: 'src/other.js' })],
    hasNextPage: true,
  };
  let html = ctx.prdTimelineHtml(conv, { pr: { author: 'dev-one' }, now: NOW, d, drafts: new Map() });
  assert.match(html, /<b>dev-one<\/b> added 2 commits/);
  assert.match(html, /<b>dev-two<\/b> added 1 commit</);
  const order = [...html.matchAll(/added 2 commits|<article class="pr-msg[^"]*" data-msg="PRR_1"|data-thread="PRRT_1"|pr-event--closed|added 1 commit|data-thread="PRRT_2"/g)].map(m => m[0].replace(/^<article.*(data-msg)/, '$1'));
  assert.deepEqual(order, ['added 2 commits', 'data-msg="PRR_1"', 'data-thread="PRRT_1"', 'pr-event--closed', 'added 1 commit']);
  html = ctx.prdTimelineHtml({ ...conv, hasNextPage: false }, { pr: { author: 'dev-one' }, now: NOW, d, drafts: new Map() });
  assert.match(html, /data-thread="PRRT_2"/);
});

test('the box at the end: checks, reviews, conflicts, and Update branch when it is behind and GitHub allows it', () => {
  const ctx = loadContext();
  const head = { checks: 'SUCCESS', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND', can: { updateBranch: true } };
  const html = ctx.prdStatusBoxHtml(PR, { pr: head });
  assert.match(html, /pr-status-row--ok.*All checks have passed/s);
  assert.match(html, /Changes approved/);
  assert.match(html, /out-of-date with the base branch/);
  assert.match(html, /data-act="update-branch" data-method="MERGE">Update with merge commit/);
  assert.match(html, /data-act="update-branch" data-method="REBASE">Update with rebase/);
  assert.doesNotMatch(ctx.prdStatusBoxHtml(PR, { pr: { ...head, can: { updateBranch: false } } }), /data-act="update-branch"/);
  assert.match(ctx.prdStatusBoxHtml(PR, { pr: { ...head, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' } }), /conflicts with main that must be resolved/);
  assert.equal(ctx.prdStatusBoxHtml({ ...PR, state: 'MERGED' }, { pr: head }), '');
});

test('the composer: Comment, with Close with comment on an open one and Reopen with comment on a closed one, when allowed', () => {
  const ctx = loadContext();
  const drafts = new Map([['composer:7', 'half written']]);
  const acts = html => [...html.matchAll(/data-editor-act="([a-z]+)"/g)].map(m => m[1]);
  const open = ctx.prdComposerHtml(PR, { pr: { can: { close: true, reopen: false } } }, drafts);
  assert.deepEqual(acts(open), ['close', 'comment']);
  assert.match(open, />half written<\/textarea>/);
  assert.deepEqual(acts(ctx.prdComposerHtml(PR, { pr: { can: { close: false } } }, drafts)), ['comment']);
  assert.deepEqual(acts(ctx.prdComposerHtml({ ...PR, state: 'CLOSED' }, { pr: { can: { close: false, reopen: true } } }, drafts)), ['reopen', 'comment']);
});

test('the sidebar: reviewers with their state, assignees, labels, a gear where GitHub lets this account change them', () => {
  const ctx = loadContext();
  const head = {
    state: 'OPEN', can: { update: true, assign: false, label: true },
    reviewers: [{ kind: 'user', login: 'dev-two', avatar: null, state: 'APPROVED' }, { kind: 'team', login: 'core', name: 'Core', state: 'REQUESTED' }],
    assignees: [],
    labels: [{ id: 'L_1', name: 'bug', color: 'd73a4a', description: 'Something is wrong' }],
  };
  const html = ctx.prdSidebarHtml(head);
  assert.deepEqual([...html.matchAll(/data-act="side-edit" data-side="([a-z]+)"/g)].map(m => m[1]), ['reviewers', 'labels']);
  assert.match(html, /dev-two<\/span><span class="pr-dot pr-dot--ok" title="Approved"/);
  assert.match(html, /Core<\/span><span class="pr-dot pr-dot--wait" title="Awaiting review"/);
  assert.match(html, /No one assigned/);
  assert.match(html, /title="Something is wrong">bug<\/span>/);
  // Reviewers are asked for on an open pull request only.
  assert.doesNotMatch(ctx.prdSidebarHtml({ ...head, state: 'MERGED' }), /data-side="reviewers" title/);
});

test('a whole conversation: the description first, the timeline, Load more, the box and the composer, the sidebar beside', () => {
  const purify = fakePurify();
  const ctx = loadContext({ window: { api: {}, DOMPurify: purify } });
  const d = freshD(ctx);
  assert.match(ctx.prdConversationHtml(null, { pr: PR, d, drafts: new Map() }), /Reading the conversation/);
  assert.match(ctx.prdConversationHtml({ error: 'HTTP 502' }, { pr: PR, d, drafts: new Map() }), /HTTP 502.*data-act="tab-retry"/s);
  const conv = {
    pr: { id: 'PR_7', state: 'OPEN', author: 'dev-one', body: 'Why', bodyHtml: '<p>Why</p>', can: { update: true, close: true }, reviewers: [], assignees: [], labels: [], reactions: [] },
    items: [message()], threads: [], hasNextPage: true,
  };
  const html = ctx.prdConversationHtml(conv, { pr: PR, now: NOW, d, drafts: new Map() });
  const order = [...html.matchAll(/<article class="pr-msg[^"]*" data-msg="(PR_7|IC_1)"|data-act="timeline-more"|class="pr-composer"|class="pr-sidebar"/g)].map(m => m[1] || m[0]);
  assert.deepEqual(order, ['PR_7', 'IC_1', 'data-act="timeline-more"', 'class="pr-composer"', 'class="pr-sidebar"']);
  assert.ok(purify.calls.every(c => typeof c.options === 'object'));
});

test('the "…" of a message offers what GitHub lets this account do with it', () => {
  const ctx = loadContext();
  const d = freshD(ctx, { conversation: { pr: { url: 'https://github.com/acme/widgets/pull/7' }, threads: [] } });
  const menu = m => plain(ctx.prdMessageMenuItems({ d, data: { drafts: new Map() }, pr: PR }, m).map(i => (i.sep ? '—' : i.label)));
  assert.deepEqual(menu(message()), ['Copy link', 'Quote reply', 'Edit', 'Open on GitHub', '—', 'Delete…']);
  assert.deepEqual(menu(message({ mine: false, can: { update: false, delete: false, minimize: true, react: true } })), ['Copy link', 'Quote reply', 'Hide', 'Open on GitHub']);
  assert.deepEqual(menu(message({ minimized: 'spam', can: { update: false, delete: false, minimize: true, react: true } })), ['Copy link', 'Quote reply', 'Unhide', 'Open on GitHub']);
  assert.deepEqual(menu(message({ kind: 'description', id: 'PR_7', url: '' })), ['Copy link', 'Quote reply', 'Edit description', 'Open on GitHub']);
  // A review can be edited, never deleted from here.
  assert.deepEqual(menu(message({ kind: 'review', id: 'PRR_1' })), ['Copy link', 'Quote reply', 'Edit', 'Open on GitHub']);
});

// --- Commits ---

test('commits by day, each with its check, its short hash to copy and its page; an open one shows its message and files', () => {
  const ctx = loadContext();
  const d = freshD(ctx);
  const entry = { list: [
    { oid: 'a'.repeat(40), short: 'aaaaaaa', headline: 'First', body: '', date: '2026-01-03T10:00:00Z', author: 'dev-one', avatar: null, url: 'https://github.com/acme/widgets/commit/a', checks: 'SUCCESS' },
    { oid: 'b'.repeat(40), short: 'bbbbbbb', headline: 'Second <x>', body: 'Because\nreasons', date: '2026-01-05T10:00:00Z', author: 'dev-two', avatar: null, url: '', checks: null },
  ], totalCount: 2, truncated: false };
  let html = ctx.prdCommitsHtml(entry, { d, now: NOW });
  assert.deepEqual([...html.matchAll(/Commits on ([^<]+)</g)].map(m => m[1]), ['3 Jan 2026', '5 Jan 2026']);
  assert.match(html, /First<span class="pr-dot pr-dot--ok"/);
  assert.match(html, /Second &lt;x&gt;/);
  assert.match(html, /data-act="copy-sha" title="Copy the full hash: a{40}">aaaaaaa</);
  assert.equal((html.match(/data-act="commit-web"/g) || []).length, 1);
  assert.doesNotMatch(html, /pr-commit-detail/);
  d.openCommits.add('b'.repeat(40));
  html = ctx.prdCommitsHtml(entry, { d, now: NOW });
  assert.match(html, /<pre class="pr-commit-body">Because\nreasons<\/pre><div class="pr-commit-files" data-commit-files="b{40}">/);
  assert.match(ctx.prdCommitsHtml({ ...entry, truncated: true }, { d }), /first 250 commits/);
  assert.match(ctx.prdCommitsHtml(null, { d }), /Reading the commits/);
});

// --- Checks ---

function check(extra = {}) {
  return { kind: 'run', id: 11, name: 'test', title: '', group: 'CI', runId: 1, event: 'pull_request', status: 'COMPLETED', conclusion: 'FAILURE', bucket: 'fail', startedAt: '2026-01-04T10:00:00Z', completedAt: '2026-01-04T10:03:12Z', url: 'https://github.com/acme/widgets/actions/runs/1/job/11', required: true, actions: true, ...extra };
}

test('checks by workflow, with a summary, Log and Re-run for finished Actions jobs, Re-run failed jobs per run, Details', () => {
  const ctx = loadContext();
  const d = freshD(ctx);
  const entry = { list: [
    check(),
    check({ id: 12, name: 'lint', bucket: 'pass', conclusion: 'SUCCESS', required: false }),
    check({ id: 13, name: 'build', status: 'IN_PROGRESS', conclusion: null, bucket: 'pending', completedAt: null }),
    check({ kind: 'status', id: null, name: 'deploy/preview', group: '', runId: null, actions: false, bucket: 'pass', title: 'Deployed', url: 'https://preview.example/7' }),
  ], summary: { pass: 2, fail: 1, pending: 1, skipped: 0, cancelled: 0 } };
  const html = ctx.prdChecksHtml(entry, { d });
  assert.match(html, /<div class="pr-checks-head">1 failing, 1 in progress, 2 successful<\/div>/);
  assert.deepEqual([...html.matchAll(/class="pr-check-group-head"><span>([^<]+)</g)].map(m => m[1]), ['CI', 'Other checks']);
  assert.equal((html.match(/data-act="rerun-failed" data-run="1"/g) || []).length, 1);
  assert.match(html, /<span class="pr-check-name">test<\/span>\s*<span class="pr-flag">Required<\/span>/);
  assert.match(html, /<span class="pr-check-time">3m 12s<\/span>/);
  // A running job has no log or re-run yet; a status from another app has only Details.
  assert.deepEqual([...html.matchAll(/data-act="(check-log|rerun-job)" data-job="(\d+)"/g)].map(m => `${m[1]}:${m[2]}`), ['check-log:11', 'rerun-job:11', 'check-log:12', 'rerun-job:12']);
  assert.match(html, /data-act="check-details" data-url="https:\/\/preview\.example\/7"/);

  d.openLogs.add(11);
  assert.match(ctx.prdChecksHtml(entry, { d }), /Hide log.*Reading the log/s);
  d.logs.set(11, { text: '<error> at line 3', truncated: true });
  const withLog = ctx.prdChecksHtml(entry, { d });
  assert.match(withLog, /Only the end of the log is shown/);
  assert.match(withLog, /<pre class="pr-log" data-log="11">&lt;error&gt; at line 3<\/pre>/);
  assert.match(ctx.prdChecksHtml({ list: [], summary: {} }, { d }), /No checks on the last commit/);
});

test('a job\'s log reads GitHub Actions\' marks: groups, errors, warnings; everything escaped', () => {
  const ctx = loadContext();
  assert.equal(ctx.prdLogHtml('##[group]Run tests\nok <1>\n##[endgroup]\n##[error]Process failed <2>\n##[warning]slow\n##[debug]noise'),
    '<span class="pr-log-group">▸ Run tests</span>\nok &lt;1&gt;\n<span class="pr-log-error">Process failed &lt;2&gt;</span>\n<span class="pr-log-warning">slow</span>\nnoise');
});

test('small helpers: durations, label colours on the dark page, the branches Change base offers', () => {
  const ctx = loadContext();
  assert.equal(ctx.prdDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:45Z'), '45s');
  assert.equal(ctx.prdDuration('2026-01-01T00:00:00Z', '2026-01-01T01:02:00Z'), '1h 2m');
  assert.equal(ctx.prdDuration(null, '2026-01-01T00:00:00Z'), '');
  // A dark label is lightened for its text; a light one hardly.
  assert.match(ctx.prdLabelStyle('0e8a16'), /--label-text:rgb\(135,197,139\)/);
  assert.match(ctx.prdLabelStyle('fbca04'), /--label-text:rgb\(251,207,29\)/);
  assert.match(ctx.prdLabelStyle('not-a-colour'), /--label-bg:rgba\(138,138,160,0\.18\)/);
  assert.deepEqual(plain(ctx.prBaseChoices({ branches: ['develop', 'feature', 'main', 'release'], defaultBranch: 'release' }, { head: 'feature', base: 'main' })), ['release', 'develop']);
});

test('Review changes: Comment, Approve, Request changes; the last two off on one\'s own pull request', () => {
  const ctx = loadContext();
  const theirs = ctx.prdReviewDialogHtml(PR, { mine: false });
  assert.deepEqual([...theirs.matchAll(/value="([A-Z_]+)"( checked)?( disabled)?/g)].map(m => `${m[1]}${m[2] || ''}${m[3] || ''}`), ['COMMENT checked', 'APPROVE', 'REQUEST_CHANGES']);
  const mine = ctx.prdReviewDialogHtml(PR, { mine: true });
  assert.deepEqual([...mine.matchAll(/value="([A-Z_]+)"( checked)?( disabled)?/g)].map(m => `${m[1]}${m[2] || ''}${m[3] || ''}`), ['COMMENT checked', 'APPROVE disabled', 'REQUEST_CHANGES disabled']);
  assert.match(mine, /does not let you approve or request changes on your own pull request/);
});
