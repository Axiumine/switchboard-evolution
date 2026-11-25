const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const stored = new Map();
globalThis.window = globalThis.window || new EventTarget();
globalThis.localStorage = { getItem: k => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)) };

const editorModule = name => import(pathToFileURL(path.join(__dirname, `../public/editor/${name}.mjs`)).href);

test('Vim is off by default and has nothing until its add-on is loaded', async () => {
  const { readPref } = await editorModule('prefs');
  const { vimExtension } = await editorModule('vim-hook');
  assert.equal(readPref('vim'), false);
  assert.deepEqual(vimExtension(false), []);
});

test('with Vim on, the app\'s keys come before Vim\'s, and Vim before every other extension', async () => {
  await editorModule('addons/vim'); // what the page loads: window.__sbEditorAddons.vim
  const { vimExtension, appKeysFirst } = await editorModule('vim-hook');
  const ext = vimExtension(true, () => {});
  assert.equal(ext[0], appKeysFirst, 'the app\'s keys first');
  assert.equal(ext.length, 3);
  const core = fs.readFileSync(path.join(__dirname, '../public/editor/core.mjs'), 'utf8');
  const list = core.slice(core.indexOf('const extensions = ['));
  assert.ok(list.indexOf('firstPrefExtensions(context)') < list.indexOf('lineNumbers()'), 'Vim\'s compartment heads the list');
  // The keys the app keeps are the scope the plugin runs.
  const find = fs.readFileSync(path.join(__dirname, '../public/editor/find.mjs'), 'utf8');
  for (const key of ["key: 'Mod-f'", "key: 'Ctrl-g'", "key: 'Mod-s'", "mac: 'Mod-g'"]) assert.ok(find.includes(key), key);
  const symbols = fs.readFileSync(path.join(__dirname, '../public/editor/symbols.mjs'), 'utf8');
  assert.match(symbols, /Mod-Shift-o.*scope: 'editor sb-editor-keys'/);
});

test('the mode as the status bar shows it', async () => {
  const { modeName } = await editorModule('vim-hook');
  assert.equal(modeName({ mode: 'insert' }), 'INSERT');
  assert.equal(modeName({ mode: 'visual', subMode: 'linewise' }), 'VISUAL LINE');
  assert.equal(modeName(null), 'NORMAL');
});
