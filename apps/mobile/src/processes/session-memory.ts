// What each live session uses, for the session rows of the Sessions and
// Projects tabs, as the desktop's rows show it (app.js refreshResourceStatus):
// the Task Manager's own measurement (get-process-usage, cached on the
// computer), read again every 15 seconds while a list is on screen.

import { useQuery } from '@tanstack/react-query';

import { useShown } from '@/layout/shown';
import { memoryLevel, sessionMemory } from '@/shared/vendor/usage-chart';
import { request, useCapability, useConnection } from '@/store/connection';
import type { ProcessUsage } from './model';

export const SESSION_MEMORY_MS = 15000;
const NONE: ReadonlyMap<string, number> = new Map();

/** Bytes by session id; empty until measured, or with a desktop that does not measure. */
export function useSessionMemory(): ReadonlyMap<string, number> {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCapability('get-process-usage');
  // On screen: on a Surface Duo a tab can be in sight without the focus.
  const shown = useShown();
  const usage = useQuery({
    // The Task Manager's query: one measurement serves both.
    queryKey: ['process-usage'],
    queryFn: () => request<ProcessUsage>('get-process-usage', [], { timeoutMs: 20000 }),
    enabled: online && supported,
    refetchInterval: shown ? SESSION_MEMORY_MS : false,
    select: (data) => sessionMemory(data),
    // It polls: no SyncBar for it.
    meta: { quiet: true },
  });
  return usage.data ?? NONE;
}

/** A row's memory figure and its colour band ('mid' from 1 GB, 'high' from 2 GB); null when nothing is running. */
export function memoryFigure(bytes: number | undefined): { bytes: number; level: 'low' | 'mid' | 'high' } | null {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return null;
  return { bytes, level: memoryLevel(bytes) };
}
