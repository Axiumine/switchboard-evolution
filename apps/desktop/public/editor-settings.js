// editor-settings.js — the Editor section of the app's Settings (settings-panel.js
// calls renderEditorSettings): the editor's preferences, the same ones the
// status bar and the editor's right-click menu switch (editor/prefs.mjs, on
// window.cmEditorPrefs). Each one applies at once, to every open editor, and
// is remembered on this computer; the panel's Save button is not needed.

const EDITOR_SETTINGS = [
  { name: 'minimap', help: 'A small view of the whole file at the right of each editor, with the matches of a search and the changes of a diff. Not in narrow editors.' },
  { name: 'stickyScroll', help: 'The first lines of the blocks you are scrolling through stay at the top of the editor; a click goes to one.' },
  { name: 'whitespace', help: 'Draw spaces and tabs, and mark the ones at the end of a line.' },
  { name: 'vim', help: 'Edit with Vim\'s keys and modes. The app\'s keys (find, save, go to line, go to symbol) stay the app\'s.' },
  { name: 'languageServers', help: 'Hover, errors, go to definition, rename and suggestions from the language servers installed on this computer, started for the languages found in a project\'s folders (each project\'s Settings) when a file of theirs opens. Off: none starts, in any project, and the running ones stop.' },
];

/** The section's HTML for the preferences the editor has: [{ name, label, on }]. */
function editorSettingsHtml(prefs) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fields = EDITOR_SETTINGS.map((setting) => {
    const pref = prefs.find(p => p.name === setting.name);
    if (!pref) return '';
    return `<div class="settings-field">
          <div class="settings-field-info">
            <span class="settings-label">${esc(pref.label)}</span>
            <div class="settings-description">${esc(setting.help)}</div>
          </div>
          <div class="settings-field-control">
            <label class="settings-toggle"><input type="checkbox" class="sv-editor-pref" data-pref="${esc(setting.name)}" ${pref.on ? 'checked' : ''}><span class="settings-toggle-slider"></span></label>
          </div>
        </div>`;
  }).join('');
  return fields ? `<div class="settings-section-title">Editor</div>${fields}` : '';
}

/** Fill `section` and keep it in step with changes made elsewhere (the status bar, another window). */
function renderEditorSettings(section) {
  const api = window.cmEditorPrefs;
  if (!section || !api) return;
  const draw = () => {
    section.innerHTML = editorSettingsHtml(api.names().map(name => ({ name, label: api.label(name), on: api.get(name) })));
    section.hidden = !section.innerHTML;
    section.querySelectorAll('.sv-editor-pref').forEach((input) => {
      input.addEventListener('change', () => api.set(input.dataset.pref, input.checked));
    });
  };
  draw();
  if (section._editorPrefsOff) section._editorPrefsOff();
  section._editorPrefsOff = api.onChange(() => {
    if (!section.isConnected) { section._editorPrefsOff(); return; }
    section.querySelectorAll('.sv-editor-pref').forEach((input) => { input.checked = api.get(input.dataset.pref); });
  });
}

if (typeof module !== 'undefined') module.exports = { EDITOR_SETTINGS, editorSettingsHtml };
