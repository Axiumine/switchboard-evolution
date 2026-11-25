// Copied from packages/shared/usage-chart.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for usage-chart.js, next to this file.

/** The parts of a process-usage reply the rings read (see src/processes/model.ts). */
export type UsageOwner = {
  kind: 'session' | 'task';
  id: string;
  rssBytes: number;
  processCount?: number;
};

export type UsageData = {
  platform?: string;
  totalMemBytes: number;
  usedMemBytes?: number;
  app?: { rssBytes: number; processCount?: number };
  switchboard?: { rssBytes: number; processCount?: number };
  owners?: UsageOwner[];
  disks?: { name: string; mount?: string; totalBytes: number; freeBytes: number; primary?: boolean }[];
};

export type ProjectFolderSize = {
  path: string;
  name: string;
  /** null when it could not be measured. */
  bytes: number | null;
  isRoot: boolean;
  /** The name of the folder of the same project it sits in, counted there. */
  inside: string | null;
  /** Other projects that have it (or a folder holding it). */
  alsoIn: string[];
};

export type ProjectSize = {
  id: string;
  name: string;
  status: string | null;
  /** The project's own size: its folder and attached folders, each byte once. */
  bytes: number;
  /** Its share of the ring: folders shared with a larger project count there. */
  ringBytes: number;
  folders: ProjectFolderSize[];
};

/** The answer of get-project-disk-usage. */
export type ProjectDiskUsage = {
  ok: boolean;
  measuring: boolean;
  measuredAt: number | null;
  projects: ProjectSize[] | null;
  totalBytes: number | null;
};

export type SliceKind =
  | 'app' | 'session' | 'task' | 'other-owners' | 'other-apps' | 'free'
  | 'used' | 'project' | 'other-projects' | 'other-files';

export type Slice<O = UsageOwner> = {
  key: string;
  kind: SliceKind;
  label: string;
  /** What the slice draws. */
  bytes: number;
  /** What the legend shows when it differs (a project's own size). */
  display?: number;
  color: string;
  owner?: O;
  count?: number;
  project?: ProjectSize;
  projects?: ProjectSize[];
};

export type Colors = Record<string, number>;

export const COLORS: {
  app: string;
  owners: readonly string[];
  otherOwners: string;
  otherApps: string;
  free: string;
  diskLow: string;
  diskMid: string;
  diskHigh: string;
};

export function formatBytes(bytes: number): string;
export function formatDisk(bytes: number, platform: string | undefined): string;
export function formatPercent(part: number, total: number): string;
export function ownerKey(owner: Pick<UsageOwner, 'kind' | 'id'>): string;

/** The colour band of what one session or task uses, as the Task Manager's bars: 'mid' from 1 GB, 'high' from 2 GB. */
export function memoryLevel(bytes: number): 'low' | 'mid' | 'high';

/** What each live session uses, by session id, from a measurement (get-process-usage). */
export function sessionMemory(data: Pick<UsageData, 'owners'> | null | undefined): Map<string, number>;

export function memoryTotals(data: UsageData | null | undefined): {
  installed: number;
  used: number | null;
  free: number | null;
  ours: number;
  appBytes: number;
  ownersBytes: number;
  processes: number;
  sessions: number;
  tasks: number;
};

export function assignColors(previous: Colors | null | undefined, keys: string[], count: number): Colors;

export function memorySlices<O extends UsageOwner>(
  data: UsageData & { owners?: O[] },
  options?: { maxOwners?: number; labelFor?: (owner: O) => string; previous?: Colors | null },
): { slices: Slice<O>[]; colors: Colors; total: number };

/** How close the memory in use is to what is installed: 'mid' from 90%, 'high' from 95%. */
export function ramLevel(totals: { installed: number; used: number | null } | null | undefined): 'low' | 'mid' | 'high';

export function diskLevel(disk: { totalBytes: number; freeBytes: number } | null | undefined): { used: number; level: 'low' | 'mid' | 'high' };

export function diskSlices(
  disk: { totalBytes: number; freeBytes: number } | null | undefined,
  options?: { projects?: ProjectSize[] | null; maxProjects?: number; previous?: Colors | null },
): { level: 'low' | 'mid' | 'high'; total: number; slices: Slice[]; colors: Colors };

export function donutPaths(
  slices: { key: string; bytes: number }[],
  options?: { size?: number; thickness?: number; gap?: number; minAngle?: number },
): { key: string; d: string }[];

export function resourceStatus(data: UsageData | null | undefined): {
  ram: string;
  disk: string;
  title: string;
  ramLevel: 'low' | 'mid' | 'high';
  diskLevel: 'low' | 'mid' | 'high';
};
