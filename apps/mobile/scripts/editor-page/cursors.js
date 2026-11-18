// Several cursors, as in VS Code and in the desktop's editors (the same keys
// as public/codemirror-setup.js there): with a hardware keyboard, Cmd/Ctrl+D
// adds the next occurrence of the selection, Cmd/Ctrl+Shift+L all of them,
// Shift+Alt+I a cursor at the end of every selected line, Cmd/Ctrl+L selects
// the line; defaultKeymap and historyKeymap have Cmd+Alt+Up/Down (Ctrl+Alt
// elsewhere) for a cursor above or below, Esc for one cursor and Cmd/Ctrl+U
// to undo the last one. On a touch screen the bar over the keyboard
// (src/components/files/CursorBar.tsx) calls CURSOR_ACTIONS through sb.cursors.

import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
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
    drawSelection(),
    keymap.of([
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-Shift-l', run: selectAllOccurrences, preventDefault: true },
      { key: 'Mod-l', run: selectLine, preventDefault: true },
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
