// The rows of the chat, from the transcript's items: tool calls in a row
// fold into one group ("Read 2 files, ran 1 command"), so a phone screen
// shows the conversation rather than every step; and the time goes above a
// message after a pause or on a new day.

import { planOf } from './file-refs';
import type { ChatItem } from './transcript';

export type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

export type ChatRow =
  /** A message, a command, a thinking line, or a tool call on its own (`running` while it has no result). */
  | { kind: 'item'; id: string; item: ChatItem; running?: boolean }
  /**
   * Two or more tool calls in a row, and the thinking between them. `running`
   * for the last group while its last tool has no result.
   */
  | { kind: 'tools'; id: string; items: ChatItem[]; tools: ToolItem[]; summary: string; running: boolean }
  | { kind: 'time'; id: string; label: string };

export type ToolKind = 'read' | 'search' | 'websearch' | 'fetch' | 'command' | 'edit' | 'write' | 'agent' | 'other';

const KINDS: Record<string, ToolKind> = {
  Read: 'read', NotebookRead: 'read', read_file: 'read', view_image: 'read',
  Grep: 'search', Glob: 'search', LS: 'search', grep_files: 'search', list_dir: 'search',
  WebSearch: 'websearch', web_search: 'websearch',
  WebFetch: 'fetch',
  Bash: 'command', BashOutput: 'command', KillShell: 'command', KillBash: 'command', PowerShell: 'command',
  shell: 'command', exec_command: 'command', local_shell: 'command', write_stdin: 'command',
  Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', apply_patch: 'edit',
  Write: 'write',
  Task: 'agent', Agent: 'agent',
};

/** What a tool does, by its name (Claude Code's, and Codex's as the desktop maps them). */
export function toolKind(name: string): ToolKind {
  return KINDS[name] ?? 'other';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const PHRASES: Record<ToolKind, (n: number) => string> = {
  read: (n) => `read ${plural(n, 'file', 'files')}`,
  search: (n) => `searched for ${plural(n, 'pattern', 'patterns')}`,
  websearch: (n) => `searched the web ${n === 1 ? 'once' : `${n} times`}`,
  fetch: (n) => `fetched ${plural(n, 'page', 'pages')}`,
  command: (n) => `ran ${plural(n, 'command', 'commands')}`,
  edit: (n) => `edited ${plural(n, 'file', 'files')}`,
  write: (n) => `wrote ${plural(n, 'file', 'files')}`,
  agent: (n) => `ran ${plural(n, 'agent', 'agents')}`,
  other: (n) => `used ${plural(n, 'tool', 'tools')}`,
};

/** "Read 2 files, ran 1 command, edited 1 file": each kind once, in the order it first ran. */
export function toolsSummary(tools: ToolItem[]): string {
  const counts = new Map<ToolKind, number>();
  for (const tool of tools) {
    const kind = toolKind(tool.name);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const text = [...counts].map(([kind, n]) => PHRASES[kind](n)).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A plan up for approval is a card of its own, never folded away.
const foldable = (item: ChatItem) => (item.kind === 'tool' && !planOf(item)) || item.kind === 'thinking';

/**
 * The chat's rows, oldest first. Two or more tool calls in a row (with the
 * thinking between them) become one group; a single call stays a row of
 * its own, and anything else (a message, a command) ends a group.
 */
export function groupTools(items: ChatItem[]): ChatRow[] {
  const rows: ChatRow[] = [];
  const plain = (item: ChatItem) => rows.push({ kind: 'item', id: item.id, item });
  let run: ChatItem[] = [];
  const flush = () => {
    const tools = run.filter((item): item is ToolItem => item.kind === 'tool');
    if (tools.length < 2) {
      run.forEach(plain);
    } else {
      // Thinking before the first call and after the last stays outside the group.
      const first = run.indexOf(tools[0]);
      const last = run.lastIndexOf(tools[tools.length - 1]);
      run.slice(0, first).forEach(plain);
      rows.push({ kind: 'tools', id: `tools:${tools[0].id}`, items: run.slice(first, last + 1), tools, summary: toolsSummary(tools), running: false });
      run.slice(last + 1).forEach(plain);
    }
    run = [];
  };
  for (const item of items) {
    if (foldable(item)) run.push(item);
    else { flush(); plain(item); }
  }
  flush();
  // Only the latest tools can still be running.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === 'tools') { row.running = row.tools[row.tools.length - 1].result === undefined; break; }
    if (row.kind === 'item' && row.item.kind === 'tool') { row.running = row.item.result === undefined; break; }
  }
  return rows;
}

const GAP_MS = 30 * 60 * 1000;

function rowTime(row: ChatRow): number | undefined {
  const iso = row.kind === 'tools' ? row.tools[0].time : row.kind === 'item' ? row.item.time : undefined;
  const time = Date.parse(iso || '');
  return Number.isNaN(time) ? undefined : time;
}

const dayOf = (time: number) => new Date(time).toDateString();
const pad = (n: number) => String(n).padStart(2, '0');

/** "Today, 09:12", "Yesterday, 23:50", then the date ("Tue, 20 Oct, 14:30"), with the year when it is not this one. */
export function timeLabel(time: number, now: number): string {
  const date = new Date(time);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayOf(time) === dayOf(now)) return `Today, ${clock}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayOf(time) === yesterday.toDateString()) return `Yesterday, ${clock}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${day}, ${clock}`;
}

/** The rows with a time above the first, and above any that follows a pause of over 30 minutes or starts a new day. */
export function withSeparators(rows: ChatRow[], now: number): ChatRow[] {
  const out: ChatRow[] = [];
  let previous: number | undefined;
  for (const row of rows) {
    const time = rowTime(row);
    if (time !== undefined) {
      if (previous === undefined || time - previous > GAP_MS || dayOf(time) !== dayOf(previous)) {
        out.push({ kind: 'time', id: `time:${row.id}`, label: timeLabel(time, now) });
      }
      previous = time;
    }
    out.push(row);
  }
  return out;
}
