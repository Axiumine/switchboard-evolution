// Several cursors, as in VS Code and in the desktop's editors (the same keys
// as public/codemirror-setup.js there): with a hardware keyboard, Cmd/Ctrl+D
// adds the next occurrence of the selection, Cmd/Ctrl+Shift+L all of them,
// Shift+Alt+I a cursor at the end of every selected line, Cmd/Ctrl+L selects
// the line, Shift+Alt+Cmd+Arrows (Ctrl+Shift+Alt elsewhere) and PageUp/PageDown
// select a column; defaultKeymap and historyKeymap have Cmd+Alt+Up/Down (Ctrl+Alt
// elsewhere) for a cursor above or below, Esc for one cursor and Cmd/Ctrl+U
// to undo the last one. On a touch screen the bar over the keyboard
// (src/components/files/CursorBar.tsx) calls CURSOR_ACTIONS through sb.cursors.

import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { EditorState, EditorSelection, StateField, StateEffect, countColumn, findColumn } from '@codemirror/state';
import { addCursorAbove, addCursorBelow, selectLine, simplifySelection } from '@codemirror/commands';
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';

/** Shift+Alt+I: a cursor at the end of every line a selection covers. */
export function addCursorsAtLineEnds({ state, dispatch }) {
  if (state.selection.ranges.every((range) => range.empty)) return false;
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
export function selectAllOccurrences(target) {
  if (target.state.selection.main.empty && !selectNextOccurrence(target)) return false;
  return selectSelectionMatches(target);
}

// ── Column selection from the keyboard, as VS Code's (and the desktop's, public/editor/cursors.mjs) ──
// Each key grows a box from where the selection was by a line or a column;
// every line in it gets a cursor (at its end when it is shorter), or a
// selection once the box is wider. Any other change of the selection ends it.

const setColumnBox = StateEffect.define();

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

function currentBox(state) {
  const box = state.field(columnBox, false);
  if (box) return box;
  const { anchor, head } = state.selection.main;
  const a = lineAndColumn(state, anchor);
  const h = lineAndColumn(state, head);
  return { anchorLine: a.line, anchorCol: a.col, headLine: h.line, headCol: h.col };
}

function boxSelection(state, box) {
  const ranges = [];
  const step = box.headLine >= box.anchorLine ? 1 : -1;
  for (let n = box.anchorLine; ; n += step) {
    const line = state.doc.line(n);
    const at = (col) => line.from + findColumn(line.text, col, state.tabSize);
    ranges.push(EditorSelection.range(at(box.anchorCol), at(box.headCol)));
    if (n === box.headLine) break;
  }
  return EditorSelection.create(ranges, ranges.length - 1);
}

function widestColumn(state, fromLine, toLine) {
  let widest = 0;
  for (let n = Math.min(fromLine, toLine); n <= Math.max(fromLine, toLine); n++) {
    widest = Math.max(widest, countColumn(state.doc.line(n).text, state.tabSize));
  }
  return widest;
}

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

export const columnSelectUp = columnSelect(-1, 0);
export const columnSelectDown = columnSelect(1, 0);
export const columnSelectLeft = columnSelect(0, -1);
export const columnSelectRight = columnSelect(0, 1);
export const columnSelectPageUp = columnSelect((target) => -pageLines(target), 0);
export const columnSelectPageDown = columnSelect((target) => pageLines(target), 0);

/** What the bar over the keyboard can ask for. */
export const CURSOR_ACTIONS = {
  next: selectNextOccurrence,
  all: selectAllOccurrences,
  above: addCursorAbove,
  below: addCursorBelow,
  one: simplifySelection,
};

/** Several cursors and selections, drawn, with VS Code's keys. */
export function multipleCursors() {
  return [
    EditorState.allowMultipleSelections.of(true),
    columnBox,
    drawSelection(),
    keymap.of([
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-Shift-l', run: selectAllOccurrences, preventDefault: true },
      { key: 'Mod-l', run: selectLine, preventDefault: true },
      { key: 'Mod-Shift-Alt-ArrowUp', run: columnSelectUp, preventDefault: true },
      { key: 'Mod-Shift-Alt-ArrowDown', run: columnSelectDown, preventDefault: true },
      { key: 'Mod-Shift-Alt-ArrowLeft', run: columnSelectLeft, preventDefault: true },
      { key: 'Mod-Shift-Alt-ArrowRight', run: columnSelectRight, preventDefault: true },
      { key: 'Mod-Shift-Alt-PageUp', run: columnSelectPageUp, preventDefault: true },
      { key: 'Mod-Shift-Alt-PageDown', run: columnSelectPageDown, preventDefault: true },
    ]),
    // Shift+Alt+I by its key, not its character: on a Mac keyboard it types ˆ,
    // and CodeMirror leaves Alt combinations there to the keyboard.
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.code !== 'KeyI' || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return false;
        if (!addCursorsAtLineEnds(view)) return false;
        event.preventDefault();
        return true;
      },
    }),
  ];
}
