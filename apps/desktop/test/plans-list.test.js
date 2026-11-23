const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAN_NONE, PLAN_LIST_DEFAULTS, PLAN_LIST_STORAGE_KEYS,
  loadPlanListPrefs, savePlanListPrefs, activePlanFilterCount,
  filterPlans, sortPlans, groupPlans, planDateBucket,
  planFilterChoices, prunePlanFilters, planPlaceLabel, planFolderLabel,
} = require('../public/plans-list');

// Noon on 2026-11-20, local time, so day boundaries do not depend on the zone.
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();
const at = (daysAgo, hour = 12) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

function plan(filename, over = {}) {
  return {
    filename: `${filename}.md`, title: filename, modified: at(0), created: at(0),
    sessionId: `s-${filename}`, sessionCount: 1, projectPath: '/work/alpha', archived: false,
    projectId: 'p-alpha', projectName: 'Alpha',
    ...over,
  };
}

const PLANS = [
  plan('today-alpha', { modified: at(0, 9), created: at(3) }),
  plan('yesterday-beta', { modified: at(1), created: at(1), projectPath: '/work/beta', projectId: 'p-beta', projectName: 'Beta' }),
  plan('week-loose', { modified: at(4), created: at(10), projectPath: '/scratch/loose', projectId: null, projectName: null }),
  plan('month-archived', { modified: at(20), created: at(20), archived: true }),
  plan('old-orphan', { modified: at(60), created: at(60), sessionId: null, sessionCount: 0, projectPath: null, projectId: null, projectName: null }),
];
const names = list => list.map(p => p.filename.replace(/\.md$/, ''));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

test('preferences: defaults, saved values, and values no longer offered', () => {
  assert.deepEqual(loadPlanListPrefs(memoryStorage()), PLAN_LIST_DEFAULTS);
  const storage = memoryStorage({
    [PLAN_LIST_STORAGE_KEYS.group]: 'folder',
    [PLAN_LIST_STORAGE_KEYS.sort]: 'title',
    [PLAN_LIST_STORAGE_KEYS.project]: 'p-beta',
    [PLAN_LIST_STORAGE_KEYS.folder]: '/work/beta',
    [PLAN_LIST_STORAGE_KEYS.date]: 'week',
    [PLAN_LIST_STORAGE_KEYS.session]: 'archived',
  });
  assert.deepEqual(loadPlanListPrefs(storage), {
    group: 'folder', sort: 'title', project: 'p-beta', folder: '/work/beta', date: 'week', session: 'archived',
  });
  const stale = memoryStorage({ [PLAN_LIST_STORAGE_KEYS.group]: 'track', [PLAN_LIST_STORAGE_KEYS.sort]: 'size', [PLAN_LIST_STORAGE_KEYS.project]: '' });
  assert.deepEqual(loadPlanListPrefs(stale), PLAN_LIST_DEFAULTS);
});

test('preferences: a storage that throws gives the defaults and saving is silent', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadPlanListPrefs(broken), PLAN_LIST_DEFAULTS);
  assert.doesNotThrow(() => savePlanListPrefs(broken, PLAN_LIST_DEFAULTS));
});

test('preferences: save then load round-trips, unknown values saved as defaults', () => {
  const storage = memoryStorage();
  savePlanListPrefs(storage, { group: 'date', sort: 'oldest', project: PLAN_NONE, folder: 'all', date: 'today', session: 'none' });
  assert.deepEqual(loadPlanListPrefs(storage), { group: 'date', sort: 'oldest', project: PLAN_NONE, folder: 'all', date: 'today', session: 'none' });
  savePlanListPrefs(storage, { group: 'nope', sort: 'nope', project: 'p-alpha', folder: 'all', date: 'nope', session: 'nope' });
  assert.deepEqual(loadPlanListPrefs(storage), { ...PLAN_LIST_DEFAULTS, project: 'p-alpha' });
});

test('activePlanFilterCount counts the four filters, never group or sort', () => {
  assert.equal(activePlanFilterCount(PLAN_LIST_DEFAULTS), 0);
  assert.equal(activePlanFilterCount({ ...PLAN_LIST_DEFAULTS, group: 'folder', sort: 'title' }), 0);
  assert.equal(activePlanFilterCount({ ...PLAN_LIST_DEFAULTS, project: 'p-alpha', date: 'week' }), 2);
  assert.equal(activePlanFilterCount({ group: 'none', sort: 'title', project: 'x', folder: 'y', date: 'today', session: 'none' }), 4);
});

