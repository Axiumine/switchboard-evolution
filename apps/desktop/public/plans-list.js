// What the sidebar's Plans tab lists, and how: the Group, Filter and Sort
// controls over the plans main.js get-plans returns (plans-source.js links
// each one to the session that wrote it, its folder and its project).
//
//   Group:  no grouping, by project, by folder, by date.
//   Filter: project, folder, date of the last edit, and the session (archived
//           or not, or gone); the four combine.
//   Sort:   last edited, oldest first, created (when the plan's first session
//           started, plans-source.js), title A–Z.
//
// A plan no project claims goes under "No project", one whose session is gone
// under "Unknown folder" as well; both groups come last. The choices are kept
// across restarts in localStorage, like the Sessions and Files tabs' combos.
// No DOM, so node --test loads it as well; plans-memory-view.js draws the list.

const PLAN_GROUPS = [
  ['none', 'No groups'],
  ['project', 'By project'],
  ['folder', 'By folder'],
  ['date', 'By date'],
];
const PLAN_SORTS = [
  ['modified', 'Last edited'],
  ['oldest', 'Oldest first'],
  ['created', 'Created'],
  ['title', 'Title A–Z'],
];
const PLAN_DATE_FILTERS = [
  ['all', 'Any time'],
  ['today', 'Today'],
  ['week', 'Last 7 days'],
  ['month', 'Last 30 days'],
  ['older', 'Older than 30 days'],
];
const PLAN_SESSION_FILTERS = [
  ['all', 'Any session'],
  ['active', 'Session not archived'],
  ['archived', 'Session archived'],
  ['none', 'No session found'],
];
// The key of a plan no project claims, or with no known folder, in filters and groups.
const PLAN_NONE = '__none__';
const PLAN_LIST_DEFAULTS = { group: 'project', sort: 'modified', project: 'all', folder: 'all', date: 'all', session: 'all' };
const PLAN_LIST_STORAGE_KEYS = {
  group: 'plans.group',
  sort: 'plans.sort',
  project: 'plans.filter.project',
  folder: 'plans.filter.folder',
  date: 'plans.filter.date',
  session: 'plans.filter.session',
};
const PLAN_FILTER_KINDS = ['project', 'folder', 'date', 'session'];
const PLAN_DAY_MS = 86400000;

function planListChoices(kind) {
  return { group: PLAN_GROUPS, sort: PLAN_SORTS, date: PLAN_DATE_FILTERS, session: PLAN_SESSION_FILTERS }[kind] || null;
}

/**
 * A saved choice, or the default when it is missing or no longer offered. The
 * project and folder filters take any id or path: whether it still names one
 * of the listed plans is prunePlanFilters' call, once the plans are known.
 */
function validPlanListChoice(kind, value) {
  const choices = planListChoices(kind);
  if (choices) return choices.some(([v]) => v === value) ? value : PLAN_LIST_DEFAULTS[kind];
  if (kind === 'project' || kind === 'folder') return typeof value === 'string' && value ? value : 'all';
  return undefined;
}

/** The six choices as saved in `storage` (localStorage); defaults when it throws or is empty. */
function loadPlanListPrefs(storage) {
  const prefs = {};
  for (const [kind, key] of Object.entries(PLAN_LIST_STORAGE_KEYS)) {
    let value = null;
    try { value = storage.getItem(key); } catch {}
    prefs[kind] = validPlanListChoice(kind, value);
  }
  return prefs;
}

function savePlanListPrefs(storage, prefs) {
  try {
    for (const [kind, key] of Object.entries(PLAN_LIST_STORAGE_KEYS)) {
      storage.setItem(key, validPlanListChoice(kind, prefs && prefs[kind]));
    }
  } catch {}
}

/** How many of the four filters hide some plans. Group and sort never do. */
function activePlanFilterCount(prefs) {
  return PLAN_FILTER_KINDS.filter(kind => prefs && prefs[kind] && prefs[kind] !== 'all').length;
}

