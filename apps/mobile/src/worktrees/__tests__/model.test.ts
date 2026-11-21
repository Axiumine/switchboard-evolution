import { expect, test } from '@jest/globals';

import type { LiveState, Session } from '@/sessions/model';
import {
  baseChoices, createSpec, createdText, existingChoices, FILTERS, filterMatches, findWorktree, folderFor, formRef, mergedChoices, parentFolder, patternsList, patternsText,
  previewTemplate, prunedText, refFolderName, remoteLocalName, removeReady, rowPath, runningSessionChoices, sessionActivity, sessionsByWorktree, shortPath, sortWorktrees, startPointChoices,
  SORT_ORDERS, START_OPTIONS, summaryText, toggleGroup, visibleRepositories, worktreeBadges, worktreeLabel, worktreeMatches, worktreeTime,
  type Branches, type CreateForm, type Worktree, type WorktreeRepository,
} from '../model';

// The same worktrees as the desktop's test (test/project-worktrees-view.test.js).
function wt(p: string, extra: Partial<Worktree> = {}): Worktree {
  return {
    path: p, head: 'abcdef1234567890', branch: '', detached: false, bare: false,
    locked: false, lockReason: '', prunable: false, prunableReason: '', isMain: false,
    exists: true, kind: 'classic', attached: false, attachedMode: null, attachedPath: null,
    dirty: false, ahead: null, behind: null, lastCommit: null, created: null, modified: null, ...extra,
  };
}

function repository(name: string, mainPath: string, worktrees: Worktree[], extra: Partial<WorktreeRepository> = {}): WorktreeRepository {
  return { id: `${mainPath}/.git`, commonDir: `${mainPath}/.git`, name, mainPath, bare: false, nested: false, worktrees, ...extra };
}

const main = wt('/w/app', { isMain: true, branch: 'main', kind: 'main', created: 1 });
const beta = wt('/w/app.worktrees/beta', { branch: 'beta', created: 30 });
const alpha = wt('/w/app.worktrees/alpha', { branch: 'alpha', created: 20 });
const claude = wt('/w/app/.claude/worktrees/fix', { branch: 'fix', kind: 'claude', created: null });

const running: LiveState = { busy: false, attention: false, exited: false, starting: false };
const session = (sessionId: string, projectPath: string): Session => ({ sessionId, projectPath });

const branches: Branches = {
  local: [{ name: 'main', head: 'a', upstream: 'origin/main' }, { name: 'dev', head: 'b', upstream: '' }, { name: 'beta', head: 'c', upstream: '' }],
  remote: [{ name: 'origin/main', remote: 'origin', head: 'a' }, { name: 'origin/feat/x', remote: 'origin', head: 'd' }],
  checkedOut: { main: '/w/app', beta: '/w/app.worktrees/beta' },
  defaultBranch: 'main',
  mainBranch: 'main',
};

test('a row is called by its branch, its short hash when detached, or its folder', () => {
  expect(worktreeLabel(beta)).toBe('beta');
  expect(worktreeLabel(wt('/w/app.worktrees/x', { detached: true, head: '0123456789abcdef' }))).toBe('01234567');
  expect(worktreeLabel(wt('/w/app.worktrees/lost'))).toBe('lost');
  expect(worktreeLabel(wt('/w/app.git', { bare: true }))).toBe('bare repository');
});

test('sorting keeps the main worktree first and puts unknown creation times last', () => {
  const list = [beta, main, claude, alpha];
  const order = (o: Parameters<typeof sortWorktrees>[1]) => sortWorktrees(list, o).map((item) => item.branch);
  expect(order('default')).toEqual(['main', 'beta', 'fix', 'alpha']);
  expect(order('nameAsc')).toEqual(['main', 'alpha', 'beta', 'fix']);
  expect(order('nameDesc')).toEqual(['main', 'fix', 'beta', 'alpha']);
  expect(order('createdDesc')).toEqual(['main', 'beta', 'alpha', 'fix']);
  expect(order('createdAsc')).toEqual(['main', 'alpha', 'beta', 'fix']);
});

