// The change marks beside the line numbers: a thin rounded bar on each line
// that is new (green) or edited (blue), and a short dash between two lines
// where lines were removed (red). They are measured from a base text the
// editor's host gives (setChangeBase): git's staged copy of the file, or the
// text as it was opened (viewer-panel.js). With no base there are no marks.
import { StateEffect, StateField, Text } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { Chunk } from '@codemirror/merge';

const DIFF = { scanLimit: 500 };
// Above this many (old lines × new lines) in one change, lines are paired in order.
const MAX_ALIGN_CELLS = 40000;

const setChangeBase = StateEffect.define();

// ── Which line is what: pure, so the tests can check it ─────────────

/** How alike two different lines are, 0 to 1: the share of their common start and end. */
function similarity(a, b) {
  const x = a.trim();
  const y = b.trim();
  const longest = Math.max(x.length, y.length);
  if (!longest) return 1;
  const shortest = Math.min(x.length, y.length);
  let start = 0;
  while (start < shortest && x[start] === y[start]) start++;
  let end = 0;
  while (end < shortest - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  return (start + end) / longest;
}

/**
 * The old lines of a change set against its new ones, in order: for each new
 * line the old line it comes from, or -1 for a new one. Equal lines are kept
 * together first, then the most alike.
 */
function alignLines(before, after) {
  const n = before.length;
  const m = after.length;
  const pairs = new Array(m).fill(-1);
  if (n * m > MAX_ALIGN_CELLS) {
    for (let j = 0; j < Math.min(n, m); j++) pairs[j] = j;
    return pairs;
  }
  const score = (i, j) => (before[i] === after[j] ? 10 : 1 + similarity(before[i], after[j]));
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], score(i, j) + best[i + 1][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (best[i][j] === score(i, j) + best[i + 1][j + 1]) pairs[j++] = i++;
    // On a tie the new line is the added one, so the old line pairs further down.
    else if (best[i][j] === best[i][j + 1]) j++;
    else i++;
  }
  return pairs;
}

/** The lines of `doc` a chunk covers on one side ([from, to), empty when from is to). */
function chunkLines(doc, from, to) {
  if (from >= to) return { first: from > doc.length ? doc.lines + 1 : doc.lineAt(from).number, lines: [] };
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(Math.min(to - 1, doc.length)).number;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(doc.line(n).text);
  return { first, lines };
}

/**
 * The marks of `doc` against `base`, by line number: { kind: 'added' |
 * 'changed' | null, deletedAbove, deletedBelow }.
 */
function lineMarks(base, doc, chunks) {
  const marks = new Map();
  const mark = (line) => {
    let value = marks.get(line);
    if (!value) marks.set(line, value = { kind: null, deletedAbove: false, deletedBelow: false });
    return value;
  };
  // Lines removed before line `line`; past the last line, below it.
  const removedBefore = (line) => {
    if (line > doc.lines) mark(doc.lines).deletedBelow = true;
    else mark(line).deletedAbove = true;
  };
  // An empty file has one empty line that is not a line of it: all is new.
  if (!base.length) {
    if (doc.length) for (let n = 1; n <= doc.lines; n++) mark(n).kind = 'added';
    return marks;
  }
  for (const chunk of chunks) {
    const before = chunkLines(base, chunk.fromA, chunk.toA).lines;
    const { first, lines: after } = chunkLines(doc, chunk.fromB, chunk.toB);
    const pairs = alignLines(before, after);
    let next = 0; // the first old line not yet accounted for
    for (let j = 0; j < after.length; j++) {
      const i = pairs[j];
      if (i < 0) {
        mark(first + j).kind = 'added';
        continue;
      }
      if (i > next) removedBefore(first + j);
      next = i + 1;
      if (before[i] !== after[j]) mark(first + j).kind = 'changed';
    }
    if (next < before.length) removedBefore(first + after.length);
  }
  return marks;
}

const NO_MARKS = { base: null, text: null, chunks: [], marks: new Map() };

function compare(text, doc) {
  const base = Text.of(text.split(/\r\n?|\n/));
  const chunks = Chunk.build(base, doc, DIFF);
  return { base, text, chunks, marks: lineMarks(base, doc, chunks) };
}

const changeField = StateField.define({
  create: () => NO_MARKS,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setChangeBase)) continue;
      return typeof effect.value === 'string' ? compare(effect.value, tr.state.doc) : NO_MARKS;
    }
    if (!tr.docChanged || !value.base) return value;
    const chunks = Chunk.updateB(value.chunks, value.base, tr.state.doc, tr.changes, DIFF);
    return { ...value, chunks, marks: lineMarks(value.base, tr.state.doc, chunks) };
  },
});

