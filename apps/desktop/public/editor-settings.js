// editor-settings.js — the Editor section of the app's Settings (settings-panel.js
// calls renderEditorSettings): the editor's preferences, the same ones the
// status bar and the editor's right-click menu switch (editor/prefs.mjs, on
// window.cmEditorPrefs). Each one applies at once, to every open editor, and
// is saved in the app's settings as it changes.

// The preferences in the section's order, with their help: the shared
// catalog's (settings-model.js), so the phone shows the same texts.
const EDITOR_SETTINGS = (typeof module !== 'undefined' && module.exports ? require('./settings-model') : window.SettingsModel)
  .EDITOR_PREFS.map(({ name, help }) => ({ name, help }));

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