test('sorting by last modification and by uncommitted changes', () => {
  const a = wt('/w/a', { branch: 'a', modified: 300 });
  const b = wt('/w/b', { branch: 'b', modified: 100, dirty: true });
  const c = wt('/w/c', { branch: 'c', modified: null });
  const d = wt('/w/d', { branch: 'd', modified: 200, dirty: true });
  const order = (o: Parameters<typeof sortWorktrees>[1]) => sortWorktrees([a, b, main, c, d], o).map((item) => item.branch);
  expect(order('modifiedDesc')).toEqual(['main', 'a', 'd', 'b', 'c']);
  expect(order('modifiedAsc')).toEqual(['main', 'b', 'd', 'a', 'c']);
  expect(order('changesFirst')).toEqual(['main', 'd', 'b', 'a', 'c']);
  // The same orders as the desktop's combo, in its order.
  expect(SORT_ORDERS.map((o) => o.key)).toEqual(['default', 'modifiedDesc', 'modifiedAsc', 'createdDesc', 'createdAsc', 'nameAsc', 'nameDesc', 'changesFirst']);
});

test('the filter keeps the worktrees it names, the main one included, and hides repositories left empty', () => {
  const dirty = wt('/w/app.worktrees/dirty', { branch: 'dirty', dirty: true, ahead: 0 });
  const ahead = wt('/w/app.worktrees/ahead', { branch: 'ahead', ahead: 2, attached: true });
  const gone = wt('/w/app.worktrees/gone', { branch: 'gone', exists: false, locked: true });
  const codex = wt('/w/codex/app', { branch: 'cx', kind: 'codex' });
  const project = wt('/p/repos/app', { branch: 'pr', kind: 'switchboard', attached: true });
  const repos = [
    repository('app', '/w/app', [{ ...main, dirty: true }, dirty, ahead, gone, claude, codex, project]),
    repository('lib', '/w/lib', [wt('/w/lib', { isMain: true, branch: 'main', kind: 'main' })]),
  ];
  const live = new Map([['/w/app.worktrees/ahead', [session('s', '/w/app.worktrees/ahead')]]]);
  const shown = (filter: Parameters<typeof filterMatches>[1]) => visibleRepositories(repos, '', 'default', filter, live).map((g) => [g.repo.name, g.worktrees.map((w) => w.branch)]);
  expect(shown('all')).toEqual([['app', ['main', 'dirty', 'ahead', 'gone', 'fix', 'cx', 'pr']], ['lib', ['main']]]);
  expect(shown('changes')).toEqual([['app', ['main', 'dirty']]]);
  expect(shown('unpushed')).toEqual([['app', ['ahead']]]);
  expect(shown('running')).toEqual([['app', ['ahead']]]);
  expect(shown('attached')).toEqual([['app', ['ahead', 'pr']]]);
  expect(shown('unattached')).toEqual([['app', ['main', 'dirty', 'gone', 'fix', 'cx']], ['lib', ['main']]]);
  expect(shown('locked')).toEqual([['app', ['gone']]]);
  expect(shown('missing')).toEqual([['app', ['gone']]]);
  expect(shown('claude')).toEqual([['app', ['fix']]]);
  expect(shown('codex')).toEqual([['app', ['cx']]]);
  expect(shown('switchboard')).toEqual([['app', ['pr']]]);
  expect(visibleRepositories(repos, 'pr', 'default', 'attached', live).map((g) => g.worktrees.map((w) => w.branch))).toEqual([['pr']]);
  // The desktop's filters, in its order, each with what an empty list says.
  expect(FILTERS.map((f) => f.key)).toEqual(['all', 'changes', 'unpushed', 'running', 'attached', 'unattached', 'locked', 'missing', 'claude', 'codex', 'switchboard']);
  for (const filter of FILTERS) expect(filter.empty).toBeTruthy();
});

test('a row shows when it was last modified, or created while sorted by that', () => {
  const item = wt('/w/x', { modified: 3000, created: 1000, lastCommit: { hash: 'h', time: 2000, subject: 'Init' } });
  expect(worktreeTime(item, 'default')).toEqual({ time: 3000, created: false });
  expect(worktreeTime(item, 'createdAsc')).toEqual({ time: 1000, created: true });
  // From an older desktop, with no last modification: the last commit.
  expect(worktreeTime({ ...item, modified: undefined as unknown as null }, 'nameAsc')).toEqual({ time: 2000, created: false });
  expect(worktreeTime(wt('/w/y'), 'default')).toBeNull();
});

