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

  /** `replace` with $$, $&, $1…$99 and $<name> taken from the match `m`, as String.prototype.replace does. */
  function expandReplacement(replace, m) {
    return replace.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (whole, token, name) => {
      if (token === '$') return '$';
      if (token === '&') return m[0];
      if (token === '`' || token === "'") return whole;
      if (name !== undefined) return m.groups && Object.hasOwn(m.groups, name) ? (m.groups[name] ?? '') : whole;
      const two = Number(token);
      if (token.length === 2 && two < m.length) return m[two] ?? '';
      const one = Number(token[0]);
      if (one > 0 && one < m.length) return (m[one] ?? '') + token.slice(1);
      return whole;
    });
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

  const api = { escapeRegExp, buildSearchRegExp, matchesInLine, replacementFor, expandReplacement, globListMatcher };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
