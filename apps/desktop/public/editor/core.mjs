// One editor for every place that shows or edits a file or a piece of code:
// the Files tab, the file window, Plans, Notes, the session's side panel,
// the project's Files tab, the Git tab, Git History, Compare, Actions,
// Knowledge. editorExtensions() is the only list of what an editor has;
// createCodeEditor() makes one, with a diff against an original text in one
// column (merge.layout 'unified') or two ('split').
//
// Every editor: line numbers, the current line, folding, matching brackets,
// the other occurrences of the selection, several cursors, indentation
// guides, find and replace, go to line, go to symbol, the status bar, the
// right-click menu, Cmd/Ctrl+S. An editable one also: undo, indentation on
// typing, closing brackets and quotes, suggestions (the language's and the
// words of the file; in Markdown only with Ctrl+Space, as in VS Code),
// dragging text, and the commands on lines and case.
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars,
  scrollPastEnd, dropCursor,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, standardKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, autocompletion, completeAnyWord, completeFromList, acceptCompletion } from '@codemirror/autocomplete';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { dracula } from '@ddietr/codemirror-themes/theme/dracula';
import { tags } from '@lezer/highlight';
import {
  getLanguageExt, markdownSupport, languageName, languageNameField, languageCompartment,
} from './languages.mjs';
import { multipleCursors } from './cursors.mjs';
import { findSupport, findKeymap, frameKeys } from './find.mjs';
import { symbolKeymap } from './symbols.mjs';
import { textCommandsKeymap, foldChordsKeymap } from './text-commands.mjs';
import {
  detectIndentation, detectEol, eolField, setEol, textOf, normalizeEol, indentCompartment, indentationConfig,
  indentGuides, whitespaceCompartment, whitespaceExtension, whitespaceSync, readShowWhitespace,
} from './indentation.mjs';
import { statusBar } from './status-bar.mjs';
import { editorContextMenu } from './context-menu.mjs';

const markdownExtras = HighlightStyle.define([
  { tag: tags.monospace, color: '#8BE9FD' },
]);

const appThemePatch = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px' },
  '.cm-content': { padding: '20px 8px' },
  '.cm-scroller': {
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255,255,255,0.08) transparent',
  },
}, { dark: true });

// A read-only viewer's text takes the focus (CodeMirror leaves it not
// focusable), so that after a click in it the keys work there, and copying
// takes every selection.
const focusableText = EditorView.contentAttributes.of({ tabindex: '0' });

/** Calls `onChange` after every edit of the text (typing, undo, a reload), not on cursor moves. */
function docChangeListener(onChange) {
  return onChange ? EditorView.updateListener.of((update) => { if (update.docChanged) onChange(update); }) : [];
}

/** The words of the document as suggestions, in every language, next to the language's own. */
const wordCompletions = EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]);

/**
 * The suggestions of every source at the cursor (the language's, then the
 * words of the file) as one list, each name once: a function the language
 * knows is not offered again as a plain word.
 */
async function mergedCompletions(context) {
  const sources = context.state.languageDataAt('autocomplete', context.pos)
    .map(source => (typeof source === 'function' ? source : completeFromList(source)))
    // The words last, so that a name keeps the language's kind and details.
    .sort((a, b) => (a === completeAnyWord) - (b === completeAnyWord));
  const results = (await Promise.all(sources.map(source => Promise.resolve().then(() => source(context)).catch(() => null))))
    .filter(result => result && result.options && result.options.length);
  if (!results.length) return null;
  const from = results[0].from;
  const seen = new Set();
  const options = [];
  for (const result of results) {
    if (result.from !== from) continue;
    for (const option of result.options) {
      if (seen.has(option.label)) continue;
      seen.add(option.label);
      options.push(option);
    }
  }
  return { from, options };
}

/**
 * Everything an editor has. `filename` picks the language (`language`
 * 'markdown' forces Markdown, as the Plans and Notes editors do); `doc` is
 * the text it opens with, for the indentation and line breaks it finds there;
 * `readOnly` leaves out what edits; `statusBar` false leaves out the status
 * bar (a small query box, the original side of a diff); `merge` true for a
 * diff's editors. Returns { extensions, wrapCompartment }.
 */