test('filtering matches branch, folder, kind and state, and a repository name keeps all its rows', () => {
  const repos = [repository('app', '/w/app', [main, beta, claude]), repository('lib', '/w/lib', [wt('/w/lib', { isMain: true, branch: 'main', kind: 'main' })])];
  const visible = (q: string) => visibleRepositories(repos, q, 'default').map((g) => [g.repo.name, g.worktrees.map((w) => w.branch)]);
  expect(visible('')).toEqual([['app', ['main', 'beta', 'fix']], ['lib', ['main']]]);
  expect(visible('claude')).toEqual([['app', ['fix']]]);
  expect(visible('BETA')).toEqual([['app', ['beta']]]);
  expect(visible('lib')).toEqual([['lib', ['main']]]);
  expect(visible('nothing-here')).toEqual([]);
  expect(worktreeMatches({ ...beta, locked: true }, 'locked')).toBe(true);
  expect(worktreeMatches({ ...beta, exists: false }, 'missing')).toBe(true);
});

test('a running session counts for the deepest worktree it runs in, and through a symlink for git\'s path', () => {
  const linked = { ...alpha, attached: true, attachedPath: '/links/alpha' };
  const repos = [repository('app', '/w/app', [main, beta, claude, linked])];
  const sessions = [
    session('s1', '/w/app/.claude/worktrees/fix'),
    session('s2', '/w/app/src'),
    session('s3', '/elsewhere'),
    session('s4', '/w/app.worktrees/beta'),
    session('s5', '/links/alpha/src'),
    session('s1', '/w/app/.claude/worktrees/fix'),
  ];
  const live = { s1: running, s2: running, s3: running, s4: { ...running, exited: true }, s5: running };
  const byPath = sessionsByWorktree(repos, sessions, live);
  expect([...byPath.keys()].sort()).toEqual(['/w/app', '/w/app.worktrees/alpha', '/w/app/.claude/worktrees/fix']);
  expect(byPath.get('/w/app')?.map((s) => s.sessionId)).toEqual(['s2']);
  expect(byPath.get('/w/app/.claude/worktrees/fix')?.map((s) => s.sessionId)).toEqual(['s1']);
  expect(byPath.has('/w/app.worktrees/beta')).toBe(false);
  expect(sessionsByWorktree(repos, sessions, {}).size).toBe(0);
});

test('badges say where a worktree came from and what state it is in', () => {
  expect(worktreeBadges(main).map((b) => b.label)).toEqual(['Main']);
  expect(worktreeBadges({ ...claude, attached: true }).map((b) => b.label)).toEqual(['Claude', 'In project']);
  expect(worktreeBadges({ ...beta, kind: 'switchboard', attached: true }).map((b) => b.label)).toEqual(['Project']);
  const odd = worktreeBadges({ ...beta, detached: true, locked: true, lockReason: 'usb', exists: false });
  expect(odd.map((b) => b.label)).toEqual(['Detached', 'Locked', 'Missing']);
  expect(odd[1].help).toBe('Locked: usb');
});

test('a row names its folder relative to the one that holds the repository, else with ~', () => {
  const repo = { mainPath: '/w/app' };
  expect(rowPath(beta, repo, '')).toBe('app.worktrees/beta');
  expect(rowPath(claude, repo, '')).toBe('app/.claude/worktrees/fix');
  expect(rowPath(main, repo, '')).toBe('app');
  expect(rowPath(wt('/Users/me/other'), repo, '/Users/me')).toBe('~/other');
  expect(shortPath('/Users/me', '/Users/me')).toBe('~');
  expect(shortPath('/Users/meow/x', '/Users/me')).toBe('/Users/meow/x');
  expect(summaryText([repository('app', '/w/app', [main, beta])])).toBe('1 repository · 2 worktrees');
  expect(summaryText([])).toBe('0 repositories · 0 worktrees');
});

test('the settings preview fills the template like the computer does', () => {
  const repo = { mainPath: '/w/app' };
  expect(previewTemplate('$BASE_PATH.worktrees/$REF_NAME', repo, 'feature/example', '/p')).toBe('/w/app.worktrees/feature-example');
  expect(previewTemplate('$BASE_ROOT/trees/$BASE_NAME$INDEX', repo, 'x', '/p')).toBe('/w/trees/app1');
  expect(previewTemplate('$PROJECT_ROOT/.repos/$REF_NAME-$BASE_NAME', repo, 'a b', '/p')).toBe('/p/.repos/a-b-app');
  expect(refFolderName('--feat//x?')).toBe('feat-x');
});

