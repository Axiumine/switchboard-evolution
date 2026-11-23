import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, ViewPlugin, Decoration, rectangularSelection } from '@codemirror/view';
import { EditorState, EditorSelection, StateField, StateEffect, Compartment } from '@codemirror/state';
import { defaultKeymap, standardKeymap, indentWithTab, history, historyKeymap, selectLine, simplifySelection, addCursorAbove, addCursorBelow } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { highlightSelectionMatches, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { dracula } from '@ddietr/codemirror-themes/theme/dracula';
import { tags } from '@lezer/highlight';
import TextSearchLib from './text-search.js';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { marked } from 'marked';
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
import { cypher } from '@codemirror/legacy-modes/mode/cypher';

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

// ── Find and replace bar, as VS Code's find widget ───────────────────
// Match Case, Match Whole Word, Use Regular Expression (text-search.js, the
// same rules as the Files tab's Search), and in an editable editor a Replace
// row: Replace (the current match) and Replace All, both undoable.

const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform);
const setSearchQuery = StateEffect.define();
const searchQueryField = StateField.define({
  create() { return null; },
  update(val, tr) {
    for (const e of tr.effects) if (e.is(setSearchQuery)) return e.value;
    return val;
  },
});

/** Every match of `regex` in the document, as [{ from, to }]; empty matches are skipped. */
function findAllMatches(doc, regex, limit = 20000) {
  const text = doc.toString();
  const out = [];
  regex.lastIndex = 0;
  let m;
  while (out.length < limit && (m = regex.exec(text)) !== null) {
    if (m[0].length === 0) { regex.lastIndex = m.index + 1; if (regex.lastIndex > text.length) break; continue; }
    out.push({ from: m.index, to: m.index + m[0].length });
  }
  regex.lastIndex = 0;
  return out;
}

const searchHighlighter = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this._build(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.state.field(searchQueryField) !== update.startState.field(searchQueryField)) {
      this.decorations = this._build(update.view);
    }
  }
  _build(view) {
    const q = view.state.field(searchQueryField);
    if (!q || !q.regex) return Decoration.none;
    const sel = view.state.selection.main;
    const decs = findAllMatches(view.state.doc, q.regex).map(({ from, to }) => Decoration.mark({
      class: from === sel.from && to === sel.to ? 'cm-find-match cm-find-match-active' : 'cm-find-match',
    }).range(from, to));
    return Decoration.set(decs);
  }
}, { decorations: v => v.decorations });

const cmSearchTheme = EditorView.theme({
  '.cm-find-match': { backgroundColor: '#515C6A', borderRadius: '2px' },
  '.cm-find-match-active': { backgroundColor: '#EAA549', color: '#171717', borderRadius: '2px' },
});

function cmFloatingSearch() {
  return [searchQueryField, searchHighlighter, cmSearchTheme];
}

