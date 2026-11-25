/** @jest-environment node */
import { EditorSelection, EditorState } from '@codemirror/state';

import { findExtension, findSummary, setFind, findNext, replaceOne, replaceAll } from '../editor-page/find.js';

/** A view's stand-in over a real EditorState: what the find commands use of a view. */
function editor(doc, { readOnly = false, at = 0 } = {}) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [findExtension(), EditorState.readOnly.of(readOnly)],
  });
  return {
    get state() { return state; },
    dispatch: (spec) => { state = state.update(spec).state; },
    selected: () => state.sliceDoc(state.selection.main.from, state.selection.main.to),
  };
}

describe('find and replace in the editor page', () => {
  it('finds, counts and selects the first match from the cursor on', () => {
    const view = editor('one two\ntwo\nthree two', { at: 5 });
    expect(setFind(view, { query: 'two' })).toEqual({ count: 3, current: 2, limited: false });
    expect(view.state.selection.main.from).toBe(8);
  });

  it('goes to the next and the previous match, round the end', () => {
    const view = editor('a x a x a');
    setFind(view, { query: 'a' });
    expect(findNext(view, 1).current).toBe(2);
    expect(findNext(view, 1).current).toBe(3);
    expect(findNext(view, 1).current).toBe(1);
    expect(findNext(view, -1).current).toBe(3);
  });

  it('follows the options: case, whole word, regular expression, and says what is wrong with a pattern', () => {
    const view = editor('Cat cat concat');
    expect(setFind(view, { query: 'cat' }).count).toBe(3);
    expect(setFind(view, { query: 'cat', matchCase: true }).count).toBe(2);
    expect(setFind(view, { query: 'cat', wholeWord: true }).count).toBe(2);
    expect(setFind(view, { query: '^cat', isRegex: true, matchCase: false }).count).toBe(1);
    expect(setFind(view, { query: '(', isRegex: true }).error).toMatch(/Invalid regular expression/);
  });

  it('replaces the selected match and moves on; the first press goes to a match', () => {
    const view = editor('foo bar foo', { at: 3 });
    setFind(view, { query: 'foo' }, { stay: true });
    replaceOne(view, 'baz');
    expect(view.state.doc.toString()).toBe('foo bar foo');
    expect(view.selected()).toBe('foo');
    replaceOne(view, 'baz');
    expect(view.state.doc.toString()).toBe('foo bar baz');
  });

  it('replaces all at once, with groups, case changes and Preserve Case, as the desktop', () => {
    const view = editor('getName setName');
    setFind(view, { query: '(get|set)Name', isRegex: true, matchCase: true });
    // \u, as in VS Code, applies to the group after it.
    expect(replaceAll(view, '\\u$1Value').replaced).toBe(2);
    expect(view.state.doc.toString()).toBe('GetValue SetValue');
    const cased = editor('Color color COLOR');
    setFind(cased, { query: 'color', preserveCase: true });
    replaceAll(cased, 'shade');
    expect(cased.state.doc.toString()).toBe('Shade shade SHADE');
  });

  it('does not replace in a read-only editor', () => {
    const view = editor('a a', { readOnly: true });
    setFind(view, { query: 'a' });
    expect(replaceAll(view, 'b').error).toBe('read-only');
    expect(view.state.doc.toString()).toBe('a a');
  });

  it('counts again as the text changes', () => {
    const view = editor('x');
    setFind(view, { query: 'x' });
    view.dispatch({ changes: { from: 1, insert: ' x x' } });
    expect(findSummary(view.state).count).toBe(3);
    expect(setFind(view, null)).toEqual({ count: 0, current: 0, limited: false });
  });
});
