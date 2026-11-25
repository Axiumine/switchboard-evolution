// Code in the editor's colours, outside the editor: a diff drawn as text (the
// pull requests' Files changed and the review threads' hunks) shows its code
// as the file editor does, as the desktop's gitDiffCodeLines does
// (project-git-view.js, with highlightCodeLines in public/editor/languages.mjs).
// The file's language parses it and Dracula, the editor's theme, colours it.
//
// The parsers are Lezer's, the ones CodeMirror's languages are made of, without
// CodeMirror: the editor's page (scripts/editor-page/page.js) has the same
// table. The languages that page reads with CodeMirror 5's stream modes
// (Shell, TOML, Dockerfile, Diff) and SQL have no Lezer parser of their own:
// their code stays plain here.

import type { Parser } from '@lezer/common';
import { parser as cppParser } from '@lezer/cpp';
import { parser as cssParser } from '@lezer/css';
import { parser as goParser } from '@lezer/go';
import { highlightCode, tagHighlighter, tags as t, type Tag } from '@lezer/highlight';
import { configureNesting, parser as htmlParser } from '@lezer/html';
import { parser as javaParser } from '@lezer/java';
import { parser as jsParser } from '@lezer/javascript';
import { parser as jsonParser } from '@lezer/json';
import { GFM, parseCode, parser as markdownParser } from '@lezer/markdown';
import { parser as pythonParser } from '@lezer/python';
import { parser as rustParser } from '@lezer/rust';
import { parser as xmlParser } from '@lezer/xml';
import { parser as yamlParser } from '@lezer/yaml';

/** How a piece of code looks: a React Native text style. */
export type CodeStyle = {
  color?: string;
  fontWeight?: 'bold';
  fontStyle?: 'italic';
  textDecorationLine?: 'underline' | 'line-through';
};
/** A piece of a line of code, with its style when it has one (else it is in CODE_COLOR). */
export type CodePiece = { text: string; style?: CodeStyle };

// ── Languages ────────────────────────────────────────────────────────

type Language = { name: string; alias?: string[]; extensions?: string[]; filename?: RegExp; parser: () => Parser };

const LANGUAGES: Language[] = [
  { name: 'JavaScript', alias: ['js', 'ecmascript', 'node'], extensions: ['js', 'mjs', 'cjs'], parser: () => jsParser },
  { name: 'JSX', extensions: ['jsx'], parser: () => jsParser.configure({ dialect: 'jsx' }) },
  { name: 'TypeScript', alias: ['ts'], extensions: ['ts', 'mts', 'cts'], parser: () => jsParser.configure({ dialect: 'ts' }) },
  { name: 'TSX', extensions: ['tsx'], parser: () => jsParser.configure({ dialect: 'jsx ts' }) },
  { name: 'Python', alias: ['py'], extensions: ['py'], parser: () => pythonParser },
  { name: 'JSON', alias: ['jsonc', 'json5'], extensions: ['json'], parser: () => jsonParser },
  // As CodeMirror's HTML: a <script>'s code and a <style>'s rules in their own language.
  { name: 'HTML', alias: ['htm'], extensions: ['html', 'htm'], parser: () => htmlParser.configure({ wrap: configureNesting([{ tag: 'script', parser: jsParser }, { tag: 'style', parser: cssParser }]) }) },
  { name: 'CSS', extensions: ['css'], parser: () => cssParser },
  { name: 'Rust', alias: ['rs'], extensions: ['rs'], parser: () => rustParser },
  { name: 'Go', alias: ['golang'], extensions: ['go'], parser: () => goParser },
  { name: 'Java', extensions: ['java'], parser: () => javaParser },
  { name: 'XML', alias: ['svg'], extensions: ['xml', 'svg'], parser: () => xmlParser },
  { name: 'YAML', alias: ['yml'], extensions: ['yaml', 'yml'], parser: () => yamlParser },
  { name: 'C++', alias: ['c', 'cpp', 'cc', 'h', 'hpp'], extensions: ['c', 'cpp', 'cc', 'h', 'hpp'], parser: () => cppParser },
  // GitHub's Markdown, a fenced block's code in its language.
  { name: 'Markdown', alias: ['md'], extensions: ['md', 'mdx', 'markdown'], parser: () => markdownParser.configure([GFM, parseCode({ codeParser: (info) => codeBlockParser(info) })]) },
];

const parsers = new Map<string, Parser>(); // language name → its parser, made once

function parserOf(language: Language): Parser {
  let parser = parsers.get(language.name);
  if (!parser) { parser = language.parser(); parsers.set(language.name, parser); }
  return parser;
}

/** The language of a file, by its name, then its extension; null when it is none of LANGUAGES. */
export function languageOf(filename: string): Language | null {
  const base = (filename || '').split(/[\\/]/).pop() || '';
  const ext = base.includes('.') ? (base.split('.').pop() || '').toLowerCase() : '';
  return LANGUAGES.find((l) => l.filename?.test(base))
    || LANGUAGES.find((l) => l.extensions?.includes(ext))
    || null;
}

/** The parser of a Markdown code block's language (```ts), by name, alias or extension. */
function codeBlockParser(info: string): Parser | null {
  const name = info.trim().split(/\s/)[0]?.toLowerCase();
  if (!name) return null;
  const language = LANGUAGES.find((l) => l.name.toLowerCase() === name || l.alias?.includes(name) || l.extensions?.includes(name));
  // A Markdown block in Markdown would parse itself again: plain.
  return language && language.name !== 'Markdown' ? parserOf(language) : null;
}

// ── Dracula ──────────────────────────────────────────────────────────
// @ddietr/codemirror-themes' draculaHighlightStyle, rule for rule, in the
// same order: as in CodeMirror, a tag a later rule names again takes the later
// rule. (Its typeName rule also sets a colour as the font style, which a
// browser ignores: so does this.)

