/** @jest-environment node */
const { Terminal } = require('@xterm/xterm');

const { isFocusReport, quietReplies } = require('../terminal-replies.cjs');

// What a Claude session's history carries: it asks its terminal where the
// cursor is five times a second, so an idle hour fills the replay with these.
const CURSOR_QUESTION = '\x1b[?6n';
const QUESTIONS = [
  '\x1b[6n', // cursor position
  '\x1b[5n', // status
  '\x1b[c', // primary device attributes
  '\x1b[>c', // secondary device attributes
  '\x1b[?2026$p', // a private mode
  '\x1b[4$p', // an ANSI mode
  '\x1bP$qm\x1b\\', // a setting (DECRQSS)
  '\x1b]11;?\x07', // the background colour
  '\x1b]4;1;?\x07', // a palette colour
].join('');

/** Writes `data` to a terminal and resolves with what the terminal sent back. */
function replies(term, data) {
  const sent = [];
  term.onData((reply) => sent.push(reply));
  return new Promise((resolve) => term.write(data, () => resolve(sent)));
}

describe('the phone terminal answers no questions', () => {
  it('xterm on its own answers every question in a replay', async () => {
    const sent = await replies(new Terminal(), `ready ${CURSOR_QUESTION.repeat(1000)}`);
    expect(sent).toHaveLength(1000);
    expect(sent[0]).toBe('\x1b[?1;7R');
  });

  it('answers none of them, so a replay sends nothing to the session', async () => {
    const term = new Terminal();
    quietReplies(term);
    expect(await replies(term, `ready ${CURSOR_QUESTION.repeat(1000)}${QUESTIONS}`)).toEqual([]);
  });

  it('still draws the text around the questions', async () => {
    const term = new Terminal();
    quietReplies(term);
    await replies(term, `one${CURSOR_QUESTION}two\x1b[ctwo`);
    expect(term.buffer.active.getLine(0).translateToString(true)).toBe('onetwotwo');
  });

  it('still lets a program set a colour', async () => {
    const term = new Terminal();
    // Registered before quietReplies, so it only sees what quietReplies passes on.
    const passed = [];
    term.parser.registerOscHandler(11, (data) => { passed.push(data); return false; });
    quietReplies(term);
    await replies(term, '\x1b]11;?\x07\x1b]11;rgb:11/11/18\x07');
    expect(passed).toEqual(['rgb:11/11/18']);
  });

  it('tells focus reports from typing', () => {
    expect(isFocusReport('\x1b[I')).toBe(true);
    expect(isFocusReport('\x1b[O')).toBe(true);
    expect(isFocusReport('i')).toBe(false);
    expect(isFocusReport('\x1b[A')).toBe(false);
  });
});
