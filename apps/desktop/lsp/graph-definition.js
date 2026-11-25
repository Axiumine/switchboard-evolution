// lsp/graph-definition.js — Go to Definition through the code graph
// (codebase-memory-mcp, knowledge.js) where no language server answers: the
// symbols of the project folder with the name under the cursor, best first
// (the same file, then the same folder of files, then functions, methods,
// classes and types before the rest). Read-only tools only; a folder that is
// not in the graph says so, and is not indexed from here.

const path = require('path');
const KnowledgeModel = require('../public/knowledge-model.js');

const MAX_RESULTS = 25;
const KIND_ORDER = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Struct', 'Trait', 'Enum', 'Module', 'Variable', 'Constant'];
const SKIPPED_KINDS = new Set(['File', 'Folder', 'Project', 'Package', 'Route', 'Section']);

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The candidates in order: [{ file, line, name, label, qn }], `file` absolute. */
function rankDefinitions(items, { folder, filePath }) {
  const here = path.relative(folder, filePath);
  const dir = path.dirname(here);
  const kind = label => (KIND_ORDER.includes(label) ? KIND_ORDER.indexOf(label) : KIND_ORDER.length);
  return items
    .filter(i => i.file && !SKIPPED_KINDS.has(i.label))
    .map(i => ({ ...i, rel: path.isAbsolute(i.file) ? path.relative(folder, i.file) : i.file }))
    .sort((a, b) => (b.rel === here) - (a.rel === here)
      || (path.dirname(b.rel) === dir) - (path.dirname(a.rel) === dir)
      || kind(a.label) - kind(b.label)
      || a.rel.localeCompare(b.rel))
    .map(i => ({ file: path.join(folder, i.rel), line: i.start || 1, name: i.name, label: i.label, qn: i.qn }));
}

/**
 * Where `word` is defined, for the file `filePath`: { locations } or
 * { error: 'outside-project' | 'no-symbol' | 'not-indexed' | 'not-found' | …, message }.
 */
async function findDefinitionInGraph({ folderOf, query }, filePath, word) {
  const place = folderOf(filePath);
  if (!place) return { error: 'outside-project', message: 'The file is not in a project' };
  const name = String(word || '').trim();
  if (!/^[\p{L}\p{N}_$]+$/u.test(name)) return { error: 'no-symbol', message: 'No name under the cursor' };
  let result;
  try {
    result = await query(place.projectId, place.folder, 'search_graph', { name_pattern: `^${escapeRegex(name)}$`, limit: MAX_RESULTS });
  } catch (err) {
    return { error: err.code || 'error', message: err.message };
  }
  const items = KnowledgeModel.searchResults(result).items;
  // Symbols the search found without their lines: ask for them.
  await Promise.all(items.filter(i => i.qn && i.start == null).slice(0, 5).map(async (item) => {
    try {
      const snippet = KnowledgeModel.snippetModel(await query(place.projectId, place.folder, 'get_code_snippet', { qualified_name: item.qn, source_mode: 'outline', max_lines: 1 }));
      if (snippet.start != null) { item.start = snippet.start; item.file = item.file || snippet.file; }
    } catch {}
  }));
  const locations = rankDefinitions(items, { folder: place.folder, filePath });
  if (!locations.length) return { error: 'not-found', message: `No definition of ${name} in the code graph` };
  return { locations };
}

module.exports = { findDefinitionInGraph, rankDefinitions };
