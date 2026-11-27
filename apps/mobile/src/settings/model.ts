import {
  ACCENT_DEFAULT,
  EDITOR_PREFS,
  FIELDS,
  changedPatch,
  validateGlobalPatch,
  type FieldKind,
  type SettingField,
} from '@/shared/vendor/settings-model';
import type { GlobalSettingsInfo, HarnessOption, TerminalEngineStatus } from './types';

// The computer's Application, Agents and Editor settings on the phone: which
// fields each tab shows (the shared catalog, in the desktop panel's order), and
// how an edited control becomes the patch the computer saves. The computer
// checks the patch again; checking it here too lets a refused value say why
// without a round trip.

export type CatalogTabKey = 'application' | 'agents' | 'editor';

/**
 * One control of a tab: a field of the catalog, or one of the Editor's
 * preferences, whose key is then 'editorPrefs.<name>' (as changedPatch takes it).
 */
export type SettingsField = Omit<SettingField, 'kind'> & { kind: Exclude<FieldKind, 'editorPrefs'> };

/** What a control gives: a switch's state, a field's text, a choice's key, a colour, or the switched-off CLIs. */
export type FieldInput = string | boolean | readonly string[];

export type FieldResult = { ok: true; patch: Record<string, unknown> | null } | { ok: false; error: string };

/** A choice as a control lists it: `key` is its value as text (null is ''). */
export interface ChoiceItem { key: string; label: string; value: string | null }

/** The desktop's words beside the last CLI still on, which cannot be switched off. */
export const KEPT_ON = 'Kept on — at least one CLI must stay enabled';

const PREF_PREFIX = 'editorPrefs.';

/**
 * Application's Project Templates row (the computer's templates folder, read
 * only) is not a setting: it comes right after this field, as on the desktop.
 */
export const TEMPLATES_AFTER = 'projectsRoot';

/** The sections of a tab, in order, with their controls. */
export function fieldsFor(tab: CatalogTabKey): { section: string; fields: SettingsField[] }[] {
  const sections: { section: string; fields: SettingsField[] }[] = [];
  for (const field of FIELDS) {
    if (field.tab !== tab) continue;
    let group = sections.find((s) => s.section === field.section);
    if (!group) sections.push((group = { section: field.section, fields: [] }));
    group.fields.push(...controlsOf(field));
  }
  return sections;
}

// The Editor's preferences are one setting saved one name at a time: a switch each.
function controlsOf(field: SettingField): SettingsField[] {
  if (field.kind !== 'editorPrefs') return [field as SettingsField];
  return EDITOR_PREFS.filter((p) => p.name !== 'languageServers').map((p) => ({
    ...field,
    key: `${PREF_PREFIX}${p.name}`,
    kind: 'bool' as const,
    label: p.label,
    help: p.help,
    default: p.fallback,
  }));
}

/** The value in force of a control's setting, as the computer gave it. */
export function savedValue(field: SettingsField, info: GlobalSettingsInfo): unknown {
  if (field.key.startsWith(PREF_PREFIX)) return (info.values.editorPrefs as Record<string, boolean>)[field.key.slice(PREF_PREFIX.length)];
  return (info.values as unknown as Record<string, unknown>)[field.key];
}

/** A choice's key for a value (null is ''). */
export const choiceKey = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** The choices of a field: the catalog's, the shells of the computer for Shell Profile. */
export function choicesFor(field: SettingsField, info: GlobalSettingsInfo): ChoiceItem[] {
  const choices = [...(field.choices || [])];
  if (field.key === 'shellProfile') choices.push(...info.options.shellProfiles.map((p) => ({ value: p.id, label: p.name })));
  // The desktop's select names "no mode" this way.
  return choices.map((c) => ({ key: choiceKey(c.value), label: c.value === null ? 'Default (none)' : c.label, value: c.value }));
}

/**
 * The patch an edited control saves: `patch: null` when the value (trimmed)
 * is the one in force, so nothing is written; `ok: false` with the reason when
 * the value cannot be saved.
 */
export function parseFieldInput(field: SettingsField, raw: FieldInput, info: GlobalSettingsInfo): FieldResult {
  let value: unknown = raw;
  let saved = savedValue(field, info);
  switch (field.kind) {
    case 'int': {
      // Empty or not a whole number is refused, with the range.
      const text = typeof raw === 'string' ? raw.trim() : '';
      value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
      break;
    }
    case 'choice': {
      const choice = choicesFor(field, info).find((c) => c.key === raw);
      value = choice ? choice.value : raw;
      break;
    }
    case 'color':
      // The default accent is saved as none, as the desktop does.
      value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
      if (value === ACCENT_DEFAULT) value = null;
      if (saved === ACCENT_DEFAULT) saved = null;
      break;
    case 'harnesses':
      value = Array.isArray(raw) ? [...raw] : raw;
      break;
  }
  const patch = changedPatch(field.key, value, saved);
  if (!patch) return { ok: true, patch: null };
  const checked = validateGlobalPatch(patch, {
    harnessIds: info.options.harnesses.map((h) => h.id),
    shellProfileIds: info.options.shellProfiles.map((p) => p.id),
  });
  return checked.ok ? { ok: true, patch: checked.patch } : { ok: false, error: checked.error };
}

/** The CLIs switched off once `id` is switched on or off, the others as `off` has them. */
export function harnessesOff(harnesses: readonly HarnessOption[], off: readonly string[], id: string, on: boolean): string[] {
  return harnesses.filter((h) => (h.id === id ? !on : off.includes(h.id))).map((h) => h.id);
}

/** The one CLI still on, which stays on; null while two or more are. */
export function lastHarnessOn(harnesses: readonly HarnessOption[], off: readonly string[]): string | null {
  const on = harnesses.filter((h) => !off.includes(h.id));
  return on.length === 1 ? on[0].id : null;
}

/** The desktop's line under Terminal Engine: which engine runs the sessions now. */
export function terminalEngineNow(status: TerminalEngineStatus | null | undefined): string {
  return status?.engine === 'hc'
    ? `Now: herdr-core ${status.version} (${status.source === 'bundled' ? 'the copy inside the app' : status.path}), session "${status.session}".`
    : `Now: inside Switchboard. ${status?.reason || ''}`.trimEnd();
}

/**
 * Save an edited control: nothing is sent when the value is refused or is the
 * one in force. `error` is why it was not saved (here or by the computer); the
 * control then shows the saved value again.
 */
export async function commitField(
  field: SettingsField,
  raw: FieldInput,
  info: GlobalSettingsInfo | undefined,
  save: (patch: Record<string, unknown>) => Promise<void>,
): Promise<{ saved: boolean; error: string | null }> {
  if (!info) return { saved: false, error: 'The computer\'s settings are not loaded yet.' };
  const res = parseFieldInput(field, raw, info);
  if (!res.ok) return { saved: false, error: res.error };
  if (!res.patch) return { saved: false, error: null };
  try {
    await save(res.patch);
    return { saved: true, error: null };
  } catch (err) {
    return { saved: false, error: (err instanceof Error && err.message) || 'Not saved' };
  }
}
