// Renderer-logic tests for the Git Graph tab (public/project-git-graph-view.js
// + public/git-graph-render.js), in the house `node --test` style used by
// test/git.test.js / test/projects.test.js: the modules are dedicated,
// side-effect-free-at-require-time files, so they are `require()`d directly
// (no jsdom/Electron) with the handful of browser globals they read
// (`escapeHtml`, `escapeAttr`, `PICONS`, `window.api`, `showContextMenu`, …)
// provided as plain stubs.
//
// Deliberately does NOT load git-graph-layout.js / git-graph-menus.js /
// git-graph-dialogs.js (files owned elsewhere): every call into them is
// behind a `typeof x === 'function'` guard, and this suite exists partly to
// prove that guard holds — the tab's own logic must not depend on those
// files being present. git-graph-settings.js is different: it's this same
// tab's own secondary-UI code, just split into its own file for size, so it
// loads here unguarded exactly like git-graph-render.js does.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

// escapeHtml/escapeAttr run as the *actual* public/utils.js functions, not a
// reimplementation — a security test here must fail the moment the real
// escaping logic regresses, the same way a change to it would break the
// running app. escapeHtml's only environment dependency is
// `document.createElement('div')` (set .textContent, read .innerHTML back);
// this stand-in implements just that one DOM text-serialization rule
// (browsers escape &/</> in a text node, never quotes — quotes don't need it
// outside an attribute) so utils.js's own escapeHtml runs completely unmodified.
function fakeEscapingDiv() {
  let text = '';
  return {
    set textContent(value) { text = String(value); },
    get textContent() { return text; },
    get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  };
}
const utilsContext = vm.createContext({ document: { createElement: () => fakeEscapingDiv() }, SessionConfig: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/utils.js'), 'utf8'), utilsContext);
global.escapeHtml = utilsContext.escapeHtml;
global.escapeAttr = utilsContext.escapeAttr;
// buildGitChangeTree/gitTreeRows come from #98's public/project-git-view.js;
// a trimmed stand-in is enough here since that file's own tests cover the
// tree builder itself, and this suite only needs a tree shape to flow through.
global.buildGitChangeTree = (changes) => {
  const root = new Map();
  for (const change of changes) {
    const parts = String(change.path || '').split('/').filter(Boolean);
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let node = level.get(part);
      if (!node || node.kind !== 'folder') { node = { kind: 'folder', name: part, children: new Map() }; level.set(part, node); }
      level = node.children;
    }
    const fileName = parts[parts.length - 1] || change.path;
    level.set(`\0${fileName}`, { kind: 'file', name: fileName, change });
  }
  const toArray = (map) => [...map.values()].map(node => node.kind === 'folder' ? { ...node, children: toArray(node.children) } : node);
  return toArray(root);
};
global.gitTreeRows = (tree, collapsedSet, keyPrefix, depth = 0) => {
  const rows = [];
  for (const node of tree) {
    const key = keyPrefix ? `${keyPrefix}/${node.name}` : node.name;
    if (node.kind === 'folder') {
      const collapsed = collapsedSet.has(key);
      let count = 0;
      const countFiles = (n) => { for (const c of n) count += c.kind === 'file' ? 1 : countFiles(c.children); };
      countFiles(node.children);
      rows.push({ kind: 'folder', depth, name: node.name, key, count, collapsed });
      if (!collapsed) rows.push(...global.gitTreeRows(node.children, collapsedSet, key, depth + 1));
    } else {
      rows.push({ kind: 'file', depth, name: node.name, key, change: node.change });
    }
  }
  return rows;
};

const render = require(path.join(__dirname, '../public/git-graph-render.js'));
Object.assign(global, render);

const settings = require(path.join(__dirname, '../public/git-graph-settings.js'));
Object.assign(global, settings);

const view = require(path.join(__dirname, '../public/project-git-graph-view.js'));
Object.assign(global, view);

// --- Small fake-DOM element, enough for the paint/wire functions under test
// to run to completion without throwing — mirrors project-messages-view.test.js's
// hand-stubbed-element idea, generalised so every query returns *something*
// usable rather than enumerating every selector a render pass might touch. ---

function fakeElement() {
  const el = {
    style: {}, dataset: {}, className: '', innerHTML: '', textContent: '',
    isConnected: true,
    appendChild(child) { return child; },
    prepend() {},
    remove() {},
    focus() {}, select() {}, scrollIntoView() {},
    closest() { return null; },
    getAttribute() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
  };
  return el;
}

function fakeTargetElement(attrs, href) {
  const dataset = { ...attrs };
  const el = {
    dataset,
    getAttribute(name) { return name === 'href' ? (href || null) : null; },
    href,
    closest(selector) {
      return selector === '[data-gg-kind]' && dataset.ggKind ? el : null;
    },
  };
  return el;
}

// === Pure helpers: git-graph-render.js ===

test('gitGraphFormatDate covers all five date-format variants', () => {
  const iso = '2019-03-24T21:34:00Z';
  assert.match(render.gitGraphFormatDate(iso, 'date-time'), /24 Mar 2019 \d{2}:\d{2}/);
  assert.equal(render.gitGraphFormatDate(iso, 'date-only'), '24 Mar 2019');
  assert.match(render.gitGraphFormatDate(iso, 'iso'), /^2019-03-24 \d{2}:\d{2}$/);
  assert.equal(render.gitGraphFormatDate(iso, 'iso-date-only'), '2019-03-24');
  const relative = render.gitGraphFormatDate(new Date(Date.now() - 5 * 60000).toISOString(), 'relative');
  assert.match(relative, /minute/);
});

test('gitGraphBuildLayoutInput always puts Uncommitted at the top and attaches stashes as single-parent pseudo-commits', () => {
  const commits = [
    { hash: 'c2', parents: ['c1'], authorDate: '2024-01-02T00:00:00Z', isHead: true, refs: { heads: [], remotes: [], tags: [] } },
    { hash: 'c1', parents: [], authorDate: '2024-01-01T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } },
  ];
  const stashes = [{ hash: 's1', index: 0, baseCommitHash: 'c1', message: 'WIP', date: '2024-01-01T12:00:00Z' }];
  const merged = render.gitGraphBuildLayoutInput(commits, stashes, { changeCount: 3 }, 'c2');
  assert.equal(merged[0].kind, 'uncommitted');
  assert.equal(merged[0].hash, '#uncommitted');
  assert.equal(merged[0].parents[0], 'c2');
  assert.ok(merged.some(r => r.kind === 'stash' && r.hash === 's1' && r.parents[0] === 'c1'));
  // Real commits are untouched (still 'commit' kind) and still present.
  assert.ok(merged.some(r => r.hash === 'c2' && r.kind === 'commit'));
});

test('gitGraphBuildLayoutInput keeps git order, so a rebased parent with a newer author date never lands above its child', () => {
  const commits = [
    { hash: 'child', parents: ['parent'], authorDate: '2024-01-01T00:00:00Z', commitDate: '2024-01-05T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } },
    { hash: 'parent', parents: [], authorDate: '2024-01-03T00:00:00Z', commitDate: '2024-01-04T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } },
  ];
  const stashes = [{ hash: 's1', index: 0, baseCommitHash: 'parent', message: 'WIP', date: '2024-01-06T00:00:00Z' }];
  const merged = render.gitGraphBuildLayoutInput(commits, stashes, null, 'child');
  const at = hash => merged.findIndex(r => r.hash === hash);
  assert.ok(at('child') < at('parent'));
  assert.ok(at('s1') < at('parent'), 'a stash stays above the commit it was taken from');
});

test('gitGraphBuildLayoutInput holds back a stash until the commit it was taken from is loaded', () => {
  const commits = [{ hash: 'c1', parents: ['c0'], commitDate: '2024-01-02T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }];
  const stashes = [{ hash: 's-old', index: 0, baseCommitHash: 'not-loaded', message: 'WIP', date: '2024-01-03T00:00:00Z' }];
  const merged = render.gitGraphBuildLayoutInput(commits, stashes, null, 'c1');
  assert.equal(merged.some(r => r.hash === 's-old'), false);
});

test('gitGraphFallbackLayout: a minimal one-lane-no-edges stand-in, used only when the real layout function is not loaded', () => {
  const commits = [
    { hash: 'c', parents: ['b'] }, { hash: 'b', parents: ['a'] }, { hash: 'a', parents: [] },
  ];
  const layout = render.gitGraphFallbackLayout(commits);
  assert.deepEqual(layout.map(r => r.hash), ['c', 'b', 'a']);
  assert.deepEqual(layout.map(r => r.lane), [0, 0, 0]);
  assert.deepEqual(layout.map(r => r.edges), [[], [], []]);
});

test('gitGraphResolveLayoutFn picks the real computeGitGraphLayout when it is loaded, the fallback otherwise', () => {
  assert.equal(render.gitGraphResolveLayoutFn(), render.gitGraphFallbackLayout);
  global.computeGitGraphLayout = () => [];
  try {
    assert.equal(render.gitGraphResolveLayoutFn(), global.computeGitGraphLayout);
  } finally {
    delete global.computeGitGraphLayout;
  }
});

test('gitGraphRenderRefPills: combined local+remote pill carries the two independently-hit-testable regions', () => {
  const commit = {
    hash: 'abc123', isHead: true,
    refs: { heads: ['main'], remotes: [{ remote: 'origin', name: 'main' }], tags: [] },
  };
  const html = render.gitGraphRenderRefPills(commit, { headBranchName: 'main' });
  assert.match(html, /data-gg-kind="branch"[^>]*data-gg-ref-type="local"/);
  assert.match(html, /data-gg-kind="remote-branch"[^>]*data-gg-ref-type="remote"/);
  assert.match(html, /gg-pill-head/); // HEAD emphasis on the matching local pill
});

test('gitGraphRenderRefPills: no HEAD emphasis when the branch name is not the checked-out one', () => {
  const commit = { hash: 'x', isHead: false, refs: { heads: ['feature'], remotes: [], tags: [] } };
  const html = render.gitGraphRenderRefPills(commit, { headBranchName: 'main' });
  assert.equal(html.includes('gg-pill-head'), false);
});

test('gitGraphRenderRefPills: local branch with no same-named remote gets its own single pill, not a combined pair', () => {
  const commit = { hash: 'x', refs: { heads: ['solo'], remotes: [{ remote: 'origin', name: 'other' }], tags: [] } };
  const html = render.gitGraphRenderRefPills(commit, {});
  assert.equal((html.match(/data-gg-kind="branch"/g) || []).length, 1);
  assert.equal((html.match(/data-gg-kind="remote-branch"/g) || []).length, 1);
  assert.equal(html.includes('gg-pill-combined'), false);
});

test('gitGraphRenderRefPills: a ref name with a quote or angle bracket never breaks out of its attribute', () => {
  const commit = { hash: 'x', refs: { heads: ['a"onmouseover=alert(1)//<b'], remotes: [], tags: [] } };
  const html = render.gitGraphRenderRefPills(commit, {});
  // The hostile text may still appear as inert, already-escaped text content
  // (safe); what must never happen is the quote closing the attribute early
  // and opening a live one — which would show up as a *space* right before it.
  assert.doesNotMatch(html, /ref-name="[^"]*" onmouseover=/);
  assert.match(html, /data-gg-ref-name="a&quot;onmouseover=alert\(1\)\/\/&lt;b"/);
});

// A single payload exercising every character that matters in HTML (", ', <, >, &),
// through all three ref kinds pills render (local branch, remote branch, tag) —
// not just the local-branch case above.
const GG_HOSTILE_REF = `it"'s <b>&"onmouseover=alert(1)</b>`;
const GG_HOSTILE_REF_ESCAPED_ATTR = 'it&quot;&#39;s &lt;b&gt;&amp;&quot;onmouseover=alert(1)&lt;/b&gt;';

test('gitGraphRenderRefPills: a remote branch name with \', ", <, >, & never breaks out of its attributes', () => {
  const commit = { hash: 'x', refs: { heads: [], remotes: [{ remote: 'origin', name: GG_HOSTILE_REF }], tags: [] } };
  const html = render.gitGraphRenderRefPills(commit, {});
  assert.doesNotMatch(html, /data-gg-ref-name="[^"]*" onmouseover=/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, new RegExp(`data-gg-ref-name="${GG_HOSTILE_REF_ESCAPED_ATTR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('gitGraphRenderRefPills: a tag name with \', ", <, >, & never breaks out of its attributes', () => {
  const commit = { hash: 'x', refs: { heads: [], remotes: [], tags: [GG_HOSTILE_REF] } };
  const html = render.gitGraphRenderRefPills(commit, {});
  assert.doesNotMatch(html, /data-gg-ref-name="[^"]*" onmouseover=/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, new RegExp(`data-gg-kind="tag"[^>]*data-gg-ref-name="${GG_HOSTILE_REF_ESCAPED_ATTR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('a stash message with \', ", <, >, & is escaped as inert text, both in the row list and once its base-commit HTML entities pass back through it', () => {
  const project = { id: 'proj-stash-xss' };
  const state = view.gitGraphState(project.id);
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rawCommits = [];
  state.stashes = [];
  state.uncommitted = null;
  state.rows = [{
    hash: 's0', shortHash: 's0', kind: 'stash', stashIndex: 0, parents: [],
    authorName: '', authorDate: '2024-01-01T00:00:00Z', commitDate: '2024-01-01T00:00:00Z',
    subject: GG_HOSTILE_REF, refs: { heads: [], remotes: [], tags: [] },
  }];
  state.layout = [{ lane: 0, colorIndex: 0, edges: [] }];
  const body = fakeElement();
  view.gitGraphPaint(project, state, body);
  // escapeHtml (text content) leaves quotes alone — only & < > need escaping
  // outside an attribute — so the quotes may reappear literally; what must
  // never reappear is a live '<b>' tag.
  assert.doesNotMatch(body.innerHTML, /<b>/);
  assert.match(body.innerHTML, /gg-subject">it"'s &lt;b&gt;&amp;"onmouseover=alert\(1\)&lt;\/b&gt;</);
});

test('gitGraphRowClasses: merge commits are muted by default, stashes/uncommitted never are', () => {
  const merge = render.gitGraphRowClasses({ kind: 'commit', parents: ['a', 'b'] }, { muteMergeCommits: true });
  assert.ok(merge.includes('gg-muted'));
  const stash = render.gitGraphRowClasses({ kind: 'stash', parents: ['a', 'b'] }, { muteMergeCommits: true });
  assert.equal(stash.includes('gg-muted'), false);
  const off = render.gitGraphRowClasses({ kind: 'commit', parents: ['a', 'b'] }, { muteMergeCommits: false });
  assert.equal(off.includes('gg-muted'), false);
});

test('gitGraphDiffStatHtml / gitGraphStatusBadge / gitGraphAccessibilityBadge', () => {
  assert.match(render.gitGraphDiffStatHtml({ insertions: 3, deletions: 1 }), /\+3/);
  assert.match(render.gitGraphDiffStatHtml({ insertions: 3, deletions: 1 }), /-1/);
  assert.equal(render.gitGraphDiffStatHtml({ insertions: 0, deletions: 0 }), '');
  assert.equal(render.gitGraphStatusBadge('renamed'), 'R');
  assert.equal(render.gitGraphStatusBadge('untracked'), 'U');
  assert.equal(render.gitGraphAccessibilityBadge('renamed'), 'R');
  assert.equal(render.gitGraphAccessibilityBadge('untracked'), 'U');
});

test('gitGraphPaletteColor escapes a hostile "Lane colours" entry before it reaches an SVG attribute', () => {
  const hostile = 'red" onmouseover="alert(1)';
  const color = render.gitGraphPaletteColor([hostile], 0);
  assert.doesNotMatch(color, /" onmouseover=/);
  assert.match(color, /&quot;/);
});

// === Pure helpers: project-git-graph-view.js ===

test('gitGraphFindMatches: matches message/date/author/hash/branch/tag substrings', () => {
  const rows = [
    { hash: 'aa11', subject: 'Fix login bug', authorName: 'Ada', authorDate: '2024-05-01T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } },
    { hash: 'bb22', subject: 'Unrelated', authorName: 'Grace', authorDate: '2024-05-02T00:00:00Z', refs: { heads: ['release-login'], remotes: [], tags: [] } },
    { hash: 'cc33', subject: 'Nothing matches here', authorName: 'Bob', authorDate: '2024-05-03T00:00:00Z', refs: { heads: [], remotes: [], tags: ['login-tag'] } },
  ];
  assert.deepEqual(view.gitGraphFindMatches(rows, 'login', false), [0, 1, 2]);
  assert.deepEqual(view.gitGraphFindMatches(rows, 'ada', false), [0]);
  assert.deepEqual(view.gitGraphFindMatches(rows, 'Ada', true), [0]);
  assert.deepEqual(view.gitGraphFindMatches(rows, 'ada', true), []);
  assert.deepEqual(view.gitGraphFindMatches(rows, '', false), []);
});

test('gitGraphHandleEscapePriority closes dialog, then menu, then details, then Find, in that order', () => {
  const order = [];
  view.gitGraphHandleEscapePriority({
    closeDialog: () => { order.push('dialog'); return true; },
    closeMenu: () => { order.push('menu'); return true; },
    closeDetails: () => { order.push('details'); return true; },
  });
  assert.deepEqual(order, ['dialog']);

  order.length = 0;
  const result = view.gitGraphHandleEscapePriority({
    closeDialog: () => false,
    closeMenu: () => { order.push('menu'); return true; },
    closeDetails: () => { order.push('details'); return true; },
  });
  assert.deepEqual(order, ['menu']);
  assert.equal(result, 'menu');

  order.length = 0;
  view.gitGraphHandleEscapePriority({
    closeDialog: () => false,
    closeMenu: () => false,
    closeDetails: () => { order.push('details'); return true; },
  });
  assert.deepEqual(order, ['details']);

  order.length = 0;
  const findResult = view.gitGraphHandleEscapePriority({
    closeDialog: () => false,
    closeMenu: () => false,
    closeDetails: () => false,
    closeFind: () => { order.push('find'); return true; },
  });
  assert.deepEqual(order, ['find'], 'Escape closes the Find widget when nothing higher-priority is open');
  assert.equal(findResult, 'find');
});

// === A stale repositories cache is refreshed on tab re-entry ===

test('gitGraphSameStringSet compares two path lists regardless of order', () => {
  assert.equal(view.gitGraphSameStringSet(['a', 'b'], ['b', 'a']), true);
  assert.equal(view.gitGraphSameStringSet(['a'], ['a', 'b']), false);
});

test('renderProjectGitGraphTab notices a folder attached elsewhere and refreshes the repo list without losing the loaded graph', async () => {
  const project = { id: 'proj-attach-1', root: '/repo-a', folders: [] };
  const body = fakeElement();
  const calls = [];
  global.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null };
  global.selectedProject = () => project;
  global.projectTab = () => 'git'; global.projectGitView = () => 'history';
  global.pathBasename = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
  global.window = {
    api: {
      getProjectGitInfo: (id) => {
        calls.push(id);
        const repos = [{ path: '/repo-a', git: true }, ...project.folders.map(f => ({ path: f.path, git: true }))];
        return Promise.resolve({ ok: true, repositories: repos });
      },
    },
  };

  // First render populates the cache with just the root repo.
  view.renderProjectGitGraphTab(project, body);
  await new Promise(resolve => setImmediate(resolve));
  const state = view.gitGraphState(project.id);
  assert.deepEqual(state.repositories.map(r => r.path), ['/repo-a']);
  assert.equal(calls.length, 1);

  // A folder gets attached elsewhere (e.g. from the Settings tab) while this
  // tab isn't the one being painted — project.folders changes, nothing else
  // tells this tab about it.
  project.folders = [{ path: '/repo-b' }];
  state.rows = [{ hash: 'kept' }]; // stands in for an already-loaded graph that must survive the refresh
  view.renderProjectGitGraphTab(project, body);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.repositories.map(r => r.path).sort(), ['/repo-a', '/repo-b']);
  assert.equal(calls.length, 2);
  assert.deepEqual(state.rows, [{ hash: 'kept' }], 'the already-loaded graph for the still-selected repo is not thrown away');
});

// === Commit Details arrow-key navigation ===

test('gitGraphSameBranchNeighbor follows the row\'s own same-lane edge for a parent, and the earlier row pointing back at it for a child', () => {
  const state = {
    rows: [{ hash: 'c3' }, { hash: 'c2' }, { hash: 'c1' }],
    layout: [
      { edges: [{ parentHash: 'c2', style: 'same-lane' }] },
      { edges: [{ parentHash: 'c1', style: 'same-lane' }] },
      { edges: [] },
    ],
  };
  assert.equal(view.gitGraphSameBranchNeighbor(state, 'c3', 1), 'c2', 'Down from c3 reaches its parent c2');
  assert.equal(view.gitGraphSameBranchNeighbor(state, 'c1', -1), 'c2', 'Up from c1 reaches its child c2');
  assert.equal(view.gitGraphSameBranchNeighbor(state, 'c1', 1), null, 'the root commit has no parent to follow');
});

test('gitGraphAlternateBranchNeighbor follows a branch-out/merge-in edge instead of the same-lane one', () => {
  const state = {
    rows: [{ hash: 'merge' }, { hash: 'main1' }, { hash: 'feat1' }, { hash: 'base' }],
    layout: [
      { edges: [{ parentHash: 'main1', style: 'same-lane' }, { parentHash: 'feat1', style: 'branch-out' }] },
      { edges: [{ parentHash: 'base', style: 'same-lane' }] },
      { edges: [{ parentHash: 'base', style: 'merge-in' }] },
      { edges: [] },
    ],
  };
  assert.equal(view.gitGraphAlternateBranchNeighbor(state, 'merge', 1), 'feat1', 'the alternate parent at the merge is the other side, not main1');
  assert.equal(view.gitGraphAlternateBranchNeighbor(state, 'base', -1), 'feat1', 'the alternate child of base is the merge-in side, not main1');
});

test('gitGraphMoveDetailsFocus (mode "sameBranch") steps along the loaded window\'s own same-lane edges', () => {
  const state = view.gitGraphState('proj-nav-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rows = [{ hash: 'a', parents: ['b'] }, { hash: 'b', parents: ['c'] }, { hash: 'c', parents: [] }];
  state.layout = [
    { edges: [{ parentHash: 'b', style: 'same-lane' }] },
    { edges: [{ parentHash: 'c', style: 'same-lane' }] },
    { edges: [] },
  ];
  state.selectedHash = 'b';
  const project = { id: 'proj-nav-1' };
  const body = fakeElement();
  global.window = { api: { getGitGraphCommitDetail: () => Promise.resolve({ ok: true, commit: {}, files: [] }) } };

  view.gitGraphMoveDetailsFocus(project, state, body, 1, 'sameBranch');
  assert.equal(state.selectedHash, 'c');
  view.gitGraphMoveDetailsFocus(project, state, body, -1, 'sameBranch');
  assert.equal(state.selectedHash, 'b');
  view.gitGraphMoveDetailsFocus(project, state, body, 1, 'sameBranch');
  view.gitGraphMoveDetailsFocus(project, state, body, 1, 'sameBranch');
  assert.equal(state.selectedHash, 'c', 'stepping past the root is a no-op');
});

test('Escape closes the Find widget when it is the only thing open', () => {
  const state = view.gitGraphState('proj-find-esc-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rows = [];
  state.findOpen = true;
  const project = { id: 'proj-find-esc-1' };
  const body = fakeElement();
  global.window = { api: {} };
  global.document = { addEventListener: (type, fn) => { if (type === 'keydown') global.document._handler = fn; }, removeEventListener() {}, getElementById: () => null };
  global.selectedProject = () => project;
  global.projectTab = () => 'git'; global.projectGitView = () => 'history';

  view.gitGraphBindKeyboard(project, state, body);
  global.document._handler({ key: 'Escape', target: {}, preventDefault() {} });
  assert.equal(state.findOpen, false);
});

test('the keydown handler never fires once the tab is no longer the active one', () => {
  const state = view.gitGraphState('proj-inactive-1');
  state.findOpen = true;
  const project = { id: 'proj-inactive-1' };
  const body = fakeElement();
  global.document = { addEventListener: (type, fn) => { if (type === 'keydown') global.document._handler = fn; }, removeEventListener() {}, getElementById: () => null };
  global.selectedProject = () => project;
  global.projectTab = () => 'files'; // the project view moved to a different tab; #ws-body was never removed from the DOM
  view.gitGraphBindKeyboard(project, state, body);
  global.document._handler({ key: 'Escape', target: {}, preventDefault() {} });
  assert.equal(state.findOpen, true, 'a handler bound while this tab was active must still no-op once the tab changes');
});

test('Ctrl/Cmd+ArrowDown is left alone (never preventDefault-ed) so the app\'s own session-switch shortcut still fires', () => {
  const state = view.gitGraphState('proj-modarrow-1');
  state.rows = [{ hash: 'a' }, { hash: 'b' }];
  state.selectedHash = 'a';
  state.detailsData = { mode: 'single', hash: 'a' };
  const project = { id: 'proj-modarrow-1' };
  const body = fakeElement();
  global.document = { addEventListener: (type, fn) => { if (type === 'keydown') global.document._handler = fn; }, removeEventListener() {}, getElementById: () => null };
  global.selectedProject = () => project;
  global.projectTab = () => 'git'; global.projectGitView = () => 'history';
  global.window = { api: {} };
  view.gitGraphBindKeyboard(project, state, body);
  let prevented = false;
  global.document._handler({ key: 'ArrowDown', metaKey: true, target: {}, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(state.selectedHash, 'a', 'a Cmd-held arrow must not move the details focus either');
});

test('gitGraphReadTargetData reads the frozen data-gg-* contract off the carrying element', () => {
  const el = fakeTargetElement({ ggKind: 'remote-branch', ggRefName: 'main', ggRemote: 'origin', ggRefType: 'remote', ggHash: 'deadbeef' });
  const data = view.gitGraphReadTargetData(el);
  assert.equal(data.kind, 'remote-branch');
  assert.equal(data.refName, 'main');
  assert.equal(data.remote, 'origin');
  assert.equal(data.refType, 'remote');
  assert.equal(view.gitGraphReadTargetData({ closest: () => null }), null);
});

test('gitGraphHandleDoubleClick on a commit opens the same in-app Checkout Commit… confirmation the menu uses, never an unconfirmed action', () => {
  const calls = [];
  global.gitGraphShowCheckoutCommitDialog = (params) => { calls.push(params); return Promise.resolve({ ok: true }); };
  try {
    const project = { id: 'p1' };
    const state = view.gitGraphState('proj-dblclick-commit');
    state.rows = [{ hash: 'c0ffee', shortHash: 'c0ffee' }];
    const body = fakeElement();
    const el = fakeTargetElement({ ggKind: 'commit', ggHash: 'c0ffee' });
    const action = view.gitGraphHandleDoubleClick(project, state, body, el, { projectId: 'p1', repoPath: '/repo' });
    assert.equal(action, 'checkoutCommit');
    assert.equal(calls[0].projectId, 'p1');
    assert.equal(calls[0].folderPath, '/repo');
    assert.equal(calls[0].commitHash, 'c0ffee');
  } finally { delete global.gitGraphShowCheckoutCommitDialog; }
});

test('gitGraphHandleDoubleClick checks out a local branch immediately (no confirmation needed), never a remote-branch region', () => {
  const calls = [];
  global.gitGraphRunImmediateAction = (ctx, actionId, params) => { calls.push([ctx.projectId, ctx.folderPath, actionId, params]); return Promise.resolve({ ok: true }); };
  try {
    const project = { id: 'p1' };
    const state = view.gitGraphState('proj-dblclick-branch');
    const body = fakeElement();
    const local = fakeTargetElement({ ggKind: 'branch', ggRefName: 'feature-x' });
    assert.equal(view.gitGraphHandleDoubleClick(project, state, body, local, { projectId: 'p1', repoPath: '/repo' }), 'checkoutBranchImmediate');
    assert.deepEqual(calls[0], ['p1', '/repo', 'checkoutBranchImmediate', { name: 'feature-x' }]);

    calls.length = 0;
    const remote = fakeTargetElement({ ggKind: 'remote-branch', ggRefName: 'feature-x', ggRemote: 'origin' });
    assert.equal(view.gitGraphHandleDoubleClick(project, state, body, remote, { projectId: 'p1', repoPath: '/repo' }), null);
    assert.equal(calls.length, 0);
  } finally { delete global.gitGraphRunImmediateAction; }
});

test('gitGraphHandleDoubleClick on the remote half of a combined pill checks out the matching local branch', () => {
  const calls = [];
  global.gitGraphRunImmediateAction = (ctx, actionId, params) => { calls.push([ctx.projectId, ctx.folderPath, actionId, params]); return Promise.resolve({ ok: true }); };
  try {
    const project = { id: 'p1' };
    const state = view.gitGraphState('proj-dblclick-combined');
    const body = fakeElement();
    const remote = fakeTargetElement({ ggKind: 'remote-branch', ggRefName: 'feature-x', ggRemote: 'origin' });
    const ctx = { projectId: 'p1', repoPath: '/repo', localBranchNames: new Set(['feature-x']) };
    assert.equal(view.gitGraphHandleDoubleClick(project, state, body, remote, ctx), 'checkoutBranchImmediate');
    assert.deepEqual(calls[0], ['p1', '/repo', 'checkoutBranchImmediate', { name: 'feature-x' }]);

    // A bare remote pill with no matching local branch still does nothing.
    calls.length = 0;
    const bareRemote = fakeTargetElement({ ggKind: 'remote-branch', ggRefName: 'no-local', ggRemote: 'origin' });
    assert.equal(view.gitGraphHandleDoubleClick(project, state, body, bareRemote, ctx), null);
    assert.equal(calls.length, 0);
  } finally { delete global.gitGraphRunImmediateAction; }
});

test('gitGraphComputeChildren maps a parent hash to every commit that names it as a parent, including octopus merges', () => {
  const commits = [
    { hash: 'merge', parents: ['a', 'b', 'c'] },
    { hash: 'a', parents: ['root'] },
    { hash: 'b', parents: ['root'] },
    { hash: 'c', parents: ['root'] },
  ];
  const map = view.gitGraphComputeChildren(commits);
  assert.deepEqual(map.get('root').map(c => c.hash).sort(), ['a', 'b', 'c']);
  assert.deepEqual(map.get('a').map(c => c.hash), ['merge']);
  assert.equal(map.has('merge'), false);
});

test('gitGraphAllBranchKeys / gitGraphDefaultRemoteName / gitGraphRemoteBranchesByLocalName', () => {
  const refs = {
    heads: [{ name: 'main', hash: 'h1', isHead: true }, { name: 'dev', hash: 'h2', isHead: false }],
    remotes: [{ remote: 'origin', name: 'main', hash: 'h1' }, { remote: 'upstream', name: 'main', hash: 'h1' }],
  };
  assert.deepEqual(view.gitGraphAllBranchKeys({ refs }), ['main', 'dev', 'origin/main', 'upstream/main']);
  assert.equal(view.gitGraphDefaultRemoteName([{ name: 'upstream' }, { name: 'origin' }]), 'origin');
  assert.equal(view.gitGraphDefaultRemoteName([{ name: 'upstream' }]), 'upstream');
  assert.equal(view.gitGraphDefaultRemoteName([]), null);
  const byLocal = view.gitGraphRemoteBranchesByLocalName(refs);
  assert.equal(byLocal.main.length, 2);
});

test('gitGraphPopulateTargetField fills the one target-specific ctx field git-graph-menus.js expects, per kind', () => {
  const state = {
    rows: [{ hash: 'c1', shortHash: 'c1', subject: 'Do a thing', parents: ['p1'] }],
    childrenByHash: new Map([['p1', [{ hash: 'c1', parents: ['p1'] }]]]),
    refs: { tags: [{ name: 'v1', hash: 'c1', annotated: true }] },
    stashes: [{ hash: 's1', index: 0, branch: 'main', message: 'WIP on main' }],
    detailsData: { mode: 'single', hash: 'c1', kind: 'commit', files: [{ path: 'a/b.txt', status: 'modified' }] },
    repositories: [{ path: '/repo' }],
    selectedRepo: '/repo',
  };

  const commitCtx = {}; view.gitGraphPopulateTargetField(commitCtx, state, { kind: 'commit', hash: 'c1' });
  assert.equal(commitCtx.commit.subject, 'Do a thing');
  assert.equal(commitCtx.commit.children.length, 0); // c1 has no children in this fixture

  const localCtx = {}; view.gitGraphPopulateTargetField(localCtx, state, { kind: 'branch', refType: 'local', refName: 'main', hash: 'h' });
  assert.deepEqual(localCtx.localBranch, { name: 'main', hash: 'h' });
  assert.equal(localCtx.remoteBranch, undefined);

  // The combined pill's *remote* hit-region (data-gg-kind="branch" data-gg-ref-type="remote") must
  // populate remoteBranch, not localBranch — this is the dual-hit-region contract.
  const combinedRemoteCtx = {}; view.gitGraphPopulateTargetField(combinedRemoteCtx, state, { kind: 'branch', refType: 'remote', refName: 'main', remote: 'origin', hash: 'h' });
  assert.deepEqual(combinedRemoteCtx.remoteBranch, { remote: 'origin', name: 'main', hash: 'h' });
  assert.equal(combinedRemoteCtx.localBranch, undefined);

  const tagCtx = {}; view.gitGraphPopulateTargetField(tagCtx, state, { kind: 'tag', refName: 'v1', hash: 'c1' });
  assert.equal(tagCtx.tag.name, 'v1');
  assert.equal(tagCtx.tag.annotated, true);

  const stashCtx = {}; view.gitGraphPopulateTargetField(stashCtx, state, { kind: 'stash', hash: 's1' });
  assert.equal(stashCtx.stash.message, 'WIP on main');

  const fileCtx = {}; view.gitGraphPopulateTargetField(fileCtx, state, { kind: 'file', filePath: 'a/b.txt' });
  assert.equal(fileCtx.file.relativePath, 'a/b.txt');
  assert.equal(fileCtx.file.absolutePath, '/repo/a/b.txt');
  assert.equal(fileCtx.file.isHistoricalSingleCommit, true);

  const linkCtx = {}; view.gitGraphPopulateTargetField(linkCtx, state, { kind: 'link', el: fakeTargetElement({}, 'https://example.com/x') });
  assert.equal(linkCtx.link.url, 'https://example.com/x');

  const colCtx = {}; view.gitGraphPopulateTargetField(colCtx, state, { kind: 'column-header' });
  assert.ok(colCtx.columnHeader);
});

test('gitGraphOpenContextMenu wires ctx.onColumnVisibilityChange/onViewDiff/onViewFileAtRevision through to git-graph-menus.js', () => {
  const state = view.gitGraphState('proj-menu-ctx-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rows = [{ hash: 'c1', shortHash: 'c1', subject: 's' }];
  state.columns = { date: true, author: false, commit: true };
  const project = { id: 'proj-menu-ctx-1' };
  const body = fakeElement();

  let shownItems = null;
  global.showContextMenu = (items) => { shownItems = items; };
  global.gitGraphReadTargetAttrs = (el) => ({ kind: el.dataset.ggKind, hash: el.dataset.ggHash, refName: null, remote: null, refType: null, filePath: null });
  global.gitGraphShowContextMenu = (el, ctx) => {
    const items = ctx.columnHeader ? [{ id: 'date', checked: !!ctx.columnHeader.columnVisibility.date, onClick: () => ctx.onColumnVisibilityChange('date', !ctx.columnHeader.columnVisibility.date) }] : [];
    shownItems = items;
    return items;
  };
  try {
    const header = fakeTargetElement({ ggKind: 'column-header' });
    view.gitGraphOpenContextMenu(project, state, body, header, { x: 0, y: 0 });
    assert.ok(shownItems);
    assert.equal(shownItems[0].checked, true);
    shownItems[0].onClick();
    assert.equal(state.columns.date, false, 'the real onColumnVisibilityChange callback ran and flipped state');
  } finally {
    delete global.gitGraphReadTargetAttrs;
    delete global.gitGraphShowContextMenu;
    delete global.showContextMenu;
  }
});

test('gitGraphBuildFileCtx: a file in an Uncommitted-Changes details view is flagged as the working-tree side', () => {
  const state = {
    detailsData: { mode: 'single', kind: 'uncommitted', files: [{ path: 'x.txt', status: 'deleted' }] },
    repositories: [{ path: '/repo' }], selectedRepo: '/repo',
  };
  const fileCtx = view.gitGraphBuildFileCtx(state, 'x.txt');
  assert.equal(fileCtx.isWorkingTreeSide, true);
  assert.equal(fileCtx.existsOnDisk, false);
  assert.equal(fileCtx.isHistoricalSingleCommit, false);
});

test('gitGraphDispatchContextMenu (own fallback dispatcher) routes each data-gg-kind to the matching global builder name', () => {
  const seen = [];
  for (const builderName of Object.values(view.GG_MENU_BUILDERS)) {
    global[builderName] = (ctx) => { seen.push([builderName, ctx.marker]); return [{ label: 'x' }]; };
  }
  let shown = null;
  global.showContextMenu = (items, position) => { shown = { items, position }; };

  const kinds = [
    ['commit', {}], ['uncommitted', {}], ['tag', {}], ['stash', {}],
    ['file', {}], ['column-header', {}], ['link', {}],
  ];
  for (const [kind] of kinds) {
    seen.length = 0;
    const el = fakeTargetElement({ ggKind: kind });
    const ok = view.gitGraphDispatchContextMenu(el, { marker: kind }, { x: 1, y: 2 });
    assert.equal(ok, true, `expected a builder for kind=${kind}`);
    assert.equal(seen[0][1], kind);
  }

  // The combined pill's dual hit-regions: a "branch" kind with refType 'remote'
  // must route to the remote-branch builder, never the local one.
  seen.length = 0;
  const remoteRegion = fakeTargetElement({ ggKind: 'branch', ggRefType: 'remote' });
  view.gitGraphDispatchContextMenu(remoteRegion, { marker: 'combined-remote-region' }, { x: 0, y: 0 });
  assert.equal(seen[0][0], view.GG_MENU_BUILDERS['remote-branch']);

  seen.length = 0;
  const localRegion = fakeTargetElement({ ggKind: 'branch' });
  view.gitGraphDispatchContextMenu(localRegion, { marker: 'local-region' }, { x: 0, y: 0 });
  assert.equal(seen[0][0], view.GG_MENU_BUILDERS.branch);

  for (const builderName of Object.values(view.GG_MENU_BUILDERS)) delete global[builderName];
  delete global.showContextMenu;
});

test('gitGraphDispatchContextMenu returns false for an element carrying no data-gg-kind, and never calls showContextMenu', () => {
  let called = false;
  global.showContextMenu = () => { called = true; };
  const plain = { closest() { return null; } };
  assert.equal(view.gitGraphDispatchContextMenu(plain, {}, { x: 0, y: 0 }), false);
  assert.equal(called, false);
  delete global.showContextMenu;
});

// === A light integration-shaped test: staleness guard on the main graph load ===
// Mirrors project-git-view.js's own tested "only the latest request wins" pattern
// applied to getProjectGitGraph.

test('gitGraphLoadGraph discards an older reply once a newer load has started, regardless of resolution order', async () => {
  const state = view.gitGraphState('proj-stale-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  const project = { id: 'proj-stale-1' };
  const body = fakeElement();

  const resolvers = [];
  global.window = {
    api: {
      getProjectGitGraph: () => new Promise((resolve) => resolvers.push(resolve)),
    },
  };

  const p1 = view.gitGraphLoadGraph(project, state, body, { reset: true });
  const p2 = view.gitGraphLoadGraph(project, state, body, { reset: true });

  assert.equal(resolvers.length, 2);
  // Resolve the *second* (current) request first, then the stale first one late.
  resolvers[1]({ ok: true, commits: [{ hash: 'winner', parents: [], authorDate: '2024-02-01T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }], refs: { heads: [], remotes: [], tags: [] }, hasMore: false });
  await p2;
  resolvers[0]({ ok: true, commits: [{ hash: 'stale', parents: [], authorDate: '2024-01-01T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }], refs: { heads: [], remotes: [], tags: [] }, hasMore: false });
  await p1;

  assert.equal(state.rawCommits.length, 1);
  assert.equal(state.rawCommits[0].hash, 'winner');
});

test('gitGraphLoadGraph in Load-More mode (reset:false) appends to the existing window and advances skip', async () => {
  const state = view.gitGraphState('proj-loadmore-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rawCommits = [{ hash: 'existing', parents: [], authorDate: '2024-01-01T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }];
  state.skip = 1;
  const project = { id: 'proj-loadmore-1' };
  const body = fakeElement();

  global.window = {
    api: {
      getProjectGitGraph: (_id, _folder, opts) => {
        assert.equal(opts.skip, 1);
        assert.equal(opts.refsUnchanged, true);
        return Promise.resolve({ ok: true, commits: [{ hash: 'more', parents: [], authorDate: '2023-12-31T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }], refs: null, hasMore: false });
      },
    },
  };

  await view.gitGraphLoadGraph(project, state, body, { reset: false });
  assert.deepEqual(state.rawCommits.map(c => c.hash), ['existing', 'more']);
  assert.equal(state.skip, 2);
});

test('gitGraphLoadGraph\'s layout recompute forwards firstParentOnly to the layout function', async () => {
  const state = view.gitGraphState('proj-fpo-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.firstParentOnly = true;
  const project = { id: 'proj-fpo-1' };
  const body = fakeElement();
  global.window = { api: { getProjectGitGraph: () => Promise.resolve({ ok: true, commits: [], refs: { heads: [], remotes: [], tags: [] }, hasMore: false }) } };
  let capturedOpts = null;
  global.computeGitGraphLayout = (rows, order, opts) => { capturedOpts = opts; return []; };
  try {
    await view.gitGraphLoadGraph(project, state, body, { reset: true });
    assert.equal(capturedOpts && capturedOpts.firstParentOnly, true);
  } finally {
    delete global.computeGitGraphLayout;
  }
});

test('gitGraphLoadGraph surfaces a {error} reply as state.error rather than throwing', async () => {
  const state = view.gitGraphState('proj-error-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  const project = { id: 'proj-error-1' };
  const body = fakeElement();
  global.window = { api: { getProjectGitGraph: () => Promise.resolve({ error: 'git not found' }) } };
  await view.gitGraphLoadGraph(project, state, body, { reset: true });
  assert.equal(state.error, 'git not found');
  assert.equal(state.loading, false);
});

// === Load More must never jump the table back to the top ===

/** A body stub whose `.gg-table-wrap` survives an innerHTML replace with a
 * fresh (scrollTop: 0) node each time — the same thing a real DOM does —
 * so gitGraphPaint's own preserveScroll copy-forward is what's under test,
 * not an artifact of the stub remembering the old node. */
function fakeScrollBody() {
  let wrap = { scrollTop: 0, querySelectorAll: () => [], addEventListener() {} };
  const body = {
    isConnected: true, className: '', dataset: {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; wrap = { scrollTop: 0, querySelectorAll: () => [], addEventListener() {} }; },
    querySelector(sel) {
      if (sel === '.gg-table-wrap') return wrap;
      return fakeElement();
    },
    querySelectorAll: () => [],
  };
  return body;
}

test('Load More preserves the table\'s scroll position; a fresh (reset) load does not', async () => {
  const state = view.gitGraphState('proj-scroll-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rawCommits = [{ hash: 'existing', parents: [], authorDate: '2024-01-01T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }];
  state.skip = 1;
  const project = { id: 'proj-scroll-1' };
  const body = fakeScrollBody();
  body.querySelector('.gg-table-wrap').scrollTop = 400;

  global.window = { api: { getProjectGitGraph: () => Promise.resolve({ ok: true, commits: [{ hash: 'more', parents: [], authorDate: '2023-12-31T00:00:00Z', refs: { heads: [], remotes: [], tags: [] } }], refs: null, hasMore: false }) } };

  await view.gitGraphLoadGraph(project, state, body, { reset: false });
  assert.equal(body.querySelector('.gg-table-wrap').scrollTop, 400, 'Load More must not reset scroll to the top');

  body.querySelector('.gg-table-wrap').scrollTop = 777;
  global.window = { api: { getProjectGitGraph: () => Promise.resolve({ ok: true, commits: [], refs: { heads: [], remotes: [], tags: [] }, hasMore: false }) } };
  await view.gitGraphLoadGraph(project, state, body, { reset: true });
  assert.equal(body.querySelector('.gg-table-wrap').scrollTop, 0, 'a fresh load lands on a new row set at the top');
});

// === Avatars ===

test('gitGraphAvatarHtml renders an <img> when a URL is known, a lettered placeholder otherwise — both carrying data-gg-avatar-email', () => {
  const withUrl = render.gitGraphAvatarHtml('Jane@Example.com', 'switchboard-preview://abc');
  assert.match(withUrl, /<img/);
  assert.match(withUrl, /data-gg-avatar-email="jane@example.com"/);
  const placeholder = render.gitGraphAvatarHtml('Jane@Example.com', null);
  assert.doesNotMatch(placeholder, /<img/);
  assert.match(placeholder, />J</);
});

test('gitGraphAvatarsEnabled: a per-repo override beats the global default in either direction', () => {
  assert.equal(view.gitGraphAvatarsEnabled({ repoConfig: { fetchAvatars: true }, globalFetchAvatars: false }), true);
  assert.equal(view.gitGraphAvatarsEnabled({ repoConfig: { fetchAvatars: false }, globalFetchAvatars: true }), false);
  assert.equal(view.gitGraphAvatarsEnabled({ repoConfig: { fetchAvatars: null }, globalFetchAvatars: true }), true);
  assert.equal(view.gitGraphAvatarsEnabled({ repoConfig: null, globalFetchAvatars: false }), false);
});

test('gitGraphAvatarUrlFor reads the per-viewer cache case-insensitively, and returns null on a cache miss', () => {
  const state = { avatarCache: new Map([['jane@example.com', 'switchboard-preview://abc']]) };
  assert.equal(view.gitGraphAvatarUrlFor(state, 'Jane@Example.com'), 'switchboard-preview://abc');
  assert.equal(view.gitGraphAvatarUrlFor(state, 'nobody@example.com'), null);
  assert.equal(view.gitGraphAvatarUrlFor({ avatarCache: new Map() }, ''), null);
});

// === Signature status ===

test('gitGraphSignatureStatusBucket buckets git\'s %G? codes into good/bad/unknown/none', () => {
  assert.equal(render.gitGraphSignatureStatusBucket('G'), 'good');
  assert.equal(render.gitGraphSignatureStatusBucket('U'), 'good');
  assert.equal(render.gitGraphSignatureStatusBucket('B'), 'bad');
  assert.equal(render.gitGraphSignatureStatusBucket('E'), 'unknown');
  assert.equal(render.gitGraphSignatureStatusBucket('N'), 'none');
  assert.equal(render.gitGraphSignatureStatusBucket(undefined), 'none');
});

test('gitGraphSignatureBadgeHtml renders nothing without a signature, and a titled badge with one', () => {
  assert.equal(render.gitGraphSignatureBadgeHtml(null), '');
  assert.equal(render.gitGraphSignatureBadgeHtml({ status: 'N' }), '');
  const html = render.gitGraphSignatureBadgeHtml({ status: 'G', signer: 'Jane <jane@example.com>' });
  assert.match(html, /gg-signature-good/);
  assert.match(html, /Jane/);
});

test('gitGraphSingleCommitHeaderHtml only shows the signature badge when RepoConfig.showSignatureStatus is on', () => {
  const commit = { hash: 'abc', parents: [], authorName: 'Jane', authorEmail: 'jane@example.com', authorDate: '2024-01-01T00:00:00Z', commitDate: '2024-01-01T00:00:00Z', committerName: 'Jane', body: '', signature: { status: 'G', signer: 'Jane' } };
  const off = view.gitGraphSingleCommitHeaderHtml(commit, 'commit', { repoConfig: { showSignatureStatus: false } });
  assert.doesNotMatch(off, /gg-signature-badge/);
  const on = view.gitGraphSingleCommitHeaderHtml(commit, 'commit', { repoConfig: { showSignatureStatus: true } });
  assert.match(on, /gg-signature-badge/);
});

test('gitGraphLinkifySubject wraps every issue-regex match in its built URL, leaving the rest as plain escaped text', () => {
  const issueLinking = { regex: '#(\\d+)', url: 'https://issues.example.test/$1' };
  const html = view.gitGraphLinkifySubject('Fix widget rendering glitch (#42)', issueLinking);
  assert.equal(html, 'Fix widget rendering glitch (<a class="gg-link" data-gg-kind="link" href="https://issues.example.test/42" target="_blank" rel="noopener">#42</a>)');
  assert.equal(view.gitGraphLinkifySubject('no issue ref here', issueLinking), 'no issue ref here');
  assert.equal(view.gitGraphLinkifySubject('<script>', issueLinking), '&lt;script&gt;');
  assert.equal(view.gitGraphLinkifySubject('plain subject', null), 'plain subject');
});

test('gitGraphSingleCommitHeaderHtml shows the Subject field, with Issue Linking applied when configured', () => {
  const commit = { hash: 'abc', parents: [], subject: 'Fix thing (#7)', authorName: 'Jane', authorEmail: 'jane@example.com', authorDate: '2024-01-01T00:00:00Z', commitDate: '2024-01-01T00:00:00Z', committerName: 'Jane', body: '' };
  const state = { repoConfig: { issueLinking: { regex: '#(\\d+)', url: 'https://issues.example.test/$1' } } };
  const html = view.gitGraphSingleCommitHeaderHtml(commit, 'commit', state);
  assert.match(html, /Subject:/);
  assert.match(html, /href="https:\/\/issues\.example\.test\/7"/);
});

// === Minimal inline Markdown ===

test('gitGraphRenderMarkdownInline wraps bold/italic/bold-italic/inline-code, and only ever operates on already-escaped text', () => {
  assert.equal(render.gitGraphRenderMarkdownInline('**bold**'), '<strong>bold</strong>');
  assert.equal(render.gitGraphRenderMarkdownInline('*italic*'), '<em>italic</em>');
  assert.equal(render.gitGraphRenderMarkdownInline('***both***'), '<strong><em>both</em></strong>');
  assert.equal(render.gitGraphRenderMarkdownInline('`code`'), '<code>code</code>');
  // Already-escaped, so a literal "<script>" in the input can never survive to here as a real tag.
  assert.equal(render.gitGraphRenderMarkdownInline('&lt;script&gt;'), '&lt;script&gt;');
});

test('gitGraphLinkifyBody applies Markdown only when enabled, after which URL linkification still runs', () => {
  const plain = view.gitGraphLinkifyBody('**bold** see https://example.com', false);
  assert.doesNotMatch(plain, /<strong>/);
  assert.match(plain, /<a class="gg-link"/);
  const withMarkdown = view.gitGraphLinkifyBody('**bold** see https://example.com', true);
  assert.match(withMarkdown, /<strong>bold<\/strong>/);
  assert.match(withMarkdown, /<a class="gg-link"/);
});

test('gitGraphLinkifyBody never lets a quote character in the commit body break out of the href attribute', () => {
  const hostile = 'see https://x" onmouseover="fetch(\'https://evil/\')';
  const html = view.gitGraphLinkifyBody(hostile, false);
  // The injected text does still appear (as inert text after the closed
  // </a>, and inside a second auto-linked https://evil/ href) — what must
  // never happen is "onmouseover" landing inside a tag's own attribute list.
  const firstTag = /<a\b[^>]*>/.exec(html);
  assert.ok(firstTag, 'expected the first https:// match to still be linkified');
  assert.doesNotMatch(firstTag[0], /onmouseover/, 'the quote must end the href, not open a live attribute inside the <a> tag');
  assert.match(firstTag[0], /^<a class="gg-link" data-gg-kind="link" href="https:\/\/x" target="_blank" rel="noopener">$/);
});

// === Commit Comparison is order-independent (ancestor always "from") ===

test('gitGraphIsAncestor walks parent links through the loaded window', () => {
  const rows = [
    { hash: 'c3', parents: ['c2'] },
    { hash: 'c2', parents: ['c1'] },
    { hash: 'c1', parents: [] },
  ];
  assert.equal(view.gitGraphIsAncestor(rows, 'c1', 'c3'), true);
  assert.equal(view.gitGraphIsAncestor(rows, 'c3', 'c1'), false);
  assert.equal(view.gitGraphIsAncestor(rows, 'c1', 'c1'), false, 'a commit is not its own ancestor');
});

test('Ctrl-clicking an older ancestor after a newer commit still compares from the ancestor, regardless of click order', () => {
  const state = view.gitGraphState('proj-cmp-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rows = [
    { hash: 'newer', parents: ['older'] },
    { hash: 'older', parents: [] },
  ];
  state.selectedHash = 'newer'; // clicked first
  const project = { id: 'proj-cmp-1' };
  const body = fakeElement();
  const calls = [];
  global.window = { api: { getGitGraphCompareDetail: (...args) => { calls.push(args); return Promise.resolve({ ok: true, files: [] }); } } };

  const el = { dataset: { ggHash: 'older' } }; // ctrl-clicked second
  view.gitGraphHandleRowClick(project, state, body, el, { ctrlKey: true });

  assert.equal(state.detailsData.fromHash, 'older');
  assert.equal(state.detailsData.toHash, 'newer');
  assert.deepEqual(calls[0].slice(2), ['older', 'newer']);
});

// === Commit-details file list reuses #98's tree builder ===

test('gitGraphFileListHtml (tree mode) builds folder rows via buildGitChangeTree/gitTreeRows and leaf rows carry the security-fixed escapeAttr path attribute', () => {
  const files = [
    { path: 'src/app/a.js', status: 'modified', insertions: 1, deletions: 0 },
    { path: 'src/app/b"onload=alert(1)//.js', status: 'added', insertions: 2, deletions: 0 },
  ];
  const html = view.gitGraphFileListHtml(files, { fileViewType: 'tree', collapsedFolders: new Set() });
  assert.match(html, /gg-tree-folder/);
  // The hostile text may still appear as inert, already-escaped text content
  // (safe); what must never happen is the quote closing an attribute early.
  assert.doesNotMatch(html, /file-path="[^"]*" onload=/);
  assert.match(html, /data-gg-file-path="src\/app\/b&quot;onload=alert\(1\)\/\/\.js"/);
});

test('gitGraphFileListHtml (list mode) shows the full relative path, not just the basename', () => {
  const files = [{ path: 'src/app/a.js', status: 'modified' }];
  const html = view.gitGraphFileListHtml(files, { fileViewType: 'list', collapsedFolders: new Set() });
  assert.match(html, />src\/app\/a\.js</);
});

// === Commit body: URL auto-linking never lets a quote break out of the href ===

test('gitGraphLinkifyBody auto-links a bare URL and escapes the rest', () => {
  const html = view.gitGraphLinkifyBody('see https://example.com for details');
  assert.match(html, /<a class="gg-link"[^>]*href="https:\/\/example\.com"[^>]*>https:\/\/example\.com<\/a>/);
});

test('gitGraphLinkifyBody never lets a quote character in the commit body break out of the href attribute', () => {
  const hostile = 'see https://x" onmouseover="fetch(\'https://evil/\')';
  const html = view.gitGraphLinkifyBody(hostile);
  const firstTag = /<a\b[^>]*>/.exec(html);
  assert.ok(firstTag, 'expected the first https:// match to still be linkified');
  assert.doesNotMatch(firstTag[0], /onmouseover/, 'the quote must end the href, not open a live attribute inside the <a> tag');
  assert.match(firstTag[0], /^<a class="gg-link" data-gg-kind="link" href="https:\/\/x" target="_blank" rel="noopener">$/);
});

test('gitGraphSingleCommitHeaderHtml escapes a hostile subject/author rather than trusting repo content as markup', () => {
  const commit = {
    hash: 'abc', parents: [], subject: '<img src=x onerror=alert(1)>', authorName: '<b>Eve</b>', authorEmail: 'eve@example.com',
    authorDate: '2024-01-01T00:00:00Z', commitDate: '2024-01-01T00:00:00Z', committerName: 'Eve', body: '',
  };
  const html = view.gitGraphSingleCommitHeaderHtml(commit, 'commit');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>Eve/);
});

// === Auto-refresh watcher: bound once, resolves the current body fresh ===
//
// gitGraphEnsureWatcherBound is a module-load singleton (see its own comment
// in project-git-graph-view.js) — it only ever runs its registration body
// once per process. To exercise that "once" behavior in isolation, this test
// loads a fresh copy of the module (dropping it from require's cache first)
// rather than relying on whichever earlier test in this file happened to
// trigger the real registration first.

test('gitGraphEnsureWatcherBound binds the repo-change listener once and repaints into the CURRENT #git-workspace-view, not whichever body was live when it first bound', async () => {
  const modulePath = path.join(__dirname, '../public/project-git-graph-view.js');
  delete require.cache[modulePath];

  let bindCount = 0;
  let watcherCallback = null;
  const bodyFromFirstRender = fakeElement();
  const bodyAfterTabSwitch = fakeElement();
  let currentBody = bodyFromFirstRender;

  global.document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: (id) => (id === 'git-workspace-view' ? currentBody : null),
  };
  global.window = {
    api: {
      onGitGraphRepoChanged: (cb) => { watcherCallback = cb; bindCount++; },
      getProjectGitGraph: () => Promise.resolve({ ok: true, commits: [], refs: { heads: [], remotes: [], tags: [] }, hasMore: false }),
    },
  };
  const project = { id: 'proj-watcher-rebind' };
  global.selectedProject = () => project;
  global.projectTab = () => 'git'; global.projectGitView = () => 'history';

  const freshView = require(modulePath);
  try {
    const state = freshView.gitGraphState(project.id);
    state.repositories = [{ path: '/repo', git: true }];
    state.selectedRepo = '/repo';

    // Simulating the tab being opened, then left and reopened (renderProjectGitGraphTab
    // calls this on every render): only the FIRST call may actually register.
    freshView.gitGraphEnsureWatcherBound();
    freshView.gitGraphEnsureWatcherBound();
    freshView.gitGraphEnsureWatcherBound();
    assert.equal(bindCount, 1, 'a second/third render must not add a second listener');
    assert.equal(typeof watcherCallback, 'function');

    // The tab's own #ws-body element gets recreated on a tab switch (it is
    // never removed, per gitGraphStillActive's own reasoning) — simulate
    // that by pointing document.getElementById('ws-body') at a new element,
    // the way the real DOM would after the user left and came back.
    bodyFromFirstRender.innerHTML = 'untouched-by-a-later-event';
    currentBody = bodyAfterTabSwitch;

    watcherCallback('/repo');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(bodyFromFirstRender.innerHTML, 'untouched-by-a-later-event', 'the stale first-render body must never be repainted into');
    assert.match(bodyAfterTabSwitch.innerHTML, /gg-tab-shell/, 'the watcher must resolve and repaint into the CURRENT #git-workspace-view');
  } finally {
    delete require.cache[modulePath];
  }
});

// === Enhanced accessibility file-status glyph ===

test('gitGraphFileStatusGlyph is colour-only (empty) by default, and shows the letter once enhancedAccessibility is on', () => {
  assert.equal(render.gitGraphFileStatusGlyph('renamed', false), '');
  assert.equal(render.gitGraphFileStatusGlyph('renamed', true), 'R');
});

// === Code Review file-list styling ===

test('gitGraphFileRowHtml bolds a file only while a review is active and that file is still unreviewed', () => {
  const file = { path: 'a.js', status: 'modified', insertions: 1, deletions: 0 };
  const noReview = view.gitGraphFileRowHtml(file, {});
  assert.doesNotMatch(noReview, /gg-file-unreviewed/);
  const activeUnreviewed = view.gitGraphFileRowHtml(file, { codeReview: { reviewedPaths: new Set() } });
  assert.match(activeUnreviewed, /gg-file-unreviewed/);
  const activeReviewed = view.gitGraphFileRowHtml(file, { codeReview: { reviewedPaths: new Set(['a.js']) } });
  assert.doesNotMatch(activeReviewed, /gg-file-unreviewed/);
});

test('gitGraphFileRowHtml marks the most-recently-viewed file with the eye indicator', () => {
  const file = { path: 'a.js', status: 'modified' };
  assert.doesNotMatch(view.gitGraphFileRowHtml(file, {}), /gg-file-eye/);
  assert.match(view.gitGraphFileRowHtml(file, { lastViewedFilePath: 'a.js' }), /gg-file-eye/);
});

// === ctx.codeReview wiring (populates the menu items git-graph-menus.js already builds) ===

test('gitGraphBuildMenuCtx exposes the active Code Review (or null) and a working onMarkFileReviewed callback', () => {
  const state = view.gitGraphState('proj-codereview-ctx-1');
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rows = [];
  const project = { id: 'proj-codereview-ctx-1' };
  const body = fakeElement();
  const repo = { path: '/repo' };

  const ctxNoReview = view.gitGraphBuildMenuCtx(project, state, body, repo, null);
  assert.equal(ctxNoReview.codeReview, null);

  state.codeReview = { key: 'abc', reviewedPaths: new Set(['a.js']) };
  const ctxWithReview = view.gitGraphBuildMenuCtx(project, state, body, repo, null);
  assert.equal(ctxWithReview.codeReview.key, 'abc');
  assert.ok(ctxWithReview.codeReview.reviewedPaths.has('a.js'));
  assert.equal(typeof ctxWithReview.onMarkFileReviewed, 'function');
});

// === Inline Commit Details open under the clicked row and stay in view ===

function inlineDetailsState(id) {
  const state = view.gitGraphState(id);
  state.repositories = [{ path: '/repo', git: true }];
  state.selectedRepo = '/repo';
  state.rows = [
    { hash: 'c3', kind: 'commit', parents: ['c2'], subject: 'third' },
    { hash: 'c2', kind: 'commit', parents: ['c1'], subject: 'second' },
    { hash: 'c1', kind: 'commit', parents: [], subject: 'first' },
  ];
  state.layout = state.rows.map(() => ({ lane: 0, colorIndex: 0, edges: [] }));
  state.detailsLocation = 'inline';
  return state;
}

/** Index of each row and of the inline panel in the rows markup. */
function inlineOrder(html) {
  return [...html.matchAll(/data-gg-hash="(c\d)" data-row-index|id="gg-details-inline"/g)].map(m => m[1] || 'details');
}

test('the inline Commit Details sit right under the clicked row, not after the last loaded one', () => {
  const state = inlineDetailsState('proj-inline-1');
  state.selectedHash = 'c2';
  state.detailsData = { mode: 'single', hash: 'c2', kind: 'commit', commit: null, files: [] };
  assert.deepEqual(inlineOrder(view.gitGraphRowsHtml({ id: 'proj-inline-1' }, state)), ['c3', 'c2', 'details', 'c1']);
});

test('a comparison opens under the row clicked first, and a commit no longer loaded still shows its details at the end', () => {
  const state = inlineDetailsState('proj-inline-2');
  state.selectedHash = 'c3';
  state.compareHash = 'c1';
  state.detailsData = { mode: 'compare', fromHash: 'c1', toHash: 'c3', files: [] };
  assert.deepEqual(inlineOrder(view.gitGraphRowsHtml({ id: 'proj-inline-2' }, state)), ['c3', 'details', 'c2', 'c1']);

  state.selectedHash = 'gone';
  state.detailsData = { mode: 'single', hash: 'gone', kind: 'commit', commit: null, files: [] };
  assert.deepEqual(inlineOrder(view.gitGraphRowsHtml({ id: 'proj-inline-2' }, state)), ['c3', 'c2', 'c1', 'details']);
});

test('opening, loading and closing the inline details never jumps the table back to the top', async () => {
  const state = inlineDetailsState('proj-inline-3');
  const project = { id: 'proj-inline-3' };
  const body = fakeScrollBody();
  global.window = { api: { getGitGraphCommitDetail: () => Promise.resolve({ ok: true, commit: { hash: 'c2', parents: ['c1'] }, files: [] }) } };
  body.querySelector('.gg-table-wrap').scrollTop = 400;

  view.gitGraphOpenDetails(project, state, body, state.rows[1]);
  assert.equal(body.querySelector('.gg-table-wrap').scrollTop, 400, 'the loading paint keeps the scroll position');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.detailsLoading, false);
  assert.equal(body.querySelector('.gg-table-wrap').scrollTop, 400, 'the loaded paint keeps the scroll position');

  view.gitGraphCloseDetails(project, state, body);
  assert.equal(body.querySelector('.gg-table-wrap').scrollTop, 400, 'closing keeps the scroll position');
});

/** A wrap/row/panel trio with fixed geometry, in the wrap's own coordinates. */
function centeringFixture({ scrollTop, clientHeight, headHeight, rowTop, rowHeight, panelHeight }) {
  const wrap = {
    scrollTop, clientHeight,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: (sel) => (sel === '.gg-thead' ? { offsetHeight: headHeight } : null),
  };
  const at = (top, height) => () => ({ top: 100 + top - wrap.scrollTop, bottom: 100 + top + height - wrap.scrollTop });
  const row = { classList: { contains: (c) => c === 'gg-row' }, getBoundingClientRect: at(rowTop, rowHeight) };
  const panel = {
    previousElementSibling: row,
    closest: (sel) => (sel === '.gg-table-wrap' ? wrap : null),
    getBoundingClientRect: at(rowTop + rowHeight, panelHeight),
  };
  return { wrap, panel };
}

test('auto-center waits for the loaded details, then centers the row and its panel inside the table only', () => {
  const state = inlineDetailsState('proj-inline-4');
  const { wrap, panel } = centeringFixture({ scrollTop: 0, clientHeight: 600, headHeight: 30, rowTop: 1000, rowHeight: 24, panelHeight: 200 });
  state.detailsJustOpened = true;
  state.detailsLoading = true;
  view.gitGraphMaybeAutoCenterDetails(state, panel);
  assert.equal(wrap.scrollTop, 0, 'a "Loading…" placeholder is not worth scrolling to');
  assert.equal(state.detailsJustOpened, true);

  state.detailsLoading = false;
  view.gitGraphMaybeAutoCenterDetails(state, panel);
  // 570px visible under the 30px header, a 224px block: (570 - 224) / 2 = 173 above it.
  assert.equal(wrap.scrollTop, 1000 - 30 - 173);
  assert.equal(state.detailsJustOpened, false, 'only once per open');

  const before = wrap.scrollTop;
  view.gitGraphMaybeAutoCenterDetails(state, panel);
  assert.equal(wrap.scrollTop, before, 'a later repaint of the same open panel leaves the scroll alone');
});

test('a panel taller than the table puts its row at the top; with auto-center off it only scrolls what is out of view', () => {
  const tall = centeringFixture({ scrollTop: 0, clientHeight: 600, headHeight: 30, rowTop: 1000, rowHeight: 24, panelHeight: 900 });
  const state = inlineDetailsState('proj-inline-5');
  state.detailsJustOpened = true;
  view.gitGraphMaybeAutoCenterDetails(state, tall.panel);
  assert.equal(tall.wrap.scrollTop, 1000 - 30);

  state.autoCenterDetails = false;
  const visible = centeringFixture({ scrollTop: 900, clientHeight: 600, headHeight: 30, rowTop: 1000, rowHeight: 24, panelHeight: 200 });
  state.detailsJustOpened = true;
  view.gitGraphMaybeAutoCenterDetails(state, visible.panel);
  assert.equal(visible.wrap.scrollTop, 900, 'already fully in view: no scroll');

  const below = centeringFixture({ scrollTop: 600, clientHeight: 600, headHeight: 30, rowTop: 1000, rowHeight: 24, panelHeight: 200 });
  state.detailsJustOpened = true;
  view.gitGraphMaybeAutoCenterDetails(state, below.panel);
  assert.equal(below.wrap.scrollTop, 1224 - 600, 'just enough for the bottom of the panel to show');
});

test('beside an inline panel a lane change still bends within one row, then the line runs straight', () => {
  const rows = [{ hash: 'child', kind: 'commit', parents: ['parent'] }, { hash: 'parent', kind: 'commit', parents: [] }];
  const layout = [
    { lane: 1, colorIndex: 0, edges: [{ parentHash: 'parent', toLane: 0, viaLane: 1, style: 'same-lane' }] },
    { lane: 0, colorIndex: 0, edges: [] },
  ];
  const pathOf = (svg) => /<path d="([^"]+)"/.exec(svg)[1];
  // Rows 30px tall, side by side: one curve across the row gap, as always.
  assert.doesNotMatch(pathOf(render.gitGraphRenderGraphSvg(rows, layout, { rowY: [15, 45], height: 60, bendHeight: 30 })), / L/);

  // A 200px panel under the child: straight down its own lane, then one row's bend.
  const d = pathOf(render.gitGraphRenderGraphSvg(rows, layout, { rowY: [15, 245], height: 260, bendHeight: 30 }));
  const lane = (n) => render.GG_LANE_WIDTH / 2 + n * render.GG_LANE_WIDTH;
  assert.equal(d, `M${lane(1)} 15 L${lane(1)} 45 L${lane(1)} 215 C${lane(1)} 230, ${lane(0)} 230, ${lane(0)} 245`);
});

test('folding a folder in the Commit Details hides its files', () => {
  const state = inlineDetailsState('proj-inline-6');
  state.selectedHash = 'c2';
  state.fileViewType = 'tree';
  state.detailsData = { mode: 'single', hash: 'c2', kind: 'commit', commit: null, files: [
    { path: 'src/a.js', status: 'M', additions: 1, deletions: 0 },
    { path: 'README.md', status: 'M', additions: 1, deletions: 0 },
  ] };
  const shown = () => [...view.gitGraphRowsHtml({ id: 'proj-inline-6' }, state).matchAll(/data-gg-file-path="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(shown().sort(), ['README.md', 'src/a.js']);
  state.collapsedFolders.add('src');
  assert.deepEqual(shown(), ['README.md']);
});
