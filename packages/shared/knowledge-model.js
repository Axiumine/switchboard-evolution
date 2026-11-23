// knowledge-model.js — what the Node Knowledge tab shows, from the answers of
// codebase-memory-mcp (CBM) 0.12: its tables as rows of objects, symbols with
// their short name and lines, the two sides of a trace and their layout, the
// impact of a change, the architecture, index status and coverage, and the
// comparison of two graphs.
//
// CBM answers with tables: { cols, rows } or { cols, groups: [{ qn_prefix,
// file, rows }] } (qn = qn_prefix + "." + name), and query_graph with
// { columns, rows }. A name it cannot pin down comes back as
// { status: "ambiguous", suggestions }.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const VIEWS = Object.freeze([
    { id: 'overview', label: 'Overview' },
    { id: 'search', label: 'Search' },
    { id: 'trace', label: 'Trace' },
    { id: 'impact', label: 'Impact' },
    { id: 'query', label: 'Query' },
    { id: 'adr', label: 'ADR' },
    { id: 'coverage', label: 'Coverage' },
    { id: 'compare', label: 'Compare' },
    { id: 'lens', label: 'Lens', desktopOnly: true },
    { id: 'settings', label: 'Settings' },
  ]);

  const LENS_WORKSPACES = Object.freeze([
    { id: 'galaxy', label: 'Galaxy' },
    { id: 'explore', label: 'Explore' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'adr', label: 'ADR' },
    { id: 'coverage', label: 'Coverage' },
    { id: 'system', label: 'System' },
  ]);

  const TRACE_MODES = Object.freeze([
    { id: 'calls', label: 'Calls', hint: 'Who calls it and what it calls' },
    { id: 'data_flow', label: 'Data flow', hint: 'Where its values go' },
    { id: 'cross_service', label: 'Across services', hint: 'HTTP, gRPC and queue calls between services' },
    { id: 'topology', label: 'Topology', hint: 'From a route or a resource' },
    { id: 'deploy', label: 'Deploy', hint: 'What a CI job, script or Make rule deploys' },
    { id: 'run', label: 'Run', hint: 'From a service to the program it starts' },
  ]);

  const INDEX_MODES = Object.freeze([
    { id: 'full', label: 'Full', hint: 'Everything, with semantic links and docs' },
    { id: 'moderate', label: 'Moderate', hint: 'Code and calls, fewer extras' },
    { id: 'fast', label: 'Fast', hint: 'Structure and calls only' },
  ]);

  const TOOL_PROFILES = Object.freeze([
    { id: 'all', label: 'All tools' },
    { id: 'analysis', label: 'Analysis', hint: 'Read and analyse; no indexing or deleting' },
    { id: 'scout', label: 'Scout', hint: 'Search, trace and read code only' },
  ]);

  const RISKS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  // On the app's dark surfaces; the text beside each mark says the level too.
  const RISK_COLORS = Object.freeze({ CRITICAL: '#e05070', HIGH: '#f0a050', MEDIUM: '#c9b458', LOW: '#6f9bd1', NONE: '#8a8aa0' });

  const CYPHER_EXAMPLES = Object.freeze([
    { name: 'What a function calls', query: "MATCH (f:Function)-[:CALLS]->(g) WHERE f.name = 'main' RETURN g.name, g.file_path LIMIT 50" },
    { name: 'Most called functions', query: 'MATCH (f)-[:CALLS]->(g:Function) RETURN g.name, g.file_path, count(f) AS callers ORDER BY callers DESC LIMIT 25' },
    { name: 'Functions nobody calls', query: 'MATCH (f:Function) WHERE NOT EXISTS { (f)<-[:CALLS]-() } RETURN f.name, f.file_path LIMIT 50' },
    { name: 'HTTP routes and handlers', query: 'MATCH (r:Route) OPTIONAL MATCH (h)-[:HANDLES]->(r) RETURN r.name, h.name, h.file_path LIMIT 100' },
    { name: 'Calls into other repositories', query: 'MATCH (a)-[r:CROSS_HTTP_CALLS]->(b) RETURN a.name, a.file_path, b.name, properties(r) LIMIT 50' },
    { name: 'Classes and what they inherit', query: 'MATCH (c:Class)-[:INHERITS]->(p) RETURN c.name, p.name, c.file_path LIMIT 50' },
    { name: 'Environment variables used', query: 'MATCH (n)-[:USAGE]->(e:EnvVar) RETURN e.name, count(n) AS uses ORDER BY uses DESC LIMIT 50' },
    { name: 'Files changed together', query: 'MATCH (a:File)-[r:FILE_CHANGES_WITH]->(b:File) RETURN a.file_path, b.file_path, properties(r) LIMIT 50' },
    { name: 'Tests of a function', query: "MATCH (t)-[:TESTS]->(f:Function) WHERE f.name = 'main' RETURN t.name, t.file_path" },
  ]);

  // --- Tables and symbols ---

  /** The last part of a qualified name, without the quotes CBM puts around names with dots or dashes. */
  function shortName(qn) {
    const text = String(qn == null ? '' : qn);
    if (text.endsWith("'")) {
      const open = text.lastIndexOf("'", text.length - 2);
      if (open >= 0) return text.slice(open + 1, -1);
    }
    const dot = text.lastIndexOf('.');
    return dot >= 0 ? text.slice(dot + 1) : text;
  }

  /** "12-40" → { start: 12, end: 40 }. */
  function parseLines(value) {
    if (typeof value === 'number') return { start: value, end: value };
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(value == null ? '' : value).trim());
    if (!m) return null;
    const start = Number(m[1]);
    return { start, end: m[2] ? Number(m[2]) : start };
  }

  function rowObject(cols, row) {
    const out = {};
    if (Array.isArray(row)) cols.forEach((col, i) => { out[col] = row[i]; });
    else if (row && typeof row === 'object') Object.assign(out, row);
    return out;
  }

  /** A CBM table as rows of objects; grouped tables get qn and file from their group. */
  function tableRows(table) {
    if (!table || typeof table !== 'object') return [];
    const cols = Array.isArray(table.cols) ? table.cols : Array.isArray(table.columns) ? table.columns : [];
    if (Array.isArray(table.groups)) {
      const out = [];
      for (const group of table.groups) {
        const prefix = group && typeof group.qn_prefix === 'string' ? group.qn_prefix : '';
        for (const row of Array.isArray(group?.rows) ? group.rows : []) {
          const obj = rowObject(cols, row);
          if (obj.qn == null && obj.name != null) obj.qn = prefix ? `${prefix}.${obj.name}` : String(obj.name);
          if (obj.file == null && group.file != null) obj.file = group.file;
          out.push(obj);
        }
      }
      return out;
    }
    return (Array.isArray(table.rows) ? table.rows : []).map(row => rowObject(cols, row));
  }

  const SYMBOL_EXTRAS = ['rank', 'in', 'out', 'fan_in', 'hop', 'risk', 'strategy', 'confidence', 'matches', 'matches_omitted'];

  /** One symbol of any table: { qn, name, label, file, start, end, … }. */
  function symbol(obj) {
    const o = obj || {};
    const qn = o.qn != null ? String(o.qn) : o.qualified_name != null ? String(o.qualified_name) : '';
    const lines = parseLines(o.lines) || (o.start_line != null ? { start: Number(o.start_line), end: Number(o.end_line || o.start_line) } : null);
    const out = {
      qn,
      name: o.name != null ? shortName(o.name) : shortName(qn),
      label: o.label != null ? String(o.label) : null,
      file: o.file != null ? String(o.file) : o.file_path != null ? String(o.file_path) : null,
      start: lines ? lines.start : null,
      end: lines ? lines.end : null,
    };
    for (const key of SYMBOL_EXTRAS) if (o[key] !== undefined) out[key] = o[key];
    if (out.risk != null) out.risk = riskOf(out.risk);
    return out;
  }

  /** CBM could not tell which symbol was meant: { message, suggestions } or null. */
  function ambiguity(result) {
    if (!result || result.status !== 'ambiguous') return null;
    return {
      message: String(result.message || 'More than one symbol has this name.'),
      suggestions: (Array.isArray(result.suggestions) ? result.suggestions : []).map(symbol),
    };
  }

  /** search_graph: the text matches and the semantic ones, with paging. */
  function searchResults(result) {
    const r = result || {};
    return {
      items: tableRows(r).map(symbol),
      total: Number(r.total) || 0,
      hasMore: !!r.has_more,
      nextOffset: r.next_offset != null ? Number(r.next_offset) : null,
      mode: r.search_mode || null,
      semantic: tableRows(r.semantic).map(symbol),
      semanticTotal: Number(r.semantic_total) || 0,
      semanticHasMore: !!r.semantic_has_more,
      semanticNextOffset: r.semantic_next_offset != null ? Number(r.semantic_next_offset) : null,
    };
  }

  /** search_code: symbols holding matches, plain matches outside any symbol, and where they are. */
  function codeResults(result) {
    const r = result || {};
    const directories = r.directories && typeof r.directories === 'object' && !Array.isArray(r.directories)
      ? Object.entries(r.directories).map(([dir, count]) => ({ path: dir, count: Number(count) || 0 }))
      : [];
    return {
      items: tableRows(r).map(symbol),
      raw: tableRows(r.raw_matches).map(m => ({ file: m.file != null ? String(m.file) : null, line: Number(m.line) || null, content: m.content != null ? String(m.content) : '' })),
      directories,
      total: Number(r.total_results) || 0,
      matches: Number(r.total_grep_matches) || 0,
      hasMore: !!r.has_more,
      nextOffset: r.next_offset != null ? Number(r.next_offset) : null,
    };
  }

  /** get_code_snippet: the symbol and its source. */
  function snippetModel(result) {
    const r = result || {};
    return {
      ...symbol(r),
      source: r.source != null ? String(r.source) : '',
      sourceMode: r.source_mode || null,
      callers: Number(r.callers) || 0,
      callees: Number(r.callees) || 0,
      callerNames: Array.isArray(r.caller_names) ? r.caller_names.map(String) : [],
      calleeNames: Array.isArray(r.callee_names) ? r.callee_names.map(String) : [],
    };
  }

  /** get_file_outline: the declarations of a file in source order. */
  function outlineModel(result) {
    const r = result || {};
    return {
      file: r.file_path || null,
      items: tableRows(r).map(symbol),
      total: Number(r.total) || 0,
      hasMore: !!r.has_more,
      nextOffset: r.has_more ? (Number(r.offset) || 0) + (Number(r.returned) || 0) : null,
      docs: Array.isArray(r.possibly_described_in) ? r.possibly_described_in.map(d => ({ section: d.section, file: d.file_path, line: d.start_line })) : [],
    };
  }

  // --- Risk ---

  function riskOf(value) {
    const v = String(value == null ? '' : value).toUpperCase();
    return RISKS.includes(v) ? v : null;
  }

  function riskColor(value) {
    return RISK_COLORS[riskOf(value) || 'NONE'];
  }

  // --- Trace ---

  /** trace_path: { root, callers, callees } with each side sorted by hop. */
  function traceSides(result) {
    const r = result || {};
    const byHop = (a, b) => (a.hop || 0) - (b.hop || 0);
    return {
      root: r.function != null ? String(r.function) : null,
      callers: tableRows(r.callers).map(symbol).sort(byHop),
      callees: tableRows(r.callees).map(symbol).sort(byHop),
      callersTotal: Number(r.callers_total) || 0,
      calleesTotal: Number(r.callees_total) || 0,
      cursor: r.next_cursor || r.cursor || null,
    };
  }

  /**
   * Places a two-sided call tree: callers to the left of the root, callees to
   * the right, one column per step. Each node is { qn, name, risk?,
   * children? } where children are the next step on the same side (set when
   * the user opened that node). Leaves stack from the top; a parent sits in the
   * middle of its children. Edges point the way the calls go.
   */
  function traceLayout(root, opts = {}) {
    const colWidth = opts.colWidth || 200;
    const rowHeight = opts.rowHeight || 34;
    const nodes = [];
    const edges = [];
    if (!root) return { nodes, edges, width: 0, height: 0, minX: 0, maxX: 0 };
    const rootNode = { id: 'root', qn: root.qn, name: root.name || shortName(root.qn), label: root.label || null, risk: riskOf(root.risk), side: 'root', depth: 0 };

    function place(list, side, depth, parentId, path) {
      const placed = [];
      for (const child of list || []) {
        const id = `${path}/${child.qn}`;
        const node = { id, qn: child.qn, name: child.name || shortName(child.qn), label: child.label || null, risk: riskOf(child.risk), side, depth, expandable: child.children == null };
        nodes.push(node);
        edges.push(side === 'callees' ? { from: parentId, to: id, side } : { from: id, to: parentId, side });
        node.kids = place(child.children, side, depth + 1, id, id);
        placed.push(node);
      }
      return placed;
    }
    nodes.push(rootNode);
    const left = place(root.callers, 'callers', 1, 'root', 'c');
    const right = place(root.callees, 'callees', 1, 'root', 'e');

    function assignY(list, next) {
      let cursor = next;
      for (const node of list) {
        if (node.kids.length) {
          cursor = assignY(node.kids, cursor);
          node.row = (node.kids[0].row + node.kids[node.kids.length - 1].row) / 2;
        } else {
          node.row = cursor;
          cursor += 1;
        }
      }
      return cursor;
    }
    const leftRows = assignY(left, 0);
    const rightRows = assignY(right, 0);
    const rows = Math.max(leftRows, rightRows, 1);
    // Centre the shorter side and the root on the taller one.
    const shift = (list, by) => { for (const n of list) { n.row += by; shift(n.kids, by); } };
    if (leftRows < rows) shift(left, (rows - leftRows) / 2);
    if (rightRows < rows) shift(right, (rows - rightRows) / 2);
    rootNode.row = (rows - 1) / 2;

    let minX = 0;
    let maxX = 0;
    for (const node of nodes) {
      const col = node.side === 'callers' ? -node.depth : node.depth;
      node.x = col * colWidth;
      node.y = node.row * rowHeight;
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      delete node.kids;
      delete node.row;
    }
    return { nodes, edges, width: maxX - minX + colWidth, height: rows * rowHeight, minX, maxX };
  }

  /** The tree with `children` set on the node at `path` (ids from traceLayout). */
  function expandTrace(root, nodeId, children) {
    if (!root || !nodeId || nodeId === 'root') return root;
    const parts = nodeId.split('/');
    const sideKey = parts[0] === 'c' ? 'callers' : parts[0] === 'e' ? 'callees' : null;
    if (!sideKey) return root;
    const copy = { ...root, [sideKey]: (root[sideKey] || []).map(n => ({ ...n })) };
    let list = copy[sideKey];
    let target = null;
    for (let i = 1; i < parts.length; i++) {
      target = list.find(n => n.qn === parts[i]);
      if (!target) return root;
      if (i < parts.length - 1) {
        target.children = (target.children || []).map(n => ({ ...n }));
        list = target.children;
      }
    }
    target.children = (children || []).map(n => ({ qn: n.qn, name: n.name, label: n.label, risk: n.risk }));
    return copy;
  }

  // --- Impact ---

  /** detect_changes (scope impact or files): what changed and what depends on it. */
  function impactModel(result) {
    const r = result || {};
    const impacted = (Array.isArray(r.impacted) ? r.impacted : tableRows(r.impacted)).map(item => ({
      ...symbol(item),
      via: item.via_qn != null ? String(item.via_qn) : null,
      viaName: item.via_qn != null ? shortName(item.via_qn) : null,
      viaEdge: item.via_edge || null,
    }));
    return {
      base: r.base || null,
      mergeBase: r.merge_base || null,
      changedFiles: Array.isArray(r.changed_files) ? r.changed_files.map(String) : [],
      changedTotal: Number(r.changed_total) || 0,
      changedCursor: r.changed_has_more ? r.changed_next_cursor || null : null,
      seeds: Number(r.seed_symbols) || 0,
      impacted,
      impactedTotal: Number(r.impacted_total) || 0,
      impactedCursor: r.impacted_has_more ? r.impacted_next_cursor || null : null,
      modules: (Array.isArray(r.impacted_modules) ? r.impacted_modules : []).map(m => ({ module: String(m.module), count: Number(m.count) || 0 })),
      truncated: !!r.truncated,
    };
  }

  /** detect_changes with scope tests (experimental in CBM 0.12). */
  function testImpactModel(result) {
    const t = (result && result.test_impact) || {};
    const totals = t.totals || {};
    return {
      decision: t.decision || null,
      experimental: t.experimental !== false,
      lanes: Array.isArray(t.lanes) ? t.lanes : [],
      tests: Number(totals.tests) || 0,
      suites: Number(totals.suites) || 0,
      runAllReasons: Array.isArray(t.run_all_reasons) ? t.run_all_reasons.map(String) : [],
      warnings: Array.isArray(t.warnings) ? t.warnings.map(w => (typeof w === 'string' ? w : JSON.stringify(w))) : [],
    };
  }

  // --- Architecture, schema, index status, coverage ---

  const ARCH_SECTIONS = [
    ['languages', 'Languages'],
    ['packages', 'Packages'],
    ['entry_points', 'Entry points'],
    ['hotspots', 'Hotspots'],
    ['routes', 'Routes'],
    ['layers', 'Layers'],
    ['boundaries', 'Boundaries'],
    ['clusters', 'Clusters'],
    ['node_labels', 'Node kinds'],
    ['edge_types', 'Relationships'],
  ];

  /** get_architecture: its tables in a fixed order, cycles apart. */
  function architectureModel(result) {
    const r = result || {};
    const sections = [];
    for (const [key, title] of ARCH_SECTIONS) {
      const table = r[key];
      if (!table || typeof table !== 'object') continue;
      const columns = Array.isArray(table.cols) ? table.cols : [];
      sections.push({ id: key, title, columns, rows: tableRows(table) });
    }
    return {
      nodes: Number(r.total_nodes) || 0,
      edges: Number(r.total_edges) || 0,
      sections,
      cycles: Array.isArray(r.cycles) ? r.cycles.map(c => ({ size: Number(c.size) || (c.members || []).length, members: (c.members || []).map(String) })) : [],
      cyclesTotal: r.cycles_total != null ? Number(r.cycles_total) : null,
    };
  }

  /** get_graph_schema: node kinds and relationships with their counts. */
  function schemaModel(result) {
    const r = result || {};
    const list = (v, key) => (Array.isArray(v) ? v.map(x => ({ [key]: String(x[key]), count: Number(x.count) || 0 })) : tableRows(v).map(x => ({ [key]: String(x[key]), count: Number(x.count) || 0 })));
    return { labels: list(r.node_labels, 'label'), edges: list(r.edge_types, 'type'), adr: !!r.adr_present };
  }

  function countOf(block, key = 'count') {
    return block && typeof block === 'object' ? Number(block[key]) || 0 : 0;
  }

  /** index_status, short: readiness, size, freshness, cross-repo links and gaps. */
  function indexSummary(status) {
    const s = status || {};
    const cross = s.cross_repo || {};
    const notIndexed = s.not_indexed || {};
    return {
      status: s.status || null,
      nodes: Number(s.nodes) || 0,
      edges: Number(s.edges) || 0,
      indexedAt: s.indexed_at || null,
      root: s.root_path || null,
      crossRepo: {
        status: cross.status || 'never_run',
        lastRunAt: cross.last_run_at || null,
        targets: Array.isArray(cross.targets) ? cross.targets.map(String) : [],
        edges: Number(cross.total_cross_edges) || 0,
        outcome: cross.outcome || null,
      },
      gaps: {
        partial: countOf(s.parse_partial),
        unusable: countOf(s.parse_unusable),
        skipped: countOf(s.skipped),
        files: countOf(notIndexed, 'files_count'),
        dirs: countOf(notIndexed, 'dirs_count'),
      },
      docs: s.doc_links && typeof s.doc_links === 'object' ? { mentions: Number(s.doc_links.mentions) || 0 } : null,
    };
  }

  /**
   * index_status with verbose: the files the graph holds in part (with the
   * lines it could not read), could not read, skipped, and leaves out on
   * purpose (ignore rules, binary files), with why.
   */
  function indexGaps(status) {
    const s = status || {};
    const entry = (f) => (typeof f === 'string' ? { path: f } : f || {});
    const files = (block, fn) => (block && Array.isArray(block.files) ? block.files.map(f => fn(entry(f))) : []);
    const blocks = [s.parse_partial, s.parse_unusable, s.skipped, s.not_indexed];
    return {
      partial: files(s.parse_partial, f => ({ path: String(f.path || ''), ranges: f.error_ranges ? String(f.error_ranges) : null })),
      unusable: files(s.parse_unusable, f => ({ path: String(f.path || ''), reason: f.reason || f.error || null })),
      skipped: files(s.skipped, f => ({ path: String(f.path || ''), reason: f.reason || null })),
      notIndexed: files(s.not_indexed, f => ({ path: String(f.path || ''), reason: f.reason || null })),
      notIndexedDirs: Array.isArray(s.not_indexed?.dirs) ? s.not_indexed.dirs.map(String) : [],
      truncated: blocks.some(b => b && b.truncated),
      // The lists can be cut short; the counts are whole.
      counts: {
        partial: countOf(s.parse_partial),
        unusable: countOf(s.parse_unusable),
        skipped: countOf(s.skipped),
        notIndexed: countOf(s.not_indexed, 'files_count'),
        notIndexedDirs: countOf(s.not_indexed, 'dirs_count'),
      },
      note: s.coverage_note || null,
    };
  }

  /** check_index_coverage: each path asked about, and what to do with it. */
  function coverageModel(result) {
    const r = result || {};
    return {
      signal: r.signal || null,
      indexedAt: r.indexed_at || null,
      caveat: r.caveat || null,
      paths: (Array.isArray(r.paths) ? r.paths : []).map(p => ({
        path: String(p.path || p.requested_path || ''),
        status: p.status || null,
        freshness: p.freshness || null,
        action: p.recommended_action || null,
        details: (Array.isArray(p.coverage) ? p.coverage : []).map(c => ({ path: c.path || null, kind: c.kind || null, detail: c.detail || null })),
      })),
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      hasMore: !!r.has_more,
    };
  }

  /** query_graph: columns and rows as CBM gives them, with paging. */
  function queryTable(result) {
    const r = result || {};
    const columns = Array.isArray(r.columns) ? r.columns.map(String) : Array.isArray(r.cols) ? r.cols.map(String) : [];
    return {
      columns,
      rows: Array.isArray(r.rows) ? r.rows.map(row => (Array.isArray(row) ? row : columns.map(c => row?.[c]))) : [],
      total: Number(r.total) || 0,
      hasMore: !!r.has_more,
      truncated: !!r.truncated,
      cursor: r.next_cursor || null,
    };
  }

  /** A cell of a query result as text. */
  function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  // --- ADR ---

  /** manage_adr outline: the headings. */
  function adrOutline(result) {
    const r = result || {};
    return {
      headings: (Array.isArray(r.headings) ? r.headings : []).map(h => ({
        level: Number(h.level) || 1,
        title: String(h.heading || '').replace(/^#+\s*/, ''),
        start: Number(h.start_line) || null,
        end: Number(h.end_line) || null,
      })),
      lines: Number(r.total_lines) || 0,
      hasMore: !!r.sections_has_more,
      empty: !r.full_content_available && !(Array.isArray(r.headings) && r.headings.length),
    };
  }

  /** The UTF-8 size of a text, against the ADR limit (8000 bytes). */
  function utf8Bytes(text) {
    let bytes = 0;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  // --- Compare ---

  function withoutProject(qn, project) {
    const text = String(qn || '');
    if (project && text === project) return '';
    if (project && text.startsWith(project + '.')) return text.slice(project.length + 1);
    return text;
  }

  /**
   * compare_graphs between two CBM projects. Its identities carry each
   * project's name, so two projects differ everywhere: the names are taken off
   * and what is left on both sides is dropped. When CBM cut its lists short
   * the result is partial.
   */
  function compareModel(result) {
    const r = result || {};
    const baseName = r.base?.project || '';
    const targetName = r.target?.project || '';
    const nodeKey = (n, project) => `${n.label || ''}|${withoutProject(n.qualified_name, project)}`;
    const edgeKey = (e, project) => `${e.type || ''}|${withoutProject(e.source?.qualified_name, project)}|${withoutProject(e.target?.qualified_name, project)}`;
    const list = (block) => (block && Array.isArray(block.items) ? block.items : []);
    const nodesAdded = list(r.nodes?.added);
    const nodesRemoved = list(r.nodes?.removed);
    const edgesAdded = list(r.edges?.added);
    const edgesRemoved = list(r.edges?.removed);
    const removedNodeKeys = new Set(nodesRemoved.map(n => nodeKey(n, baseName)));
    const addedNodeKeys = new Set(nodesAdded.map(n => nodeKey(n, targetName)));
    const removedEdgeKeys = new Set(edgesRemoved.map(e => edgeKey(e, baseName)));
    const addedEdgeKeys = new Set(edgesAdded.map(e => edgeKey(e, targetName)));
    const node = (n, project) => ({ ...symbol({ qn: withoutProject(n.qualified_name, project) || project, label: n.label, file: n.file_path === '{}' ? null : n.file_path }) });
    const edge = (e, project) => ({ type: e.type || null, from: shortName(withoutProject(e.source?.qualified_name, project)), to: shortName(withoutProject(e.target?.qualified_name, project)), fromFile: e.source?.file_path === '{}' ? null : e.source?.file_path || null });
    const isStructural = (n) => n.label === 'Project' || n.label === 'Branch';
    const partial = [r.nodes?.added, r.nodes?.removed, r.edges?.added, r.edges?.removed].some(b => b && b.truncated);
    return {
      base: { project: baseName, nodes: Number(r.base?.node_count) || 0, edges: Number(r.base?.edge_count) || 0, generation: r.base?.generation || null },
      target: { project: targetName, nodes: Number(r.target?.node_count) || 0, edges: Number(r.target?.edge_count) || 0, generation: r.target?.generation || null },
      addedNodes: nodesAdded.filter(n => !isStructural(n) && !removedNodeKeys.has(nodeKey(n, targetName))).map(n => node(n, targetName)),
      removedNodes: nodesRemoved.filter(n => !isStructural(n) && !addedNodeKeys.has(nodeKey(n, baseName))).map(n => node(n, baseName)),
      addedEdges: edgesAdded.filter(e => !removedEdgeKeys.has(edgeKey(e, targetName)) && e.type !== 'HAS_BRANCH').map(e => edge(e, targetName)),
      removedEdges: edgesRemoved.filter(e => !addedEdgeKeys.has(edgeKey(e, baseName)) && e.type !== 'HAS_BRANCH').map(e => edge(e, baseName)),
      partial,
    };
  }

  // --- Jobs and names ---

  const JOB_TEXT = { queued: 'Waiting to index', running: 'Indexing…', cancelling: 'Stopping…', succeeded: 'Indexed', failed: 'Indexing failed', cancelled: 'Indexing stopped' };

  function jobText(job) {
    if (!job) return '';
    const base = JOB_TEXT[job.state] || String(job.state || '');
    if (job.kind === 'refresh' && job.state === 'running') return 'Refreshing…';
    return job.state === 'failed' && job.error ? `${base}: ${job.error}` : base;
  }

  function jobActive(job) {
    return !!job && (job.state === 'queued' || job.state === 'running' || job.state === 'cancelling');
  }

  /** "2026-11-23T11:25:16Z" → a short relative time ("5 min ago"), for status lines. */
  function ago(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round(((now == null ? Date.now() : now) - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  const api = {
    VIEWS,
    LENS_WORKSPACES,
    TRACE_MODES,
    INDEX_MODES,
    TOOL_PROFILES,
    RISKS,
    RISK_COLORS,
    CYPHER_EXAMPLES,
    shortName,
    parseLines,
    tableRows,
    symbol,
    ambiguity,
    searchResults,
    codeResults,
    snippetModel,
    outlineModel,
    riskOf,
    riskColor,
    traceSides,
    traceLayout,
    expandTrace,
    impactModel,
    testImpactModel,
    architectureModel,
    schemaModel,
    indexSummary,
    indexGaps,
    coverageModel,
    queryTable,
    cellText,
    adrOutline,
    utf8Bytes,
    compareModel,
    jobText,
    jobActive,
    ago,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KnowledgeModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
