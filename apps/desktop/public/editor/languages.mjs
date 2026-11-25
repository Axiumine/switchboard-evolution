// The languages the editors know: a file by its name or extension, a Markdown
// code block (```ts, ```bash …) by name or alias, and code coloured as the
// editors colour it outside an editor (a diff drawn as text).
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { StateField, StateEffect, Compartment } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { cpp } from '@codemirror/lang-cpp';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { cypher } from '@codemirror/legacy-modes/mode/cypher';
import { loadAddon, loadedAddon } from './addons.mjs';
import { draculaHighlightStyle } from '@ddietr/codemirror-themes/theme/dracula';
import { highlightCode } from '@lezer/highlight';
import { StyleModule } from 'style-mod';

// ── Languages ────────────────────────────────────────────────────────
// The languages Switchboard highlights: a file by its name or extension, and
// a Markdown code block (```ts, ```bash …) by name or alias. Only these go in
// the bundle. @codemirror/language-data would bring every language CodeMirror
// has: its imports are lazy, but esbuild inlines them all into the IIFE.

// A LanguageSupport, not the bare Language: a Markdown code block reads its .language.
const legacy = (mode) => () => new LanguageSupport(StreamLanguage.define(mode));
// A language of an add-on: plain text until the add-on is loaded; the editor
// loads it and colours the file then (lazyLanguage in core.mjs), a Markdown
// code block waits for it. `addon` is 'languages' for the legacy modes
// (editor/addons/languages.mjs), lang-<grammar> for a Lezer grammar of its own.
const later = (name, addon = 'languages') => Object.assign(() => {
  const loaded = loadedAddon(addon);
  return (loaded && loaded.support(name)) || [];
}, { lazy: true, addon });
const grammar = (name, addon = name) => later(name, `lang-${addon}`);

