// The Task Manager: how much RAM each session and task on the computer uses,
// as the desktop's More → Task Manager measures it (get-process-usage). Pure
// functions, so the screen only draws.

import { cleanDisplayName, runtimeLabel, shortProjectPath, type Session } from '@/sessions/model';
import * as UsageChart from '@/shared/vendor/usage-chart';

/** One process of a session's or task's tree, root first, `depth` below the root. */
export type OwnedProcess = {
  pid: number;
  ppid: number;
  rssBytes: number;
  /** null where the computer does not measure CPU (Windows). */
  cpu: number | null;
  name: string;
  depth: number;
  command: string | null;
  /** The name, or the interpreter with its script ("node cli.js"). */
  label: string;
};

/** A live session or a running task, measured over its whole process tree. */
export type Owner = {
  kind: 'session' | 'task';
  /** Session id; for a task, its project path and label joined. */
  id: string;
  pid: number | null;
  type: 'cli' | 'terminal' | 'task';
  runtime?: string | null;
  projectPath: string | null;
  /** Tasks only. */
  label?: string;
  startedAt: number | null;
  busy?: boolean;
  stopRequested: boolean;
  rssBytes: number;
  cpu: number | null;
  processCount: number;
  processes: OwnedProcess[];
  /** False when its pid was not in the process table. */
  found: boolean;
};

/** A disk of the computer and its free space; the one of home and the projects is primary and first. */
export type Disk = { name: string; mount: string; totalBytes: number; freeBytes: number; primary: boolean };

/** What each memory number is: the footprint Activity Monitor shows (macOS), the resident size, or the working set (Windows). */
export type MemoryMeasure = 'footprint' | 'rss' | 'working-set';

export type ProcessUsage = {
  platform: string;
  totalMemBytes: number;
  /** In use on the whole computer (from a desktop of 5.6.1 or later). */
  usedMemBytes?: number;
  memoryMeasure?: MemoryMeasure;
  /** Switchboard's own processes: the app, its helpers and the terminal host (herdr-core). */
  app: { rssBytes: number; cpu: number | null; processCount: number };
  /** The app and every session and task together (5.6.1 or later). */
  switchboard?: { rssBytes: number; processCount: number };
  /** Free disk space (5.6.1 or later). */
  disks?: Disk[];
  /** Heaviest first. */
  owners: Owner[];
  sampledAt: number;
};

/** What names an owner to stop-owner, kill-owned-process and force-stop-owner: nothing else is accepted. */
export type OwnerRef = { kind: 'session'; id: string } | { kind: 'task'; projectPath: string; label: string };

const GB = 1024 ** 3;

/** How often the screen reads again, as the desktop's viewer does. */
export function refreshInterval(platform: string | undefined): number {
  return platform === 'win32' ? 6000 : 3000;
}

export function ownerKey(owner: Pick<Owner, 'kind' | 'id' | 'projectPath' | 'label'>): string {
  return owner.kind === 'task' ? `task:${owner.projectPath}|${owner.label}` : `session:${owner.id}`;
}

export function ownerRef(owner: Pick<Owner, 'kind' | 'id' | 'projectPath' | 'label'>): OwnerRef {
  return owner.kind === 'task'
    ? { kind: 'task', projectPath: owner.projectPath || '', label: owner.label || '' }
    : { kind: 'session', id: owner.id };
}

/** "Claude", "Codex", "OpenCode", "Terminal" or "Task". */
export function kindLabel(owner: Pick<Owner, 'kind' | 'type' | 'runtime'>): string {
  if (owner.kind === 'task') return 'Task';
  if (owner.type === 'terminal') return 'Terminal';
  return runtimeLabel(owner.runtime);
}

/** The session's name as the session list shows it, the task's label, or what it is. */
export function ownerTitle(owner: Pick<Owner, 'kind' | 'id' | 'type' | 'runtime' | 'label'>, sessions: ReadonlyMap<string, Session>): string {
  if (owner.kind === 'task') return owner.label || 'Task';
  const session = sessions.get(owner.id);
  const name = session ? cleanDisplayName(session.name || session.aiTitle || session.summary) : '';
  if (name) return name;
  if (owner.type === 'terminal') return 'Terminal';
  return `${kindLabel(owner)} session`;
}

/** "Claude · contributions/switchboard · PID 4242". */
export function ownerSubtitle(owner: Pick<Owner, 'kind' | 'type' | 'runtime' | 'projectPath' | 'pid'>): string {
  const parts = [kindLabel(owner)];
  if (owner.projectPath) parts.push(shortProjectPath(owner.projectPath));
  if (owner.pid) parts.push(`PID ${owner.pid}`);
  return parts.join(' · ');
}

/** "512 MB", "1.50 GB": the desktop's own formatter (usage-chart.js). */
export function formatBytes(bytes: number): string {
  return UsageChart.formatBytes(bytes);
}

export function formatCpu(cpu: number | null | undefined): string {
  if (cpu === null || cpu === undefined) return '—';
  return `${cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)}%`;
}

/** "12% of RAM", or '' when the installed memory is unknown. */
export function formatShare(bytes: number, totalMemBytes: number): string {
  if (!totalMemBytes) return '';
  const share = (bytes / totalMemBytes) * 100;
  return `${share >= 10 ? Math.round(share) : share.toFixed(1)}% of RAM`;
}

