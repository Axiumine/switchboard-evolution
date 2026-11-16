#!/usr/bin/env node
// Write src/files/icon-theme.generated.ts, the file icon theme of the Files,
// Git and search lists, from the material-icon-theme package (a devDependency,
// pinned). The desktop shows the whole theme; the phone bundles the SVG
// markup of a curated subset (the common languages, config and build files,
// documents, images, archives, lock files and the usual folder names), and a
// name whose icon is not in the subset gets the plain file or folder icon.
// Run it again after updating the package or changing the lists below:
//
//   node scripts/build-file-icons.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'material-icon-theme');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(pkgDir, 'dist', 'material-icons.json'), 'utf8'));
const require = createRequire(import.meta.url);
const { folderBaseName, fileIconName, fileIconFile } = require(join(root, 'src', 'shared', 'vendor', 'file-icons.js'));

// The file icons of the subset, by icon id.
const FILE_ICONS = [
  // Languages
  'javascript', 'react', 'typescript', 'react_ts', 'typescript-def', 'json', 'markdown', 'mdx', 'python', 'ruby', 'go', 'rust',
  'java', 'javaclass', 'jar', 'kotlin', 'swift', 'c', 'h', 'cpp', 'hpp', 'csharp', 'php', 'console', 'powershell', 'lua', 'dart',
  'elixir', 'r', 'scala', 'haskell', 'clojure', 'elm', 'julia', 'zig', 'vim', 'tex', 'prolog',
  // Markup, styles, data
  'html', 'css', 'sass', 'less', 'vue', 'svelte', 'astro', 'xml', 'yaml', 'toml', 'database', 'graphql', 'proto', 'prisma', 'http',
  'table', 'jupyter', 'webassembly', 'terraform',
  // Config, build, tooling
  'settings', 'tune', 'gradle', 'docker', 'makefile', 'cmake', 'maven', 'npm', 'nodejs', 'yarn', 'pnpm', 'bun', 'tsconfig', 'jsconfig',
  'eslint', 'prettier', 'editorconfig', 'babel', 'vite', 'webpack', 'rollup', 'next', 'tailwindcss', 'postcss', 'jest', 'expo',
  'metro', 'vercel', 'netlify', 'firebase', 'android', 'heroku', 'nginx', 'renovate', 'dependabot', 'poetry', 'python-misc',
  'gemfile', 'go-mod', 'agent', 'git', 'diff', 'test-ts', 'test-js', 'test-jsx',
  // Documents, logs
  'document', 'readme', 'changelog', 'contributing', 'conduct', 'license', 'log', 'pdf', 'word', 'powerpoint',
  // Images, audio, video, fonts, design files
  'image', 'svg', 'audio', 'video', 'font', 'favicon', 'robots', 'adobe-illustrator', 'adobe-photoshop', 'figma',
  // Archives, binaries, keys, locks
  'zip', 'hex', 'exe', 'dll', 'key', 'certificate', 'lock',
];

// The folder names of the subset (as the theme spells them); each gets its
// closed and open icon.
const FOLDER_NAMES = [
  'src', 'test', 'tests', '__tests__', 'spec', 'docs', 'doc', 'public', 'scripts', 'script', 'node_modules', '.github', '.vscode',
  '.idea', 'assets', 'resources', 'images', 'img', 'icons', 'components', 'lib', 'vendor', 'dist', 'build', 'out', 'config',
  'configs', 'app', 'bin', 'android', 'ios', 'hooks', 'utils', 'util', 'helpers', 'api', 'server', 'client', 'styles', 'css',
  'types', 'templates', 'packages', 'tools', '.claude', '.git', '.husky', '.expo', '.next', 'fonts', 'media', 'models', 'views',
  'controllers', 'services', 'routes', 'store', 'stores', 'context', 'contexts', 'layouts', 'pages', 'screens', 'middleware',
  'plugins', 'mocks', 'fixtures', 'migrations', 'database', 'db', 'examples', 'example', 'demo', 'benchmark', 'coverage', 'tmp',
  'temp', 'cache', 'logs', 'data', 'shared', 'common', 'core', 'web', 'mobile', 'desktop', '.circleci', '.gitlab', 'docker',
  'terraform', 'kubernetes', 'k8s', '.devcontainer', 'locales', 'i18n', 'lang', 'tasks', 'jobs', 'queue', 'constants', 'interfaces',
];

const iconSet = new Set([manifest.file, manifest.folder, manifest.folderExpanded, ...FILE_ICONS]);
const wanted = new Map(); // folder name (normalized) -> icon
for (const name of FOLDER_NAMES) {
  const icon = manifest.folderNames[name] || Object.entries(manifest.folderNames).find(([n]) => folderBaseName(n) === folderBaseName(name))?.[1];
  if (!icon) throw new Error(`The theme has no folder icon for ${name}`);
  wanted.set(folderBaseName(name), icon);
  iconSet.add(icon);
  iconSet.add(`${icon}-open`);
}
for (const icon of iconSet) {
  if (!manifest.iconDefinitions[icon]) throw new Error(`The theme has no icon ${icon}`);
}

