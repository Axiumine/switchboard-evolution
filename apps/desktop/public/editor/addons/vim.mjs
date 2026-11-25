// Vim mode (@replit/codemirror-vim), loaded the first time the "Vim Mode"
// preference is on (editor/vim-hook.mjs). Its CodeMirror is the editor's own
// (window.__sbEditorModules): see scripts/bundle-editor-addons.mjs.
import { vim, getCM, Vim } from '@replit/codemirror-vim';

// :w saves, as the editor's Cmd/Ctrl+S does (the panel around it hears cm-save).
Vim.defineEx('write', 'w', (cm) => {
  const view = cm.cm6;
  if (view) view.dom.dispatchEvent(new CustomEvent('cm-save', { bubbles: true }));
});

window.__sbEditorAddons = window.__sbEditorAddons || {};
window.__sbEditorAddons.vim = { vim, getCM, Vim };

export { vim, getCM, Vim };
