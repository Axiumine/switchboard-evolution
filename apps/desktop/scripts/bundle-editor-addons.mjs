// The editor's add-ons (public/editor/addons/*.mjs), each in a bundle of its
// own that the page loads the first time an editor needs it
// (public/editor/addons.mjs): public/editor-<name>-bundle.js.
//
// An add-on imports @codemirror/*, @lezer/* and marked as any module does, but
// gets the main bundle's own modules (window.__sbEditorModules, set by
// codemirror-setup.js): a second copy of @codemirror/state would make its
// extensions foreign to the editor. The build fails if one of those packages
// still ends up inside an add-on.
//
//   node scripts/bundle-editor-addons.mjs          build every add-on
//   node scripts/bundle-editor-addons.mjs --sizes  and print their sizes
import { build } from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const ADDONS_DIR = path.join(APP_DIR, 'public/editor/addons');

/** The packages an add-on takes from the main bundle. */
export const SHARED_MODULES = [
  '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands', '@codemirror/search',
  '@codemirror/autocomplete', '@codemirror/lint', '@lezer/common', '@lezer/highlight', '@lezer/lr', 'marked',
  // The languages the main bundle has, that the add-on's languages build on (PHP and Vue on HTML, Sass on CSS …).
  '@codemirror/lang-html', '@codemirror/lang-css', '@codemirror/lang-javascript', '@lezer/javascript', '@lezer/html', '@lezer/css',
];

const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const sharedModules = {
  name: 'shared-editor-modules',
  setup(b) {
    b.onResolve({ filter: new RegExp(`^(${SHARED_MODULES.map(escape).join('|')})$`) }, args => ({ path: args.path, namespace: 'sb-shared' }));
    b.onLoad({ filter: /.*/, namespace: 'sb-shared' }, args => ({
      contents: `const m = window.__sbEditorModules && window.__sbEditorModules[${JSON.stringify(args.path)}];
if (!m) throw new Error('The editor bundle does not give ${args.path} to its add-ons');
module.exports = m;`,
      loader: 'js',
    }));
  },
};

/** A package from SHARED_MODULES among the files bundled, if any. */
export function strayShared(inputs) {
  return Object.keys(inputs).filter(file => SHARED_MODULES.some(name => file.includes(`node_modules/${name}/`)));
}

export async function bundleAddons({ sizes = false } = {}) {
  const names = fs.existsSync(ADDONS_DIR)
    ? fs.readdirSync(ADDONS_DIR).filter(f => f.endsWith('.mjs')).map(f => f.replace(/\.mjs$/, ''))
    : [];
  for (const name of names) {
    const outfile = path.join(APP_DIR, `public/editor-${name}-bundle.js`);
    const result = await build({
      entryPoints: [path.join(ADDONS_DIR, `${name}.mjs`)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      minify: true,
      outfile,
      metafile: true,
      plugins: [sharedModules],
      logLevel: 'warning',
    });
    const stray = strayShared(result.metafile.inputs);
    if (stray.length) {
      fs.rmSync(outfile, { force: true });
      throw new Error(`editor-${name}-bundle.js would carry its own copy of shared modules:\n  ${stray.join('\n  ')}`);
    }
    if (sizes) console.log(`public/editor-${name}-bundle.js  ${fs.statSync(outfile).size} bytes`);
  }
  return names;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bundleAddons({ sizes: process.argv.includes('--sizes') }).then(
    names => console.log(`editor add-ons: ${names.join(', ') || 'none'}`),
    (err) => { console.error(err.message); process.exit(1); },
  );
}
