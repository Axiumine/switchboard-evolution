// The editor's status bar, as VS Code's: where the cursor is (Ln, Col) and
// what is selected, the indentation (Spaces: 2, Tab Size: 4), the line
// breaks (LF, CRLF), the encoding, the language. Each choice opens a menu: go
// to line, indent with spaces or tabs and convert the indentation, LF or
// CRLF, another language. On the left, the editor's preferences that show
// (whitespace, the minimap, sticky scroll) switch on and off for every editor.
import { showPanel } from '@codemirror/view';
import { countColumn } from '@codemirror/state';
import { showEditorMenu } from './menu.mjs';
import { openGotoLine } from './find.mjs';
import { LANGUAGE_NAMES, languageByName, languageNameField, languageCompartment, setLanguageName } from './languages.mjs';
import {
  eolField, setEol, indentCompartment, indentationConfig, currentIndentation, convertIndentationChanges,
} from './indentation.mjs';
import { PREFS, readPref, togglePref, setPref } from './prefs.mjs';
import { lspStatus, languageServerOf } from './lsp-hook.mjs';
import { vimMode } from './vim-hook.mjs';

const ICON = body => `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${body}</svg>`;

/** The preferences switched from the status bar, in this order, when the editor has them. */
const BAR_TOGGLES = [
  { name: 'whitespace', className: 'cm-status-whitespace', text: '¶' },
  { name: 'minimap', className: 'cm-status-minimap', html: ICON('<path d="M2 2h12v12H2zm1 1v10h10V3z"/><path d="M4.5 4.5h5v1h-5zm0 2h7v1h-7zm0 2h4v1h-4zm0 2h6v1h-6z"/><path d="M10.5 6h2v4h-2z" opacity=".55"/>') },
  { name: 'stickyScroll', className: 'cm-status-sticky', html: ICON('<path d="M2 2h12v4H2z" opacity=".85"/><path d="M2 7.5h9v1H2zm2 2h8v1H4zm0 2h6v1H4zm-2 2h10v1H2z"/>') },
];

const canEdit = state => !state.readOnly;

/** The status bar's text for the cursor and the selections. */
function cursorLabel(state) {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const col = countColumn(line.text.slice(0, main.head - line.from), state.tabSize) + 1;
  let label = `Ln ${line.number}, Col ${col}`;
  if (state.selection.ranges.length > 1) label += ` (${state.selection.ranges.length} selections)`;
  else if (!main.empty) label += ` (${main.to - main.from} selected)`;
  return label;
}

function indentLabel(state) {
  const { insertSpaces, size } = currentIndentation(state);
  return insertSpaces ? `Spaces: ${size}` : `Tab Size: ${size}`;
}

function indentMenu(view) {
  const now = currentIndentation(view.state);
  const set = indentation => view.dispatch({ effects: indentCompartment.reconfigure(indentationConfig(indentation)) });
  const convert = (indentation) => {
    set(indentation);
    const changes = convertIndentationChanges(view.state, indentation);
    if (changes.length) view.dispatch({ changes, userEvent: 'input.indent' });
  };
  return [
    ...[2, 4, 8].map(size => ({ label: `Indent Using Spaces: ${size}`, checked: now.insertSpaces && now.size === size, run: () => set({ insertSpaces: true, size }) })),
    ...[2, 4, 8].map(size => ({ label: `Indent Using Tabs: ${size}`, checked: !now.insertSpaces && now.size === size, run: () => set({ insertSpaces: false, size }) })),
    { sep: true },
    { label: 'Convert Indentation to Spaces', disabled: !canEdit(view.state), run: () => convert({ insertSpaces: true, size: now.size }) },
    { label: 'Convert Indentation to Tabs', disabled: !canEdit(view.state), run: () => convert({ insertSpaces: false, size: now.size }) },
  ];
}

function eolMenu(view) {
  const now = view.state.field(eolField);
  const set = eol => view.dispatch({ effects: setEol.of(eol) });
  return [
    { label: 'LF', hint: 'macOS and Linux', checked: now === '\n', disabled: !canEdit(view.state), run: () => set('\n') },
    { label: 'CRLF', hint: 'Windows', checked: now === '\r\n', disabled: !canEdit(view.state), run: () => set('\r\n') },
  ];
}

function languageMenu(view) {
  const now = view.state.field(languageNameField);
  return [...LANGUAGE_NAMES].sort((a, b) => a.localeCompare(b)).map(name => ({
    label: name,
    checked: name === now,
    run: () => view.dispatch({ effects: [languageCompartment.reconfigure(languageByName(name)), setLanguageName.of(name)] }),
  }));
}

/** The language server's label in the bar: its first language, and its state. */
function lspLabel(status) {
  if (!status) return '';
  const name = String(status.label || 'Language server').split(/,| and /)[0].trim();
  const suffix = {
    starting: ' …', indexing: ' …', error: ' ⚠', 'not-installed': ' (not installed)', off: ' (off)',
    'too-many': ' (paused)', elsewhere: '', stopped: ' (stopped)',
  }[status.state] ?? '';
  return `{ } ${name}${suffix}`;
}

