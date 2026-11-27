// settings-patch.js — the one way a setting is saved. The settings panel and a
// paired phone both send a patch (one field, or one Editor preference); this
// checks it with the shared model, writes it, runs what a few settings need
// and tells every window and phone what changed.

const path = require('path');
const SettingsModel = require('./public/settings-model');

/**
 * At least one CLI has to stay on, or the app has nothing to show and no way
 * to start anything. `disabled` is the set a write asks for, `before` the
 * one that was saved, `launchable` the ids that can start a session. When
 * every launchable CLI would be off, the one just switched off (not in
 * `before`) stays on, else the first launchable. Returns the ids to save.
 */
function keepOneHarnessOn(disabled, before, launchable) {
  const off = new Set(disabled);
  if (!launchable.length || !launchable.every(id => off.has(id))) return disabled;
  const keep = launchable.find(id => off.has(id) && !before.has(id)) || launchable[0];
  return disabled.filter(id => id !== keep);
}

const FOLDER_PREFIX = 'project:';
const isFolderKey = key => typeof key === 'string' && key.startsWith(FOLDER_PREFIX) && path.isAbsolute(key.slice(FOLDER_PREFIX.length));
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `harnessIds`, `launchableHarnessIds` and `shellProfileIds` are functions
 * (the computer's CLIs and shells are read when a patch arrives).
 * `onHarnessesChanged` runs when the set of switched-off CLIs changed,
 * `onLanguageServers(on)` when a patch carries `languageServers`. A side
 * effect that fails is logged (`log.error`): the value is saved by then, so it
 * is still announced and reported as saved.
 */
function createSettingsPatcher({ getSetting, setSetting, harnessIds, launchableHarnessIds, shellProfileIds, onHarnessesChanged, onLanguageServers, emit, log = console }) {
  const stored = key => {
    const value = getSetting(key);
    return isObject(value) ? value : {};
  };

  async function sideEffect(name, run) {
    try { await run(); } catch (err) { log.error(`[settings] ${name}`, err); }
  }

  async function patchGlobal(rawPatch) {
    const checked = SettingsModel.validateGlobalPatch(rawPatch, { harnessIds: harnessIds(), shellProfileIds: shellProfileIds() });
    if (!checked.ok) return checked;
    const patch = { ...checked.patch };
    const current = stored('global');
    const before = new Set(current.disabledHarnesses || []);
    if (patch.disabledHarnesses) patch.disabledHarnesses = keepOneHarnessOn(patch.disabledHarnesses, before, launchableHarnessIds());
    if (patch.editorPrefs) patch.editorPrefs = { ...(isObject(current.editorPrefs) ? current.editorPrefs : {}), ...patch.editorPrefs };

    const written = { ...current, ...patch };
    setSetting('global', written);

    const after = new Set(written.disabledHarnesses || []);
    if (before.size !== after.size || [...before].some(id => !after.has(id))) await sideEffect('CLIs', onHarnessesChanged);
    if ('languageServers' in patch) await sideEffect('language servers', () => onLanguageServers(patch.languageServers));
    // Read again: another patch may have been saved while an effect ran.
    const settings = stored('global');
    emit('global-settings-changed', { settings, changed: Object.keys(checked.patch) });
    return { ok: true, settings };
  }

  function patchFolder(key, rawPatch) {
    const checked = SettingsModel.validateFolderPatch(rawPatch);
    if (!checked.ok) return checked;
    const settings = { ...stored(key) };
    for (const [name, value] of Object.entries(checked.patch)) {
      if (value === null) delete settings[name];
      else settings[name] = value;
    }
    setSetting(key, settings);
    return { ok: true, settings };
  }

  /** `key` is 'global' or 'project:<absolute folder>'. */
  async function patch(key, rawPatch) {
    if (key === 'global') return patchGlobal(rawPatch);
    if (isFolderKey(key)) return patchFolder(key, rawPatch);
    return { ok: false, error: 'Unsupported settings key' };
  }

  return { patch };
}

module.exports = { createSettingsPatcher, keepOneHarnessOn };