// ── The gutter ──────────────────────────────────────────────────────

class ChangeMarker extends GutterMarker {
  /** `start` and `end`: the bar's rounded ends, where a run of lines of one kind begins and ends. */
  constructor({ kind = null, start = false, end = false, deletedAbove = false, deletedBelow = false } = {}) {
    super();
    Object.assign(this, { kind, start, end, deletedAbove, deletedBelow });
  }

  eq(other) {
    return this.kind === other.kind && this.start === other.start && this.end === other.end
      && this.deletedAbove === other.deletedAbove && this.deletedBelow === other.deletedBelow;
  }

  toDOM() {
    const wrap = document.createElement('span');
    const add = (className) => {
      const el = document.createElement('div');
      el.className = className;
      wrap.appendChild(el);
    };
    if (this.kind) {
      add(`cm-change-bar cm-change-${this.kind}${this.start ? ' cm-change-start' : ''}${this.end ? ' cm-change-end' : ''}`);
    }
    if (this.deletedAbove) add('cm-change-deleted cm-change-deleted-above');
    if (this.deletedBelow) add('cm-change-deleted cm-change-deleted-below');
    return wrap;
  }
}

/** The marker of the lines `first` to `last` (more than one for a folded block), or null. */
function markerFor(marks, first, last) {
  let kind = null;
  let deletedBelow = false;
  for (let n = first; n <= last; n++) {
    const mark = marks.get(n);
    if (!mark) continue;
    if (mark.kind && kind !== 'changed') kind = mark.kind;
    if (mark.deletedBelow || (n > first && mark.deletedAbove)) deletedBelow = true;
  }
  const deletedAbove = !!marks.get(first)?.deletedAbove;
  if (!kind && !deletedAbove && !deletedBelow) return null;
  return new ChangeMarker({
    kind,
    start: !!kind && (deletedAbove || marks.get(first - 1)?.kind !== kind),
    end: !!kind && (deletedBelow || !!marks.get(last + 1)?.deletedAbove || marks.get(last + 1)?.kind !== kind),
    deletedAbove,
    deletedBelow,
  });
}

const changeGutterTheme = EditorView.theme({
  '.cm-changeGutter': { width: '8px' },
  '.cm-changeGutter .cm-gutterElement': { position: 'relative', padding: 0 },
  '.cm-change-bar, .cm-change-deleted': {
    position: 'absolute',
    left: '2px',
    width: '4px',
  },
  '.cm-change-bar': { top: 0, bottom: 0 },
  '.cm-change-bar.cm-change-start': { top: '1px', borderTopLeftRadius: '2px', borderTopRightRadius: '2px' },
  '.cm-change-bar.cm-change-end': { bottom: '1px', borderBottomLeftRadius: '2px', borderBottomRightRadius: '2px' },
  '.cm-change-added': { backgroundColor: 'var(--cm-change-added, #50fa7b)' },
  '.cm-change-changed': { backgroundColor: 'var(--cm-change-changed, #8be9fd)' },
  // A short dash across the boundary between the two lines.
  '.cm-change-deleted': {
    height: '8px',
    borderRadius: '2px',
    backgroundColor: 'var(--cm-change-deleted, #ff5555)',
    zIndex: 1,
  },
  '.cm-change-deleted-above': { top: '-4px' },
  '.cm-change-deleted-below': { bottom: '-4px' },
});

/** The change marks' gutter. It marks nothing until it is given a base (setEditorChangeBase). */
function changeMarks() {
  return [
    changeField,
    gutter({
      class: 'cm-changeGutter',
      lineMarker(view, block) {
        const { marks } = view.state.field(changeField);
        if (!marks.size) return null;
        const { doc } = view.state;
        return markerFor(marks, doc.lineAt(block.from).number, doc.lineAt(block.to).number);
      },
      lineMarkerChange: update => update.startState.field(changeField) !== update.state.field(changeField),
    }),
    changeGutterTheme,
  ];
}

/** Mark the editor's changes from `text`; null takes the marks away. */
function setEditorChangeBase(view, text) {
  const current = view?.state?.field(changeField, false);
  if (!current) return;
  const next = typeof text === 'string' ? text : null;
  if (current.text !== next) view.dispatch({ effects: setChangeBase.of(next) });
}

export { changeMarks, setEditorChangeBase, changeField, setChangeBase, alignLines, markerFor };
