// The page the file editor's WebView loads (src/components/files/CodeEditor.tsx):
// CodeMirror 6, bundled into one inline script by scripts/build-editor-html.mjs.
//
// The app calls window.sb.* through injectJavaScript (src/editor/bridge.ts
// writes the calls); the page answers with postMessage({ type, ... }):
//   ready                            the page can take calls
//   loaded                           a file is shown
//   state { dirty, canUndo, canRedo } after every change of these
//   text { id, text }                the answer to getText(id)

import { EditorView, keymap, lineNumbers, highlightSpecialChars, Decoration } from '@codemirror/view';
import { EditorState, Compartment, StateEffect, StateField, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { indentOnInput, bracketMatching, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { cpp } from '@codemirror/lang-cpp';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { dracula } from '@ddietr/codemirror-themes/theme/dracula';

// ── Languages ────────────────────────────────────────────────────────
// The same table as the desktop's public/codemirror-setup.js (CODE_LANGUAGES):
// a file by its name or extension, a Markdown code block by name or alias.
// One difference: a file the table does not know is plain text here, where
// the desktop shows it as Markdown.

// A LanguageSupport, not the bare Language: a Markdown code block reads its .language.
const legacy = (mode) => () => new LanguageSupport(StreamLanguage.define(mode));

const CODE_LANGUAGES = [
  { name: 'JavaScript', alias: ['js', 'ecmascript', 'node'], extensions: ['js', 'mjs', 'cjs'], support: () => javascript() },
  { name: 'JSX', extensions: ['jsx'], support: () => javascript({ jsx: true }) },
  { name: 'TypeScript', alias: ['ts'], extensions: ['ts', 'mts', 'cts'], support: () => javascript({ typescript: true }) },
  { name: 'TSX', extensions: ['tsx'], support: () => javascript({ jsx: true, typescript: true }) },
  { name: 'Python', alias: ['py'], extensions: ['py'], support: () => python() },
  { name: 'JSON', alias: ['jsonc', 'json5'], extensions: ['json'], support: () => json() },
  { name: 'HTML', alias: ['htm'], extensions: ['html', 'htm'], support: () => html() },
  { name: 'CSS', extensions: ['css'], support: () => css() },
  { name: 'Rust', alias: ['rs'], extensions: ['rs'], support: () => rust() },
  { name: 'Go', alias: ['golang'], extensions: ['go'], support: () => go() },
  { name: 'Java', extensions: ['java'], support: () => java() },
  { name: 'XML', alias: ['svg'], extensions: ['xml', 'svg'], support: () => xml() },
  { name: 'YAML', alias: ['yml'], extensions: ['yaml', 'yml'], support: () => yaml() },
  { name: 'SQL', extensions: ['sql'], support: () => sql() },
  { name: 'C++', alias: ['c', 'cpp', 'cc', 'h', 'hpp'], extensions: ['c', 'cpp', 'cc', 'h', 'hpp'], support: () => cpp() },
  { name: 'Shell', alias: ['sh', 'bash', 'zsh', 'console', 'shellscript'], extensions: ['sh', 'bash', 'zsh'], support: legacy(shell) },
  { name: 'Diff', alias: ['patch'], extensions: ['diff', 'patch'], support: legacy(diff) },
  { name: 'TOML', extensions: ['toml'], support: legacy(toml) },
  { name: 'Dockerfile', alias: ['docker'], filename: /^Dockerfile$/, support: legacy(dockerFile) },
  { name: 'Markdown', alias: ['md'], extensions: ['md', 'mdx', 'markdown'], support: () => markdownSupport() },
];

const CODE_BLOCK_LANGUAGES = CODE_LANGUAGES.map(({ name, alias, extensions, filename, support }) =>
  LanguageDescription.of({ name, alias, extensions, filename, load: async () => support() }));

function markdownSupport() {
  return markdown({ base: markdownLanguage, codeLanguages: CODE_BLOCK_LANGUAGES });
}

/** The language of a file by its name, then its extension; none (plain text) when it is neither. */
function languageFor(filename) {
  const base = (filename || '').split(/[\\/]/).pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  const lang = CODE_LANGUAGES.find((l) => l.filename && l.filename.test(base))
    || CODE_LANGUAGES.find((l) => l.extensions && l.extensions.includes(ext));
  return lang ? lang.support() : [];
}

// ── Look ─────────────────────────────────────────────────────────────
// Dracula's colours for the code, on the app's own background (src/theme.ts).

const appTheme = Prec.highest(EditorView.theme({
  '&': { height: '100%', backgroundColor: '#111118', color: '#d0d0e0', fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: '1.5', overscrollBehavior: 'contain' },
  '.cm-content': { padding: '12px 0 40vh', caretColor: '#8088ff' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { backgroundColor: '#111118', color: '#666677', border: 'none', borderRight: '1px solid rgba(255,255,255,0.08)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px', minWidth: '24px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: '#8088ff' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(128,136,255,0.35)' },
  '.cm-marked-line': { backgroundColor: 'rgba(128,136,255,0.28)' },
}, { dark: true }));

// ── The line a search result points at ──────────────────────────────

const setMark = StateEffect.define();
const markField = StateField.define({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setMark)) marks = effect.value;
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Lines kept above the marked line when it is scrolled into view. */
const MARK_CONTEXT = 3;

// ── The editor ───────────────────────────────────────────────────────

const post = (message) => {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
};

const editableCompartment = new Compartment();
const languageCompartment = new Compartment();
const wrapCompartment = new Compartment();

let editable = false;
let original = '';
let shown = { filename: '', wrap: false };
let lastState = '';

const editableExtension = (on) => [EditorView.editable.of(on), EditorState.readOnly.of(!on)];

function postState(state) {
  const message = {
    type: 'state',
    dirty: state.doc.length !== original.length || state.doc.toString() !== original,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
  const key = JSON.stringify(message);
  if (key === lastState) return;
  lastState = key;
  post(message);
}

function createState(text, filename, wrap) {
  return EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      highlightSpecialChars(),
      history(),
      indentOnInput(),
      bracketMatching(),
      // Shortcuts for a hardware keyboard.
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      languageCompartment.of(languageFor(filename)),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      editableCompartment.of(editableExtension(editable)),
      markField,
      dracula,
      appTheme,
      // Dirty, undo and redo change only with the text.
      EditorView.updateListener.of((update) => {
        if (update.docChanged) postState(update.state);
      }),
    ],
  });
}

const view = new EditorView({ state: createState('', '', false), parent: document.getElementById('editor') });

/** Shows a file: its text, highlighted by its name; `line` marks a line and scrolls it into view. */
function load(text, filename, options) {
  const { line = null, wrap = false } = options || {};
  original = text;
  shown = { filename, wrap };
  view.setState(createState(text, filename, wrap));
  lastState = '';
  postState(view.state);
  if (Number.isInteger(line) && line >= 1 && line <= view.state.doc.lines) {
    const at = view.state.doc.line(line);
    view.dispatch({ effects: setMark.of(Decoration.set([Decoration.line({ class: 'cm-marked-line' }).range(at.from)])) });
    // Once the page has its size: the line, with a few lines above it.
    requestAnimationFrame(() => {
      view.dispatch({ effects: EditorView.scrollIntoView(at.from, { y: 'start', yMargin: MARK_CONTEXT * view.defaultLineHeight }) });
    });
  }
  post({ type: 'loaded' });
}

/** Read-only, or editable with the keyboard up and the cursor where the reader was. */
function setEditable(on) {
  editable = !!on;
  view.dispatch({ effects: editableCompartment.reconfigure(editableExtension(editable)) });
  if (!editable) {
    view.contentDOM.blur();
    return;
  }
  // The first line at the top of the scroller, in the document's own heights.
  const top = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop));
  view.dispatch({ selection: { anchor: top.from } });
  view.contentDOM.focus({ preventScroll: true });
}

/** Back to the text as it was loaded, where the reader is now. */
function revert() {
  const scrollTop = view.scrollDOM.scrollTop;
  view.setState(createState(original, shown.filename, shown.wrap));
  view.scrollDOM.scrollTop = scrollTop;
  lastState = '';
  postState(view.state);
}

// The keyboard came up (the page got shorter): keep the cursor in view.
window.addEventListener('resize', () => {
  if (view.hasFocus) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest', yMargin: 24 }) });
});

window.sb = {
  load,
  setEditable,
  revert,
  undo: () => undo(view),
  redo: () => redo(view),
  getText: (id) => post({ type: 'text', id, text: view.state.doc.toString() }),
};

post({ type: 'ready' });
