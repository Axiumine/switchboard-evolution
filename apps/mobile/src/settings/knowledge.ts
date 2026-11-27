import { useQuery } from '@tanstack/react-query';

import { act } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import { KNOWLEDGE_CONFIG_FIELDS, KNOWLEDGE_SOURCE_LABELS } from '@/shared/vendor/settings-model';
import { useCapability, useConnection } from '@/store/connection';

// Node Knowledge's settings on the computer (main.js, through
// remote-settings.js): which codebase-memory-mcp it runs, read only, and CBM's
// own settings, each saved as it changes. The computer has no event for a
// change of the config, so it is read when the tab opens and after each save.

/** The program the computer found (knowledge.js, binaryStatus). */
export interface KnowledgeBinary {
  found: { version: string; source: string; path: string; ok: boolean } | null;
  minimum: string;
  latest: string | null;
  updateAvailable: boolean;
  pinned: string;
  installDir: string;
  canDownload: boolean;
}

/** How a config key is edited, as the computer lists it (knowledge.js, CONFIG_KEYS). */
export type KnowledgeKeyKind = 'bool' | 'limit' | 'count' | 'port' | 'number' | readonly string[];

export interface KnowledgeConfig {
  values: Record<string, string>;
  keys: Record<string, KnowledgeKeyKind>;
}

const BINARY_KEY = ['knowledge-binary'];
const CONFIG_KEY = ['knowledge-config'];

/** The program's status; read again each time the tab opens (the latest version may arrive late). */
export function useKnowledgeBinary() {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCapability('get-knowledge-binary');
  return useQuery({
    queryKey: BINARY_KEY,
    queryFn: async () => (await act<{ binary: KnowledgeBinary }>('get-knowledge-binary', [])).binary,
    enabled: online && supported,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** CBM's settings; only while the program is there and new enough (otherwise the computer refuses them). */
export function useKnowledgeConfig(enabled = true) {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCapability('get-knowledge-config');
  return useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => act<KnowledgeConfig>('get-knowledge-config', []),
    enabled: online && supported && enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Save one setting; throws the computer's reason when it refuses the value, otherwise reads the settings again. */
export async function saveKnowledgeConfig(key: string, value: string): Promise<void> {
  const r = await act<{ values?: Record<string, string>; error?: string }>('set-knowledge-config', [key, value]);
  if (!r || r.error) throw new Error(r?.error || 'Not saved');
  await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
}

/** A switch for a boolean, chips for a list of values, a text field for the rest (limits, counts). */
export function knowledgeControl(kind: KnowledgeKeyKind | undefined): 'switch' | 'chips' | 'field' {
  if (kind === 'bool') return 'switch';
  if (Array.isArray(kind)) return 'chips';
  return 'field';
}

/** The catalog's fields the computer lists, in the catalog's order (the Lens is not in the catalog). */
export function knowledgeFields(keys: Record<string, KnowledgeKeyKind>) {
  return KNOWLEDGE_CONFIG_FIELDS.filter((f) => f.key in keys);
}

/**
 * The status as the desktop words it, in its order: version and where it
 * comes from, `problem` when it is too old, `newer` when a newer one is out,
 * and the path below. Without a program, the sentence about downloading it.
 */
export function binaryText(bin: KnowledgeBinary): { summary: string; problem: string | null; newer: string | null; path: string | null } {
  const found = bin.found;
  if (!found) {
    return { summary: `Not found. The Node Knowledge tab can download ${bin.pinned || ''} into ${bin.installDir || ''}.`, problem: null, newer: null, path: null };
  }
  const source = KNOWLEDGE_SOURCE_LABELS[found.source] || '';
  return {
    summary: `${found.version}, ${source}`,
    problem: found.ok ? null : `too old: ${bin.minimum} or later`,
    newer: bin.updateAvailable ? `${bin.latest} is out` : null,
    path: found.path,
  };
}

/**
 * What ending the edit of a count or limit field does: nothing when it is
 * unchanged (a limit that is not listed is off), the computer's refusal text
 * (knowledge.js, cleanConfigValue) for an empty value, which is never sent, and
 * otherwise the save. `error` is why it was not saved; the field then shows
 * the saved value again.
 */
export async function commitKnowledgeField(
  key: string,
  kind: KnowledgeKeyKind | undefined,
  raw: string,
  saved: string | undefined,
  save: (key: string, value: string) => Promise<void>,
): Promise<{ saved: boolean; error: string | null }> {
  const limit = kind === 'limit';
  const value = raw.trim();
  const before = (saved ?? '').trim();
  if (value === before || (limit && (value || 'off') === (before || 'off'))) return { saved: false, error: null };
  if (!value) return { saved: false, error: `${key} takes a whole number${limit ? ' or off' : ''}` };
  try {
    await save(key, value);
    return { saved: true, error: null };
  } catch (err) {
    return { saved: false, error: (err instanceof Error && err.message) || 'Not saved' };
  }
}
