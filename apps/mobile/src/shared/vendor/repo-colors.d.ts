// Copied from packages/shared/repo-colors.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for repo-colors.js, next to this file.

export const REPO_COLORS: readonly string[];
export function repoColorMap(paths: readonly string[]): Record<string, string>;
export function repoColor(paths: readonly string[], path: string): string;
