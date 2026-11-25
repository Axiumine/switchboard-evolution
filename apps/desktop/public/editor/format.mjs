// Format Document (Shift+Alt+F) and Format Selection (Cmd+K Cmd+F, Ctrl+K
// Ctrl+F elsewhere), as VS Code's, in an editable editor.
//
// JSON is formatted here, with jsonc-parser (window.JsoncParser, loaded by
// the pages): the file's indentation and line breaks, its comments kept. A
// file on disk of another language goes to the main process (formatter.js:
// the project's Prettier, else the app's); a language Prettier does not know
// goes to the file's language server when it formats. The change is the
// smallest one that turns the text into the formatted one, one undo step, so
// the cursor stays where it was. Nothing formats on save.
import { EditorView, keymap } from '@codemirror/view';
import { editorContext } from './prefs.mjs';
import { currentIndentation, eolField } from './indentation.mjs';
import { languageNameField } from './languages.mjs';
import { linkOf, flash } from './lsp-hook.mjs';

/** The smallest change from `current` to `next`: the part between their common start and end. */
function minimalChange(current, next) {
  let start = 0;
  const max = Math.min(current.length, next.length);
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--;
    endNext--;
  }
  if (start === endCurrent && start === endNext) return null;
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) };
}

/** `text` (or [from, to) of it) formatted as JSON with jsonc-parser; null when it cannot. */
function formatJson(text, { range = null, insertSpaces = true, size = 2, eol = '\n' } = {}, parser = (typeof window !== 'undefined' && window.JsoncParser) || null) {
  if (!parser) return null;
  const edits = parser.format(text, range ? { offset: range.from, length: range.to - range.from } : undefined, {
    tabSize: size, insertSpaces, eol, insertFinalNewline: /\n$/.test(text),
  });
  return parser.applyEdits(text, edits);
}

function isJson(state, file) {
  const name = state.field(languageNameField, false);
  return name === 'JSON' || /\.(json|jsonc|json5)$/i.test(file || '');
}

/** Put the formatted text in, unless the text changed meanwhile. */
function applyFormatted(view, doc, formatted) {
  if (view.state.doc !== doc) return false;
  const change = minimalChange(doc.toString(), formatted.replace(/\r\n?/g, '\n'));
  if (change) view.dispatch({ changes: change, userEvent: 'format' });
  return true;
}

/** The selection to format: the main one, or its line when it is a cursor. */
function selectedRange(state) {
  const sel = state.selection.main;
  if (!sel.empty) return { from: sel.from, to: sel.to };
  const line = state.doc.lineAt(sel.head);
  return { from: line.from, to: line.to };
}

async function runFormat(view, selectionOnly) {
  const { state } = view;
  const doc = state.doc;
  const context = state.facet(editorContext);
  const indentation = currentIndentation(state);
  const eol = state.field(eolField, false) || '\n';
  const range = selectionOnly ? selectedRange(state) : null;
  const text = doc.toString();

  if (isJson(state, context.file)) {
    let formatted;
    try { formatted = formatJson(text, { range, insertSpaces: indentation.insertSpaces, size: indentation.size, eol: '\n' }); } catch (err) {
      flash(view, `Could not format: ${err.message}`);
      return;
    }
    if (formatted !== null) { applyFormatted(view, doc, formatted); return; }
  }

  let result = { unsupported: true };
  if (context.file && typeof window !== 'undefined' && window.api && window.api.editorFormat) {
    result = (await window.api.editorFormat({ filePath: context.file, text, range, indentation, eol })) || { unsupported: true };
  }
  if (typeof result.formatted === 'string') { applyFormatted(view, doc, result.formatted); return; }
  if (result.ignored || result.error) { flash(view, result.message || 'Could not format'); return; }
  // A language Prettier does not know: the language server's formatting.
  const link = linkOf(view);
  if (link && link.connection && (await link.connection.format(view, range))) return;
  flash(view, `No formatter for ${state.field(languageNameField, false) || 'this file'}`);
}

function formatCommand(selectionOnly) {
  return (view) => {
    if (view.state.readOnly) return false;
    runFormat(view, selectionOnly);
    return true;
  };
}

const formatDocument = formatCommand(false);
const formatSelection = formatCommand(true);

// Shift+Alt+F by its key, not its character: on a Mac Option+Shift+F types Ï,
// and CodeMirror leaves Option combinations there to the keyboard.
const formatKeyByCode = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.code !== 'KeyF' || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return false;
    if (!formatDocument(view)) return false;
    event.preventDefault();
    return true;
  },
});

const formatKeymap = [
  keymap.of([
    { key: 'Shift-Alt-f', run: formatDocument, preventDefault: true },
    { key: 'Mod-k Mod-f', run: formatSelection, preventDefault: true },
  ]),
  formatKeyByCode,
];

export { formatKeymap, formatDocument, formatSelection, formatJson, minimalChange };
