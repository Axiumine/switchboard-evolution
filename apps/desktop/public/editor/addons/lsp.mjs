// The editor's language-server client, loaded the first time an editor shows
// a file whose project has a server on (editor/lsp-hook.mjs asks for it).
//
// One LSPClient (@codemirror/lsp-client) per session of the main process
// (lsp/manager.js), reached over IPC: send on lsp-send, messages back on
// lsp-message, the server's state on lsp-state. Every editor of the window
// showing a file of that folder and language joins the same client. The
// workspace is the app's: a jump into another file opens it where the editor
// is (hooks.openLocation), and two editors on the same file do not both talk
// to the server (the second waits, in lsp-hook.mjs).
//
// What an editor gets: hover, the server's errors and warnings, its
// suggestions (in an editable editor, with the language's and the file's
// words, editor/core.mjs mergedCompletions), signature help; and, through
// lsp-hook.mjs, Go to Definition, Rename Symbol and the server's formatting.
import {
  LSPClient, LSPPlugin, Workspace, hoverTooltips, signatureHelp, serverCompletion, serverDiagnostics,
} from '@codemirror/lsp-client';
import { EditorView, showDialog } from '@codemirror/view';
import { Text } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';

// ── Files and URIs ──────────────────────────────────────────────────

/**
 * A file path as a file: URI, as Node's pathToFileURL writes it (the main
 * process makes the folder's URI that way, and a server compares URIs as text):
 * what encodeURI encodes, and ? # ~ too; @ : + , ; = $ & ! ' ( ) * kept.
 */
