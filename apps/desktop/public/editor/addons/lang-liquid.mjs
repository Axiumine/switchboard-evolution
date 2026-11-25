// A language of its own Lezer grammar, loaded the first time a file of it is
// shown (editor/languages.mjs). Generated alike for each grammar: see
// editor/addons/languages.mjs for the legacy modes.
import { liquid } from '@codemirror/lang-liquid';

const LANGUAGES = {
  liquid: () => liquid(),
};
const made = new Map();

function support(name) {
  if (!LANGUAGES[name]) return null;
  if (!made.has(name)) made.set(name, LANGUAGES[name]());
  return made.get(name);
}

window.__sbEditorAddons = window.__sbEditorAddons || {};
window.__sbEditorAddons['lang-liquid'] = { support };

export { support };
