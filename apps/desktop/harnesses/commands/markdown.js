// Reading the Markdown of the CLIs' documentation pages: their tables, the
// text of a cell, its code spans and its first sentences.
//
// The command catalog is built from these pages twice: by
// scripts/build-command-catalog.mjs, which writes the snapshot packed with the
// app, and by the refresh at run time. Both use this file, so it has no
// dependencies and never touches the disk or the network.

/** Split a table row on its unescaped pipes; `\|` stays a literal pipe. */
function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const isSeparator = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
const isRow = (line) => /^\s*\|/.test(line);

/**
 * Every table of a page, in order: its column names, its rows (arrays of raw
 * Markdown cells, pipes unescaped) and the headings it sits under, outermost
 * first (`# Title` is level 1).
 */
function tables(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  const headings = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: inlineText(heading[2]) });
      continue;
    }
    if (!isRow(line) || !isSeparator(lines[i + 1] || '')) continue;
    const headers = splitRow(line).map(inlineText);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && isRow(lines[j]); j++) rows.push(splitRow(lines[j]));
    out.push({ headers, rows, headings: headings.map((h) => h.text) });
    i = j - 1;
  }
  return out;
}

/** The first table whose columns start with `headers`, or null. */
function findTable(md, headers, { under } = {}) {
  return tables(md).find((t) => headers.every((h, i) => t.headers[i] === h)
    && (!under || t.headings.includes(under))) || null;
}

/** The contents of the code spans of a Markdown fragment, in order. */
function codeSpans(md) {
  const out = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let m;
  while ((m = re.exec(String(md || '')))) out.push(m[2].trim());
  return out;
}

const TAGS = /<\/?(kbd|nobr|code|br|b|i|em|strong|sup|sub|span)\b[^>]*>/gi;

/**
 * The plain text of a Markdown fragment: links become their text, emphasis
 * and code marks go, a few inline HTML tags (kbd, nobr, code…) are removed.
 * Other angle brackets stay: `<Esc>` or `<path>` are text in these pages.
 */
function inlineText(md) {
  let text = String(md || '');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Twice, for a link whose text holds a code span with brackets.
  for (let k = 0; k < 2; k++) text = text.replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1');
  text = text.replace(TAGS, '');
  text = text.replace(/\{"([^"]*)"\}/g, '$1');
  text = text.replace(/(\*\*|__)(.+?)\1/g, '$2');
  text = text.replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1$2');
  text = text.replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1$2');
  text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, '$2');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The sentences of a plain text. A sentence ends at ". ", "! " or "? " before
 * a capital, a digit, a quote or a code-ish character, so "v2.1.212" and
 * "e.g. foo" do not split it.
 */
function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(/\-[])/).map((s) => s.trim()).filter(Boolean);
}

/** The first `n` sentences, at most `max` characters (cut on a word, with "…"). */
function firstSentences(text, n = 2, max = 320) {
  let out = '';
  for (const sentence of sentences(text).slice(0, n)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (out && next.length > max) break;
    out = next;
  }
  if (out.length > max) out = `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

/** Lower-case words joined with dashes, for ids. */
function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { splitRow, tables, findTable, codeSpans, inlineText, sentences, firstSentences, slug };
