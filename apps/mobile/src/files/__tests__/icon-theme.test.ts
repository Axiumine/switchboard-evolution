import { expect, test } from '@jest/globals';
import { parse } from 'react-native-svg';

import { fileIconXml } from '@/components/files/FileIcon';
import { FILE_ICON_SVG, FILE_ICON_THEME } from '@/files/icon-theme.generated';
import { fileIconFile, fileIconName } from '@/shared/vendor/file-icons';

const iconOf = (name: string, dir = false, open = false) => fileIconName(FILE_ICON_THEME, name, { dir, open });

test('files get the icon of their name, then of their extension', () => {
  expect(iconOf('package.json')).toBe('nodejs');
  expect(iconOf('App.tsx')).toBe('react_ts');
  expect(iconOf('index.js')).toBe('javascript');
  expect(iconOf('README.md')).toBe('readme');
  expect(iconOf('notes.md')).toBe('markdown');
  expect(iconOf('photo.JPG')).toBe('image');
  expect(iconOf('archive.tar.gz')).toBe('zip');
  expect(iconOf('Dockerfile')).toBe('docker');
  expect(iconOf('yarn.lock')).toBe('yarn');
});

test('a name the subset has no icon for gets the plain file icon', () => {
  expect(iconOf('mystery.zzzz')).toBe('file');
  expect(iconOf('notes')).toBe('file');
  // an icon of the full theme left out of the subset
  expect(iconOf('.travis.yml')).toBe('yaml');
});

test('folders get the icon of their name, open or closed', () => {
  expect(iconOf('src', true)).toBe('folder-src');
  expect(iconOf('src', true, true)).toBe('folder-src-open');
  expect(iconOf('node_modules', true)).toBe('folder-node');
  expect(iconOf('.github', true)).toBe('folder-github');
  expect(iconOf('.claude', true, true)).toBe('folder-claude-open');
  expect(iconOf('Tests', true)).toBe('folder-test');
  expect(iconOf('whatever', true)).toBe('folder');
  expect(iconOf('whatever', true, true)).toBe('folder-open');
});

test('the common folders are all in the subset, open and closed', () => {
  const names = ['src', 'test', 'tests', 'docs', 'public', 'scripts', 'node_modules', '.github', '.vscode', 'assets', 'images', 'components', 'lib',
    'dist', 'build', 'config', 'app', 'bin', 'android', 'ios', 'hooks', 'utils', 'api', 'server', 'styles', 'types', 'templates', 'packages', 'tools', '.claude'];
  for (const name of names) {
    expect(iconOf(name, true)).not.toBe('folder');
    expect(iconOf(name, true, true)).toBe(`${iconOf(name, true)}-open`);
  }
});

test('every icon the theme names has its SVG', () => {
  const icons = new Set([
    FILE_ICON_THEME.file, FILE_ICON_THEME.folder, FILE_ICON_THEME.folderOpen,
    ...Object.values(FILE_ICON_THEME.fileNames), ...Object.values(FILE_ICON_THEME.fileExtensions),
    ...Object.values(FILE_ICON_THEME.folderNames).flatMap((icon) => [icon, `${icon}-open`]),
  ]);
  for (const icon of icons) expect(FILE_ICON_SVG[fileIconFile(FILE_ICON_THEME, icon)]).toContain('<svg');
});

test('the subset stays small', () => {
  const size = Object.values(FILE_ICON_SVG).reduce((sum, svg) => sum + svg.length, 0);
  expect(size).toBeLessThan(300 * 1024);
});

test('react-native-svg reads every icon, and knows each element in it', () => {
  // An element it has no component for becomes a function named missingTag, which draws nothing.
  const unknown = (node: any, found: string[]) => {
    if (!node || typeof node === 'string') return;
    if (Array.isArray(node)) { node.forEach((child) => unknown(child, found)); return; }
    if (typeof node.type === 'function' && node.type.name === 'missingTag') found.push(String(node.props?.id ?? 'element'));
    unknown(node.props?.children ?? node.children, found);
  };
  for (const [file, xml] of Object.entries(FILE_ICON_SVG)) {
    const ast: any = parse(xml);
    expect(ast).not.toBeNull();
    expect(ast.props.viewBox).toBeTruthy();
    const found: string[] = [];
    unknown(ast.children, found);
    expect([file, found]).toEqual([file, []]);
  }
});

test('the icon of a name is its SVG', () => {
  expect(fileIconXml('index.ts')).toBe(FILE_ICON_SVG.typescript);
  expect(fileIconXml('src', true, true)).toBe(FILE_ICON_SVG['folder-src-open']);
});