function lspTitle(status) {
  if (!status) return '';
  const what = {
    ready: 'running', restarted: 'running', starting: 'starting', indexing: status.message || 'indexing',
    error: status.message || 'stopped with an error', 'not-installed': `not installed: ${status.install || ''}`,
    off: 'off for this project (its Settings tab)', 'too-many': 'not started: too many language servers are running',
    elsewhere: 'serving another editor of this file', stopped: status.message || 'stopped',
  }[status.state] || status.state;
  return `${status.label}: ${what}`;
}

function lspMenu(view) {
  const link = languageServerOf(view);
  const status = link && link.status;
  if (!status) return [];
  const items = [];
  if (status.sessionId && window.api && window.api.lspRestart) {
    items.push({ label: 'Restart Language Server', run: () => window.api.lspRestart(status.sessionId) });
  } else if (status.state === 'too-many' || status.state === 'stopped') {
    items.push({ label: 'Start Language Server', run: () => link.retry() });
  }
  if (status.install && status.state === 'not-installed') {
    items.push({ label: 'Copy Install Command', hint: status.command || '', run: () => window.api.writeClipboard(status.install) });
  }
  if (status.projectId && typeof window.selectProject === 'function') {
    items.push({ label: 'Project Language Servers…', run: () => window.selectProject(status.projectId, { tab: 'settings' }) });
  }
  items.push({ sep: true }, { label: 'Turn Language Servers Off', run: () => setPref('languageServers', false) });
  return items;
}

function statusBarPanel(view) {
  const dom = document.createElement('div');
  dom.className = 'cm-status-bar';
  const item = (className, title, onClick) => {
    const el = document.createElement(onClick ? 'button' : 'span');
    el.className = `cm-status-item ${className}`;
    if (title) el.title = title;
    if (onClick) {
      el.type = 'button';
      el.addEventListener('mousedown', e => e.preventDefault());
      el.addEventListener('click', () => onClick(el));
    }
    dom.appendChild(el);
    return el;
  };
  const toggles = BAR_TOGGLES.filter(toggle => PREFS.has(toggle.name)).map((toggle) => {
    const el = item(`cm-status-toggle ${toggle.className}`, PREFS.get(toggle.name).label, () => togglePref(toggle.name));
    if (toggle.html) el.innerHTML = toggle.html; else el.textContent = toggle.text;
    return { name: toggle.name, el };
  });
  const vim = item('cm-status-vim', 'Vim mode');
  vim.hidden = true;
  const spacer = document.createElement('span');
  spacer.className = 'cm-status-spacer';
  dom.appendChild(spacer);
  const cursor = item('cm-status-cursor', 'Go to Line (Ctrl+G)', () => openGotoLine(view));
  const indent = item('cm-status-indent', 'Select Indentation', el => showEditorMenu(indentMenu(view), { anchor: el }, { onClose: () => view.focus() }));
  const eol = item('cm-status-eol', 'Select End of Line Sequence', el => {
    if (canEdit(view.state)) showEditorMenu(eolMenu(view), { anchor: el }, { onClose: () => view.focus() });
  });
  const encoding = item('cm-status-encoding', 'Encoding');
  const server = item('cm-status-lsp', '', el => showEditorMenu(lspMenu(view), { anchor: el }, { onClose: () => view.focus() }));
  const language = item('cm-status-language', 'Select Language Mode', el => showEditorMenu(languageMenu(view), { anchor: el }, { onClose: () => view.focus() }));

  function render(state) {
    cursor.textContent = cursorLabel(state);
    indent.textContent = indentLabel(state);
    eol.textContent = state.field(eolField) === '\r\n' ? 'CRLF' : 'LF';
    eol.disabled = !canEdit(state);
    encoding.textContent = state.doc.sliceString(0, 1) === '﻿' ? 'UTF-8 with BOM' : 'UTF-8';
    language.textContent = state.field(languageNameField);
    const mode = state.field(vimMode, false);
    vim.hidden = !mode;
    vim.textContent = mode ? `-- ${mode} --` : '';
    const lsp = state.field(lspStatus, false);
    server.hidden = !lsp;
    server.textContent = lspLabel(lsp);
    server.title = lspTitle(lsp);
    server.dataset.state = lsp ? lsp.state || '' : '';
    for (const { name, el } of toggles) {
      const on = readPref(name);
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
    }
  }
  render(view.state);
  return {
    dom,
    top: false,
    update(update) {
      if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.length || tr.reconfigured)) render(update.state);
    },
  };
}

/** The status bar under the editor. */
const statusBar = showPanel.of(statusBarPanel);

export { statusBar, cursorLabel, indentLabel, lspLabel, lspTitle };
