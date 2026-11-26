// tui-prompt-reader.js — reads the prompt being typed in a CLI's own input
// box, from the screen of its terminal, for the prompt improver
// (prompt-improver-view.js).
//
// The desktop has no text field of its own: what the user types stays in the
// CLI's TUI. This reads it back from the xterm buffer, one reader per CLI,
// and says whether the reading is sure (`confident`): only then may the
// improver clear the box and type the new prompt in its place.
//
// What each TUI shows (Claude Code 2.1.332, Codex 0.172.0, OpenCode 2.4.2):
//   - placeholders are faint (Claude, Codex: the dim attribute) or grey
//     (OpenCode: the colour of the "·" in its status row), and so is Claude's
//     ghost completion: faint text is never part of the prompt;
//   - Claude: the box sits between the last two rows of "─"; its first row
//     starts with "❯", the next ones are indented by two. A long prompt
//     scrolls inside the box ("─── ↑ 3 more ───"): only part of it is on
//     screen. A long paste shows as "[Pasted text #1 +20 lines]";
//   - Codex: the composer starts at the last bold "›" that is not inverse (an
//     inverse "›" is the selected item of a menu, such as "Update now"),
//     continues indented by two, and ends at the last empty row before the
//     footer;
//   - OpenCode: the last box of "┃" rows closed by "╹▀▀▀"; one empty row
//     above and below the text, the agent and model in its last row.
//
// A row here is `{ chars, dim, bold, inverse, fg }`, one array entry per
// character on screen (rowsFromXterm builds them from a terminal). The
// prompt's lines are joined back where the TUI wrapped them for width.

