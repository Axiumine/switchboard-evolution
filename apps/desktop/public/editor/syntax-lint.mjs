// Syntax errors in JSON and YAML, underlined as the editor types, with the
// message on hover (@codemirror/lint). JSON is read by jsonc-parser
// (window.JsoncParser, loaded by the pages): strict in a .json file, with
// comments and trailing commas allowed in the JSON-with-comments files VS Code
// knows (tsconfig, jsconfig, .vscode settings, devcontainer, .jsonc). YAML's
// errors are the nodes its parser (lang-yaml) could not read.
//
// When the file has a language server, its diagnostics are the ones shown:
// lsp-hook.mjs empties this compartment while it is connected (two sources
// would each replace the other's).
import { Compartment } from '@codemirror/state';
import { linter } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import { languageNameField } from './languages.mjs';
import { editorContext } from './prefs.mjs';

const syntaxLintCompartment = new Compartment();

const JSONC_FILE = /(^|[\\/])(tsconfig[^\\/]*\.json|jsconfig[^\\/]*\.json|\.vscode[\\/][^\\/]+\.json|\.?devcontainer\.json|[^\\/]+\.jsonc|\.eslintrc\.json|\.babelrc)$/i;

/** "CommaExpected" as "Comma expected". */
function errorText(code) {
  const words = String(code).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The JSON errors of `text` as diagnostics; `jsonc` allows comments and trailing commas. */
function jsonDiagnostics(text, { jsonc = false, parser = (typeof window !== 'undefined' && window.JsoncParser) || null } = {}) {
  if (!parser || !text.trim()) return [];
  const errors = [];
  parser.parse(text, errors, { disallowComments: !jsonc, allowTrailingComma: jsonc, allowEmptyContent: true });
  return errors.map(e => ({
    from: Math.min(e.offset, text.length),
    to: Math.min(text.length, e.offset + Math.max(1, e.length)),
    severity: 'error',
    message: errorText(parser.printParseErrorCode ? parser.printParseErrorCode(e.error) : e.error),
    source: 'JSON',
  }));
}

/** YAML's errors: the parts of the text its parser could not read, as diagnostics. */
function yamlDiagnostics(state) {
  const out = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (!node.type.isError) return;
      // An error at the very end (an unclosed bracket) marks the last character
      // that is not a space or a line break, so that it shows.
      let from = node.from;
      let to = Math.max(node.to, Math.min(state.doc.length, from + 1));
      if (from >= state.doc.length) {
        let end = state.doc.length;
        while (end > 0 && /\s/.test(state.doc.sliceString(end - 1, end))) end--;
        from = Math.max(0, end - 1);
        to = Math.min(state.doc.length, from + 1);
      }
      const last = out[out.length - 1];
      if (last && last.to >= from) { last.to = Math.max(last.to, to); return; }
      out.push({ from, to, severity: 'error', message: 'YAML syntax error', source: 'YAML' });
    },
  });
  return out;
}

const syntaxLinter = linter((view) => {
  const name = view.state.field(languageNameField, false);
  if (name === 'JSON') {
    const context = view.state.facet(editorContext);
    const file = context.file || context.filename || '';
    return jsonDiagnostics(view.state.doc.toString(), { jsonc: JSONC_FILE.test(file) });
  }
  if (name === 'YAML') return yamlDiagnostics(view.state);
  return [];
}, { delay: 500 });

/** The syntax errors of JSON and YAML (nothing for the other languages). */
function syntaxLint() {
  return syntaxLinter;
}

export { syntaxLint, syntaxLintCompartment, jsonDiagnostics, yamlDiagnostics, JSONC_FILE };
