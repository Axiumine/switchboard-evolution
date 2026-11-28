// --- Session Overview: the cards of closed sessions ---
// With "Include closed" on, or while a search is on, the Session Overview
// (session-overview.js) shows closed sessions too, as light cards with no
// terminal, drawn here. session-overview-model.js says which ones, in which
// order and which are held back.
//
// A closed card has a grey dot, the session's name, its folder, project and
// CLI chips, its last message, how many messages it has and when it was last
// active, and two buttons: Resume, which opens the session inside the page,
// where its card turns live in the same place, and ⋯, the session's menu. A card
// standing for several closed sessions of one conversation (one slug) lists the
// earlier ones under "+n earlier", each of which resumes that session. A group
// whose closed cards were cut down to the limits ends with a "+ N older" card,
// which shows them all (overviewExpanded, kept until the app quits, never saved).
//
// Closed cards are never in gridCards: the code that keeps the live cards up to
// date (running dot, Stop, destroySession) never finds them. The keys reach them
// (Cmd/Ctrl+Arrows, Cmd/Ctrl+Shift+[ ]): one takes the keyboard focus, and Enter
// resumes it.
//
// The last message comes from window.api.getSessionPreviews, asked only for the
// cards in view (an IntersectionObserver), a batch at a time, and kept until the
// session's `modified` changes. An empty text means the index has not read the
// session yet: the card shows no preview and asks again a while later.
//
// session-overview.js calls drawOverviewClosedCard and pruneOverviewClosedCards
// while it draws, overviewClosedCardOf and focusOverviewClosedCard for the keys,
// unmountOverviewClosedCards when the page closes, and reads overviewExpanded,
// all through typeof guards.
//
// Depends on: ovState, overviewAdopt, isSessionOverviewOpen,
// refreshSessionOverview, fillOverviewCardHeader (session-overview.js);
// OVERVIEW_CLI_LABELS, overviewCliOf (session-overview-model.js); openSession,
// sessionMap, sessionEventTime (app.js); sessionTitle,
// sessionMenuItems, showContextMenu, PICONS (projects-view.js); formatDate
// (utils.js). Nothing here runs before the page opens.

const OVC_PREVIEW_BATCH = 40; // ids per getSessionPreviews call
const OVC_PREVIEW_DELAY_MS = 60; // cards coming into view together go in one batch
const OVC_EMPTY_RETRY_MS = 60000; // a session the index has not read yet is asked again after this

// The groups showing every closed card ("+ N older"), by key. Not saved.
const overviewExpanded = new Set();

const ovClosed = {
  cards: new Map(), // session id -> { el, card }: its closed card while drawn, and the model's card
  olderCards: new Map(), // group key -> its "+ N older" card while drawn
  previews: new Map(), // session id -> { modified, text, at }: what getSessionPreviews said
  asking: new Set(), // ids asked for and not answered yet
  queue: new Map(), // id -> modified: cards in view waiting for the next batch
  inView: new Set(), // ids of the closed cards on screen (the observer says)
  resuming: new Set(), // ids whose Resume is under way
  observer: null, // IntersectionObserver over the closed cards, while the page is open
  timer: 0,
};

// ---- Labels ----

function overviewOlderLabel(count) {
  return `+ ${count} older`;
}

function overviewEarlierLabel(count) {
  return `+${count} earlier`;
}

function overviewMessagesLabel(count) {
  return `${count} message${count === 1 ? '' : 's'}`;
}

// ---- Previews ----

/** The last message to show on a session's card, or null: none known, none yet, or kept from before its `modified` changed. */
function closedPreviewText(previews, session) {
  const kept = previews.get(session.sessionId);
  return kept && kept.modified === session.modified && kept.text ? kept.text : null;
}

/** Whether to ask for a session's preview: none kept for its `modified`, or "none yet" said long enough ago. */
function closedPreviewWanted(previews, session, now) {
  const kept = previews.get(session.sessionId);
  if (!kept || kept.modified !== session.modified) return true;
  return !kept.text && now - kept.at >= OVC_EMPTY_RETRY_MS;
}

/**
 * Keep what getSessionPreviews said for the sessions asked (`asked`: { id,
 * modified }). No text, or an empty one, is "no preview yet" (the index has
 * not read the session): kept as that, with the time, so it is asked again later.
 */
function keepClosedPreviews(previews, asked, answer, now) {
  for (const { id, modified } of asked) {
    const text = answer && typeof answer[id] === 'string' ? answer[id] : '';
    previews.set(id, { modified, text, at: now });
  }
}

/** Ask for a closed card's preview with the next batch, unless one is kept or already asked for. */
function wantClosedPreview(session) {
  const id = session.sessionId;
  if (ovClosed.asking.has(id) || !closedPreviewWanted(ovClosed.previews, session, Date.now())) return;
  ovClosed.queue.set(id, session.modified);
  if (!ovClosed.timer) ovClosed.timer = setTimeout(flushClosedPreviews, OVC_PREVIEW_DELAY_MS);
}

