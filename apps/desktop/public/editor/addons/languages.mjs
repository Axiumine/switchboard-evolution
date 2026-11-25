// The languages CodeMirror colours with a legacy mode only (Kotlin, Swift,
// Dart, Lua, Haskell …), together, loaded the first time a file of one of
// them is shown (editor/languages.mjs). The languages with a Lezer grammar of
// their own (PHP, C#, Ruby …) are bundles of one each (addons/lang-*.mjs).
import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { kotlin, scala, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { oCaml, fSharp } from '@codemirror/legacy-modes/mode/mllike';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { r } from '@codemirror/legacy-modes/mode/r';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { perl } from '@codemirror/legacy-modes/mode/perl';

const legacy = mode => () => new LanguageSupport(StreamLanguage.define(mode));

/** Each language by the name editor/languages.mjs asks for. */
const LANGUAGES = {
  kotlin: legacy(kotlin),
  scala: legacy(scala),
  dart: legacy(dart),
  objectiveC: legacy(objectiveC),
  lua: legacy(lua),
  swift: legacy(swift),
  haskell: legacy(haskell),
  oCaml: legacy(oCaml),
  fSharp: legacy(fSharp),
  powerShell: legacy(powerShell),
  erlang: legacy(erlang),
  julia: legacy(julia),
  r: legacy(r),
  groovy: legacy(groovy),
  perl: legacy(perl),
};

const supports = new Map();

/** The LanguageSupport of a language by its name, made once; null for an unknown name. */
function support(name) {
  if (!LANGUAGES[name]) return null;
  if (!supports.has(name)) supports.set(name, LANGUAGES[name]());
  return supports.get(name);
}

window.__sbEditorAddons = window.__sbEditorAddons || {};
window.__sbEditorAddons.languages = { support, names: Object.keys(LANGUAGES) };

export { support, LANGUAGES };