test('branch choices: HEAD first, checked-out branches cannot be picked, a remote branch becomes its local name', () => {
  const starts = startPointChoices(branches);
  expect(starts.map((c) => c.key)).toEqual(['', 'main', 'dev', 'beta', 'origin/main', 'origin/feat/x']);
  expect(starts[0].label).toBe('HEAD of the main worktree (main)');
  expect(startPointChoices(branches, true)[0].label).toBe('The HEAD of the main worktree (main)');
  const existing = existingChoices(branches);
  expect(existing.filter((c) => !c.disabled).map((c) => c.key)).toEqual(['dev']);
  expect(existing.find((c) => c.key === 'beta')?.label).toBe('beta (in beta)');
  expect(remoteLocalName(branches, 'origin/feat/x')).toBe('feat/x');
  expect(remoteLocalName(branches, 'nowhere/x')).toBe('');
  expect(baseChoices(branches, 'main')).toEqual(['main', 'dev', 'beta', 'origin/main', 'origin/feat/x']);
  expect(baseChoices(branches, 'release')[0]).toBe('release');
});

const form = (extra: Partial<CreateForm> = {}): CreateForm => ({
  repoPath: '/w/app', mode: 'new', branch: '', startPoint: '', existing: '', remoteBranch: '', localBranch: '', path: '', attach: false, copyEnv: [], ...extra,
});

test('the create spec leaves out empty values, which the phone\'s channel refuses', () => {
  expect(createSpec(form())).toEqual({ error: 'Name the new branch.' });
  expect(createSpec(form({ branch: ' feat ', path: '  ' })).spec).toEqual({ repoPath: '/w/app', mode: 'new', branch: 'feat', attach: false });
  expect(createSpec(form({ branch: 'feat', startPoint: 'dev', path: '/w/x', attach: true, copyEnv: ['.env', ''] })).spec)
    .toEqual({ repoPath: '/w/app', mode: 'new', branch: 'feat', startPoint: 'dev', path: '/w/x', attach: true, copyEnv: ['.env'] });
  expect(createSpec(form({ mode: 'existing' }))).toEqual({ error: 'Pick a branch.' });
  expect(createSpec(form({ mode: 'existing', existing: 'dev', branch: 'ignored' })).spec).toEqual({ repoPath: '/w/app', mode: 'existing', branch: 'dev', attach: false });
  expect(createSpec(form({ mode: 'remote' }))).toEqual({ error: 'Pick a remote branch.' });
  expect(createSpec(form({ mode: 'remote', remoteBranch: 'origin/feat/x' })).spec).toEqual({ repoPath: '/w/app', mode: 'remote', remoteBranch: 'origin/feat/x', attach: false });
  expect(createSpec(form({ mode: 'remote', remoteBranch: 'origin/feat/x', localBranch: 'mine' })).spec?.branch).toBe('mine');
  expect(createSpec(form({ mode: 'detached' })).spec).toEqual({ repoPath: '/w/app', mode: 'detached', attach: false });
  expect(createSpec(form({ mode: 'detached', startPoint: 'origin/main' })).spec?.startPoint).toBe('origin/main');
});

test('the folder is named after what the form checks out', () => {
  expect(formRef(form({ branch: ' feat ' }), branches)).toBe('feat');
  expect(formRef(form({ mode: 'existing', existing: 'dev' }), branches)).toBe('dev');
  expect(formRef(form({ mode: 'remote', remoteBranch: 'origin/feat/x' }), branches)).toBe('origin/feat/x');
  expect(formRef(form({ mode: 'remote', remoteBranch: 'origin/feat/x', localBranch: 'mine' }), branches)).toBe('mine');
  expect(formRef(form({ mode: 'detached' }), branches)).toBe('main');
  expect(formRef(form({ mode: 'detached' }), null)).toBe('detached');
});

test('after creating, the notice says what was copied and attached', () => {
  const result = { ok: true as const, worktree: { path: '/w/app.worktrees/feat', branch: 'feat', mainPath: '/w/app' }, attached: true, copied: ['.env'], warnings: [], postCreateCmd: '' };
  expect(createdText(result)).toBe('Created feat (copied .env; attached to the project)');
  expect(createdText({ ...result, worktree: { ...result.worktree, branch: '' }, attached: false, copied: [] })).toBe('Created feat');
});

test('removing waits for a locked worktree to be unlocked and a dirty one to lose its changes', () => {
  expect(removeReady({ locked: false, dirty: false }, { unlock: false, force: false })).toBe(true);
  expect(removeReady({ locked: true, dirty: false }, { unlock: false, force: false })).toBe(false);
  expect(removeReady({ locked: true, dirty: false }, { unlock: true, force: false })).toBe(true);
  expect(removeReady({ locked: false, dirty: true }, { unlock: false, force: false })).toBe(false);
  expect(removeReady({ locked: false, dirty: null }, { unlock: false, force: false })).toBe(true);
});