/** The colour of code no rule colours: Dracula's foreground. */
export const CODE_COLOR = '#F8F8F2';

const DRACULA = {
  keyword: '#FF79C6', variable: '#F8F8F2', function: '#50FA7B', string: '#F1FA8C', constant: '#BD93F9',
  type: '#8BE9FD', class: '#8BE9FD', number: '#BD93F9', comment: '#6272A4', heading: '#BD93F9', invalid: '#FF5555', regexp: '#F1FA8C',
};

const RULES: { tag: Tag | Tag[]; style: CodeStyle }[] = [
  { tag: t.keyword, style: { color: DRACULA.keyword } },
  { tag: [t.name, t.deleted, t.character, t.macroName], style: { color: DRACULA.variable } },
  { tag: [t.propertyName], style: { color: DRACULA.function } },
  { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], style: { color: DRACULA.string } },
  { tag: [t.function(t.variableName), t.labelName], style: { color: DRACULA.function } },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], style: { color: DRACULA.constant } },
  { tag: [t.definition(t.name), t.separator], style: { color: DRACULA.variable } },
  { tag: [t.className], style: { color: DRACULA.class } },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], style: { color: DRACULA.number } },
  { tag: [t.typeName], style: { color: DRACULA.type } },
  { tag: [t.operator, t.operatorKeyword], style: { color: DRACULA.keyword } },
  { tag: [t.url, t.escape, t.regexp, t.link], style: { color: DRACULA.regexp } },
  { tag: [t.meta, t.comment], style: { color: DRACULA.comment } },
  { tag: t.strong, style: { fontWeight: 'bold' } },
  { tag: t.emphasis, style: { fontStyle: 'italic' } },
  { tag: t.link, style: { textDecorationLine: 'underline' } },
  { tag: t.heading, style: { fontWeight: 'bold', color: DRACULA.heading } },
  { tag: [t.atom, t.bool, t.special(t.variableName)], style: { color: DRACULA.variable } },
  { tag: t.invalid, style: { color: DRACULA.invalid } },
  { tag: t.strikethrough, style: { textDecorationLine: 'line-through' } },
];

// Each rule's class is its index; a piece with several tags has their classes, space-separated.
const highlighter = tagHighlighter(RULES.map((rule, i) => ({ tag: rule.tag, class: String(i) })));
const styles = new Map<string, CodeStyle>(); // classes → their rules' styles together, made once

function styleOf(classes: string): CodeStyle {
  let style = styles.get(classes);
  if (!style) {
    style = Object.assign({}, ...classes.split(' ').map((i) => RULES[Number(i)]?.style)) as CodeStyle;
    styles.set(classes, style);
  }
  return style;
}

// ── Highlighting ─────────────────────────────────────────────────────

// The languages with /* */ comments: a piece of a file (a diff's hunk) that
// starts on a comment's " * " lines is read as if the comment opened before it.
const BLOCK_COMMENT_LANGUAGES = new Set(['JavaScript', 'JSX', 'TypeScript', 'TSX', 'CSS', 'Rust', 'Go', 'Java', 'C++']);
const MAX_HIGHLIGHT = 512 * 1024;

/**
 * `code` in the editor's colours for a file named `filename`, as pieces, one
 * list per line; null when its language is not one of LANGUAGES (or the text is
 * too long to parse here). `code` may be a piece of a file.
 */
export function highlightCodeLines(code: string, filename: string): CodePiece[][] | null {
  const language = languageOf(filename);
  const text = String(code ?? '');
  if (!language || text.length > MAX_HIGHLIGHT) return null;
  const first = text.split('\n').find((line) => line.trim());
  const inComment = BLOCK_COMMENT_LANGUAGES.has(language.name) && !!first && /^\s*\*/.test(first);
  const source = inComment ? `/*\n${text}` : text;
  const lines: CodePiece[][] = [[]];
  highlightCode(source, parserOf(language).parse(source), highlighter, (piece, classes) => {
    lines[lines.length - 1].push(classes ? { text: piece, style: styleOf(classes) } : { text: piece });
  }, () => lines.push([]));
  if (inComment) lines.shift();
  return lines;
}

/**
 * The code of a diff's hunks in the editor's colours: the pieces of each line
 * of `lines` (a unified diff, line by line) inside a hunk, without its first
 * character (+, - or space), and null for the others (headers, @@ lines, "\ No
 * newline"). Each hunk's old side (its context and removed lines) and new side
 * (its context and added lines) are coloured as wholes, so a comment or a
 * string over several lines stays one. Null when the file's language is not one
 * that is highlighted.
 */
export function diffCodeLines(lines: readonly string[], filename: string): (CodePiece[] | null)[] | null {
  if (!languageOf(filename)) return null;
  const out: (CodePiece[] | null)[] = new Array(lines.length).fill(null);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('@@')) { i++; continue; }
    const before: number[] = [];
    const after: number[] = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j].startsWith('@@') && !lines[j].startsWith('diff --git '); j++) {
      const kind = lines[j][0];
      if (kind === '-') before.push(j);
      else if (kind === '+') after.push(j);
      else if (kind === ' ' || lines[j] === '') { before.push(j); after.push(j); }
    }
    // The new side last: a context line shows as it reads now.
    for (const rows of [before, after]) {
      if (!rows.length) continue;
      const code = highlightCodeLines(rows.map((r) => lines[r].slice(1)).join('\n'), filename);
      if (!code) return null;
      rows.forEach((r, k) => { out[r] = code[k] ?? []; });
    }
    i = j;
  }
  return out;
}