const FIND_ICONS = {
  chevronRight: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  chevronDown: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  matchCase: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.5 12.5h-1.2l-.9-2.6H2.3l-.9 2.6H.2L3.2 4h1.3zm-2.5-3.6L3.9 5.6 2.7 8.9zM14.5 12.5h-1.1v-.8c-.5.6-1 1-1.9 1-1.1 0-1.9-.7-1.9-1.8 0-1.1.8-1.8 2.3-1.9l1.5-.1v-.4c0-.7-.4-1.1-1.2-1.1-.6 0-1.1.2-1.6.6l-.5-.8c.6-.5 1.3-.8 2.2-.8 1.4 0 2.2.7 2.2 2zm-1.1-2.7-1.3.1c-.9.1-1.3.4-1.3.9 0 .6.4.9 1 .9.9 0 1.6-.6 1.6-1.4z"/></svg>',
  wholeWord: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 11h1v2h14v-2h1v3H0z"/><path d="M6.8 10.5h-1v-.6c-.4.5-.9.7-1.6.7-1 0-1.6-.6-1.6-1.4 0-.9.7-1.5 2-1.6l1.2-.1v-.3c0-.6-.3-.9-1-.9-.5 0-.9.2-1.3.5l-.4-.7c.5-.4 1.1-.6 1.8-.6 1.2 0 1.9.6 1.9 1.7zm-1-2.3-1 .1c-.7.1-1.1.3-1.1.8 0 .4.3.7.8.7.8 0 1.3-.5 1.3-1.2zM9 10.5H8V3h1v3.6c.4-.5.9-.8 1.6-.8 1.2 0 2 1 2 2.4 0 1.5-.8 2.5-2.1 2.5-.6 0-1.1-.3-1.5-.8zm0-1.9c0 .7.5 1.3 1.3 1.3s1.3-.6 1.3-1.6-.4-1.6-1.2-1.6S9 7.3 9 8.1z"/></svg>',
  regex: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 1.5h1v2.3l2-1.2.5.9-2 1.1 2 1.1-.5.9-2-1.2v2.3h-1V5.4l-2 1.2-.5-.9 2-1.1-2-1.1.5-.9 2 1.2zM2 11h3v3H2z"/></svg>',
  replaceOne: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.6 2.7 10.5 1.6l.7-.7 2.3 2.3-2.3 2.3-.7-.7 1.1-1.1H9.5a2 2 0 0 0-2 2v.5h-1v-.5a3 3 0 0 1 3-3zM3 9h4v1H3zm6 0h4v5H9zm1 1v3h2v-3zM3 11h4v1H3zm0 2h4v1H3z"/></svg>',
  replaceAll: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.6 2.7 10.5 1.6l.7-.7 2.3 2.3-2.3 2.3-.7-.7 1.1-1.1H9.5a2 2 0 0 0-2 2v.5h-1v-.5a3 3 0 0 1 3-3zM1 9h6v1H1zm0 2h6v1H1zm0 2h6v1H1zm8-4h6v6H9zm1 1v4h4v-4z"/></svg>',
};

