// The Session Overview's model: the saved choices (and their one-time
// migration from the old Sessions tab choices), the period and live-state
// buckets, which sessions become cards and how they are grouped and ordered,
// the grid geometry and the page's open/close lifecycle. Pure functions with no
// DOM; storage and the live probes are passed in. Builds on session-list.js
// (filterSessionsByPrefs, orderRenderItems, truncateRenderItems and the status
// and pinned choices), which must be loaded first.

const OVERVIEW_PREFS_KEY = 'overview.prefs.v1';
const OVERVIEW_CLIS = ['claude', 'codex', 'opencode', 'terminal'];
const OVERVIEW_CLI_LABELS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', terminal: 'Terminal' };
const OVERVIEW_LAYOUTS = [
  ['grid-fit', 'Grid (fit)'],
  ['grid-down', 'Grid, scroll down'],
  ['grid-across', 'Grid, scroll across'],
  ['rows', 'Rows'],
  ['columns', 'Columns'],
];
const OVERVIEW_SORTS = [
  ['activity', 'Recent activity'],
  ['priority', 'Running & pinned first'],
  ['created', 'Created'],
  ['name', 'Name'],
  ['status', 'Status'],
  ['place', 'Folder or project'],
];
const OVERVIEW_GROUPS = [
  ['none', 'None'],
  ['folder', 'Folder'],
  ['project', 'Project'],
  ['cli', 'CLI'],
  ['kind', 'Kind'],
  ['status', 'Status'],
  ['period', 'Period'],
  ['pinned', 'Pinned'],
];
// The period filter.
const OVERVIEW_PERIODS = [
  ['any', 'Any time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['3d', 'Last 3 days'],
  ['7d', 'Last week'],
  ['30d', 'Last month'],
];
// The exclusive bands of "Group by period".
const OVERVIEW_PERIOD_BUCKETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['3d', 'Last 3 days'],
  ['7d', 'Last week'],
  ['30d', 'Last month'],
  ['older', 'Older'],
];
const OVERVIEW_STATUS_BUCKETS = [
  ['attention', 'Needs input'],
  ['working', 'Working'],
  ['ready', 'Response ready'],
  ['idle', 'Idle'],
  ['stopped', 'Not running'],
];
const OVERVIEW_LIMITS = { cols: [1, 8], rows: [1, 6], cardWidth: [320, 1600], cardHeight: [200, 1200], n: [1, 20] };
const OVERVIEW_DEFAULTS = {
  includeClosed: false,
  showArchived: false,
  filters: { status: 'all', pinned: 'all', clis: [], period: 'any', place: null },
  sort: { by: 'activity', dir: 'desc' },
  group: { by: 'none', display: 'sections', axis: 'across', fit: false, collapsed: [] },
  layout: { mode: 'grid-fit', cols: 2, rows: 2, cardWidth: 560, cardHeight: 450 },
  search: { inMessages: false, which: 'first', n: 1 },
  dock: null,
};
// The key of the one group of "Group by none".
const OVERVIEW_ALL_KEY = '__all__';
const OVERVIEW_NO_PROJECT_KEY = '__no-project__';
const OVERVIEW_DAY_MS = 86400000;

function overviewDefaults() {
  return JSON.parse(JSON.stringify(OVERVIEW_DEFAULTS));
}

// ---- Prefs ----

function overviewChoice(list, value, fallback) {
  return list.some(([v]) => v === value) ? value : fallback;
}

function overviewClamp(value, [min, max], fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function overviewPlace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'folder' && typeof raw.path === 'string' && raw.path) return { kind: 'folder', path: raw.path };
  if (raw.kind === 'project' && typeof raw.id === 'string' && raw.id) return { kind: 'project', id: raw.id };
  return null;
}

