// The editor's right-click menu, as VS Code's: going to a symbol or a line,
// finding, every occurrence, the clipboard, and (in an editable editor)
// comments, the commands on lines and on case; folding everything; and the
// editor's preferences (minimap, sticky scroll, whitespace, Vim). A right-click outside the selection moves the cursor
// there first.
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { toggleComment, toggleBlockComment } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import { showEditorMenu } from './menu.mjs';
import { openSearch, openGotoLine } from './find.mjs';
import { openSymbolPicker } from './symbols.mjs';
import { selectAllOccurrences } from './cursors.mjs';
import {
  sortLinesAscending, sortLinesDescending, deleteDuplicateLines, trimTrailingWhitespace, joinLines,
  upperCase, lowerCase, toTitleCase,
} from './text-commands.mjs';
import { PREFS, readPref, togglePref, editorContext } from './prefs.mjs';
import { goToDefinition, renameSymbol, linkOf } from './lsp-hook.mjs';
import { formatDocument, formatSelection } from './format.mjs';

/** The preferences at the foot of the menu, with a tick when on, in this order. */
const MENU_PREFS = ['minimap', 'stickyScroll', 'whitespace', 'vim'];

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A key as the menu shows it: ⌘⇧O on macOS, Ctrl+Shift+O elsewhere. */
function keyHint(mac, other) {
  return isMac() ? mac : other;
}

function selectedText(view) {
  const { state } = view;
  return state.selection.ranges.filter(r => !r.empty).map(r => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
}

async function writeClipboard(text) {
  if (window.api && typeof window.api.writeClipboard === 'function') return window.api.writeClipboard(text);
  return navigator.clipboard.writeText(text);
}

async function paste(view) {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { return; }
  if (!text) return;
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
  view.focus();
}

function cut(view) {
  const text = selectedText(view);
  if (!text) return;
  writeClipboard(text);
  view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
  view.focus();
}

function menuItems(view) {
  const editable = view.state.facet(EditorView.editable) && !view.state.readOnly;
  const hasSelection = view.state.selection.ranges.some(r => !r.empty);
  const run = command => () => { command(view); view.focus(); };
  const onDisk = !!view.state.facet(editorContext).file;
  const link = linkOf(view);
  const canRename = editable && !!(link && link.connection && link.connection.canRename());
  const items = [
    onDisk ? { label: 'Go to Definition', hint: 'F12', run: () => goToDefinition(view) } : null,
    canRename ? { label: 'Rename Symbol', hint: 'F2', run: () => renameSymbol(view) } : null,
    { label: 'Go to Symbol…', hint: keyHint('⇧⌘O', 'Ctrl+Shift+O'), run: () => openSymbolPicker(view) },
    { label: 'Go to Line…', hint: 'Ctrl+G', run: () => openGotoLine(view) },
    { sep: true },
    { label: 'Find', hint: keyHint('⌘F', 'Ctrl+F'), run: () => openSearch(view) },
    editable ? { label: 'Replace', hint: keyHint('⌥⌘F', 'Ctrl+H'), run: () => openSearch(view, { replace: true }) } : null,
    { label: 'Change All Occurrences', hint: keyHint('⇧⌘L', 'Ctrl+Shift+L'), run: run(selectAllOccurrences) },
    { sep: true },
    editable ? { label: 'Cut', hint: keyHint('⌘X', 'Ctrl+X'), disabled: !hasSelection, run: () => cut(view) } : null,
    { label: 'Copy', hint: keyHint('⌘C', 'Ctrl+C'), disabled: !hasSelection, run: () => { writeClipboard(selectedText(view)); view.focus(); } },
    editable ? { label: 'Paste', hint: keyHint('⌘V', 'Ctrl+V'), run: () => paste(view) } : null,
  ];
  if (editable) {
    items.push(
      { sep: true },
      { label: 'Format Document', hint: keyHint('⇧⌥F', 'Shift+Alt+F'), run: () => formatDocument(view) },
      { label: 'Format Selection', hint: keyHint('⌘K ⌘F', 'Ctrl+K Ctrl+F'), run: () => formatSelection(view) },
      { sep: true },
      { label: 'Toggle Line Comment', hint: keyHint('⌘/', 'Ctrl+/'), run: run(toggleComment) },
      { label: 'Toggle Block Comment', hint: keyHint('⇧⌥A', 'Shift+Alt+A'), run: run(toggleBlockComment) },
      { sep: true },
      { label: 'Sort Lines Ascending', run: run(sortLinesAscending) },
      { label: 'Sort Lines Descending', run: run(sortLinesDescending) },
      { label: 'Delete Duplicate Lines', run: run(deleteDuplicateLines) },
      { label: 'Join Lines', hint: isMac() ? '⌃J' : '', run: run(joinLines) },
      { label: 'Trim Trailing Whitespace', hint: keyHint('⌘K ⌘X', 'Ctrl+K Ctrl+X'), run: run(trimTrailingWhitespace) },
      { sep: true },
      { label: 'Transform to Uppercase', run: run(upperCase) },
      { label: 'Transform to Lowercase', run: run(lowerCase) },
      { label: 'Transform to Title Case', run: run(toTitleCase) },
    );
  }
  items.push(
    { sep: true },
    { label: 'Fold All', hint: keyHint('⌘K ⌘0', 'Ctrl+K Ctrl+0'), run: run(foldAll) },
    { label: 'Unfold All', hint: keyHint('⌘K ⌘J', 'Ctrl+K Ctrl+J'), run: run(unfoldAll) },
    { sep: true },
    ...MENU_PREFS.filter(name => PREFS.has(name)).map(name => ({ label: PREFS.get(name).label, checked: readPref(name), run: () => togglePref(name) })),
  );
  return items;
}

const editorContextMenu = EditorView.domEventHandlers({
  contextmenu(event, view) {
    event.preventDefault();
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null && !view.state.selection.ranges.some(r => r.from <= pos && pos <= r.to)) {
      view.dispatch({ selection: EditorSelection.cursor(pos) });
    }
    view.focus();
    showEditorMenu(menuItems(view), { x: event.clientX, y: event.clientY });
    return true;
  },
});

export { editorContextMenu, menuItems };
