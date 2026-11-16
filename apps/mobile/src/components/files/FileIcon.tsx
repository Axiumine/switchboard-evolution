import { memo } from 'react';
import { SvgXml } from 'react-native-svg';

import { FILE_ICON_SVG, FILE_ICON_THEME } from '@/files/icon-theme.generated';
import { fileIconFile, fileIconName } from '@/shared/vendor/file-icons';

/** The markup of the icon a file or folder name gets in the theme; the plain file or folder icon when the subset lacks it. */
export function fileIconXml(name: string, dir = false, open = false): string {
  const icon = fileIconFile(FILE_ICON_THEME, fileIconName(FILE_ICON_THEME, name, { dir, open }));
  return FILE_ICON_SVG[icon] ?? FILE_ICON_SVG[dir ? (open ? FILE_ICON_THEME.folderOpen : FILE_ICON_THEME.folder) : FILE_ICON_THEME.file];
}

/**
 * The file-type icon of a file name (package.json, App.tsx) or, with `dir`, of
 * a folder (src, node_modules), open or closed: Material Icon Theme, as in
 * the desktop's Files tab.
 */
export const FileIcon = memo(function FileIcon({ name, dir = false, open = false, size = 18 }: { name: string; dir?: boolean; open?: boolean; size?: number }) {
  return <SvgXml xml={fileIconXml(name, dir, open)} width={size} height={size} accessible={false} />;
});
