// Copied from packages/shared/knowledge-model.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for knowledge-model.js, next to this file.

export type Risk = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type Choice = { id: string; label: string; hint?: string; desktopOnly?: boolean };

/** A symbol from any CBM table. */
export type KnowledgeSymbol = {
  qn: string;
  name: string;
  label: string | null;
  file: string | null;
  start: number | null;
  end: number | null;
  rank?: number;
  in?: number;
  out?: number;
  fan_in?: number;
  hop?: number;
  risk?: Risk | null;
  strategy?: string;
  confidence?: number;
  matches?: number[];
  matches_omitted?: number;
};

export type Ambiguity = { message: string; suggestions: KnowledgeSymbol[] };

export type SearchResults = {
  items: KnowledgeSymbol[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  mode: string | null;
  semantic: KnowledgeSymbol[];
  semanticTotal: number;
  semanticHasMore: boolean;
  semanticNextOffset: number | null;
};

export type CodeResults = {
  items: KnowledgeSymbol[];
  raw: { file: string | null; line: number | null; content: string }[];
  directories: { path: string; count: number }[];
  total: number;
  matches: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type Snippet = KnowledgeSymbol & {
  source: string;
  sourceMode: string | null;
  callers: number;
  callees: number;
  callerNames: string[];
  calleeNames: string[];
};

export type Outline = {
  file: string | null;
  items: KnowledgeSymbol[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  docs: { section: string; file: string; line: number }[];
};

export type TraceSides = {
  root: string | null;
  callers: KnowledgeSymbol[];
  callees: KnowledgeSymbol[];
  callersTotal: number;
  calleesTotal: number;
  cursor: string | null;
};

/** A node of the trace tree; children are the next step on the same side, once opened. */
export type TraceTreeNode = { qn: string; name?: string; label?: string | null; risk?: string | null; children?: TraceTreeNode[] };
export type TraceTree = TraceTreeNode & { callers?: TraceTreeNode[]; callees?: TraceTreeNode[] };

export type TraceLayoutNode = {
  id: string;
  qn: string;
  name: string;
  label: string | null;
  risk: Risk | null;
  side: 'root' | 'callers' | 'callees';
  depth: number;
  expandable?: boolean;
  x: number;
  y: number;
};

export type TraceLayout = {
  nodes: TraceLayoutNode[];
  edges: { from: string; to: string; side: 'callers' | 'callees' }[];
  width: number;
  height: number;
  minX: number;
  maxX: number;
};

export type Impact = {
  base: string | null;
  mergeBase: string | null;
  changedFiles: string[];
  changedTotal: number;
  changedCursor: string | null;
  seeds: number;
  impacted: (KnowledgeSymbol & { via: string | null; viaName: string | null; viaEdge: string | null })[];
  impactedTotal: number;
  impactedCursor: string | null;
  modules: { module: string; count: number }[];
  truncated: boolean;
};

export type TestImpact = {
  decision: string | null;
  experimental: boolean;
  lanes: unknown[];
  tests: number;
  suites: number;
  runAllReasons: string[];
  warnings: string[];
};

export type ArchitectureSection = { id: string; title: string; columns: string[]; rows: Record<string, unknown>[] };
export type Architecture = {
  nodes: number;
  edges: number;
  sections: ArchitectureSection[];
  cycles: { size: number; members: string[] }[];
  cyclesTotal: number | null;
};

export type Schema = { labels: { label: string; count: number }[]; edges: { type: string; count: number }[]; adr: boolean };

export type IndexSummary = {
  status: string | null;
  nodes: number;
  edges: number;
  indexedAt: string | null;
  root: string | null;
  crossRepo: { status: string; lastRunAt: string | null; targets: string[]; edges: number; outcome: string | null };
  gaps: { partial: number; unusable: number; skipped: number; files: number; dirs: number };
  docs: { mentions: number } | null;
};

export type IndexGaps = {
  partial: { path: string; ranges: string | null }[];
  unusable: { path: string; reason: string | null }[];
  skipped: { path: string; reason: string | null }[];
  notIndexed: { path: string; reason: string | null }[];
  notIndexedDirs: string[];
  /** A list shorter than its count, or CBM said it cut one short. */
  truncated: boolean;
  /** Whole counts; the lists stop at the rows CBM sent (500 at most with diagnostics 'full'). */
  counts: GapCounts;
  listed: GapCounts;
  complete: { partial: boolean; unusable: boolean; skipped: boolean; notIndexed: boolean; notIndexedDirs: boolean };
  /** Left-out folders by name (".claude" in eight places is one group); `where` is each one's parent, '.' at the top. */
  dirsByName: DirGroup[];
  /** Files read in part, by their first folder. */
  partialByFolder: { folder: string; count: number }[];
  /** Why the listed files were left out. */
  reasons: { reason: string; count: number }[];
  note: string | null;
};

export type GapCounts = { partial: number; unusable: number; skipped: number; notIndexed: number; notIndexedDirs: number };

export type DirGroup = { name: string; count: number; where: string[] };

export type ModuleState = 'own' | 'in' | 'out' | 'unknown';

export type ModuleKind = 'submodule' | 'clone' | 'checkout';

/** A repository inside a folder of the tab (knowledge-modules). */
export type KnowledgeModule = {
  path: string;
  rel: string;
  kind: ModuleKind;
  /** own: a graph of its own; in: in this folder's graph; out: in no graph; unknown: this folder has no graph yet. */
  state: ModuleState;
  /** What CBM flagged inside it (with state 'in'). */
  gaps: number;
  graph: string | null;
  attached: boolean;
};

export type Modules = { modules: KnowledgeModule[]; limited: boolean };

export type Coverage = {
  signal: string | null;
  indexedAt: string | null;
  caveat: string | null;
  paths: { path: string; status: string | null; freshness: string | null; action: string | null; details: { path: string | null; kind: string | null; detail: string | null }[] }[];
  scopes: unknown[];
  hasMore: boolean;
};

export type QueryTable = { columns: string[]; rows: unknown[][]; total: number; hasMore: boolean; truncated: boolean; cursor: string | null };

export type AdrOutline = { headings: { level: number; title: string; start: number | null; end: number | null }[]; lines: number; hasMore: boolean; empty: boolean };

export type Comparison = {
  base: { project: string; nodes: number; edges: number; generation: string | null };
  target: { project: string; nodes: number; edges: number; generation: string | null };
  addedNodes: KnowledgeSymbol[];
  removedNodes: KnowledgeSymbol[];
  addedEdges: { type: string | null; from: string; to: string; fromFile: string | null }[];
  removedEdges: { type: string | null; from: string; to: string; fromFile: string | null }[];
  partial: boolean;
};

export type IndexJob = { state: string; mode?: string; kind?: 'index' | 'refresh'; startedAt?: number; finishedAt?: number | null; error?: string | null };

export const VIEWS: readonly Choice[];
export const LENS_WORKSPACES: readonly Choice[];
export const TRACE_MODES: readonly Choice[];
export const INDEX_MODES: readonly Choice[];
export const TOOL_PROFILES: readonly Choice[];
export const RISKS: readonly Risk[];
export const RISK_COLORS: Readonly<Record<Risk | 'NONE', string>>;
export const CYPHER_EXAMPLES: readonly { name: string; query: string }[];

export function shortName(qn: string | null | undefined): string;
export function parseLines(value: string | number | null | undefined): { start: number; end: number } | null;
export function tableRows(table: unknown): Record<string, unknown>[];
export function symbol(obj: unknown): KnowledgeSymbol;
export function ambiguity(result: unknown): Ambiguity | null;
export function searchResults(result: unknown): SearchResults;
export function codeResults(result: unknown): CodeResults;
export function snippetModel(result: unknown): Snippet;
export function outlineModel(result: unknown): Outline;
export function riskOf(value: unknown): Risk | null;
export function riskColor(value: unknown): string;
export function traceSides(result: unknown): TraceSides;
export function traceLayout(root: TraceTree | null, opts?: { colWidth?: number; rowHeight?: number }): TraceLayout;
export function expandTrace(root: TraceTree, nodeId: string, children: TraceTreeNode[]): TraceTree;
export function impactModel(result: unknown): Impact;
export function testImpactModel(result: unknown): TestImpact;
export function architectureModel(result: unknown): Architecture;
export function schemaModel(result: unknown): Schema;
export function indexSummary(status: unknown): IndexSummary;
export function indexGaps(status: unknown): IndexGaps;
export function dirsByName(dirs: string[]): DirGroup[];
export function byTopFolder(paths: string[]): { folder: string; count: number }[];
export function modulesModel(result: unknown): Modules;
export const MODULE_STATE_TEXT: Readonly<Record<ModuleState, string>>;
export const MODULE_KIND_TEXT: Readonly<Record<ModuleKind, string>>;
export function coverageModel(result: unknown): Coverage;
export function queryTable(result: unknown): QueryTable;
export function cellText(value: unknown): string;
export function adrOutline(result: unknown): AdrOutline;
export function utf8Bytes(text: string): number;
export function compareModel(result: unknown): Comparison;
export function jobText(job: IndexJob | null | undefined): string;
export function jobActive(job: IndexJob | null | undefined): boolean;
export function ago(iso: string | null | undefined, now?: number): string;
