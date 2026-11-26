// Copied from packages/shared/env-files-model.d.ts by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// Types for env-files-model.js, next to this file.

export const ENV_FILE_NAME: string;
export const ENV_FILE_TEMPLATE: string;
export const ENV_RULES: readonly string[];
export function loadOrderText(kind: 'project' | 'folder' | 'worktree' | string): string;