// VS Code matches names and extensions case-insensitively: keys in lower case.
const subsetOf = (map) => {
  const out = {};
  for (const [key, icon] of Object.entries(map)) {
    const lower = key.toLowerCase();
    if (iconSet.has(icon) && !(lower in out)) out[lower] = icon;
  }
  return out;
};
const sorted = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
// Every spelling of a kept folder name (.rust, _rust, ...) is one entry once normalized.
const folderNames = {};
for (const [name, icon] of Object.entries(manifest.folderNames)) {
  if (!iconSet.has(icon) || !iconSet.has(`${icon}-open`)) continue;
  const base = folderBaseName(name);
  if (folderNames[base] && folderNames[base] !== icon) throw new Error(`Folder ${name}: ${icon} or ${folderNames[base]}?`);
  folderNames[base] = icon;
}
for (const [base, icon] of wanted) {
  if (folderNames[base] !== icon) throw new Error(`Folder ${base}: ${folderNames[base]}, not ${icon}`);
}

const theme = {
  version: pkg.version,
  file: manifest.file,
  folder: manifest.folder,
  folderOpen: manifest.folderExpanded,
  fileNames: sorted(subsetOf(manifest.fileNames)),
  fileExtensions: sorted(subsetOf(manifest.fileExtensions)),
  folderNames: sorted(folderNames),
};

// Every name the subset keeps looks up to its own icon, as in VS Code.
for (const [name, icon] of Object.entries(theme.fileNames)) {
  if (fileIconName(theme, name) !== icon) throw new Error(`File ${name}: ${fileIconName(theme, name)}, not ${icon}`);
}
for (const [name, icon] of Object.entries(theme.folderNames)) {
  if (fileIconName(theme, name, { dir: true }) !== icon) throw new Error(`Folder ${name}: not ${icon}`);
  if (fileIconName(theme, name, { dir: true, open: true }) !== `${icon}-open`) throw new Error(`Open folder ${name}`);
}

// A few icons draw one shape twice with <use xlink:href> of a path in <defs>.
// The shape is written out in place of each <use>, so that no SVG renderer
// has to resolve references for a 16-pixel icon.
function inlineUses(svg) {
  if (!svg.includes('<use')) return svg;
  const defs = {};
  const body = svg.replace(/<defs>([\s\S]*?)<\/defs>/g, (_, inner) => {
    for (const m of inner.matchAll(/<(path|circle|rect|ellipse) ([^>]*?)\bid="([^"]+)"([^>]*?)\/>/g)) {
      defs[m[3]] = `<${m[1]} ${(m[2] + m[4]).trim()}/>`;
    }
    return '';
  });
  const out = body.replace(/<use [^>]*?xlink:href="#([^"]+)"[^>]*?\/>/g, (whole, id) => {
    if (!defs[id]) throw new Error(`<use> of #${id} has no shape in <defs>`);
    return defs[id];
  });
  if (/<use|<defs/.test(out)) throw new Error('An icon with <use> or <defs> this script cannot inline');
  return out;
}

// An icon is named in the theme; its SVG file can have another name (an icon
// that reuses another's drawing). Only those are listed, under `files`.
const icons = new Set([theme.file, theme.folder, theme.folderOpen, ...Object.values(theme.fileNames),
  ...Object.values(theme.fileExtensions), ...Object.values(theme.folderNames).flatMap(i => [i, `${i}-open`])]);
const files = {};
const svgs = {};
for (const icon of [...icons].sort()) {
  const file = basename(manifest.iconDefinitions[icon].iconPath, '.svg');
  if (file !== icon) files[icon] = file;
  if (svgs[file]) continue;
  // The markup as one line: no comments, no space between tags.
  svgs[file] = inlineUses(readFileSync(join(pkgDir, 'icons', `${file}.svg`), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim());
}
theme.files = sorted(files);
for (const icon of icons) {
  if (!svgs[fileIconFile(theme, icon)]) throw new Error(`No SVG for ${icon}`);
}

const license = readFileSync(join(pkgDir, 'LICENSE'), 'utf8').trim().split('\n').map(l => `// ${l}`.trimEnd()).join('\n');
const entries = (map) => Object.entries(map).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n');
const out = `// Generated by scripts/build-file-icons.mjs from material-icon-theme ${pkg.version}. Do not edit.
// A subset of the package's icons: the theme's data for them, and their SVG markup.
//
${license}

import type { FileIconTheme } from '@/shared/vendor/file-icons';

export const FILE_ICON_THEME: FileIconTheme = {
  version: ${JSON.stringify(theme.version)},
  file: ${JSON.stringify(theme.file)},
  folder: ${JSON.stringify(theme.folder)},
  folderOpen: ${JSON.stringify(theme.folderOpen)},
  fileNames: {
${entries(theme.fileNames)}
  },
  fileExtensions: {
${entries(theme.fileExtensions)}
  },
  folderNames: {
${entries(theme.folderNames)}
  },
  files: {
${entries(theme.files)}
  },
};

/** The SVG markup of each icon, by SVG file name (see fileIconFile). */
export const FILE_ICON_SVG: Record<string, string> = {
${entries(svgs)}
};
`;
const target = join(root, 'src', 'files', 'icon-theme.generated.ts');
writeFileSync(target, out);
console.log(`src/files/icon-theme.generated.ts: ${Object.keys(theme.fileNames).length} names, ${Object.keys(theme.fileExtensions).length} extensions, ${Object.keys(theme.folderNames).length} folders, ${Object.keys(svgs).length} SVGs, ${Math.round(out.length / 1024)} KB`);