/** Ask getSessionPreviews for the queued sessions, OVC_PREVIEW_BATCH at a time, and fill their cards as each batch comes back. */
async function flushClosedPreviews() {
  ovClosed.timer = 0;
  const asked = [...ovClosed.queue].map(([id, modified]) => ({ id, modified }));
  ovClosed.queue.clear();
  const api = typeof window !== 'undefined' ? window.api : null;
  if (asked.length === 0 || typeof api?.getSessionPreviews !== 'function') return;
  for (const { id } of asked) ovClosed.asking.add(id);
  for (let i = 0; i < asked.length; i += OVC_PREVIEW_BATCH) {
    const batch = asked.slice(i, i + OVC_PREVIEW_BATCH);
    let answer = null;
    try { answer = await api.getSessionPreviews(batch.map(item => item.id)); } catch {}
    keepClosedPreviews(ovClosed.previews, batch, answer, Date.now());
    for (const { id } of batch) {
      ovClosed.asking.delete(id);
      const drawn = ovClosed.cards.get(id);
      if (drawn) fillClosedPreview(drawn.el, drawn.card.session);
    }
  }
}

function fillClosedPreview(el, session) {
  const text = closedPreviewText(ovClosed.previews, session);
  const textEl = el.querySelector('.ov-preview-text');
  textEl.textContent = text || '';
  textEl.hidden = !text;
}

function onClosedCardsSeen(entries) {
  for (const entry of entries) {
    const id = entry.target.dataset.sessionId;
    if (!entry.isIntersecting) { ovClosed.inView.delete(id); continue; }
    ovClosed.inView.add(id);
    const drawn = ovClosed.cards.get(id);
    if (drawn) wantClosedPreview(drawn.card.session);
  }
}

// ---- Drawing ----

/** The element of a closed card, or of a group's "+ N older" card (`kind: 'older'`), up to date. */
function drawOverviewClosedCard(card, prefs) {
  if (card.kind === 'older') return drawOverviewOlderCard(card);
  let drawn = ovClosed.cards.get(card.id);
  if (!drawn) {
    drawn = { el: buildOverviewClosedCard(card.id), card };
    ovClosed.cards.set(card.id, drawn);
    if (typeof IntersectionObserver === 'function') {
      ovClosed.observer ||= new IntersectionObserver(onClosedCardsSeen);
      ovClosed.observer.observe(drawn.el);
    }
  }
  drawn.card = card;
  const { el } = drawn;
  const session = card.session;
  el.classList.toggle('archived', !!session.archived);
  fillOverviewCardHeader(el, session, prefs);
  const cli = el.querySelector('.ov-chip-cli');
  cli.textContent = OVERVIEW_CLI_LABELS[overviewCliOf(session)] || '';
  cli.hidden = prefs.group.by === 'cli';
  fillClosedPreview(el, session);
  el.querySelector('.ov-preview-count').textContent = session.messageCount > 0 ? overviewMessagesLabel(session.messageCount) : '';
  el.querySelector('.ov-preview-time').textContent = formatDate(new Date(card.sortTime || Date.parse(session.modified)));
  const earlier = el.querySelector('.ov-earlier-btn');
  earlier.hidden = !(card.earlier > 0);
  earlier.textContent = overviewEarlierLabel(card.earlier);
  el.querySelector('.ov-resume-btn').disabled = ovClosed.resuming.has(card.id);
  // In view already (a render after its `modified` changed): ask again.
  if (ovClosed.inView.has(card.id)) wantClosedPreview(session);
  return el;
}

function buildOverviewClosedCard(id) {
  const latest = () => ovClosed.cards.get(id)?.card;
  const sessionOf = () => sessionMap.get(id) || latest()?.session;

  const el = document.createElement('div');
  el.className = 'grid-card ov-card closed';
  el.dataset.sessionId = id;
  el.tabIndex = -1;

  const span = className => Object.assign(document.createElement('span'), { className });
  const header = document.createElement('div');
  header.className = 'grid-card-header ov-card-header';
  header.append(span('grid-card-dot stopped'), span('grid-card-name'), span('ov-chip ov-chip-folder'),
    span('ov-chip ov-chip-project'), span('ov-chip ov-chip-cli'), span('ov-card-spacer'));

  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'ov-resume-btn';
  resume.title = 'Resume this session here';
  resume.innerHTML = `${PICONS.play(10)}<span>Resume</span>`;
  resume.addEventListener('click', e => { e.stopPropagation(); resumeOverviewSession(id); });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'ov-btn ov-btn-more';
  more.title = 'More';
  more.setAttribute('aria-label', 'More');
  more.innerHTML = PICONS.dots(12);
  more.addEventListener('click', e => {
    e.stopPropagation();
    showContextMenu(overviewClosedMenuItems(sessionOf()), { anchor: more });
  });
  header.append(resume, more);

  const preview = document.createElement('div');
  preview.className = 'ov-preview';
  const text = span('ov-preview-text');
  text.hidden = true;
  const meta = document.createElement('div');
  meta.className = 'ov-preview-meta';
  const earlier = document.createElement('button');
  earlier.type = 'button';
  earlier.className = 'ov-earlier-btn';
  earlier.title = 'Earlier sessions of this conversation';
  earlier.hidden = true;
  earlier.addEventListener('click', e => {
    e.stopPropagation();
    showContextMenu(overviewEarlierMenuItems(latest()), { anchor: earlier });
  });
  meta.append(span('ov-preview-count'), span('ov-preview-time'), earlier);
  preview.append(text, meta);
  el.append(header, preview);

  // The card takes the keys when clicked; a live card's stops looking focused.
  el.addEventListener('focusin', () => {
    for (const card of ovState.cards.values()) card.classList.remove('focused');
  });
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target !== el) return;
    e.preventDefault();
    resumeOverviewSession(id);
  });
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(overviewClosedMenuItems(sessionOf()), { x: e.clientX, y: e.clientY });
  });
  return el;
}

