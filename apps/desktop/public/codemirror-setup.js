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
import { setEditorChangeBase } from './editor/change-marks.mjs';
import { openSearch, openGotoLine, findNext, findPrevious, runEditorKeys, createPreviewFind } from './editor/find.mjs';
import { openSymbolPicker } from './editor/symbols.mjs';
import { detectEol, normalizeEol } from './editor/indentation.mjs';
import { PREFS, readPref, setPref, togglePref, onPrefChange } from './editor/prefs.mjs';
// The modules the add-ons loaded later (editor/addons.mjs) use as their own.
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import * as cmCommands from '@codemirror/commands';
import * as cmSearch from '@codemirror/search';
import * as cmAutocomplete from '@codemirror/autocomplete';
import * as cmLint from '@codemirror/lint';
import * as lezerCommon from '@lezer/common';
import * as lezerHighlight from '@lezer/highlight';
import * as lezerLr from '@lezer/lr';
import * as markedModule from 'marked';
import * as langHtml from '@codemirror/lang-html';
import * as langCss from '@codemirror/lang-css';
import * as langJavascript from '@codemirror/lang-javascript';
import * as lezerJavascript from '@lezer/javascript';
import * as lezerHtml from '@lezer/html';
import * as lezerCss from '@lezer/css';

window.__sbEditorModules = {
  '@codemirror/state': cmState,
  '@codemirror/view': cmView,
  '@codemirror/language': cmLanguage,
  '@codemirror/commands': cmCommands,
  '@codemirror/search': cmSearch,
  '@codemirror/autocomplete': cmAutocomplete,
  '@codemirror/lint': cmLint,
  '@lezer/common': lezerCommon,
  '@lezer/highlight': lezerHighlight,
  '@lezer/lr': lezerLr,
  marked: markedModule,
  '@codemirror/lang-html': langHtml,
  '@codemirror/lang-css': langCss,
  '@codemirror/lang-javascript': langJavascript,
  '@lezer/javascript': lezerJavascript,
  '@lezer/html': lezerHtml,
  '@lezer/css': lezerCss,
};

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
// What the gutter's change marks are measured from.
window.cmSetChangeBase = setEditorChangeBase;
window.cmDetectEol = detectEol;
window.cmNormalizeEol = normalizeEol;
// The language servers' switch is the main process's: this window follows it.
if (window.api && window.api.getLanguageServers) {
  const follow = (on) => { if (readPref('languageServers') !== !!on) setPref('languageServers', !!on, { fromApp: true }); };
  window.api.getLanguageServers().then(follow, () => {});
  if (window.api.onLanguageServersChanged) window.api.onLanguageServersChanged(follow);
}
// The editor's preferences (editor/prefs.mjs), for Settings › Editor.
window.cmEditorPrefs = {
  names: () => [...PREFS.keys()],
  label: name => (PREFS.has(name) ? PREFS.get(name).label : name),
  get: readPref,
  set: setPref,
  toggle: togglePref,
  onChange: onPrefChange,
  // The main window's copy of the global settings: apply what differs from
  // this window's choices (fromApp: no write back), and, the first time the
  // settings hold no editorPrefs, save this window's choices there.
  sync(global) {
    const model = window.SettingsModel;
    if (!model || !model.editorPrefsSync) return;
    const current = {};
    // The language servers are a setting of their own, not part of editorPrefs.
    for (const { name } of model.EDITOR_PREFS) if (name !== 'languageServers') current[name] = readPref(name);
    const { migrate, apply } = model.editorPrefsSync(global || {}, current);
    for (const [name, on] of Object.entries(apply)) setPref(name, !!on, { fromApp: true });
    if (migrate && window.api && window.api.patchSetting) window.api.patchSetting('global', { editorPrefs: migrate });
  },
};

marked.setOptions({ breaks: true, gfm: true });
window.marked = marked;
