/** @jest-environment node */
import { EditorSelection, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import {
  CURSOR_ACTIONS, addCursorsAtLineEnds, selectAllOccurrences, multipleCursors,
  columnSelectUp, columnSelectDown, columnSelectRight,
} from '../editor-page/cursors.js';
import { CURSOR_BUTTONS } from '../../src/components/files/CursorBar';

/** A command's target over a real EditorState: { state, dispatch } as CodeMirror's commands take it. */
function editor(doc, ranges) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to))),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  return {
    get state() { return state; },
    dispatch: (tr) => { state = tr.state; },
    ranges: () => state.selection.ranges.map((r) => [r.from, r.to]),
  };
}

describe('the cursors of the editor page', () => {
  it('puts a cursor at the end of every selected line (Shift+Alt+I)', () => {
    // The three lines end at 3, 7 and 11.
    const target = editor('one\ntwo\nsix', [[1, 9]]);
    expect(addCursorsAtLineEnds(target)).toBe(true);
    expect(target.ranges()).toEqual([[3, 3], [7, 7], [11, 11]]);
  });

  it('leaves out the line a selection ends at the start of', () => {
    const target = editor('one\ntwo\nsix', [[0, 8]]);
    addCursorsAtLineEnds(target);
    expect(target.ranges()).toEqual([[3, 3], [7, 7]]);
  });

  it('selects every occurrence of the word the cursor is in (All)', () => {
    const target = editor('foo = 1; bar = foo; foo()', [[1, 1]]);
    expect(selectAllOccurrences(target)).toBe(true);
    expect(target.ranges()).toEqual([[0, 3], [15, 18], [20, 23]]);
  });

  it('adds the next occurrence (Next)', () => {
    const target = editor('foo = 1; bar = foo; foo()', [[0, 3]]);
    CURSOR_ACTIONS.next(target);
    expect(target.ranges()).toEqual([[0, 3], [15, 18]]);
  });

  it('goes back to one cursor (One)', () => {
    const target = editor('foo = 1; bar = foo', [[0, 3], [15, 18]]);
    CURSOR_ACTIONS.one(target);
    expect(target.state.selection.ranges).toHaveLength(1);
  });

  it('has a command for every button of the bar', () => {
    for (const { action } of CURSOR_BUTTONS) expect(typeof CURSOR_ACTIONS[action]).toBe('function');
    expect(Object.keys(CURSOR_ACTIONS).sort()).toEqual(CURSOR_BUTTONS.map((b) => b.action).sort());
  });
});

describe('column selection from a hardware keyboard (Shift+Alt+Cmd+Arrows)', () => {
  function columnEditor(doc, at) {
    let state = EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions: multipleCursors() });
    return {
      get state() { return state; },
      dispatch: (tr) => { state = tr.state; },
      ranges: () => state.selection.ranges.map((r) => [r.anchor, r.head]),
    };
  }

  it('adds a cursor below in the same column, at the end of a shorter line', () => {
    // Lines start at 0, 5, 10 and 13; "ij" is shorter than the column.
    const target = columnEditor('abcd\nefgh\nij\nklmn', 3);
    for (let i = 0; i < 3; i++) columnSelectDown(target);
    expect(target.ranges()).toEqual([[3, 3], [8, 8], [12, 12], [16, 16]]);
    expect(target.state.selection.mainIndex).toBe(3);
  });

  it('shrinks back with Up and widens into selections with Right', () => {
    const target = columnEditor('abcd\nefgh\nijkl', 1);
    columnSelectDown(target);
    columnSelectDown(target);
    columnSelectUp(target);
    expect(target.ranges()).toEqual([[1, 1], [6, 6]]);
    columnSelectRight(target);
    expect(target.ranges()).toEqual([[1, 2], [6, 7]]);
  });

  it('has the keys in the editor page', () => {
    const state = EditorState.create({ extensions: multipleCursors() });
    const keys = state.facet(keymap).flat().map((b) => b.key);
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) {
      expect(keys).toContain(`Mod-Shift-Alt-${k}`);
    }
  });
});