function createCMSearchBar(parent, view) {
  const editable = () => view.state.facet(EditorView.editable) && !view.state.readOnly;
  const mac = isMacPlatform();
  const keyHint = (m, o) => (mac ? m : o);
  const bar = document.createElement('div');
  bar.className = 'terminal-search-bar cm-find-bar';
  bar.style.display = 'none';
  bar.innerHTML = `
    <button type="button" class="cm-find-toggle" title="Toggle Replace" aria-label="Toggle Replace" aria-expanded="false">${FIND_ICONS.chevronRight}</button>
    <div class="cm-find-rows">
      <div class="cm-find-row">
        <span class="cm-find-box">
          <input type="text" class="terminal-search-input cm-find-input" placeholder="Find" aria-label="Find" spellcheck="false" />
          <button type="button" class="cm-find-opt" data-opt="matchCase" title="Match Case (${keyHint('⌥⌘C', 'Alt+C')})" aria-pressed="false">${FIND_ICONS.matchCase}</button>
          <button type="button" class="cm-find-opt" data-opt="wholeWord" title="Match Whole Word (${keyHint('⌥⌘W', 'Alt+W')})" aria-pressed="false">${FIND_ICONS.wholeWord}</button>
          <button type="button" class="cm-find-opt" data-opt="isRegex" title="Use Regular Expression (${keyHint('⌥⌘R', 'Alt+R')})" aria-pressed="false">${FIND_ICONS.regex}</button>
        </span>
        <span class="terminal-search-count"></span>
        <button type="button" class="terminal-search-prev" title="Previous Match (Shift+Enter)">&#x25B2;</button>
        <button type="button" class="terminal-search-next" title="Next Match (Enter)">&#x25BC;</button>
        <button type="button" class="terminal-search-close" title="Close (Escape)">&times;</button>
      </div>
      <div class="cm-find-row cm-replace-row" hidden>
        <span class="cm-find-box"><input type="text" class="terminal-search-input cm-replace-input" placeholder="Replace" aria-label="Replace" spellcheck="false" /></span>
        <button type="button" class="cm-replace-one" title="Replace (Enter)" aria-label="Replace">${FIND_ICONS.replaceOne}</button>
        <button type="button" class="cm-replace-all" title="Replace All (${keyHint('⌘Enter', 'Ctrl+Alt+Enter')})" aria-label="Replace All">${FIND_ICONS.replaceAll}</button>
      </div>
    </div>
  `;
  parent.style.position = 'relative';
  parent.appendChild(bar);

  const input = bar.querySelector('.cm-find-input');
  const replaceInput = bar.querySelector('.cm-replace-input');
  const replaceRow = bar.querySelector('.cm-replace-row');
  const toggle = bar.querySelector('.cm-find-toggle');
  const countEl = bar.querySelector('.terminal-search-count');
  const options = { matchCase: false, wholeWord: false, isRegex: false };
  let regex = null;
  let matches = [];
  let activeIdx = -1;

  function buildRegex() {
    if (!input.value) return null;
    try {
      countEl.title = '';
      return TextSearchLib.buildSearchRegExp({ query: input.value, ...options });
    } catch (err) {
      countEl.title = err.message;
      return undefined;
    }
  }

  function findAll() {
    regex = buildRegex();
    matches = [];
    activeIdx = -1;
    bar.classList.toggle('is-invalid', regex === undefined);
    if (!regex) {
      view.dispatch({ effects: setSearchQuery.of(null) });
      countEl.textContent = regex === undefined ? 'Invalid' : '';
      return;
    }
    view.dispatch({ effects: setSearchQuery.of({ regex }) });
    matches = findAllMatches(view.state.doc, regex);
    countEl.textContent = matches.length > 0 ? `${matches.length} found` : 'No results';
  }

  function goTo(idx) {
    if (matches.length === 0) return;
    activeIdx = ((idx % matches.length) + matches.length) % matches.length;
    const { from, to } = matches[activeIdx];
    view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    countEl.textContent = `${activeIdx + 1} of ${matches.length}`;
  }

  /** The first match at or after `pos` (wrapping round), for after a replace. */
  function goToFrom(pos) {
    if (!matches.length) { countEl.textContent = 'No results'; return; }
    const idx = matches.findIndex(m => m.from >= pos);
    goTo(idx < 0 ? 0 : idx);
  }

  function replacementAt(from) {
    const replace = replaceInput.value;
    if (!options.isRegex) return replace;
    const sticky = new RegExp(regex.source, regex.flags.replace('g', '') + 'y');
    sticky.lastIndex = from;
    const m = sticky.exec(view.state.doc.toString());
    return m ? TextSearchLib.expandReplacement(replace, m) : replace;
  }

  function replaceOne() {
    if (!editable() || !regex || !matches.length) return;
    const sel = view.state.selection.main;
    let current = matches.findIndex(m => m.from === sel.from && m.to === sel.to);
    // The first press selects the match, as VS Code does when the cursor is elsewhere.
    if (current < 0) { goToFrom(sel.from); return; }
    const { from, to } = matches[current];
    const insert = replacementAt(from);
    view.dispatch({ changes: { from, to, insert }, userEvent: 'input.replace' });
    findAll();
    goToFrom(from + insert.length);
  }

  function replaceAll() {
    if (!editable() || !regex || !matches.length) return;
    const changes = matches.map(({ from, to }) => ({ from, to, insert: replacementAt(from) }));
    view.dispatch({ changes, userEvent: 'input.replace.all' });
    const count = changes.length;
    findAll();
    countEl.textContent = `Replaced ${count}`;
  }

  function showReplace(show) {
    const on = show && editable();
    replaceRow.hidden = !on;
    toggle.innerHTML = on ? FIND_ICONS.chevronDown : FIND_ICONS.chevronRight;
    toggle.setAttribute('aria-expanded', String(on));
    bar.classList.toggle('has-replace', on);
  }

  function setOption(opt) {
    options[opt] = !options[opt];
    const button = bar.querySelector(`.cm-find-opt[data-opt="${opt}"]`);
    button.classList.toggle('on', options[opt]);
    button.setAttribute('aria-pressed', String(options[opt]));
    findAll();
    if (matches.length) goToFrom(view.state.selection.main.from);
  }

  function open({ replace = false } = {}) {
    toggle.style.display = editable() ? '' : 'none';
    bar.style.display = 'flex';
    if (replace) showReplace(true);
    const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    if (sel && !sel.includes('\n')) input.value = sel;
    findAll();
    if (matches.length) goToFrom(view.state.selection.main.from);
    const target = replace && input.value ? replaceInput : input;
    target.focus();
    target.select();
  }

  function close() {
    bar.style.display = 'none';
    matches = [];
    activeIdx = -1;
    view.dispatch({ effects: setSearchQuery.of(null) });
    countEl.textContent = '';
    view.focus();
  }

  function onKey(e) {
    const mod = mac ? e.metaKey : e.ctrlKey;
    const optKey = mac ? (e.altKey && e.metaKey) : (e.altKey && !e.ctrlKey);
    if (e.key === 'Escape') { close(); e.preventDefault(); return; }
    if (optKey && e.code === 'KeyC') { setOption('matchCase'); e.preventDefault(); return; }
    if (optKey && e.code === 'KeyW') { setOption('wholeWord'); e.preventDefault(); return; }
    if (optKey && e.code === 'KeyR') { setOption('isRegex'); e.preventDefault(); return; }
    if (e.key === 'g' && mod) { openGotoLine(view); e.preventDefault(); return; }
    if (e.key === 's' && mod) { view.dom.dispatchEvent(new CustomEvent('cm-save', { bubbles: true })); e.preventDefault(); return; }
    if (e.key === 'f' && mod && e.altKey) { showReplace(true); replaceInput.focus(); e.preventDefault(); return; }
    if (e.key === 'h' && e.ctrlKey && !mac) { showReplace(true); replaceInput.focus(); e.preventDefault(); return; }
    if (e.key === 'f' && mod) { input.focus(); input.select(); e.preventDefault(); return; }
    if (e.target === replaceInput && e.key === 'Enter' && (mac ? e.metaKey : (e.ctrlKey && e.altKey))) { replaceAll(); e.preventDefault(); return; }
    if (e.target === replaceInput && e.key === 'Enter') { replaceOne(); e.preventDefault(); return; }
    if (e.key === 'Enter' && e.shiftKey) { goTo(activeIdx - 1); e.preventDefault(); return; }
    if (e.key === 'Enter') { goTo(activeIdx + 1); e.preventDefault(); }
  }

  input.addEventListener('input', () => { findAll(); if (matches.length) goToFrom(view.state.selection.main.from); });
  bar.addEventListener('keydown', onKey);
  toggle.addEventListener('click', () => showReplace(replaceRow.hidden));
  bar.querySelectorAll('.cm-find-opt').forEach(b => b.addEventListener('click', () => setOption(b.dataset.opt)));
  bar.querySelector('.terminal-search-next').addEventListener('click', () => goTo(activeIdx + 1));
  bar.querySelector('.terminal-search-prev').addEventListener('click', () => goTo(activeIdx - 1));
  bar.querySelector('.terminal-search-close').addEventListener('click', close);
  bar.querySelector('.cm-replace-one').addEventListener('click', replaceOne);
  bar.querySelector('.cm-replace-all').addEventListener('click', replaceAll);

  return { open, close, bar };
}

