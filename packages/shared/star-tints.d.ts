// Types for star-tints.js, next to this file.

export const STAR_TINTS: readonly string[];
export function pickStarTint(usedTints: readonly (number | null | undefined)[], random?: () => number): number;
export function starTintColor(tint: number | null | undefined, sessionId: string): string;
