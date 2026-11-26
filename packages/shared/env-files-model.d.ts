// Types for env-files-model.js, next to this file.

export const ENV_FILE_NAME: string;
export const ENV_FILE_TEMPLATE: string;
export const ENV_RULES: readonly string[];
export function loadOrderText(kind: 'project' | 'folder' | 'worktree' | string): string;
