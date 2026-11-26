// Reading the prompt typed in a CLI's TUI from its terminal screen
// (public/tui-prompt-reader.js). The screens copy what Claude Code 2.1.332,
// Codex 0.172.0 and OpenCode 2.4.2 draw, 100 columns wide (seen in tmux).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../public/tui-prompt-reader');

const R = T.rowFromText;
const plain = (t) => R(t);
const rule = (label = '') => R(`${label ? `─── ${label} ` : ''}${'─'.repeat(100 - (label ? label.length + 5 : 0))}`);
// A row whose text after `from` characters is faint (a placeholder).
const faintAfter = (t, from) => R(t, (i) => ({ dim: i >= from }));

function claudeScreen(inputRows, { top = rule(), bottom = rule() } = {}) {
  return [
    plain('  Some answer from the assistant'),
    plain(''),
    top,
    ...inputRows,
    bottom,
    plain('  Model: Opus | ⎇ main'),
    plain('  ⏵⏵ auto mode on (shift+tab to cycle)'),
  ];
}

test('Claude: one line, several lines, the placeholder and a ghost completion left out', () => {
  assert.deepEqual(T.readTuiPrompt(claudeScreen([plain('❯ fix the login bug pls')]), 'claude', { cols: 100 }),
    { text: 'fix the login bug pls', confident: true, reason: null });
  assert.deepEqual(T.readTuiPrompt(claudeScreen([
    plain('❯ line one of the prompt'), plain('  line two'), plain(''), plain('  line four after blank'),
  ]), 'claude', { cols: 100 }).text, 'line one of the prompt\nline two\n\nline four after blank');
  assert.deepEqual(T.readTuiPrompt(claudeScreen([faintAfter('❯ Try "refactor <filepath>"', 2)]), 'claude', { cols: 100 }),
    { text: '', confident: true, reason: null });
  assert.equal(T.readTuiPrompt(claudeScreen([faintAfter('❯ add tests for the parser', 20)]), 'claude', { cols: 100 }).text, 'add tests for the');
});

test('Claude: a session just started draws at the top, empty rows under it', () => {
  const screen = [...claudeScreen([plain('❯\u00a0add a unit test')]), ...Array.from({ length: 25 }, () => plain(''))];
  assert.deepEqual(T.readTuiPrompt(screen, 'claude', { cols: 100 }), { text: 'add a unit test', confident: true, reason: null });
});

test('Claude: a line wrapped for width is one line again', () => {
  const words = 'word '.repeat(19).trim(); // 94 characters
  const screen = claudeScreen([plain(`❯ ${words}`), plain('  continues here'), plain('  next line')]);
  assert.equal(T.readTuiPrompt(screen, 'claude', { cols: 100 }).text, `${words} continues here\nnext line`);
});

test('Claude: a long prompt scrolled in its box, or a paste placeholder, is not a sure reading', () => {
  const scrolled = T.readTuiPrompt(claudeScreen([plain('  Line 5: more text'), plain('  Line 6: more text')], { top: rule('↑ 8 more') }), 'claude', { cols: 100 });
  assert.equal(scrolled.confident, false);
  assert.match(scrolled.reason, /part of a long prompt/);
  const pasted = T.readTuiPrompt(claudeScreen([plain('❯ [Pasted text #1 +3 lines]')]), 'claude', { cols: 100 });
  assert.equal(pasted.confident, false);
  assert.match(pasted.reason, /pasted block/);
});

test('Claude: no box on screen (a menu, the trust question) is not a reading', () => {
  const screen = [plain(' Quick safety check: Is this a project you trust?'), plain(' ❯ No, exit'), plain('   Yes, I trust this folder')];
  assert.deepEqual(T.readTuiPrompt(screen, 'claude', { cols: 100 }), { text: '', confident: false, reason: 'The input box was not found.' });
});

const bold = (t, n = 1) => R(t, (i) => ({ bold: i < n }));
function codexScreen(composer) {
  return [
    plain('• Earlier answer'),
    plain(''),
    ...composer,
    plain(''),
    plain('  gpt-5 default · ~/work/demo'),
    plain('  ← for agents · ? for shortcuts'),
    plain(''),
  ];
}

test('Codex: the composer after the bold ›, up to the footer; the placeholder left out', () => {
  assert.deepEqual(T.readTuiPrompt(codexScreen([bold('› fix the login bug pls')]), 'codex', { cols: 100 }),
    { text: 'fix the login bug pls', confident: true, reason: null });
  assert.equal(T.readTuiPrompt(codexScreen([
    bold('› line one of the prompt'), plain('  line two'), plain(''), plain('  line four after blank'),
  ]), 'codex', { cols: 100 }).text, 'line one of the prompt\nline two\n\nline four after blank');
  const placeholder = R('› Ask Codex to do anything', (i) => ({ bold: i === 0, dim: i >= 2 }));
  assert.deepEqual(T.readTuiPrompt(codexScreen([placeholder]), 'codex', { cols: 100 }), { text: '', confident: true, reason: null });
});