const cmFindKeymap = keymap.of([
  { key: 'Mod-f', run(view) { openCMSearch(view); return true; } },
  // Replace: ⌥⌘F on macOS, Ctrl+H elsewhere, as in VS Code.
  { mac: 'Mod-Alt-f', win: 'Ctrl-h', linux: 'Ctrl-h', run(view) { openCMSearch(view, { replace: true }); return true; } },
]);

function openCMSearch(view, opts = {}) {
  const parent = view.dom.parentElement;
  // Close goto-line if open
  if (parent._cmGotoLine) parent._cmGotoLine.close();
  if (!parent._cmSearchBar) {
    parent._cmSearchBar = createCMSearchBar(parent, view);
  }
  parent._cmSearchBar.open(opts);
}

// DOM-level Cmd/Ctrl+F listener for read-only editors where CM keymaps don't fire
const cmFindDomHandler = ViewPlugin.fromClass(class {
  constructor(view) {
    this._handler = (e) => {
      if (e.defaultPrevented) return;
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (e.key === 'f' && mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openCMSearch(view);
      }
    };
    // Make the wrapper focusable so clicks give it focus
    if (!view.dom.getAttribute('tabindex')) view.dom.setAttribute('tabindex', '0');
    view.dom.addEventListener('keydown', this._handler);
  }
  destroy() {
    // cleanup handled by CM disposing the DOM
  }
});

