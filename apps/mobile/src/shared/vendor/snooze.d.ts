// Copied from packages/shared/snooze.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for snooze.js, next to this file. Only what the mobile app uses.

type Snoozable = { status?: string; snoozedUntil?: string | null };

export function projectSnoozed(project: Snoozable, nowMs: number, attention?: boolean): boolean;
export function projectWokeAt(project: Snoozable, nowMs: number): string | null;
export function resolveSnoozePresets(now?: Date): { id: string; label: string; whenLabel: string; snoozedUntil: string }[];
export function snoozeWakeDescription(snoozedUntil: string, now?: Date): string;