function planProjectKey(plan) { return (plan && plan.projectId) || PLAN_NONE; }
function planFolderKey(plan) { return (plan && plan.projectPath) || PLAN_NONE; }

/** A folder's last two segments, as the sidebar shows folders (utils.js shortProjectPath). */
function planFolderLabel(folderPath) {
  if (!folderPath || folderPath === PLAN_NONE) return 'Unknown folder';
  return String(folderPath).split(/[\\/]/).filter(Boolean).slice(-2).join('/') || String(folderPath);
}

function planProjectLabel(plan) {
  return (plan && plan.projectId && plan.projectName) || 'No project';
}

/** Milliseconds of a plan's date `field` ('modified' or 'created'), falling back to the last edit. */
function planTime(plan, field = 'modified') {
  const t = Date.parse((plan && plan[field]) || (plan && plan.modified) || '');
  return Number.isFinite(t) ? t : 0;
}

function planStartOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function planMatchesDate(time, filter, now) {
  if (filter === 'today') return time >= planStartOfDay(now);
  if (filter === 'week') return time >= now - 7 * PLAN_DAY_MS;
  if (filter === 'month') return time >= now - 30 * PLAN_DAY_MS;
  if (filter === 'older') return time < now - 30 * PLAN_DAY_MS;
  return true;
}

function planMatchesSession(plan, filter) {
  if (filter === 'none') return !plan.sessionId;
  if (filter === 'active') return !!plan.sessionId && !plan.archived;
  if (filter === 'archived') return !!plan.sessionId && !!plan.archived;
  return true;
}

/** The plans the four filters let through. The date filter looks at the last edit. */
function filterPlans(plans, prefs, now = Date.now()) {
  const p = prefs || PLAN_LIST_DEFAULTS;
  return (plans || []).filter(plan =>
    (!p.project || p.project === 'all' || planProjectKey(plan) === p.project)
    && (!p.folder || p.folder === 'all' || planFolderKey(plan) === p.folder)
    && planMatchesDate(planTime(plan), p.date, now)
    && planMatchesSession(plan, p.session));
}

function comparePlanTitles(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
}

/** A sorted copy. Ties fall back to the newest edit, then the file name. */
function sortPlans(plans, sort = 'modified') {
  const newest = (a, b) => planTime(b) - planTime(a) || comparePlanTitles(a.filename, b.filename);
  const compare = {
    modified: newest,
    oldest: (a, b) => planTime(a) - planTime(b) || comparePlanTitles(a.filename, b.filename),
    created: (a, b) => planTime(b, 'created') - planTime(a, 'created') || newest(a, b),
    title: (a, b) => comparePlanTitles(a.title, b.title) || newest(a, b),
  }[sort] || newest;
  return (plans || []).slice().sort(compare);
}

const PLAN_DATE_BUCKETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Earlier this week'],
  ['month', 'Earlier this month'],
  ['older', 'Older'],
];

/** The Projects tab's time buckets (projects-view.js timeBucket), without its "Now". */
function planDateBucket(time, now) {
  const today = planStartOfDay(now);
  if (time >= today) return 'today';
  if (time >= today - PLAN_DAY_MS) return 'yesterday';
  if (time >= today - 6 * PLAN_DAY_MS) return 'week';
  if (time >= today - 29 * PLAN_DAY_MS) return 'month';
  return 'older';
}

/**
 * The sorted plans in groups: [{ key, title, hint, plans }], in the order the
 * tab shows them. Project and folder groups follow the sort (the group of the
 * first plan first; by name when sorting by title), with "No project" or
 * "Unknown folder" last. Date groups follow time, newest first unless the sort
 * is oldest first, and use the creation date when sorting by it. No grouping
 * gives one group with every plan.
 */