// ── Go to line (Cmd/Ctrl+G) ──────────────────────────────────────────

function createGotoLineBar(parent, view) {
  const bar = document.createElement('div');
  bar.className = 'terminal-search-bar';
  bar.style.display = 'none';
  bar.innerHTML = `
    <input type="text" class="terminal-search-input" placeholder="Go to line..." style="width:120px" />
    <span class="terminal-search-count"></span>
    <button class="terminal-search-close" title="Close (Escape)">&times;</button>
  `;
  parent.style.position = 'relative';
  parent.appendChild(bar);

  const input = bar.querySelector('.terminal-search-input');
  const countEl = bar.querySelector('.terminal-search-count');

  function goTo() {
    const lineNum = parseInt(input.value, 10);
    if (!lineNum || lineNum < 1) { countEl.textContent = 'Invalid'; return; }
    const doc = view.state.doc;
    if (lineNum > doc.lines) { countEl.textContent = `Max: ${doc.lines}`; return; }
    const line = doc.line(lineNum);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    countEl.textContent = `Line ${lineNum}`;
  }

  function open() {
    bar.style.display = 'flex';
    input.value = '';
    countEl.textContent = `of ${view.state.doc.lines}`;
    input.focus();
  }

  function close() {
    bar.style.display = 'none';
    input.value = '';
    countEl.textContent = '';
    view.focus();
  }

  const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);
  input.addEventListener('keydown', (e) => {
    const mod = isMacPlatform ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === 'f' && mod) { openCMSearch(view); e.preventDefault(); }
    else if (e.key === 's' && mod) { view.dom.dispatchEvent(new CustomEvent('cm-save', { bubbles: true })); e.preventDefault(); }
    else if (e.key === 'Enter') { goTo(); e.preventDefault(); }
  });
  bar.querySelector('.terminal-search-close').addEventListener('click', close);

  return { open, close };
}

function openGotoLine(view) {
  const parent = view.dom.parentElement;
  // Close search if open
  if (parent._cmSearchBar) parent._cmSearchBar.close();
  if (!parent._cmGotoLine) {
    parent._cmGotoLine = createGotoLineBar(parent, view);
  }
  parent._cmGotoLine.open();
}

const cmGotoLineKeymap = keymap.of([{
  key: 'Mod-g',
  run(view) { openGotoLine(view); return true; },
}]);

// Cmd/Ctrl+S — dispatch custom event so ViewerPanel can handle save
const cmSaveKeymap = keymap.of([{
  key: 'Mod-s',
  run(view) {
    view.dom.dispatchEvent(new CustomEvent('cm-save', { bubbles: true }));
    return true;
  },
}]);

const cmGotoLineDomHandler = ViewPlugin.fromClass(class {
  constructor(view) {
    this._handler = (e) => {
      if (e.defaultPrevented) return;
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (e.key === 'g' && mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openGotoLine(view);
      }
    };
    view.dom.addEventListener('keydown', this._handler);
  }
  destroy() {}
});

