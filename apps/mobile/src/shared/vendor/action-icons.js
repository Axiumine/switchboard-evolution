// Copied from packages/shared/action-icons.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// action-icons.js — the icons of the actions that open something, the same
// everywhere in both apps, so each one says where the thing will open:
//
//   folderSearch  open a folder inside the app (the Files tab, the file browser)
//   folderOpen    open in the system's file manager (Finder, Explorer): reveal, open folder
//   fileOutput    open a file with its default application (or another one: Open With…)
//   newWindow     open in a window of its own
//
// The drawings are Lucide's (folder-search, folder-open, file-output,
// square-arrow-out-up-right), 24×24, stroked. Each icon is a list of
// [element, attributes]: the desktop turns it into an SVG string
// (actionIconSvg), the phone draws it with react-native-svg.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const ACTION_ICONS = {
    folderSearch: [
      ['path', { d: 'M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1' }],
      ['path', { d: 'm21 21-1.9-1.9' }],
      ['circle', { cx: '17', cy: '17', r: '3' }],
    ],
    folderOpen: [
      ['path', { d: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2' }],
    ],
    fileOutput: [
      ['path', { d: 'M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14.172 2H6a2 2 0 0 0-2 2v3.127' }],
      ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
      ['path', { d: 'm5 11-3 3' }],
      ['path', { d: 'm5 17-3-3h10' }],
    ],
    newWindow: [
      ['path', { d: 'M14 3h7v7' }],
      ['path', { d: 'M21 3l-9 9' }],
      ['path', { d: 'M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5' }],
    ],
  };

  const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  /** The icon as an SVG string, in the current color. */
  function actionIconSvg(name, size = 14) {
    const nodes = ACTION_ICONS[name];
    if (!nodes) return '';
    const inner = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`).join('');
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-action-icon="${name}">${inner}</svg>`;
  }

  const api = { ACTION_ICONS, actionIconSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ActionIcons = api;
})(typeof window !== 'undefined' ? window : globalThis);