function groupPlans(sortedPlans, mode, sort = 'modified', now = Date.now()) {
  const plans = sortedPlans || [];
  if (mode === 'date') {
    const field = sort === 'created' ? 'created' : 'modified';
    const byBucket = new Map(PLAN_DATE_BUCKETS.map(([key]) => [key, []]));
    for (const plan of plans) byBucket.get(planDateBucket(planTime(plan, field), now)).push(plan);
    const buckets = sort === 'oldest' ? PLAN_DATE_BUCKETS.slice().reverse() : PLAN_DATE_BUCKETS;
    return buckets
      .map(([key, title]) => ({ key, title, hint: '', plans: byBucket.get(key) }))
      .filter(g => g.plans.length);
  }
  if (mode !== 'project' && mode !== 'folder') {
    return plans.length ? [{ key: 'all', title: '', hint: '', plans }] : [];
  }
  const keyOf = mode === 'project' ? planProjectKey : planFolderKey;
  const groups = new Map();
  for (const plan of plans) {
    const key = keyOf(plan);
    let group = groups.get(key);
    if (!group) {
      group = mode === 'project'
        ? { key, title: planProjectLabel(plan), hint: '', plans: [] }
        : { key, title: planFolderLabel(key), hint: key === PLAN_NONE ? '' : key, plans: [] };
      groups.set(key, group);
    }
    group.plans.push(plan);
  }
  const list = [...groups.values()];
  if (sort === 'title') list.sort((a, b) => comparePlanTitles(a.title, b.title));
  const none = list.filter(g => g.key === PLAN_NONE);
  return [...list.filter(g => g.key !== PLAN_NONE), ...none];
}

/**
 * The projects and folders the filter menu offers: those of the listed plans,
 * by name, each with its number of plans, "No project" / "Unknown folder" last.
 */
function planFilterChoices(plans) {
  const count = (keyOf, labelOf) => {
    const byKey = new Map();
    for (const plan of plans || []) {
      const key = keyOf(plan);
      const entry = byKey.get(key);
      if (entry) entry.count++;
      else byKey.set(key, { value: key, label: labelOf(plan, key), count: 1 });
    }
    const list = [...byKey.values()].sort((a, b) => comparePlanTitles(a.label, b.label));
    return [...list.filter(c => c.value !== PLAN_NONE), ...list.filter(c => c.value === PLAN_NONE)];
  };
  return {
    projects: count(planProjectKey, plan => planProjectLabel(plan)),
    folders: count(planFolderKey, (_plan, key) => planFolderLabel(key)),
  };
}

/**
 * The choices with a project or folder filter that names none of the listed
 * plans set back to all (the project was removed, the plans are gone), and
 * whether anything changed.
 */
function prunePlanFilters(prefs, choices) {
  const next = { ...prefs };
  let changed = false;
  for (const [kind, list] of [['project', choices && choices.projects], ['folder', choices && choices.folders]]) {
    if (next[kind] && next[kind] !== 'all' && !(list || []).some(c => c.value === next[kind])) {
      next[kind] = 'all';
      changed = true;
    }
  }
  return { prefs: next, changed };
}

/**
 * Where a plan's row says it belongs: its project, or its folder when no
 * project claims it; under project groups, its folder (the group already
 * names the project). Empty when there is nothing to say.
 */
function planPlaceLabel(plan, group) {
  const folder = plan && plan.projectPath ? planFolderLabel(plan.projectPath) : '';
  if (group === 'project') return folder;
  if (group === 'folder') return plan && plan.projectId ? planProjectLabel(plan) : '';
  return (plan && plan.projectId && plan.projectName) || folder;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLAN_GROUPS, PLAN_SORTS, PLAN_DATE_FILTERS, PLAN_SESSION_FILTERS, PLAN_NONE,
    PLAN_LIST_DEFAULTS, PLAN_LIST_STORAGE_KEYS,
    validPlanListChoice, loadPlanListPrefs, savePlanListPrefs, activePlanFilterCount,
    planFolderLabel, filterPlans, sortPlans, groupPlans, planDateBucket,
    planFilterChoices, prunePlanFilters, planPlaceLabel,
  };
}