function drawOverviewOlderCard(card) {
  let el = ovClosed.olderCards.get(card.groupKey);
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'ov-older-card';
    el.title = 'Show the older closed sessions of this group';
    el.addEventListener('click', () => expandOverviewGroup(card.groupKey));
    ovClosed.olderCards.set(card.groupKey, el);
  }
  el.textContent = overviewOlderLabel(card.count);
  return el;
}

/** "+ N older": the group shows all its closed cards from now on. */
function expandOverviewGroup(key) {
  overviewExpanded.add(key);
  refreshSessionOverview();
}

/** After a render: the cards it did not draw (`used` holds the ones it did) go, and stop being watched. */
function pruneOverviewClosedCards(used) {
  for (const [id, drawn] of [...ovClosed.cards]) {
    if (used.has(drawn.el)) continue;
    ovClosed.observer?.unobserve(drawn.el);
    ovClosed.inView.delete(id);
    drawn.el.remove();
    ovClosed.cards.delete(id);
  }
  for (const [key, el] of [...ovClosed.olderCards]) {
    if (used.has(el)) continue;
    el.remove();
    ovClosed.olderCards.delete(key);
  }
}

/** The page closed: nothing is watched or waited for. The previews stay. */
function unmountOverviewClosedCards() {
  ovClosed.observer?.disconnect();
  ovClosed.observer = null;
  clearTimeout(ovClosed.timer);
  ovClosed.timer = 0;
  ovClosed.queue.clear();
  ovClosed.inView.clear();
  ovClosed.cards.clear();
  ovClosed.olderCards.clear();
}

// ---- Keys ----

/** A closed session's card on the page, or null. */
function overviewClosedCardOf(id) {
  const el = ovClosed.cards.get(id)?.el;
  return el && ovState.root?.contains(el) ? el : null;
}

/** Give a closed card the keyboard focus. */
function focusOverviewClosedCard(id) {
  const el = overviewClosedCardOf(id);
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

// ---- Resume and menus ----

/**
 * Open a closed session inside the page: adopted, its showSession focuses its
 * card here instead of leaving, and its live card takes the closed card's place.
 */
function resumeOverviewSession(id) {
  const session = sessionMap.get(id) || ovClosed.cards.get(id)?.card.session;
  if (!session || !isSessionOverviewOpen() || ovClosed.resuming.has(id)) return;
  ovClosed.resuming.add(id);
  ovClosed.cards.get(id)?.el.querySelector('.ov-resume-btn')?.setAttribute('disabled', '');
  overviewAdopt(id);
  Promise.resolve(openSession(session)).catch(() => {}).finally(() => {
    // Shown by now if it opened; not opened (an archived one left archived), it must not stay adopted.
    ovState.adopted.delete(id);
    ovClosed.resuming.delete(id);
    const button = ovClosed.cards.get(id)?.el.querySelector('.ov-resume-btn');
    if (button) button.disabled = false;
  });
}

/** The menu of a closed card (⋯ and right click): Resume, then the session's own. */
function overviewClosedMenuItems(session) {
  const id = session?.sessionId;
  if (!id) return [];
  return [
    { label: 'Resume', icon: PICONS.play(13), onClick: () => resumeOverviewSession(id) },
    { sep: true },
    ...(typeof sessionMenuItems === 'function' ? sessionMenuItems(session) : []),
  ];
}

/** "+n earlier": the other closed sessions of the card's slug, newest first, each resumed here. */
function overviewEarlierMenuItems(card) {
  return (card?.earlierIds || [])
    .map(id => sessionMap.get(id))
    .filter(Boolean)
    .map(session => ({
      label: sessionTitle(session),
      hint: formatDate(new Date(sessionEventTime(session))),
      icon: PICONS.play(13),
      onClick: () => resumeOverviewSession(session.sessionId),
    }));
}
