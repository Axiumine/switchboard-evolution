// The editor of every window, bundled by esbuild into codemirror-bundle.js
// (npm run bundle:codemirror) and given to the pages on window. The editor
// itself is in editor/: core.mjs makes it, the other modules are its parts.
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { MergeView } from '@codemirror/merge';
import { marked } from 'marked';
import {
  createCodeEditor, setEditorText, editorText,
  createPlanEditor, createReadOnlyViewer, createEditableViewer, createMergeViewer, createUnifiedMergeViewer,
} from './editor/core.mjs';
import { highlightCodeLines } from './editor/languages.mjs';
import { openSearch, openGotoLine, findNext, findPrevious, runEditorKeys, createPreviewFind } from './editor/find.mjs';
import { openSymbolPicker } from './editor/symbols.mjs';
import { detectEol, normalizeEol } from './editor/indentation.mjs';

window.createCodeEditor = createCodeEditor;
window.createPlanEditor = createPlanEditor;
window.createReadOnlyViewer = createReadOnlyViewer;
window.createEditableViewer = createEditableViewer;
window.createMergeViewer = createMergeViewer;
window.createUnifiedMergeViewer = createUnifiedMergeViewer;
window.cmHighlightLines = highlightCodeLines;
window.CMEditorView = EditorView;
window.CMEditorState = EditorState;
window.CMMergeView = MergeView;
// The bars and keys, for the panels around an editor (their toolbars and previews).
window.cmOpenSearch = openSearch;
window.cmOpenGotoLine = openGotoLine;
window.cmFindNext = (view, direction = 1) => (direction < 0 ? findPrevious(view) : findNext(view));
window.cmOpenSymbolPicker = openSymbolPicker;
window.cmRunEditorKeys = runEditorKeys;
window.cmCreatePreviewFind = createPreviewFind;
// The text with its file's line breaks, and a file read again put in place.
window.cmGetText = editorText;
window.cmSetText = setEditorText;
window.cmDetectEol = detectEol;
window.cmNormalizeEol = normalizeEol;

marked.setOptions({ breaks: true, gfm: true });
window.marked = marked;