/** Saved prefs of any age or shape, as prefs this model can use: unknown values go back to the default, numbers are clamped. `dock` passes as it is. */
function normalizeOverviewPrefs(raw) {
  const d = overviewDefaults();
  const r = raw && typeof raw === 'object' ? raw : {};
  const obj = value => (value && typeof value === 'object' ? value : {});
  const f = obj(r.filters);
  const so = obj(r.sort);
  const g = obj(r.group);
  const l = obj(r.layout);
  const se = obj(r.search);
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  return {
    includeClosed: bool(r.includeClosed, d.includeClosed),
    showArchived: bool(r.showArchived, d.showArchived),
    filters: {
      status: validSessionListChoice('status', f.status),
      pinned: validSessionListChoice('pinned', f.pinned),
      clis: Array.isArray(f.clis) ? OVERVIEW_CLIS.filter(cli => f.clis.includes(cli)) : [],
      period: overviewChoice(OVERVIEW_PERIODS, f.period, d.filters.period),
      place: overviewPlace(f.place),
    },
    sort: {
      by: overviewChoice(OVERVIEW_SORTS, so.by, d.sort.by),
      dir: so.dir === 'asc' || so.dir === 'desc' ? so.dir : d.sort.dir,
    },
    group: {
      by: overviewChoice(OVERVIEW_GROUPS, g.by, d.group.by),
      display: g.display === 'sections' || g.display === 'carousels' ? g.display : d.group.display,
      axis: g.axis === 'across' || g.axis === 'down' ? g.axis : d.group.axis,
      fit: bool(g.fit, d.group.fit),
      collapsed: Array.isArray(g.collapsed) ? g.collapsed.filter(key => typeof key === 'string') : [],
    },
    layout: {
      mode: overviewChoice(OVERVIEW_LAYOUTS, l.mode, d.layout.mode),
      cols: overviewClamp(l.cols, OVERVIEW_LIMITS.cols, d.layout.cols),
      rows: overviewClamp(l.rows, OVERVIEW_LIMITS.rows, d.layout.rows),
      cardWidth: overviewClamp(l.cardWidth, OVERVIEW_LIMITS.cardWidth, d.layout.cardWidth),
      cardHeight: overviewClamp(l.cardHeight, OVERVIEW_LIMITS.cardHeight, d.layout.cardHeight),
    },
    search: {
      inMessages: bool(se.inMessages, d.search.inMessages),
      which: se.which === 'first' || se.which === 'last' || se.which === 'all' ? se.which : d.search.which,
      n: overviewClamp(se.n, OVERVIEW_LIMITS.n, d.search.n),
    },
    dock: r.dock === undefined ? null : r.dock,
  };
}

/** The prefs saved in `storage`; without any yet, the old Sessions tab choices carried over; defaults when it throws or holds junk. */
function loadOverviewPrefs(storage) {
  let saved = null;
  try { saved = storage.getItem(OVERVIEW_PREFS_KEY); } catch { return overviewDefaults(); }
  if (saved === null || saved === undefined) {
    const old = loadSessionListPrefs(storage);
    return normalizeOverviewPrefs({
      filters: { status: old.status, pinned: old.pinned },
      sort: { by: old.order === 'priority' ? 'priority' : 'activity' },
      group: { by: old.groupByFolders ? 'folder' : 'none' },
    });
  }
  try { return normalizeOverviewPrefs(JSON.parse(saved)); } catch { return overviewDefaults(); }
}

function saveOverviewPrefs(storage, prefs) {
  try { storage.setItem(OVERVIEW_PREFS_KEY, JSON.stringify(normalizeOverviewPrefs(prefs))); } catch {}
}

/** Whether a status, pinned, CLI, period or place filter is set (and so hides some sessions). Sort and group never do. */
function overviewFiltersActive(prefs) {
  const f = prefs.filters;
  return f.status !== 'all' || f.pinned !== 'all' || f.clis.length > 0 || f.period !== 'any' || !!f.place;
}

// ---- Periods and live state ----

/** Local midnight `daysBack` days before the one of `now`. */
function overviewMidnight(now, daysBack) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
}

/** The exclusive band a time falls in, from the local midnight of `now`: today from M0, yesterday from M-1, 3d from M-2, 7d from M-6, 30d from M-29. */
function periodOf(time, now) {
  if (time >= overviewMidnight(now, 0)) return 'today';
  if (time >= overviewMidnight(now, 1)) return 'yesterday';
  if (time >= overviewMidnight(now, 2)) return '3d';
  if (time >= overviewMidnight(now, 6)) return '7d';
  if (time >= overviewMidnight(now, 29)) return '30d';
  return 'older';
}

