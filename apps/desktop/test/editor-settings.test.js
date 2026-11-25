const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { editorSettingsHtml, EDITOR_SETTINGS } = require('../public/editor-settings.js');

test('Settings › Editor shows the preferences the editor has, ticked as they are', () => {
  const html = editorSettingsHtml([
    { name: 'whitespace', label: 'Show Whitespace', on: true },
    { name: 'minimap', label: 'Minimap', on: false },
  ]);
  assert.match(html, /settings-section-title">Editor</);
  assert.match(html, /data-pref="whitespace" checked/);
  assert.match(html, /data-pref="minimap" >/);
  assert.ok(!html.includes('data-pref="vim"'), 'a preference the editor does not have is left out');
  // The order is the section's, not the list's.
  assert.ok(html.indexOf('data-pref="minimap"') < html.indexOf('data-pref="whitespace"'));
});

test('with no preference there is no section', () => {
  assert.equal(editorSettingsHtml([]), '');
});

test('every preference of the section has its help', () => {
  for (const setting of EDITOR_SETTINGS) assert.ok(setting.help.length > 20, setting.name);
});

test('the add-ons take from the main bundle exactly the modules it gives them', async () => {
  const { SHARED_MODULES, strayShared } = await import(pathToFileURL(path.join(__dirname, '../scripts/bundle-editor-addons.mjs')).href);
  const setup = fs.readFileSync(path.join(__dirname, '../public/codemirror-setup.js'), 'utf8');
  const given = setup.slice(setup.indexOf('window.__sbEditorModules = {'), setup.indexOf('};', setup.indexOf('window.__sbEditorModules = {')));
  const keys = [...given.matchAll(/^\s+(?:'([^']+)'|(\w+)):/gm)].map(m => m[1] || m[2]);
  assert.deepEqual([...keys].sort(), [...SHARED_MODULES].sort());
  assert.deepEqual(strayShared({ 'node_modules/@codemirror/state/dist/index.js': {}, 'public/editor/addons/vim.mjs': {} }), ['node_modules/@codemirror/state/dist/index.js']);
  assert.deepEqual(strayShared({ 'node_modules/@replit/codemirror-vim/dist/index.js': {} }), []);
});
