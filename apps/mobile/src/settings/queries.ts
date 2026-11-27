import { useQuery } from '@tanstack/react-query';

import { act } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import { useCapability, useConnection } from '@/store/connection';
import type { GlobalSettingsInfo, SavedGlobalSettings } from './types';

// The computer's global settings (main.js, through remote-settings.js): read
// with the options their fields need, and saved one setting at a time. After
// each save, and on the computer's global-settings-changed (store/connection),
// they are read again: the values in force are the computer's to say (a CLI it
// kept on, a text it trimmed).

const KEY = ['global-settings'];

/** The values in force and the options of the fields, while the computer offers them. */
export function useGlobalSettings() {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCapability('get-global-settings');
  return useQuery({
    queryKey: KEY,
    queryFn: () => act<GlobalSettingsInfo>('get-global-settings', []),
    enabled: online && supported,
    staleTime: 60_000,
  });
}

/** The settings as last read, for a save that runs after an earlier one. */
export function currentGlobalSettings(): GlobalSettingsInfo | undefined {
  return queryClient.getQueryData<GlobalSettingsInfo>(KEY);
}

/**
 * Save a patch (one setting, or one Editor preference); throws the computer's
 * reason when it refuses it. Gives back the computer's answer, once the
 * settings are read again.
 */
export async function saveGlobalSettings(patch: Record<string, unknown>): Promise<SavedGlobalSettings> {
  const res = await act<SavedGlobalSettings | { ok: false; error?: string }>('set-global-settings', [patch]);
  if (!res || res.ok === false) throw new Error((res as { error?: string } | undefined)?.error || 'Not saved');
  await queryClient.invalidateQueries({ queryKey: KEY });
  return res;
}
