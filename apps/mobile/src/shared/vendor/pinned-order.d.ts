// Copied from packages/shared/pinned-order.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for pinned-order.js, next to this file.

export function compareByRank<T>(rankOf: (item: T) => number | null | undefined, fallback: (a: T, b: T) => number): (a: T, b: T) => number;
export function moveId(ids: readonly string[], id: string, toIndex: number): string[];
export function dropIndex(ids: readonly string[], fromId: string, targetId: string, after: boolean): number | null;
