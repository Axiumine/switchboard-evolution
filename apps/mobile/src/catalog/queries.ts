import { useQuery } from '@tanstack/react-query';

import { act } from '@/projects/queries';
import { terminalSend } from '@/sessions/attachments';
import type { CommandCatalog } from '@/shared/vendor/command-catalog-model';
import { useCapability, useConnection } from '@/store/connection';

// The command catalog of a session, from the computer (command-catalog.js,
// through remote-api.js): what its CLI understands, for the "/" button of the
// chat and terminal composers. The phone asks by the session's id only; the
// computer knows its CLI and folder.

/** Whether the computer has the catalog at all (a desktop older than it does not). */
export function useCommandCatalogSupported(): boolean {
  return useCapability('get-command-catalog');
}

/** The CLIs the computer has a catalog for; empty while unknown or unsupported. */
export function useCommandCatalogClis(): string[] {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCommandCatalogSupported();
  const query = useQuery({
    queryKey: ['command-catalog-clis'],
    queryFn: () => act<string[]>('get-command-catalog-clis', []),
    enabled: online && supported,
  });
  return supported && Array.isArray(query.data) ? query.data : [];
}

/** Does a session have a catalog: its CLI has one, or a plain terminal while any CLI has. */
export function hasCommandCatalog(clis: readonly string[], session: { type?: string | null; runtime?: string | null } | null | undefined): boolean {
  if (!session || !clis.length) return false;
  if (session.type === 'terminal') return true;
  return clis.includes(session.runtime || 'claude');
}

/**
 * The catalog of a session (for a plain terminal, of `cli`). It is asked
 * again when the sheet opens after half a minute: the user's own skills and
 * commands can change.
 */
export function useCommandCatalog(sessionId: string, { enabled, cli, runtime }: { enabled: boolean; cli?: string | null; runtime?: string | null }) {
  const online = useConnection((s) => s.status.state === 'online');
  // The phone's idea of the session's CLI, for a session the computer has no row of yet.
  const hint = runtime ? { runtime } : {};
  return useQuery({
    queryKey: ['command-catalog', sessionId, cli || null],
    queryFn: () => act<CommandCatalog | null>('get-command-catalog', [sessionId, cli ? { cli, ...hint } : hint]),
    enabled: online && enabled && !!sessionId,
    staleTime: 30_000,
  });
}

/**
 * Run a picked command: its text, then Enter a moment later, as Send does
 * (terminalSend): written together, a TUI reads both as one paste.
 */
export async function runCommand(write: (data: string) => unknown, text: string, wait: (ms: number) => Promise<void> = sleep): Promise<void> {
  const { writes, enterAfterMs } = terminalSend(text.trimEnd(), []);
  for (const data of writes) await write(data);
  await wait(enterAfterMs);
  await write('\r');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
