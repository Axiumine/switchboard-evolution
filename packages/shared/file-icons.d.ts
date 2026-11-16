// Types for file-icons.js, next to this file. Only what the mobile app uses
// (fileIconHtml is the desktop window's).

export type FileIconTheme = {
  version: string;
  file: string;
  folder: string;
  folderOpen: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  /** Keys are normalized with folderBaseName. */
  folderNames: Record<string, string>;
  /** Icon id to SVG file name, for the icons whose drawing is another's. */
  files?: Record<string, string>;
};

export function folderBaseName(name: string): string;
/** The icon's name in the theme for a file, or a folder with { dir: true, open }. */
export function fileIconName(theme: FileIconTheme | null | undefined, name: string, options?: { dir?: boolean; open?: boolean }): string;
/** The SVG file (without .svg) of an icon. */
export function fileIconFile(theme: FileIconTheme | null | undefined, icon: string): string;