test('Codex: a menu\'s selected item (bold and inverse ›) is not the composer', () => {
  const menu = [
    plain('  Release notes: https://example.com'),
    R('› 1. Update now (runs `brew upgrade --cask codex`)', (i) => ({ bold: true, inverse: i < 2 })),
    plain('  2. Skip'),
    plain('  3. Skip until next version'),
  ];
  const res = T.readTuiPrompt(menu, 'codex', { cols: 100 });
  assert.equal(res.confident, false);
  assert.match(res.reason, /menu/);
});

const BLUE = 0x7699fe;
const GREY = 0x808080;
const WHITE = 0xffffff;
const barRow = (t, style) => R(`  ┃${t}`, (i, ch) => (style ? style(i, ch) : { fg: i === 2 ? BLUE : WHITE }));
const statusRow = barRow('  Build · Big Pickle OpenCode Zen', (i, ch) => ({ fg: ch === '·' ? GREY : i === 2 ? BLUE : WHITE }));
function opencodeScreen(textRows) {
  return [
    barRow(''), barRow('  say hi in one word'), barRow(''),
    plain('     Hi'),
    plain(''),
    barRow(''),
    ...textRows,
    barRow(''),
    statusRow,
    plain(`  ╹${'▀'.repeat(90)}`),
    plain('  ~/work/demo  6.4K (3%)'),
  ];
}

test('OpenCode: the last box of ┃ rows, without its padding and status row; the grey placeholder left out', () => {
  assert.deepEqual(T.readTuiPrompt(opencodeScreen([barRow('  second prompt typed')]), 'opencode', { cols: 100 }),
    { text: 'second prompt typed', confident: true, reason: null });
  assert.equal(T.readTuiPrompt(opencodeScreen([barRow('  line one'), barRow('  line two'), barRow(''), barRow('  line four')]), 'opencode', { cols: 100 }).text,
    'line one\nline two\n\nline four');
  const placeholder = barRow('  Ask anything… "What is the tech stack?"', (i) => ({ fg: i === 2 ? BLUE : i >= 5 ? GREY : WHITE }));
  assert.deepEqual(T.readTuiPrompt(opencodeScreen([placeholder]), 'opencode', { cols: 100 }), { text: '', confident: true, reason: null });
});

test('no reader for a plain shell or an unknown CLI, nor for an empty screen', () => {
  assert.equal(T.readTuiPrompt([plain('$ ls')], 'terminal').confident, false);
  assert.equal(T.readTuiPrompt([], 'claude').confident, false);
  assert.equal(T.readTuiPrompt(null, 'codex').confident, false);
});

test('keys: clear with Ctrl+E and enough Backspaces; type lines with Shift+Enter, never Enter', () => {
  assert.equal(T.clearKeys('ab\ncd'), `\x05${'\x7f'.repeat(9)}`);
  assert.equal(T.clearKeys('é🙂'), `\x05${'\x7f'.repeat(6)}`, 'one per character, not per UTF-16 unit');
  assert.equal(T.typeKeys('one\r\ntwo\n\nfour\u0007\tend'), 'one\x1b[13;2utwo\x1b[13;2u\x1b[13;2ufour  end');
  assert.equal(T.typeKeys('x\ry').includes('\r'), false);
});

test('rows from an xterm buffer: one entry per character, wide characters once, trailing spaces trimmed', () => {
  const cells = [['❯', 1], [' ', 1], ['界', 2], ['', 0], ['a', 1], [' ', 1], [' ', 1]];
  const line = {
    length: cells.length,
    getCell: (x) => ({
      getChars: () => cells[x][0], getWidth: () => cells[x][1], isDim: () => x === 4, isBold: () => x === 0,
      isInverse: () => false, isFgDefault: () => x !== 4, getFgColor: () => GREY,
    }),
  };
  const terminal = { rows: 1, buffer: { active: { baseY: 0, getLine: () => line } } };
  const rows = T.rowsFromXterm(terminal, 5);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].chars, ['❯', ' ', '界', 'a']);
  assert.deepEqual(rows[0].dim, [false, false, false, true]);
  assert.deepEqual(rows[0].bold, [true, false, false, false]);
  assert.deepEqual(rows[0].fg, [null, null, null, GREY]);
});