test('filterPlans: project, including the plans no project claims', () => {
  assert.deepEqual(names(filterPlans(PLANS, { ...PLAN_LIST_DEFAULTS, project: 'p-alpha' }, NOW)), ['today-alpha', 'month-archived']);
  assert.deepEqual(names(filterPlans(PLANS, { ...PLAN_LIST_DEFAULTS, project: PLAN_NONE }, NOW)), ['week-loose', 'old-orphan']);
});

test('filterPlans: folder, including the plans with no known folder', () => {
  assert.deepEqual(names(filterPlans(PLANS, { ...PLAN_LIST_DEFAULTS, folder: '/work/beta' }, NOW)), ['yesterday-beta']);
  assert.deepEqual(names(filterPlans(PLANS, { ...PLAN_LIST_DEFAULTS, folder: PLAN_NONE }, NOW)), ['old-orphan']);
});

test('filterPlans: date of the last edit', () => {
  const by = date => names(filterPlans(PLANS, { ...PLAN_LIST_DEFAULTS, date }, NOW));
  assert.deepEqual(by('today'), ['today-alpha']);
  assert.deepEqual(by('week'), ['today-alpha', 'yesterday-beta', 'week-loose']);
  assert.deepEqual(by('month'), ['today-alpha', 'yesterday-beta', 'week-loose', 'month-archived']);
  assert.deepEqual(by('older'), ['old-orphan']);
  assert.equal(by('all').length, PLANS.length);
});

test('filterPlans: session archived, not archived, or gone', () => {
  const by = session => names(filterPlans(PLANS, { ...PLAN_LIST_DEFAULTS, session }, NOW));
  assert.deepEqual(by('active'), ['today-alpha', 'yesterday-beta', 'week-loose']);
  assert.deepEqual(by('archived'), ['month-archived']);
  assert.deepEqual(by('none'), ['old-orphan']);
});

test('filterPlans: the filters combine', () => {
  const prefs = { ...PLAN_LIST_DEFAULTS, project: 'p-alpha', date: 'month', session: 'active' };
  assert.deepEqual(names(filterPlans(PLANS, prefs, NOW)), ['today-alpha']);
  assert.deepEqual(filterPlans(PLANS, { ...prefs, folder: '/work/beta' }, NOW), []);
});

test('sortPlans: the four orders, without touching the input', () => {
  const input = PLANS.slice().reverse();
  const before = names(input);
  assert.deepEqual(names(sortPlans(input, 'modified')), ['today-alpha', 'yesterday-beta', 'week-loose', 'month-archived', 'old-orphan']);
  assert.deepEqual(names(sortPlans(input, 'oldest')), ['old-orphan', 'month-archived', 'week-loose', 'yesterday-beta', 'today-alpha']);
  assert.deepEqual(names(sortPlans(input, 'created')), ['yesterday-beta', 'today-alpha', 'week-loose', 'month-archived', 'old-orphan']);
  assert.deepEqual(names(sortPlans(input, 'title')), ['month-archived', 'old-orphan', 'today-alpha', 'week-loose', 'yesterday-beta']);
  assert.deepEqual(names(input), before);
});

test('sortPlans: titles compare without case and with numbers in order', () => {
  const list = [plan('b', { title: 'Phase 10' }), plan('a', { title: 'phase 2' }), plan('c', { title: 'Alpha' })];
  assert.deepEqual(sortPlans(list, 'title').map(p => p.title), ['Alpha', 'phase 2', 'Phase 10']);
});

test('groupPlans by project: sorted groups, "No project" last', () => {
  const groups = groupPlans(sortPlans(PLANS, 'modified'), 'project', 'modified', NOW);
  assert.deepEqual(groups.map(g => [g.key, g.title, names(g.plans)]), [
    ['p-alpha', 'Alpha', ['today-alpha', 'month-archived']],
    ['p-beta', 'Beta', ['yesterday-beta']],
    [PLAN_NONE, 'No project', ['week-loose', 'old-orphan']],
  ]);
  const oldest = groupPlans(sortPlans(PLANS, 'oldest'), 'project', 'oldest', NOW);
  assert.deepEqual(oldest.map(g => g.key), ['p-alpha', 'p-beta', PLAN_NONE]);
  const extra = [...PLANS, plan('zeta', { projectId: 'p-zeta', projectName: 'Zeta', modified: at(30) })];
  const byTitle = groupPlans(sortPlans(extra, 'title'), 'project', 'title', NOW);
  assert.deepEqual(byTitle.map(g => g.title), ['Alpha', 'Beta', 'Zeta', 'No project']);
});

test('groupPlans by folder: short labels, the full path as hint, "Unknown folder" last', () => {
  const groups = groupPlans(sortPlans(PLANS, 'modified'), 'folder', 'modified', NOW);
  assert.deepEqual(groups.map(g => [g.title, g.hint, g.plans.length]), [
    ['work/alpha', '/work/alpha', 2],
    ['work/beta', '/work/beta', 1],
    ['scratch/loose', '/scratch/loose', 1],
    ['Unknown folder', '', 1],
  ]);
});

