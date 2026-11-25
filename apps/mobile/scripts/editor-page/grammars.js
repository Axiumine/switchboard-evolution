// The Lezer grammars the editor page does not carry, each built apart by
// scripts/build-editor-html.mjs into src/editor/editor-languages.generated.ts
// and put in the page by the app when the page asks for it (languages.js).
// Plain data, with no imports: the build script reads it in Node.

/** The packages a grammar takes from the page instead of carrying its own copy (languages.js gives them). */
export const SHARED_MODULE_NAMES = [
  '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/autocomplete',
  '@lezer/common', '@lezer/highlight', '@lezer/lr',
  '@codemirror/lang-html', '@codemirror/lang-css', '@codemirror/lang-javascript',
  '@lezer/javascript', '@lezer/html', '@lezer/css',
];

/**
 * Each grammar script (its add-on is lang-<key>): the package, the function
 * it exports, and the languages it gives by the name page.js asks for, with
 * the arguments of the function.
 */
export const GRAMMARS = {
  php: { module: '@codemirror/lang-php', fn: 'php', languages: { php: '' } },
  sass: { module: '@codemirror/lang-sass', fn: 'sass', languages: { scss: '', sass: '{ indented: true }' } },
  less: { module: '@codemirror/lang-less', fn: 'less', languages: { less: '' } },
  vue: { module: '@codemirror/lang-vue', fn: 'vue', languages: { vue: '' } },
  svelte: { module: '@replit/codemirror-lang-svelte', fn: 'svelte', languages: { svelte: '' } },
  liquid: { module: '@codemirror/lang-liquid', fn: 'liquid', languages: { liquid: '' } },
  jinja: { module: '@codemirror/lang-jinja', fn: 'jinja', languages: { jinja: '' } },
  csharp: { module: '@replit/codemirror-lang-csharp', fn: 'csharp', languages: { csharp: '' } },
  ruby: { module: 'codemirror-lang-ruby', fn: 'ruby', languages: { ruby: '' } },
  elixir: { module: 'codemirror-lang-elixir', fn: 'elixir', languages: { elixir: '' } },
  hcl: { module: 'codemirror-lang-hcl', fn: 'hcl', languages: { hcl: '' } },
  zig: { module: 'codemirror-lang-zig', fn: 'zig', languages: { zig: '' } },
};

/** The source of a grammar's script: it registers window.__sbEditorAddons['lang-<key>']. */
export function grammarSource(key) {
  const { module, fn, languages } = GRAMMARS[key];
  const table = Object.entries(languages).map(([name, args]) => `  ${JSON.stringify(name)}: () => ${fn}(${args}),`).join('\n');
  return `import { ${fn} } from ${JSON.stringify(module)};
const LANGUAGES = {
${table}
};
const made = new Map();
window.__sbEditorAddons = window.__sbEditorAddons || {};
window.__sbEditorAddons[${JSON.stringify(`lang-${key}`)}] = {
  support(name) {
    if (!LANGUAGES[name]) return null;
    if (!made.has(name)) made.set(name, LANGUAGES[name]());
    return made.get(name);
  },
};
`;
}
