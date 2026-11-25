// Several cursors and selections, with VS Code's mouse gestures and keys.
import { EditorView, keymap, drawSelection, rectangularSelection } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { selectLine, simplifySelection, addCursorAbove, addCursorBelow } from '@codemirror/commands';
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';

// ── Multiple cursors, as in VS Code ─────────────────────────────────
// Alt+click adds a cursor, Shift+Alt+drag selects a column, Cmd/Ctrl+D adds
// the next occurrence of the selection, Cmd/Ctrl+Shift+L all of them (of
// the word under the cursor when nothing is selected),
// Shift+Alt+I a cursor at the end of every selected line, Cmd/Ctrl+L selects
// the line. defaultKeymap and historyKeymap already have the rest with VS
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

const multiCursorKeymap = [
  // Also in defaultKeymap: here for the viewers, which do not have it.
  { key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
  { key: 'Mod-Alt-ArrowDown', run: addCursorBelow, preventDefault: true },
  { key: 'Escape', run: backToOneCursor },
  { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
  { key: 'Mod-Shift-l', run: selectAllOccurrences, preventDefault: true },
  { key: 'Mod-l', run: selectLine, preventDefault: true },
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
    drawSelection(),
    EditorView.clickAddsSelectionRange.of(event => event.altKey && !event.shiftKey),
    rectangularSelection({ eventFilter: event => event.altKey && event.shiftKey }),
    keymap.of(multiCursorKeymap),
    lineEndsKey,
  ];
}

export { multipleCursors, addCursorsAtLineEnds, selectAllOccurrences, backToOneCursor, multiCursorKeymap };
