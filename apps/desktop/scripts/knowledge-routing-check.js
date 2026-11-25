#!/usr/bin/env node
// Checks what a project's agents are told against what codebase-memory-mcp
// (CBM) holds, without changing anything (list_projects and query_graph only):
//
//   node scripts/knowledge-routing-check.js <project folder>
//
// It reads the "Code graph" table of the project folder's CLAUDE.md (or
// AGENTS.md) and, for every graph it names, the files CBM holds. Then:
//  - one file, one graph: no file is in two graphs of the table;
//  - routing: each file is in the graph of the innermost folder of the table
//    that holds it (the rule the brief gives the agents);
//  - repositories inside: one the table says is "not indexed" has no file in
//    any graph, one it says is "in X" has its files in X;
//  - cross-repo links: how many CROSS_* edges each graph has (for reading).
// Exit code 1 when a file is in two graphs or in the wrong one.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCbmClient } = require('../cbm-client');
const cbmLocator = require('../cbm-locator');

const SAMPLE = 5;

function readBrief(folder) {
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    try { return fs.readFileSync(path.join(folder, file), 'utf8'); } catch {}
  }
  throw new Error(`No CLAUDE.md or AGENTS.md in ${folder}`);
}

/** The table rows: graphs (folder → name) and repositories inside (path → where). */
function parseTable(text) {
  const start = text.indexOf('## Code graph (codebase-memory-mcp)');
  if (start < 0) throw new Error('The brief has no "Code graph" section: is the code graph on for this project?');
  const graphs = [];
  const modules = [];
  for (const line of text.slice(start).split('\n')) {
    const m = /^\|\s*`([^`]+)`(.*?)\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    const [, folder, note, where] = m;
    if (/\binside `/.test(note)) {
      const inName = /^in `([^`]+)`/.exec(where);
      const own = /^`([^`]+)` \(a graph of its own\)/.exec(where);
      modules.push({ path: folder, where: inName ? 'in' : own ? 'own' : /not indexed/.test(where) ? 'out' : 'unknown', graph: inName ? inName[1] : own ? own[1] : null });
    } else {
      const name = /^`([^`]+)`$/.exec(where);
      if (name) graphs.push({ folder, name: name[1], note: note.trim() });
    }
  }
  return { graphs, modules };
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function allRows(client, project, query) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const args = { project, query, max_rows: 5000, max_output_tokens: 1000000 };
    if (cursor) args.cursor = cursor;
    const r = await client.call('query_graph', args, { timeoutMs: 120000 });
    for (const row of r.rows || []) rows.push(Array.isArray(row) ? row : Object.values(row));
    cursor = r.next_cursor || null;
    if (!cursor || !(r.rows || []).length) break;
  }
  return rows;
}

async function main() {
  const folder = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!folder) {
    console.error('Usage: node scripts/knowledge-routing-check.js <project folder>');
    process.exit(2);
  }
  const { graphs, modules } = parseTable(readBrief(folder));
  const found = cbmLocator.locateCbm();
  if (!found || !found.ok) throw new Error('No codebase-memory-mcp recent enough on this computer');
  // Started in the home folder, which CBM never indexes: this check makes no graph.
  const client = createCbmClient({ locate: () => found, cwd: os.homedir(), log: { warn() {}, info() {} } });
  try {
    const listed = ((await client.call('list_projects', { limit: 500 })).projects || []);
    const owners = new Map(); // absolute file → [graph names]
    const report = { graphs: [], duplicates: [], misrouted: [], modules: [] };
    for (const g of graphs) {
      const entry = listed.find(p => p.name === g.name);
      if (!entry) { report.graphs.push({ ...g, error: 'not in CBM' }); continue; }
      const root = entry.root_path;
      const files = (await allRows(client, g.name, 'MATCH (f:File) RETURN f.file_path')).map(r => path.join(root, String(r[0])));
      for (const f of files) owners.set(f, [...(owners.get(f) || []), g.name]);
      // CROSS_* edges by type, from the schema (CBM's Cypher has no type() in WHERE).
      let cross = null;
      try {
        const schema = await client.call('get_graph_schema', { project: g.name });
        const types = Array.isArray(schema.edge_types) ? schema.edge_types : Array.isArray(schema.edge_types?.rows) ? schema.edge_types.rows : [];
        cross = types.filter(t => String(t.type || t[0] || '').startsWith('CROSS_')).reduce((n, t) => n + (Number(t.count ?? t[1]) || 0), 0);
      } catch {}
      report.graphs.push({ ...g, root, files: files.length, cross });
    }
    const folders = graphs.map(g => ({ ...g, real: path.resolve(g.folder) }));
    for (const [file, names] of owners) {
      if (names.length > 1) report.duplicates.push({ file, graphs: names });
      // The innermost folder of the table that holds the file.
      let best = null;
      for (const f of folders) if (inside(file, f.real) && (!best || inside(f.real, best.real))) best = f;
      if (best && !names.includes(best.name)) report.misrouted.push({ file, in: names, expected: best.name });
    }
    for (const m of modules) {
      const holders = new Set();
      let count = 0;
      for (const [file, names] of owners) if (inside(file, m.path)) { count += 1; names.forEach(n => holders.add(n)); }
      const ok = m.where === 'out' ? count === 0 : m.where === 'in' ? holders.has(m.graph) && holders.size === 1 : m.where === 'own' ? holders.size <= 1 : true;
      report.modules.push({ ...m, files: count, holders: [...holders], ok });
    }

    console.log(`Brief: ${graphs.length} graphs, ${modules.length} repositories inside\n`);
    for (const g of report.graphs) console.log(`  ${g.name.padEnd(40)} ${g.error || `${g.files} files${g.cross != null ? `, ${g.cross} cross-repo links` : ''}`}  ${g.folder}`);
    console.log(`\nOne file, one graph: ${report.duplicates.length ? `${report.duplicates.length} files in two graphs or more` : 'yes'}`);
    for (const d of report.duplicates.slice(0, SAMPLE)) console.log(`  ${d.file}: ${d.graphs.join(', ')}`);
    console.log(`Routing (innermost folder of the table): ${report.misrouted.length ? `${report.misrouted.length} files in another graph` : 'every file where the brief says'}`);
    for (const d of report.misrouted.slice(0, SAMPLE)) console.log(`  ${d.file}: in ${d.in.join(', ')}, the brief says ${d.expected}`);
    if (report.modules.length) console.log('Repositories inside:');
    for (const m of report.modules) console.log(`  ${m.ok ? 'ok ' : 'BAD'} ${m.path}: the brief says ${m.where}${m.graph ? ` (${m.graph})` : ''}; ${m.files} files in ${m.holders.join(', ') || 'no graph'}`);
    const bad = report.duplicates.length || report.misrouted.length || report.modules.some(m => !m.ok);
    if (process.env.ROUTING_JSON) fs.writeFileSync(process.env.ROUTING_JSON, JSON.stringify(report, null, 2));
    process.exitCode = bad ? 1 : 0;
  } finally {
    client.stop();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(2); });
}

module.exports = { parseTable };