function fileUri(filePath) {
  let p = String(filePath).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) p = `/${p}`;
  return `file://${encodeURI(p).replace(/[?#~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** A file: URI as a path (C:\… on Windows). */
function uriPath(uri) {
  let p = decodeURIComponent(new URL(uri).pathname);
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
  return p;
}

const sameFile = (a, b) => { try { return uriPath(a) === uriPath(b); } catch { return a === b; } };

// ── Transport: one IPC listener for every session ──────────────────

const handlers = new Map(); // sessionId → Set of the client's handlers
let stopListening = null;

function ipcTransport(sessionId) {
  if (!stopListening) {
    stopListening = window.api.onLspMessage((id, message) => {
      for (const handler of handlers.get(id) || []) handler(message);
    });
  }
  const set = new Set();
  handlers.set(sessionId, set);
  return {
    send: message => window.api.lspSend(sessionId, message),
    subscribe: handler => set.add(handler),
    unsubscribe: handler => set.delete(handler),
  };
}

// ── The app's workspace ─────────────────────────────────────────────

class AppWorkspace extends Workspace {
  constructor(client) {
    super(client);
    this.files = [];
    this.versions = Object.create(null);
    this.opener = null; // (path) → Promise<EditorView | null>, set by the editor that jumps
  }

  nextVersion(uri) {
    this.versions[uri] = (this.versions[uri] ?? -1) + 1;
    return this.versions[uri];
  }

  getFile(uri) {
    return this.files.find(f => f.uri === uri) || this.files.find(f => sameFile(f.uri, uri)) || null;
  }

  syncFiles() {
    const result = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextVersion(file.uri);
        plugin.clear();
      }
    }
    return result;
  }

  openFile(uri, languageId, view) {
    if (this.getFile(uri)) return; // lsp-hook.mjs lets one editor per file in; this is a guard
    const file = { uri, languageId, version: this.nextVersion(uri), doc: view.state.doc, view, getView: () => file.view };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri, view) {
    const file = this.getFile(uri);
    if (!file || (view && file.view !== view)) return;
    this.files = this.files.filter(f => f !== file);
    this.client.didClose(file.uri);
  }

  async requestFile(uri) {
    const open = this.getFile(uri);
    if (open) return open;
    const read = await window.api.readFileForPanel(uriPath(uri)).catch(() => null);
    if (!read || !read.ok || typeof read.content !== 'string') return null;
    return { uri, languageId: '', version: 0, doc: Text.of(read.content.split(/\r\n|\r|\n/)), getView: () => null };
  }

  async displayFile(uri) {
    const open = this.getFile(uri);
    if (open) return open.view;
    return this.opener ? this.opener(uriPath(uri)) : null;
  }
}

// ── Clients ─────────────────────────────────────────────────────────

const clients = new Map(); // sessionId → { client, session, views, listeners, state }
let stopStates = null;

function listenStates() {
  if (stopStates) return;
  stopStates = window.api.onLspState((sessionId, state) => {
    const entry = clients.get(sessionId);
    if (!entry) return;
    entry.state = state;
    if (state.state === 'restarted') {
      // A new process: the client introduces itself again and reopens its files.
      entry.client.disconnect();
      entry.client.connect(entry.transport);
    } else if (state.state === 'stopped') {
      entry.client.disconnect();
      clients.delete(sessionId);
      handlers.delete(sessionId);
    }
    for (const listener of entry.listeners) listener(state);
  });
}

function clientFor(session) {
  listenStates();
  let entry = clients.get(session.sessionId);
  if (entry) return entry;
  const client = new LSPClient({
    rootUri: session.rootUri,
    timeout: session.timeout,
    // Hover and suggestion docs are the server's Markdown made HTML: cleaned before they are shown.
    sanitizeHTML: html => (window.DOMPurify ? window.DOMPurify.sanitize(html) : html.replace(/</g, '&lt;')),
    workspace: c => new AppWorkspace(c),
    extensions: [serverDiagnostics()],
  });
  const transport = ipcTransport(session.sessionId);
  client.connect(transport);
  entry = { client, transport, session, views: new Set(), listeners: new Set(), state: { state: session.state || 'starting', message: session.message || '' } };
  clients.set(session.sessionId, entry);
  return entry;
}

// ── Locations ───────────────────────────────────────────────────────

/** Location | Location[] | LocationLink[] as [{ file, line, character }] (0-based line and character). */
function locations(response) {
  const list = Array.isArray(response) ? response : response ? [response] : [];
  return list.map((loc) => {
    const uri = loc.targetUri || loc.uri;
    const range = loc.targetSelectionRange || loc.targetRange || loc.range;
    if (!uri || !range) return null;
    return { file: uriPath(uri), line: range.start.line, character: range.start.character };
  }).filter(Boolean);
}

// ── Rename ──────────────────────────────────────────────────────────

/** A WorkspaceEdit's text edits by URI, from `changes` and `documentChanges`. */
function editsByUri(edit) {
  const out = new Map();
  const add = (uri, edits) => { if (uri && edits && edits.length) out.set(uri, [...(out.get(uri) || []), ...edits]); };
  for (const [uri, edits] of Object.entries((edit && edit.changes) || {})) add(uri, edits);
  for (const change of (edit && edit.documentChanges) || []) if (change && change.textDocument) add(change.textDocument.uri, change.edits);
  return out;
}

async function renameAt(view, plugin, newName) {
  const pos = view.state.selection.main.head;
  plugin.client.sync();
  let response;
  try {
    response = await plugin.client.request('textDocument/rename', { textDocument: { uri: plugin.uri }, position: plugin.toPosition(pos), newName });
  } catch (err) {
    plugin.reportError('Rename failed', err);
    return;
  }
  const byUri = editsByUri(response);
  if (!byUri.size) return;
  const workspace = plugin.client.workspace;
  const closed = {};
  for (const [uri, edits] of byUri) {
    const file = workspace.getFile(uri);
    if (file && file.view) {
      const target = file.view;
      const doc = target.state.doc;
      const targetPlugin = LSPPlugin.get(target);
      target.dispatch({
        changes: edits.map(e => ({ from: targetPlugin.fromPosition(e.range.start, doc), to: targetPlugin.fromPosition(e.range.end, doc), insert: e.newText })),
        userEvent: 'rename',
      });
    } else {
      closed[uriPath(uri)] = edits;
    }
  }
  if (!Object.keys(closed).length) return;
  // The main process asks first (a native dialog listing the files), then writes them.
  const result = await window.api.lspApplyEdits(closed, { title: `Rename to "${newName}"` });
  if (result && result.error) plugin.reportError('Rename failed', new Error(result.error));
}

function promptRename(view) {
  const plugin = LSPPlugin.get(view);
  const word = view.state.wordAt(view.state.selection.main.head);
  if (!plugin || !word || plugin.client.hasCapability('renameProvider') === false) return false;
  const current = view.state.sliceDoc(word.from, word.to);
  const { close, result } = showDialog(view, {
    label: 'New name',
    input: { name: 'name', value: current },
    focus: true,
    submitLabel: 'Rename',
    class: 'cm-lsp-rename-panel',
  });
  result.then((form) => {
    view.dispatch({ effects: close });
    const name = form && form.elements.namedItem('name').value.trim();
    if (name && name !== current) renameAt(view, plugin, name);
  });
  return true;
}

// ── An editor joins ─────────────────────────────────────────────────

const lspTheme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-hover': { maxWidth: '640px', maxHeight: '360px', overflow: 'auto' },
  '.cm-lsp-documentation': { fontSize: '12px', lineHeight: '1.5' },
  '.cm-lsp-documentation h1, .cm-lsp-documentation h2, .cm-lsp-documentation h3, .cm-lsp-documentation h4': { fontSize: '12.5px', margin: '4px 0' },
  '.cm-lsp-documentation hr': { border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.12)', margin: '4px 0' },
  '.cm-lsp-documentation pre, .cm-lsp-documentation code': { fontFamily: 'var(--mono-font, SFMono-Regular, Menlo, monospace)', fontSize: '11.5px' },
});

/**
 * Join `view` (showing `session`'s file `file`) to its session's client.
 * Returns { extension, release, definitionAt, rename, format, capabilities }.
 */
function connect(view, session, { file, readOnly = false, onState = null } = {}) {
  const entry = clientFor(session);
  entry.views.add(view);
  if (onState) { entry.listeners.add(onState); onState(entry.state); }
  const uri = fileUri(file);
  const extension = [
    entry.client.plugin(uri, session.languageId),
    hoverTooltips(),
    readOnly ? [] : [serverCompletion(), signatureHelp()],
    lspTheme,
  ];
  return {
    extension,
    release() {
      entry.views.delete(view);
      if (onState) entry.listeners.delete(onState);
    },
    /** The definitions at the cursor ([] for none), or null when the server cannot say. */
    async definitionAt(target) {
      const plugin = LSPPlugin.get(target);
      if (!plugin || !entry.client.serverCapabilities || !entry.client.serverCapabilities.definitionProvider) return null;
      plugin.client.sync();
      try {
        return locations(await plugin.client.request('textDocument/definition', { textDocument: { uri: plugin.uri }, position: plugin.toPosition(target.state.selection.main.head) }));
      } catch {
        return null;
      }
    },
    rename: target => promptRename(target),
    canRename: () => !!(entry.client.serverCapabilities && entry.client.serverCapabilities.renameProvider),
    /** The server's formatting of the document or of [from, to]: the edits applied, or false when it cannot. */
    async format(target, range = null) {
      const plugin = LSPPlugin.get(target);
      const caps = entry.client.serverCapabilities || {};
      if (!plugin || !(range ? caps.documentRangeFormattingProvider : caps.documentFormattingProvider)) return false;
      plugin.client.sync();
      const options = { tabSize: target.state.tabSize, insertSpaces: !target.state.facet(indentUnit).includes('\t') };
      const doc = target.state.doc;
      const params = { textDocument: { uri: plugin.uri }, options };
      if (range) params.range = { start: plugin.toPosition(range.from, doc), end: plugin.toPosition(range.to, doc) };
      let edits;
      try { edits = await plugin.client.request(range ? 'textDocument/rangeFormatting' : 'textDocument/formatting', params); } catch (err) {
        plugin.reportError('Format failed', err);
        return true;
      }
      if (!edits || !edits.length || target.state.doc !== doc) return true;
      target.dispatch({ changes: edits.map(e => ({ from: plugin.fromPosition(e.range.start, doc), to: plugin.fromPosition(e.range.end, doc), insert: e.newText })), userEvent: 'format' });
      return true;
    },
    setOpener(opener) { entry.client.workspace.opener = opener; },
  };
}

window.__sbEditorAddons = window.__sbEditorAddons || {};
window.__sbEditorAddons.lsp = { connect, fileUri, uriPath, locations, editsByUri };

export { connect, fileUri, uriPath, locations, editsByUri, AppWorkspace };
