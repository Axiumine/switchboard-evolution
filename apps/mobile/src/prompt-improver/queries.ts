import { useQuery } from '@tanstack/react-query';

import { act } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import type { ImproverMode, PromptImproverSettings } from '@/shared/vendor/prompt-improver-model';
import { request, useCapability, useConnection } from '@/store/connection';
import { improveTimeoutMs, type ImproveResult, type PromptImproverInfo } from './model';

// The prompt improver on the computer (prompt-improver.js, through
// remote-prompt-improver.js): improve a session's prompt, stop it, and its
// settings, which the phone shows and changes.

const KEY = ['prompt-improver-settings'];

/** Whether the computer has the improver (a desktop older than it does not). */
export function usePromptImproverSupported(): boolean {
  return useCapability('improve-prompt');
}

/** The improver's settings, its default prompt and the CLIs the computer has. */
export function usePromptImproverInfo() {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCapability('get-prompt-improver-settings');
  return useQuery({
    queryKey: KEY,
    queryFn: () => act<PromptImproverInfo>('get-prompt-improver-settings', []),
    enabled: online && supported,
    staleTime: 60_000,
  });
}

/** Improve `text` for a session; `{ ok: false, cancelled }` when it was stopped. */
export async function improvePrompt(sessionId: string, text: string, options: { mode?: ImproverMode; runtime?: string | null }, settings?: PromptImproverSettings | null): Promise<ImproveResult> {
  const opts: { mode?: ImproverMode; runtime?: string } = {};
  if (options.mode) opts.mode = options.mode;
  if (options.runtime) opts.runtime = options.runtime;
  const result = await request<ImproveResult>('improve-prompt', [sessionId, text, opts], { timeoutMs: improveTimeoutMs(settings) });
  return result && typeof result === 'object' ? result : { ok: false, error: 'No answer from the computer.' };
}

/** Stop a run for a session; nothing when there is none. */
export function cancelImprovePrompt(sessionId: string): void {
  request('cancel-prompt-improvement', [sessionId]).catch(() => {});
}

/** Change some settings (the rest stay); `template: null` is the default prompt again. */
export async function savePromptImproverSettings(changes: Partial<PromptImproverSettings>): Promise<PromptImproverSettings> {
  const res = await act<{ ok: true; settings: PromptImproverSettings }>('set-prompt-improver-settings', [changes]);
  setPromptImproverSettings(res.settings);
  return res.settings;
}

/** The settings as the computer says they are now (its prompt-improver-settings-changed event). */
export function setPromptImproverSettings(settings: PromptImproverSettings): void {
  queryClient.setQueryData<PromptImproverInfo>(KEY, (old) => (old ? { ...old, settings } : old));
}
