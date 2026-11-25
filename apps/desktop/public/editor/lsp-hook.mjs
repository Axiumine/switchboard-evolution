// The part of the language servers every editor has (the client itself is
// an add-on, editor/addons/lsp.mjs, loaded when a server is there).
//
// An editor showing a file on disk (createCodeEditor's `file`, given by
// ViewerPanel) asks the main process for a server (lsp-open) when the
// "Language servers" preference is on. With one, it loads the client and
// joins it; without, the status bar says why (not installed, off for this
// project). One editor per file talks to the server: a second one on the same
// file waits and takes over when the first closes.
//
// Go to Definition (F12, Cmd/Ctrl+click): the server's answer when it has
// one, else the code graph's (codebase-memory-mcp). One place opens at once,
// several are listed. Go Back and Go Forward return (Ctrl+- and
// Ctrl+Shift+- on macOS, Alt+Left and Alt+Right elsewhere) through the
// editor's host (hooks.back / hooks.forward). Rename Symbol: F2.
import { StateField, StateEffect, Compartment } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, showDialog } from '@codemirror/view';
import { loadAddon } from './addons.mjs';
import { editorContext, readPref, onPrefChange } from './prefs.mjs';
import { showEditorMenu } from './menu.mjs';
import { syntaxLint, syntaxLintCompartment } from './syntax-lint.mjs';

const lspCompartment = new Compartment();
const setLspStatus = StateEffect.define();

/** What the status bar shows of the editor's server: null, or { label, state, message, unavailable, install, projectId, sessionId }. */
const lspStatus = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLspStatus)) return e.value;
    return value;
  },
});

const primaryByFile = new Map(); // file path → the plugin that talks to the server for it
const waitingByFile = new Map(); // file path → Set of plugins waiting for their turn

function waitFor(file, plugin) {
  if (!waitingByFile.has(file)) waitingByFile.set(file, new Set());
  waitingByFile.get(file).add(plugin);
}

function wakeNext(file) {
  const waiting = waitingByFile.get(file);
  if (!waiting || !waiting.size) return;
  const [next] = waiting;
  waiting.delete(next);
  next.attach();
}

class LanguageServerLink {
  constructor(view) {
    this.view = view;
    this.context = view.state.facet(editorContext);
    this.connection = null;
    this.destroyed = false;
    this.offPref = onPrefChange((name) => {
      if (name !== 'languageServers') return;
      if (readPref('languageServers')) this.attach();
      else this.detach();
    });
    if (this.usable()) Promise.resolve().then(() => this.attach());
  }

  usable() {
    const c = this.context;
    return !!(c.file && !c.merge && !c.compact && typeof window !== 'undefined' && window.api && window.api.lspOpen);
  }

  setStatus(status) {
    this.status = status;
    if (this.destroyed) return;
    Promise.resolve().then(() => { if (!this.destroyed) this.view.dispatch({ effects: setLspStatus.of(status) }); });
  }

  async attach() {
    if (this.destroyed || this.connection || this.attaching || !this.usable() || !readPref('languageServers')) return;
    const file = this.context.file;
    const primary = primaryByFile.get(file);
    if (primary && primary !== this) {
      waitFor(file, this);
      this.setStatus({ label: primary.status && primary.status.label, state: 'elsewhere', message: 'The language server is serving another editor of this file' });
      return;
    }
    this.attaching = true;
    primaryByFile.set(file, this);
    let session;
    try { session = await window.api.lspOpen(file); } catch (err) { session = { unavailable: 'error', error: err.message }; }
    if (this.destroyed) { this.attaching = false; this.release(); return; }
    if (!session || session.unavailable) {
      this.attaching = false;
      if (primaryByFile.get(file) === this) primaryByFile.delete(file);
      // Nothing to say for a file no server is for, outside a project, or with the servers switched off.
      const quiet = !session || ['no-server', 'outside-project', 'switched-off'].includes(session.unavailable);
      this.setStatus(quiet ? null : { ...session, state: session.unavailable });
      return;
    }
    this.setStatus({ ...session });
    let addon;
    try { addon = await loadAddon('lsp'); } catch (err) {
      this.attaching = false;
      this.setStatus({ ...session, state: 'error', message: err.message });
      return;
    }
    this.attaching = false;
    if (this.destroyed) { this.release(); return; }
    this.connection = addon.connect(this.view, session, {
      file,
      readOnly: !!this.context.readOnly,
      onState: state => this.setStatus({ ...session, ...state }),
    });
    // The server's diagnostics replace the editor's own JSON and YAML ones.
    this.view.dispatch({ effects: [lspCompartment.reconfigure(this.connection.extension), syntaxLintCompartment.reconfigure([])] });
  }

  detach() {
    if (this.connection) {
      this.view.dispatch({ effects: [lspCompartment.reconfigure([]), syntaxLintCompartment.reconfigure(this.context.compact ? [] : syntaxLint())] });
      this.connection.release();
      this.connection = null;
    }
    this.release();
    this.setStatus(null);
  }

  release() {
    const file = this.context.file;
    if (waitingByFile.has(file)) waitingByFile.get(file).delete(this);
    if (primaryByFile.get(file) === this) {
      primaryByFile.delete(file);
      wakeNext(file);
    }
  }

  destroy() {
    this.destroyed = true;
    this.offPref();
    if (this.connection) this.connection.release();
    this.connection = null;
    this.release();
  }
}