/** The period filter: today and yesterday are their band alone, 3d, 7d and 30d reach back from M-2, M-6 and M-29. */
function passesPeriod(time, period, now) {
  switch (period) {
    case 'today': case 'yesterday': return periodOf(time, now) === period;
    case '3d': return time >= overviewMidnight(now, 2);
    case '7d': return time >= overviewMidnight(now, 6);
    case '30d': return time >= overviewMidnight(now, 29);
    default: return true;
  }
}

/** A session's state right now: needs input, else working, else response ready, else idle when running, else not running. */
function liveStateOf(id, probes) {
  if (probes.needsInput(id)) return 'attention';
  if (probes.isBusy(id)) return 'working';
  if (probes.isResponseReady(id)) return 'ready';
  return probes.isRunning(id) ? 'idle' : 'stopped';
}

// ---- Cards ----

function overviewCliOf(session) {
  if (session.type === 'terminal') return 'terminal';
  return OVERVIEW_CLIS.includes(session.runtime) ? session.runtime : 'claude';
}

function overviewTitleOf(session) {
  return session.name || session.aiTitle || session.summary || '';
}

function overviewCreatedTime(session) {
  const created = Date.parse(session.created);
  return Number.isFinite(created) ? created : Date.parse(session.modified) || 0;
}

/**
 * Put cards in order. With `resort`, or no earlier order (`previousIds`), by
 * `sort` ({ by, dir }; `asc` reverses the order each `by` has by default: newest
 * first, A to Z, the order of the buckets). Else as orderRenderItems puts rows:
 * they keep their places and new ones go on top.
 */
function orderCards(cards, { sort, resort, previousIds }) {
  const items = cards.map(card => ({ sortTime: card.sortTime, pinned: card.pinned, running: card.running, element: { id: card.id }, card }));
  const kept = items.length > 0 && !resort && previousIds;
  if (kept) return orderRenderItems(items, { order: 'recent', resort, previousIds }).map(item => item.card);
  const by = sort.by;
  let ordered;
  if (by === 'activity' || by === 'priority') {
    ordered = orderRenderItems(items, { order: by === 'priority' ? 'priority' : 'recent', resort: true }).map(item => item.card);
  } else {
    const byTime = (a, b) => b.sortTime - a.sortTime;
    const statusIndex = card => OVERVIEW_STATUS_BUCKETS.findIndex(([key]) => key === card.state);
    const compare = {
      created: (a, b) => overviewCreatedTime(b.session) - overviewCreatedTime(a.session),
      name: (a, b) => overviewTitleOf(a.session).localeCompare(overviewTitleOf(b.session)),
      status: (a, b) => statusIndex(a) - statusIndex(b) || byTime(a, b),
      place: (a, b) => (a.placeLabel || '').localeCompare(b.placeLabel || '') || byTime(a, b),
    }[by] || byTime;
    ordered = [...cards].sort(compare);
  }
  return sort.dir === 'asc' ? ordered.reverse() : ordered;
}

function overviewGroupOf(by, card, ctx) {
  const session = card.session;
  switch (by) {
    case 'folder': {
      const folder = ctx.folderOf(session);
      return { key: folder.key, label: folder.label, kind: 'folder', path: folder.key };
    }
    case 'project': {
      const project = ctx.projectOf(session);
      if (!project) return { key: OVERVIEW_NO_PROJECT_KEY, label: 'No project', kind: 'other' };
      return { key: project.id, label: project.name, kind: 'project', projectId: project.id };
    }
    case 'cli': {
      const cli = overviewCliOf(session);
      return { key: cli, label: OVERVIEW_CLI_LABELS[cli], kind: 'other' };
    }
    case 'kind':
      return overviewCliOf(session) === 'terminal'
        ? { key: 'terminal', label: 'Terminal', kind: 'other' }
        : { key: 'agent', label: 'Agent', kind: 'other' };
    case 'pinned':
      return card.pinned ? { key: 'pinned', label: 'Pinned', kind: 'other' } : { key: 'others', label: 'Others', kind: 'other' };
    case 'status': {
      const bucket = OVERVIEW_STATUS_BUCKETS.find(([key]) => key === card.state);
      return { key: bucket[0], label: bucket[1], kind: 'other' };
    }
    case 'period': {
      const key = periodOf(card.sortTime, ctx.now);
      return { key, label: OVERVIEW_PERIOD_BUCKETS.find(([k]) => k === key)[1], kind: 'other' };
    }
    default:
      return { key: OVERVIEW_ALL_KEY, label: '', kind: 'none' };
  }
}

