// Types for action-icons.js, next to this file.

export type ActionIconName = 'folderSearch' | 'folderOpen' | 'fileOutput' | 'newWindow';
export type ActionIconNode = readonly ['path' | 'circle', Readonly<Record<string, string>>];

export const ACTION_ICONS: Readonly<Record<ActionIconName, readonly ActionIconNode[]>>;
export function actionIconSvg(name: ActionIconName, size?: number): string;