const CODE_LANGUAGES = [
  { name: 'JavaScript', alias: ['js', 'ecmascript', 'node'], extensions: ['js', 'mjs', 'cjs'], support: () => javascript() },
  { name: 'JSX', extensions: ['jsx'], support: () => javascript({ jsx: true }) },
  { name: 'TypeScript', alias: ['ts'], extensions: ['ts', 'mts', 'cts'], support: () => javascript({ typescript: true }) },
  { name: 'TSX', extensions: ['tsx'], support: () => javascript({ jsx: true, typescript: true }) },
  { name: 'Python', alias: ['py'], extensions: ['py'], support: () => python() },
  { name: 'JSON', alias: ['jsonc', 'json5'], extensions: ['json'], support: () => json() },
  { name: 'HTML', alias: ['htm'], extensions: ['html', 'htm'], support: () => html() },
  { name: 'CSS', extensions: ['css'], support: () => css() },
  { name: 'Rust', alias: ['rs'], extensions: ['rs'], support: () => rust() },
  { name: 'Go', alias: ['golang'], extensions: ['go'], support: () => go() },
  { name: 'Java', extensions: ['java'], support: () => java() },
  { name: 'XML', alias: ['svg'], extensions: ['xml', 'svg'], support: () => xml() },
  { name: 'YAML', alias: ['yml'], extensions: ['yaml', 'yml'], support: () => yaml() },
  { name: 'SQL', extensions: ['sql'], support: () => sql() },
  { name: 'C++', alias: ['c', 'cpp', 'cc', 'h', 'hpp'], extensions: ['c', 'cpp', 'cc', 'h', 'hpp'], support: () => cpp() },
  // The languages of the editor's language servers (lsp/servers.js) and a few
  // more, in the languages add-on (editor/addons/languages.mjs), loaded the
  // first time a file of one of them is shown: Lezer grammars, with the
  // structure sticky scroll and Go to Symbol use, or legacy modes that only
  // colour (there sticky scroll follows the indentation).
  { name: 'PHP', extensions: ['php', 'phtml'], support: grammar('php') },
  { name: 'C#', alias: ['csharp', 'cs'], extensions: ['cs', 'csx'], support: grammar('csharp') },
  { name: 'Ruby', alias: ['rb'], extensions: ['rb', 'rake', 'gemspec', 'ru'], filename: /^(Gemfile|Rakefile)$/, support: grammar('ruby') },
  { name: 'SCSS', extensions: ['scss'], support: grammar('scss', 'sass') },
  { name: 'Sass', extensions: ['sass'], support: grammar('sass') },
  { name: 'Less', extensions: ['less'], support: grammar('less') },
  { name: 'Vue', extensions: ['vue'], support: grammar('vue') },
  { name: 'Svelte', extensions: ['svelte'], support: grammar('svelte') },
  { name: 'Liquid', extensions: ['liquid'], support: grammar('liquid') },
  { name: 'Jinja', alias: ['j2', 'jinja2'], extensions: ['jinja', 'jinja2', 'j2'], support: grammar('jinja') },
  { name: 'Elixir', alias: ['ex'], extensions: ['ex', 'exs'], support: grammar('elixir') },
  { name: 'Terraform', alias: ['hcl', 'tf'], extensions: ['tf', 'tfvars', 'hcl'], support: grammar('hcl') },
  { name: 'Zig', extensions: ['zig', 'zon'], support: grammar('zig') },
  { name: 'Kotlin', alias: ['kt'], extensions: ['kt', 'kts'], support: later('kotlin') },
  { name: 'Scala', extensions: ['scala', 'sc', 'sbt'], support: later('scala') },
  { name: 'Dart', extensions: ['dart'], support: later('dart') },
  { name: 'Objective-C', alias: ['objc'], extensions: ['m', 'mm'], support: later('objectiveC') },
  { name: 'Lua', extensions: ['lua'], support: later('lua') },
  { name: 'Swift', extensions: ['swift'], support: later('swift') },
  { name: 'Haskell', alias: ['hs'], extensions: ['hs', 'lhs'], support: later('haskell') },
  { name: 'OCaml', alias: ['ml'], extensions: ['ml', 'mli'], support: later('oCaml') },
  { name: 'F#', alias: ['fsharp'], extensions: ['fs', 'fsi', 'fsx'], support: later('fSharp') },
  { name: 'PowerShell', alias: ['ps1', 'pwsh'], extensions: ['ps1', 'psm1'], support: later('powerShell') },
  { name: 'Erlang', alias: ['erl'], extensions: ['erl', 'hrl'], support: later('erlang') },
  { name: 'Julia', alias: ['jl'], extensions: ['jl'], support: later('julia') },
  { name: 'R', extensions: ['r'], support: later('r') },
  { name: 'Groovy', alias: ['gradle'], extensions: ['groovy', 'gradle'], support: later('groovy') },
  { name: 'Perl', alias: ['pl'], extensions: ['pl', 'pm'], support: later('perl') },
  { name: 'Shell', alias: ['sh', 'bash', 'zsh', 'console', 'shellscript'], extensions: ['sh', 'bash', 'zsh'], support: legacy(shell) },
  { name: 'Diff', alias: ['patch'], extensions: ['diff', 'patch'], support: legacy(diff) },
  { name: 'TOML', extensions: ['toml'], support: legacy(toml) },
  { name: 'Dockerfile', alias: ['docker'], filename: /^Dockerfile$/, support: legacy(dockerFile) },
  // The Node Knowledge tab's Query view (codebase-memory-mcp's query_graph).
  { name: 'Cypher', alias: ['cql'], extensions: ['cypher', 'cyp'], support: legacy(cypher) },
  { name: 'Markdown', alias: ['md'], extensions: ['md', 'mdx', 'markdown'], support: () => markdownSupport() },
];

/** The same languages for Markdown code blocks, each made when a block first needs it. */
const CODE_BLOCK_LANGUAGES = CODE_LANGUAGES.map(({ name, alias, extensions, filename, support }) =>
  LanguageDescription.of({ name, alias, extensions, filename, load: async () => { if (support.lazy) await loadAddon(support.addon); return support(); } }));

function markdownSupport() {
  return markdown({ base: markdownLanguage, codeLanguages: CODE_BLOCK_LANGUAGES });
}

// ── Language Detection ───────────────────────────────────────────────

