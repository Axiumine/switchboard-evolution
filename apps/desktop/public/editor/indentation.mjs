// How a file is indented and how its lines end, as found in its text, and
// the indentation guides.
//
// The editor keeps its lines split on any line break (CodeMirror's default)
// and remembers the file's own: the text it gives back (textOf) has the
// file's CRLF when the file had them, so a Windows file is not saved as LF.
import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, highlightWhitespace, highlightTrailingWhitespace } from '@codemirror/view';
import { indentUnit, getIndentUnit } from '@codemirror/language';

const DEFAULT_INDENT = { insertSpaces: true, size: 2 };
const SCAN_LINES = 10000;

/**
 * How `text` is indented, as VS Code guesses it: tabs when more lines start
 * with a tab than with spaces; otherwise the step between the indentation of
 * consecutive lines that comes most often (2, 4, 8 …). `detected` is false
 * when no line is indented (the default then).
 */
function detectIndentation(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/, SCAN_LINES);
  let tabs = 0;
  let spaces = 0;
  const steps = new Map();
  let previous = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = /^[ \t]*/.exec(line)[0];
    if (lead.startsWith('\t')) tabs++;
    else if (lead.length > 0) spaces++;
    if (!lead.includes('\t')) {
      const step = Math.abs(lead.length - previous);
      if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) || 0) + 1);
      previous = lead.length;
    }
  }
  if (!tabs && !spaces) return { ...DEFAULT_INDENT, detected: false };
  if (tabs > spaces) return { insertSpaces: false, size: 4, detected: true };
  let size = DEFAULT_INDENT.size;
  let best = 0;
  // Ties go to the smaller step: 2 then 4 then 8.
  for (const [step, count] of [...steps].sort((a, b) => a[0] - b[0])) {
    if (count > best) { best = count; size = step; }
  }
  return { insertSpaces: true, size, detected: true };
}

/** The line break of `text`: CRLF when most of its breaks are, LF otherwise (and for a single line). */
function detectEol(text) {
  const source = String(text || '');
  const crlf = (source.match(/\r\n/g) || []).length;
  if (!crlf) return '\n';
  const lf = (source.match(/\n/g) || []).length - crlf;
  return crlf >= lf ? '\r\n' : '\n';
}

const setEol = StateEffect.define();

/** The line break the editor's text is written with. */
const eolField = StateField.define({
  create() { return '\n'; },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEol)) return e.value;
    return value;
  },
});

/** The editor's text with the file's line breaks. */
function textOf(state) {
  return state.doc.sliceString(0, state.doc.length, state.field(eolField, false) || '\n');
}

/** `text` with every line break as `eol`: what the editor gives back for it. */
function normalizeEol(text, eol) {
  return String(text ?? '').replace(/\r\n|\r|\n/g, eol);
}

// ── Indentation in use ──────────────────────────────────────────────

const indentCompartment = new Compartment();

/** The extensions for indenting with spaces or tabs of `size` columns. */
function indentationConfig({ insertSpaces, size }) {
  return [
    indentUnit.of(insertSpaces ? ' '.repeat(size) : '\t'),
    EditorState.tabSize.of(size),
  ];
}

/** How the editor indents now: { insertSpaces, size }. */
function currentIndentation(state) {
  const unit = state.facet(indentUnit);
  return unit.includes('\t') ? { insertSpaces: false, size: state.tabSize } : { insertSpaces: true, size: getIndentUnit(state) };
}

/** The columns of a line's leading spaces and tabs. */
function leadingColumns(text, tabSize) {
  let cols = 0;
  for (const ch of text) {
    if (ch === ' ') cols++;
    else if (ch === '\t') cols += tabSize - (cols % tabSize);
    else break;
  }
  return cols;
}

/**
 * The changes that write every line's indentation with tabs, or with spaces,
 * of `size` columns (VS Code's Convert Indentation).
 */
function convertIndentationChanges(state, { insertSpaces, size }) {
  const changes = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const lead = /^[ \t]*/.exec(line.text)[0];
    if (!lead) continue;
    const cols = leadingColumns(lead, state.tabSize);
    const insert = insertSpaces ? ' '.repeat(cols) : '\t'.repeat(Math.floor(cols / size)) + ' '.repeat(cols % size);
    if (insert !== lead) changes.push({ from: line.from, to: line.from + lead.length, insert });
  }
  return changes;
}

// ── Indentation guides ──────────────────────────────────────────────
// A thin line at each step of a line's indentation, drawn by the line's
// ::before (no extra elements). A blank line takes the smaller of the
// indentation around it, so a guide runs through the blank lines of a block.

const GUIDE_LOOKAROUND = 100;

