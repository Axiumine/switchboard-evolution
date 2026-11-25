// Find and replace in the file editor's page, as the desktop's find bar
// (apps/desktop/public/editor/find.mjs): the same query rules, matches,
// next and previous round the end, and replacements ($1, \u \U \l \L,
// Preserve Case), all from the shared text-search.js. The bar itself is
// native (src/components/files/FindBar.tsx); it calls these through
// window.sb (page.js) and hears back { type: 'find', count, current, … }.

import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration } from '@codemirror/view';
import TextSearch from '../../src/shared/vendor/text-search.js';

const setQuery = StateEffect.define(); // { regex, options } | null

/** The query and its matches: null when nothing is searched. */
export const findState = StateField.define({
  create: () => null,
  update(value, tr) {
    let query = value ? { regex: value.regex, options: value.options } : null;
    let set = false;
    for (const e of tr.effects) if (e.is(setQuery)) { query = e.value; set = true; }
    if (!query) return null;
    if (!set && !tr.docChanged) return value;
    return { ...query, matches: TextSearch.findAllMatches(tr.state.doc.toString(), query.regex) };
  },
});

const matchMark = Decoration.mark({ class: 'cm-find-match' });
const activeMark = Decoration.mark({ class: 'cm-find-match cm-find-match-active' });

const highlighter = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged
      || update.state.field(findState) !== update.startState.field(findState)) this.decorations = this.build(update.view);
  }
  build(view) {
    const found = view.state.field(findState);
    if (!found) return Decoration.none;
    const sel = view.state.selection.main;
    const marks = [];
    for (const { from, to } of view.visibleRanges) {
      for (let i = TextSearch.firstMatchAfter(found.matches, from); i < found.matches.length && found.matches[i].from <= to; i++) {
        const m = found.matches[i];
        marks.push((m.from === sel.from && m.to === sel.to ? activeMark : matchMark).range(m.from, m.to));
      }
    }
    return Decoration.set(marks, true);
  }
}, { decorations: (v) => v.decorations });

const theme = EditorView.theme({
  '.cm-find-match': { backgroundColor: '#515C6A', borderRadius: '2px' },
  '.cm-find-match-active': { backgroundColor: '#EAA549', color: '#171717' },
});

/** What the page's editor needs for find and replace. */
export function findExtension() {
  return [findState, highlighter, theme];
}

/** The index of the match the selection is on, or -1. */
function activeIndex(state, matches) {
  const sel = state.selection.main;
  return matches.findIndex((m) => m.from === sel.from && m.to === sel.to);
}

/** What the bar shows: { count, current (1-based, 0 for none), limited }. */
export function findSummary(state) {
  const found = state.field(findState, false);
  if (!found) return { count: 0, current: 0, limited: false };
  return {
    count: found.matches.length,
    current: activeIndex(state, found.matches) + 1,
    limited: found.matches.length >= TextSearch.MATCH_LIMIT,
  };
}

function select(view, match) {
  view.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
}

/**
 * Search `options.query` ({ query, matchCase, wholeWord, isRegex, preserveCase }):
 * the matches marked and the first one from the cursor selected (unless
 * `stay`). Returns the summary, with `error` for a pattern that does not compile.
 */
export function setFind(view, options, { stay = false } = {}) {
  if (!options || !options.query) {
    view.dispatch({ effects: setQuery.of(null) });
    return findSummary(view.state);
  }
  let regex;
  try { regex = TextSearch.documentRegExp(options); } catch (err) {
    view.dispatch({ effects: setQuery.of(null) });
    return { ...findSummary(view.state), error: err.message };
  }
  view.dispatch({ effects: setQuery.of({ regex, options: { ...options } }) });
  const { matches } = view.state.field(findState);
  if (!stay && matches.length && activeIndex(view.state, matches) < 0) {
    const from = view.state.selection.main.from;
    const idx = matches.findIndex((m) => m.from >= from);
    select(view, matches[idx < 0 ? 0 : idx]);
  }
  return findSummary(view.state);
}

/** The next match (`direction` 1) or the previous one (-1), round the end. */
export function findNext(view, direction = 1) {
  const found = view.state.field(findState, false);
  if (!found || !found.matches.length) return findSummary(view.state);
  const sel = view.state.selection.main;
  const idx = TextSearch.nextMatchIndex(found.matches, sel.from, sel.to, direction < 0 ? -1 : 1);
  if (idx >= 0) select(view, found.matches[idx]);
  return findSummary(view.state);
}

/**
 * Replace the selected match with `replace` and go to the next one; when the
 * cursor is not on a match, the first press goes to one (as VS Code). Not in
 * a read-only editor.
 */
export function replaceOne(view, replace) {
  const found = view.state.field(findState, false);
  if (view.state.readOnly) return { ...findSummary(view.state), error: 'read-only' };
  if (!found || !found.matches.length) return findSummary(view.state);
  const idx = activeIndex(view.state, found.matches);
  if (idx < 0) return findNext(view, 1);
  const match = found.matches[idx];
  const insert = TextSearch.documentReplacement(found.regex, found.options, view.state.doc.toString(), match, replace);
  view.dispatch({ changes: { from: match.from, to: match.to, insert }, userEvent: 'input.replace' });
  const after = view.state.field(findState).matches;
  const next = after.findIndex((m) => m.from >= match.from + insert.length);
  if (after.length) select(view, after[next < 0 ? 0 : next]);
  return findSummary(view.state);
}

/** Replace every match in one change (one undo). Returns the summary with `replaced`. */
export function replaceAll(view, replace) {
  const found = view.state.field(findState, false);
  if (view.state.readOnly) return { ...findSummary(view.state), error: 'read-only' };
  if (!found || !found.matches.length) return { ...findSummary(view.state), replaced: 0 };
  const text = view.state.doc.toString();
  const changes = found.matches.map((m) => ({ from: m.from, to: m.to, insert: TextSearch.documentReplacement(found.regex, found.options, text, m, replace) }));
  view.dispatch({ changes, userEvent: 'input.replace.all' });
  return { ...findSummary(view.state), replaced: changes.length };
}
