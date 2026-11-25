// The languages with a Lezer grammar of their own (PHP, C#, Ruby, Elixir …),
// which the page does not carry: each is a script built apart (grammars.js,
// scripts/build-editor-html.mjs → src/editor/editor-languages.generated.ts),
// that the app puts in the page (CodeEditor.tsx) when the page asks for it
// with { type: 'needLanguage', addon }. The script registers itself on
// window.__sbEditorAddons[addon] and calls window.sb.languageReady(addon).
// Its CodeMirror is the page's own, given on window.__sbEditorModules (shareModules),
// as the desktop's add-ons do (apps/desktop/public/editor/addons.mjs).

import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import * as cmAutocomplete from '@codemirror/autocomplete';
import * as lezerCommon from '@lezer/common';
import * as lezerHighlight from '@lezer/highlight';
import * as lezerLr from '@lezer/lr';
import * as langHtml from '@codemirror/lang-html';
import * as langCss from '@codemirror/lang-css';
import * as langJavascript from '@codemirror/lang-javascript';
import * as lezerJavascript from '@lezer/javascript';
import * as lezerHtml from '@lezer/html';
import * as lezerCss from '@lezer/css';

/** The packages a grammar's script takes from the page (grammars.js SHARED_MODULE_NAMES; the build maps their imports here). */
export const SHARED_MODULES = {
  '@codemirror/state': cmState,
  '@codemirror/view': cmView,
  '@codemirror/language': cmLanguage,
  '@codemirror/autocomplete': cmAutocomplete,
  '@lezer/common': lezerCommon,
  '@lezer/highlight': lezerHighlight,
  '@lezer/lr': lezerLr,
  '@codemirror/lang-html': langHtml,
  '@codemirror/lang-css': langCss,
  '@codemirror/lang-javascript': langJavascript,
  '@lezer/javascript': lezerJavascript,
  '@lezer/html': lezerHtml,
  '@lezer/css': lezerCss,
};

export function shareModules() {
  window.__sbEditorModules = SHARED_MODULES;
  window.__sbEditorAddons = window.__sbEditorAddons || {};
}

const asked = new Set();
const waiting = new Map(); // addon → [resolve]
let post = () => {};
let onReady = () => {};

/** How the page asks the app (postMessage) and what it does when a grammar arrives (colour the file). */
export function setLanguageHost(host) {
  post = host.post;
  onReady = host.onReady;
}

function loaded(addon) {
  return (window.__sbEditorAddons && window.__sbEditorAddons[addon]) || null;
}

function ask(addon) {
  if (asked.has(addon)) return;
  asked.add(addon);
  post({ type: 'needLanguage', addon });
}

/** The grammar of `addon` once the app has put it in the page. */
export function whenLoaded(addon) {
  if (loaded(addon)) return Promise.resolve(loaded(addon));
  ask(addon);
  return new Promise((resolve) => { waiting.set(addon, [...(waiting.get(addon) || []), resolve]); });
}

/** The script of `addon` ran: the waiting code blocks get it, the file shown is coloured. */
export function languageReady(addon) {
  const exports = loaded(addon);
  if (!exports) return;
  for (const resolve of waiting.get(addon) || []) resolve(exports);
  waiting.delete(addon);
  onReady(addon);
}

/**
 * A language of a grammar script: plain text until it is in the page (and
 * asked for then), its LanguageSupport after. `addon` is lang-<script>.
 */
export function grammar(name, script = name) {
  const addon = `lang-${script}`;
  return Object.assign(() => {
    const exports = loaded(addon);
    if (exports) return exports.support(name) || [];
    ask(addon);
    return [];
  }, { addon });
}