function lineLevels(state, number, unitCols, cache) {
  if (cache.has(number)) return cache.get(number);
  const text = state.doc.line(number).text;
  let levels;
  if (text.trim()) levels = Math.floor(leadingColumns(text, state.tabSize) / unitCols);
  else {
    const around = (direction) => {
      for (let n = number + direction, i = 0; n >= 1 && n <= state.doc.lines && i < GUIDE_LOOKAROUND; n += direction, i++) {
        const other = state.doc.line(n).text;
        if (other.trim()) return Math.floor(leadingColumns(other, state.tabSize) / unitCols);
      }
      return 0;
    };
    levels = Math.min(around(-1), around(1));
  }
  cache.set(number, levels);
  return levels;
}

const guideMarks = new Map(); // "levels/unit" → its line decoration

function guideMark(levels, unitCols) {
  const key = `${levels}/${unitCols}`;
  if (!guideMarks.has(key)) {
    guideMarks.set(key, Decoration.line({
      class: 'cm-indent-guides',
      attributes: { style: `--cm-indent-levels: ${levels}; --cm-indent-unit: ${unitCols}` },
    }));
  }
  return guideMarks.get(key);
}

const indentGuidesPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || update.startState.facet(indentUnit) !== update.state.facet(indentUnit)
      || update.startState.tabSize !== update.state.tabSize) {
      this.decorations = this.build(update.view);
    }
  }
  build(view) {
    const { state } = view;
    const unitCols = Math.max(1, getIndentUnit(state));
    const cache = new Map();
    const marks = [];
    let lastLine = 0;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = state.doc.lineAt(pos);
        if (line.number > lastLine) {
          const levels = lineLevels(state, line.number, unitCols, cache);
          if (levels > 0) marks.push(guideMark(levels, unitCols).range(line.from));
          lastLine = line.number;
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(marks);
  }
}, { decorations: v => v.decorations });

const indentGuidesTheme = EditorView.theme({
  '.cm-line.cm-indent-guides': { position: 'relative' },
  '.cm-line.cm-indent-guides::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '6px',
    width: 'calc(var(--cm-indent-levels) * var(--cm-indent-unit) * 1ch)',
    backgroundImage: 'repeating-linear-gradient(to right, rgba(255, 255, 255, 0.09) 0 1px, transparent 1px calc(var(--cm-indent-unit) * 1ch))',
    pointerEvents: 'none',
  },
});

const indentGuides = [indentGuidesPlugin, indentGuidesTheme];

// ── Whitespace shown ────────────────────────────────────────────────
// One choice for every editor, remembered, followed by every open editor in
// this window and in the others (localStorage is shared by the app's windows).

const SHOW_WHITESPACE_KEY = 'editorShowWhitespace';
const SHOW_WHITESPACE_EVENT = 'editor-show-whitespace';
const whitespaceCompartment = new Compartment();

function readShowWhitespace() {
  try { return localStorage.getItem(SHOW_WHITESPACE_KEY) === 'true'; } catch { return false; }
}

function setShowWhitespace(on) {
  try { localStorage.setItem(SHOW_WHITESPACE_KEY, String(!!on)); } catch {}
  window.dispatchEvent(new CustomEvent(SHOW_WHITESPACE_EVENT, { detail: !!on }));
}

/** Spaces and tabs drawn, and the ones at the end of a line marked, when `on`. */
function whitespaceExtension(on) {
  return on ? [highlightWhitespace(), highlightTrailingWhitespace()] : [];
}

const whitespaceSync = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.apply = (on) => view.dispatch({ effects: whitespaceCompartment.reconfigure(whitespaceExtension(on)) });
    this.onEvent = (e) => this.apply(!!e.detail);
    this.onStorage = (e) => { if (e.key === SHOW_WHITESPACE_KEY) this.apply(readShowWhitespace()); };
    window.addEventListener(SHOW_WHITESPACE_EVENT, this.onEvent);
    window.addEventListener('storage', this.onStorage);
  }
  destroy() {
    window.removeEventListener(SHOW_WHITESPACE_EVENT, this.onEvent);
    window.removeEventListener('storage', this.onStorage);
  }
});

/** Whether the editor shows its whitespace now. */
function showsWhitespace(state) {
  const value = whitespaceCompartment.get(state);
  return Array.isArray(value) ? value.length > 0 : !!value;
}

export {
  DEFAULT_INDENT, detectIndentation, detectEol, setEol, eolField, textOf, normalizeEol,
  indentCompartment, indentationConfig, currentIndentation, leadingColumns, convertIndentationChanges, indentGuides,
  whitespaceCompartment, whitespaceExtension, whitespaceSync, readShowWhitespace, setShowWhitespace, showsWhitespace,
};