/**
 * The cards the overview shows, in groups. `sessions` are all the sessions
 * known; `ctx` says which are open, what state they are in and what the page
 * has set aside (see the field list in the plan). `total` and `running` count
 * the sessions that pass the filters, before the slug and "+ N older" cuts:
 * "N results" and "Stop N running". A group's `older` holds the closed cards
 * left out of it, for its "+ N older" card; a card's `placeLabel` is what the
 * "Folder or project" sort reads.
 *
 * Nothing moves until a re-sort: `previousOrder` (group key to card ids) holds
 * the cards' places and `previousGroups` (group keys, in the order of the last
 * render, or undefined) the groups' places; `resort` ignores both. Groups by
 * period and status have a fixed order and ignore `previousGroups`.
 */
function buildOverview(sessions, prefs, ctx) {
  const searching = !!ctx.searchIds;
  const probes = { isRunning: ctx.isRunning, needsInput: ctx.needsInput, isBusy: ctx.isBusy, isResponseReady: ctx.isResponseReady };
  const has = (set, id) => !!set && set.has(id);

  // Which sessions are candidates: open ones always, closed ones when asked for or searched.
  const candidates = sessions.filter(session => {
    const id = session.sessionId;
    if (has(ctx.excludeIds, id) || has(ctx.leftOut, id)) return false;
    if (searching && !ctx.searchIds.has(id)) return false;
    if (ctx.isOpen(id)) return true;
    if (!prefs.includeClosed && !searching) return false;
    return !session.archived || prefs.showArchived || searching;
  });

  // The filters.
  const { clis, period, place } = prefs.filters;
  const filtered = filterSessionsByPrefs(candidates, prefs.filters, probes).filter(session => {
    if (clis.length > 0 && !clis.includes(overviewCliOf(session))) return false;
    if (period !== 'any' && !passesPeriod(ctx.timeOf(session), period, ctx.now)) return false;
    if (place?.kind === 'folder' && ctx.folderOf(session).key !== place.path) return false;
    if (place?.kind === 'project' && ctx.projectOf(session)?.id !== place.id) return false;
    return true;
  });

  const cards = filtered.map(session => {
    const id = session.sessionId;
    const folder = ctx.folderOf(session);
    return {
      id,
      session,
      live: !!ctx.isOpen(id),
      state: liveStateOf(id, probes),
      sortTime: ctx.timeOf(session),
      pinned: !!session.starred,
      running: !!ctx.isRunning(id),
      earlier: 0,
      // What the "Folder or project" sort reads.
      placeLabel: ctx.projectOf(session)?.name || folder.label,
    };
  });
  const total = cards.length;
  const running = cards.filter(card => card.running).length;

  // Closed sessions sharing a slug: the latest stays, the others count as "earlier".
  const latestBySlug = new Map();
  for (const card of cards) {
    const slug = card.session.slug;
    if (card.live || !slug) continue;
    const latest = latestBySlug.get(slug);
    if (!latest || card.sortTime > latest.sortTime) latestBySlug.set(slug, card);
  }
  const shown = [];
  for (const card of cards) {
    const slug = card.session.slug;
    if (card.live || !slug) { shown.push(card); continue; }
    const latest = latestBySlug.get(slug);
    if (card === latest) shown.push(card);
    else latest.earlier++;
  }

  // Groups, in the order of their first card (by the sort) unless the kind has a fixed order.
  const byKey = new Map();
  for (const card of orderCards(shown, { sort: prefs.sort, resort: true })) {
    const described = overviewGroupOf(prefs.group.by, card, ctx);
    if (!byKey.has(described.key)) byKey.set(described.key, { ...described, cards: [], older: [] });
    byKey.get(described.key).cards.push(card);
  }
  let groups = [...byKey.values()];
  const fixed = { period: OVERVIEW_PERIOD_BUCKETS, status: OVERVIEW_STATUS_BUCKETS }[prefs.group.by];
  if (fixed) {
    const rank = group => fixed.findIndex(([key]) => key === group.key);
    groups.sort((a, b) => rank(a) - rank(b));
  } else {
    // Groups ordered by their first card keep the places of the last render
    // until a re-sort, as cards do: known ones in their old order, new ones on
    // top, the one with the newest first card first.
    if (!ctx.resort && ctx.previousGroups) {
      const position = new Map(ctx.previousGroups.map((key, i) => [key, i]));
      const newest = group => group.cards[0].sortTime;
      groups.sort((a, b) => {
        const aPos = position.get(a.key);
        const bPos = position.get(b.key);
        if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
        if (aPos === undefined && bPos !== undefined) return -1;
        if (aPos !== undefined && bPos === undefined) return 1;
        return newest(b) - newest(a);
      });
    }
    // "No project" stays last.
    groups = [...groups.filter(g => g.key !== OVERVIEW_NO_PROJECT_KEY), ...groups.filter(g => g.key === OVERVIEW_NO_PROJECT_KEY)];
  }

  // Per group: the order of its cards, then the closed ones cut down to the limits.
  const showAllByFilter = searching || overviewFiltersActive(prefs);
  for (const group of groups) {
    const ordered = orderCards(group.cards, { sort: prefs.sort, resort: ctx.resort, previousIds: ctx.previousOrder?.get(group.key) });
    const closed = ordered.filter(card => !card.live);
    const hasOpen = closed.length < ordered.length;
    const showAll = showAllByFilter || has(ctx.expanded, group.key);
    // truncateRenderItems shows a list's older rows when it shows none, and
    // counts running rows against visibleCount. Open cards are neither held
    // back nor spend closed places, so with some a running stand-in goes first.
    const standIn = { running: true, pinned: true, sortTime: ctx.now };
    const result = truncateRenderItems(hasOpen ? [standIn, ...closed] : closed, {
      showAll,
      visibleCount: ctx.visibleCount + (hasOpen ? 1 : 0),
      maxAgeDays: ctx.maxAgeDays,
      now: ctx.now,
    });
    const visible = new Set(result.visible);
    group.cards = ordered.filter(card => card.live || visible.has(card));
    group.older = result.older;
  }
  return { groups, total, running };
}

