// Copied from packages/shared/file-icons.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// file-icons.js — which icon of the file icon theme (Material Icon Theme, the
// one VS Code users know) a file or folder gets, by its name: an exact file
// name first (package.json, Dockerfile), then its extensions from the longest
// (test.ts before ts), then the plain file icon. A folder by its name
// (src, docs, node_modules), open or closed.
//
// The theme's data is public/file-icon-theme.js, generated from the
// material-icon-theme package by scripts/build-file-icons.mjs; the icons are
// that package's SVG files. Shared with the phone app, which brings its own
// subset of the icons (scripts/sync-shared.mjs there): no DOM, no Node.
(function (root) {
  /**
   * The theme lists a folder name with its usual spellings (.rust, _rust,
   * -rust, __rust__); the data keeps one, and a name is looked up the same way.
   */
  function folderBaseName(name) {
    return String(name || '').toLowerCase().replace(/^(?:__|\.|_|-)/, '').replace(/__$/, '');
  }

  /** The icon's name in `theme` for a file, or a folder with { dir: true, open }. */
  function fileIconName(theme, name, { dir = false, open = false } = {}) {
    if (!theme) return dir ? (open ? 'folder-open' : 'folder') : 'file';
    const lower = String(name || '').toLowerCase();
    if (dir) {
      const icon = theme.folderNames[folderBaseName(lower)];
      if (icon) return open ? `${icon}-open` : icon;
      return open ? theme.folderOpen : theme.folder;
    }
    const byName = theme.fileNames[lower];
    if (byName) return byName;
    for (let dot = lower.indexOf('.'); dot >= 0; dot = lower.indexOf('.', dot + 1)) {
      const icon = theme.fileExtensions[lower.slice(dot + 1)];
      if (icon) return icon;
    }
    return theme.file;
  }

  // The window's helper: an <img> of the icon, from the package's folder.
  const ICON_BASE = '../node_modules/material-icon-theme/icons/';

  /** The SVG file (without .svg) of an icon: most have their own, some reuse another's. */
  function fileIconFile(theme, icon) {
    return (theme && theme.files && theme.files[icon]) || icon;
  }

  function fileIconHtml(name, opts = {}) {
    const theme = root.FILE_ICON_THEME;
    const icon = fileIconFile(theme, fileIconName(theme, name, opts));
    const cls = opts.className ? ` ${opts.className}` : '';
    return `<img class="file-type-icon${cls}" src="${ICON_BASE}${icon}.svg" alt="" aria-hidden="true" draggable="false">`;
  }

  const api = { folderBaseName, fileIconName, fileIconFile, fileIconHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
