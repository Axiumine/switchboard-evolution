// Several cursors and selections, with VS Code's mouse gestures and keys.
import { EditorView, keymap, drawSelection, rectangularSelection } from '@codemirror/view';
import { EditorState, EditorSelection, StateField, StateEffect, countColumn, findColumn } from '@codemirror/state';
import { selectLine, simplifySelection, addCursorAbove, addCursorBelow } from '@codemirror/commands';
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';

// ── Multiple cursors, as in VS Code ─────────────────────────────────
// Alt+click adds a cursor, Shift+Alt+drag selects a column, Cmd/Ctrl+D adds
// the next occurrence of the selection, Cmd/Ctrl+Shift+L all of them (of
// the word under the cursor when nothing is selected),
// Shift+Alt+I a cursor at the end of every selected line, Cmd/Ctrl+L selects
// the line, Shift+Alt+Cmd+Arrows (Ctrl+Shift+Alt+Arrows elsewhere) and
// PageUp/PageDown select a column from the keyboard. defaultKeymap and historyKeymap already have the rest with VS
// Code's keys: Cmd+Alt+Up/Down (Ctrl+Alt elsewhere) a cursor above or below,
// Esc back to one cursor, Cmd/Ctrl+U the last cursor undone, Alt+Up/Down and
// Shift+Alt+Up/Down move and copy lines, Shift+Cmd+K deletes them, Cmd+/
// comments them, Cmd+[ and Cmd+] indent, Shift+Cmd+\ goes to the matching
// bracket. @replit/codemirror-vscode-keymap is not used: it replaces
// defaultKeymap and would take Cmd+F, Cmd+G and Ctrl+G from the find and
// go-to-line bars (find.mjs, goto-line.mjs). The mobile app's editor has the same (scripts/editor-page/cursors.js).

