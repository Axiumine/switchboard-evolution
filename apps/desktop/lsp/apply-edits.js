// lsp/apply-edits.js — a language server's edits to files no editor has open
// (a rename that reaches other files), written by the main process. Only
// files inside a project's folders; each file is read, changed and written
// back whole. Positions are LSP's: line and UTF-16 character, which is how
// JavaScript strings count.

const fs = require('fs');
const { fileURLToPath } = require('url');

/** The offset of an LSP position in `text` (a character past a line's end is its end). */
function offsetAt(text, lineStarts, { line, character }) {
  if (line >= lineStarts.length) return text.length;
  const start = lineStarts[line];
  const next = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
  let end = next;
  if (end > start && text[end - 1] === '\r') end--;
  return Math.min(start + character, end);
}

/** `text` with the TextEdits applied (they must not overlap, as LSP says). */
function applyTextEdits(text, edits) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const spans = edits.map(e => ({ from: offsetAt(text, lineStarts, e.range.start), to: offsetAt(text, lineStarts, e.range.end), insert: e.newText }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text;
  for (const span of spans) out = out.slice(0, span.from) + span.insert + out.slice(span.to);
  return out;
}

/** A WorkspaceEdit's edits by file path: { [path]: TextEdit[] } (changes and documentChanges both). */
function editsByFile(workspaceEdit) {
  const out = {};
  const add = (uri, edits) => {
    if (!uri || !Array.isArray(edits) || !edits.length) return;
    let file;
    try { file = fileURLToPath(uri); } catch { return; }
    (out[file] = out[file] || []).push(...edits);
  };
  for (const [uri, edits] of Object.entries((workspaceEdit && workspaceEdit.changes) || {})) add(uri, edits);
  for (const change of (workspaceEdit && workspaceEdit.documentChanges) || []) {
    if (change && change.textDocument) add(change.textDocument.uri, change.edits);
  }
  return out;
}

/**
 * Write `fileEdits` ({ [path]: TextEdit[] }) to disk. Every file must be inside
 * a project folder (`folderOf`), or nothing is written. Returns { ok, files } or { error }.
 */
function writeFileEdits(fileEdits, { folderOf, readFile = f => fs.readFileSync(f, 'utf8'), writeFile = (f, t) => fs.writeFileSync(f, t, 'utf8') }) {
  const files = Object.keys(fileEdits || {});
  const outside = files.filter(f => !folderOf(f));
  if (outside.length) return { error: `Not in a project: ${outside.join(', ')}` };
  const next = [];
  for (const file of files) {
    let text;
    try { text = readFile(file); } catch (err) { return { error: `Could not read ${file}: ${err.message}` }; }
    next.push([file, applyTextEdits(text, fileEdits[file])]);
  }
  for (const [file, text] of next) {
    try { writeFile(file, text); } catch (err) { return { error: `Could not write ${file}: ${err.message}` }; }
  }
  return { ok: true, files: files.length };
}

module.exports = { applyTextEdits, editsByFile, writeFileEdits, offsetAt };
