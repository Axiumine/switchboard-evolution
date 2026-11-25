// Go to Symbol in the file (Cmd/Ctrl+Shift+O), as VS Code's: the classes,
// functions, methods and types of the code, the headings of Markdown, the
// top-level keys of JSON and YAML, the rules of CSS, read from the syntax
// tree; the functions of a shell script, the tables of TOML and the stages of
// a Dockerfile, read from their lines. A list filtered as you type; moving
// in it shows each symbol, Enter goes there, Escape goes back.
import { EditorView, keymap } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { languageNameField } from './languages.mjs';

/** Syntax-tree nodes that are symbols: their kind, and the child nodes that can hold their name. */
const SYMBOL_NODES = {
  // JavaScript and TypeScript
  ClassDeclaration: { kind: 'class', names: ['VariableDefinition', 'TypeDefinition', 'Definition'] },
  FunctionDeclaration: { kind: 'function', names: ['VariableDefinition'] },
  MethodDeclaration: { kind: 'method', names: ['PropertyDefinition', 'PrivatePropertyDefinition', 'Definition'] },
  InterfaceDeclaration: { kind: 'interface', names: ['TypeDefinition', 'Definition'] },
  TypeAliasDeclaration: { kind: 'type', names: ['TypeDefinition'] },
  EnumDeclaration: { kind: 'enum', names: ['TypeDefinition', 'VariableDefinition', 'Definition'] },
  // Python, and C++ (whose name is in its FunctionDeclarator)
  ClassDefinition: { kind: 'class', names: ['VariableName'] },
  FunctionDefinition: { kind: 'function', names: ['VariableName', 'FunctionDeclarator'] },
  // Rust
  StructItem: { kind: 'struct', names: ['TypeIdentifier'] },
  EnumItem: { kind: 'enum', names: ['TypeIdentifier'] },
  TraitItem: { kind: 'interface', names: ['TypeIdentifier'] },
  ImplItem: { kind: 'class', names: ['TypeIdentifier', 'ScopedTypeIdentifier', 'GenericType'] },
  FunctionItem: { kind: 'function', names: ['BoundIdentifier'] },
  ModItem: { kind: 'module', names: ['BoundIdentifier'] },
  // Go
  FunctionDecl: { kind: 'function', names: ['DefName'] },
  MethodDecl: { kind: 'method', names: ['FieldName'] },
  TypeSpec: { kind: 'type', names: ['DefName'] },
  // C++
  ClassSpecifier: { kind: 'class', names: ['TypeIdentifier'] },
  StructSpecifier: { kind: 'struct', names: ['TypeIdentifier'] },
  NamespaceDefinition: { kind: 'module', names: ['NamespaceIdentifier', 'Identifier'] },
};

const DECLARATOR_NAMES = ['Identifier', 'ScopedIdentifier', 'FieldIdentifier', 'QualifiedIdentifier', 'DestructorName', 'OperatorName'];
const FUNCTION_VALUES = new Set(['ArrowFunction', 'FunctionExpression', 'ClassExpression']);

function nodeText(state, node) {
  return state.sliceDoc(node.from, node.to);
}

/** The text of the first child of `node` named in `names` (a C++ declarator looked into). */
function childName(state, node, names) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'FunctionDeclarator' && names.includes('FunctionDeclarator')) {
      const inner = childName(state, child, DECLARATOR_NAMES);
      if (inner) return inner;
    } else if (names.includes(child.name)) return nodeText(state, child);
  }
  return '';
}

/** `const f = () => {}` and `x = function () {}`: the variable named before a function or class. */
function functionVariables(state, node) {
  const out = [];
  let definition = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'PropertyDefinition') definition = child;
    else if (FUNCTION_VALUES.has(child.name) && definition) {
      out.push({ name: nodeText(state, definition), kind: child.name === 'ClassExpression' ? 'class' : 'function', from: definition.from });
      definition = null;
    }
  }
  return out;
}

const HEADING = /^(?:ATXHeading|SetextHeading)(\d)$/;

/**
 * The symbols of the editor's text, in order: { name, kind, from, depth,
 * container }. `depth` counts the symbols around it (a heading's level for
 * Markdown); `container` is the name of the one it is in.
 */