/** Shift+Alt+I: a cursor at the end of every line a selection covers. */
function addCursorsAtLineEnds({ state, dispatch }) {
  if (state.selection.ranges.every(range => range.empty)) return false;
  const ranges = [];
  for (const range of state.selection.ranges) {
    if (range.empty) { ranges.push(range); continue; }
    const first = state.doc.lineAt(range.from);
    let last = state.doc.lineAt(range.to);
    // A selection that ends at the start of a line does not take that line.
    if (range.to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
    for (let n = first.number; n <= last.number; n++) ranges.push(EditorSelection.cursor(state.doc.line(n).to));
  }
  dispatch(state.update({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true, userEvent: 'select' }));
  return true;
}

/** Every occurrence of the selection; with only a cursor, of the word it is in (as VS Code's Cmd+Shift+L). */
function selectAllOccurrences(view) {
  if (view.state.selection.main.empty && !selectNextOccurrence(view)) return false;
  return selectSelectionMatches(view);
}

/** Esc with several cursors: back to one. With one it does nothing, so Esc still closes what is around a viewer. */
function backToOneCursor(view) {
  return view.state.selection.ranges.length > 1 && simplifySelection(view);
}

// ── Column selection from the keyboard, as VS Code's ────────────────
// Shift+Alt+Cmd+Arrows (Ctrl+Shift+Alt+Arrows on Windows and Linux) and
// PageUp/PageDown grow a box from where the selection was: a line more above
// or below, a column more left or right. Every line in the box gets a cursor,
// or a selection once the box is wider than a column; a shorter line gets its
// cursor at its end. Columns are visual, so tabs line up with spaces. Any other
// change of the selection, or an edit, ends the box: the next key starts anew.

const setColumnBox = StateEffect.define(); // { anchorLine, anchorCol, headLine, headCol }

const columnBox = StateField.define({
  create: () => null,
  update(box, tr) {
    for (const effect of tr.effects) if (effect.is(setColumnBox)) return effect.value;
    return box && !tr.docChanged && !tr.selection ? box : null;
  },
});

function lineAndColumn(state, pos) {
  const line = state.doc.lineAt(pos);
  return { line: line.number, col: countColumn(line.text, state.tabSize, pos - line.from) };
}

/** The box being grown, or a new one from the main selection's anchor and head. */
function currentBox(state) {
  const box = state.field(columnBox, false);
  if (box) return box;
  const { anchor, head } = state.selection.main;
  const a = lineAndColumn(state, anchor);
  const h = lineAndColumn(state, head);
  return { anchorLine: a.line, anchorCol: a.col, headLine: h.line, headCol: h.col };
}

/** A range on each line of the box, from its anchor column to its head column; the head line's is the main one. */
function boxSelection(state, box) {
  const ranges = [];
  const step = box.headLine >= box.anchorLine ? 1 : -1;
  for (let n = box.anchorLine; ; n += step) {
    const line = state.doc.line(n);
    const at = col => line.from + findColumn(line.text, col, state.tabSize);
    ranges.push(EditorSelection.range(at(box.anchorCol), at(box.headCol)));
    if (n === box.headLine) break;
  }
  return EditorSelection.create(ranges, ranges.length - 1);
}

/** The widest line between two lines, in columns: the box goes no further right. */
function widestColumn(state, fromLine, toLine) {
  let widest = 0;
  for (let n = Math.min(fromLine, toLine); n <= Math.max(fromLine, toLine); n++) {
    widest = Math.max(widest, countColumn(state.doc.line(n).text, state.tabSize));
  }
  return widest;
}

/** A page of lines in an editor on screen; 20 for a state without a view. */
function pageLines(target) {
  const height = target.scrollDOM && target.scrollDOM.clientHeight;
  return height && target.defaultLineHeight ? Math.max(1, Math.floor(height / target.defaultLineHeight) - 1) : 20;
}

function columnSelect(lines, cols) {
  return (target) => {
    const { state } = target;
    const box = currentBox(state);
    const down = typeof lines === 'function' ? lines(target) : lines;
    const headLine = Math.max(1, Math.min(state.doc.lines, box.headLine + down));
    const headCol = Math.max(0, Math.min(widestColumn(state, box.anchorLine, headLine), box.headCol + cols));
    const next = { ...box, headLine, headCol };
    target.dispatch(state.update({ selection: boxSelection(state, next), effects: setColumnBox.of(next), scrollIntoView: true, userEvent: 'select' }));
    return true;
  };
}

const columnSelectUp = columnSelect(-1, 0);
const columnSelectDown = columnSelect(1, 0);
const columnSelectLeft = columnSelect(0, -1);
const columnSelectRight = columnSelect(0, 1);
const columnSelectPageUp = columnSelect(target => -pageLines(target), 0);
const columnSelectPageDown = columnSelect(target => pageLines(target), 0);

const multiCursorKeymap = [
  // Also in defaultKeymap: here for the viewers, which do not have it.
  { key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
  { key: 'Mod-Alt-ArrowDown', run: addCursorBelow, preventDefault: true },
  { key: 'Escape', run: backToOneCursor },
  { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
  { key: 'Mod-Shift-l', run: selectAllOccurrences, preventDefault: true },
  { key: 'Mod-l', run: selectLine, preventDefault: true },
  { key: 'Mod-Shift-Alt-ArrowUp', run: columnSelectUp, preventDefault: true },
  { key: 'Mod-Shift-Alt-ArrowDown', run: columnSelectDown, preventDefault: true },
  { key: 'Mod-Shift-Alt-ArrowLeft', run: columnSelectLeft, preventDefault: true },
  { key: 'Mod-Shift-Alt-ArrowRight', run: columnSelectRight, preventDefault: true },
  { key: 'Mod-Shift-Alt-PageUp', run: columnSelectPageUp, preventDefault: true },
  { key: 'Mod-Shift-Alt-PageDown', run: columnSelectPageDown, preventDefault: true },
];

// Shift+Alt+I by its key, not its character: on a Mac it types ˆ, and
// CodeMirror leaves Alt combinations there to the keyboard.
const lineEndsKey = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.code !== 'KeyI' || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return false;
    if (!addCursorsAtLineEnds(view)) return false;
    event.preventDefault();
    return true;
  },
});

/** Several cursors and selections, drawn, with VS Code's mouse gestures and keys. */
function multipleCursors() {
  return [
    EditorState.allowMultipleSelections.of(true),
    columnBox,
    drawSelection(),
    EditorView.clickAddsSelectionRange.of(event => event.altKey && !event.shiftKey),
    rectangularSelection({ eventFilter: event => event.altKey && event.shiftKey }),
    keymap.of(multiCursorKeymap),
    lineEndsKey,
  ];
}

export {
  multipleCursors, addCursorsAtLineEnds, selectAllOccurrences, backToOneCursor, multiCursorKeymap,
  columnSelectUp, columnSelectDown, columnSelectLeft, columnSelectRight, columnSelectPageUp, columnSelectPageDown,
};