/** The entry of CODE_LANGUAGES for a file, by its name, then its extension; null when it is none of them. */
function languageEntry(filename) {
  const base = (filename || '').split(/[\\/]/).pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  return CODE_LANGUAGES.find(l => l.filename && l.filename.test(base))
    || CODE_LANGUAGES.find(l => l.extensions && l.extensions.includes(ext))
    || null;
}

/** The language of a file by its name, then its extension; Markdown when it is none of them. */
function getLanguageExt(filename) {
  const lang = languageEntry(filename);
  return lang ? lang.support() : markdownSupport();
}

// ── Code in the editor's colours, outside an editor ─────────────────
// A diff drawn as text (the Pull Requests view's, gitDiffLines in
// project-git-view.js) shows its code as the editors here do: the file's
// language parses it and Dracula's highlight style colours it. A file of a
// language Switchboard does not know stays plain.

const highlightSupports = new Map(); // language name → its LanguageSupport, made once
// The languages with /* */ comments: a piece of a file (a diff's hunk) that
// starts on a comment's " * " lines is read as if the comment opened before it.
const BLOCK_COMMENT_LANGUAGES = new Set(['JavaScript', 'JSX', 'TypeScript', 'TSX', 'CSS', 'Rust', 'Go', 'Java', 'C++', 'SQL']);
let draculaStyleMounted = false;
const MAX_HIGHLIGHT = 512 * 1024;

const escapeCode = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `code` as HTML, one string per line, in the editor's colours for a file
 * named `filename`; null when the language is not one Switchboard highlights
 * (or the text is too long to parse here). `code` may be a piece of a file.
 */
function highlightCodeLines(code, filename) {
  const entry = languageEntry(filename);
  const text = String(code ?? '');
  if (!entry || text.length > MAX_HIGHLIGHT) return null;
  if (!highlightSupports.has(entry.name)) highlightSupports.set(entry.name, entry.support());
  const support = highlightSupports.get(entry.name);
  // The highlight style's rules reach the page with an editor; without one yet, here.
  if (!draculaStyleMounted && draculaHighlightStyle.module && typeof document !== 'undefined') {
    StyleModule.mount(document, draculaHighlightStyle.module);
    draculaStyleMounted = true;
  }
  const first = text.split('\n').find(line => line.trim());
  const inComment = BLOCK_COMMENT_LANGUAGES.has(entry.name) && !!first && /^\s*\*/.test(first);
  const source = inComment ? `/*\n${text}` : text;
  const lines = [''];
  highlightCode(source, support.language.parser.parse(source), draculaHighlightStyle, (piece, classes) => {
    lines[lines.length - 1] += classes ? `<span class="${classes}">${escapeCode(piece)}</span>` : escapeCode(piece);
  }, () => lines.push(''));
  if (inComment) lines.shift();
  return lines;
}

/** The names of the languages, for choosing one by hand (the status bar). */
const LANGUAGE_NAMES = CODE_LANGUAGES.map(l => l.name);

/** The language called `name` (as in LANGUAGE_NAMES), Markdown when there is none. */
function languageByName(name) {
  const lang = CODE_LANGUAGES.find(l => l.name === name);
  return lang ? lang.support() : markdownSupport();
}

/** The name of the language a file opens in: Markdown for one Switchboard does not know. */
function languageName(filename) {
  const lang = languageEntry(filename);
  return lang ? lang.name : 'Markdown';
}

const setLanguageName = StateEffect.define();

/** The language support of an editor, changed by hand from the status bar. */
const languageCompartment = new Compartment();

/** The name of the language the editor's text is in (as in LANGUAGE_NAMES): for the status bar and Go to Symbol. */
const languageNameField = StateField.define({
  create() { return 'Markdown'; },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLanguageName)) return e.value;
    return value;
  },
});

export {
  setLanguageName, languageNameField, languageCompartment,
  CODE_LANGUAGES, CODE_BLOCK_LANGUAGES, LANGUAGE_NAMES, markdownSupport, languageEntry, getLanguageExt,
  highlightCodeLines, languageByName, languageName,
};