const languageServerLink = ViewPlugin.fromClass(LanguageServerLink);

/** The editor's link to its server, or null. */
function linkOf(view) {
  return view && typeof view.plugin === 'function' ? view.plugin(languageServerLink) : null;
}

// ── Messages ────────────────────────────────────────────────────────

/** A short message at the top of the editor, gone after a few seconds. */
function flash(view, message) {
  const { close } = showDialog(view, { label: message, top: true, class: 'cm-sb-flash' });
  setTimeout(() => { try { view.dispatch({ effects: close }); } catch {} }, 3500);
}

// ── Go to Definition ────────────────────────────────────────────────

/** Open a place: in this editor when it is its file, else through the host. */
async function openPlace(view, place) {
  const context = view.state.facet(editorContext);
  const hooks = context.hooks || {};
  if (hooks.remember) hooks.remember();
  if (place.file === context.file) {
    const doc = view.state.doc;
    const line = doc.line(Math.min(doc.lines, Math.max(1, place.line + 1)));
    const pos = Math.min(line.to, line.from + (place.character || 0));
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }), userEvent: 'select.definition' });
    view.focus();
    return;
  }
  if (hooks.openLocation) await hooks.openLocation(place.file, { line: place.line + 1, column: (place.character || 0) + 1 });
  else if (window.api && window.api.openFileWindow) window.api.openFileWindow(place.file);
}

/** Several places: a menu at the cursor. */
function choosePlace(view, places) {
  const context = view.state.facet(editorContext);
  const coords = view.coordsAtPos(view.state.selection.main.head) || { left: 100, bottom: 100 };
  const short = f => (context.file && f.startsWith(context.file.slice(0, context.file.lastIndexOf('/') + 1)) ? f.slice(context.file.lastIndexOf('/') + 1) : f.split('/').slice(-2).join('/'));
  showEditorMenu(places.slice(0, 20).map(p => ({
    label: `${p.name ? `${p.name}  ` : ''}${short(p.file)}:${p.line + 1}`,
    hint: p.label || '',
    run: () => openPlace(view, p),
  })), { x: coords.left, y: coords.bottom + 2 }, { onClose: () => view.focus() });
}

/** F12: the server's definition, else the code graph's. */
function goToDefinition(view) {
  const context = view.state.facet(editorContext);
  if (!context.file) return false;
  (async () => {
    const link = linkOf(view);
    let places = link && link.connection ? await link.connection.definitionAt(view) : null;
    if (places && places.length) {
      if (link.connection.setOpener && context.hooks && context.hooks.openLocation) link.connection.setOpener(file => context.hooks.openLocation(file, {}));
      return places.length === 1 ? openPlace(view, places[0]) : choosePlace(view, places);
    }
    const word = view.state.wordAt(view.state.selection.main.head);
    if (!word) return flash(view, 'No name under the cursor');
    if (!window.api || !window.api.editorFindDefinition) return undefined;
    const result = await window.api.editorFindDefinition(context.file, view.state.sliceDoc(word.from, word.to));
    if (!result || result.error) {
      const why = result && result.error === 'not-indexed'
        ? 'Not in the code graph: index the project in Node Knowledge'
        : (result && result.message) || 'No definition found';
      return flash(view, places ? 'No definition found' : why);
    }
    places = result.locations.map(l => ({ file: l.file, line: Math.max(0, l.line - 1), character: 0, name: l.name, label: l.label }));
    return places.length === 1 ? openPlace(view, places[0]) : choosePlace(view, places);
  })();
  return true;
}

/** F2: rename with the server, when it can. */
function renameSymbol(view) {
  const link = linkOf(view);
  if (!link || !link.connection || view.state.readOnly) return false;
  return link.connection.rename(view);
}

function goBack(view) {
  const hooks = view.state.facet(editorContext).hooks;
  return !!(hooks && hooks.back && hooks.back());
}

function goForward(view) {
  const hooks = view.state.facet(editorContext).hooks;
  return !!(hooks && hooks.forward && hooks.forward());
}

const definitionKeys = keymap.of([
  { key: 'F12', run: goToDefinition, preventDefault: true },
  { key: 'F2', run: renameSymbol, preventDefault: true },
  { mac: 'Ctrl--', win: 'Alt-ArrowLeft', linux: 'Alt-ArrowLeft', run: goBack, preventDefault: true },
  { mac: 'Ctrl-Shift--', win: 'Alt-ArrowRight', linux: 'Alt-ArrowRight', run: goForward, preventDefault: true },
]);

// Cmd+click (Ctrl+click on Windows and Linux) goes to the definition of what it hits.
const definitionClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    if (event.button !== 0 || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return false;
    if (!view.state.facet(editorContext).file) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    goToDefinition(view);
    return true;
  },
});

/** What an editor needs for its language server: the link, the compartment, the status, the keys. */
function languageServerSupport() {
  return [lspStatus, lspCompartment.of([]), languageServerLink, definitionKeys, definitionClick];
}

/** The server's link of an editor (for the status bar and the menus). */
function languageServerOf(view) {
  const link = linkOf(view);
  return link ? { status: view.state.field(lspStatus, false), connection: link.connection, context: link.context, retry: () => link.attach() } : null;
}

export { languageServerSupport, lspStatus, goToDefinition, renameSymbol, goBack, goForward, languageServerOf, linkOf, flash };