/** "<1m", "42m", "3h 05m", "2d 4h"; "—" when unknown. */
export function formatUptime(startedAt: number | null | undefined, now: number): string {
  if (!startedAt) return '—';
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The colour band of an amount of memory: amber from 1 GB, red from 2 GB. */
export function memoryLevel(bytes: number): 'low' | 'mid' | 'high' {
  if (bytes >= 2 * GB) return 'high';
  if (bytes >= GB) return 'mid';
  return 'low';
}

/**
 * The cards above the list, as the desktop shows them: the memory installed,
 * the memory in use on the whole computer, and what Switchboard uses with all
 * its sessions and tasks (the app, its terminal host, every session and task).
 * Shares are of the installed memory, 0 to 1. `used` is null from a desktop
 * too old to say.
 */
export function memorySummary(usage: Pick<ProcessUsage, 'owners' | 'totalMemBytes' | 'usedMemBytes' | 'app' | 'switchboard'>) {
  const totals = UsageChart.memoryTotals(usage);
  const { installed, used, ours } = totals;
  const share = (bytes: number) => (installed ? Math.min(1, bytes / installed) : 0);
  const running = [`${totals.sessions} session${totals.sessions === 1 ? '' : 's'}`];
  if (totals.tasks) running.push(`${totals.tasks} task${totals.tasks === 1 ? '' : 's'}`);
  return {
    installed,
    used,
    free: totals.free,
    usedShare: used === null ? 0 : share(used),
    ours,
    oursShare: share(ours),
    appBytes: totals.appBytes,
    ownersBytes: totals.ownersBytes,
    processCount: totals.processes,
    running: running.join(', '),
  };
}

/** "12%": a share of the installed memory, '' when that is unknown. */
export function formatPercent(bytes: number, totalMemBytes: number): string {
  return UsageChart.formatPercent(bytes, totalMemBytes);
}

/** Disk sizes as the computer shows them: a Mac counts 1000 bytes to the kilobyte, Windows and Linux 1024. */
export function formatDisk(bytes: number, platform: string | undefined): string {
  return UsageChart.formatDisk(bytes, platform);
}

/** How full a disk is (0 to 1), and its colour: amber under 20% free, red under 10%. */
export function diskFill(disk: Pick<Disk, 'totalBytes' | 'freeBytes'>): { used: number; level: 'low' | 'mid' | 'high' } {
  return UsageChart.diskLevel(disk);
}

/** The line under the list: what the numbers are. */
export function measureNote(measure: MemoryMeasure | undefined): string {
  if (measure === 'footprint') {
    return 'Memory is each process’s footprint, as Activity Monitor shows it (memory the system compressed included), summed over a session’s whole process tree: the CLI, its MCP servers and anything it started. In use is Activity Monitor’s Memory Used: app memory, wired and compressed. The app counts its window, helpers and terminal host (herdr-core).';
  }
  if (measure === 'working-set') {
    return 'Memory is the working set of each session’s whole process tree: the CLI, its MCP servers and anything it started. Memory shared between processes can be counted more than once. In use is everything but the available memory.';
  }
  return 'Memory is the resident memory (RSS) of each session’s whole process tree: the CLI, its MCP servers and anything it started. Memory shared between processes can be counted more than once.';
}

/** A row's bar, relative to the heaviest row; never thinner than a sliver. */
export function barShare(bytes: number, maxBytes: number): number {
  return maxBytes ? Math.max(0.015, Math.min(1, bytes / maxBytes)) : 0;
}

/** Every session id in the session lists, for titles. */
export function sessionsById(folders: readonly { sessions: Session[] }[] | undefined): Map<string, Session> {
  const map = new Map<string, Session>();
  for (const folder of folders || []) for (const session of folder.sessions) map.set(session.sessionId, session);
  return map;
}

/** A task's run, as get-task-run answers (task-manager.js serializeRun, with its output). */
export type TaskRun = {
  projectPath: string;
  label: string;
  state: string;
  running: boolean;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stopRequested: boolean;
  output?: string;
};

// Colours, cursor moves and window titles: what a terminal draws, not text.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * A task's terminal output as plain text: no escape sequences, and a line a
 * progress bar redrew with \r shows only its last state. Only the last
 * `maxChars` are kept.
 */
export function plainOutput(raw: string | null | undefined, maxChars = 60000): string {
  const text = String(raw || '');
  const tail = text.length > maxChars ? text.slice(-maxChars) : text;
  return tail
    .replace(ANSI, '')
    .split('\n')
    .map((line) => {
      const parts = line.replace(/\r+$/, '').split('\r');
      return parts[parts.length - 1].replace(CONTROL, '');
    })
    .join('\n');
}

/** "running", "stopping…", "exited 0", "exited 1", "killed (SIGTERM)", "failed: …". */
export function runStateLabel(run: Pick<TaskRun, 'running' | 'stopRequested' | 'exitCode' | 'signal' | 'error' | 'state'>): string {
  if (run.running) return run.stopRequested ? 'stopping…' : 'running';
  if (run.error) return `failed: ${run.error}`;
  if (run.signal) return `killed (${run.signal})`;
  if (run.exitCode !== null && run.exitCode !== undefined) return `exited ${run.exitCode}`;
  return run.state || 'not running';
}
