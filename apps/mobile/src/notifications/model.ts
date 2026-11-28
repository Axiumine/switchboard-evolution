import type { ConnectionStatus } from '@/remote/client';

// What the phone's notifications say and when. The computer decides what is
// worth an alert (session-alerts.js); a computer without it is followed
// through its events, as the phone's banner used to.

/** A session that needs you or finished while nobody looked. */
export type SessionAlert = {
  sessionId: string;
  kind: 'attention' | 'finished';
  title: string;
  body: string;
  /** A change waiting for review. */
  diffId?: string;
  /** When the computer raised it: the same alert has the same time. */
  at?: number;
};

const PREFIX = 'session:';

/** One notification per session: a newer alert replaces it. */
export const notificationId = (sessionId: string): string => `${PREFIX}${sessionId}`;

export const sessionOfNotification = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null);

/** An alert as the computer sends it, or as a notification carries it; null for anything else. */
export function readAlert(value: unknown): SessionAlert | null {
  if (!value || typeof value !== 'object') return null;
  const { sessionId, kind, title, body, diffId, at } = value as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (kind !== 'attention' && kind !== 'finished') return null;
  return {
    sessionId,
    kind,
    title: typeof title === 'string' && title ? title : 'A session',
    body: typeof body === 'string' ? body : '',
    ...(typeof diffId === 'string' ? { diffId } : {}),
    ...(typeof at === 'number' ? { at } : {}),
  };
}

/** The alert in an event of a computer that raises none of its own. */
export function alertFromEvent(event: string, args: any[], titleOf: (sessionId: string) => string): SessionAlert | null {
  const [sessionId] = args;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (event === 'mcp-open-diff') {
    const [, diffId, data] = args;
    const file = String(data?.oldFilePath || '').split(/[\\/]/).pop() || 'a file';
    return { sessionId, diffId, kind: 'attention', title: titleOf(sessionId), body: `Wants to change ${file}` };
  }
  if (event !== 'terminal-notification') return null;
  const [, message, kind] = args;
  if (kind === 'attention') return { sessionId, kind: 'attention', title: titleOf(sessionId), body: message || 'Needs your input' };
  if (kind === 'idle') return { sessionId, kind: 'finished', title: titleOf(sessionId), body: 'Finished and is waiting for you' };
  return null;
}

/** The session on the phone's screen needs no notification. */
export function onScreen(sessionId: string, { foreground, viewing }: { foreground: boolean; viewing: string | null }): boolean {
  return foreground && viewing === sessionId;
}

/**
 * After a reconnect: of the alerts that stand on the computer, those the phone
 * has not had (`had`: session → when that alert was raised), and the sessions
 * whose notification goes because nothing stands for them any more.
 */
export function catchUp(had: ReadonlyMap<string, number | undefined>, standing: SessionAlert[]): { missed: SessionAlert[]; gone: string[] } {
  const stand = new Set(standing.map((alert) => alert.sessionId));
  return {
    missed: standing.filter((alert) => !had.has(alert.sessionId) || had.get(alert.sessionId) !== alert.at),
    gone: [...had.keys()].filter((sessionId) => !stand.has(sessionId)),
  };
}

/** The words of the notification that holds the connection. */
export function keepAliveText(status: ConnectionStatus, computer: string): string {
  if (status.state === 'online') return `Connected to ${computer}`;
  if (status.state === 'offline') return `Reconnecting to ${computer}…`;
  return `Connecting to ${computer}…`;
}