function editorExtensions({
  filename = '', language = 'auto', doc = '', readOnly = false, wrap = false, onChange = null,
  statusBar: withStatusBar = true, merge = false,
} = {}) {
  const markdownOnly = language === 'markdown';
  const name = markdownOnly ? 'Markdown' : languageName(filename);
  const wrapCompartment = new Compartment();
  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    multipleCursors(),
    indentGuides,
    merge ? [] : scrollPastEnd(),
    languageCompartment.of(markdownOnly ? markdownSupport() : getLanguageExt(filename)),
    languageNameField.init(() => name),
    indentCompartment.of(indentationConfig(detectIndentation(doc))),
    eolField.init(() => detectEol(doc)),
    whitespaceCompartment.of(whitespaceExtension(readShowWhitespace())),
    whitespaceSync,
    findSupport,
    findKeymap(),
    symbolKeymap,
    foldChordsKeymap,
    frameKeys,
    editorContextMenu,
    withStatusBar ? statusBar : [],
    dracula,
    syntaxHighlighting(markdownExtras),
    appThemePatch,
    wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
  ];
  if (readOnly) {
    extensions.push(
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      focusableText,
      // Moving acts on every cursor, as in an editable editor.
      keymap.of([...foldKeymap, ...standardKeymap]),
    );
  } else {
    extensions.push(
      history(),
      indentOnInput(),
      closeBrackets(),
      dropCursor(),
      autocompletion({ activateOnTyping: name !== 'Markdown', maxRenderedOptions: 80, override: [mergedCompletions] }),
      wordCompletions,
      keymap.of([
        ...closeBracketsKeymap,
        { key: 'Tab', run: acceptCompletion },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      textCommandsKeymap,
      docChangeListener(onChange),
    );
  }
  return { extensions, wrapCompartment };
}

const COLLAPSE_UNCHANGED = { margin: 3, minSize: 4 };

/**
 * An editor in `parent` with `doc`. With `merge: { original, layout,
 * mergeControls, collapse }` it shows the changes from `original`: in one
 * column (an EditorView, with accept and reject buttons on each change when
 * `mergeControls`), or in two ('split', a MergeView whose original side is
 * read-only). `collapse` false shows the unchanged lines too.
 */
function createCodeEditor(parent, { doc = '', merge = null, ...options } = {}) {
  const text = String(doc ?? '');
  if (merge && merge.layout === 'split') {
    const original = String(merge.original ?? '');
    const a = editorExtensions({ ...options, doc: original, readOnly: true, statusBar: false, merge: true });
    const b = editorExtensions({ ...options, doc: text, merge: true });
    return new MergeView({
      parent,
      a: { doc: original, extensions: a.extensions },
      b: { doc: text, extensions: b.extensions },
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: merge.collapse === false ? undefined : COLLAPSE_UNCHANGED,
    });
  }
  const { extensions, wrapCompartment } = editorExtensions({ ...options, doc: text, merge: !!merge });
  if (merge) {
    extensions.push(unifiedMergeView({
      original: String(merge.original ?? ''),
      gutter: true,
      highlightChanges: true,
      syntaxHighlightDeletions: true,
      collapseUnchanged: merge.collapse === false ? undefined : COLLAPSE_UNCHANGED,
      mergeControls: !!merge.mergeControls,
    }));
  }
  const view = new EditorView({ state: EditorState.create({ doc: text, extensions }), parent });
  view._wrapCompartment = wrapCompartment;
  return view;
}

/**
 * Put `text` (a file read again) in the editor, changing only what differs,
 * so that the cursor, the scroll and undo stay. Its line breaks become the
 * editor's. Returns whether anything changed.
 */
function setEditorText(view, text) {
  const source = String(text ?? '');
  const eol = detectEol(source);
  const next = normalizeEol(source, '\n');
  const current = view.state.doc.toString();
  let start = 0;
  const max = Math.min(current.length, next.length);
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--;
    endNext--;
  }
  const changed = start !== endCurrent || start !== endNext;
  const effects = view.state.field(eolField, false) !== eol ? [setEol.of(eol)] : [];
  if (!changed && !effects.length) return false;
  view.dispatch({
    changes: changed ? { from: start, to: endCurrent, insert: next.slice(start, endNext) } : [],
    effects,
    userEvent: 'input.reload',
  });
  return true;
}

/** The text of an editor (the edited side of a MergeView) with its file's line breaks. */
function editorText(view) {
  const target = view && view.b && view.b.state ? view.b : view;
  return target ? textOf(target.state) : '';
}

// ── The editors the app has always made, now all the same editor ────

function createPlanEditor(parent, { onChange } = {}) {
  return createCodeEditor(parent, { doc: '', language: 'markdown', wrap: true, onChange });
}

function createReadOnlyViewer(parent, content, filename) {
  return createCodeEditor(parent, { doc: content, filename, readOnly: true });
}

function createEditableViewer(parent, content, filename, { wrap = false, onChange, statusBar: withStatusBar = true } = {}) {
  return createCodeEditor(parent, { doc: content, filename, wrap, onChange, statusBar: withStatusBar });
}

function createMergeViewer(parent, originalContent, modifiedContent, filename) {
  return createCodeEditor(parent, { doc: modifiedContent, filename, merge: { original: originalContent, layout: 'split' } });
}

/**
 * The changes from `originalContent` to `modifiedContent` in one column. With
 * `readOnly` false the text can be edited; `mergeControls` (on by default when
 * editable) puts accept and reject buttons on each change, and `onDocChange`
 * hears every edit. `collapse` false shows the unchanged lines too.
 */
function createUnifiedMergeViewer(parent, originalContent, modifiedContent, filename, {
  readOnly = false, mergeControls = !readOnly, onDocChange = null, collapse = true,
} = {}) {
  return createCodeEditor(parent, {
    doc: modifiedContent,
    filename,
    readOnly,
    onChange: onDocChange,
    merge: { original: originalContent, layout: 'unified', mergeControls, collapse },
  });
}

export {
  editorExtensions, createCodeEditor, setEditorText, editorText,
  createPlanEditor, createReadOnlyViewer, createEditableViewer, createMergeViewer, createUnifiedMergeViewer,
};
