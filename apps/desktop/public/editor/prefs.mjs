// The editor's preferences, one choice for every editor: whitespace shown,
// the minimap, sticky scroll, Vim, the language servers. Each is remembered
// in localStorage, which every window of the app shares, and every open
// editor follows a change at once: in this window by an event, in the others
// by the 'storage' event. The status bar, the right-click menu and Settings ›
// Editor all set the same choice. The global settings keep the choice too
// (editorPrefs), and the main window follows them (cmEditorPrefs.sync).
//
// A preference that changes what an editor has lives in a Compartment, filled
// from the choice and from what the editor is (its context: a small query box
// or the original side of a two-column diff is `compact`, and gets no minimap
// or sticky scroll).
import { Compartment, Facet, StateEffect } from '@codemirror/state';
import { ViewPlugin, highlightWhitespace, highlightTrailingWhitespace } from '@codemirror/view';
import { minimap } from './minimap.mjs';
import { stickyScroll } from './sticky-scroll.mjs';
import { vimExtension, vimMode } from './vim-hook.mjs';

const PREF_EVENT = 'editor-pref';

/** What an editor is ({ compact, readOnly, merge, file … }), for the preferences that depend on it. */
const editorContext = Facet.define({ combine: values => Object.assign({}, ...values) });

/** Tells the panels (the status bar) that a preference changed, also one without a compartment. */
const prefChanged = StateEffect.define();

const PREFS = new Map();

/**
 * The save of a preference the global settings keep too (editorPrefs, so a
 * phone can change it). A window without the API (a file window) only has
 * localStorage.
 */
function saveToGlobalSettings(name) {
  return (on) => {
    if (typeof window !== 'undefined' && window.api && window.api.patchSetting) {
      window.api.patchSetting('global', { editorPrefs: { [name]: on } });
    }
  };
}

/**
 * A preference: `key` in localStorage, `fallback` when nothing is stored,
 * `extension(on, context)` the editor's extensions for it (when it has any).
 */
function definePref(name, { key, fallback = false, label, extension = null, first = false, onSet = null }) {
  const pref = { name, key, fallback, label, extension, first, onSet, compartment: extension ? new Compartment() : null };
  PREFS.set(name, pref);
  return pref;
}

function prefNamed(name) {
  const pref = PREFS.get(name);
  if (!pref) throw new Error(`No editor preference ${name}`);
  return pref;
}

/** The stored choice, or the preference's default. */
function readPref(name) {
  const pref = prefNamed(name);
  try {
    const value = localStorage.getItem(pref.key);
    return value === null ? pref.fallback : value === 'true';
  } catch {
    return pref.fallback;
  }
}

/**
 * Remember the choice and tell every editor. A preference the main process
 * keeps (`onSet`, the language servers) is told there too, unless the change
 * comes from there (`fromApp`).
 */
function setPref(name, on, { fromApp = false } = {}) {
  const pref = prefNamed(name);
  if (pref.onSet && !fromApp) pref.onSet(!!on);
  try { localStorage.setItem(pref.key, String(!!on)); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: { name, on: !!on } }));
}

function togglePref(name) {
  setPref(name, !readPref(name));
}

/** fn(name) after any preference changes, here or in another window. Returns the way to stop. */
function onPrefChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const local = (e) => fn(e.detail.name);
  const other = (e) => {
    for (const pref of PREFS.values()) if (e.key === pref.key) fn(pref.name);
  };
  window.addEventListener(PREF_EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(PREF_EVENT, local);
    window.removeEventListener('storage', other);
  };
}

/** The extensions a preference gives an editor in `state` now. */
function prefExtension(pref, state) {
  return pref.extension(readPref(pref.name), state.facet(editorContext));
}

/** Every open editor follows the preferences. */
const prefSync = ViewPlugin.fromClass(class {
  constructor(view) {
    this.off = onPrefChange((name) => {
      const pref = PREFS.get(name);
      if (!pref) return;
      const effects = [prefChanged.of(name)];
      if (pref.compartment) effects.push(pref.compartment.reconfigure(prefExtension(pref, view.state)));
      view.dispatch({ effects });
    });
  }
  destroy() { this.off(); }
});

/** An editor's context, the compartments of the preferences that change it, and their sync. */
function prefExtensions(context = {}) {
  const extensions = [editorContext.of(context), prefSync];
  for (const pref of PREFS.values()) {
    if (pref.compartment && !pref.first) extensions.push(pref.compartment.of(pref.extension(readPref(pref.name), context)));
  }
  return extensions;
}

/** The compartments that must come before every other extension (Vim, which takes the keys first). */
function firstPrefExtensions(context = {}) {
  return [...PREFS.values()].filter(p => p.compartment && p.first).map(p => p.compartment.of(p.extension(readPref(p.name), context)));
}

/** Whether a preference's compartment gives this editor anything now (whitespace drawn, a minimap …). */
function prefActive(state, name) {
  const pref = prefNamed(name);
  if (!pref.compartment) return readPref(name);
  const value = pref.compartment.get(state);
  return Array.isArray(value) ? value.length > 0 : !!value;
}

// ── The preferences ────────────────────────────────────────────────

definePref('whitespace', {
  key: 'editorShowWhitespace',
  onSet: saveToGlobalSettings('whitespace'),
  label: 'Show Whitespace',
  // Spaces and tabs drawn, and the ones at the end of a line marked.
  extension: on => (on ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
});

definePref('minimap', {
  key: 'editorMinimap',
  onSet: saveToGlobalSettings('minimap'),
  fallback: true,
  label: 'Minimap',
  // Not in a small box or the original side of a two-column diff.
  extension: (on, context) => (on && !context.compact ? minimap() : []),
});

definePref('stickyScroll', {
  key: 'editorStickyScroll',
  onSet: saveToGlobalSettings('stickyScroll'),
  fallback: true,
  label: 'Sticky Scroll',
  extension: (on, context) => (on && !context.compact ? stickyScroll() : []),
});

// The app's switch for every language server, kept by the main process
// (set-language-servers): off, none starts in any project and the running ones
// stop. Here it is the window's copy, which codemirror-setup.js keeps in step.
// No compartment: editor/lsp-hook.mjs reads it before asking for a server.
definePref('languageServers', {
  key: 'editorLanguageServers',
  fallback: true,
  label: 'Language Servers',
  onSet: (on) => {
    if (typeof window !== 'undefined' && window.api && window.api.setLanguageServers) window.api.setLanguageServers(on);
  },
});

definePref('vim', {
  key: 'editorVim',
  fallback: false,
  label: 'Vim Mode',
  first: true,
  onSet: saveToGlobalSettings('vim'),
  // The add-on loads the first time: then every editor is configured again.
  extension: on => vimExtension(on, () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: { name: 'vim', on: true } }));
  }),
});

export {
  vimMode, firstPrefExtensions,
  PREF_EVENT, PREFS, editorContext, prefChanged, definePref, readPref, setPref, togglePref, onPrefChange,
  prefExtensions, prefActive,
};