// DOM-level Cmd/Ctrl+S for read-only editors
const cmSaveDomHandler = ViewPlugin.fromClass(class {
  constructor(view) {
    this._handler = (e) => {
      if (e.defaultPrevented) return;
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (e.key === 's' && mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        view.dom.dispatchEvent(new CustomEvent('cm-save', { bubbles: true }));
      }
    };
    view.dom.addEventListener('keydown', this._handler);
  }
  destroy() {}
});

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
// defaultKeymap and would take Cmd+F and Ctrl+G from the find and go-to-line
// bars above. The mobile app's editor has the same (scripts/editor-page/cursors.js).

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

// A read-only viewer's text takes the focus (CodeMirror leaves it not
// focusable), so that after a click in it the keys above work there, and
// copying takes every selection.
const focusableText = EditorView.contentAttributes.of({ tabindex: '0' });

/** Calls `onChange` after every edit of the text (typing, undo, a reload), not on cursor moves. */
function docChangeListener(onChange) {
  return onChange ? EditorView.updateListener.of((update) => { if (update.docChanged) onChange(update); }) : [];
}

function createPlanEditor(parent, { onChange } = {}) {
  const wrapCompartment = new Compartment();
  const state = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      multipleCursors(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      cmFindKeymap,
      cmGotoLineKeymap,
      cmSaveKeymap,
      cmFloatingSearch(),
      markdownSupport(),
      dracula,
      syntaxHighlighting(markdownExtras),
      appThemePatch,
      wrapCompartment.of(EditorView.lineWrapping),
      docChangeListener(onChange),
    ],
  });

  const view = new EditorView({ state, parent });
  view._wrapCompartment = wrapCompartment;
  return view;
}

// ── Languages ────────────────────────────────────────────────────────
// The languages Switchboard highlights: a file by its name or extension, and
// a Markdown code block (```ts, ```bash …) by name or alias. Only these go in
// the bundle. @codemirror/language-data would bring every language CodeMirror
// has: its imports are lazy, but esbuild inlines them all into the IIFE.

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
  // The Node Knowledge tab's Query view (codebase-memory-mcp's query_graph).
  { name: 'Cypher', alias: ['cql'], extensions: ['cypher', 'cyp'], support: legacy(cypher) },
  { name: 'Markdown', alias: ['md'], extensions: ['md', 'mdx', 'markdown'], support: () => markdownSupport() },
];

/** The same languages for Markdown code blocks, each made when a block first needs it. */
const CODE_BLOCK_LANGUAGES = CODE_LANGUAGES.map(({ name, alias, extensions, filename, support }) =>
  LanguageDescription.of({ name, alias, extensions, filename, load: async () => support() }));

function markdownSupport() {
  return markdown({ base: markdownLanguage, codeLanguages: CODE_BLOCK_LANGUAGES });
}

// ── Language Detection ───────────────────────────────────────────────

/** The language of a file by its name, then its extension; Markdown when it is none of them. */
function getLanguageExt(filename) {
  const base = (filename || '').split(/[\\/]/).pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  const lang = CODE_LANGUAGES.find(l => l.filename && l.filename.test(base))
    || CODE_LANGUAGES.find(l => l.extensions && l.extensions.includes(ext));
  return lang ? lang.support() : markdownSupport();
}

// ── Read-Only File Viewer ───────────────────────────────────────────

function createReadOnlyViewer(parent, content, filename) {
  const langExt = getLanguageExt(filename);
  const state = EditorState.create({
    doc: content,
    extensions: [
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      lineNumbers(),
      highlightSpecialChars(),
      foldGutter(),
      bracketMatching(),
      highlightSelectionMatches(),
      multipleCursors(),
      focusableText,
      keymap.of([...foldKeymap]),
      cmFindKeymap,
      cmFindDomHandler,
      cmGotoLineDomHandler,
      cmSaveDomHandler,
      cmFloatingSearch(),
      langExt,
      dracula,
      syntaxHighlighting(markdownExtras),
      appThemePatch,
    ],
  });
  return new EditorView({ state, parent });
}

// ── Editable File Viewer (for file panel) ───────────────────────────

