// Commands on lines and on the case of text, as VS Code's: sort the lines,
// delete their duplicates, join them, trim the spaces at their ends, and
// upper, lower or title case. Each is a StateCommand ({ state, dispatch }) that
// does nothing (false) in a read-only editor. With a selection of lines they
// take those; with only a cursor, the whole document (sort, duplicates,
// trim) or the word at the cursor (case).
import { EditorSelection } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { foldAll, unfoldAll } from '@codemirror/language';

/** The line numbers [first, last] each selection covers; a selection that ends at a line's start leaves that line out. */
function selectedLineSpans(state) {
  const spans = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (!range.empty && last > first && range.to === state.doc.line(last).from) last -= 1;
    const prev = spans[spans.length - 1];
    if (prev && first <= prev[1] + 1) prev[1] = Math.max(prev[1], last);
    else spans.push([first, last]);
  }
  return spans;
}

/** The spans of lines a command over lines works on: the selected lines, or every line when nothing is selected. */
function lineSpansOrDocument(state) {
  if (state.selection.ranges.every(r => r.empty)) return [[1, state.doc.lines]];
  return selectedLineSpans(state);
}

/**
 * Replace the lines of each span with what `transform` makes of them (an
 * array of lines). Selected lines stay selected; a cursor stays on its line
 * and column.
 */
function replaceLines({ state, dispatch }, spans, transform, userEvent) {
  if (state.readOnly) return false;
  const edits = spans.map(([first, last]) => {
    const lines = [];
    for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text);
    return { from: state.doc.line(first).from, to: state.doc.line(last).to, insert: transform(lines).join(state.lineBreak) };
  });
  const changes = edits.filter(e => e.insert !== state.sliceDoc(e.from, e.to));
  if (!changes.length) return false;
  const changeSet = state.changes(changes);
  let selection;
  if (state.selection.ranges.every(r => r.empty)) {
    const doc = changeSet.apply(state.doc);
    selection = EditorSelection.create(state.selection.ranges.map((r) => {
      const line = state.doc.lineAt(r.head);
      const target = doc.line(Math.min(line.number, doc.lines));
      return EditorSelection.cursor(target.from + Math.min(r.head - line.from, target.length));
    }), state.selection.mainIndex);
  } else {
    selection = EditorSelection.create(edits.map((e) => {
      const from = changeSet.mapPos(e.from, -1);
      return EditorSelection.range(from, from + e.insert.length);
    }));
  }
  dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent }));
  return true;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator() : null;
const compareLines = (a, b) => (collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);

function sortLines(descending) {
  return (target) => {
    const spans = lineSpansOrDocument(target.state).filter(([first, last]) => last > first);
    return replaceLines(target, spans, lines => {
      const sorted = [...lines].sort(compareLines);
      return descending ? sorted.reverse() : sorted;
    }, 'input.sort');
  };
}

const sortLinesAscending = sortLines(false);
const sortLinesDescending = sortLines(true);

/** Delete the lines that repeat an earlier one, in the selected lines or the document. */
function deleteDuplicateLines(target) {
  return replaceLines(target, lineSpansOrDocument(target.state), lines => {
    const seen = new Set();
    return lines.filter(line => (seen.has(line) ? false : (seen.add(line), true)));
  }, 'delete.dedupe');
}

/** Delete the spaces and tabs at the end of every line of the document (or of the selected lines). */
function trimTrailingWhitespace(target) {
  return replaceLines(target, lineSpansOrDocument(target.state), lines => lines.map(line => line.replace(/[ \t]+$/, '')), 'delete.trim');
}

/**
 * Join each selected line with the next (with only a cursor, its line with
 * the next): one space between them, the indentation of the joined line gone.
 */
function joinLines({ state, dispatch }) {
  if (state.readOnly) return false;
  const changes = [];
  for (const [first, selectedLast] of selectedLineSpans(state)) {
    const last = selectedLast > first ? selectedLast : Math.min(first + 1, state.doc.lines);
    for (let n = first; n < last; n++) {
      const line = state.doc.line(n);
      const next = state.doc.line(n + 1);
      const trailing = /[ \t]*$/.exec(line.text)[0].length;
      const leading = /^[ \t]*/.exec(next.text)[0].length;
      const joinsText = line.length - trailing > 0 && next.length - leading > 0;
      changes.push({ from: line.to - trailing, to: next.from + leading, insert: joinsText ? ' ' : '' });
    }
  }
  if (!changes.length) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'delete.join' }));
  return true;
}

/** Each selection's text, or the word at a cursor, through `transform`; the selections stay on the text. */
function transformCase(transform) {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const changes = [];
    const ranges = [];
    // How much the text before this range has grown (ß upper case is SS).
    let delta = 0;
    for (const range of state.selection.ranges) {
      const target = range.empty ? state.wordAt(range.head) : range;
      if (!target) { ranges.push(EditorSelection.cursor(range.head + delta)); continue; }
      const text = state.sliceDoc(target.from, target.to);
      const insert = transform(text);
      const grow = insert.length - text.length;
      if (insert !== text) changes.push({ from: target.from, to: target.to, insert });
      if (range.empty) ranges.push(EditorSelection.cursor(Math.min(range.head + delta, target.to + delta + grow)));
      else {
        const end = pos => pos + delta + (pos === range.to ? grow : 0);
        ranges.push(EditorSelection.range(end(range.anchor), end(range.head)));
      }
      delta += grow;
    }
    if (!changes.length) return false;
    dispatch(state.update({ changes, selection: EditorSelection.create(ranges, state.selection.mainIndex), userEvent: 'input.case' }));
    return true;
  };
}

/** The first letter of every word upper case, the rest left as it is (as VS Code's Title Case). */
function titleCase(text) {
  return text.replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, before, letter) => before + letter.toLocaleUpperCase());
}

const upperCase = transformCase(text => text.toLocaleUpperCase());
const lowerCase = transformCase(text => text.toLocaleLowerCase());
const toTitleCase = transformCase(titleCase);

/**
 * VS Code's keys for these: Ctrl+J joins lines (macOS), Cmd/Ctrl+K then
 * Cmd/Ctrl+X trims the spaces at the ends of lines. The rest are in the
 * editor's menu.
 */
const textCommandsKeymap = keymap.of([
  { mac: 'Ctrl-j', run: joinLines, preventDefault: true },
  { key: 'Mod-k Mod-x', run: trimTrailingWhitespace, preventDefault: true },
]);

/** Cmd/Ctrl+K then Cmd/Ctrl+0 or J folds or unfolds everything, in every editor. */
const foldChordsKeymap = keymap.of([
  { key: 'Mod-k Mod-0', run: foldAll, preventDefault: true },
  { key: 'Mod-k Mod-j', run: unfoldAll, preventDefault: true },
]);

export {
  selectedLineSpans, sortLinesAscending, sortLinesDescending, deleteDuplicateLines, trimTrailingWhitespace,
  joinLines, upperCase, lowerCase, toTitleCase, titleCase, textCommandsKeymap, foldChordsKeymap,
};
