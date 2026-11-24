// Copied from packages/shared/actions-model.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for actions-model.js, next to this file.

export type StateBucket = 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | 'action' | 'running' | 'queued' | 'waiting';

export type RunStateInfo = {
  key: string;
  bucket: StateBucket;
  label: string;
  a11y: string;
  verb: string;
};

/** What the run list and the run summary need of a run (actions.js normalises the REST answer). */
export type RunLike = {
  number?: number;
  title?: string;
  workflow?: string;
  event?: string;
  status?: string | null;
  conclusion?: string | null;
  branch?: string;
  sha?: string;
  actor?: string;
  triggeringActor?: string;
  pullRequests?: { number: number }[];
  createdAt?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
};

export type JobLike = {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type ParsedQuery = {
  workflow?: string;
  event?: string;
  is?: string;
  branch?: string;
  actor?: string;
  created?: string;
  text: string;
};

export type DispatchField = {
  name: string;
  type: 'string' | 'boolean' | 'choice' | 'number' | 'environment';
  description: string;
  required: boolean;
  default: string;
  options: string[];
};

export type YamlJob = { key: string; name?: string; needs?: string[]; matrix?: boolean; uses?: string | null };

export type GraphNode = {
  key: string;
  name: string;
  needs: string[];
  group: boolean;
  kind: 'job' | 'matrix' | 'reusable';
  other?: boolean;
  jobs: JobLike[];
  state: RunStateInfo;
  durationMs: number | null;
  done: number;
  column: number;
};

export type Graph = { columns: GraphNode[][]; edges: { from: string; to: string }[]; nodes: GraphNode[] };

export type LogLine = { kind: string; text: string; group: number | null; time: string | null };

export const STATUSES: readonly string[];
export const CONCLUSIONS: readonly string[];
export const STATUS_FILTERS: readonly { value: string; label: string }[];
export const STATE_WORDS: Readonly<Record<string, Omit<RunStateInfo, 'key'>>>;
export const EVENTS: readonly string[];
export const QUALIFIERS: readonly string[];
export const INPUT_TYPES: readonly string[];
export const MAX_INPUTS: number;
export const GITHUB_PAGES: Readonly<Record<string, { label: string; path: string }>>;

export function runState(status: string | null | undefined, conclusion: string | null | undefined): RunStateInfo;
export function isActive(status: string | null | undefined): boolean;
export function groupState(items: { status?: string | null; conclusion?: string | null }[]): RunStateInfo;
export function durationMs(start: string | null | undefined, end: string | null | undefined, now?: number): number | null;
export function formatDuration(ms: number | null | undefined): string;
export function runDuration(run: RunLike | null | undefined, now?: number, jobs?: Pick<JobLike, 'completedAt'>[]): number | null;
export function runStillGoing(run: RunLike | null | undefined, jobs?: Pick<JobLike, 'status'>[], now?: number): boolean;
export function formatBytes(bytes: number): string;
export function shortSha(sha: string | null | undefined): string;
export function eventWords(event: string | null | undefined): string;
export function triggerText(run: RunLike | null | undefined): string;
export function parseQuery(text: string | null | undefined): ParsedQuery;
export function queryString(parsed: Partial<ParsedQuery> | null | undefined): string;
export function setQualifier(text: string, key: string, value: string | null | undefined): string;
export function runFilters(parsed: Partial<ParsedQuery>):
  | { params: Record<string, string>; workflow: string | null; error?: undefined }
  | { error: string; params?: undefined; workflow?: undefined };
export function matchesText(run: RunLike & { number?: number }, text: string): boolean;
export function fileName(path: string | null | undefined): string;
export function sortWorkflows<T extends { name?: string; state?: string }>(list: T[]): T[];
export function workflowStateText(state: string | null | undefined): string;
export function badgeUrl(opts: { host?: string; owner: string; repo: string; file: string; branch?: string; event?: string }): string;
export function badgeMarkdown(opts: { name?: string; host?: string; owner: string; repo: string; file: string; branch?: string; event?: string }): string;
export function dispatchFields(inputs: unknown): DispatchField[];
export function validateDispatch(fields: DispatchField[], values: Record<string, string | boolean | number>):
  | { inputs: Record<string, string>; errors?: undefined; error?: undefined }
  | { errors: Record<string, string>; error: string; inputs?: undefined };
export function namePattern(name: string): RegExp | null;
export function graphLayout(yamlJobs: YamlJob[], apiJobs: JobLike[], now?: number, finished?: boolean): Graph;
export function usageRows(jobs: JobLike[], now?: number): { rows: { id: number; name: string; state: RunStateInfo; ms: number | null }[]; total: number };
export function logLineKind(line: string): string;
export function logLineText(line: string): string;
export function logLines(text: string): LogLine[];
export function logTime(time: string | null | undefined): string;
export function missingStepLog(jobActive: boolean): string;
export function parseActionsUrl(url: string | null | undefined): { owner: string; repo: string; runId: number; attempt: number | null; jobId: number | null } | null;
export function githubPage(repo: { host?: string; owner: string; repo: string }, page: string): string | null;