function documentSymbols(state, { timeout = 200 } = {}) {
  const tree = ensureSyntaxTree(state, state.doc.length, timeout) || syntaxTree(state);
  const symbols = [];
  const stack = []; // [{ to, name }] the symbols the cursor of the walk is inside
  const push = (symbol, node) => {
    while (stack.length && stack[stack.length - 1].to <= symbol.from) stack.pop();
    const container = stack.length ? stack[stack.length - 1].name : '';
    symbols.push({ ...symbol, depth: symbol.depth ?? stack.length, container });
    if (node) stack.push({ to: node.to, name: symbol.name });
  };
  tree.iterate({
    enter(ref) {
      const { name } = ref;
      const heading = HEADING.exec(name);
      if (heading) {
        const line = state.doc.lineAt(ref.from).text;
        const title = name.startsWith('ATX') ? line.replace(/^\s*#+\s*/, '').replace(/\s+#+\s*$/, '') : line.trim();
        if (title) push({ name: title, kind: 'heading', from: ref.from, depth: Number(heading[1]) - 1 });
        return false;
      }
      const node = ref.node;
      if (name === 'Property' && node.parent?.name === 'Object' && node.parent.parent?.name === 'JsonText') {
        const key = node.getChild('PropertyName');
        if (key) push({ name: nodeText(state, key).replace(/^"|"$/g, ''), kind: 'key', from: ref.from, depth: 0 });
        return false;
      }
      if (name === 'Pair' && node.parent?.name === 'BlockMapping' && node.parent.parent?.name === 'Document') {
        const key = node.getChild('Key');
        if (key) push({ name: nodeText(state, key), kind: 'key', from: ref.from, depth: 0 });
        return false;
      }
      if (name === 'RuleSet') {
        const block = node.getChild('Block');
        const selector = state.sliceDoc(ref.from, block ? block.from : ref.to).replace(/\s+/g, ' ').trim();
        if (selector) push({ name: selector, kind: 'selector', from: ref.from }, node);
        return undefined;
      }
      if (name === 'VariableDeclaration' || name === 'PropertyDeclaration') {
        for (const symbol of functionVariables(state, node)) push(symbol, null);
        return undefined;
      }
      const spec = SYMBOL_NODES[name];
      if (!spec) return undefined;
      const symbolName = childName(state, node, spec.names);
      if (symbolName) push({ name: symbolName, kind: spec.kind, from: ref.from }, node);
      return undefined;
    },
  });
  if (symbols.length) return symbols;
  return lineSymbols(state);
}

/** Languages without a syntax tree (CodeMirror's legacy modes): their symbols by line. */
const LINE_SYMBOLS = {
  Shell: [{ re: /^\s*(?:function\s+)?([A-Za-z_][\w:.-]*)\s*\(\s*\)\s*\{?/, kind: 'function' }, { re: /^\s*function\s+([A-Za-z_][\w:.-]*)/, kind: 'function' }],
  TOML: [{ re: /^\s*\[\[?\s*([^\]]+?)\s*\]\]?/, kind: 'module' }],
  Dockerfile: [{ re: /^\s*FROM\s+\S+(?:\s+AS\s+(\S+))?/i, kind: 'module', whole: true }],
  Diff: [{ re: /^\+\+\+ (?:b\/)?(.+)$/, kind: 'file' }],
};

function lineSymbols(state) {
  const rules = LINE_SYMBOLS[state.field(languageNameField, false)];
  if (!rules) return [];
  const out = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    for (const rule of rules) {
      const m = rule.re.exec(line.text);
      if (!m) continue;
      const name = (m[1] || (rule.whole ? line.text.trim() : '')).trim();
      if (name) { out.push({ name, kind: rule.kind, from: line.from, depth: 0, container: '' }); break; }
    }
  }
  return out;
}

/**
 * How well `query` matches `name`: its letters in order (a subsequence), case
 * ignored; a match at the start or in one piece scores higher. -1 when it does
 * not match.
 */
function matchScore(name, query) {
  if (!query) return 0;
  const text = name.toLowerCase();
  const q = query.toLowerCase();
  const at = text.indexOf(q);
  if (at === 0) return 1000 - text.length;
  if (at > 0) return 500 - at;
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i === q.length ? 100 - text.length : -1;
}

