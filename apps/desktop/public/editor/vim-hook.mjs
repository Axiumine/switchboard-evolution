// Vim mode, off by default: the "Vim Mode" preference (status bar menu,
// right-click menu, Settings › Editor). The first time it is on, the add-on
// (editor/addons/vim.mjs) loads and every editor gets it; its extension goes
// first, as Vim asks, so that it sees the keys before the editor's keymaps.
//
// The app's keys stay the app's: a plugin placed before Vim's runs the keys
// of the 'sb-editor-keys' scope (find, replace, find next, go to line, save,
// go to symbol: Cmd/Ctrl+F, Cmd+G, Ctrl+G, Cmd/Ctrl+S, Cmd/Ctrl+Shift+O …)
// before Vim can take them. Escape is Vim's: from Insert back to Normal; in
// Normal mode it reaches the editor, which closes the find bar.
// The status bar shows the mode (NORMAL, INSERT, VISUAL …).
import { StateField, StateEffect } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { loadAddon, loadedAddon } from './addons.mjs';
import { runEditorKeys } from './find.mjs';

const setVimMode = StateEffect.define();

/** The Vim mode the status bar shows: null when Vim is off. */
const vimMode = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setVimMode)) return e.value;
    return value;
  },
});

/** The app's keys, before Vim sees them. */
const appKeysFirst = ViewPlugin.fromClass(class {}, {
  eventHandlers: {
    keydown(event, view) {
      if (!runEditorKeys(view, event)) return false;
      event.preventDefault();
      return true;
    },
  },
});

function modeName(e) {
  if (!e) return 'NORMAL';
  const mode = String(e.mode || 'normal');
  if (mode === 'visual') return e.subMode === 'linewise' ? 'VISUAL LINE' : e.subMode === 'blockwise' ? 'VISUAL BLOCK' : 'VISUAL';
  return mode.toUpperCase();
}

/** Follows Vim's mode for the status bar. */
const modeTracker = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    const addon = loadedAddon('vim');
    this.cm = addon && addon.getCM(view);
    this.onMode = e => this.show(modeName(e));
    if (this.cm) this.cm.on('vim-mode-change', this.onMode);
    this.show('NORMAL');
  }
  show(mode) {
    Promise.resolve().then(() => { if (this.view.state.field(vimMode, false) !== mode) this.view.dispatch({ effects: setVimMode.of(mode) }); });
  }
  destroy() {
    if (this.cm) this.cm.off('vim-mode-change', this.onMode);
    // The field outlives the plugin (Vim off): show nothing.
    const view = this.view;
    Promise.resolve().then(() => { try { if (view.state.field(vimMode, false)) view.dispatch({ effects: setVimMode.of(null) }); } catch {} });
  }
});

/**
 * The editor's Vim extensions for the preference: Vim when it is on and its
 * add-on is loaded; when it is on and not loaded yet, nothing now, and
 * `whenLoaded` once it is (the preferences reconfigure every editor then).
 */
function vimExtension(on, whenLoaded) {
  if (!on) return [];
  const addon = loadedAddon('vim');
  if (!addon) {
    loadAddon('vim').then(whenLoaded, err => console.error('[vim]', err.message));
    return [];
  }
  return [appKeysFirst, addon.vim({ status: false }), modeTracker];
}

export { vimExtension, vimMode, appKeysFirst, modeName };
