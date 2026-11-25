// The editor's status bar, as VS Code's: where the cursor is (Ln, Col) and
// what is selected, the indentation (Spaces: 2, Tab Size: 4), the line
// breaks (LF, CRLF), the encoding, the language, and whether whitespace is
// shown. Each choice opens a menu: go to line, indent with spaces or tabs
// and convert the indentation, LF or CRLF, another language.
import { showPanel } from '@codemirror/view';
import { countColumn } from '@codemirror/state';
import { showEditorMenu } from './menu.mjs';
import { openGotoLine } from './find.mjs';
import { LANGUAGE_NAMES, languageByName, languageNameField, languageCompartment, setLanguageName } from './languages.mjs';
import {
  eolField, setEol, indentCompartment, indentationConfig, currentIndentation, convertIndentationChanges,
  showsWhitespace, setShowWhitespace,
} from './indentation.mjs';

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
  const whitespace = item('cm-status-whitespace', 'Show Whitespace', () => setShowWhitespace(!showsWhitespace(view.state)));
  whitespace.textContent = '¶';
  const spacer = document.createElement('span');
  spacer.className = 'cm-status-spacer';
  dom.appendChild(spacer);
  const cursor = item('cm-status-cursor', 'Go to Line (Ctrl+G)', () => openGotoLine(view));
  const indent = item('cm-status-indent', 'Select Indentation', el => showEditorMenu(indentMenu(view), { anchor: el }, { onClose: () => view.focus() }));
  const eol = item('cm-status-eol', 'Select End of Line Sequence', el => {
    if (canEdit(view.state)) showEditorMenu(eolMenu(view), { anchor: el }, { onClose: () => view.focus() });
  });
  const encoding = item('cm-status-encoding', 'Encoding');
  const language = item('cm-status-language', 'Select Language Mode', el => showEditorMenu(languageMenu(view), { anchor: el }, { onClose: () => view.focus() }));

  function render(state) {
    cursor.textContent = cursorLabel(state);
    indent.textContent = indentLabel(state);
    eol.textContent = state.field(eolField) === '\r\n' ? 'CRLF' : 'LF';
    eol.disabled = !canEdit(state);
    encoding.textContent = state.doc.sliceString(0, 1) === '﻿' ? 'UTF-8 with BOM' : 'UTF-8';
    language.textContent = state.field(languageNameField);
    const shown = showsWhitespace(state);
    whitespace.classList.toggle('on', shown);
    whitespace.setAttribute('aria-pressed', String(shown));
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

export { statusBar, cursorLabel, indentLabel };
