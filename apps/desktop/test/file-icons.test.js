const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const icons = require('../public/file-icons');

// The generated theme data, loaded the way the window loads it.
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/file-icon-theme.js'), 'utf8'), context);
const theme = context.window.FILE_ICON_THEME;
const iconsDir = path.join(__dirname, '../node_modules/material-icon-theme/icons');

test('files get the icon VS Code gives them: exact name, then the longest extension', () => {
  const icon = (name) => icons.fileIconName(theme, name);
  assert.equal(icon('package.json'), 'nodejs');
  assert.equal(icon('Dockerfile'), 'docker');
  assert.equal(icon('main.ts'), 'typescript');
  assert.equal(icon('App.TSX'), 'react_ts');
  assert.equal(icon('README.md'), 'readme');
  assert.equal(icon('notes.md'), 'markdown');
  assert.equal(icon('.env'), icons.fileIconName(theme, 'x.env'));
  assert.equal(icon('something.unknownext'), 'file');
  assert.notEqual(icon('a.spec.ts'), 'typescript', 'a test file has its own icon');
});

test('folders get their named icon, open or closed, in any of their usual spellings', () => {
  const folder = (name, open = false) => icons.fileIconName(theme, name, { dir: true, open });
  assert.equal(folder('src'), 'folder-src');
  assert.equal(folder('src', true), 'folder-src-open');
  assert.equal(folder('__tests__'), folder('test'));
  assert.equal(folder('.github'), 'folder-github');
  assert.equal(folder('Some Folder'), 'folder');
  assert.equal(folder('Some Folder', true), 'folder-open');
});

test('every icon the theme can give has its SVG file in the package', () => {
  const names = new Set([theme.file, theme.folder, theme.folderOpen, ...Object.values(theme.fileNames), ...Object.values(theme.fileExtensions),
    ...Object.values(theme.folderNames).flatMap(i => [i, `${i}-open`])]);
  for (const name of names) assert.ok(fs.existsSync(path.join(iconsDir, `${icons.fileIconFile(theme, name)}.svg`)), name);
});