// ---- Geometry ----

/**
 * The grid of a layout in a space: columns and rows, the card size, and how many
 * cards a page holds. Only `grid-fit` pages (a screenful of cols x rows); the
 * others scroll, so they are one page. Sizes are whole pixels.
 */
function layoutGeometry(layout, { width, height, count, gap = 14 }) {
  const across = n => Math.floor((width - gap * (n - 1)) / n);
  const down = n => Math.floor((height - gap * (n - 1)) / n);
  const all = Math.max(count, 1);
  switch (layout.mode) {
    case 'grid-down':
      return { cols: layout.cols, rows: Math.ceil(all / layout.cols), perPage: all, pages: 1, cardWidth: across(layout.cols), cardHeight: layout.cardHeight };
    case 'grid-across':
      return { cols: Math.ceil(all / layout.rows), rows: layout.rows, perPage: all, pages: 1, cardWidth: layout.cardWidth, cardHeight: down(layout.rows) };
    case 'rows':
      return { cols: 1, rows: all, perPage: all, pages: 1, cardWidth: width, cardHeight: layout.cardHeight };
    case 'columns':
      return { cols: all, rows: 1, perPage: all, pages: 1, cardWidth: layout.cardWidth, cardHeight: height };
    default: {
      const perPage = layout.cols * layout.rows;
      return { cols: layout.cols, rows: layout.rows, perPage, pages: Math.max(1, Math.ceil(count / perPage)), cardWidth: across(layout.cols), cardHeight: down(layout.rows) };
    }
  }
}

/** The cards of page `page` (counted from 0) when each page holds `perPage`. */
function pageSlice(items, page, perPage) {
  const start = Math.max(0, page) * perPage;
  return items.slice(start, start + perPage);
}

// ---- Lifecycle ----

/**
 * Whether the overview page is on screen. `open` mounts it. `close(reason)`
 * unmounts it once; it is ignored when already closed and while mounting, since
 * mounting itself can switch tabs and ask for a close that must not take effect.
 */
function createOverviewLifecycle({ mount, unmount }) {
  let open = false;
  let opening = false;
  return {
    open() {
      open = true;
      opening = true;
      try { mount(); } finally { opening = false; }
    },
    close(reason) {
      if (opening || !open) return;
      open = false;
      unmount(reason);
    },
    isOpen: () => open,
  };
}