test('groupPlans by date: time buckets, reversed for oldest first, creation date when sorting by it', () => {
  const groups = groupPlans(sortPlans(PLANS, 'modified'), 'date', 'modified', NOW);
  assert.deepEqual(groups.map(g => [g.title, names(g.plans)]), [
    ['Today', ['today-alpha']],
    ['Yesterday', ['yesterday-beta']],
    ['Earlier this week', ['week-loose']],
    ['Earlier this month', ['month-archived']],
    ['Older', ['old-orphan']],
  ]);
  const oldest = groupPlans(sortPlans(PLANS, 'oldest'), 'date', 'oldest', NOW);
  assert.deepEqual(oldest.map(g => g.key), ['older', 'month', 'week', 'yesterday', 'today']);
  const created = groupPlans(sortPlans(PLANS, 'created'), 'date', 'created', NOW);
  assert.deepEqual(created.map(g => [g.key, names(g.plans)]), [
    ['yesterday', ['yesterday-beta']],
    ['week', ['today-alpha']],
    ['month', ['week-loose', 'month-archived']],
    ['older', ['old-orphan']],
  ]);
});

test('groupPlans without grouping: one group, or none for no plans', () => {
  const groups = groupPlans(PLANS, 'none', 'modified', NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].plans.length, PLANS.length);
  assert.deepEqual(groupPlans([], 'none', 'modified', NOW), []);
  assert.deepEqual(groupPlans([], 'project', 'modified', NOW), []);
});

test('planDateBucket follows the Projects tab boundaries', () => {
  const t = (daysAgo, hour) => Date.parse(at(daysAgo, hour));
  assert.equal(planDateBucket(t(0, 0), NOW), 'today');
  assert.equal(planDateBucket(t(1, 0), NOW), 'yesterday');
  assert.equal(planDateBucket(t(6, 0), NOW), 'week');
  assert.equal(planDateBucket(t(7, 12), NOW), 'month');
  // Whole days in milliseconds, as the Projects tab counts them: a daylight
  // saving change in between moves a calendar midnight by an hour, so the
  // edges are checked away from it.
  assert.equal(planDateBucket(t(28, 0), NOW), 'month');
  assert.equal(planDateBucket(t(31, 12), NOW), 'older');
});

test('planFilterChoices: projects and folders with counts, the unknown ones last', () => {
  const choices = planFilterChoices(PLANS);
  assert.deepEqual(choices.projects, [
    { value: 'p-alpha', label: 'Alpha', count: 2 },
    { value: 'p-beta', label: 'Beta', count: 1 },
    { value: PLAN_NONE, label: 'No project', count: 2 },
  ]);
  assert.deepEqual(choices.folders.map(c => [c.label, c.count]), [
    ['scratch/loose', 1], ['work/alpha', 2], ['work/beta', 1], ['Unknown folder', 1],
  ]);
});

test('prunePlanFilters drops a project or folder no plan has any more', () => {
  const choices = planFilterChoices(PLANS);
  const kept = prunePlanFilters({ ...PLAN_LIST_DEFAULTS, project: 'p-beta', folder: PLAN_NONE }, choices);
  assert.equal(kept.changed, false);
  assert.equal(kept.prefs.project, 'p-beta');
  const pruned = prunePlanFilters({ ...PLAN_LIST_DEFAULTS, project: 'p-gone', folder: '/gone', date: 'week' }, choices);
  assert.equal(pruned.changed, true);
  assert.deepEqual(pruned.prefs, { ...PLAN_LIST_DEFAULTS, date: 'week' });
});

test('planPlaceLabel: project, else folder; the folder under project groups', () => {
  const [alpha, , loose, , orphan] = PLANS;
  assert.equal(planPlaceLabel(alpha, 'none'), 'Alpha');
  assert.equal(planPlaceLabel(loose, 'date'), 'scratch/loose');
  assert.equal(planPlaceLabel(orphan, 'none'), '');
  assert.equal(planPlaceLabel(alpha, 'project'), 'work/alpha');
  assert.equal(planPlaceLabel(alpha, 'folder'), 'Alpha');
  assert.equal(planPlaceLabel(loose, 'folder'), '');
});

test('planFolderLabel keeps the last two segments, on Windows paths too', () => {
  assert.equal(planFolderLabel('/Users/me/code/app'), 'code/app');
  assert.equal(planFolderLabel('C:\\code\\app'), 'code/app');
  assert.equal(planFolderLabel(null), 'Unknown folder');
  assert.equal(planFolderLabel(PLAN_NONE), 'Unknown folder');
});