/** The symbols `query` matches, best first (in document order when the query is empty). */
function filterSymbols(symbols, query) {
  if (!query) return symbols;
  return symbols
    .map((symbol, index) => ({ symbol, index, score: matchScore(symbol.name, query) }))
    .filter(s => s.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(s => s.symbol);
}

const KIND_ICONS = {
  class: 'C', struct: 'S', interface: 'I', type: 'T', enum: 'E', function: 'ƒ', method: 'm', module: '{}', heading: '#', key: 'k', selector: '.', file: '±',
};

function createSymbolPicker(parent, view) {
  const box = document.createElement('div');
  box.className = 'cm-symbol-picker';
  box.style.display = 'none';
  box.innerHTML = `
    <input type="text" class="terminal-search-input cm-symbol-input" placeholder="Go to symbol in the file" aria-label="Go to symbol" spellcheck="false" />
    <div class="cm-symbol-list" role="listbox"></div>
  `;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  parent.appendChild(box);
  const input = box.querySelector('input');
  const list = box.querySelector('.cm-symbol-list');
  let symbols = [];
  let shown = [];
  let active = 0;
  let original = null;

  function render() {
    shown = filterSymbols(symbols, input.value.trim());
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.slice(0, 500).map((symbol, i) => {
      const row = document.createElement('div');
      row.className = `cm-symbol-row${i === active ? ' active' : ''}`;
      row.setAttribute('role', 'option');
      row.style.paddingLeft = `${8 + Math.min(symbol.depth, 6) * 12}px`;
      const icon = document.createElement('span');
      icon.className = `cm-symbol-kind cm-symbol-kind-${symbol.kind}`;
      icon.textContent = KIND_ICONS[symbol.kind] || '•';
      const name = document.createElement('span');
      name.className = 'cm-symbol-name';
      name.textContent = symbol.name;
      row.append(icon, name);
      if (symbol.container) {
        const container = document.createElement('span');
        container.className = 'cm-symbol-container';
        container.textContent = symbol.container;
        row.appendChild(container);
      }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); active = i; accept(); });
      return row;
    }));
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'cm-symbol-empty';
      empty.textContent = symbols.length ? 'No matching symbols' : 'No symbols in this file';
      list.appendChild(empty);
    }
    preview();
  }

  function preview() {
    const symbol = shown[active];
    list.querySelectorAll('.cm-symbol-row').forEach((row, i) => row.classList.toggle('active', i === active));
    const row = list.children[active];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    if (symbol) view.dispatch({ effects: EditorView.scrollIntoView(symbol.from, { y: 'center' }) });
  }

  function accept() {
    const symbol = shown[active];
    if (!symbol) return;
    original = null;
    close();
    view.dispatch({ selection: EditorSelection.cursor(symbol.from), effects: EditorView.scrollIntoView(symbol.from, { y: 'center' }) });
  }

  function open() {
    symbols = documentSymbols(view.state);
    original = { selection: view.state.selection, head: view.state.selection.main.head };
    input.value = '';
    active = 0;
    // Start on the symbol the cursor is in.
    const head = view.state.selection.main.head;
    for (let i = 0; i < symbols.length; i++) if (symbols[i].from <= head) active = i;
    box.style.display = 'flex';
    render();
    input.focus();
  }

  /** Hide the list; with `restore`, back to where the cursor was before it (Escape). */
  function close({ focus = true, restore = true } = {}) {
    if (box.style.display === 'none') return;
    box.style.display = 'none';
    if (original && restore) {
      view.dispatch({ selection: original.selection, effects: EditorView.scrollIntoView(original.head, { y: 'center' }) });
      original = null;
    }
    original = null;
    if (focus) view.focus();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); preview(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); preview(); e.preventDefault(); }
    else if (e.key === 'PageDown') { active = Math.min(shown.length - 1, active + 10); preview(); e.preventDefault(); }
    else if (e.key === 'PageUp') { active = Math.max(0, active - 10); preview(); e.preventDefault(); }
    else if (e.key === 'Enter') { accept(); e.preventDefault(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) close({ focus: false, restore: false }); }, 0));

  return { open, close, isOpen: () => box.style.display !== 'none' };
}

function openSymbolPicker(view) {
  const parent = view.dom.parentElement;
  if (!parent) return false;
  if (parent._cmSearchBar) parent._cmSearchBar.close({ focus: false });
  if (parent._cmGotoLine) parent._cmGotoLine.close({ focus: false });
  if (!parent._cmSymbolPicker) parent._cmSymbolPicker = createSymbolPicker(parent, view);
  parent._cmSymbolPicker.open();
  return true;
}

const symbolKeymap = keymap.of([
  { key: 'Mod-Shift-o', run: openSymbolPicker, scope: 'editor sb-editor-keys', preventDefault: true },
]);

export { documentSymbols, filterSymbols, matchScore, openSymbolPicker, symbolKeymap };