(function (root) {
  const RULE = '─';

  function rowText(row) {
    return row ? row.chars.join('') : '';
  }

  /** Rows of the active buffer, the last `count` above the bottom of the screen. */
  function rowsFromXterm(terminal, count = 60) {
    const buffer = terminal && terminal.buffer && terminal.buffer.active;
    if (!buffer) return [];
    const end = buffer.baseY + terminal.rows;
    const start = Math.max(0, end - count);
    const rows = [];
    const cell = buffer.getNullCell ? buffer.getNullCell() : undefined;
    for (let y = start; y < end; y++) {
      const line = buffer.getLine(y);
      const row = { chars: [], dim: [], bold: [], inverse: [], fg: [] };
      if (line) {
        for (let x = 0; x < line.length; x++) {
          const c = line.getCell(x, cell);
          if (!c || c.getWidth() === 0) continue;
          row.chars.push(c.getChars() || ' ');
          row.dim.push(!!c.isDim());
          row.bold.push(!!c.isBold());
          row.inverse.push(!!c.isInverse());
          row.fg.push(c.isFgDefault() ? null : c.getFgColor());
        }
      }
      while (row.chars.length && row.chars[row.chars.length - 1] === ' ') {
        row.chars.pop(); row.dim.pop(); row.bold.pop(); row.inverse.pop(); row.fg.pop();
      }
      rows.push(row);
    }
    return rows;
  }

  /** A row from plain text with marks: tests and fixtures. `styles` maps an index to {dim, bold, inverse, fg}. */
  function rowFromText(text, style = {}) {
    const chars = Array.from(text);
    const at = (key, i) => {
      const s = typeof style === 'function' ? style(i, chars[i]) : style;
      return s && s[key] !== undefined ? s[key] : (key === 'fg' ? null : false);
    };
    return {
      chars,
      dim: chars.map((_, i) => at('dim', i)),
      bold: chars.map((_, i) => at('bold', i)),
      inverse: chars.map((_, i) => at('inverse', i)),
      fg: chars.map((_, i) => at('fg', i)),
    };
  }

  // The characters of `row` from `from`, without those `skip(i)` leaves out.
  function textFrom(row, from, skip) {
    let out = '';
    for (let i = from; i < row.chars.length; i++) if (!skip(i)) out += row.chars[i];
    return out.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
  }

  const firstNonSpace = (row) => row.chars.findIndex((c) => c !== ' ' && c !== '\u00a0');

  // The last row with something on it: a TUI that has just started draws at
  // the top, with empty rows under it.
  function lastFilled(rows) {
    for (let i = rows.length - 1; i >= 0; i--) if (rowText(rows[i]).trim()) return i;
    return -1;
  }

  /**
   * The prompt's lines joined back: a line that ends where the next line's
   * first word would not have fitted was wrapped by the TUI, so the two are
   * one line with a space between; otherwise the user pressed Shift+Enter.
   */
  function joinLines(lines, width) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : null;
      if (prev !== null && prev.length && line.length && width > 0) {
        const word = line.split(' ')[0];
        if (prev.length + 1 + word.length > width && prev.length > width * 0.5) {
          out[out.length - 1] += ` ${line}`;
          continue;
        }
      }
      out.push(line);
    }
    return out.join('\n');
  }

  function result(lines, width, confident, reason) {
    const text = joinLines(lines, width).replace(/^\n+|\s+$/g, '');
    return { text, confident: !!confident, reason: reason || null };
  }

  function readClaude(rows, cols) {
    const rules = [];
    rows.forEach((row, i) => {
      const t = rowText(row);
      if ((t.match(new RegExp(RULE, 'g')) || []).length >= 10 && t.trim().startsWith(RULE)) rules.push(i);
    });
    if (rules.length < 2) return null;
    const bottom = rules[rules.length - 1];
    const top = rules[rules.length - 2];
    if (bottom - top < 2 || lastFilled(rows) - bottom > 12) return null;
    const first = rows[top + 1];
    const start = firstNonSpace(first);
    // Scrolled: the first rows (and the ❯) are above the box's top.
    const partial = /[↑↓]\s*\d+\s*more/.test(rowText(rows[top])) || /[↑↓]\s*\d+\s*more/.test(rowText(rows[bottom]));
    const prompted = start >= 0 && /[❯>]/.test(first.chars[start]);
    if (!prompted && !partial) return null;
    const lines = [];
    for (let y = top + 1; y < bottom; y++) {
      const row = rows[y];
      const lead = y === top + 1 && prompted;
      let line = textFrom(row, lead ? start + 1 : 0, (i) => row.dim[i]);
      line = lead ? line.replace(/^ /, '') : line.replace(/^ {2}/, '');
      lines.push(line);
    }
    const res = result(lines, (cols || first.chars.length) - 2, !partial, partial ? 'Only part of a long prompt is on screen.' : null);
    if (/\[Pasted text #\d+/.test(res.text)) return { ...res, confident: false, reason: 'A pasted block shows only as a placeholder.' };
    return res;
  }

  function readCodex(rows, cols) {
    let at = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const s = firstNonSpace(rows[i]);
      if (s === 0 && rows[i].chars[0] === '›') {
        if (rows[i].inverse[0]) return { text: '', confident: false, reason: 'Codex is showing a menu.' };
        at = i;
        break;
      }
    }
    if (at < 0 || lastFilled(rows) - at > 30) return null;
    // The composer ends at the last empty row before the footer (empty rows
    // below the footer, at the bottom of the screen, do not count).
    let last = rows.length - 1;
    while (last > at && !rowText(rows[last]).trim()) last--;
    let end = last + 1;
    for (let i = last; i > at; i--) {
      if (!rowText(rows[i]).trim()) { end = i; break; }
    }
    const lines = [];
    for (let y = at; y < end; y++) {
      const row = rows[y];
      let line = textFrom(row, y === at ? 1 : 0, (i) => row.dim[i]);
      line = y === at ? line.replace(/^ /, '') : line.replace(/^ {2}/, '');
      lines.push(line);
    }
    return result(lines, (cols || rows[at].chars.length) - 2, true, null);
  }

  function readOpencode(rows, cols) {
    let bottom = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const t = rowText(rows[i]).trim();
      if (t.startsWith('╹') && t.includes('▀')) { bottom = i; break; }
    }
    if (bottom < 1) return null;
    let top = bottom - 1;
    const bar = (row) => {
      const s = firstNonSpace(row);
      return s >= 0 && row.chars[s] === '┃' ? s : -1;
    };
    if (bar(rows[top]) < 0) return null;
    while (top - 1 >= 0 && bar(rows[top - 1]) >= 0) top--;
    const status = rows[bottom - 1];
    // The grey of the status row's "·" is the placeholder's.
    let muted = null;
    const dot = status.chars.indexOf('·');
    if (dot >= 0) muted = status.fg[dot];
    const lines = [];
    for (let y = top; y < bottom - 1; y++) {
      const row = rows[y];
      const from = bar(row) + 1;
      let line = textFrom(row, from, (i) => row.dim[i] || (muted !== null && row.fg[i] === muted));
      line = line.replace(/^ {2}/, '');
      lines.push(line);
    }
    // One empty row of padding above and below the text.
    if (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const width = (cols || status.chars.length) - (bar(status) + 1) - 4;
    const res = result(lines, width, true, null);
    if (muted === null && /^Ask anything/.test(res.text)) return { text: '', confident: true, reason: null };
    return res;
  }

  const READERS = { claude: readClaude, codex: readCodex, opencode: readOpencode };

  /**
   * The prompt in the input box of `cli`'s TUI: `{ text, confident, reason }`.
   * Not confident (and maybe empty) when the box was not found, shows only
   * part of the prompt, or is a menu.
   */
  function readTuiPrompt(rows, cli, options = {}) {
    const read = READERS[cli];
    if (!read || !Array.isArray(rows) || !rows.length) return { text: '', confident: false, reason: 'The input box was not found.' };
    let res = null;
    try { res = read(rows, options.cols || 0); } catch { res = null; }
    return res || { text: '', confident: false, reason: 'The input box was not found.' };
  }

  // Ctrl+E (end of the line, where the cursor stands after typing), then one
  // Backspace per character and a few more: Backspace in an empty box does
  // nothing in all three. One write: the TUIs take it as keys, not a paste.
  function clearKeys(text) {
    return `\x05${'\x7f'.repeat(Array.from(String(text || '')).length + 4)}`;
  }

  // The prompt as keys: its lines joined by Shift+Enter (CSI u), so the TUI
  // shows all of it, editable, and nothing is sent. Control characters out.
  function typeKeys(text) {
    // eslint-disable-next-line no-control-regex
    const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(/\t/g, '  ');
    return clean.split('\n').join('\x1b[13;2u');
  }

  const api = { readTuiPrompt, rowsFromXterm, rowFromText, rowText, joinLines, clearKeys, typeKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TuiPromptReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