test('the merged list ticks what can go, but not one with sessions running or no commits of its own', () => {
  const result = { worktrees: [
    { path: '/w/app.worktrees/done', branch: 'done', exists: true, dirty: false, locked: false, eligible: true, reason: '', fresh: false },
    { path: '/w/app.worktrees/busy', branch: 'busy', exists: true, dirty: false, locked: false, eligible: true, reason: '', fresh: false },
    { path: '/w/app.worktrees/dirty', branch: 'dirty', exists: true, dirty: true, locked: false, eligible: false, reason: 'Uncommitted changes', fresh: false },
    { path: '/w/app.worktrees/new', branch: 'new', exists: true, dirty: false, locked: false, eligible: true, reason: '', fresh: true },
  ] };
  const live = new Map([['/w/app.worktrees/busy', [session('s', '/w/app.worktrees/busy')]]]);
  const choices = mergedChoices(result, { mainPath: '/w/app' }, '', live);
  expect(choices.map((c) => c.ticked)).toEqual([true, false, false, false]);
  expect(choices[1].notes).toBe('app.worktrees/busy · 1 running');
  expect(choices[2].notes).toBe('app.worktrees/dirty · Uncommitted changes');
  expect(choices[3].notes).toBe('app.worktrees/new · no commits of its own yet');
});

test('settings: patterns as lines and back, groups collapsed and opened', () => {
  expect(patternsText(['.env*', 'config/local.json'])).toBe('.env*\nconfig/local.json');
  expect(patternsList(' .env* \n\nconfig/local.json\n.env*\n')).toEqual(['.env*', 'config/local.json']);
  expect(toggleGroup(['a'], 'b')).toEqual(['a', 'b']);
  expect(toggleGroup(['a', 'b'], 'a')).toEqual(['b']);
  expect(toggleGroup(undefined, 'a')).toEqual(['a']);
  expect(prunedText({ pruned: 1, detached: 0 })).toBe('Pruned 1 worktree record');
  expect(prunedText({ pruned: 2, detached: 1 })).toBe('Pruned 2 worktree records, detached 1 folder');
});

test('a worktree is found by its path or the one the project stored, and matched to its project folder', () => {
  const linked = { ...beta, attached: true, attachedPath: '/links/beta' };
  const repos = [repository('app', '/w/app', [main, linked])];
  expect(findWorktree(repos, '/links/beta')?.wt.branch).toBe('beta');
  expect(findWorktree(repos, '/w/app')?.repo.name).toBe('app');
  expect(findWorktree(repos, '/nowhere')).toBeNull();
  expect(folderFor([{ path: '/links/beta' }], linked)).toEqual({ path: '/links/beta' });
  expect(folderFor([{ path: '/w/app' }], alpha)).toBeNull();
  expect(parentFolder('/w/app.worktrees/beta/')).toBe('/w/app.worktrees');
  expect(parentFolder('/w')).toBe('/');
});

test('the sessions running in a worktree, the ones that need you first, with their CLI, state and time', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const sessions: Session[] = [
    { sessionId: 'a', projectPath: '/w/a', name: 'Fix the cart', runtime: 'claude', modified: '2026-11-20T11:55:00Z' },
    { sessionId: 'b', projectPath: '/w/a', name: 'Review', runtime: 'codex', modified: '2026-11-20T10:00:00Z' },
    { sessionId: 'c', projectPath: '/w/a', type: 'terminal', modified: '2026-11-20T11:59:00Z' },
  ];
  const live = {
    a: { ...running, busy: true },
    b: { ...running, attention: true },
    c: running,
  };
  const choices = runningSessionChoices(sessions, live, now);
  expect(choices.map((c) => c.title)).toEqual(['Review', 'Fix the cart', 'Terminal']);
  expect(choices[0].hint).toMatch(/^Codex · Needs you · /);
  expect(choices[1].hint).toMatch(/^Claude · Working · /);
  expect(choices[2].hint).toMatch(/^Terminal · Open · /);
  expect(sessionActivity(undefined)).toBe('Open');
  expect(sessionActivity({ ...running, starting: true })).toBe('Starting');
});

test('a new worktree can start an OpenCode session, listed after Codex', () => {
  expect(START_OPTIONS.map((o) => o.key)).toEqual(['none', 'claude', 'codex', 'opencode', 'terminal']);
  expect(START_OPTIONS.find((o) => o.key === 'opencode')?.label).toBe('An OpenCode session');
});
