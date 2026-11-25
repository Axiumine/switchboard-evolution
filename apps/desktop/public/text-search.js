// Copied from packages/shared/text-search.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// text-search.js — the query of a search box (a VS Code-like find, in a file or
// across a folder) as a regular expression, the matches on one line, and the
// text that replaces a match.
//
// Used by the desktop's search worker and Files tab, the editor's find bar,
// and the phone app (scripts/sync-shared.mjs there): no DOM, no Node.
(function (root) {
  const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

  function escapeRegExp(text) {
    return String(text).replace(ESCAPE_RE, '\\$&');
  }

  // A word character for "Match Whole Word": \w and the Latin, Greek and
  // Cyrillic letters (no Unicode mode, which would refuse patterns such as
  // [\w-] that people type).
  const WORD = '[\\w\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF]';

  /**
   * A global RegExp for { query, isRegex, matchCase, wholeWord }, or throws
   * an Error whose message says what is wrong with the pattern.
   */
  function buildSearchRegExp({ query, isRegex = false, matchCase = false, wholeWord = false } = {}) {
    const text = String(query || '');
    if (!text) throw new Error('Type something to search for');
    let source = isRegex ? text : escapeRegExp(text);
    if (wholeWord) source = `(?<!${WORD})(?:${source})(?!${WORD})`;
    try {
      return new RegExp(source, `g${matchCase ? '' : 'i'}`);
    } catch (err) {
      throw new Error(`Invalid regular expression: ${err.message.replace(/^Invalid regular expression: /, '')}`);
    }
  }

  /**
   * Matches of `regex` (from buildSearchRegExp) in one line of text, as
   * [{ column, length, text }] with UTF-16 columns. Empty matches are skipped
   * (a pattern like `a*` would otherwise match between every character).
   */
  function matchesInLine(regex, line, limit = Infinity) {
    const out = [];
    regex.lastIndex = 0;
    let m;
    while (out.length < limit && (m = regex.exec(line)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex = m.index + (line.codePointAt(m.index) > 0xffff ? 2 : 1);
        if (regex.lastIndex > line.length) break;
        continue;
      }
      out.push({ column: m.index, length: m[0].length, text: m[0] });
    }
    regex.lastIndex = 0;
    return out;
  }

  /**
   * What replaces `matchText` (one match of the query): the replace text as
   * typed, or with $1, $<name>, $& expanded when the query is a regular
   * expression. `context` is the whole line and the match's column, so
   * lookbehinds and anchors see the same text they matched in.
   */
  function replacementFor(options, matchText, replace, context = null) {
    const text = String(replace ?? '');
    if (!options.isRegex) return text;
    const regex = buildSearchRegExp(options);
    if (context && typeof context.line === 'string' && Number.isInteger(context.column)) {
      const sticky = new RegExp(regex.source, regex.flags.replace('g', '') + 'y');
      sticky.lastIndex = context.column;
      const m = sticky.exec(context.line);
      if (m && m[0] === matchText) return expandReplacement(text, m);
    }
    const single = new RegExp(regex.source, regex.flags.replace('g', ''));
    const m = single.exec(matchText);
    return m ? expandReplacement(text, m) : text;
  }

  const GROUP_TOKEN = /^\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/;

  /**
   * `replace` with what a regular expression's match `m` gives it, as VS Code
   * does: $$, $&, $1…$99 and $<name> as String.prototype.replace takes them;
   * \n a new line, \t a tab, \\ a backslash; and \u, \l (the next character
   * upper or lower case) and \U, \L (all of it) before a group: "\U$1".
   */
  function expandReplacement(replace, m) {
    let out = '';
    let caseOps = [];
    for (let i = 0; i < replace.length; i += 1) {
      const c = replace[i];
      if (c === '\\' && i + 1 < replace.length) {
        const next = replace[i + 1];
        if (next === '\\') { out += '\\'; i += 1; continue; }
        if (next === 'n') { out += '\n'; i += 1; continue; }
        if (next === 't') { out += '\t'; i += 1; continue; }
        if (next === 'u' || next === 'l' || next === 'U' || next === 'L') { caseOps.push(next); i += 1; continue; }
      }
      const group = c === '$' ? GROUP_TOKEN.exec(replace.slice(i)) : null;
      if (!group) { out += c; continue; }
      i += group[0].length - 1;
      const [whole, token, name] = group;
      if (token === '$') { out += '$'; continue; }
      if (token === '`' || token === "'") { out += whole; continue; }
      let piece = null;
      let rest = '';
      if (token === '&') piece = m[0];
      else if (name !== undefined) piece = m.groups && Object.hasOwn(m.groups, name) ? (m.groups[name] ?? '') : null;
      else if (token.length === 2 && Number(token) < m.length) piece = m[Number(token)] ?? '';
      else if (Number(token[0]) > 0 && Number(token[0]) < m.length) { piece = m[Number(token[0])] ?? ''; rest = token.slice(1); }
      if (piece === null) { out += whole; continue; }
      out += applyCaseOps(piece, caseOps) + rest;
      caseOps = [];
    }
    return out;
  }

  /** `text` with \u \l (one character each) and \U \L (the rest of it) applied in order. */
  function applyCaseOps(text, ops) {
    if (!ops.length) return text;
    let out = '';
    let all = '';
    let op = 0;
    for (const ch of text) {
      if (all === 'U') { out += ch.toUpperCase(); continue; }
      if (all === 'L') { out += ch.toLowerCase(); continue; }
      const next = op < ops.length ? ops[op++] : '';
      if (next === 'U' || next === 'L') all = next;
      out += next === 'u' || next === 'U' ? ch.toUpperCase() : next === 'l' || next === 'L' ? ch.toLowerCase() : ch;
    }
    return out;
  }

  /**
   * `replacement` written in the case of `matched`, as VS Code's Preserve
   * Case: all upper or all lower case, a capital first letter, or the same
   * for each part of a name joined by - or _ ("foo-bar" → "Baz-Qux" for
   * "Foo-Bar").
   */
  function preserveCase(matched, replacement) {
    const match = String(matched ?? '');
    const text = String(replacement ?? '');
    if (!match || !text) return text;
    const hyphens = sameParts(match, text, '-');
    const underscores = sameParts(match, text, '_');
    if (hyphens !== underscores) {
      const sep = hyphens ? '-' : '_';
      const parts = match.split(sep);
      return text.split(sep).map((part, i) => preserveCase(parts[i], part)).join(sep);
    }
    if (match.toUpperCase() === match && match.toLowerCase() !== match) return text.toUpperCase();
    if (match.toLowerCase() === match && match.toUpperCase() !== match) return text.toLowerCase();
    const first = match[0];
    if (first.toUpperCase() === first && first.toLowerCase() !== first) return text[0].toUpperCase() + text.slice(1);
    if (first.toLowerCase() === first && first.toUpperCase() !== first) return text[0].toLowerCase() + text.slice(1);
    return text;
  }

  function sameParts(match, text, sep) {
    return match.includes(sep) && text.includes(sep) && match.split(sep).length === text.split(sep).length;
  }

  /**
   * A list of globs as typed in "files to include / exclude" ("src, *.ts,
   * docs/**"), as one test of a relative path ('/' separators). A glob without
   * a slash matches a name at any depth, and a folder matches what is in it.
   * Returns null for an empty list.
   */
  function globListMatcher(list) {
    const globs = splitGlobList(String(list || '')).map(s => s.trim()).filter(Boolean);
    if (!globs.length) return null;
    const tests = globs.map((glob) => {
      let g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
      const anchored = g.startsWith('/') || g.slice(0, -1).includes('/');
      g = g.replace(/^\/+/, '').replace(/\/+$/, '');
      const body = globToRegExpSource(g);
      const prefix = anchored ? '^' : '^(?:.*/)?';
      return new RegExp(`${prefix}${body}(?:/.*)?$`);
    });
    return (relPath) => tests.some(re => re.test(relPath));
  }

  /** Split at the commas that are not inside {…}, so "*.{js,ts}, docs" is two globs. */
  function splitGlobList(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}' && depth > 0) depth -= 1;
      else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
  }

  function globToRegExpSource(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i += 1) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          // "**/" is any number of folders, a lone "**" anything at all.
          if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
        } else out += '[^/]*';
      } else if (c === '?') out += '[^/]';
      else if (c === '{') {
        const end = glob.indexOf('}', i);
        if (end < 0) { out += '\\{'; continue; }
        const parts = glob.slice(i + 1, end).split(',').map(globToRegExpSource);
        out += `(?:${parts.join('|')})`;
        i = end;
      } else if (c === '[') {
        const end = glob.indexOf(']', i + 1);
        if (end < 0) { out += '\\['; continue; }
        let set = glob.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (set.startsWith('!')) set = '^' + set.slice(1);
        out += `[${set}]`;
        i = end;
      } else out += escapeRegExp(c);
    }
    return out;
  }

  const api = { escapeRegExp, buildSearchRegExp, matchesInLine, replacementFor, expandReplacement, preserveCase, globListMatcher };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