function createEditableViewer(parent, content, filename, { wrap = false, onChange } = {}) {
  const langExt = getLanguageExt(filename);
  const wrapCompartment = new Compartment();

  const state = EditorState.create({
    doc: content,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      multipleCursors(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      cmFindKeymap,
      cmGotoLineKeymap,
      cmSaveKeymap,
      cmFloatingSearch(),
      langExt,
      dracula,
      syntaxHighlighting(markdownExtras),
      appThemePatch,
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      docChangeListener(onChange),
    ],
  });

  const view = new EditorView({ state, parent });
  view._wrapCompartment = wrapCompartment;
  return view;
}

// ── Diff / Merge Viewer ─────────────────────────────────────────────

function createMergeViewer(parent, originalContent, modifiedContent, filename) {
  const langExt = getLanguageExt(filename);
  const sharedExts = [
    lineNumbers(),
    highlightSpecialChars(),
    foldGutter(),
    bracketMatching(),
    highlightSelectionMatches(),
    multipleCursors(),
    focusableText,
    // Moving and deleting act on every cursor, as typing does.
    keymap.of([...foldKeymap, ...standardKeymap]),
    cmFindKeymap,
    cmFindDomHandler,
    cmFloatingSearch(),
    langExt,
    dracula,
    syntaxHighlighting(markdownExtras),
    appThemePatch,
  ];

  return new MergeView({
    parent,
    a: {
      doc: originalContent,
      extensions: [
        ...sharedExts,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
    },
    b: {
      doc: modifiedContent,
      extensions: [...sharedExts],
    },
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: { margin: 3, minSize: 4 },
  });
}

/**
 * The changes from `originalContent` to `modifiedContent` in one column. With
 * `readOnly` false the text can be edited: with history and the editing keys,
 * the chunks drawn again as it changes; `mergeControls` (on by default when
 * editable) puts accept and reject buttons on each chunk, and `onDocChange`
 * hears every edit. `collapse` false shows the unchanged lines too.
 */
function createUnifiedMergeViewer(parent, originalContent, modifiedContent, filename, { readOnly = false, mergeControls = !readOnly, onDocChange = null, collapse = true } = {}) {
  const langExt = getLanguageExt(filename);
  const state = EditorState.create({
    doc: modifiedContent,
    extensions: [
      lineNumbers(),
      highlightSpecialChars(),
      foldGutter(),
      bracketMatching(),
      highlightSelectionMatches(),
      multipleCursors(),
      // Moving and deleting act on every cursor, as typing does.
      keymap.of([...foldKeymap, ...standardKeymap]),
      cmFindKeymap,
      cmFindDomHandler,
      cmGotoLineDomHandler,
      cmSaveDomHandler,
      cmFloatingSearch(),
      langExt,
      dracula,
      syntaxHighlighting(markdownExtras),
      appThemePatch,
      readOnly ? EditorView.editable.of(false) : [],
      readOnly ? EditorState.readOnly.of(true) : [],
      readOnly ? focusableText : [history(), keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap])],
      onDocChange ? EditorView.updateListener.of((update) => { if (update.docChanged) onDocChange(update); }) : [],
      unifiedMergeView({
        original: originalContent,
        gutter: true,
        highlightChanges: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: collapse ? { margin: 3, minSize: 4 } : undefined,
        mergeControls: !!mergeControls,
      }),
    ],
  });
  return new EditorView({ state, parent });
}

// ── Exports ─────────────────────────────────────────────────────────

window.createPlanEditor = createPlanEditor;
window.createReadOnlyViewer = createReadOnlyViewer;
window.createEditableViewer = createEditableViewer;
window.createMergeViewer = createMergeViewer;
window.createUnifiedMergeViewer = createUnifiedMergeViewer;
window.CMEditorView = EditorView;
window.CMEditorState = EditorState;
window.CMMergeView = MergeView;
window.cmOpenGotoLine = openGotoLine;

marked.setOptions({ breaks: true, gfm: true });
window.marked = marked;
